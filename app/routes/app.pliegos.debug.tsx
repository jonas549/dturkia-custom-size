/**
 * Ruta de diagnóstico del motor de pliegos — Fase 2. TEMPORAL.
 * Ver BITACORA_STOCK_PLIEGOS_2026-08-12.md — FASE 2.
 *
 * ⛔ SE ELIMINA EN LA FASE 8.
 *
 * Ejecuta la selección EN SECO: reserva de verdad (para ejercitar la sentencia
 * atómica real, no una simulación) y acto seguido BORRA la reserva, así no deja
 * rastro ni ocupa stock. No toca el flujo de compra ni el tema.
 */

import type { ActionFunctionArgs, LoaderFunctionArgs, HeadersFunction } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  capacidades,
  eliminarReservas,
  escalones,
  estadoPliegos,
  evaluar,
  reconciliar,
  reservar,
  todasLasTramas,
  tramaPorId,
  RESERVA_TTL_MIN,
  type Capacidad,
  type Escalon,
  type PliegoEstado,
} from "../lib/pliegos.server";

const PREFIJO = "debug_";

// La matriz del plan (§FASE 2 › Validación) que se puede correr de un clic.
/**
 * ⚠️ Las expectativas dependen del inventario Y DE LA TRAMA seleccionada.
 * Están calibradas para CENIZA en el estado del 2026-08-14:
 * 100→2100 · 300→70 (prácticamente seco) · 400→2010. Corridas sobre otra trama
 * (Alba, con anchos 80/300/378/380/382) los ✅/❌ no significan nada: mira la
 * columna "escalón" para leer el porqué de cada veredicto.
 *
 * Los cuatro primeros casos son la REGRESIÓN de la corrección del 2026-08-14
 * (el escalón lo fija el ancho pedido). Antes de ella, 228×320 y 250×200 se
 * vendían girados desde el rollo de 400, que es justo lo que no debe pasar.
 */
const MATRIZ = [
  { nombre: "228×320", anchoCm: 228, altoCm: 320, espera: "SIN_STOCK · escalón 300 seco, NO salta al 400" },
  { nombre: "250×200", anchoCm: 250, altoCm: 200, espera: "SIN_STOCK · escalón 300 seco" },
  { nombre: "350×300", anchoCm: 350, altoCm: 300, espera: "CEN-400-0x · escalón 400 con material" },
  { nombre: "90×300", anchoCm: 90, altoCm: 300, espera: "CEN-100-0x · escalón 100 lleno" },
  { nombre: "100×300", anchoCm: 100, altoCm: 300, espera: "CEN-100-01 · no rotada · consume 300" },
  { nombre: "350×400", anchoCm: 350, altoCm: 400, espera: "CEN-400-0x · ROTADA · consume 350" },
  { nombre: "250×50", anchoCm: 250, altoCm: 50, espera: "CEN-300-0x · el 300 no está en 0: quedan 70 cm" },
  { nombre: "350×2100", anchoCm: 350, altoCm: 2100, espera: "SIN_STOCK" },
];

