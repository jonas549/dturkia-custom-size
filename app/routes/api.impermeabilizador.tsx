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

  const [reglas, configRows] = await Promise.all([
    sql`
      SELECT r.id, r.activa
      FROM "ReglaImpermeabilizador" r
      WHERE r.shop        = ${shop}
        AND r."productId" = ${productId}
        AND r.activa      = true
      LIMIT 1
    `,
    sql`
      SELECT eyebrow, titulo, descripcion, disclaimer, "chipTexto"
      FROM "ConfiguracionImpermeabilizador"
      WHERE shop = ${shop}
      LIMIT 1
    `,
  ]);

  const textos = configRows.length ? {
    eyebrow:     configRows[0].eyebrow,
    titulo:      configRows[0].titulo,
    descripcion: configRows[0].descripcion,
    disclaimer:  configRows[0].disclaimer,
    chipTexto:   configRows[0].chipTexto,
  } : {
    eyebrow:     "CUIDADO · RECOMENDADO",
    titulo:      "Impermeabiliza tu alfombra",
    descripcion: "Protector Textil por sólo {precio}",
    disclaimer:  "* Los plazos de entrega pueden ser desde 5 días hábiles",
    chipTexto:   "AGREGAR",
  };

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
    JSON.stringify({ activa: true, variantes: variantesMap, textos }),
    { status: 200, headers: corsHeaders },
  );
};
