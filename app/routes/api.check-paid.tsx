import type { LoaderFunctionArgs } from "react-router";
import { neon } from "@neondatabase/serverless";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

const preflightHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// GET /api/check-paid?shop=dturkia.myshopify.com&ids=1234567890
// Devuelve { completedIds: ['1234567890'] } para Draft Orders ya pagados/completados
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: preflightHeaders });
  }

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const idsParam = url.searchParams.get("ids");

  if (!shop || !idsParam) {
    return new Response(JSON.stringify({ error: "Parámetros requeridos: shop, ids" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 5);

  if (!ids.length) {
    return new Response(JSON.stringify({ completedIds: [] }), { status: 200, headers: corsHeaders });
  }

  const sql = neon(process.env.DIRECT_URL ?? process.env.DATABASE_URL!);

  const sessions = await sql`
    SELECT "accessToken"
    FROM "Session"
    WHERE id = ${"offline_" + shop}
       OR (shop = ${shop} AND "isOnline" = false)
    ORDER BY CASE WHEN id = ${"offline_" + shop} THEN 0 ELSE 1 END
    LIMIT 1
  `;

  if (!sessions.length) {
    return new Response(JSON.stringify({ error: "Sin sesión activa" }), {
      status: 403,
      headers: corsHeaders,
    });
  }

  const accessToken = sessions[0].accessToken as string;
  const completedIds: string[] = [];

  await Promise.all(
    ids.map(async (id) => {
      try {
        const resp = await fetch(
          `https://${shop}/admin/api/2025-10/draft_orders/${id}.json`,
          { headers: { "X-Shopify-Access-Token": accessToken } },
        );
        if (!resp.ok) return;
        const data = await resp.json() as { draft_order?: { status?: string } };
        if (data.draft_order?.status === "completed") {
          completedIds.push(id);
        }
      } catch {
        // ignorar errores individuales
      }
    }),
  );

  return new Response(JSON.stringify({ completedIds }), { status: 200, headers: corsHeaders });
};
