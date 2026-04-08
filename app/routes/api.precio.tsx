import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") ?? "";
  const ancho = Number(url.searchParams.get("ancho") ?? 0);
  const alto = Number(url.searchParams.get("alto") ?? 0);
  const productId = url.searchParams.get("productId") ?? "";

  console.log("[api.precio] Request recibido:", { shop, productId, ancho, alto });

  if (!shop || ancho <= 0 || alto <= 0) {
    return new Response(
      JSON.stringify({
        error: "Parámetros inválidos. Se requiere shop, ancho y alto.",
      }),
      { status: 400, headers: corsHeaders },
    );
  }

  // Si se envía productId, buscar regla que aplique a ese producto
  // (productIds vacío = aplica a todos; productIds con entradas = solo esos productos)
  console.log("[api.precio] Buscando regla para shop:", shop, "productId:", productId);

  const regla = productId
    ? await prisma.reglaPersonalizada.findFirst({
        where: {
          shop,
          activa: true,
          OR: [
            { productIds: { isEmpty: true } },
            { productIds: { has: productId } },
          ],
        },
      })
    : await prisma.reglaPersonalizada.findFirst({
        where: { shop, activa: true },
      });

  if (!regla) {
    console.log("[api.precio] No se encontró regla activa");
    return new Response(
      JSON.stringify({ error: "No hay regla activa para esta tienda." }),
      { status: 404, headers: corsHeaders },
    );
  }

  console.log("[api.precio] Regla encontrada:", regla);

  const precio = Math.round(ancho * alto * regla.precioPorCm2);
  const waterproofPrecio = Math.round(ancho * alto * regla.waterproofPorCm2);

  return new Response(
    JSON.stringify({
      precio,
      waterproofPrecio,
      waterproofActivo: regla.waterproofActivo,
      // Tarifas por cm² para cálculo local en tiempo real (sin llamadas extra)
      precioPorCm2: regla.precioPorCm2,
      waterproofPorCm2: regla.waterproofPorCm2,
      regla: {
        minAncho: regla.minAncho,
        maxAncho: regla.maxAncho,
        minAlto: regla.minAlto,
        maxAlto: regla.maxAlto,
      },
    }),
    { status: 200, headers: corsHeaders },
  );
};

export default function ApiPrecio() {
  return null;
}
