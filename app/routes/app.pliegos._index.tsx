/**
 * Admin de stock por pliego — índice. Fase 3.
 * Ver BITACORA_STOCK_PLIEGOS_2026-08-12.md — FASE 3.
 *
 * Resumen por trama + reconciliación por demanda al abrir (self-healing sin
 * cron, §3.2.3): si el merchant entra a mirar el stock, de paso se resuelven
 * las reservas vencidas contra Shopify.
 */

import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  capacidades,
  escalones,
  estadoPliegos,
  reconciliar,
  RESERVA_TTL_MIN,
  type Capacidad,
  type Escalon,
  type PliegoEstado,
} from "../lib/pliegos.server";

/** Un rollo se considera "casi agotado" por debajo de esto. */
const UMBRAL_ALERTA_CM = 200;
const UMBRAL_ALERTA_PCT = 0.1;

function esCasiAgotado(p: PliegoEstado): boolean {
  if (!p.activo || p.disponibleCm <= 0) return false;
  return p.disponibleCm <= UMBRAL_ALERTA_CM || p.disponibleCm <= p.largoTotalCm * UMBRAL_ALERTA_PCT;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const reglas = await prisma.reglaPersonalizada.findMany({
    where: { shop },
    select: { id: true, nombre: true, activa: true, productIds: true },
    orderBy: { createdAt: "asc" },
  });

  const tramas = [];
  let reconciliadas = 0;

  for (const r of reglas) {
    const pliegos = await estadoPliegos(shop, r.id);
    if (!pliegos.length) {
      tramas.push({
        ...r, sinPliegos: true, pliegos: [], caps: [] as Capacidad[],
        escalonesLista: [] as Escalon[], resumen: null,
      });
      continue;
    }

    // Self-healing: solo hace trabajo si hay reservas vencidas sin resolver.
    const rec = await reconciliar(shop, r.id);
    reconciliadas += rec.confirmadas + rec.anuladas;

    // Releer si la reconciliación cambió algo.
    const finales = rec.confirmadas || rec.anuladas ? await estadoPliegos(shop, r.id) : pliegos;
    const caps = await capacidades(shop, r.id);
    const activos = finales.filter((p) => p.activo);

    tramas.push({
      ...r,
      sinPliegos: false,
      pliegos: finales,
      caps,
      // La escalera se arma en el loader: `escalones()` vive en un módulo
      // .server y no puede llamarse desde el render del componente.
      escalonesLista: escalones(caps),
      resumen: {
        totalRollos: finales.length,
        rollosActivos: activos.length,
        rollosDeBaja: finales.length - activos.length,
        disponibleCm: activos.reduce((a, p) => a + Math.max(0, p.disponibleCm), 0),
        totalCm: activos.reduce((a, p) => a + p.largoTotalCm, 0),
        reservasVigentes: finales.reduce((a, p) => a + p.reservasVigentes, 0),
        // Con rotación, el mayor lado vendible puede ser el largo de un rollo.
        // Solo cuentan los escalones CON material: uno seco no vende nada.
        mayorLadoCm: caps
          .filter((c) => c.largoMaxCm > 0)
          .reduce((mx, c) => Math.max(mx, c.anchoCm, c.largoMaxCm), 0),
        casiAgotados: finales.filter(esCasiAgotado).map((p) => p.codigo),
        agotados: finales.filter((p) => p.activo && p.disponibleCm <= 0).map((p) => p.codigo),
      },
    });
  }

  return { tramas, reconciliadas, ttl: RESERVA_TTL_MIN };
};

