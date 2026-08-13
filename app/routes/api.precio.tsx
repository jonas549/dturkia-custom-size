import type { LoaderFunctionArgs } from "react-router";
import { neon } from "@neondatabase/serverless";
import { capacidades, tienePliegos, type Capacidad } from "../lib/pliegos.server";

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

  // ── Stock por pliego (Fase 5) — aditivo ────────────────────────────────────
  // El snippet antiguo ignora los campos que no conoce, así que esto no puede
  // romper nada que ya esté en producción.
  //
  // Tres estados distintos, y la diferencia importa:
  //   · `capacidades` ausente  → la trama NO tiene pliegos cargados. Sin control
  //                              de stock: el widget se comporta como siempre.
  //   · `capacidades: []`      → tiene pliegos pero no queda material. AGOTADO.
  //   · `capacidades: [...]`   → hay material; el widget valida el PAR (§2.3).
  let capacidadesResp: Capacidad[] | undefined;
  let topes = {
    minAncho: regla.minAncho,
    maxAncho: regla.maxAncho,
    minAlto: regla.minAlto,
    maxAlto: regla.maxAlto,
  };

  try {
    if (await tienePliegos(shop, regla.id)) {
      capacidadesResp = await capacidades(shop, regla.id);

      if (capacidadesResp.length) {
        // Tope físico por dimensión, CON rotación (decisión 1): una pieza de
        // lado X cabe si algún rollo tiene ese ancho, o si su largo lo permite
        // cortándola girada. Por eso el tope es el mayor de ambos.
        const topeFisico = capacidadesResp.reduce(
          (mx, c) => Math.max(mx, c.anchoCm, c.largoMaxCm), 0,
        );
        // §2.4 — híbrido: el tope manual es un techo COMERCIAL y el físico solo
        // puede restringirlo, nunca ampliarlo.
        topes = {
          minAncho: regla.minAncho,
          maxAncho: Math.min(regla.maxAncho, topeFisico),
          minAlto: regla.minAlto,
          maxAlto: Math.min(regla.maxAlto, topeFisico),
        };
      }
      // Si está agotado se dejan los topes comerciales tal cual: acotarlos a 0
      // dejaría el slider inservible. El widget mostrará "Agotado" por el
      // arreglo vacío, no por los topes.
      console.log("[api.precio] capacidades:", JSON.stringify(capacidadesResp), "topes:", JSON.stringify(topes));
    }
  } catch (e) {
    // El stock nunca debe tumbar el cálculo de precio: si algo falla, el
    // widget sigue funcionando exactamente como antes de este módulo.
    console.error("[api.precio] Error calculando capacidades (se ignora):", e);
    capacidadesResp = undefined;
  }

  return new Response(
    JSON.stringify({
      precio,
      waterproofPrecio,
      waterproofActivo: regla.waterproofActivo,
      precioPorM2: regla.precioPorM2,
      waterproofPorM2: regla.waterproofPorM2,
      regla: topes,
      reglaId: regla.id,
      ...(capacidadesResp !== undefined ? { capacidades: capacidadesResp } : {}),
      bordes,
      textosImp,
    }),
    { status: 200, headers: corsHeaders },
  );
};

