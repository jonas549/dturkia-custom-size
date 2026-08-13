/**
 * Motor de selección y reserva de pliegos — Fase 2
 * Ver BITACORA_STOCK_PLIEGOS_2026-08-12.md §5
 *
 * Reglas del dominio que este módulo implementa:
 *  - Una alfombra sale SIEMPRE de un solo pliego. No se parchan pliegos.
 *  - El ancho manda: solo cabe si anchoPliego >= anchoRequerido.
 *  - Rotación SÍ (decisión 1): se evalúan las dos orientaciones y compiten.
 *  - Margen de corte 0 (decisión 2): se descuenta el largo exacto.
 *  - El stock NO se resta, se OCUPA (§3.1). Una reserva 'pendiente' de más de
 *    15 min deja de ocupar sola: es una condición de tiempo en el WHERE.
 *
 * Este módulo NO toca precios. El stock solo permite o bloquea.
 */

import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";

/** Minutos que una reserva 'pendiente' ocupa stock antes de expirar (decisión 4). */
export const RESERVA_TTL_MIN = 15;

/**
 * Bandera de despliegue (env var `PLIEGOS_MODO` en Vercel):
 *  - `off`     — el control de stock no hace absolutamente nada. **Default.**
 *  - `log`     — reserva y registra, pero NUNCA bloquea una venta por falta de
 *                stock. Es el modo con el que se despliega la Fase 4.
 *  - `bloqueo` — si no hay pliego que sirva, la venta se rechaza con 409.
 *
 * El default es `off` a propósito: si alguien despliega sin configurar la
 * variable, el comportamiento es exactamente el de antes de este módulo.
 */
export type ModoPliegos = "off" | "log" | "bloqueo";

export function modoPliegos(): ModoPliegos {
  const v = String(process.env.PLIEGOS_MODO ?? "off").trim().toLowerCase();
  return v === "log" || v === "bloqueo" ? v : "off";
}

const db = () => neon(process.env.DIRECT_URL ?? process.env.DATABASE_URL!);

const log = (...args: unknown[]) => console.log("[PLIEGOS]", ...args);

// ── Tipos ───────────────────────────────────────────────────────────────────

export type Capacidad = { anchoCm: number; largoMaxCm: number };

export type ItemReserva = {
  /** id del item de localStorage. Es la clave de idempotencia. */
  refId: string;
  anchoCm: number;
  altoCm: number;
};

export type ReservaAsignada = {
  refId: string;
  reservaId: string;
  pliegoId: string;
  pliegoCodigo: string;
  anchoPliegoCm: number;
  /** Lo que consume del pliego (el lado que NO va a lo ancho del rollo). */
  largoCm: number;
  rotada: boolean;
  /** Ancho de rollo desperdiciado. Es merma, no se reutiliza. */
  mermaCm: number;
  /** true = el refId ya estaba reservado; se devolvió la reserva existente. */
  yaExistia: boolean;
};

export type ResultadoReserva =
  | { ok: true; reservas: ReservaAsignada[] }
  | {
      ok: false;
      motivo: "SIN_STOCK";
      /** El item que no cupo. */
      refId: string;
      anchoCm: number;
      altoCm: number;
      /** Reservas que se hicieron antes del fallo y ya fueron anuladas. */
      anuladas: string[];
      capacidades: Capacidad[];
    };

export type PliegoEstado = {
  id: string;
  codigo: string;
  anchoCm: number;
  largoTotalCm: number;
  largoRestanteCm: number;
  /** largoRestante − reservas pendientes vigentes. Es lo que ve el selector. */
  disponibleCm: number;
  activo: boolean;
  reservasVigentes: number;
};

// ── 1. capacidades() ────────────────────────────────────────────────────────

/**
 * Capacidad física por ancho de rollo. Es lo que la Fase 5 expondrá en
 * /api/precio para que el snippet valide el PAR (ancho, largo) — ver §2.3.
 *
 * Usa la MISMA fórmula de disponibilidad que el selector (descuenta reservas
 * vigentes). Si usara `largoRestanteCm` a secas, el widget podría decir
 * "cabe" y el checkout responder "sin stock" para la misma medida.
 *
 * ⚠️ Devuelve capacidad FÍSICA pura. El tope comercial (maxAncho/maxAlto de la
 * regla) NO se aplica aquí: el híbrido `min(tope comercial, tope físico)` del
 * §2.4 se resuelve en /api/precio (Fase 5). Así el motor sigue siendo
 * verificable aunque una regla tenga topes mal configurados.
 */
export async function capacidades(shop: string, reglaId: string): Promise<Capacidad[]> {
  const sql = db();
  const filas = await sql`
    SELECT p."anchoCm",
           MAX(p."largoRestanteCm" - COALESCE((
             SELECT SUM(r."largoCm") FROM "ReservaPliego" r
             WHERE r."pliegoId" = p.id
               AND r.estado = 'pendiente'
               AND r."createdAt" > NOW() - make_interval(mins => ${RESERVA_TTL_MIN}::int)
           ), 0)) AS "largoMaxCm"
    FROM "Pliego" p
    WHERE p.shop = ${shop} AND p."reglaId" = ${reglaId} AND p.activo
    GROUP BY p."anchoCm"
    HAVING MAX(p."largoRestanteCm" - COALESCE((
             SELECT SUM(r."largoCm") FROM "ReservaPliego" r
             WHERE r."pliegoId" = p.id
               AND r.estado = 'pendiente'
               AND r."createdAt" > NOW() - make_interval(mins => ${RESERVA_TTL_MIN}::int)
           ), 0)) > 0
    ORDER BY p."anchoCm"
  `;
  return filas.map((f: any) => ({
    anchoCm: Number(f.anchoCm),
    largoMaxCm: Number(f.largoMaxCm),
  }));
}

