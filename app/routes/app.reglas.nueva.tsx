import { useState } from "react";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  HeadersFunction,
} from "react-router";
import { Form, redirect, useActionData, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const fd = await request.formData();

  const nombre = String(fd.get("nombre") ?? "").trim();
  if (!nombre) return { error: "El nombre es requerido." };

  let productIds: string[] = [];
  try {
    productIds = JSON.parse(String(fd.get("productIds") ?? "[]"));
  } catch {
    productIds = [];
  }

  const minAncho    = Number(fd.get("minAncho"));
  const minAlto     = Number(fd.get("minAlto"));
  const precioPorM2 = Number(fd.get("precioPorM2"));

  await prisma.reglaPersonalizada.create({
    data: {
      shop: session.shop,
      nombre,
      minAncho,
      maxAncho: Number(fd.get("maxAncho")),
      minAlto,
      maxAlto: Number(fd.get("maxAlto")),
      precioPorM2,
      waterproofActivo: fd.get("waterproofActivo") === "on",
      waterproofPorM2: Number(fd.get("waterproofPorM2") ?? 0),
      activa: fd.get("activa") === "on",
      productIds,
    },
  });

  if (productIds.length > 0) {
    try {
      const precioDesde     = Math.ceil(minAncho / 100) * Math.ceil(minAlto / 100) * precioPorM2;
      const shopifyValue    = String(Math.round(precioDesde * 100));
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
            metafields: productIds.slice(0, 25).map((pid) => ({
              ownerId:   pid.startsWith("gid://") ? pid : `gid://shopify/Product/${pid}`,
              namespace: "dturkia",
              key:       "precio_desde",
              value:     shopifyValue,
              type:      "number_integer",
            })),
          },
        },
      );
    } catch { /* metafield non-critical */ }
  }

  return redirect("/app/reglas");
};