type Fila = {
  caso: string;
  espera: string;
  /** Escalón que fija el ANCHO pedido, y el porqué del veredicto. */
  escalon: string;
  resultado: string;
  pliego: string;
  rotada: string;
  consume: string;
  merma: string;
  antes: string;
  despues: string;
  ok: boolean | null;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // 🔷 §4.4 — el selector pasa de listar reglas a listar TRAMAS: es la trama la
  // que tiene inventario, y el motor se prueba contra una trama concreta. Los
  // topes siguen siendo de la regla (son comerciales), así que se traen aparte.
  const [tramasLista, topesPorRegla] = await Promise.all([
    todasLasTramas(shop),
    prisma.reglaPersonalizada.findMany({
      where: { shop },
      select: { id: true, minAncho: true, maxAncho: true, minAlto: true, maxAlto: true },
    }),
  ]);
  const topes = new Map(topesPorRegla.map((r) => [r.id, r]));
  const reglas = tramasLista.map((t) => ({
    id: t.id,
    nombre: `${t.nombre}  ·  ${t.reglaNombre}`,
    minAncho: topes.get(t.reglaId)?.minAncho ?? 1,
    maxAncho: topes.get(t.reglaId)?.maxAncho ?? 0,
    minAlto: topes.get(t.reglaId)?.minAlto ?? 1,
    maxAlto: topes.get(t.reglaId)?.maxAlto ?? 0,
  }));

  const url = new URL(request.url);
  const tramaId = url.searchParams.get("tramaId") ?? reglas[0]?.id ?? "";

  const [pliegos, caps] = tramaId
    ? await Promise.all([estadoPliegos(shop, tramaId), capacidades(shop, tramaId)])
    : [[] as PliegoEstado[], [] as Capacidad[]];

  return {
    shop, reglas, tramaId, pliegos, caps,
    escalonesLista: escalones(caps) as Escalon[],
    ttl: RESERVA_TTL_MIN,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "probar");
  const tramaId = String(fd.get("tramaId") ?? "");

  if (!tramaId) return { error: "Selecciona una trama." };

  if (intent === "limpiar") {
    const n = await purgarDebug(shop, tramaId);
    return { mensaje: `Purgadas ${n} reserva(s) de diagnóstico.` };
  }

  if (intent === "reconciliar") {
    // ⚠️ `reconciliar()` sigue siendo POR REGLA: es donde vive
    // `ReservaPliego.reglaId`. Hay que traducir la trama a su regla.
    const t = await tramaPorId(shop, tramaId);
    if (!t) return { error: "La trama no existe." };
    const r = await reconciliar(shop, t.reglaId);
    return {
      mensaje: `Reconciliación de la regla "${t.reglaNombre}" (afecta a todas sus tramas): ` +
        `${r.revisadas} revisadas · ${r.confirmadas} confirmadas · ${r.anuladas} anuladas · ${r.sinResolver} sin resolver.`,
    };
  }

  const casos =
    intent === "matriz"
      ? MATRIZ
      : [
          {
            nombre: `${fd.get("anchoCm")}×${fd.get("altoCm")}`,
            anchoCm: Number(fd.get("anchoCm")),
            altoCm: Number(fd.get("altoCm")),
            espera: "—",
          },
        ];

  for (const c of casos) {
    if (!Number.isFinite(c.anchoCm) || !Number.isFinite(c.altoCm) || c.anchoCm <= 0 || c.altoCm <= 0) {
      return { error: "Ancho y alto deben ser números positivos en cm." };
    }
  }

  const filas: Fila[] = [];
  const refIds: string[] = [];

  try {
    for (const c of casos) {
      const antes = await estadoPliegos(shop, tramaId);
      // El veredicto se calcula ANTES de reservar y con la misma escalera que
      // verá el motor: es el "por qué" de la fila, y permite ver de un vistazo
      // si el bloqueo vino del escalón del ancho o de falta de largo.
      const v = evaluar(c.anchoCm, c.altoCm, await capacidades(shop, tramaId));
      const escalon = `${v.escalonCm ?? "—"} · ${v.motivo}`;
      const refId = `${PREFIJO}${Date.now()}_${c.anchoCm}x${c.altoCm}`;
      refIds.push(refId);

      const res = await reservar(shop, tramaId, [
        { refId, anchoCm: c.anchoCm, altoCm: c.altoCm },
      ]);

      if (res.ok) {
        const r = res.reservas[0];
        const despues = await estadoPliegos(shop, tramaId);
        const dAntes = antes.find((p) => p.id === r.pliegoId)?.disponibleCm ?? 0;
        const dDespues = despues.find((p) => p.id === r.pliegoId)?.disponibleCm ?? 0;
        filas.push({
          caso: c.nombre,
          espera: c.espera,
          escalon,
          resultado: "RESERVADO",
          pliego: `${r.pliegoCodigo} (ancho ${r.anchoPliegoCm})`,
          rotada: r.rotada ? "SÍ" : "no",
          consume: `${r.largoCm} cm`,
          merma: `${r.mermaCm} cm`,
          antes: `${dAntes} cm`,
          despues: `${dDespues} cm`,
          ok: c.espera === "—" ? null : !c.espera.startsWith("SIN_STOCK"),
        });
      } else {
        filas.push({
          caso: c.nombre,
          espera: c.espera,
          escalon,
          resultado: "SIN_STOCK",
          pliego: "—",
          rotada: "—",
          consume: "—",
          merma: "—",
          antes: "—",
          despues: "—",
          ok: c.espera === "—" ? null : c.espera.startsWith("SIN_STOCK"),
        });
      }
    }
  } finally {
    // Dry-run: no debe quedar rastro pase lo que pase.
    await eliminarReservas(shop, refIds);
  }

  // Prueba de idempotencia: el mismo refId dos veces = una sola reserva.
  let idempotencia = "";
  if (intent === "matriz") {
    const refId = `${PREFIJO}idem_${Date.now()}`;
    try {
      const a = await reservar(shop, tramaId, [{ refId, anchoCm: 100, altoCm: 300 }]);
      const b = await reservar(shop, tramaId, [{ refId, anchoCm: 100, altoCm: 300 }]);
      const mismaFila =
        a.ok && b.ok && a.reservas[0].reservaId === b.reservas[0].reservaId && b.reservas[0].yaExistia;
      idempotencia = mismaFila
        ? `✅ Mismo refId dos veces → 1 sola reserva (${a.ok ? a.reservas[0].pliegoCodigo : ""}), la 2ª devolvió la existente.`
        : "❌ La 2ª llamada con el mismo refId no devolvió la reserva existente.";
    } finally {
      await eliminarReservas(shop, [refId]);
    }
  }

  // 4 pedidos de 2000 cm con ancho 90 → deben repartirse los 4 rollos de 1 m.
  let reparto = "";
  if (intent === "matriz") {
    const refs = [0, 1, 2, 3].map((i) => `${PREFIJO}rep${i}_${Date.now()}`);
    try {
      const r = await reservar(
        shop,
        tramaId,
        refs.map((refId) => ({ refId, anchoCm: 90, altoCm: 2000 })),
      );
      if (r.ok) {
        const codigos = r.reservas.map((x) => x.pliegoCodigo);
        const distintos = new Set(codigos).size === 4;
        reparto = `${distintos ? "✅" : "❌"} 4 pedidos de 90×2000 → ${codigos.join(", ")}${
          distintos ? " (4 rollos distintos)" : " (¡se repitió un rollo!)"
        }`;
      } else {
        reparto = `❌ 4 pedidos de 90×2000 → SIN_STOCK en el item ${r.refId}`;
      }
    } finally {
      await eliminarReservas(shop, refs);
    }
  }

  const caps = await capacidades(shop, tramaId);
  const residuales = await contarDebug(shop, tramaId);

  return { filas, idempotencia, reparto, caps, residuales };
};

