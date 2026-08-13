-- Validación de la Fase 1 — correr DESPUÉS de la migración y de la semilla.
-- Ver BITACORA_STOCK_PLIEGOS_2026-08-12.md — FASE 1 › Validación

-- ---------------------------------------------------------------------------
-- 1. Las tablas y columnas existen (esto se puede correr ya, sin semilla)
-- ---------------------------------------------------------------------------
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('Pliego', 'ReservaPliego', 'MovimientoPliego')
ORDER BY table_name;
-- Esperado: 3 filas → MovimientoPliego, Pliego, ReservaPliego

SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'PedidoCustom'
  AND column_name IN ('pliegoId', 'pliegoCodigo', 'rotada', 'orderName')
ORDER BY column_name;
-- Esperado: 4 filas
--   orderName    | text    | ''::text | NO
--   pliegoCodigo | text    | ''::text | NO
--   pliegoId     | text    | (null)   | YES
--   rotada       | boolean | false    | NO

-- ---------------------------------------------------------------------------
-- 2. Los 11 pliegos de Ceniza (requiere semilla ejecutada)
-- ---------------------------------------------------------------------------
SELECT codigo, "anchoCm", "largoTotalCm", "largoRestanteCm"
FROM "Pliego"
ORDER BY codigo;
-- Esperado: 11 filas
--   CEN-100-01..04 → 100 / 2100 / 2100
--   CEN-300-01..04 → 300 / 2170 / 2170
--   CEN-400-01..03 → 400 / 2010 / 2010

-- ---------------------------------------------------------------------------
-- 3. Suma de metros lineales
-- ---------------------------------------------------------------------------
SELECT
  COUNT(*)                          AS pliegos,
  SUM("largoRestanteCm")            AS total_cm,
  SUM("largoRestanteCm") / 100.0    AS total_m
FROM "Pliego";
-- Esperado: 11 | 23110 | 231.10
--
-- ⚠️ La bitácora §1.5 decía 232.90 m. Es un error aritmético del documento.
--    La suma real del inventario listado es:
--      3 × 2010 = 6030
--      4 × 2170 = 8680
--      4 × 2100 = 8400
--                 -----
--                 23110 cm = 231.10 m
--    Ya corregido en la bitácora.

-- Desglose por ancho (es lo que devolverá `capacidades` en la Fase 5)
SELECT "anchoCm", COUNT(*) AS rollos, MAX("largoRestanteCm") AS largo_max_cm
FROM "Pliego"
WHERE activo AND "largoRestanteCm" > 0
GROUP BY "anchoCm"
ORDER BY "anchoCm";
-- Esperado: 100 | 4 | 2100
--           300 | 4 | 2170
--           400 | 3 | 2010

-- ---------------------------------------------------------------------------
-- 4. El CHECK muerde — debe FALLAR con:
--    ERROR: new row for relation "Pliego" violates check constraint
--           "Pliego_largoRestanteCm_no_negativo"
-- ---------------------------------------------------------------------------
UPDATE "Pliego" SET "largoRestanteCm" = -1 WHERE codigo = 'CEN-100-01';

-- Si por lo que sea NO falla, algo salió mal en la migración. Verificar:
SELECT conname, pg_get_constraintdef(oid) AS definicion
FROM pg_constraint
WHERE conrelid = '"Pliego"'::regclass AND contype = 'c';
-- Esperado: Pliego_largoRestanteCm_no_negativo | CHECK (("largoRestanteCm" >= 0))

-- ---------------------------------------------------------------------------
-- 4b. Prueba del CHECK SIN semilla (se puede correr hoy mismo, no deja rastro)
-- ---------------------------------------------------------------------------
BEGIN;
  INSERT INTO "Pliego" ("id", "shop", "reglaId", "codigo", "anchoCm", "largoTotalCm", "largoRestanteCm")
  SELECT 'tmp_check_test', shop, id, 'TMP-CHECK-01', 100, 1000, -1
  FROM "ReglaPersonalizada" LIMIT 1;
  -- ↑ debe fallar con la violación del CHECK
ROLLBACK;

-- ---------------------------------------------------------------------------
-- 5. La FK Restrict protege las reglas con pliegos vivos — debe FALLAR con:
--    ERROR: update or delete on table "ReglaPersonalizada" violates
--           foreign key constraint "Pliego_reglaId_fkey" on table "Pliego"
-- ---------------------------------------------------------------------------
BEGIN;
  DELETE FROM "ReglaPersonalizada"
  WHERE id = (SELECT "reglaId" FROM "Pliego" LIMIT 1);
ROLLBACK;
