import type { ActionFunctionArgs, LoaderFunctionArgs, HeadersFunction } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";

// Replica exacta de la fórmula del cliente — funciona en servidor y en browser
function calcularPrecioImp(variantTitle: string, costoPorM2: number): number {
  const match = variantTitle.match(
    /(\d+(?:[.,]\d+)?)\s*(?:cm)?\s*[xX×]\s*(\d+(?:[.,]\d+)?)\s*(?:cm)?/i,
  );
  if (!match) return 0;
  const anchoCm = parseFloat(match[1].replace(",", "."));
  const altoCm  = parseFloat(match[2].replace(",", "."));
  if (!anchoCm || !altoCm) return 0;
  return Math.ceil(anchoCm / 100) * Math.ceil(altoCm / 100) * costoPorM2;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [reglas, config] = await Promise.all([
    prisma.reglaImpermeabilizador.findMany({
      where:     { shop: session.shop },
      orderBy:   { createdAt: "desc" },
      include:   { variantes: true },
    }),
    prisma.configuracionImpermeabilizador.findUnique({
      where: { shop: session.shop },
    }),
  ]);
  return { reglas, costoPorM2: config?.costoPorM2 ?? 13100 };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const fd = await request.formData();

  if (fd.get("_action") === "recalcularTodo") {
    const config = await prisma.configuracionImpermeabilizador.findUnique({
      where: { shop: session.shop },
    });
    const costoPorM2 = config?.costoPorM2 ?? 13100;

    const reglas = await prisma.reglaImpermeabilizador.findMany({
      where:   { shop: session.shop, activa: true },
      include: { variantes: { where: { aplica: true } } },
    });

    const updates: { id: string; precio: number }[] = [];
    let omitidas = 0;

    for (const regla of reglas) {
      for (const variante of regla.variantes) {
        const nuevoPrecio = calcularPrecioImp(variante.variantTitle, costoPorM2);
        if (nuevoPrecio > 0) {
          updates.push({ id: variante.id, precio: nuevoPrecio });
        } else {
          omitidas++;
        }
      }
    }

    if (updates.length > 0) {
      await prisma.$transaction(
        updates.map((u) =>
          prisma.varianteImpermeabilizador.update({
            where: { id: u.id },
            data:  { precio: u.precio },
          }),
        ),
      );
    }

    return { recalculoResultado: { actualizadas: updates.length, omitidas, costoPorM2 } };
  }

  return null;
};

// ── Estilos ──────────────────────────────────────────────────────────────────
const tdStyle: React.CSSProperties = { padding: "12px 16px", verticalAlign: "middle" };
const thStyle: React.CSSProperties = {
  ...tdStyle,
  textAlign: "left" as const,
  fontWeight: 600,
  fontSize: 13,
  color: "#6d7175",
  borderBottom: "1px solid #e1e3e5",
};
const recalcBtn: React.CSSProperties = {
  background: "#f4f6f8",
  color: "#202223",
  border: "1px solid #8c9196",
  borderRadius: 6,
  padding: "10px 20px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  width: "100%",
};
const recalcBtnActive: React.CSSProperties = { ...recalcBtn, opacity: 0.6, cursor: "not-allowed" };
// ─────────────────────────────────────────────────────────────────────────────

const PROGRESS_BAR_CSS = `
@keyframes csw-progress {
  from { width: 5%; }
  to   { width: 88%; }
}
.csw-progress-fill {
  height: 100%;
  background: #008060;
  border-radius: 4px;
  animation: csw-progress 3.5s ease-out forwards;
}
`;