/**
 * ¿Cabe (ancho × alto) en alguna capacidad, en alguna de las dos orientaciones?
 * Función pura — se replicará en JS en el snippet (Fase 6).
 */
export function factible(anchoCm: number, altoCm: number, caps: Capacidad[]): boolean {
  return caps.some(
    (c) =>
      (c.anchoCm >= anchoCm && c.largoMaxCm >= altoCm) ||
      (c.anchoCm >= altoCm && c.largoMaxCm >= anchoCm),
  );
}

// ── 2. reservar() ───────────────────────────────────────────────────────────

/**
 * LA SENTENCIA ATÓMICA (§5.4). Selección + reserva en una sola sentencia: no
 * hay read-then-write, así que no hay carrera posible con el driver HTTP de
 * Neon (cada sentencia es su propia transacción).
 *
 * ⚠️ CORRECCIÓN respecto al §5.4 de la bitácora, validada empíricamente:
 * el filtro de largo (`disponible >= largo`) va DENTRO del WHERE del CTE,
 * ANTES del ORDER BY/LIMIT. En la bitácora estaba en el WHERE de fuera, es
 * decir DESPUÉS del `LIMIT 1`: si el pliego de ancho más cercano se había
 * quedado sin largo, la consulta devolvía 0 filas (= SIN_STOCK) en vez de
 * pasar al siguiente candidato. Reproducido: con los 4 rollos de 300 agotados,
 * un pedido 250×350 devolvía SIN_STOCK teniendo 20 m libres en los rollos
 * de 400. Con el filtro dentro, elige CEN-400 rotada.
 *
 * `FOR UPDATE OF p SKIP LOCKED` — validado en Fase 2: Postgres lo acepta
 * dentro del CTE pese al CROSS JOIN sobre VALUES y a la subconsulta agregada
 * (la restricción de agregados aplica al nivel superior, no a subconsultas).
 * Bloquea solo filas de "Pliego" y serializa dos compras simultáneas del mismo
 * rollo sin esperas: la segunda salta al siguiente candidato.
 */
async function reservarItem(
  shop: string,
  reglaId: string,
  item: ItemReserva,
): Promise<ReservaAsignada | null> {
  const sql = db();
  const { refId, anchoCm, altoCm } = item;

  const filas = await sql`
    WITH cand AS (
      SELECT p.id AS "pliegoId",
             o."anchoReq",
             o.largo,
             o.rotada,
             p."largoRestanteCm" - COALESCE((
               SELECT SUM(r."largoCm") FROM "ReservaPliego" r
               WHERE r."pliegoId" = p.id
                 AND r.estado = 'pendiente'
                 AND r."createdAt" > NOW() - make_interval(mins => ${RESERVA_TTL_MIN}::int)
             ), 0) AS disponible
      FROM "Pliego" p
      CROSS JOIN (VALUES (${anchoCm}::int, ${altoCm}::int, false),   -- orientación normal
                         (${altoCm}::int, ${anchoCm}::int, true))    -- orientación rotada
                 AS o("anchoReq", largo, rotada)
      WHERE p.shop = ${shop}
        AND p."reglaId" = ${reglaId}
        AND p.activo
        AND p."anchoCm" >= o."anchoReq"
        AND p."largoRestanteCm" - COALESCE((
              SELECT SUM(r2."largoCm") FROM "ReservaPliego" r2
              WHERE r2."pliegoId" = p.id
                AND r2.estado = 'pendiente'
                AND r2."createdAt" > NOW() - make_interval(mins => ${RESERVA_TTL_MIN}::int)
            ), 0) >= o.largo
      ORDER BY (p."anchoCm" - o."anchoReq") ASC,  -- 1. ancho más cercano
               p."anchoCm" ASC,                    -- 2. a igual merma, el rollo más angosto
               disponible ASC,                     -- 3. el rollo más gastado primero
               p.codigo ASC,                       -- 4. determinista y legible en QA
               p.id ASC
      LIMIT 1
      FOR UPDATE OF p SKIP LOCKED
    ),
    ins AS (
      INSERT INTO "ReservaPliego"
        ("id", "shop", "pliegoId", "reglaId", "refId", "largoCm",
         "anchoPedidoCm", "altoPedidoCm", "rotada", "estado", "createdAt")
      SELECT gen_random_uuid()::text, ${shop}, c."pliegoId", ${reglaId}, ${refId},
             c.largo, ${anchoCm}::int, ${altoCm}::int, c.rotada, 'pendiente', NOW()
      FROM cand c
      ON CONFLICT ("refId") DO NOTHING
      RETURNING "id", "pliegoId", "largoCm", "rotada"
    )
    SELECT i."id", i."pliegoId", i."largoCm", i."rotada",
           p.codigo, p."anchoCm"
    FROM ins i JOIN "Pliego" p ON p.id = i."pliegoId"
  `;

  if (filas.length) {
    const f: any = filas[0];
    const rotada = Boolean(f.rotada);
    return {
      refId,
      reservaId: String(f.id),
      pliegoId: String(f.pliegoId),
      pliegoCodigo: String(f.codigo),
      anchoPliegoCm: Number(f.anchoCm),
      largoCm: Number(f.largoCm),
      rotada,
      mermaCm: Number(f.anchoCm) - (rotada ? altoCm : anchoCm),
      yaExistia: false,
    };
  }

  // 0 filas = no cupo, O el refId ya estaba reservado (idempotencia).
  // Distinguir los dos casos es lo que hace que un doble clic o un retry de red
  // devuelvan la misma asignación en vez de un falso "sin stock".
  const existente = await sql`
    SELECT r."id", r."pliegoId", r."largoCm", r."rotada", r."anchoPedidoCm", r."altoPedidoCm",
           p.codigo, p."anchoCm"
    FROM "ReservaPliego" r JOIN "Pliego" p ON p.id = r."pliegoId"
    WHERE r."refId" = ${refId} AND r.shop = ${shop} AND r.estado = 'pendiente'
    LIMIT 1
  `;
  if (existente.length) {
    const f: any = existente[0];
    const rotada = Boolean(f.rotada);
    return {
      refId,
      reservaId: String(f.id),
      pliegoId: String(f.pliegoId),
      pliegoCodigo: String(f.codigo),
      anchoPliegoCm: Number(f.anchoCm),
      largoCm: Number(f.largoCm),
      rotada,
      mermaCm: Number(f.anchoCm) - (rotada ? Number(f.altoPedidoCm) : Number(f.anchoPedidoCm)),
      yaExistia: true,
    };
  }

  return null;
}

