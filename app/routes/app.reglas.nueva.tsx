import { useState } from "react";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  HeadersFunction,
} from "react-router";
import { Form, redirect, useActionData, useNavigation } from "react-router";
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

  const nombre = String(fd.get("nombre") ?? "").trim();
  if (!nombre) return { error: "El nombre es requerido." };

  await prisma.reglaPersonalizada.create({
    data: {
      shop: session.shop,
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
  marginRight: 12,
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
// ────────────────────────────────────────────────────────────────────────────

export default function NuevaRegla() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";

  const [waterproofActivo, setWaterproofActivo] = useState(true);
  const [activa, setActiva] = useState(true);

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
            <label style={label} htmlFor="nombre">
              Nombre interno
            </label>
            <input
              id="nombre"
              name="nombre"
              type="text"
              placeholder="Ej: Alfombra estándar"
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
                defaultValue={50}
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
                defaultValue={500}
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
                defaultValue={50}
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
                defaultValue={500}
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
              defaultValue={0.0025}
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
            <label htmlFor="waterproofActivo" style={{ fontSize: 14, cursor: "pointer" }}>
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
                defaultValue={0.001}
                style={input}
              />
            </div>
          )}

          {/* Precio impermeabilizador hidden (cuando toggle off) */}
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
            <label htmlFor="activa" style={{ fontSize: 14, cursor: "pointer" }}>
              Regla activa
            </label>
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
