/**
 * Admin de stock por pliego — gestión de una trama. Fase 3.
 * Ver BITACORA_STOCK_PLIEGOS_2026-08-12.md — FASE 3.
 *
 * Pestañas: Pliegos (alta masiva, ajuste, baja) · Reservas · Cortes.
 * La pestaña Cortes es LA PANTALLA DEL TALLER exigida por la decisión 5: como
 * el código de pliego no viaja en la orden de Shopify, éste es el único sitio
 * donde se cruza orden ↔ pliego.
 */

import { Fragment, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, Link, useActionData, useLoaderData, useNavigation, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  ajustarPliego,
  altaMasiva,
  cambiarActivo,
  capacidades,
  cortesDeTrama,
  estadoPliegos,
  movimientosDeTrama,
  prefijoSugerido,
  reservasDeTrama,
  RESERVA_TTL_MIN,
} from "../lib/pliegos.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const reglaId = params.reglaId!;

  const regla = await prisma.reglaPersonalizada.findFirst({
    where: { id: reglaId, shop },
    select: { id: true, nombre: true, activa: true, productIds: true, maxAncho: true, maxAlto: true },
  });
  if (!regla) throw new Response("Trama no encontrada", { status: 404 });

  const [pliegos, caps, reservas, cortes, movimientos] = await Promise.all([
    estadoPliegos(shop, reglaId),
    capacidades(shop, reglaId),
    reservasDeTrama(shop, reglaId),
    cortesDeTrama(shop, reglaId),
    movimientosDeTrama(shop, reglaId),
  ]);

  return {
    regla,
    pliegos,
    caps,
    reservas,
    cortes,
    movimientos,
    prefijo: prefijoSugerido(regla.nombre),
    ttl: RESERVA_TTL_MIN,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const reglaId = params.reglaId!;
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");

  if (intent === "alta") {
    const prefijo = String(fd.get("prefijo") ?? "").trim().toUpperCase();
    const anchoM = Number(fd.get("anchoM"));
    const largoM = Number(fd.get("largoM"));
    const cantidad = Number(fd.get("cantidad"));
    const nota = String(fd.get("nota") ?? "").trim();

    if (!/^[A-Z0-9]{2,6}$/.test(prefijo)) {
      return { error: "El prefijo debe tener entre 2 y 6 letras o números (ej: CEN)." };
    }
    if (!Number.isFinite(anchoM) || anchoM <= 0 || !Number.isFinite(largoM) || largoM <= 0) {
      return { error: "Ancho y largo deben ser números positivos en metros." };
    }
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 200) {
      return { error: "La cantidad debe ser un entero entre 1 y 200." };
    }

    // El admin pide metros; la DB guarda centímetros enteros (§4.3).
    const anchoCm = Math.round(anchoM * 100);
    const largoCm = Math.round(largoM * 100);

    const r = await altaMasiva(shop, reglaId, { prefijo, anchoCm, largoCm, cantidad, nota });
    if (!r.creados.length) {
      return { error: "No se creó ningún pliego. ¿Los códigos ya existían?" };
    }
    return {
      mensaje:
        `Creados ${r.creados.length} rollo(s) de ${anchoM} × ${largoM} m: ${r.creados.join(", ")}.` +
        (r.omitidos > 0 ? ` Se omitieron ${r.omitidos} por códigos ya existentes.` : ""),
    };
  }

  if (intent === "ajustar") {
    const pliegoId = String(fd.get("pliegoId") ?? "");
    const nuevoM = Number(fd.get("nuevoLargoM"));
    const nota = String(fd.get("nota") ?? "").trim();

    if (!nota) return { error: "La nota es obligatoria en un ajuste manual." };
    if (!Number.isFinite(nuevoM) || nuevoM < 0) {
      return { error: "El nuevo largo restante debe ser un número en metros, 0 o mayor." };
    }

    const r = await ajustarPliego(shop, pliegoId, Math.round(nuevoM * 100), nota);
    if (!r.ok) return { error: r.error };
    return {
      mensaje: `${r.codigo} ajustado: ${r.delta >= 0 ? "+" : ""}${(r.delta / 100).toFixed(2)} m. Movimiento registrado.`,
    };
  }

  if (intent === "baja" || intent === "reactivar") {
    const pliegoId = String(fd.get("pliegoId") ?? "");
    const nota = String(fd.get("nota") ?? "").trim();
    const activo = intent === "reactivar";
    if (!nota) return { error: `La nota es obligatoria para ${activo ? "reactivar" : "dar de baja"}.` };

    const ok = await cambiarActivo(shop, pliegoId, activo, nota);
    if (!ok) return { error: "El pliego no existe." };
    return { mensaje: `Pliego ${activo ? "reactivado" : "dado de baja"}. Movimiento registrado.` };
  }

  return { error: "Acción no reconocida." };
};