/**
 * Reserva stock para una lista de items. TODO O NADA: si un item no cabe, se
 * anulan las reservas ya hechas en esta misma llamada y se devuelve SIN_STOCK.
 * Es el paso 2 del flujo del §5.5 — ocurre ANTES de crear el Draft Order, para
 * que nunca exista una orden sin su pliego asignado.
 *
 * Multi-item: bucle secuencial, una sentencia por item. El segundo item ya ve
 * el largo ocupado por el primero, así que dos piezas que compiten por el mismo
 * rollo se resuelven solas.
 */
export async function reservar(
  shop: string,
  reglaId: string,
  items: ItemReserva[],
): Promise<ResultadoReserva> {
  const hechas: ReservaAsignada[] = [];

  for (const item of items) {
    log(`reserva refId=${item.refId} regla=${reglaId} pedido=${item.anchoCm}x${item.altoCm}`);
    log(
      `  candidatos: normal(req>=${item.anchoCm},cons=${item.altoCm})`,
      `rotada(req>=${item.altoCm},cons=${item.anchoCm})`,
    );

    const asignada = await reservarItem(shop, reglaId, item);

    if (!asignada) {
      const caps = await capacidades(shop, reglaId);
      log(
        `  SIN_STOCK pedido=${item.anchoCm}x${item.altoCm}`,
        `capacidades=${JSON.stringify(caps)}`,
      );
      const anuladas = hechas.map((r) => r.refId);
      if (anuladas.length) {
        await anular(shop, anuladas);
        log(`  compensación: ${anuladas.length} reserva(s) previa(s) anulada(s)`);
      }
      return {
        ok: false,
        motivo: "SIN_STOCK",
        refId: item.refId,
        anchoCm: item.anchoCm,
        altoCm: item.altoCm,
        anuladas,
        capacidades: caps,
      };
    }

    log(
      `  elegido ${asignada.pliegoCodigo} ancho=${asignada.anchoPliegoCm}`,
      `rotada=${asignada.rotada} consume=${asignada.largoCm} merma=${asignada.mermaCm}`,
      asignada.yaExistia ? "(ya existía — idempotencia)" : "",
    );
    hechas.push(asignada);
  }

  return { ok: true, reservas: hechas };
}

// ── Compensación y ciclo de vida ────────────────────────────────────────────

/** Compensación del §5.4: no revierte restas, solo marca. */
export async function anular(shop: string, refIds: string[]): Promise<number> {
  if (!refIds.length) return 0;
  const sql = db();
  const filas = await sql`
    UPDATE "ReservaPliego"
    SET estado = 'anulada', "resueltaAt" = NOW()
    WHERE shop = ${shop} AND "refId" = ANY(${refIds}) AND estado = 'pendiente'
    RETURNING "id"
  `;
  if (filas.length) log(`anuladas ${filas.length} reserva(s):`, refIds.join(", "));
  return filas.length;
}

/** Borra reservas por completo. Solo para la ruta de diagnóstico (dry-run). */
export async function eliminarReservas(shop: string, refIds: string[]): Promise<number> {
  if (!refIds.length) return 0;
  const sql = db();
  const filas = await sql`
    DELETE FROM "ReservaPliego"
    WHERE shop = ${shop} AND "refId" = ANY(${refIds})
    RETURNING "id"
  `;
  return filas.length;
}

/** Paso 4 del §5.5: deja la reserva cruzada con su Draft Order. Lo usará la Fase 4. */
export async function vincularDraftOrder(
  shop: string,
  refIds: string[],
  draftOrderId: string,
): Promise<number> {
  if (!refIds.length) return 0;
  const sql = db();
  const filas = await sql`
    UPDATE "ReservaPliego"
    SET "draftOrderId" = ${draftOrderId}
    WHERE shop = ${shop} AND "refId" = ANY(${refIds}) AND estado = 'pendiente'
    RETURNING "id"
  `;
  return filas.length;
}

/**
 * Pasa reservas de "ocupa 15 min" a "ocupa para siempre": estado='confirmada'
 * y AHÍ SÍ baja `Pliego.largoRestanteCm`.
 *
 * Idempotente por el `AND estado = 'pendiente'`: llamarlo dos veces con el
 * mismo draft order no descuenta dos veces. Todo en una sentencia para que el
 * UPDATE de Pliego no pueda quedar huérfano del cambio de estado.
 */
