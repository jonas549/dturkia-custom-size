import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";
import {
  anular,
  procesarCheckoutPliegos,
  vincularDraftOrder,
  type ItemMedidaCheckout,
} from "../lib/pliegos.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

const preflightHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Loader maneja OPTIONS preflight — sin export default para que CORS funcione
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: preflightHeaders });
  }
  return new Response(JSON.stringify({ error: "Método no permitido" }), {
    status: 405,
    headers: corsHeaders,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: preflightHeaders });
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Método no permitido" }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  type CustomItemInput = {
    ancho: number;
    alto: number;
    waterproof?: boolean;
    precio?: number;
    waterproofPrecio?: number;
    variantId?: number | string | null;
    productTitle?: string | null;
    borde?: string | null;
    trama?: string | null;
    // Stock por pliego (Fase 4). El tema los enviará en las Fases 6 y 7;
    // hasta entonces el backend resuelve la trama desde variantId.
    id?: string | null;
    reglaId?: string | null;
    /** 🔷 id de la Trama elegida (§4.4). Los items viejos del localStorage no
     *  lo traen: el backend cae al nombre en `trama`. */
    tramaId?: string | null;
  };

  let body: {
    shop?: string;
    customItems?: CustomItemInput[];
    cartItems?: Array<{ variant_id: number; quantity: number }>;
    // Legacy single-item fields (backward compat para browsers con JS cacheado)
    ancho?: number;
    alto?: number;
    waterproof?: boolean;
    precio?: number;
    waterproofPrecio?: number;
    variantId?: number | string;
    productTitle?: string;
  };

  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Body JSON inválido" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const { shop, cartItems } = body;

  // Normalizar: nuevo formato (customItems array) o legacy (campos planos)
  let customItems: CustomItemInput[];
  if (Array.isArray(body.customItems) && body.customItems.length) {
    customItems = body.customItems;
  } else if (body.ancho && body.alto && body.precio !== undefined) {
    customItems = [{
      ancho: body.ancho,
      alto: body.alto,
      waterproof: body.waterproof,
      precio: body.precio,
      waterproofPrecio: body.waterproofPrecio,
      variantId: body.variantId,
      productTitle: body.productTitle,
    }];
  } else {
    return new Response(
      JSON.stringify({ error: "Parámetros requeridos: shop + customItems (o ancho/alto/precio en formato legacy)" }),
      { status: 400, headers: corsHeaders },
    );
  }

  if (!shop || !customItems.every(i => i.ancho && i.alto && i.precio !== undefined)) {
    return new Response(
      JSON.stringify({ error: "Cada item requiere: ancho, alto, precio" }),
      { status: 400, headers: corsHeaders },
    );
  }

  console.log("[api.checkout] Request:", { shop, itemCount: customItems.length });

  const sql = neon(process.env.DIRECT_URL ?? process.env.DATABASE_URL!);

  const offlineId = `offline_${shop}`;

  const sessions = await sql`
    SELECT id, "accessToken", "isOnline", expires, scope
    FROM "Session"
    WHERE id = ${offlineId}
       OR (shop = ${shop} AND "isOnline" = false)
    ORDER BY
      CASE WHEN id = ${offlineId} THEN 0 ELSE 1 END,
      expires DESC NULLS FIRST
    LIMIT 5
  `;

  console.log("[api.checkout] Sesiones encontradas:", sessions.map((s) => ({
    id: s.id,
    isOnline: s.isOnline,
    expires: s.expires,
    scope: s.scope,
    tokenPrefix: (s.accessToken as string).slice(0, 10) + "...",
  })));

  if (!sessions.length) {
    console.error("[api.checkout] No se encontró sesión offline para shop:", shop);
    return new Response(
      JSON.stringify({ error: "La tienda no tiene sesión activa. El merchant debe reinstalar la app." }),
      { status: 403, headers: corsHeaders },
    );
  }

  const session = sessions.find((s) => s.id === offlineId) ?? sessions[0];
  const accessToken = session.accessToken as string;

  console.log("[api.checkout] Usando sesión id:", session.id, "scope:", session.scope);

  const regularItems = (cartItems || []).map((item) => ({
    variant_id: item.variant_id,
    quantity: item.quantity,
  }));

  const customLineItems = customItems.map((item) => {
    const itemPrecio = (item.precio || 0) + (item.waterproof && item.waterproofPrecio ? item.waterproofPrecio : 0);
    const baseTitle  = item.productTitle || "Alfombra Medida Personalizada";
    return {
      title:    `${baseTitle} — ${item.ancho}cm × ${item.alto}cm`,
      quantity: 1,
      price:    itemPrecio.toFixed(2),
      // ⚠️ Decisión 5: el código de pliego NO va aquí. El cliente no debe verlo
      // y no viaja en la orden de Shopify; vive solo en PedidoCustom, que es lo
      // que alimenta la pestaña Cortes del admin.
      properties: [
        { name: "Ancho",             value: `${item.ancho} cm` },
        { name: "Alto",              value: `${item.alto} cm` },
        { name: "Impermeabilizador", value: item.waterproof ? "Sí" : "No" },
        ...(item.borde ? [{ name: "Borde", value: item.borde }] : []),
        ...(item.trama ? [{ name: "Trama", value: item.trama }] : []),
      ],
    };
  });

  const draftOrderPayload = {
    draft_order: {
      line_items: [...regularItems, ...customLineItems],
    },
  };

  const tokenCheckResponse = await fetch(
    `https://${shop}/admin/api/2025-10/shop.json`,
    { headers: { "X-Shopify-Access-Token": accessToken } },
  );
  if (tokenCheckResponse.status === 401) {
    console.error("[api.checkout] Token revocado para shop:", shop, "sessionId:", session.id);
    return new Response(
      JSON.stringify({ error: "TOKEN_REVOKED", message: "El token está revocado. El merchant debe reinstalar la app." }),
      { status: 401, headers: corsHeaders },
    );
  }

  // ── Stock por pliego (§5.5 pasos 1-2) — ANTES de crear el Draft Order ─────
  // Reservar antes significa que nunca existe una orden sin su pliego asignado.
  // Va después del chequeo de token: si el token está revocado no tiene sentido
  // dejar material ocupado 15 minutos por una venta que no va a ocurrir.
  const itemsMedida: ItemMedidaCheckout[] = customItems.map((item, indice) => ({
    indice,
    refId: item.id ?? null,
    reglaId: item.reglaId ?? null,
    // 🔷 §4.4 — el stock es por trama. `tramaId` lo manda el tema; `trama` (el
    // nombre) es la red para los items que ya estaban en el localStorage.
    tramaId: item.tramaId ?? null,
    trama: item.trama ?? null,
    variantId: item.variantId ?? null,
    anchoCm: Number(item.ancho),
    altoCm: Number(item.alto),
  }));

  const pliegos = await procesarCheckoutPliegos(shop, itemsMedida, accessToken);

  if (pliegos.bloquear) {
    return new Response(
      JSON.stringify({ error: pliegos.error, motivo: "SIN_STOCK" }),
      { status: 409, headers: corsHeaders },
    );
  }

  const asignacionPorIndice = new Map(pliegos.asignaciones.map((a) => [a.indice, a.reserva]));

  console.log("[api.checkout] Creando draft order para shop:", shop, "custom items:", customItems.length);

  const shopifyResponse = await fetch(
    `https://${shop}/admin/api/2025-10/draft_orders.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(draftOrderPayload),
    },
  );

  const shopifyData = await shopifyResponse.json() as {
    draft_order?: { invoice_url?: string; id?: number; name?: string };
    errors?: unknown;
  };

  if (!shopifyResponse.ok || !shopifyData.draft_order?.invoice_url) {
    console.error("[api.checkout] Error de Shopify:", shopifyData);
    // §5.5 paso 3: compensar las reservas — si no, ocuparían stock 15 min por
    // una venta que nunca existió.
    if (pliegos.refIds.length) {
      await anular(shop, pliegos.refIds).catch((e) =>
        console.error("[api.checkout] Error anulando reservas tras fallo del draft:", e));
    }
    return new Response(
      JSON.stringify({ error: "Error al crear el pedido en Shopify", detail: shopifyData }),
      { status: 500, headers: corsHeaders },
    );
  }

  const checkoutUrl = shopifyData.draft_order.invoice_url;
  const draftOrderId = String(shopifyData.draft_order.id ?? "");
  const orderName = String(shopifyData.draft_order.name ?? "");

  console.log("[api.checkout] Draft order creado. ID:", draftOrderId, "URL:", checkoutUrl);

  // §5.5 paso 4: cruzar reserva ↔ draft order para que /api/check-paid pueda
  // confirmarla cuando el cliente pague.
  if (pliegos.refIds.length) {
    await vincularDraftOrder(shop, pliegos.refIds, draftOrderId).catch((e) =>
      console.error("[api.checkout] Error vinculando reservas al draft:", e));
  }

  // Registrar un PedidoCustom por cada item — no bloquea el checkout si falla
  for (let i = 0; i < customItems.length; i++) {
    const item = customItems[i];
    const itemPrecio = (item.precio || 0) + (item.waterproof && item.waterproofPrecio ? item.waterproofPrecio : 0);
    const asignada = asignacionPorIndice.get(i);
    try {
      await sql`
        INSERT INTO "PedidoCustom" (id, shop, "orderId", ancho, alto, waterproof, "precioTotal", estado, "productTitle", borde, trama, "pliegoId", "pliegoCodigo", rotada, "orderName", "createdAt")
        VALUES (
          ${randomUUID()},
          ${shop},
          ${draftOrderId},
          ${item.ancho},
          ${item.alto},
          ${item.waterproof ?? false},
          ${itemPrecio},
          'pendiente',
          ${item.productTitle ?? ""},
          ${item.borde ?? null},
          ${item.trama ?? null},
          ${asignada?.pliegoId ?? null},
          ${asignada?.pliegoCodigo ?? ""},
          ${asignada?.rotada ?? false},
          ${orderName},
          NOW()
        )
      `;
      if (asignada) {
        console.log(`[api.checkout] PedidoCustom ${orderName} → pliegoCodigo=${asignada.pliegoCodigo} rotada=${asignada.rotada}`);
      }
    } catch (insertErr) {
      console.error("[api.checkout] Error registrando PedidoCustom:", insertErr);
    }
  }
  console.log("[api.checkout] PedidoCustom registrados:", customItems.length, "orderId:", draftOrderId);

  return new Response(
    JSON.stringify({ checkoutUrl, draftOrderId }),
    { status: 200, headers: corsHeaders },
  );
};