// ── Estilos ─────────────────────────────────────────────────────────────────
const card: React.CSSProperties = {
  border: "1px solid #e4e5e7", borderRadius: 8, padding: "18px 20px",
  marginBottom: 16, background: "#fff",
};
const stat: React.CSSProperties = {
  border: "1px solid #e4e5e7", borderRadius: 6, padding: "10px 14px", background: "#fafbfb",
};
const statNum: React.CSSProperties = { fontSize: 20, fontWeight: 700, color: "#202223", lineHeight: 1.2 };
const statLbl: React.CSSProperties = { fontSize: 12, color: "#6d7175", marginTop: 2 };
const btn: React.CSSProperties = {
  background: "#008060", color: "#fff", border: "none", borderRadius: 6,
  padding: "8px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer",
};
const chip = (bg: string, fg: string): React.CSSProperties => ({
  display: "inline-block", background: bg, color: fg, borderRadius: 20,
  padding: "2px 10px", fontSize: 12, fontWeight: 600, marginRight: 6, marginBottom: 4,
});

const m = (cm: number) => `${(cm / 100).toFixed(2)} m`;

export default function PliegosIndex() {
  const { tramas, reconciliadas, ttl } = useLoaderData<typeof loader>();

  const conPliegos = tramas.filter((t) => !t.sinPliegos);
  const sinPliegos = tramas.filter((t) => t.sinPliegos);

  return (
    <s-page heading="Stock de pliegos">
      <s-section>
        <p style={{ fontSize: 13, color: "#6d7175", margin: "0 0 16px" }}>
          Cada trama se corta de rollos físicos independientes. Una alfombra sale siempre de{" "}
          <strong>un solo pliego</strong>: el ancho tiene que alcanzar y el largo se descuenta de ese
          rollo. El sobrante de ancho es merma y no se reutiliza.
        </p>

        {reconciliadas > 0 && (
          <div style={{
            background: "#eaf7ee", border: "1px solid #b0e0c0", color: "#0b5c2e",
            borderRadius: 6, padding: "10px 14px", fontSize: 13, marginBottom: 16,
          }}>
            Al abrir esta pantalla se resolvieron <strong>{reconciliadas}</strong> reserva(s)
            vencida(s) contra Shopify.
          </div>
        )}

        {conPliegos.length === 0 && (
          <div style={card}>
            <p style={{ fontSize: 14, margin: 0 }}>
              Todavía no hay pliegos cargados en ninguna trama. Entra en una trama de la lista de
              abajo y usa <strong>Alta masiva</strong> para cargar el inventario.
            </p>
          </div>
        )}

        {conPliegos.map((t) => {
          const r = t.resumen!;
          const consumidoPct = r.totalCm > 0 ? 1 - r.disponibleCm / r.totalCm : 0;
          return (
            <div key={t.id} style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 16, flexWrap: "wrap" }}>
                <div>
                  <h3 style={{ margin: "0 0 2px", fontSize: 16 }}>{t.nombre}</h3>
                  <p style={{ fontSize: 12, color: "#6d7175", margin: 0 }}>
                    {t.activa ? "Regla activa" : "Regla INACTIVA"} · {t.productIds.length} producto(s)
                  </p>
                </div>
                <Link to={`/app/pliegos/${t.id}`}>
                  <button type="button" style={btn}>Gestionar</button>
                </Link>
              </div>

              <div style={{
                display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
                gap: 10, marginTop: 16,
              }}>
                <div style={stat}>
                  <div style={statNum}>{r.rollosActivos}</div>
                  <div style={statLbl}>rollos activos{r.rollosDeBaja > 0 ? ` (+${r.rollosDeBaja} de baja)` : ""}</div>
                </div>
                <div style={stat}>
                  <div style={statNum}>{m(r.disponibleCm)}</div>
                  <div style={statLbl}>disponible ahora</div>
                </div>
                <div style={stat}>
                  <div style={statNum}>{m(r.mayorLadoCm)}</div>
                  <div style={statLbl}>mayor lado vendible</div>
                </div>
                <div style={stat}>
                  <div style={statNum}>{r.reservasVigentes}</div>
                  <div style={statLbl}>reservas vigentes ({ttl} min)</div>
                </div>
              </div>

              {/* Barra de consumo global */}
              <div style={{ marginTop: 14 }}>
                <div style={{ height: 8, background: "#e4e5e7", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{
                    width: `${Math.min(100, Math.max(0, consumidoPct * 100))}%`,
                    height: "100%",
                    background: consumidoPct > 0.85 ? "#d72c0d" : consumidoPct > 0.6 ? "#ffc453" : "#008060",
                  }} />
                </div>
                <p style={{ fontSize: 12, color: "#6d7175", margin: "6px 0 0" }}>
                  {(consumidoPct * 100).toFixed(1)}% consumido de {m(r.totalCm)} totales
                </p>
              </div>

              {/* Escalones — cada ancho de rollo es un escalón cerrado (§5.0) */}
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#6d7175", marginBottom: 6 }}>
                  ESCALONES POR ANCHO DE ROLLO
                </div>
                {!t.caps.some((c) => c.largoMaxCm > 0) ? (
                  <span style={chip("#fde8e8", "#8f1c1c")}>AGOTADA — sin capacidad</span>
                ) : (
                  t.escalonesLista.map((e) => (
                    <span
                      key={e.hastaCm}
                      style={e.largoMaxCm > 0 ? chip("#f1f8ff", "#0070c4") : chip("#fde8e8", "#8f1c1c")}
                    >
                      ancho {e.desdeCm}–{e.hastaCm} cm →{" "}
                      {e.largoMaxCm > 0 ? `largo ≤ ${m(e.largoMaxCm)}` : "SIN MATERIAL"}
                    </span>
                  ))
                )}
                <p style={{ fontSize: 12, color: "#6d7175", margin: "6px 0 0" }}>
                  Un pedido solo puede cortarse de rollos de <strong>su</strong> escalón: si el
                  escalón está sin material, la venta se bloquea aunque queden rollos más anchos.
                  El límite real es el <strong>par</strong> (ancho, largo), y se evalúan las dos
                  orientaciones — cada una contra el escalón del lado que va a lo ancho del rollo.
                </p>
              </div>

              {/* Alertas */}
              {(r.agotados.length > 0 || r.casiAgotados.length > 0) && (
                <div style={{
                  marginTop: 14, background: "#fff8e1", border: "1px solid #ffd79a",
                  borderRadius: 6, padding: "10px 14px",
                }}>
                  {r.agotados.length > 0 && (
                    <p style={{ fontSize: 13, margin: "0 0 6px", color: "#7a4f01" }}>
                      <strong>{r.agotados.length} rollo(s) sin material:</strong> {r.agotados.join(", ")}.
                      Considera darlos de baja para que no aparezcan en los listados.
                    </p>
                  )}
                  {r.casiAgotados.length > 0 && (
                    <p style={{ fontSize: 13, margin: 0, color: "#7a4f01" }}>
                      <strong>{r.casiAgotados.length} rollo(s) casi agotado(s)</strong> (menos de{" "}
                      {m(UMBRAL_ALERTA_CM)} o del {UMBRAL_ALERTA_PCT * 100}%): {r.casiAgotados.join(", ")}.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {sinPliegos.length > 0 && (
          <div style={card}>
            <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>Tramas sin pliegos cargados</h3>
            <p style={{ fontSize: 13, color: "#6d7175", margin: "0 0 12px" }}>
              Mientras una trama no tenga pliegos, el control de stock no la afecta: se vende como
              hasta ahora.
            </p>
            {sinPliegos.map((t) => (
              <div key={t.id} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "10px 0", borderTop: "1px solid #f1f2f3", gap: 12, flexWrap: "wrap",
              }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{t.nombre}</div>
                  <div style={{ fontSize: 12, color: "#6d7175" }}>
                    {t.activa ? "Regla activa" : "Regla INACTIVA"} · {t.productIds.length} producto(s)
                  </div>
                </div>
                <Link to={`/app/pliegos/${t.id}`}>
                  <button type="button" style={{ ...btn, background: "#f1f8ff", color: "#0070c4", border: "1px solid #0070c4" }}>
                    Cargar pliegos
                  </button>
                </Link>
              </div>
            ))}
          </div>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