async function confirmarReservas(shop: string, ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const sql = db();
  const filas = await sql`
    WITH upd AS (
      UPDATE "ReservaPliego"
      SET estado = 'confirmada', "resueltaAt" = NOW()
      WHERE shop = ${shop} AND "id" = ANY(${ids}) AND estado = 'pendiente'
      RETURNING "pliegoId", "largoCm"
    ),
    agrupado AS (
      SELECT "pliegoId", SUM("largoCm")::int AS total FROM upd GROUP BY "pliegoId"
    )
    UPDATE "Pliego" p
    SET "largoRestanteCm" = p."largoRestanteCm" - a.total
    FROM agrupado a
    WHERE p.id = a."pliegoId"
    RETURNING p.codigo, p."largoRestanteCm"
  `;
  for (const f of filas as any[]) {
    log(`  confirmado: ${f.codigo} largoRestante → ${f.largoRestanteCm}`);
  }
  return filas.length;
}

/** Lo llamará /api/check-paid en la Fase 4, al detectar el draft order pagado. */
export async function confirmarPorDraftOrder(
  shop: string,
  draftOrderId: string,
): Promise<number> {
  const sql = db();
  const pendientes = await sql`
    SELECT "id" FROM "ReservaPliego"
    WHERE shop = ${shop} AND "draftOrderId" = ${draftOrderId} AND estado = 'pendiente'
  `;
  if (!pendientes.length) return 0;
  log(`confirmando ${pendientes.length} reserva(s) del draft ${draftOrderId}`);
  return confirmarReservas(shop, pendientes.map((r: any) => String(r.id)));
}

// ── 3. reconciliar() ────────────────────────────────────────────────────────

export type ResumenReconciliacion = {
  revisadas: number;
  confirmadas: number;
  anuladas: number;
  sinResolver: number;
};

async function accessToken(shop: string): Promise<string | null> {
  const sql = db();
  const filas = await sql`
    SELECT "accessToken" FROM "Session"
    WHERE id = ${"offline_" + shop} OR (shop = ${shop} AND "isOnline" = false)
    ORDER BY CASE WHEN id = ${"offline_" + shop} THEN 0 ELSE 1 END
    LIMIT 1
  `;
  return filas.length ? String((filas[0] as any).accessToken) : null;
}

/**
 * Resuelve contra Shopify las reservas VENCIDAS que siguen 'pendiente' (§3.2.2).
 *
 * Es el mecanismo que cierra el hueco del §7.2: el único que puede sobrevender
 * es el siguiente comprador, y es precisamente él quien dispara esto al inicio
 * de /api/checkout. Coste típico: 0 llamadas a Shopify; 1-2 en el peor caso.
 *
 *  - draft order completed  → confirmada (y baja largoRestanteCm)
 *  - draft order inexistente (404) o reserva sin draftOrderId → anulada
 *  - cualquier otro estado  → se deja 'pendiente' (ya no ocupa por vencida, y
 *    así un pago tardío todavía puede confirmarse en una pasada posterior)
 */
export async function reconciliar(shop: string, reglaId: string): Promise<ResumenReconciliacion> {
  const sql = db();

  const vencidas = await sql`
    SELECT "id", "refId", "draftOrderId"
    FROM "ReservaPliego"
    WHERE shop = ${shop}
      AND "reglaId" = ${reglaId}
      AND estado = 'pendiente'
      AND "createdAt" <= NOW() - make_interval(mins => ${RESERVA_TTL_MIN}::int)
    LIMIT 50
  `;

  const resumen: ResumenReconciliacion = {
    revisadas: vencidas.length,
    confirmadas: 0,
    anuladas: 0,
    sinResolver: 0,
  };
  if (!vencidas.length) return resumen;

  log(`reconciliación regla=${reglaId}: ${vencidas.length} vencida(s) sin resolver`);

  // Sin draftOrderId nunca podrán confirmarse: la creación del Draft Order
  // falló o fue una reserva de diagnóstico. Se anulan directamente.
  const huerfanas = vencidas.filter((r: any) => !r.draftOrderId);
  if (huerfanas.length) {
    resumen.anuladas += await anular(shop, huerfanas.map((r: any) => String(r.refId)));
  }

  const conDraft = vencidas.filter((r: any) => r.draftOrderId);
  if (!conDraft.length) return resumen;

  const token = await accessToken(shop);
  if (!token) {
    log("  sin sesión offline — no se puede consultar Shopify, se dejan pendientes");
    resumen.sinResolver = conDraft.length;
    return resumen;
  }

  // Agrupar por draft order: varias reservas pueden compartir el mismo.
  const porDraft = new Map<string, string[]>();
  for (const r of conDraft as any[]) {
    const k = String(r.draftOrderId);
    porDraft.set(k, [...(porDraft.get(k) ?? []), String(r.id)]);
  }

  for (const [draftOrderId, ids] of porDraft) {
    try {
      const resp = await fetch(
        `https://${shop}/admin/api/2025-10/draft_orders/${draftOrderId}.json`,
        { headers: { "X-Shopify-Access-Token": token } },
      );

      if (resp.status === 404) {
        const refs = (conDraft as any[])
          .filter((r) => ids.includes(String(r.id)))
          .map((r) => String(r.refId));
        resumen.anuladas += await anular(shop, refs);
        log(`  draft ${draftOrderId} no existe (404) → anuladas`);
        continue;
      }

      if (!resp.ok) {
        resumen.sinResolver += ids.length;
        continue;
      }

      const data = (await resp.json()) as { draft_order?: { status?: string } };
      if (data.draft_order?.status === "completed") {
        const n = await confirmarReservas(shop, ids);
        resumen.confirmadas += n;
        log(`  draft ${draftOrderId} completed → ${n} reserva(s) confirmada(s)`);
      } else {
        resumen.sinResolver += ids.length;
        log(`  draft ${draftOrderId} estado=${data.draft_order?.status} → se deja pendiente`);
      }
    } catch (e) {
      resumen.sinResolver += ids.length;
      log(`  error consultando draft ${draftOrderId}:`, (e as Error).message);
    }
  }

  return resumen;
}

