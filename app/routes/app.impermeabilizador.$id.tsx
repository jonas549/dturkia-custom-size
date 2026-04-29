import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs, HeadersFunction } from "react-router";
import { Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";

// Fórmula compartida servidor + cliente
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

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);

  const [regla, config] = await Promise.all([
    prisma.reglaImpermeabilizador.findFirst({
      where:   { id: params.id, shop: session.shop },
      include: { variantes: { orderBy: { variantTitle: "asc" } } },
    }),
    prisma.configuracionImpermeabilizador.findUnique({
      where: { shop: session.shop },
    }),
  ]);

  if (!regla) throw new Response("Regla no encontrada", { status: 404 });

  const costoPorM2 = config?.costoPorM2 ?? 13100;

  // Cargar variantes actuales del producto desde Shopify (para detectar variantes nuevas)
  let shopifyVariantes: Array<{ id: string; title: string }> = [];
  try {
    const resp = await admin.graphql(
      `#graphql
      query getProductVariants($id: ID!) {
        product(id: $id) {
          title
          variants(first: 100) {
            nodes { id title }
          }
        }
      }`,
      { variables: { id: `gid://shopify/Product/${regla.productId}` } },
    );
    const json = await resp.json();
    shopifyVariantes = (json.data?.product?.variants?.nodes ?? [])
      .filter((n: any) => n?.id)
      .map((n: any) => ({ id: n.id as string, title: n.title as string }));
  } catch (e) {
    console.error("[imp.$id loader] Error cargando variantes de Shopify:", e);
  }

  // Merge: Shopify es la fuente de verdad para IDs y títulos
  const variantesMap: Record<string, { variantTitle: string; aplica: boolean; precio: number }> = {};
  for (const v of regla.variantes) {
    variantesMap[v.variantId] = { variantTitle: v.variantTitle, aplica: v.aplica, precio: v.precio };
  }
  const variantesMerged = shopifyVariantes.map((sv) => {
    const numericId = sv.id.replace("gid://shopify/ProductVariant/", "");
    const stored    = variantesMap[numericId];
    return {
      id:     sv.id,
      title:  sv.title,
      aplica: stored?.aplica ?? true,
      precio: stored?.precio ?? 0,
    };
  });

  return { regla, variantesMerged, costoPorM2 };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const fd = await request.formData();

  if (fd.get("_action") === "delete") {
    await prisma.reglaImpermeabilizador.deleteMany({
      where: { id: params.id, shop: session.shop },
    });
    return redirect("/app/impermeabilizador");
  }

  if (fd.get("_action") === "recalcular") {
    const config = await prisma.configuracionImpermeabilizador.findUnique({
      where: { shop: session.shop },
    });
    const costoPorM2 = config?.costoPorM2 ?? 13100;

    const variantes = await prisma.varianteImpermeabilizador.findMany({
      where: { reglaId: params.id!, aplica: true },
    });

    const updates: { id: string; precio: number }[] = [];
    let omitidas = 0;

    for (const v of variantes) {
      const nuevoPrecio = calcularPrecioImp(v.variantTitle, costoPorM2);
      if (nuevoPrecio > 0) {
        updates.push({ id: v.id, precio: nuevoPrecio });
      } else {
        omitidas++;
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

  // Guardar cambios normales
  const activa = fd.get("activa") === "on";
  let variantesData: Array<{ variantId: string; variantTitle: string; aplica: boolean; precio: number }> = [];
  try {
    variantesData = JSON.parse(String(fd.get("variantesData") ?? "[]"));
  } catch {
    return { error: "Datos de variantes inválidos." };
  }

  await prisma.reglaImpermeabilizador.updateMany({
    where: { id: params.id, shop: session.shop },
    data:  { activa },
  });

  await prisma.varianteImpermeabilizador.deleteMany({ where: { reglaId: params.id! } });
  if (variantesData.length > 0) {
    await prisma.varianteImpermeabilizador.createMany({
      data: variantesData.map((v) => ({
        reglaId:      params.id!,
        variantId:    v.variantId.replace("gid://shopify/ProductVariant/", ""),
        variantTitle: v.variantTitle,
        precio:       Number(v.precio) || 0,
        aplica:       !!v.aplica,
      })),
    });
  }

  return redirect("/app/impermeabilizador");
};

// ── Estilos ──────────────────────────────────────────────────────────────────
const field: React.CSSProperties      = { marginBottom: 16 };
const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4, color: "#202223" };
const inputStyle: React.CSSProperties = { width: "100%", padding: "8px 12px", border: "1px solid #8c9196", borderRadius: 6, fontSize: 14, boxSizing: "border-box" };
const checkRow: React.CSSProperties   = { display: "flex", alignItems: "center", gap: 8, marginBottom: 16 };
const submitBtn: React.CSSProperties  = { background: "#008060", color: "#fff", border: "none", borderRadius: 6, padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer" };
const cancelBtn: React.CSSProperties  = { background: "transparent", color: "#202223", border: "1px solid #8c9196", borderRadius: 6, padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer" };
const deleteBtn: React.CSSProperties  = { background: "transparent", color: "#d82c0d", border: "1px solid #d82c0d", borderRadius: 6, padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer" };
const recalcBtn: React.CSSProperties  = { background: "#f1f8ff", color: "#0070c4", border: "1px solid #0070c4", borderRadius: 6, padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer" };
const thTd: React.CSSProperties       = { padding: "10px 12px", textAlign: "left", fontSize: 13, borderBottom: "1px solid #e1e3e5" };
// ─────────────────────────────────────────────────────────────────────────────

type VariantRow = { id: string; title: string; aplica: boolean; precio: number; precioManual: boolean };

export default function EditarReglaImp() {
  const { regla, variantesMerged, costoPorM2 } = useLoaderData<typeof loader>();
  const actionData  = useActionData<typeof action>();
  const navigation  = useNavigation();

  const isRecalculando = navigation.state === "submitting" && navigation.formData?.get("_action") === "recalcular";
  const isSaving       = navigation.state === "submitting" && !navigation.formData?.get("_action");

  const [activa,    setActiva]    = useState(regla.activa);
  const [variantes, setVariantes] = useState<VariantRow[]>(
    variantesMerged.map((v) => ({ ...v, precioManual: v.precio > 0 })),
  );

  const toggleAplica = (idx: number) => {
    setVariantes((prev) =>
      prev.map((v, i) => {
        if (i !== idx) return v;
        const newAplica = !v.aplica;
        return {
          ...v,
          aplica: newAplica,
          precio: newAplica && !v.precioManual ? calcularPrecioImp(v.title, costoPorM2) : v.precio,
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

  const resultado = actionData?.recalculoResultado;

  return (
    <s-page heading={`Editar impermeabilizador: ${regla.productTitle || regla.productId}`}>
      <s-section>
        {actionData?.error && (
          <div
            style={{
              background: "#fde8e8", color: "#8f1c1c", border: "1px solid #f6b0b0",
              borderRadius: 6, padding: "10px 14px", marginBottom: 20, fontSize: 14,
            }}
          >
            {actionData.error}
          </div>
        )}

        {/* Botón recalcular esta regla */}
        <div style={{ marginBottom: 20, paddingBottom: 16, borderBottom: "1px solid #e1e3e5" }}>
          <Form method="post" style={{ display: "inline" }}>
            <input type="hidden" name="_action" value="recalcular" />
            <button type="submit" style={recalcBtn} disabled={isRecalculando}>
              {isRecalculando ? "⏳ Recalculando…" : `↺ Recalcular esta regla (${costoPorM2.toLocaleString("es-CL")} CLP/m²)`}
            </button>
          </Form>
          <span style={{ fontSize: 12, color: "#6d7175", marginLeft: 10 }}>
            Actualiza los precios de variantes activas usando el costo global configurado.
          </span>

          {resultado && !isRecalculando && (
            <div
              style={{
                marginTop: 10,
                background: resultado.actualizadas > 0 ? "#d4edda" : "#fff3cd",
                color:      resultado.actualizadas > 0 ? "#155724" : "#856404",
                border:    `1px solid ${resultado.actualizadas > 0 ? "#c3e6cb" : "#ffeeba"}`,
                borderRadius: 6,
                padding: "8px 12px",
                fontSize: 13,
              }}
            >
              {resultado.actualizadas > 0
                ? `✓ ${resultado.actualizadas} variante${resultado.actualizadas !== 1 ? "s" : ""} actualizadas a $${resultado.costoPorM2.toLocaleString("es-CL")} CLP/m². Los precios en la tabla se actualizaron — guarda si quieres confirmar.`
                : "No se encontraron variantes activas para recalcular."}
              {resultado.omitidas > 0 && (
                <span style={{ marginLeft: 8, opacity: 0.8 }}>
                  {resultado.omitidas} omitida{resultado.omitidas !== 1 ? "s" : ""} (título sin dimensiones).
                </span>
              )}
            </div>
          )}
        </div>

        <Form method="post">
          <input type="hidden" name="variantesData" value={JSON.stringify(variantesPayload)} />

          <div style={field}>
            <span style={labelStyle}>Producto</span>
            <div
              style={{
                padding: "10px 14px", background: "#f9fafb",
                border: "1px solid #e1e3e5", borderRadius: 6, fontSize: 14, color: "#202223",
              }}
            >
              <strong>{regla.productTitle || "Producto"}</strong>
              <br />
              <span style={{ fontSize: 12, color: "#6d7175" }}>ID: {regla.productId}</span>
            </div>
          </div>

          {variantes.length > 0 && (
            <div style={{ ...field, marginTop: 24 }}>
              <span style={labelStyle}>
                Configuración por variante
                <span style={{ fontWeight: 400, color: "#6d7175", marginLeft: 8 }}>
                  (precio sugerido: m² × ${costoPorM2.toLocaleString("es-CL")} CLP, editable)
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
                            style={{ ...inputStyle, width: 160, opacity: v.aplica ? 1 : 0.4 }}
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

          <div style={{ marginTop: 24, display: "flex", gap: 12 }}>
            <button type="submit" style={submitBtn} disabled={isSaving}>
              {isSaving ? "Guardando…" : "Guardar cambios"}
            </button>
            <a href="/app/impermeabilizador">
              <button type="button" style={cancelBtn}>Cancelar</button>
            </a>
          </div>
        </Form>

        {/* Zona de peligro */}
        <Form
          method="post"
          style={{ marginTop: 40, paddingTop: 24, borderTop: "1px solid #e1e3e5" }}
        >
          <input type="hidden" name="_action" value="delete" />
          <s-paragraph>
            <strong>Zona de peligro:</strong> esta acción elimina la regla y todas sus variantes.
          </s-paragraph>
          <div style={{ marginTop: 12 }}>
            <button
              type="submit"
              style={deleteBtn}
              onClick={(e) => {
                if (!window.confirm("¿Eliminar esta regla de impermeabilizador permanentemente?")) {
                  e.preventDefault();
                }
              }}
            >
              Eliminar regla
            </button>
          </div>
        </Form>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
