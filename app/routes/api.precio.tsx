import type { LoaderFunctionArgs } from "react-router";
import { neon } from "@neondatabase/serverless";
import {
  capacidades,
  capacidadesDeRegla,
  hayMaterial,
  tramasDeRegla,
  type Capacidad,
} from "../lib/pliegos.server";

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

  // 🔷 Tramas (§4.4). Ya NO salen del Json de la regla: son filas de `Trama`,
  // y cada una viaja con SU capacidad, SUS topes y SU precio por m². Todo en
  // esta misma respuesta, para que cambiar de trama en el widget no necesite
  // otra llamada.
  //
  // El cálculo va dentro de un try/catch por trama más abajo; aquí solo la lista.
  let tramasRows: Awaited<ReturnType<typeof tramasDeRegla>> = [];
  try {
    tramasRows = await tramasDeRegla(shop, regla.id);
  } catch (e) {
    console.error("[api.precio] Error leyendo tramas (se ignora):", e);
  }

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
  //   · sin ningún `largoMaxCm > 0` → tiene pliegos pero no queda material. AGOTADO.
  //   · con material           → el widget valida el PAR (§2.3) por escalones.
  //
  // ⚠️ `capacidades` es LA ESCALERA de anchos de rollo, no "lo vendible": los
  // anchos agotados viajan con `largoMaxCm: 0` porque el widget los necesita
  // para calcular el escalón. Un ancho agotado que desapareciera del arreglo
  // haría que el widget ofreciera el escalón de arriba.
  const topesComerciales = {
    minAncho: regla.minAncho,
    maxAncho: regla.maxAncho,
    minAlto: regla.minAlto,
    maxAlto: regla.maxAlto,
  };

  /**
   * Topes de slider a partir de una escalera. §2.4 híbrido: el tope manual es un
   * techo COMERCIAL y el físico solo puede restringirlo, nunca ampliarlo.
   *
   * 🔶 Los dos topes son DISTINTOS desde la corrección del 2026-08-14:
   *  · ANCHO — el ancho pedido fija el escalón y la rotación ya no puede sacarlo
   *    de ahí, así que el techo es el mayor ancho de rollo CON material.
   *  · ALTO — puede irse a lo largo del rollo (normal) o a lo ancho (rotada),
   *    así que su techo es el mayor de los dos.
   * Los dos son cotas superiores flojas: dicen qué es imposible seguro, no qué
   * se puede vender. El par concreto lo valida `evaluar()` / `evaluarMedida()`.
   */
  function topesDe(caps: Capacidad[]) {
    if (!hayMaterial(caps)) return topesComerciales;  // agotada: el slider no se acota a 0
    const conMaterial = caps.filter((c) => c.largoMaxCm > 0);
    return {
      minAncho: regla.minAncho,
      maxAncho: Math.min(regla.maxAncho, conMaterial.reduce((mx, c) => Math.max(mx, c.anchoCm), 0)),
      minAlto: regla.minAlto,
      maxAlto: Math.min(regla.maxAlto, conMaterial.reduce((mx, c) => Math.max(mx, c.anchoCm, c.largoMaxCm), 0)),
    };
  }

  // 🔷 Una escalera, unos topes y un precio POR TRAMA. Los tres estados de la
  // Fase 5 siguen valiendo, pero ahora son por trama:
  //   · `capacidades` ausente en la trama → no tiene rollos → sin control de stock
  //   · sin ningún largoMaxCm > 0         → AGOTADA (esa trama, no el producto)
  //   · con material                      → el widget valida el par por escalones
  type TramaResp = {
    id: string;
    nombre: string;
    url: string;
    precioPorM2: number;
    capacidades?: Capacidad[];
    agotada: boolean;
    regla: typeof topesComerciales;
  };

  const tramas: TramaResp[] = [];
  for (const t of tramasRows) {
    const base: TramaResp = {
      id: t.id,
      nombre: t.nombre,
      url: t.url,
      // Si la trama no tiene precio propio se cae al de la regla, para que una
      // trama recién creada no muestre 0.
      precioPorM2: t.precioPorM2 > 0 ? t.precioPorM2 : regla.precioPorM2,
      agotada: false,
      regla: topesComerciales,
    };
    try {
      if (t.rollos > 0) {
        const caps = await capacidades(shop, t.id);
        base.capacidades = caps;
        base.agotada = !hayMaterial(caps);
        base.regla = topesDe(caps);
      }
    } catch (e) {
      // El stock nunca debe tumbar el precio: la trama se sirve sin control.
      console.error(`[api.precio] Error calculando capacidades de la trama ${t.nombre} (se ignora):`, e);
      delete base.capacidades;
    }
    tramas.push(base);
  }
  console.log("[api.precio] tramas:", JSON.stringify(tramas.map((t) => ({
    nombre: t.nombre, precioPorM2: t.precioPorM2, agotada: t.agotada,
    caps: t.capacidades, topes: [t.regla.maxAncho, t.regla.maxAlto],
  }))));

  // ── @deprecated — `capacidades` y `regla` de nivel superior ────────────────
  // Mezclan el stock de todas las tramas del producto, que es justo lo que el
  // §4.4 vino a arreglar. Se mantienen porque el snippet que HOY está pegado en
  // el tema los consume, y quitarlos de golpe dejaría la tienda sin bloquear
  // ninguna medida. Se borran cuando el paste del snippet nuevo esté confirmado.
  let capacidadesResp: Capacidad[] | undefined;
  let topes = topesComerciales;
  try {
    const capsRegla = await capacidadesDeRegla(shop, regla.id);
    if (capsRegla.length) {
      capacidadesResp = capsRegla;
      topes = topesDe(capsRegla);
    }
  } catch (e) {
    console.error("[api.precio] Error calculando capacidades de la regla (se ignora):", e);
    capacidadesResp = undefined;
  }

  return new Response(
    JSON.stringify({
      precio,
      waterproofPrecio,
      waterproofActivo: regla.waterproofActivo,
      // Precio por m² de la regla. El widget nuevo usa el de la trama elegida;
      // esto queda como fallback y para el snippet viejo.
      precioPorM2: regla.precioPorM2,
      waterproofPorM2: regla.waterproofPorM2,
      regla: topes,
      reglaId: regla.id,
      ...(capacidadesResp !== undefined ? { capacidades: capacidadesResp } : {}),
      bordes,
      tramas,
      textosImp,
    }),
    { status: 200, headers: corsHeaders },
  );
};