// ── Lectura de estado (diagnóstico y admin) ─────────────────────────────────

export type ReservaFila = {
  id: string;
  refId: string;
  pliegoCodigo: string;
  largoCm: number;
  anchoPedidoCm: number;
  altoPedidoCm: number;
  rotada: boolean;
  estado: string;
  draftOrderId: string | null;
  createdAt: string;
  resueltaAt: string | null;
  vencida: boolean;
};

export type CorteFila = {
  id: string;
  orderId: string;
  orderName: string;
  pliegoCodigo: string;
  anchoCm: number;
  altoCm: number;
  rotada: boolean;
  productTitle: string;
  estado: string;
  createdAt: string;
};

export type MovimientoFila = {
  id: string;
  pliegoCodigo: string;
  largoCm: number;
  motivo: string;
  nota: string;
  createdAt: string;
};

/** Estado de todos los pliegos de una trama, con la disponibilidad real. */
export async function estadoPliegos(shop: string, reglaId: string): Promise<PliegoEstado[]> {
  const sql = db();
  const filas = await sql`
    SELECT p.id, p.codigo, p."anchoCm", p."largoTotalCm", p."largoRestanteCm", p.activo,
           COALESCE((
             SELECT SUM(r."largoCm") FROM "ReservaPliego" r
             WHERE r."pliegoId" = p.id AND r.estado = 'pendiente'
               AND r."createdAt" > NOW() - make_interval(mins => ${RESERVA_TTL_MIN}::int)
           ), 0)::int AS "ocupadoCm",
           COALESCE((
             SELECT COUNT(*) FROM "ReservaPliego" r
             WHERE r."pliegoId" = p.id AND r.estado = 'pendiente'
               AND r."createdAt" > NOW() - make_interval(mins => ${RESERVA_TTL_MIN}::int)
           ), 0)::int AS "reservasVigentes"
    FROM "Pliego" p
    WHERE p.shop = ${shop} AND p."reglaId" = ${reglaId}
    ORDER BY p.codigo
  `;
  return filas.map((f: any) => ({
    id: String(f.id),
    codigo: String(f.codigo),
    anchoCm: Number(f.anchoCm),
    largoTotalCm: Number(f.largoTotalCm),
    largoRestanteCm: Number(f.largoRestanteCm),
    disponibleCm: Number(f.largoRestanteCm) - Number(f.ocupadoCm),
    activo: Boolean(f.activo),
    reservasVigentes: Number(f.reservasVigentes),
  }));
}

// ── Integración con el checkout (Fase 4) ────────────────────────────────────

/** ¿Esta trama tiene pliegos cargados? Si no, el control de stock NO la afecta. */
async function tienePliegos(shop: string, reglaId: string): Promise<boolean> {
  const sql = db();
  const filas = await sql`
    SELECT 1 FROM "Pliego"
    WHERE shop = ${shop} AND "reglaId" = ${reglaId} AND activo
    LIMIT 1
  `;
  return filas.length > 0;
}

/**
 * Resuelve la trama de cada item.
 *
 * Orden de preferencia:
 *  1. `item.reglaId` — lo mandará el tema a partir de la Fase 6.
 *  2. `item.variantId` → producto (1 llamada a Shopify para todas las variantes)
 *     → regla que lo tenga en `productIds`.
 *
 * El paso 2 existe porque en la Fase 4 el tema TODAVÍA no manda `reglaId`
 * (§2.2.2): sin él no habría nada que reservar y la fase no se podría validar
 * con compras reales. Además sigue siendo útil después, como red para los items
 * legacy que queden en el localStorage de clientes.
 */
async function resolverReglas(
  shop: string,
  items: ItemMedidaCheckout[],
  accessToken: string,
): Promise<Map<number, string>> {
  const resuelto = new Map<number, string>();

  const pendientes = items.filter((i) => {
    if (i.reglaId) {
      resuelto.set(i.indice, i.reglaId);
      return false;
    }
    return Boolean(i.variantId);
  });
  if (!pendientes.length) return resuelto;

  const gids = [...new Set(pendientes.map((i) =>
    `gid://shopify/ProductVariant/${String(i.variantId).replace("gid://shopify/ProductVariant/", "")}`,
  ))];

  let variantAProducto = new Map<string, string>();
  try {
    const resp = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
      method: "POST",
      headers: { "X-Shopify-Access-Token": accessToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `query($ids: [ID!]!) {
          nodes(ids: $ids) { ... on ProductVariant { id product { id } } }
        }`,
        variables: { ids: gids },
      }),
    });
    const data = (await resp.json()) as {
      data?: { nodes?: Array<{ id?: string; product?: { id?: string } } | null> };
    };
    for (const n of data.data?.nodes ?? []) {
      if (n?.id && n.product?.id) variantAProducto.set(n.id, n.product.id);
    }
  } catch (e) {
    log("no se pudo resolver variante → producto:", (e as Error).message);
    return resuelto;
  }

  const sql = db();
  const reglas = await sql`
    SELECT id, "productIds" FROM "ReglaPersonalizada"
    WHERE shop = ${shop} AND activa = true
  `;

  for (const item of pendientes) {
    const gid = `gid://shopify/ProductVariant/${String(item.variantId).replace("gid://shopify/ProductVariant/", "")}`;
    const productoGid = variantAProducto.get(gid);
    if (!productoGid) continue;
    const numerico = productoGid.replace("gid://shopify/Product/", "");
    const regla = (reglas as any[]).find((r) =>
      (r.productIds as string[]).some((p) => p === productoGid || p === numerico),
    );
    if (regla) resuelto.set(item.indice, String(regla.id));
  }

  return resuelto;
}

