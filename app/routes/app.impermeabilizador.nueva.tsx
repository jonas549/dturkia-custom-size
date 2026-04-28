import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs, HeadersFunction } from "react-router";
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
  const { session } = await authenticate.admin(request);
  const fd = await request.formData();

  const productIdRaw = String(fd.get("productId") ?? "").trim();
  // Aceptar GID (gid://shopify/Product/X) o ID numérico directo
  const productId = productIdRaw.replace("gid://shopify/Product/", "");
  if (!productId) return { error: "Selecciona un producto." };

  const productTitle = String(fd.get("productTitle") ?? "").trim();
  const activa       = fd.get("activa") === "on";

  // Validación cruzada: no permitir si el producto ya tiene medida personalizada
  const reglaExistente = await prisma.reglaPersonalizada.findFirst({
    where: {
      shop:       session.shop,
      activa:     true,
      productIds: { has: productIdRaw.startsWith("gid://") ? productIdRaw : `gid://shopify/Product/${productId}` },
    },
  });
  if (reglaExistente) {
    return {
      error: `Este producto ya tiene una regla de medidas personalizadas configurada ("${reglaExistente.nombre}"). Un producto no puede tener ambos módulos activos al mismo tiempo.`,
    };
  }

  // Verificar que no exista ya una regla de impermeabilizador para este producto
  const impExistente = await prisma.reglaImpermeabilizador.findFirst({
    where: { shop: session.shop, productId },
  });
  if (impExistente) {
    return { error: "Ya existe una regla de impermeabilizador para este producto. Edítala desde el listado." };
  }

  let variantesData: Array<{ variantId: string; variantTitle: string; aplica: boolean; precio: number }> = [];
  try {
    variantesData = JSON.parse(String(fd.get("variantesData") ?? "[]"));
  } catch {
    return { error: "Datos de variantes inválidos." };
  }

  if (variantesData.length === 0) {
    return { error: "Debes configurar al menos una variante." };
  }

  const regla = await prisma.reglaImpermeabilizador.create({
    data: {
      shop:         session.shop,
      productId,
      productTitle,
      activa,
      variantes: {
        create: variantesData.map((v) => ({
          variantId:    v.variantId.replace("gid://shopify/ProductVariant/", ""),
          variantTitle: v.variantTitle,
          precio:       Number(v.precio) || 0,
          aplica:       !!v.aplica,
        })),
      },
    },
  });

  console.log("[imp.nueva] Regla creada:", regla.id, "productId:", productId, "variantes:", variantesData.length);
  return redirect("/app/impermeabilizador");
};

