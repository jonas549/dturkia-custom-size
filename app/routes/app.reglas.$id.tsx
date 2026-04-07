import { useState } from "react";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  HeadersFunction,
} from "react-router";
import {
  Form,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const regla = await prisma.reglaPersonalizada.findFirst({
    where: { id: params.id, shop: session.shop },
  });
  if (!regla) throw new Response("Regla no encontrada", { status: 404 });
  return { regla };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const fd = await request.formData();

  if (fd.get("_action") === "delete") {
    await prisma.reglaPersonalizada.deleteMany({
      where: { id: params.id, shop: session.shop },
    });
    return redirect("/app/reglas");
  }

  const nombre = String(fd.get("nombre") ?? "").trim();
  if (!nombre) return { error: "El nombre es requerido." };

  await prisma.reglaPersonalizada.updateMany({
    where: { id: params.id, shop: session.shop },
    data: {
      nombre,
      minAncho: Number(fd.get("minAncho")),
      maxAncho: Number(fd.get("maxAncho")),
      minAlto: Number(fd.get("minAlto")),
      maxAlto: Number(fd.get("maxAlto")),
      precioPorCm2: Number(fd.get("precioPorCm2")),
      waterproofActivo: fd.get("waterproofActivo") === "on",
      waterproofPorCm2: Number(fd.get("waterproofPorCm2") ?? 0),
      activa: fd.get("activa") === "on",
    },
  });

  return redirect("/app/reglas");
};

// ── Shared form styles ──────────────────────────────────────────────────────
const field: React.CSSProperties = { marginBottom: 16 };
const label: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  marginBottom: 4,
  color: "#202223",
};
const input: React.CSSProperties = {
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
const deleteBtn: React.CSSProperties = {
  background: "transparent",
  color: "#d82c0d",
  border: "1px solid #d82c0d",
  borderRadius: 6,
  padding: "10px 20px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};
// ────────────────────────────────────────────────────────────────────────────

export default function EditarRegla() {
  const { regla } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";

  const [waterproofActivo, setWaterproofActivo] = useState(
    regla.waterproofActivo,
  );
  const [activa, setActiva] = useState(regla.activa);

  return (
    <s-page heading={`Editar regla: ${regla.nombre}`}>
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
            <label style={label} htmlFor="nombre">
              Nombre interno
            </label>
            <input
              id="nombre"
              name="nombre"
              type="text"
              defaultValue={regla.nombre}
              style={input}
              required
            />
          </div>

          {/* Ancho */}
          <div style={grid2}>
            <div style={field}>
              <label style={label} htmlFor="minAncho">
                Ancho mínimo (cm)
              </label>
              <input
                id="minAncho"
                name="minAncho"
                type="number"
                min={1}
                defaultValue={regla.minAncho}
                style={input}
                required
              />
            </div>
            <div style={field}>
              <label style={label} htmlFor="maxAncho">
                Ancho máximo (cm)
              </label>
              <input
                id="maxAncho"
                name="maxAncho"
                type="number"
                min={1}
                defaultValue={regla.maxAncho}
                style={input}
                required
              />
            </div>
          </div>

          {/* Alto */}
          <div style={grid2}>
            <div style={field}>
              <label style={label} htmlFor="minAlto">
                Alto mínimo (cm)
              </label>
              <input
                id="minAlto"
                name="minAlto"
                type="number"
                min={1}
                defaultValue={regla.minAlto}
                style={input}
                required
              />
            </div>
            <div style={field}>
              <label style={label} htmlFor="maxAlto">
                Alto máximo (cm)
              </label>
              <input
                id="maxAlto"
                name="maxAlto"
                type="number"
                min={1}
                defaultValue={regla.maxAlto}
                style={input}
                required
              />
            </div>
          </div>

          {/* Precio por cm² */}
          <div style={field}>
            <label style={label} htmlFor="precioPorCm2">
              Precio por cm² ($)
            </label>
            <input
              id="precioPorCm2"
              name="precioPorCm2"
              type="number"
              min={0}
              step="0.0001"
              defaultValue={regla.precioPorCm2}
              style={input}
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
              <label style={label} htmlFor="waterproofPorCm2">
                Precio impermeabilizador por cm² ($)
              </label>
              <input
                id="waterproofPorCm2"
                name="waterproofPorCm2"
                type="number"
                min={0}
                step="0.0001"
                defaultValue={regla.waterproofPorCm2}
                style={input}
              />
            </div>
          )}

          {!waterproofActivo && (
            <input type="hidden" name="waterproofPorCm2" value="0" />
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

          {/* Botones */}
          <div
            style={{
              marginTop: 24,
              display: "flex",
              gap: 12,
              alignItems: "center",
            }}
          >
            <button type="submit" style={submitBtn} disabled={saving}>
              {saving ? "Guardando…" : "Guardar cambios"}
            </button>
            <a href="/app/reglas">
              <button type="button" style={cancelBtn}>
                Cancelar
              </button>
            </a>
          </div>
        </Form>

        {/* Formulario de eliminación separado */}
        <Form method="post" style={{ marginTop: 40, paddingTop: 24, borderTop: "1px solid #e1e3e5" }}>
          <input type="hidden" name="_action" value="delete" />
          <s-paragraph>
            <strong>Zona de peligro:</strong> esta acción no se puede deshacer.
          </s-paragraph>
          <div style={{ marginTop: 12 }}>
            <button
              type="submit"
              style={deleteBtn}
              onClick={(e) => {
                if (!window.confirm("¿Eliminar esta regla permanentemente?")) {
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