export type ItemMedidaCheckout = {
  /** Índice del item en el array original del endpoint. */
  indice: number;
  /** id del item de localStorage. Lo mandará el tema en la Fase 7. */
  refId: string | null;
  reglaId: string | null;
  variantId: string | number | null;
  anchoCm: number;
  altoCm: number;
};

export type AsignacionCheckout = { indice: number; reserva: ReservaAsignada };

export type ResultadoCheckoutPliegos = {
  modo: ModoPliegos;
  /** true → el endpoint debe abortar con 409 y NO crear el Draft Order. */
  bloquear: boolean;
  error: string | null;
  asignaciones: AsignacionCheckout[];
  /** refIds de todo lo reservado, para vincular al draft o compensar. */
  refIds: string[];
};

/**
 * Pasos 1 y 2 del flujo del §5.5, compartidos por los DOS endpoints de checkout
 * (el carrito mixto rutea al de impermeabilizador — §2.2.1).
 *
 * Se llama ANTES de crear el Draft Order: así nunca existe una orden sin su
 * pliego asignado. Si el draft falla después, el endpoint compensa con
 * `anular(refIds)`.
 *
 * En modo `log` nunca devuelve `bloquear: true`: registra el SIN_STOCK y deja
 * pasar la venta. Es lo que permite validar la fase con pedidos reales sin
 * ningún riesgo comercial.
 */
export async function procesarCheckoutPliegos(
  shop: string,
  items: ItemMedidaCheckout[],
  accessToken: string,
): Promise<ResultadoCheckoutPliegos> {
  const modo = modoPliegos();
  const vacio: ResultadoCheckoutPliegos = {
    modo, bloquear: false, error: null, asignaciones: [], refIds: [],
  };

  if (modo === "off") return vacio;
  log(`MODO=${modo}`);
  if (!items.length) return vacio;

  const reglas = await resolverReglas(shop, items, accessToken);

  // Agrupar por trama: la reconciliación y la reserva son por trama.
  const porRegla = new Map<string, ItemMedidaCheckout[]>();
  for (const item of items) {
    const reglaId = reglas.get(item.indice);
    if (!reglaId) {
      log(`item legacy sin reglaId (indice=${item.indice}, ${item.anchoCm}x${item.altoCm}) — sin reserva`);
      continue;
    }
    porRegla.set(reglaId, [...(porRegla.get(reglaId) ?? []), item]);
  }
  if (!porRegla.size) return vacio;

  const asignaciones: AsignacionCheckout[] = [];
  const refIds: string[] = [];

  for (const [reglaId, grupo] of porRegla) {
    if (!(await tienePliegos(shop, reglaId))) {
      log(`trama ${reglaId} sin pliegos cargados — sin control de stock`);
      continue;
    }

    // §3.2.2 — el único que puede sobrevender es el siguiente comprador, y es
    // precisamente él quien dispara la reconciliación.
    const rec = await reconciliar(shop, reglaId);
    if (rec.revisadas) {
      log(`reconciliación regla=${reglaId}: ${rec.confirmadas} confirmadas, ${rec.anuladas} anuladas, ${rec.sinResolver} sin resolver`);
    }

    const paraReservar: ItemReserva[] = grupo.map((i) => {
      // Sin `item.id` del tema (llega en la Fase 7) la idempotencia queda
      // degradada: un doble clic crearía dos reservas. Se registra para que
      // se vea en los logs mientras dure la ventana.
      const refId = i.refId ?? `auto_${randomUUID()}`;
      if (!i.refId) log(`  item sin id de localStorage — refId generado ${refId} (idempotencia degradada hasta la Fase 7)`);
      return { refId, anchoCm: i.anchoCm, altoCm: i.altoCm };
    });

    const res = await reservar(shop, reglaId, paraReservar);

    if (res.ok) {
      res.reservas.forEach((reserva, k) => {
        asignaciones.push({ indice: grupo[k].indice, reserva });
        refIds.push(reserva.refId);
      });
      continue;
    }

    // SIN_STOCK
    if (modo === "log") {
      log(`SIN_STOCK (MODO=log, la venta NO se bloqueó) pedido=${res.anchoCm}x${res.altoCm} regla=${reglaId}`);
      continue;
    }

    // modo === 'bloqueo': compensar TODO lo reservado en esta petición.
    log(`SIN_STOCK (MODO=bloqueo, se rechaza la venta) pedido=${res.anchoCm}x${res.altoCm} regla=${reglaId}`);
    if (refIds.length) await anular(shop, refIds);
    return {
      modo,
      bloquear: true,
      error: `No tenemos material suficiente para una alfombra de ${res.anchoCm} × ${res.altoCm} cm. Prueba con otra medida.`,
      asignaciones: [],
      refIds: [],
    };
  }

  log(`reservas OK: ${asignaciones.length}/${items.length} item(s) con pliego asignado`);
  return { modo, bloquear: false, error: null, asignaciones, refIds };
}

