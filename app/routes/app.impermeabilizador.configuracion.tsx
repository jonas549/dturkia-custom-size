import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs, HeadersFunction } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const config = await prisma.configuracionImpermeabilizador.findUnique({
    where: { shop: session.shop },
  });
  return {
    costoPorM2:  config?.costoPorM2  ?? 13100,
    eyebrow:     config?.eyebrow     ?? "CUIDADO · RECOMENDADO",
    titulo:      config?.titulo      ?? "Impermeabiliza tu alfombra",
    descripcion: config?.descripcion ?? "Protector Textil por sólo {precio}",
    disclaimer:  config?.disclaimer  ?? "* Los plazos de entrega pueden ser desde 5 días hábiles",
    chipTexto:   config?.chipTexto   ?? "AGREGAR",
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const fd = await request.formData();

  if (fd.get("_action") === "guardar-textos") {
    const eyebrow     = String(fd.get("eyebrow")     ?? "CUIDADO · RECOMENDADO").trim();
    const titulo      = String(fd.get("titulo")      ?? "Impermeabiliza tu alfombra").trim();
    const descripcion = String(fd.get("descripcion") ?? "Protector Textil por sólo {precio}").trim();
    const disclaimer  = String(fd.get("disclaimer")  ?? "* Los plazos de entrega pueden ser desde 5 días hábiles").trim();
    const chipTexto   = String(fd.get("chipTexto")   ?? "AGREGAR").trim();

    await prisma.configuracionImpermeabilizador.upsert({
      where:  { shop: session.shop },
      update: { eyebrow, titulo, descripcion, disclaimer, chipTexto },
      create: { shop: session.shop, eyebrow, titulo, descripcion, disclaimer, chipTexto },
    });

    return { ok: true, type: "textos", eyebrow, titulo, descripcion, disclaimer, chipTexto };
  }

  // Default: guardar costo
  const costoPorM2 = Number(fd.get("costoPorM2")) || 13100;
  await prisma.configuracionImpermeabilizador.upsert({
    where:  { shop: session.shop },
    update: { costoPorM2 },
    create: { shop: session.shop, costoPorM2 },
  });

  return { ok: true, type: "costo", costoPorM2 };
};

