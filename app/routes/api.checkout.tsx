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
    variantId?: string | number;
    ancho?: number;
    alto?: number;
    waterproof?: boolean;
    precio?: number;
    waterproofPrecio?: number;
  };

  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Body JSON inválido" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const { shop, variantId, ancho, alto, waterproof, precio, waterproofPrecio } = body;

  if (!shop || !variantId || !ancho || !alto || precio === undefined) {
    return new Response(
      JSON.stringify({ error: "Parámetros requeridos: shop, variantId, ancho, alto, precio" }),
      { status: 400, headers: corsHeaders },
    );
  }

  console.log("[api.checkout] Request:", { shop, variantId, ancho, alto, waterproof, precio, waterproofPrecio });

  // Obtener offline token desde la tabla Session
  const sql = neon(process.env.DIRECT_URL!);

  const sessions = await sql`
    SELECT "accessToken"
    FROM "Session"
    WHERE shop = ${shop}
      AND "isOnline" = false
    LIMIT 1
  `;

  if (!sessions.length) {
    console.error("[api.checkout] No se encontró sesión offline para shop:", shop);
    return new Response(
      JSON.stringify({ error: "La tienda no tiene sesión activa. El merchant debe reinstalar la app." }),
      { status: 403, headers: corsHeaders },
    );
  }

  const accessToken = sessions[0].accessToken as string;

  // Calcular precio total
  const precioTotal = (precio || 0) + (waterproof && waterproofPrecio ? waterproofPrecio : 0);

  // Propiedades del line item
  const properties = [
    { name: "_Ancho personalizado", value: `${ancho} cm` },
    { name: "_Alto personalizado", value: `${alto} cm` },
    { name: "_Impermeabilizador", value: waterproof ? "Sí" : "No" },
  ];

  const draftOrderPayload = {
    draft_order: {
      line_items: [
        {
          variant_id: parseInt(String(variantId), 10),
          quantity: 1,
          price: String(precioTotal),
          properties,
        },
      ],
    },
  };

  console.log("[api.checkout] Creando draft order para shop:", shop, "precio:", precioTotal);

  const shopifyResponse = await fetch(
    `https://${shop}/admin/api/2026-07/draft_orders.json`,
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
