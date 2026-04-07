import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") ?? "";
  const ancho = Number(url.searchParams.get("ancho") ?? 0);
  const alto = Number(url.searchParams.get("alto") ?? 0);

  if (!shop || ancho <= 0 || alto <= 0) {
    return new Response(
      JSON.stringify({ error: "Parámetros inválidos. Se requiere shop, ancho y alto." }),
      { status: 400, headers: corsHeaders },
    );
  }

  const regla = await prisma.reglaPersonalizada.findFirst({
    where: { shop, activa: true },
  });

  if (!regla) {
    return new Response(
      JSON.stringify({ error: "No hay regla activa para esta tienda." }),
      { status: 404, headers: corsHeaders },
    );
  }

  const precio = ancho * alto * regla.precioPorCm2;
  const waterproofPrecio = ancho * alto * regla.waterproofPorCm2;

  return new Response(
    JSON.stringify({
      precio: Math.round(precio),
      waterproofPrecio: Math.round(waterproofPrecio),
      waterproofActivo: regla.waterproofActivo,
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

// Este componente no se renderiza — la ruta es solo un endpoint de API.
export default function ApiPrecio() {
  return null;
}