// ── Administración (Fase 3) ─────────────────────────────────────────────────

/**
 * Prefijo de código a partir del nombre de la trama: "Alfombra Ceniza" → "ALF".
 * Solo se usa como valor por defecto; el admin puede sobrescribirlo.
 */
export function prefijoSugerido(nombre: string): string {
  // NFD separa la tilde en un carácter combinante propio; nos quedamos solo
  // con las letras ASCII, así "Ceniza Añil" → "CEN".
  const limpio = nombre
    .normalize("NFD")
    .split("")
    .filter((c) => /[a-zA-Z]/.test(c))
    .join("")
    .toUpperCase();
  return (limpio.slice(0, 3) || "PLG").padEnd(3, "X");
}

export type ResultadoAlta = { creados: string[]; omitidos: number };

/**
 * Alta masiva: `ancho | largo | cantidad` → N filas con código autogenerado.
 * Es el formato real en que llega el inventario del cliente (§2.5).
 *
 * El correlativo arranca después del mayor ya existente para ese prefijo+ancho,
 * y el `ON CONFLICT DO NOTHING` cubre la carrera improbable de dos altas
 * simultáneas: se crean menos filas de las pedidas y se informa cuántas.
 */
export async function altaMasiva(
  shop: string,
  reglaId: string,
  params: { prefijo: string; anchoCm: number; largoCm: number; cantidad: number; nota: string },
): Promise<ResultadoAlta> {
  const { prefijo, anchoCm, largoCm, cantidad, nota } = params;
  const sql = db();

  const creados = await sql`
    WITH base AS (
      SELECT COALESCE(MAX(SUBSTRING(codigo FROM '([0-9]+)$')::int), 0) AS ultimo
      FROM "Pliego"
      WHERE shop = ${shop}
        AND "reglaId" = ${reglaId}
        AND codigo LIKE ${prefijo + "-" + anchoCm + "-"} || '%'
    )
    INSERT INTO "Pliego"
      ("id", "shop", "reglaId", "codigo", "anchoCm", "largoTotalCm", "largoRestanteCm",
       "activo", "nota", "createdAt")
    SELECT gen_random_uuid()::text, ${shop}, ${reglaId},
           ${prefijo + "-" + anchoCm + "-"} || LPAD((base.ultimo + g)::text, 2, '0'),
           ${anchoCm}::int, ${largoCm}::int, ${largoCm}::int, true, ${nota}, NOW()
    FROM base, generate_series(1, ${cantidad}::int) AS g
    ON CONFLICT ("shop", "codigo") DO NOTHING
    RETURNING "codigo"
  `;

  // Auditoría: un movimiento 'alta' por rollo, con el largo con que entró.
  if (creados.length) {
    await sql`
      INSERT INTO "MovimientoPliego" ("id", "shop", "pliegoId", "largoCm", "motivo", "nota", "createdAt")
      SELECT gen_random_uuid()::text, ${shop}, p.id, p."largoTotalCm", 'alta',
             ${nota || "Alta masiva desde el admin"}, NOW()
      FROM "Pliego" p
      WHERE p.shop = ${shop}
        AND p."reglaId" = ${reglaId}
        AND p.codigo = ANY(${creados.map((c: any) => String(c.codigo))})
    `;
  }

  log(`alta masiva regla=${reglaId}: ${creados.length}/${cantidad} rollos ${anchoCm}x${largoCm}`);
  return {
    creados: creados.map((c: any) => String(c.codigo)),
    omitidos: cantidad - creados.length,
  };
}

/**
 * Ajuste manual del largo restante. Es la mitigación del riesgo §7.3: cortes por
 * WhatsApp, ventas en local y mermas no pasan por la app y desincronizan el stock.
 * La nota es obligatoria y queda en `MovimientoPliego` con el delta aplicado.
 */
export async function ajustarPliego(
  shop: string,
  pliegoId: string,
  nuevoLargoRestanteCm: number,
  nota: string,
): Promise<{ ok: true; delta: number; codigo: string } | { ok: false; error: string }> {
  const sql = db();

  const filas = await sql`
    SELECT "codigo", "largoTotalCm", "largoRestanteCm"
    FROM "Pliego" WHERE id = ${pliegoId} AND shop = ${shop} LIMIT 1
  `;
  if (!filas.length) return { ok: false, error: "El pliego no existe." };

  const p: any = filas[0];
  if (nuevoLargoRestanteCm < 0) return { ok: false, error: "El largo restante no puede ser negativo." };
  if (nuevoLargoRestanteCm > Number(p.largoTotalCm)) {
    return {
      ok: false,
      error: `El largo restante no puede superar el largo total (${p.largoTotalCm} cm). Si entró material nuevo, da de alta otro rollo.`,
    };
  }

  const delta = nuevoLargoRestanteCm - Number(p.largoRestanteCm);
  if (delta === 0) return { ok: false, error: "El valor es el mismo que ya tenía." };

  await sql`
    UPDATE "Pliego" SET "largoRestanteCm" = ${nuevoLargoRestanteCm}::int
    WHERE id = ${pliegoId} AND shop = ${shop}
  `;
  await sql`
    INSERT INTO "MovimientoPliego" ("id", "shop", "pliegoId", "largoCm", "motivo", "nota", "createdAt")
    VALUES (gen_random_uuid()::text, ${shop}, ${pliegoId}, ${delta}::int, 'ajuste', ${nota}, NOW())
  `;

  log(`ajuste ${p.codigo}: ${p.largoRestanteCm} → ${nuevoLargoRestanteCm} (${delta >= 0 ? "+" : ""}${delta}) — ${nota}`);
  return { ok: true, delta, codigo: String(p.codigo) };
}

