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
  const shop = url.searchParams.get("shop");
  const productId = url.searchParams.get("productId");
  const ancho = Number(url.searchParams.get("ancho") || 100);
  const alto = Number(url.searchParams.get("alto") || 100);

  console.log("[api.precio] Request recibido:", { shop, productId, ancho, alto });

  if (!shop || ancho <= 0 || alto <= 0) {
    return new Response(
      JSON.stringify({ error: "Parámetros inválidos. Se requiere shop, ancho y alto." }),
      { status: 400, headers: corsHeaders },
    );
  }

  console.log("[api.precio] Buscando regla para shop:", shop, "productId:", productId);

  const sql = neon(process.env.DIRECT_URL!);

  const [rows, configRows] = await Promise.all([
    sql`
      SELECT * FROM "ReglaPersonalizada"
      WHERE shop = ${shop}
      AND activa = true
      AND (
        ${productId} = ANY("productIds")
        OR array_length("productIds", 1) IS NULL
        OR "productIds" = '{}'
      )
      LIMIT 1
    `,
    sql`
      SELECT eyebrow, titulo, descripcion, disclaimer, "chipTexto"
      FROM "ConfiguracionImpermeabilizador"
      WHERE shop = ${shop}
      LIMIT 1
    `,
  ]);

  if (!rows.length) {
    console.log("[api.precio] No se encontró regla activa");
    return new Response(
      JSON.stringify({ error: "No hay regla activa para esta tienda." }),
      { status: 404, headers: corsHeaders },
    );
  }

  const regla = rows[0];
  console.log("[api.precio] Regla encontrada:", regla);

  // Bordes: filtrar solo los que tienen los 3 campos completos
  type BordeItem = { imagenUrl: string; nombre: string; tipo: string };
  const bordesRaw = Array.isArray(regla.bordes) ? (regla.bordes as BordeItem[]) : [];
  const bordes = bordesRaw.filter(
    (b) => b && typeof b.imagenUrl === "string" && b.imagenUrl.trim() &&
           typeof b.nombre    === "string" && b.nombre.trim() &&
           typeof b.tipo      === "string" && b.tipo.trim()
  );

  // Textos impermeabilizador (con defaults si el merchant no los configuró)
  const textosImp = configRows.length ? {
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

  // Redondear cm → m hacia arriba (ej: 230cm → 3m) y cobrar por m² enteros
  const anchoM = Math.ceil(ancho / 100);
  const altoM  = Math.ceil(alto  / 100);
  const m2     = anchoM * altoM;
  const precio = Math.round(m2 * regla.precioPorM2);
  const waterproofPrecio = Math.round(m2 * regla.waterproofPorM2);

  return new Response(
    JSON.stringify({
      precio,
      waterproofPrecio,
      waterproofActivo: regla.waterproofActivo,
      precioPorM2: regla.precioPorM2,
      waterproofPorM2: regla.waterproofPorM2,
      regla: {
        minAncho: regla.minAncho,
        maxAncho: regla.maxAncho,
        minAlto: regla.minAlto,
        maxAlto: regla.maxAlto,
      },
      bordes,
      textosImp,
    }),
    { status: 200, headers: corsHeaders },
  );
};