// ── Estilos compartidos ──────────────────────────────────────────────────────
const field: React.CSSProperties = { marginBottom: 16 };
const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  marginBottom: 4,
  color: "#202223",
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  border: "1px solid #8c9196",
  borderRadius: 6,
  fontSize: 14,
  boxSizing: "border-box",
};
const grid2: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 16,
};
const checkRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 16,
};
const submitBtn: React.CSSProperties = {
  background: "#008060",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  padding: "10px 20px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};
const cancelBtn: React.CSSProperties = {
  background: "transparent",
  color: "#202223",
  border: "1px solid #8c9196",
  borderRadius: 6,
  padding: "10px 20px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};
const pickerBtn: React.CSSProperties = {
  background: "#f1f8ff",
  color: "#0070c4",
  border: "1px solid #0070c4",
  borderRadius: 6,
  padding: "8px 16px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};
const tagStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  background: "#e4e5e7",
  borderRadius: 20,
  padding: "4px 10px",
  fontSize: 13,
  color: "#202223",
  marginRight: 8,
  marginBottom: 8,
};
const tagRemove: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "#6d7175",
  fontSize: 15,
  lineHeight: 1,
  padding: 0,
};
// ────────────────────────────────────────────────────────────────────────────

type Producto = { id: string; title: string };

export default function NuevaRegla() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";
  const shopify = useAppBridge();

  const [waterproofActivo, setWaterproofActivo] = useState(true);
  const [activa, setActiva] = useState(true);
  const [productos, setProductos] = useState<Producto[]>([]);

  const abrirPicker = async () => {
    const seleccion = await (shopify as any).resourcePicker({
      type: "product",
      multiple: true,
      action: "select",
    });
    if (seleccion && seleccion.length > 0) {
      setProductos((prev) => {
        const existingIds = new Set(prev.map((p) => p.id));
        const nuevos = seleccion
          .filter((p: any) => !existingIds.has(p.id))
          .map((p: any) => ({ id: p.id as string, title: p.title as string }));
        return [...prev, ...nuevos];
      });
    }
  };

  const quitarProducto = (id: string) => {
    setProductos((prev) => prev.filter((p) => p.id !== id));
  };

  return (
    <s-page heading="Nueva regla de medidas">
      <s-section>
        {actionData?.error && (
          <div
            style={{
              background: "#fde8e8",
              color: "#8f1c1c",
              border: "1px solid #f6b0b0",
              borderRadius: 6,
              padding: "10px 14px",
              marginBottom: 20,
              fontSize: 14,
            }}
          >
            {actionData.error}
          </div>
        )}

        <Form method="post">
          {/* Nombre */}
          <div style={field}>
            <label style={labelStyle} htmlFor="nombre">
              Nombre interno
            </label>
            <input
              id="nombre"
              name="nombre"
              type="text"
              placeholder="Ej: Alfombra estándar"
              style={inputStyle}
              required
            />
          </div>

          {/* Ancho */}
          <div style={grid2}>
            <div style={field}>
              <label style={labelStyle} htmlFor="minAncho">
                Ancho mínimo (cm)
              </label>
              <input
                id="minAncho"
                name="minAncho"
                type="number"
                min={1}
                defaultValue={50}
                style={inputStyle}
                required
              />
            </div>
            <div style={field}>
              <label style={labelStyle} htmlFor="maxAncho">
                Ancho máximo (cm)
              </label>
              <input
                id="maxAncho"
                name="maxAncho"
                type="number"
                min={1}
                defaultValue={500}
                style={inputStyle}
                required
              />
            </div>
          </div>

          {/* Alto */}
          <div style={grid2}>
            <div style={field}>
              <label style={labelStyle} htmlFor="minAlto">
                Alto mínimo (cm)
              </label>
              <input
                id="minAlto"
                name="minAlto"
                type="number"
                min={1}
                defaultValue={50}
                style={inputStyle}
                required
              />
            </div>
            <div style={field}>
              <label style={labelStyle} htmlFor="maxAlto">
                Alto máximo (cm)
              </label>
              <input
                id="maxAlto"
                name="maxAlto"
                type="number"
                min={1}
                defaultValue={500}
                style={inputStyle}
                required
              />
            </div>
          </div>

          {/* Precio por m² */}
          <div style={field}>
            <label style={labelStyle} htmlFor="precioPorM2">
              Precio por m² (CLP)
            </label>
            <input
              id="precioPorM2"
              name="precioPorM2"
              type="number"
              min={0}
              step="1"
              defaultValue={70000}
              style={inputStyle}
              required
            />
          </div>

          {/* Toggle: impermeabilizador */}
          <div style={checkRow}>
            <input
              id="waterproofActivo"
              name="waterproofActivo"
              type="checkbox"
              checked={waterproofActivo}
              onChange={(e) => setWaterproofActivo(e.target.checked)}
              style={{ width: 16, height: 16, cursor: "pointer" }}
            />
            <label
              htmlFor="waterproofActivo"
              style={{ fontSize: 14, cursor: "pointer" }}
            >
              Activar impermeabilizador
            </label>
          </div>

          {/* Precio impermeabilizador (condicional) */}
          {waterproofActivo && (
            <div style={field}>
              <label style={labelStyle} htmlFor="waterproofPorM2">
                Precio impermeabilizador por m² (CLP)
              </label>
              <input
                id="waterproofPorM2"
                name="waterproofPorM2"
                type="number"
                min={0}
                step="1"
                defaultValue={13100}
                style={inputStyle}
              />
            </div>
          )}
          {!waterproofActivo && (
            <input type="hidden" name="waterproofPorM2" value="0" />
          )}

          {/* Toggle: activa */}
          <div style={checkRow}>
            <input
              id="activa"
              name="activa"
              type="checkbox"
              checked={activa}
              onChange={(e) => setActiva(e.target.checked)}
              style={{ width: 16, height: 16, cursor: "pointer" }}
            />
            <label
              htmlFor="activa"
              style={{ fontSize: 14, cursor: "pointer" }}
            >
              Regla activa
            </label>
          </div>

          {/* Selector de productos */}
          <div style={{ ...field, marginTop: 8 }}>
            <span style={labelStyle}>Productos donde aplica esta regla</span>
            <div style={{ marginBottom: 10 }}>
              <button type="button" style={pickerBtn} onClick={abrirPicker}>
                + Seleccionar productos
              </button>
            </div>
            {productos.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", marginTop: 8 }}>
                {productos.map((p) => (
                  <span key={p.id} style={tagStyle}>
                    {p.title}
                    <button
                      type="button"
                      style={tagRemove}
                      onClick={() => quitarProducto(p.id)}
                      aria-label={`Quitar ${p.title}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            {productos.length === 0 && (
              <p style={{ fontSize: 13, color: "#6d7175", margin: "8px 0 0" }}>
                Sin productos seleccionados — la regla aplicará a todos.
              </p>
            )}
            {/* Hidden input con los IDs serializados */}
            <input
              type="hidden"
              name="productIds"
              value={JSON.stringify(productos.map((p) => p.id))}
            />
          </div>

          {/* Botones */}
          <div style={{ marginTop: 24, display: "flex", gap: 12 }}>
            <button type="submit" style={submitBtn} disabled={saving}>
              {saving ? "Guardando…" : "Guardar regla"}
            </button>
            <a href="/app/reglas">
              <button type="button" style={cancelBtn}>
                Cancelar
              </button>
            </a>
          </div>
        </Form>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
