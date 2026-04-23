import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [reglasActivas, totalPedidos, ingresoAgg, ultimosPedidos] = await Promise.all([
    prisma.reglaPersonalizada.count({ where: { shop, activa: true } }),
    prisma.pedidoCustom.count({ where: { shop } }),
    prisma.pedidoCustom.aggregate({ where: { shop }, _sum: { precioTotal: true } }),
    prisma.pedidoCustom.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  return {
    reglasActivas,
    totalPedidos,
    ingresoTotal: ingresoAgg._sum.precioTotal ?? 0,
    ultimosPedidos,
  };
};

const fmtClp = (n: number) =>
  new Intl.NumberFormat("es-CL", { style: "decimal", maximumFractionDigits: 0 }).format(n);

const fmtFecha = (d: Date | string) =>
  new Date(d).toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" });

const estadoBadge = (estado: string) => {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    pendiente: { bg: "#fff3cd", color: "#856404", label: "Pendiente" },
    pagado:    { bg: "#d1e7dd", color: "#0a3622", label: "Pagado" },
    cancelado: { bg: "#f8d7da", color: "#58151c", label: "Cancelado" },
  };
  const s = map[estado] ?? map.pendiente;
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 10px",
      borderRadius: "12px",
      fontSize: "0.75em",
      fontWeight: 600,
      background: s.bg,
      color: s.color,
      letterSpacing: "0.3px",
    }}>
      {s.label}
    </span>
  );
};

export default function Dashboard() {
  const { reglasActivas, totalPedidos, ingresoTotal, ultimosPedidos } =
    useLoaderData<typeof loader>();

  return (
    <s-page heading="Custom Size — Panel">
      <s-button slot="primary-action" href="/app/reglas/nueva">
        Nueva regla
      </s-button>

      {/* KPIs */}
      <s-section>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px" }}>
          <div style={kpiCard}>
            <div style={kpiLabel}>Reglas activas</div>
            <div style={kpiValue}>{reglasActivas}</div>
          </div>
          <div style={kpiCard}>
            <div style={kpiLabel}>Pedidos personalizados</div>
            <div style={kpiValue}>{totalPedidos}</div>
          </div>
          <div style={kpiCard}>
            <div style={kpiLabel}>Ingresos totales (CLP)</div>
            <div style={kpiValue}>${fmtClp(ingresoTotal)}</div>
          </div>
        </div>
      </s-section>

      {/* Tabla pedidos */}
      <s-section heading="Últimos 10 pedidos personalizados">
        {ultimosPedidos.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 0", color: "#6d7175" }}>
            <div style={{ fontSize: "2.5em", marginBottom: "12px" }}>📋</div>
            <s-text variant="heading-sm">Aún no hay pedidos</s-text>
            <s-paragraph>
              Los pedidos con medida personalizada aparecerán aquí cuando los clientes completen el widget.
            </s-paragraph>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  {["Fecha", "Producto", "Medidas", "Imperm.", "Precio CLP", "Estado"].map((h) => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ultimosPedidos.map((p, i) => (
                  <tr key={p.id} style={{ background: i % 2 === 0 ? "#fafafa" : "#fff" }}>
                    <td style={tdStyle}>{fmtFecha(p.createdAt)}</td>
                    <td style={{ ...tdStyle, maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.productTitle || "—"}
                    </td>
                    <td style={tdStyle}>{p.ancho} × {p.alto} cm</td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>{p.waterproof ? "Sí" : "No"}</td>
                    <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      ${fmtClp(p.precioTotal)}
                    </td>
                    <td style={tdStyle}>{estadoBadge(p.estado)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </s-section>

      {/* Accesos rápidos */}
      <s-section heading="Accesos rápidos">
        <s-stack direction="inline" gap="base">
          <s-button href="/app/reglas">Ver todas las reglas</s-button>
          <s-button href="/app/reglas/nueva">Crear nueva regla</s-button>
        </s-stack>
      </s-section>
    </s-page>
  );
}

const kpiCard: React.CSSProperties = {
  border: "1px solid #e1e3e5",
  borderRadius: "8px",
  padding: "20px 24px",
  background: "#fff",
};

const kpiLabel: React.CSSProperties = {
  fontSize: "0.8125em",
  color: "#6d7175",
  marginBottom: "8px",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  fontWeight: 500,
};

const kpiValue: React.CSSProperties = {
  fontSize: "2em",
  fontWeight: 700,
  color: "#202223",
  lineHeight: 1.2,
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "0.875em",
};

const thStyle: React.CSSProperties = {
  padding: "10px 14px",
  textAlign: "left",
  fontWeight: 600,
  fontSize: "0.8125em",
  color: "#6d7175",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  borderBottom: "2px solid #e1e3e5",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "12px 14px",
  borderBottom: "1px solid #e1e3e5",
  color: "#202223",
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