// ── Estilos ──────────────────────────────────────────────────────────────────
const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4, color: "#202223" };
const inputStyle: React.CSSProperties = { padding: "8px 12px", border: "1px solid #8c9196", borderRadius: 6, fontSize: 14, boxSizing: "border-box" };
const submitBtn: React.CSSProperties  = { background: "#008060", color: "#fff", border: "none", borderRadius: 6, padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer" };
const calcBtn: React.CSSProperties    = { background: "#f1f8ff", color: "#0070c4", border: "1px solid #0070c4", borderRadius: 6, padding: "8px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer" };
const resultBox: React.CSSProperties  = { background: "#f4f6f8", border: "1px solid #d1d5db", borderRadius: 8, padding: "16px 20px", marginTop: 14, fontSize: 14, lineHeight: 2 };
// ─────────────────────────────────────────────────────────────────────────────

export default function ConfiguracionImpermeabilizador() {
  const loaderData                 = useLoaderData<typeof loader>();
  const actionData                 = useActionData<typeof action>();
  const navigation                 = useNavigation();
  const saving                     = navigation.state === "submitting";

  const inicial = loaderData.costoPorM2;
  // Si el action guardó costo exitosamente, usar ese valor para que la calculadora sea coherente sin recargar
  const costoPorM2Efectivo = (actionData?.ok && actionData.type === "costo") ? actionData.costoPorM2 : inicial;

  // Valores actuales de textos (post-save sin recarga)
  const textosActuales = (actionData?.ok && actionData.type === "textos") ? actionData : loaderData;

  const [ancho,     setAncho]     = useState("");
  const [alto,      setAlto]      = useState("");
  const [resultado, setResultado] = useState<{
    anchoN: number; altoN: number;
    m2Real: number; costo: number;
  } | null>(null);

  const calcular = () => {
    const anchoN = parseFloat(ancho) || 0;
    const altoN  = parseFloat(alto)  || 0;
    if (!anchoN || !altoN) return;
    const m2Real = (anchoN / 100) * (altoN / 100);
    const costo  = Math.floor(m2Real * costoPorM2Efectivo);
    setResultado({ anchoN, altoN, m2Real, costo });
  };

  return (
    <s-page heading="Configuración — Impermeabilizador">
      <s-button slot="primary-action" href="/app/impermeabilizador">
        ← Volver al listado
      </s-button>

      {/* ── Costo por m² ── */}
      <s-section heading="Costo global por m²">
        <s-paragraph>
          Este valor se usa como precio sugerido al crear o editar reglas de impermeabilizador.
          Cambiar el valor aquí <strong>no actualiza los precios ya guardados</strong> —
          usa el botón "Recalcular" en el listado o dentro de cada regla.
        </s-paragraph>

        {actionData?.ok && (
          <div
            style={{
              background: "#d4edda", color: "#155724", border: "1px solid #c3e6cb",
              borderRadius: 6, padding: "10px 14px", margin: "14px 0", fontSize: 14,
            }}
          >
            ✓ Configuración guardada. Costo actual: ${actionData.costoPorM2.toLocaleString("es-CL")} CLP/m²
          </div>
        )}

        <Form method="post" style={{ marginTop: 16 }}>
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Costo por m² del impermeabilizador (CLP)</label>
            <input
              type="number"
              name="costoPorM2"
              min={0}
              step={100}
              defaultValue={costoPorM2Efectivo}
              key={costoPorM2Efectivo}
              style={{ ...inputStyle, width: 220 }}
              required
            />
          </div>
          <button type="submit" style={submitBtn} disabled={saving}>
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </Form>
      </s-section>

      {/* ── Configuración de textos ── */}
      <s-section heading="Configuración de textos del checkbox">
        <s-paragraph>
          Estos textos aparecen en el bloque del impermeabilizador en la página de producto.
          Usa <strong>{"{precio}"}</strong> en el campo Descripción — el sistema lo reemplaza automáticamente con el precio calculado.
          Si borras <strong>{"{precio}"}</strong> de la descripción, el precio no aparecerá.
        </s-paragraph>

        {actionData?.ok && actionData.type === "textos" && (
          <div style={{ background: "#d4edda", color: "#155724", border: "1px solid #c3e6cb", borderRadius: 6, padding: "10px 14px", margin: "14px 0", fontSize: 14 }}>
            ✓ Textos guardados correctamente.
          </div>
        )}

        <Form method="post" style={{ marginTop: 16 }}>
          <input type="hidden" name="_action" value="guardar-textos" />

          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Eyebrow (texto pequeño superior)</label>
            <input
              type="text"
              name="eyebrow"
              defaultValue={textosActuales.eyebrow}
              key={textosActuales.eyebrow}
              style={inputStyle}
              placeholder="CUIDADO · RECOMENDADO"
            />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Título principal</label>
            <input
              type="text"
              name="titulo"
              defaultValue={textosActuales.titulo}
              key={textosActuales.titulo}
              style={inputStyle}
              placeholder="Impermeabiliza tu alfombra"
            />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>
              Descripción con precio{" "}
              <span style={{ fontWeight: 400, color: "#6d7175" }}>(usa {"{precio}"} donde va el precio)</span>
            </label>
            <input
              type="text"
              name="descripcion"
              defaultValue={textosActuales.descripcion}
              key={textosActuales.descripcion}
              style={inputStyle}
              placeholder="Protector Textil por sólo {precio}"
            />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Disclaimer (texto pequeño inferior)</label>
            <input
              type="text"
              name="disclaimer"
              defaultValue={textosActuales.disclaimer}
              key={textosActuales.disclaimer}
              style={inputStyle}
              placeholder="* Los plazos de entrega pueden ser desde 5 días hábiles"
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Texto del chip de acción</label>
            <input
              type="text"
              name="chipTexto"
              defaultValue={textosActuales.chipTexto}
              key={textosActuales.chipTexto}
              style={{ ...inputStyle, width: 200 }}
              placeholder="AGREGAR"
            />
          </div>

          <button type="submit" style={submitBtn} disabled={saving}>
            {saving ? "Guardando…" : "Guardar textos"}
          </button>
        </Form>
      </s-section>

      {/* ── Calculadora de ejemplo ── */}
      <s-section heading="Calculadora de ejemplo">
        <s-paragraph>
          Ingresa las medidas de una alfombra para ver la fórmula aplicada paso a paso.
          Usa el costo configurado actualmente: <strong>${costoPorM2Efectivo.toLocaleString("es-CL")} CLP/m²</strong>.
        </s-paragraph>

        <div style={{ display: "flex", gap: 12, marginTop: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <label style={labelStyle}>Ancho (cm)</label>
            <input
              type="number"
              min={1}
              step={1}
              value={ancho}
              onChange={(e) => { setAncho(e.target.value); setResultado(null); }}
              style={{ ...inputStyle, width: 130 }}
              placeholder="ej: 250"
            />
          </div>
          <div>
            <label style={labelStyle}>Alto (cm)</label>
            <input
              type="number"
              min={1}
              step={1}
              value={alto}
              onChange={(e) => { setAlto(e.target.value); setResultado(null); }}
              style={{ ...inputStyle, width: 130 }}
              placeholder="ej: 300"
            />
          </div>
          <button type="button" style={calcBtn} onClick={calcular}>
            Calcular
          </button>
        </div>

        {resultado && (
          <div style={resultBox}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4, color: "#202223" }}>
              Cálculo: {resultado.anchoN} cm × {resultado.altoN} cm
            </div>
            <div>
              m² = {(resultado.anchoN / 100).toFixed(2)} × {(resultado.altoN / 100).toFixed(2)}
              &nbsp;= <strong>{resultado.m2Real.toFixed(2)} m²</strong>
            </div>
            <div>
              Costo = {resultado.m2Real.toFixed(2)} × ${costoPorM2Efectivo.toLocaleString("es-CL")}
              &nbsp;= <strong style={{ color: "#008060", fontSize: 16 }}>
                ${resultado.costo.toLocaleString("es-CL")} CLP
              </strong>
            </div>
          </div>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
