import type { LoaderFunctionArgs, ActionFunctionArgs, HeadersFunction } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const reglas = await prisma.reglaPersonalizada.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
  });
  return { reglas };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const fd = await request.formData();

  if (fd.get("_action") !== "sincronizar") return null;

  const reglas = await prisma.reglaPersonalizada.findMany({
    where: { shop: session.shop },
    select: { productIds: true, minAncho: true, minAlto: true, precioPorM2: true, activa: true },
  });

  type MetafieldInput = { ownerId: string; value: string };
  const updates: MetafieldInput[] = [];

  for (const regla of reglas) {
    if (regla.productIds.length === 0) continue;
    const value = regla.activa
      ? String(Math.round(Math.ceil(regla.minAncho / 100) * Math.ceil(regla.minAlto / 100) * regla.precioPorM2 * 100))
      : "0";
    for (const pid of regla.productIds) {
      updates.push({
        ownerId: pid.startsWith("gid://") ? pid : `gid://shopify/Product/${pid}`,
        value,
      });
    }
  }

  if (updates.length === 0) return { sincronizados: 0 };

  for (let i = 0; i < updates.length; i += 25) {
    const chunk = updates.slice(i, i + 25);
    try {
      await admin.graphql(
        `#graphql
        mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields { id }
            userErrors { field message }
          }
        }`,
        {
          variables: {
            metafields: chunk.map((u) => ({
              ownerId:   u.ownerId,
              namespace: "dturkia",
              key:       "precio_desde",
              value:     u.value,
              type:      "number_integer",
            })),
          },
        },
      );
    } catch { /* continue on error */ }
  }

  return { sincronizados: updates.length };
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

export default function ReglasList() {
  const { reglas }    = useLoaderData<typeof loader>();
  const actionData    = useActionData<typeof action>();
  const navigation    = useNavigation();
  const isSincronizando =
    navigation.state === "submitting" &&
    navigation.formData?.get("_action") === "sincronizar";

  return (
    <s-page heading="Reglas de medidas">
      <s-button slot="primary-action" href="/app/reglas/nueva">
        Nueva regla
      </s-button>

      <s-section>
        {reglas.length === 0 ? (
          <s-stack direction="block" gap="base">
            <s-paragraph>No hay reglas creadas todavía.</s-paragraph>
            <s-link href="/app/reglas/nueva">Crear primera regla →</s-link>
          </s-stack>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr>
                  <th style={thStyle}>Nombre</th>
                  <th style={thStyle}>Ancho (min–max cm)</th>
                  <th style={thStyle}>Alto (min–max cm)</th>
                  <th style={thStyle}>Precio/m²</th>
                  <th style={thStyle}>Impermeabilizador</th>
                  <th style={thStyle}>Estado</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {reglas.map((regla, i) => (
                  <tr
                    key={regla.id}
                    style={{
                      borderBottom: "1px solid #f1f2f3",
                      background: i % 2 === 0 ? "#fff" : "#fafbfb",
                    }}
                  >
                    <td style={tdStyle}>{regla.nombre}</td>
                    <td style={tdStyle}>
                      {regla.minAncho}–{regla.maxAncho}
                    </td>
                    <td style={tdStyle}>
                      {regla.minAlto}–{regla.maxAlto}
                    </td>
                    <td style={tdStyle}>${regla.precioPorM2.toLocaleString("es-CL")}/m²</td>
                    <td style={tdStyle}>
                      {regla.waterproofActivo
                        ? `$${regla.waterproofPorM2.toLocaleString("es-CL")}/m²`
                        : "No"}
                    </td>
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
                      <s-link href={`/app/reglas/${regla.id}`}>Editar</s-link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </s-section>

      <s-section>
        <div style={{ borderTop: "1px solid #e1e3e5", paddingTop: 20 }}>
          <p style={{ fontSize: 13, color: "#6d7175", marginBottom: 12 }}>
            Sincroniza el precio mínimo de cada regla como metafield en Shopify para que las
            tarjetas de colección muestren &quot;Desde $X — a medida&quot; en lugar de
            &quot;Precio personalizado&quot;. Ejecuta este botón al instalar la app por primera
            vez o después de modificar reglas existentes.
          </p>

          {isSincronizando && (
            <div style={{ marginBottom: 12 }}>
              <style>{`
                @keyframes csw-sync-fill {
                  from { width: 0% }
                  to   { width: 88% }
                }
                .csw-sync-bar {
                  height: 8px;
                  background: #e4e5e7;
                  border-radius: 4px;
                  overflow: hidden;
                  width: 100%;
                  max-width: 400px;
                }
                .csw-sync-bar-fill {
                  height: 100%;
                  background: #008060;
                  border-radius: 4px;
                  animation: csw-sync-fill 3s ease-out forwards;
                }
              `}</style>
              <p style={{ fontSize: 13, color: "#6d7175", marginBottom: 6 }}>
                Sincronizando metafields…
              </p>
              <div className="csw-sync-bar">
                <div className="csw-sync-bar-fill" />
              </div>
            </div>
          )}

          {actionData && "sincronizados" in actionData && !isSincronizando && (
            <div
              style={{
                background: "#d4edda",
                color: "#155724",
                border: "1px solid #c3e6cb",
                borderRadius: 6,
                padding: "8px 14px",
                fontSize: 13,
                marginBottom: 12,
              }}
            >
              ✓ {actionData.sincronizados} producto
              {actionData.sincronizados !== 1 ? "s" : ""} sincronizado
              {actionData.sincronizados !== 1 ? "s" : ""} correctamente.
            </div>
          )}

          <Form method="post">
            <input type="hidden" name="_action" value="sincronizar" />
            <button
              type="submit"
              disabled={isSincronizando}
              style={{
                background: isSincronizando ? "#e4e5e7" : "#f1f8ff",
                color: isSincronizando ? "#8c9196" : "#0070c4",
                border: `1px solid ${isSincronizando ? "#c9cccf" : "#0070c4"}`,
                borderRadius: 6,
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: 600,
                cursor: isSincronizando ? "not-allowed" : "pointer",
              }}
            >
              {isSincronizando ? "Sincronizando…" : "Sincronizar precios de tarjetas"}
            </button>
          </Form>
        </div>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