// ── Estilos ──────────────────────────────────────────────────────────────────
const field: React.CSSProperties    = { marginBottom: 16 };
const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4, color: "#202223" };
const inputStyle: React.CSSProperties = { width: "100%", padding: "8px 12px", border: "1px solid #8c9196", borderRadius: 6, fontSize: 14, boxSizing: "border-box" };
const checkRow: React.CSSProperties   = { display: "flex", alignItems: "center", gap: 8, marginBottom: 16 };
const submitBtn: React.CSSProperties  = { background: "#008060", color: "#fff", border: "none", borderRadius: 6, padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer" };
const cancelBtn: React.CSSProperties  = { background: "transparent", color: "#202223", border: "1px solid #8c9196", borderRadius: 6, padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer" };
const pickerBtn: React.CSSProperties  = { background: "#f1f8ff", color: "#0070c4", border: "1px solid #0070c4", borderRadius: 6, padding: "8px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer" };
const thTd: React.CSSProperties       = { padding: "10px 12px", textAlign: "left", fontSize: 13, borderBottom: "1px solid #e1e3e5" };
// ─────────────────────────────────────────────────────────────────────────────

const PRECIO_IMP_POR_M2 = 13100;

function sugerirPrecio(variantTitle: string): number {
  const match = variantTitle.match(
    /(\d+(?:[.,]\d+)?)\s*(?:cm)?\s*[xX×]\s*(\d+(?:[.,]\d+)?)\s*(?:cm)?/i,
  );
  if (!match) return 0;
  const anchoCm = parseFloat(match[1].replace(",", "."));
  const altoCm  = parseFloat(match[2].replace(",", "."));
  if (!anchoCm || !altoCm) return 0;
  const m2 = Math.ceil(anchoCm / 100) * Math.ceil(altoCm / 100);
  return m2 * PRECIO_IMP_POR_M2;
}

type VariantRow = {
  id: string;         // GID
  title: string;
  aplica: boolean;
  precio: number;
  precioManual: boolean;
};

export default function NuevaReglaImp() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const saving     = navigation.state === "submitting";
  const shopify    = useAppBridge();

  const [producto,  setProducto]  = useState<{ id: string; title: string } | null>(null);
  const [variantes, setVariantes] = useState<VariantRow[]>([]);
  const [activa,    setActiva]    = useState(true);

  const abrirPicker = async () => {
    const seleccion = await (shopify as any).resourcePicker({
      type:     "product",
      multiple: false,
      action:   "select",
    });
    if (!seleccion || seleccion.length === 0) return;
    const p = seleccion[0];
    setProducto({ id: p.id, title: p.title });

    const rows: VariantRow[] = (p.variants || []).map((v: any) => {
      const suggested = sugerirPrecio(v.title || "");
      return {
        id:           v.id,
        title:        v.title || "Sin nombre",
        aplica:       true,
        precio:       suggested,
        precioManual: false,
      };
    });
    setVariantes(rows);
  };

  const toggleAplica = (idx: number) => {
    setVariantes((prev) =>
      prev.map((v, i) => {
        if (i !== idx) return v;
        const newAplica = !v.aplica;
        return {
          ...v,
          aplica: newAplica,
          precio: newAplica && !v.precioManual ? sugerirPrecio(v.title) : v.precio,
        };
      }),
    );
  };

  const setPrecio = (idx: number, val: string) => {
    setVariantes((prev) =>
      prev.map((v, i) =>
        i === idx ? { ...v, precio: Number(val) || 0, precioManual: true } : v,
      ),
    );
  };

  const variantesPayload = variantes.map((v) => ({
    variantId:    v.id,
    variantTitle: v.title,
    aplica:       v.aplica,
    precio:       v.precio,
  }));

  return (
    <s-page heading="Nueva regla de impermeabilizador">
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
          <input type="hidden" name="productId"    value={producto?.id    ?? ""} />
          <input type="hidden" name="productTitle" value={producto?.title ?? ""} />
          <input type="hidden" name="variantesData" value={JSON.stringify(variantesPayload)} />

          {/* Selector de producto */}
          <div style={field}>
            <span style={labelStyle}>Producto</span>
            <div style={{ marginBottom: 10 }}>
              <button type="button" style={pickerBtn} onClick={abrirPicker}>
                {producto ? "Cambiar producto" : "+ Seleccionar producto"}
              </button>
            </div>
            {producto && (
              <div
                style={{
                  padding: "10px 14px",
                  background: "#f1f8ff",
                  border: "1px solid #bcd6f0",
                  borderRadius: 6,
                  fontSize: 14,
                  color: "#202223",
                }}
              >
                <strong>{producto.title}</strong>
                <br />
                <span style={{ fontSize: 12, color: "#6d7175" }}>
                  ID: {producto.id.replace("gid://shopify/Product/", "")}
                </span>
              </div>
            )}
          </div>

          {/* Tabla de variantes */}
          {variantes.length > 0 && (
            <div style={{ ...field, marginTop: 24 }}>
              <span style={labelStyle}>
                Configuración por variante
                <span style={{ fontWeight: 400, color: "#6d7175", marginLeft: 8 }}>
                  (precio sugerido: m² × ${PRECIO_IMP_POR_M2.toLocaleString("es-CL")} CLP, editable)
                </span>
              </span>
              <div style={{ overflowX: "auto", marginTop: 8 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                  <thead>
                    <tr style={{ background: "#f9fafb" }}>
                      <th style={thTd}>Variante</th>
                      <th style={{ ...thTd, width: 80 }}>Aplica</th>
                      <th style={{ ...thTd, width: 180 }}>Precio impermeabilizador (CLP)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {variantes.map((v, idx) => (
                      <tr key={v.id} style={{ borderBottom: "1px solid #f1f2f3" }}>
                        <td style={thTd}>{v.title}</td>
                        <td style={{ ...thTd, textAlign: "center" }}>
                          <input
                            type="checkbox"
                            checked={v.aplica}
                            onChange={() => toggleAplica(idx)}
                            style={{ width: 16, height: 16, cursor: "pointer" }}
                          />
                        </td>
                        <td style={thTd}>
                          <input
                            type="number"
                            min={0}
                            step={100}
                            value={v.aplica ? v.precio : ""}
                            onChange={(e) => setPrecio(idx, e.target.value)}
                            disabled={!v.aplica}
                            style={{
                              ...inputStyle,
                              width: 160,
                              opacity: v.aplica ? 1 : 0.4,
                            }}
                            placeholder={v.aplica ? "Precio CLP" : "—"}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Toggle activa */}
          <div style={checkRow}>
            <input
              id="activa"
              name="activa"
              type="checkbox"
              checked={activa}
              onChange={(e) => setActiva(e.target.checked)}
              style={{ width: 16, height: 16, cursor: "pointer" }}
            />
            <label htmlFor="activa" style={{ fontSize: 14, cursor: "pointer" }}>
              Regla activa
            </label>
          </div>

          {/* Botones */}
          <div style={{ marginTop: 24, display: "flex", gap: 12 }}>
            <button type="submit" style={submitBtn} disabled={saving || !producto}>
              {saving ? "Guardando…" : "Guardar regla"}
            </button>
            <a href="/app/impermeabilizador">
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
