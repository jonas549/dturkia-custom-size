import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";

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
      properties: [
        { name: "Ancho",             value: `${item.ancho} cm` },
        { name: "Alto",              value: `${item.alto} cm` },
        { name: "Impermeabilizador", value: item.waterproof ? "Sí" : "No" },
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
    draft_order?: { invoice_url?: string; id?: number };
    errors?: unknown;
  };

  if (!shopifyResponse.ok || !shopifyData.draft_order?.invoice_url) {
    console.error("[api.checkout] Error de Shopify:", shopifyData);
    return new Response(
      JSON.stringify({ error: "Error al crear el pedido en Shopify", detail: shopifyData }),
      { status: 500, headers: corsHeaders },
    );
  }

  const checkoutUrl = shopifyData.draft_order.invoice_url;
  const draftOrderId = String(shopifyData.draft_order.id ?? "");

  console.log("[api.checkout] Draft order creado. ID:", draftOrderId, "URL:", checkoutUrl);

  // Registrar un PedidoCustom por cada item — no bloquea el checkout si falla
  for (const item of customItems) {
    const itemPrecio = (item.precio || 0) + (item.waterproof && item.waterproofPrecio ? item.waterproofPrecio : 0);
    try {
      await sql`
        INSERT INTO "PedidoCustom" (id, shop, "orderId", ancho, alto, waterproof, "precioTotal", estado, "productTitle", "createdAt")
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
          NOW()
        )
      `;
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
