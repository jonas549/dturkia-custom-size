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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: preflightHeaders });
  }

  const url = new URL(request.url);
  const shop      = url.searchParams.get("shop");
  const productId = url.searchParams.get("productId");

  if (!shop || !productId) {
    return new Response(
      JSON.stringify({ error: "Parámetros requeridos: shop, productId" }),
      { status: 400, headers: corsHeaders },
    );
  }

  const sql = neon(process.env.DIRECT_URL!);

  // Neon tagged template: las comillas dobles en la parte literal del SQL no necesitan escape
  const reglas = await sql`
    SELECT r.id, r.activa
    FROM "ReglaImpermeabilizador" r
    WHERE r.shop      = ${shop}
      AND r."productId" = ${productId}
      AND r.activa    = true
    LIMIT 1
  `;

  if (!reglas.length) {
    return new Response(
      JSON.stringify({ activa: false, variantes: {} }),
      { status: 200, headers: corsHeaders },
    );
  }

  const reglaId = reglas[0].id;

  const variantes = await sql`
    SELECT "variantId", precio, aplica
    FROM "VarianteImpermeabilizador"
    WHERE "reglaId" = ${reglaId}
  `;

  const variantesMap: Record<string, { aplica: boolean; precio: number }> = {};
  for (const v of variantes) {
    variantesMap[v.variantId as string] = {
      aplica: v.aplica as boolean,
      precio: v.precio as number,
    };
  }

  return new Response(
    JSON.stringify({ activa: true, variantes: variantesMap }),
    { status: 200, headers: corsHeaders },
  );
};
