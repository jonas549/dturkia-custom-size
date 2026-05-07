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

  return { ok: true, eyebrow, titulo, descripcion, disclaimer, chipTexto };
};

const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4, color: "#202223" };
const inputStyle: React.CSSProperties = { padding: "8px 12px", border: "1px solid #8c9196", borderRadius: 6, fontSize: 14, boxSizing: "border-box" };
const submitBtn: React.CSSProperties  = { background: "#008060", color: "#fff", border: "none", borderRadius: 6, padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer" };

export default function TextosImpermeabilizador() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const saving     = navigation.state === "submitting";

  const textos = actionData?.ok ? actionData : loaderData;

  return (
    <s-page heading="Impermeabilizador — Configuración de textos">
      <s-button slot="primary-action" href="/app/impermeabilizador">
        ← Volver al listado
      </s-button>

      <s-section heading="Textos del checkbox de impermeabilizador">
        <s-paragraph>
          Estos textos aparecen en el bloque del impermeabilizador en la página de producto.
          Usa <strong>{"{precio}"}</strong> en el campo Descripción — el sistema lo reemplaza automáticamente con el precio calculado.
          Si borras <strong>{"{precio}"}</strong> de la descripción, el precio no aparecerá.
        </s-paragraph>

        {actionData?.ok && (
          <div style={{ background: "#d4edda", color: "#155724", border: "1px solid #c3e6cb", borderRadius: 6, padding: "10px 14px", margin: "14px 0", fontSize: 14 }}>
            ✓ Textos guardados correctamente.
          </div>
        )}

        <Form method="post" style={{ marginTop: 16 }}>
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Eyebrow (texto pequeño superior)</label>
            <input
              type="text"
              name="eyebrow"
              defaultValue={textos.eyebrow}
              key={textos.eyebrow}
              style={inputStyle}
              placeholder="CUIDADO · RECOMENDADO"
            />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Título principal</label>
            <input
              type="text"
              name="titulo"
              defaultValue={textos.titulo}
              key={textos.titulo}
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
              defaultValue={textos.descripcion}
              key={textos.descripcion}
              style={inputStyle}
              placeholder="Protector Textil por sólo {precio}"
            />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Disclaimer (texto pequeño inferior)</label>
            <input
              type="text"
              name="disclaimer"
              defaultValue={textos.disclaimer}
              key={textos.disclaimer}
              style={inputStyle}
              placeholder="* Los plazos de entrega pueden ser desde 5 días hábiles"
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Texto del chip de acción</label>
            <input
              type="text"
              name="chipTexto"
              defaultValue={textos.chipTexto}
              key={textos.chipTexto}
              style={{ ...inputStyle, width: 200 }}
              placeholder="AGREGAR"
            />
          </div>

          <button type="submit" style={submitBtn} disabled={saving}>
            {saving ? "Guardando…" : "Guardar textos"}
          </button>
        </Form>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