// ── Estilos ─────────────────────────────────────────────────────────────────
const card: React.CSSProperties = {
  border: "1px solid #e4e5e7", borderRadius: 8, padding: "18px 20px",
  marginBottom: 16, background: "#fff",
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
const btnGhost: React.CSSProperties = {
  background: "transparent", color: "#202223", border: "1px solid #8c9196",
  borderRadius: 6, padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer",
};
const btnDanger: React.CSSProperties = { ...btnGhost, color: "#8f1c1c", borderColor: "#f6b0b0" };
const th: React.CSSProperties = {
  textAlign: "left", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4,
  color: "#6d7175", borderBottom: "1px solid #e4e5e7", padding: "8px 10px", whiteSpace: "nowrap",
};
const td: React.CSSProperties = {
  fontSize: 13, borderBottom: "1px solid #f1f2f3", padding: "8px 10px", verticalAlign: "middle",
};
const tabBtn = (activa: boolean): React.CSSProperties => ({
  background: "none", border: "none", borderBottom: activa ? "2px solid #008060" : "2px solid transparent",
  color: activa ? "#008060" : "#6d7175", fontSize: 14, fontWeight: 600,
  padding: "10px 14px", cursor: "pointer",
});
const chip = (bg: string, fg: string): React.CSSProperties => ({
  display: "inline-block", background: bg, color: fg, borderRadius: 20,
  padding: "2px 9px", fontSize: 12, fontWeight: 600,
});

const m = (cm: number) => `${(cm / 100).toFixed(2)} m`;
const fecha = (iso: string) =>
  new Date(iso).toLocaleString("es-CL", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function GestionTrama() {
  const { regla, pliegos, caps, reservas, cortes, movimientos, prefijo, ttl } =
    useLoaderData<typeof loader>();
  const data = useActionData<typeof action>();
  const nav = useNavigation();
  const guardando = nav.state === "submitting";
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "pliegos";

  const [ajustando, setAjustando] = useState<string | null>(null);
  const [dandoBaja, setDandoBaja] = useState<string | null>(null);

  const activos = pliegos.filter((p) => p.activo);
  const disponibleTotal = activos.reduce((a, p) => a + Math.max(0, p.disponibleCm), 0);
  const vigentes = reservas.filter((r) => r.estado === "pendiente" && !r.vencida);
  const vencidas = reservas.filter((r) => r.estado === "pendiente" && r.vencida);
  const topesSospechosos = regla.maxAncho < 50 || regla.maxAlto < 50;

  const irA = (t: string) => setParams(t === "pliegos" ? {} : { tab: t });

  return (
    <s-page heading={`Stock de pliegos — ${regla.nombre}`}>
      <s-section>
        <p style={{ fontSize: 13, color: "#6d7175", margin: "0 0 12px" }}>
          <Link to="/app/pliegos" style={{ color: "#0070c4" }}>← Todas las tramas</Link>
          {"  ·  "}
          {activos.length} rollo(s) activo(s) · {m(disponibleTotal)} disponible
          {"  ·  "}
          <Link to={`/app/pliegos/debug?reglaId=${regla.id}`} style={{ color: "#0070c4" }}>
            Probar el motor con esta trama
          </Link>
        </p>

        {topesSospechosos && (
          <div style={{
            background: "#fff8e1", border: "1px solid #ffd79a", color: "#7a4f01",
            borderRadius: 6, padding: "10px 14px", fontSize: 13, marginBottom: 16,
          }}>
            <strong>Aviso:</strong> esta regla tiene <code>maxAncho={regla.maxAncho}</code> y{" "}
            <code>maxAlto={regla.maxAlto}</code>, que en centímetros son {m(regla.maxAncho)} ×{" "}
            {m(regla.maxAlto)}. El control de stock <strong>no usa esos topes</strong>, pero el widget
            de la tienda sí los aplicará cuando se conecte (Fase 5). No se ha modificado nada.
          </div>
        )}

        {data && "error" in data && data.error && (
          <div style={{
            background: "#fde8e8", border: "1px solid #f6b0b0", color: "#8f1c1c",
            borderRadius: 6, padding: "10px 14px", fontSize: 14, marginBottom: 16,
          }}>{data.error}</div>
        )}
        {data && "mensaje" in data && data.mensaje && (
          <div style={{
            background: "#eaf7ee", border: "1px solid #b0e0c0", color: "#0b5c2e",
            borderRadius: 6, padding: "10px 14px", fontSize: 14, marginBottom: 16,
          }}>{data.mensaje}</div>
        )}

        {/* Pestañas */}
        <div style={{ borderBottom: "1px solid #e4e5e7", marginBottom: 16 }}>
          <button style={tabBtn(tab === "pliegos")} onClick={() => irA("pliegos")}>
            Pliegos ({pliegos.length})
          </button>
          <button style={tabBtn(tab === "reservas")} onClick={() => irA("reservas")}>
            Reservas ({vigentes.length + vencidas.length})
          </button>
          <button style={tabBtn(tab === "cortes")} onClick={() => irA("cortes")}>
            Cortes ({cortes.length})
          </button>
          <button style={tabBtn(tab === "movimientos")} onClick={() => irA("movimientos")}>
            Movimientos ({movimientos.length})
          </button>
        </div>

        {/* ── PESTAÑA PLIEGOS ─────────────────────────────────────────────── */}
        {tab === "pliegos" && (
          <>
            <div style={card}>
              <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>Alta masiva</h3>
              <p style={{ fontSize: 13, color: "#6d7175", margin: "0 0 14px" }}>
                Formato del inventario: <code>ancho | largo | cantidad</code>. Genera N rollos
                independientes con código correlativo. Las medidas se piden{" "}
                <strong>en metros</strong> y se guardan en centímetros enteros.
              </p>
              <Form method="post">
                <input type="hidden" name="intent" value="alta" />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 12 }}>
                  <div>
                    <label style={label} htmlFor="prefijo">Prefijo</label>
                    <input id="prefijo" name="prefijo" defaultValue={prefijo} maxLength={6} style={input} required />
                  </div>
                  <div>
                    <label style={label} htmlFor="anchoM">Ancho (m)</label>
                    <input id="anchoM" name="anchoM" type="number" step="0.01" min="0.01" placeholder="4.00" style={input} required />
                  </div>
                  <div>
                    <label style={label} htmlFor="largoM">Largo (m)</label>
                    <input id="largoM" name="largoM" type="number" step="0.01" min="0.01" placeholder="20.10" style={input} required />
                  </div>
                  <div>
                    <label style={label} htmlFor="cantidad">Cantidad</label>
                    <input id="cantidad" name="cantidad" type="number" min="1" max="200" defaultValue={1} style={input} required />
                  </div>
                </div>
                <div style={{ marginTop: 12 }}>
                  <label style={label} htmlFor="notaAlta">Nota (opcional)</label>
                  <input id="notaAlta" name="nota" placeholder="Ej: partida recibida el 12/08" style={input} />
                </div>
                <button type="submit" style={{ ...btn, marginTop: 14 }} disabled={guardando}>
                  {guardando ? "Creando…" : "Crear rollos"}
                </button>
              </Form>
            </div>

            <div style={card}>
              <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>Rollos</h3>
              {pliegos.length === 0 ? (
                <p style={{ fontSize: 13, color: "#6d7175", margin: 0 }}>
                  Sin pliegos. Mientras esta trama no tenga rollos cargados, el control de stock no la
                  afecta.
                </p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 760 }}>
                    <thead>
                      <tr>
                        <th style={th}>Código</th><th style={th}>Ancho</th><th style={th}>Consumo</th>
                        <th style={th}>Restante</th><th style={th}>Disponible</th>
                        <th style={th}>Reservas</th><th style={th}>Estado</th><th style={th}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {pliegos.map((p) => {
                        const usado = p.largoTotalCm > 0 ? 1 - p.disponibleCm / p.largoTotalCm : 0;
                        const color = usado > 0.85 ? "#d72c0d" : usado > 0.6 ? "#ffc453" : "#008060";
                        return (
                          <Fragment key={p.id}>
                            <tr style={{ opacity: p.activo ? 1 : 0.5 }}>
                              <td style={{ ...td, fontWeight: 600 }}>{p.codigo}</td>
                              <td style={td}>{p.anchoCm} cm</td>
                              <td style={{ ...td, minWidth: 140 }}>
                                <div style={{ height: 6, background: "#e4e5e7", borderRadius: 3, overflow: "hidden" }}>
                                  <div style={{ width: `${Math.min(100, Math.max(0, usado * 100))}%`, height: "100%", background: color }} />
                                </div>
                                <span style={{ fontSize: 11, color: "#6d7175" }}>
                                  {(usado * 100).toFixed(0)}% de {m(p.largoTotalCm)}
                                </span>
                              </td>
                              <td style={td}>{m(p.largoRestanteCm)}</td>
                              <td style={{ ...td, fontWeight: 600, color: p.disponibleCm > 0 ? "#008060" : "#8f1c1c" }}>
                                {m(p.disponibleCm)}
                              </td>
                              <td style={td}>{p.reservasVigentes || "—"}</td>
                              <td style={td}>
                                {p.activo
                                  ? <span style={chip("#eaf7ee", "#0b5c2e")}>activo</span>
                                  : <span style={chip("#e4e5e7", "#6d7175")}>de baja</span>}
                              </td>
                              <td style={{ ...td, whiteSpace: "nowrap" }}>
                                <button type="button" style={btnGhost}
                                  onClick={() => { setAjustando(ajustando === p.id ? null : p.id); setDandoBaja(null); }}>
                                  Ajustar
                                </button>{" "}
                                <button type="button" style={p.activo ? btnDanger : btnGhost}
                                  onClick={() => { setDandoBaja(dandoBaja === p.id ? null : p.id); setAjustando(null); }}>
                                  {p.activo ? "Dar de baja" : "Reactivar"}
                                </button>
                              </td>
                            </tr>

                            {ajustando === p.id && (
                              <tr>
                                <td style={{ ...td, background: "#fafbfb" }} colSpan={8}>
                                  <Form method="post" onSubmit={() => setAjustando(null)}>
                                    <input type="hidden" name="intent" value="ajustar" />
                                    <input type="hidden" name="pliegoId" value={p.id} />
                                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                                      Ajustar largo restante de {p.codigo}
                                    </div>
                                    <p style={{ fontSize: 12, color: "#6d7175", margin: "0 0 10px" }}>
                                      Para cuadrar con la realidad: cortes por WhatsApp, ventas en el
                                      local, muestras o errores de corte que no pasaron por la app.
                                      Actual: <strong>{m(p.largoRestanteCm)}</strong> de {m(p.largoTotalCm)}.
                                    </p>
                                    <div style={{ display: "grid", gridTemplateColumns: "160px 1fr auto", gap: 10, alignItems: "end" }}>
                                      <div>
                                        <label style={label}>Nuevo restante (m)</label>
                                        <input name="nuevoLargoM" type="number" step="0.01" min="0"
                                          max={(p.largoTotalCm / 100).toFixed(2)}
                                          defaultValue={(p.largoRestanteCm / 100).toFixed(2)}
                                          style={input} required />
                                      </div>
                                      <div>
                                        <label style={label}>Motivo (obligatorio)</label>
                                        <input name="nota" placeholder="Ej: corte de 3 m vendido en el local" style={input} required />
                                      </div>
                                      <button type="submit" style={btn} disabled={guardando}>Guardar ajuste</button>
                                    </div>
                                  </Form>
                                </td>
                              </tr>
                            )}

                            {dandoBaja === p.id && (
                              <tr>
                                <td style={{ ...td, background: "#fafbfb" }} colSpan={8}>
                                  <Form method="post" onSubmit={() => setDandoBaja(null)}>
                                    <input type="hidden" name="intent" value={p.activo ? "baja" : "reactivar"} />
                                    <input type="hidden" name="pliegoId" value={p.id} />
                                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                                      {p.activo ? `Dar de baja ${p.codigo}` : `Reactivar ${p.codigo}`}
                                    </div>
                                    <p style={{ fontSize: 12, color: "#6d7175", margin: "0 0 10px" }}>
                                      {p.activo
                                        ? "El rollo deja de considerarse en la selección automática. No se borra: el historial se conserva."
                                        : "El rollo vuelve a entrar en la selección automática con su largo restante actual."}
                                    </p>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end" }}>
                                      <div>
                                        <label style={label}>Motivo (obligatorio)</label>
                                        <input name="nota" placeholder={p.activo ? "Ej: rollo manchado" : "Ej: recuperado tras revisión"} style={input} required />
                                      </div>
                                      <button type="submit" style={p.activo ? { ...btn, background: "#d72c0d" } : btn} disabled={guardando}>
                                        {p.activo ? "Confirmar baja" : "Confirmar reactivación"}
                                      </button>
                                    </div>
                                  </Form>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {caps.length > 0 && (
                <p style={{ fontSize: 12, color: "#6d7175", marginTop: 14 }}>
                  <strong>Capacidad actual:</strong>{" "}
                  {caps.map((c) => `ancho ≤ ${c.anchoCm} cm → largo ≤ ${m(c.largoMaxCm)}`).join("  ·  ")}
                </p>
              )}
            </div>
          </>
        )}

        {/* ── PESTAÑA RESERVAS ────────────────────────────────────────────── */}
        {tab === "reservas" && (
          <div style={card}>
            <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>Reservas</h3>
            <p style={{ fontSize: 13, color: "#6d7175", margin: "0 0 14px" }}>
              Una reserva ocupa stock durante {ttl} minutos desde que el cliente pulsa Comprar.
              Pasado ese tiempo <strong>deja de ocupar sola</strong>, sin que nadie haga nada. Las
              vencidas se resuelven contra Shopify al abrir el índice de stock o en el siguiente
              checkout de esta trama.
            </p>

            {reservas.length === 0 ? (
              <p style={{ fontSize: 13, color: "#6d7175", margin: 0 }}>
                Sin reservas. Es lo esperado hasta la Fase 4: el motor todavía no está conectado al
                checkout.
              </p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 820 }}>
                  <thead>
                    <tr>
                      <th style={th}>Estado</th><th style={th}>Pliego</th><th style={th}>Pedido</th>
                      <th style={th}>Consume</th><th style={th}>Rotada</th>
                      <th style={th}>Draft order</th><th style={th}>Creada</th><th style={th}>Resuelta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...vigentes, ...vencidas, ...reservas.filter((r) => r.estado !== "pendiente")].map((r) => (
                      <tr key={r.id}>
                        <td style={td}>
                          {r.estado === "pendiente" && !r.vencida && <span style={chip("#eaf7ee", "#0b5c2e")}>vigente</span>}
                          {r.estado === "pendiente" && r.vencida && <span style={chip("#fff8e1", "#7a4f01")}>vencida</span>}
                          {r.estado === "confirmada" && <span style={chip("#f1f8ff", "#0070c4")}>confirmada</span>}
                          {r.estado === "anulada" && <span style={chip("#e4e5e7", "#6d7175")}>anulada</span>}
                        </td>
                        <td style={{ ...td, fontWeight: 600 }}>{r.pliegoCodigo}</td>
                        <td style={td}>{r.anchoPedidoCm} × {r.altoPedidoCm} cm</td>
                        <td style={td}>{m(r.largoCm)}</td>
                        <td style={td}>{r.rotada ? "SÍ" : "no"}</td>
                        <td style={{ ...td, fontFamily: "monospace", fontSize: 12 }}>{r.draftOrderId ?? "—"}</td>
                        <td style={td}>{fecha(r.createdAt)}</td>
                        <td style={td}>{r.resueltaAt ? fecha(r.resueltaAt) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── PESTAÑA CORTES (la pantalla del taller) ─────────────────────── */}
        {tab === "cortes" && (
          <div style={card}>
            <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>Cortes — qué rollo le tocó a cada pedido</h3>
            <p style={{ fontSize: 13, color: "#6d7175", margin: "0 0 14px" }}>
              El código de pliego <strong>no se le muestra al cliente</strong> ni viaja en la orden de
              Shopify (decisión 5). Ésta es la única pantalla donde el taller puede cruzar{" "}
              <strong>orden ↔ rollo</strong>. Si la orientación dice ROTADA, la pieza se corta girada
              respecto a como la pidió el cliente.
            </p>

            {cortes.length === 0 ? (
              <p style={{ fontSize: 13, color: "#6d7175", margin: 0 }}>
                Todavía no hay cortes registrados. Se llenará a partir de la Fase 4, cuando el
                checkout empiece a asignar pliego a cada pedido.
              </p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 820 }}>
                  <thead>
                    <tr>
                      <th style={th}>Orden</th><th style={th}>Rollo</th><th style={th}>Medida pedida</th>
                      <th style={th}>Orientación</th><th style={th}>Producto</th>
                      <th style={th}>Estado</th><th style={th}>Fecha</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cortes.map((c) => (
                      <tr key={c.id}>
                        <td style={{ ...td, fontWeight: 600 }}>{c.orderName || c.orderId}</td>
                        <td style={{ ...td, fontWeight: 600 }}>{c.pliegoCodigo || "—"}</td>
                        <td style={td}>{c.anchoCm} × {c.altoCm} cm</td>
                        <td style={td}>
                          {c.rotada
                            ? <span style={chip("#fff8e1", "#7a4f01")}>ROTADA</span>
                            : <span style={chip("#f1f2f3", "#6d7175")}>normal</span>}
                        </td>
                        <td style={td}>{c.productTitle}</td>
                        <td style={td}>{c.estado}</td>
                        <td style={td}>{fecha(c.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── PESTAÑA MOVIMIENTOS ─────────────────────────────────────────── */}
        {tab === "movimientos" && (
          <div style={card}>
            <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>Movimientos — altas y ajustes manuales</h3>
            <p style={{ fontSize: 13, color: "#6d7175", margin: "0 0 14px" }}>
              El consumo por venta no aparece aquí: vive en las reservas. Esto es la auditoría de lo
              que se tocó a mano.
            </p>
            {movimientos.length === 0 ? (
              <p style={{ fontSize: 13, color: "#6d7175", margin: 0 }}>Sin movimientos.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 640 }}>
                  <thead>
                    <tr>
                      <th style={th}>Fecha</th><th style={th}>Rollo</th><th style={th}>Motivo</th>
                      <th style={th}>Δ largo</th><th style={th}>Nota</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movimientos.map((mv) => (
                      <tr key={mv.id}>
                        <td style={td}>{fecha(mv.createdAt)}</td>
                        <td style={{ ...td, fontWeight: 600 }}>{mv.pliegoCodigo}</td>
                        <td style={td}>
                          <span style={chip(
                            mv.motivo === "alta" ? "#eaf7ee" : mv.motivo === "ajuste" ? "#fff8e1" : "#e4e5e7",
                            mv.motivo === "alta" ? "#0b5c2e" : mv.motivo === "ajuste" ? "#7a4f01" : "#6d7175",
                          )}>{mv.motivo}</span>
                        </td>
                        <td style={{ ...td, color: mv.largoCm < 0 ? "#8f1c1c" : "#202223" }}>
                          {mv.motivo === "alta" ? m(mv.largoCm) : mv.largoCm === 0 ? "—" : `${mv.largoCm > 0 ? "+" : ""}${(mv.largoCm / 100).toFixed(2)} m`}
                        </td>
                        <td style={{ ...td, color: "#6d7175" }}>{mv.nota || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
