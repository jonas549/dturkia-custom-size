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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: preflightHeaders });
  }
  return new Response(JSON.stringify({ error: "Método no permitido" }), {
    status: 405,
    headers: corsHeaders,
  });
};

type ItemInput = {
  tipo?: string;
  // Impermeabilizador fields
  variantId?: string | number | null;
  precioVariante?: number | null;
  precioImpermeabilizador?: number | null;
  // Medida fields (backward compat para carritos mixtos)
  ancho?: number | null;
  alto?: number | null;
  waterproof?: boolean;
  precio?: number | null;
  waterproofPrecio?: number | null;
  productTitle?: string | null;
  borde?: string | null;
  trama?: string | null;
  // Stock por pliego (Fase 4). El tema los enviará en las Fases 6 y 7.
  id?: string | null;
  reglaId?: string | null;
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

  let body: {
    shop?: string;
    items?: ItemInput[];
    cartItems?: Array<{ variant_id: number; quantity: number }>;
  };

  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Body JSON inválido" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const { shop, items, cartItems = [] } = body;

  if (!shop || !Array.isArray(items) || items.length === 0) {
    return new Response(
      JSON.stringify({ error: "Parámetros requeridos: shop, items[]" }),
      { status: 400, headers: corsHeaders },
    );
  }

  console.log("[api.checkout-impermeabilizador] Request:", { shop, itemCount: items.length });

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

  if (!sessions.length) {
    return new Response(
      JSON.stringify({ error: "La tienda no tiene sesión activa. El merchant debe reinstalar la app." }),
      { status: 403, headers: corsHeaders },
    );
  }

  const session  = sessions.find((s) => s.id === offlineId) ?? sessions[0];
  const accessToken = session.accessToken as string;

  console.log("[api.checkout-impermeabilizador] Usando sesión:", session.id);

  // Verificar token antes de crear el Draft Order
  const tokenCheck = await fetch(`https://${shop}/admin/api/2025-10/shop.json`, {
    headers: { "X-Shopify-Access-Token": accessToken },
  });
  if (tokenCheck.status === 401) {
    return new Response(
      JSON.stringify({ error: "TOKEN_REVOKED", message: "El token está revocado. El merchant debe reinstalar la app." }),
      { status: 401, headers: corsHeaders },
    );
  }

  // ── Stock por pliego (§5.5 pasos 1-2) — ANTES de crear el Draft Order ─────
  // Este endpoint también procesa items tipo 'medida': functions.js:729 rutea
  // TODO el carrito aquí si hay ≥1 item de impermeabilizador (§2.2.1). Por eso
  // la lógica de stock tiene que vivir en los dos endpoints.
  // Los items 'impermeabilizador' son productos de talla fija: no reservan nada.
  const itemsMedida: ItemMedidaCheckout[] = items
    .map((item, indice) => ({ item, indice }))
    .filter(({ item }) => item.tipo !== "impermeabilizador" && item.ancho && item.alto)
    .map(({ item, indice }) => ({
      indice,
      refId: item.id ?? null,
      reglaId: item.reglaId ?? null,
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

  // Construir line items para el Draft Order GraphQL
  const lineItems: object[] = [];

  for (const item of items) {
    if (item.tipo === "impermeabilizador") {
      const rawVariantId = String(item.variantId ?? "").replace("gid://shopify/ProductVariant/", "");
      if (!rawVariantId) continue;
      const variantGid  = `gid://shopify/ProductVariant/${rawVariantId}`;
      const totalPrecio = (item.precioVariante || 0) + (item.precioImpermeabilizador || 0);
      lineItems.push({
        variantId: variantGid,
        quantity:  1,
        priceOverride: {
          amount:       totalPrecio.toFixed(2),
          currencyCode: "CLP",
        },
        customAttributes: [
          { key: "Impermeabilizador", value: "Sí" },
        ],
      });
    } else {
      // item tipo 'medida' (o sin tipo = backward compat)
      const itemPrecio  = (item.precio || 0) + (item.waterproof && item.waterproofPrecio ? item.waterproofPrecio : 0);
      const baseTitle   = item.productTitle || "Alfombra Medida Personalizada";
      const title       = `${baseTitle} — ${item.ancho}cm × ${item.alto}cm`;
      lineItems.push({
        title,
        quantity: 1,
        originalUnitPriceWithCurrency: {
          amount:       itemPrecio.toFixed(2),
          currencyCode: "CLP",
        },
        customAttributes: [
          { key: "Ancho",             value: `${item.ancho} cm` },
          { key: "Alto",              value: `${item.alto} cm` },
          { key: "Impermeabilizador", value: item.waterproof ? "Sí" : "No" },
          // Borde y Trama: `api.checkout.tsx` ya los manda como properties. Aquí
          // faltaba el Borde (hueco preexistente): con el carrito mixto la orden
          // salía sin él aunque sí se guardaba en PedidoCustom.
          ...(item.borde ? [{ key: "Borde", value: item.borde }] : []),
          ...(item.trama ? [{ key: "Trama", value: item.trama }] : []),
        ],
      });
    }
  }

  // Agregar items del carrito nativo de Shopify
  for (const cartItem of cartItems) {
    lineItems.push({
      variantId: `gid://shopify/ProductVariant/${cartItem.variant_id}`,
      quantity:  cartItem.quantity,
    });
  }

  const mutation = `
    mutation DraftOrderCreate($input: DraftOrderInput!) {
      draftOrderCreate(input: $input) {
        draftOrder {
          id
          name
          invoiceUrl
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  console.log("[api.checkout-impermeabilizador] Creando Draft Order GraphQL — lineItems:", lineItems.length);

  const gqlResponse = await fetch(
    `https://${shop}/admin/api/2025-10/graphql.json`,
    {
      method:  "POST",
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type":           "application/json",
      },
      body: JSON.stringify({
        query:     mutation,
        variables: { input: { lineItems } },
      }),
    },
  );

  const gqlData = await gqlResponse.json() as {
    data?: {
      draftOrderCreate?: {
        draftOrder?: { id?: string; name?: string; invoiceUrl?: string };
        userErrors?: Array<{ field: string[]; message: string }>;
      };
    };
    errors?: unknown;
  };

  const draftOrderResult = gqlData.data?.draftOrderCreate;
  const userErrors       = draftOrderResult?.userErrors ?? [];

  if (userErrors.length > 0 || !draftOrderResult?.draftOrder?.invoiceUrl) {
    console.error("[api.checkout-impermeabilizador] Error GraphQL:", { userErrors, errors: gqlData.errors });
    // §5.5 paso 3: compensar las reservas ya hechas.
    if (pliegos.refIds.length) {
      await anular(shop, pliegos.refIds).catch((e) =>
        console.error("[api.checkout-impermeabilizador] Error anulando reservas tras fallo del draft:", e));
    }
    return new Response(
      JSON.stringify({ error: "Error al crear el pedido en Shopify", detail: gqlData }),
      { status: 500, headers: corsHeaders },
    );
  }

  const checkoutUrl   = draftOrderResult.draftOrder.invoiceUrl;
  const draftOrderGid = draftOrderResult.draftOrder.id ?? "";
  const draftOrderId  = draftOrderGid.replace("gid://shopify/DraftOrder/", "");
  const orderName     = String(draftOrderResult.draftOrder.name ?? "");

  console.log("[api.checkout-impermeabilizador] Draft Order creado. ID:", draftOrderId, "URL:", checkoutUrl);

  // §5.5 paso 4: cruzar reserva ↔ draft order para /api/check-paid.
  if (pliegos.refIds.length) {
    await vincularDraftOrder(shop, pliegos.refIds, draftOrderId).catch((e) =>
      console.error("[api.checkout-impermeabilizador] Error vinculando reservas al draft:", e));
  }

  // Registrar PedidoCustom por cada item — no bloquea si falla
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    try {
      const isImp   = item.tipo === "impermeabilizador";
      const precio  = isImp
        ? (item.precioVariante || 0) + (item.precioImpermeabilizador || 0)
        : (item.precio || 0) + (item.waterproof && item.waterproofPrecio ? item.waterproofPrecio : 0);
      const anchoDb = isImp ? 0 : (item.ancho || 0);
      const altoDb  = isImp ? 0 : (item.alto  || 0);
      const wp      = isImp ? true : (item.waterproof ?? false);
      const tipo    = item.tipo || "medida";
      const asignada = asignacionPorIndice.get(i);
      await sql`
        INSERT INTO "PedidoCustom" (id, shop, "orderId", ancho, alto, waterproof, "precioTotal", estado, "productTitle", tipo, borde, trama, "pliegoId", "pliegoCodigo", rotada, "orderName", "createdAt")
        VALUES (
          ${randomUUID()},
          ${shop},
          ${draftOrderId},
          ${anchoDb},
          ${altoDb},
          ${wp},
          ${precio},
          'pendiente',
          ${item.productTitle ?? ""},
          ${tipo},
          ${isImp ? null : (item.borde ?? null)},
          ${isImp ? null : (item.trama ?? null)},
          ${asignada?.pliegoId ?? null},
          ${asignada?.pliegoCodigo ?? ""},
          ${asignada?.rotada ?? false},
          ${orderName},
          NOW()
        )
      `;
      if (asignada) {
        console.log(`[api.checkout-impermeabilizador] PedidoCustom ${orderName} → pliegoCodigo=${asignada.pliegoCodigo} rotada=${asignada.rotada}`);
      }
    } catch (insertErr) {
      console.error("[api.checkout-impermeabilizador] Error registrando PedidoCustom:", insertErr);
    }
  }

  console.log("[api.checkout-impermeabilizador] PedidoCustom registrados:", items.length, "orderId:", draftOrderId);

  return new Response(
    JSON.stringify({ checkoutUrl, draftOrderId }),
    { status: 200, headers: corsHeaders },
  );
};
