import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const reglas = await prisma.reglaImpermeabilizador.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
    include: { variantes: true },
  });
  return { reglas };
};

const tdStyle = { padding: "12px 16px", verticalAlign: "middle" } as const;
const thStyle = {
  ...tdStyle,
  textAlign: "left" as const,
  fontWeight: 600,
  fontSize: 13,
  color: "#6d7175",
  borderBottom: "1px solid #e1e3e5",
} as const;

export default function ImpermeabilizadorList() {
  const { reglas } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Impermeabilizador — reglas por producto">
      <s-button slot="primary-action" href="/app/impermeabilizador/nueva">
        Nueva regla
      </s-button>

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
                            color: regla.activa ? "#155724" : "#721c24",
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