// ── Helpers de limpieza (solo diagnóstico) ──────────────────────────────────

// ⚠️ `ReservaPliego` NO tiene columna `tramaId`: guarda `reglaId` y cuelga del
// pliego. La trama se deriva por el pliego, que es exacto y es lo que permitió
// no migrar ni una sola reserva existente (§4.4).
async function purgarDebug(shop: string, tramaId: string): Promise<number> {
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(process.env.DIRECT_URL ?? process.env.DATABASE_URL!);
  const filas = await sql`
    DELETE FROM "ReservaPliego" r
    USING "Pliego" p
    WHERE p.id = r."pliegoId"
      AND r.shop = ${shop} AND p."tramaId" = ${tramaId} AND r."refId" LIKE ${PREFIJO + "%"}
    RETURNING r."id"`;
  return filas.length;
}

async function contarDebug(shop: string, tramaId: string): Promise<number> {
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(process.env.DIRECT_URL ?? process.env.DATABASE_URL!);
  const filas = await sql`
    SELECT COUNT(*)::int AS n FROM "ReservaPliego" r
    JOIN "Pliego" p ON p.id = r."pliegoId"
    WHERE r.shop = ${shop} AND p."tramaId" = ${tramaId} AND r."refId" LIKE ${PREFIJO + "%"}`;
  return Number((filas[0] as any).n);
}

// ── Estilos (inline, el proyecto no usa Polaris) ────────────────────────────

const card: React.CSSProperties = {
  border: "1px solid #e4e5e7",
  borderRadius: 8,
  padding: "16px 18px",
  marginBottom: 16,
  background: "#fff",
};
const label: React.CSSProperties = {
  display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4, color: "#202223",
};
const input: React.CSSProperties = {
  width: "100%", padding: "8px 12px", border: "1px solid #8c9196",
  borderRadius: 6, fontSize: 14, boxSizing: "border-box",
};
const btn: React.CSSProperties = {
  background: "#008060", color: "#fff", border: "none", borderRadius: 6,
  padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer",
};
const btnAlt: React.CSSProperties = {
  ...btn, background: "#f1f8ff", color: "#0070c4", border: "1px solid #0070c4",
};
const th: React.CSSProperties = {
  textAlign: "left", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4,
  color: "#6d7175", borderBottom: "1px solid #e4e5e7", padding: "8px 10px", whiteSpace: "nowrap",
};
const td: React.CSSProperties = {
  fontSize: 13, borderBottom: "1px solid #f1f2f3", padding: "8px 10px", whiteSpace: "nowrap",
};
const aviso: React.CSSProperties = {
  background: "#fff8e1", border: "1px solid #ffd79a", color: "#7a4f01",
  borderRadius: 6, padding: "10px 14px", fontSize: 13, marginBottom: 16,
};

const m = (cm: number) => `${(cm / 100).toFixed(2)} m`;

