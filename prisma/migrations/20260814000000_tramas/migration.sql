-- Sección "Tramas" en la regla — Fase 1 (solo backend/admin)
--
-- Aditiva y sin riesgo: una columna nueva con DEFAULT, igual que se hizo con
-- "bordes" en 20260507000000_bordes_imp_textos. Las filas existentes quedan con
-- '[]' y nada que lea la tabla hoy (bordes, pliegos, /api/precio) se entera.
--
-- Estructura de cada entrada: { "url": "...", "nombre": "..." } — hasta 4.
-- A diferencia de "bordes" NO lleva "tipo". Se guardan los 4 slots tal cual,
-- incluidos los incompletos; filtrar los válidos es responsabilidad de quien lee.

ALTER TABLE "ReglaPersonalizada" ADD COLUMN "tramas" JSONB NOT NULL DEFAULT '[]';
