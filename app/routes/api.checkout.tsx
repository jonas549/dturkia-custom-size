import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { neon } from "@neondatabase/serverless";

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
  // Algunos clientes envían OPTIONS al action también
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
    ancho?: number;
    alto?: number;
    waterproof?: boolean;
    precio?: number;
    waterproofPrecio?: number;
    cartItems?: Array<{ variant_id: number; quantity: number }>;
    variantId?: number | string;
  };

  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Body JSON inválido" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const { shop, ancho, alto, waterproof, precio, waterproofPrecio, cartItems, variantId } = body;

  if (!shop || !ancho || !alto || precio === undefined) {
    return new Response(
      JSON.stringify({ error: "Parámetros requeridos: shop, ancho, alto, precio" }),
      { status: 400, headers: corsHeaders },
    );
  }

  console.log("[api.checkout] Request:", { shop, ancho, alto, waterproof, precio, waterproofPrecio });

  // Obtener offline token desde la tabla Session.
  // @shopify/shopify-app-remix guarda la sesión offline con id = "offline_{shop}".
  // Fallback: cualquier sesión isOnline=false sin expirar, ordenando nulls first
  // (tokens offline no tienen expires).
  // DIRECT_URL preferido (no-pooler); fallback a DATABASE_URL si no está en Vercel
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

  // Preferir la sesión offline_ canónica; si no, la primera disponible
  const session = sessions.find((s) => s.id === offlineId) ?? sessions[0];
  const accessToken = session.accessToken as string;

  console.log("[api.checkout] Usando sesión id:", session.id, "scope:", session.scope);

  // Calcular precio total
  const precioTotal = (precio || 0) + (waterproof && waterproofPrecio ? waterproofPrecio : 0);

  const properties = [
    { name: "Ancho", value: `${ancho} cm` },
    { name: "Alto", value: `${alto} cm` },
    { name: "Impermeabilizador", value: waterproof ? "Sí" : "No" },
  ];

  // Items del carrito Shopify (variant_id + quantity, sin price — Shopify usa el precio real)
  const regularItems = (cartItems || []).map((item) => ({
    variant_id: item.variant_id,
    quantity: item.quantity,
  }));

  // Line item custom sin variant_id — Shopify respeta el price calculado.
  // (Con variant_id, Shopify ignora el price override y usa el precio del variant.)
  const customItem = {
    title: "Alfombra Medida Personalizada",
    quantity: 1,
    price: precioTotal.toFixed(2),
    properties,
  };

  const draftOrderPayload = {
    draft_order: {
      line_items: [...regularItems, customItem],
    },
  };

  // Validar token antes de usarlo — diferencia token revocado de otros errores
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

  console.log("[api.checkout] Creando draft order para shop:", shop, "precio:", precioTotal);

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

  const shopifyData = await shopifyResponse.json() as { draft_order?: { invoice_url?: string }; errors?: unknown };

  if (!shopifyResponse.ok || !shopifyData.draft_order?.invoice_url) {
    console.error("[api.checkout] Error de Shopify:", shopifyData);
    return new Response(
      JSON.stringify({ error: "Error al crear el pedido en Shopify", detail: shopifyData }),
      { status: 500, headers: corsHeaders },
    );
  }

  const checkoutUrl = shopifyData.draft_order.invoice_url;
  console.log("[api.checkout] Draft order creado. Invoice URL:", checkoutUrl);

  return new Response(
    JSON.stringify({ checkoutUrl }),
    { status: 200, headers: corsHeaders },
  );
};