export default function PliegosDebug() {
  const { reglas, tramaId, pliegos, caps, escalonesLista, ttl } = useLoaderData<typeof loader>();
  const data = useActionData<typeof action>();
  const nav = useNavigation();
  const corriendo = nav.state === "submitting";
  const [params, setParams] = useSearchParams();

  const regla = reglas.find((r) => r.id === tramaId);
  // El producto de prueba tiene topes irreales (maxAncho/maxAlto = 21). El motor
  // los ignora a propósito; el aviso está para que no sorprenda en la Fase 5/6.
  const topesSospechosos = !!regla && (regla.maxAncho < 50 || regla.maxAlto < 50);

  const totalDisponible = pliegos.reduce((a, p) => a + (p.activo ? p.disponibleCm : 0), 0);

  return (
    <s-page heading="Diagnóstico del motor de pliegos">
      <s-section>
        <div style={{ ...aviso, background: "#eef4ff", borderColor: "#b6cdf7", color: "#123b7a" }}>
          <strong>Ruta temporal de la Fase 2.</strong> Se elimina en la Fase 8. Las pruebas reservan
          de verdad (para ejercitar la sentencia atómica real) y <strong>borran la reserva
          inmediatamente</strong>, así que no dejan rastro ni ocupan stock. No toca el flujo de
          compra ni el tema.
        </div>

        {/* Selector de trama */}
        <div style={card}>
          <label style={label} htmlFor="tramaSel">Trama (cada trama tiene su propio inventario)</label>
          <select
            id="tramaSel"
            style={input}
            value={tramaId}
            onChange={(e) => setParams({ tramaId: e.target.value })}
          >
            {reglas.map((r) => (
              <option key={r.id} value={r.id}>{r.nombre} — {r.id}</option>
            ))}
          </select>

          {topesSospechosos && regla && (
            <div style={{ ...aviso, marginTop: 12, marginBottom: 0 }}>
              <strong>Topes comerciales sospechosos en esta regla:</strong> maxAncho={regla.maxAncho},
              maxAlto={regla.maxAlto} (en cm serían {m(regla.maxAncho)} × {m(regla.maxAlto)}).
              <br />
              <strong>El motor los ignora</strong>: la selección de pliego es puramente física, así que
              este diagnóstico funciona igual. El híbrido <code>min(tope comercial, tope físico)</code> del
              §2.4 se aplicará en <code>/api/precio</code> (Fase 5) — <em>ahí</em> este valor sí
              bloquearía el widget. No se ha modificado la configuración del producto.
            </div>
          )}
        </div>

        {/* Estado actual */}
        <div style={card}>
          <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>Estado de los pliegos</h3>
          <p style={{ fontSize: 13, color: "#6d7175", margin: "0 0 12px" }}>
            Disponible = largo restante confirmado − reservas pendientes de menos de {ttl} min.
            Total disponible: <strong>{m(totalDisponible)}</strong> en {pliegos.filter((p) => p.activo).length} rollo(s).
          </p>
          {pliegos.length === 0 ? (
            <p style={{ fontSize: 13, color: "#6d7175" }}>Esta trama no tiene pliegos cargados.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    <th style={th}>Código</th><th style={th}>Ancho</th><th style={th}>Total</th>
                    <th style={th}>Restante</th><th style={th}>Disponible</th>
                    <th style={th}>Reservas</th><th style={th}>Activo</th>
                  </tr>
                </thead>
                <tbody>
                  {pliegos.map((p) => (
                    <tr key={p.id}>
                      <td style={{ ...td, fontWeight: 600 }}>{p.codigo}</td>
                      <td style={td}>{p.anchoCm} cm</td>
                      <td style={td}>{m(p.largoTotalCm)}</td>
                      <td style={td}>{m(p.largoRestanteCm)}</td>
                      <td style={{ ...td, fontWeight: 600, color: p.disponibleCm > 0 ? "#008060" : "#8f1c1c" }}>
                        {m(p.disponibleCm)}
                      </td>
                      <td style={td}>{p.reservasVigentes || "—"}</td>
                      <td style={td}>{p.activo ? "sí" : "NO"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p style={{ fontSize: 13, color: "#6d7175", margin: "12px 0 0" }}>
            <strong>capacidades()</strong> → {caps.length
              ? caps.map((c) => `{ancho ${c.anchoCm}, largoMax ${c.largoMaxCm}}`).join("  ")
              : "[] (sin rollos activos)"}
          </p>
          <p style={{ fontSize: 13, color: "#6d7175", margin: "6px 0 0" }}>
            <strong>escalones</strong> → {escalonesLista.length
              ? escalonesLista
                  .map((e) => `ancho ${e.desdeCm}–${e.hastaCm} → ${
                    e.largoMaxCm > 0 ? `largo ≤ ${e.largoMaxCm}` : "SIN MATERIAL"
                  }`)
                  .join("   ·   ")
              : "—"}
            <br />
            Un pedido solo usa rollos de <strong>su</strong> escalón. Cada orientación calcula el
            suyo con el lado que va a lo ancho del rollo.
          </p>
        </div>

        {/* Prueba puntual */}
        <div style={card}>
          <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>Probar una medida</h3>
          <Form method="post">
            <input type="hidden" name="tramaId" value={tramaId} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 12, alignItems: "end" }}>
              <div>
                <label style={label} htmlFor="anchoCm">Ancho (cm)</label>
                <input id="anchoCm" name="anchoCm" type="number" min={1} defaultValue={250} style={input} required />
              </div>
              <div>
                <label style={label} htmlFor="altoCm">Alto (cm)</label>
                <input id="altoCm" name="altoCm" type="number" min={1} defaultValue={350} style={input} required />
              </div>
              <button type="submit" name="intent" value="probar" style={btn} disabled={corriendo}>
                {corriendo ? "Probando…" : "Probar en seco"}
              </button>
            </div>
          </Form>

          <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
            <Form method="post">
              <input type="hidden" name="tramaId" value={tramaId} />
              <button type="submit" name="intent" value="matriz" style={btnAlt} disabled={corriendo}>
                Correr la matriz del plan
              </button>
            </Form>
            <Form method="post">
              <input type="hidden" name="tramaId" value={tramaId} />
              <button type="submit" name="intent" value="reconciliar" style={btnAlt} disabled={corriendo}>
                Forzar reconciliación
              </button>
            </Form>
            <Form method="post">
              <input type="hidden" name="tramaId" value={tramaId} />
              <button type="submit" name="intent" value="limpiar" style={btnAlt} disabled={corriendo}>
                Purgar reservas de diagnóstico
              </button>
            </Form>
          </div>
        </div>

        {/* Resultados */}
        {data && "error" in data && data.error && (
          <div style={{ ...aviso, background: "#fde8e8", borderColor: "#f6b0b0", color: "#8f1c1c" }}>
            {data.error}
          </div>
        )}

        {data && "mensaje" in data && data.mensaje && (
          <div style={{ ...aviso, background: "#eaf7ee", borderColor: "#b0e0c0", color: "#0b5c2e" }}>
            {data.mensaje}
          </div>
        )}

        {data && "filas" in data && data.filas && (
          <div style={card}>
            <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>Resultado</h3>
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    <th style={th}>Caso</th><th style={th}>Esperado</th><th style={th}>Resultado</th>
                    <th style={th}>Escalón del ancho · motivo</th>
                    <th style={th}>Pliego</th><th style={th}>Rotada</th><th style={th}>Consume</th>
                    <th style={th}>Merma</th><th style={th}>Disp. antes</th><th style={th}>Disp. después</th>
                  </tr>
                </thead>
                <tbody>
                  {data.filas.map((f, i) => (
                    <tr key={i}>
                      <td style={{ ...td, fontWeight: 600 }}>
                        {f.ok === null ? "" : f.ok ? "✅ " : "❌ "}{f.caso}
                      </td>
                      <td style={{ ...td, color: "#6d7175" }}>{f.espera}</td>
                      <td style={{ ...td, fontWeight: 600, color: f.resultado === "RESERVADO" ? "#008060" : "#8f1c1c" }}>
                        {f.resultado}
                      </td>
                      <td style={{ ...td, color: "#6d7175", maxWidth: 320 }}>{f.escalon}</td>
                      <td style={td}>{f.pliego}</td>
                      <td style={{ ...td, fontWeight: f.rotada === "SÍ" ? 600 : 400 }}>{f.rotada}</td>
                      <td style={td}>{f.consume}</td>
                      <td style={td}>{f.merma}</td>
                      <td style={td}>{f.antes}</td>
                      <td style={td}>{f.despues}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {data.idempotencia && <p style={{ fontSize: 13, marginTop: 14 }}>{data.idempotencia}</p>}
            {data.reparto && <p style={{ fontSize: 13, marginTop: 6 }}>{data.reparto}</p>}

            <p style={{ fontSize: 12, color: "#6d7175", marginTop: 14 }}>
              Reservas de diagnóstico residuales tras limpiar: <strong>{data.residuales}</strong>{" "}
              {data.residuales === 0 ? "✅ (no quedó rastro)" : "⚠️ usa «Purgar»"}
              {" · "}Los logs <code>[PLIEGOS]</code> de cada paso están en Vercel → Logs.
            </p>
          </div>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