/**
 * Baja o reactivación. NUNCA se borra un pliego (§4.3): un DELETE rompería la
 * trazabilidad histórica, y además las FK `RESTRICT` de reservas y movimientos
 * lo impiden a nivel de base.
 *
 * `motivo` usa 'baja' | 'reactivacion'. 'reactivacion' es una extensión del set
 * documentado en el §4.1 ('alta' | 'ajuste' | 'baja'); el campo es texto libre.
 * `largoCm = 0` porque un cambio de estado no mueve el largo.
 */
export async function cambiarActivo(
  shop: string,
  pliegoId: string,
  activo: boolean,
  nota: string,
): Promise<boolean> {
  const sql = db();
  const filas = await sql`
    UPDATE "Pliego" SET activo = ${activo}
    WHERE id = ${pliegoId} AND shop = ${shop}
    RETURNING "codigo"
  `;
  if (!filas.length) return false;

  await sql`
    INSERT INTO "MovimientoPliego" ("id", "shop", "pliegoId", "largoCm", "motivo", "nota", "createdAt")
    VALUES (gen_random_uuid()::text, ${shop}, ${pliegoId}, 0,
            ${activo ? "reactivacion" : "baja"}, ${nota}, NOW())
  `;
  log(`${activo ? "reactivado" : "dado de baja"} ${(filas[0] as any).codigo} — ${nota}`);
  return true;
}

/** Reservas de una trama: vigentes primero, luego vencidas sin resolver. */
export async function reservasDeTrama(shop: string, reglaId: string): Promise<ReservaFila[]> {
  const sql = db();
  const filas = await sql`
    SELECT r."id", r."refId", r."largoCm", r."anchoPedidoCm", r."altoPedidoCm",
           r."rotada", r."estado", r."draftOrderId", r."createdAt", r."resueltaAt",
           p."codigo",
           (r.estado = 'pendiente'
            AND r."createdAt" <= NOW() - make_interval(mins => ${RESERVA_TTL_MIN}::int)) AS vencida
    FROM "ReservaPliego" r
    JOIN "Pliego" p ON p.id = r."pliegoId"
    WHERE r.shop = ${shop} AND r."reglaId" = ${reglaId}
    ORDER BY r."createdAt" DESC
    LIMIT 200
  `;
  return filas.map((f: any) => ({
    id: String(f.id),
    refId: String(f.refId),
    pliegoCodigo: String(f.codigo),
    largoCm: Number(f.largoCm),
    anchoPedidoCm: Number(f.anchoPedidoCm),
    altoPedidoCm: Number(f.altoPedidoCm),
    rotada: Boolean(f.rotada),
    estado: String(f.estado),
    draftOrderId: f.draftOrderId ? String(f.draftOrderId) : null,
    createdAt: new Date(f.createdAt).toISOString(),
    resueltaAt: f.resueltaAt ? new Date(f.resueltaAt).toISOString() : null,
    vencida: Boolean(f.vencida),
  }));
}

/**
 * LA PANTALLA DEL TALLER (decisión 5). Como el código de pliego no viaja en la
 * orden de Shopify, éste es el único sitio donde se cruza orden ↔ pliego.
 */
export async function cortesDeTrama(shop: string, reglaId: string): Promise<CorteFila[]> {
  const sql = db();
  const filas = await sql`
    SELECT pc."id", pc."orderId", pc."orderName", pc."pliegoCodigo",
           pc."ancho", pc."alto", pc."rotada", pc."productTitle", pc."estado", pc."createdAt"
    FROM "PedidoCustom" pc
    JOIN "Pliego" p ON p.id = pc."pliegoId"
    WHERE pc.shop = ${shop} AND p."reglaId" = ${reglaId}
    ORDER BY pc."createdAt" DESC
    LIMIT 200
  `;
  return filas.map((f: any) => ({
    id: String(f.id),
    orderId: String(f.orderId),
    orderName: String(f.orderName ?? ""),
    pliegoCodigo: String(f.pliegoCodigo ?? ""),
    anchoCm: Number(f.ancho),
    altoCm: Number(f.alto),
    rotada: Boolean(f.rotada),
    productTitle: String(f.productTitle ?? ""),
    estado: String(f.estado),
    createdAt: new Date(f.createdAt).toISOString(),
  }));
}

/** Historial de altas y ajustes de una trama. */
export async function movimientosDeTrama(shop: string, reglaId: string): Promise<MovimientoFila[]> {
  const sql = db();
  const filas = await sql`
    SELECT m."id", m."largoCm", m."motivo", m."nota", m."createdAt", p."codigo"
    FROM "MovimientoPliego" m
    JOIN "Pliego" p ON p.id = m."pliegoId"
    WHERE m.shop = ${shop} AND p."reglaId" = ${reglaId}
    ORDER BY m."createdAt" DESC
    LIMIT 100
  `;
  return filas.map((f: any) => ({
    id: String(f.id),
    pliegoCodigo: String(f.codigo),
    largoCm: Number(f.largoCm),
    motivo: String(f.motivo),
    nota: String(f.nota ?? ""),
    createdAt: new Date(f.createdAt).toISOString(),
  }));
}