export default function ImpermeabilizadorList() {
  const { reglas, costoPorM2 }  = useLoaderData<typeof loader>();
  const actionData               = useActionData<typeof action>();
  const navigation               = useNavigation();

  const isRecalculando =
    navigation.state === "submitting" &&
    navigation.formData?.get("_action") === "recalcularTodo";

  const resultado = actionData?.recalculoResultado;

  return (
    <s-page heading="Impermeabilizador — reglas por producto">
      <s-button slot="primary-action" href="/app/impermeabilizador/nueva">
        Nueva regla
      </s-button>

      {/* ── Bloque de acciones globales ── */}
      <s-section>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
          <s-link href="/app/impermeabilizador/configuracion">
            ⚙ Configuración (costo por m²: ${costoPorM2.toLocaleString("es-CL")} CLP)
          </s-link>
        </div>

        {/* Recalcular todas */}
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #e1e3e5" }}>
          <Form method="post">
            <input type="hidden" name="_action" value="recalcularTodo" />
            <button
              type="submit"
              style={isRecalculando ? recalcBtnActive : recalcBtn}
              disabled={isRecalculando}
            >
              {isRecalculando ? "⏳ Recalculando…" : "↺ Recalcular precios de todas las reglas"}
            </button>
          </Form>

          {/* Progress bar animada */}
          {isRecalculando && (
            <>
              <style>{PROGRESS_BAR_CSS}</style>
              <div
                style={{
                  background: "#e1e3e5", borderRadius: 4, height: 8,
                  overflow: "hidden", margin: "12px 0",
                }}
              >
                <div className="csw-progress-fill" />
              </div>
              <p style={{ fontSize: 13, color: "#6d7175", margin: 0 }}>
                Recalculando variantes de todas las reglas activas con el costo configurado…
              </p>
            </>
          )}

          {/* Resultado */}
          {resultado && !isRecalculando && (
            <div
              style={{
                marginTop: 12,
                background: resultado.actualizadas > 0 ? "#d4edda" : "#fff3cd",
                color:      resultado.actualizadas > 0 ? "#155724" : "#856404",
                border:    `1px solid ${resultado.actualizadas > 0 ? "#c3e6cb" : "#ffeeba"}`,
                borderRadius: 6,
                padding: "10px 14px",
                fontSize: 14,
              }}
            >
              {resultado.actualizadas > 0
                ? `✓ ${resultado.actualizadas} variante${resultado.actualizadas !== 1 ? "s" : ""} actualizadas con $${resultado.costoPorM2.toLocaleString("es-CL")} CLP/m².`
                : "No se encontraron variantes activas para recalcular."}
              {resultado.omitidas > 0 && (
                <span style={{ marginLeft: 8, opacity: 0.8 }}>
                  {resultado.omitidas} omitida{resultado.omitidas !== 1 ? "s" : ""} (título sin dimensiones detectables).
                </span>
              )}
            </div>
          )}
        </div>
      </s-section>

      {/* ── Tabla de reglas ── */}
      <s-section>
        {reglas.length === 0 ? (
          <s-stack direction="block" gap="base">
            <s-paragraph>No hay reglas creadas todavía.</s-paragraph>
            <s-link href="/app/impermeabilizador/nueva">Crear primera regla →</s-link>
          </s-stack>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr>
                  <th style={thStyle}>Producto</th>
                  <th style={thStyle}>Variantes configuradas</th>
                  <th style={thStyle}>Variantes activas</th>
                  <th style={thStyle}>Estado</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {reglas.map((regla, i) => {
                  const activas = regla.variantes.filter((v) => v.aplica).length;
                  const total   = regla.variantes.length;
                  return (
                    <tr
                      key={regla.id}
                      style={{
                        borderBottom: "1px solid #f1f2f3",
                        background: i % 2 === 0 ? "#fff" : "#fafbfb",
                      }}
                    >
                      <td style={tdStyle}>
                        <strong>{regla.productTitle || regla.productId}</strong>
                        <br />
                        <span style={{ fontSize: 12, color: "#6d7175" }}>ID: {regla.productId}</span>
                      </td>
                      <td style={tdStyle}>{total}</td>
                      <td style={tdStyle}>{activas}</td>
                      <td style={tdStyle}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 10px",
                            borderRadius: 12,
                            fontSize: 12,
                            fontWeight: 600,
                            background: regla.activa ? "#d4edda" : "#f8d7da",
                            color:      regla.activa ? "#155724" : "#721c24",
                          }}
                        >
                          {regla.activa ? "Activa" : "Inactiva"}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <s-link href={`/app/impermeabilizador/${regla.id}`}>Editar</s-link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
