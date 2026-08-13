-- Validación de la Fase 1 — EJECUTADA Y APROBADA el 2026-08-13.
-- Ver BITACORA_STOCK_PLIEGOS_2026-08-12.md — FASE 1 › Validación
--
-- Los 11 pliegos están colgados de la regla de prueba "Alfombra test 2"
-- (id cmoipz5lp0000l704zvl3nx6h). Ceniza NO existe como producto ni como regla:
-- era solo el ejemplo del Excel del cliente. Ver cabecera de la semilla.

-- ---------------------------------------------------------------------------
-- 1. Las tablas y columnas existen
-- ---------------------------------------------------------------------------
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('Pliego', 'ReservaPliego', 'MovimientoPliego')
ORDER BY table_name;
-- ✅ 3 filas → MovimientoPliego, Pliego, ReservaPliego

SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'PedidoCustom'
  AND column_name IN ('pliegoId', 'pliegoCodigo', 'rotada', 'orderName')
ORDER BY column_name;
-- ✅ 4 filas
--   orderName    | text    | ''::text | NO
--   pliegoCodigo | text    | ''::text | NO
--   pliegoId     | text    | (null)   | YES
--   rotada       | boolean | false    | NO

-- ---------------------------------------------------------------------------
-- 2. Los 11 pliegos
-- ---------------------------------------------------------------------------
SELECT codigo, "anchoCm", "largoTotalCm", "largoRestanteCm", activo
FROM "Pliego"
ORDER BY codigo;
-- ✅ 11 filas
--   CEN-100-01..04 → 100 / 2100 / 2100
--   CEN-300-01..04 → 300 / 2170 / 2170
--   CEN-400-01..03 → 400 / 2010 / 2010

-- ---------------------------------------------------------------------------
-- 3. Suma de metros lineales
-- ---------------------------------------------------------------------------
SELECT
  COUNT(*)::INT                        AS pliegos,
  SUM("largoRestanteCm")::INT          AS total_cm,
  ROUND(SUM("largoRestanteCm")/100.0, 2) AS total_m
FROM "Pliego";
-- ✅ 11 | 23110 | 231.10
--
-- ⚠️ La bitácora §1.5 decía 232.90 m. Error aritmético del documento:
--      3 × 2010 = 6030
--      4 × 2170 = 8680
--      4 × 2100 = 8400
--                 -----
--                 23110 cm = 231.10 m
--    Ya corregido en la bitácora.

-- Desglose por ancho (es lo que devolverá `capacidades` en la Fase 5)
SELECT "anchoCm", COUNT(*)::INT AS rollos, MAX("largoRestanteCm")::INT AS largo_max_cm
FROM "Pliego"
WHERE activo AND "largoRestanteCm" > 0
GROUP BY "anchoCm"
ORDER BY "anchoCm";
-- ✅ 100 | 4 | 2100
--    300 | 4 | 2170
--    400 | 3 | 2010

-- Auditoría: un movimiento 'alta' por rollo
SELECT motivo, COUNT(*)::INT AS n, SUM("largoCm")::INT AS total_cm
FROM "MovimientoPliego"
GROUP BY motivo;
-- ✅ alta | 11 | 23110

-- A qué regla están colgados
SELECT r.id, r.nombre, COUNT(p.id)::INT AS pliegos
FROM "ReglaPersonalizada" r
LEFT JOIN "Pliego" p ON p."reglaId" = r.id
GROUP BY r.id, r.nombre
ORDER BY pliegos DESC;
-- ✅ cmoipz5lp0000l704zvl3nx6h | Alfombra test 2                      | 11
--    cmnqgwtlc0000l504w7aeerly | Alfombra Medida Personalizada (TEST) | 0

-- ---------------------------------------------------------------------------
-- 4. El CHECK muerde — debe FALLAR
-- ---------------------------------------------------------------------------
BEGIN;
  UPDATE "Pliego" SET "largoRestanteCm" = -1 WHERE codigo = 'CEN-100-01';
ROLLBACK;
-- ✅ ERROR: new row for relation "Pliego" violates check constraint
--           "Pliego_largoRestanteCm_no_negativo"

SELECT conname, pg_get_constraintdef(oid) AS definicion
FROM pg_constraint
WHERE conrelid = '"Pliego"'::regclass AND contype = 'c';
-- ✅ Pliego_largoRestanteCm_no_negativo | CHECK (("largoRestanteCm" >= 0))

-- ---------------------------------------------------------------------------
-- 5. Las FK Restrict protegen la integridad — las 3 deben FALLAR
-- ---------------------------------------------------------------------------

-- 5a. No se puede borrar una regla con pliegos vivos
BEGIN;
  DELETE FROM "ReglaPersonalizada" WHERE id = 'cmoipz5lp0000l704zvl3nx6h';
ROLLBACK;
-- ✅ ERROR: ... violates foreign key constraint "Pliego_reglaId_fkey" on table "Pliego"

-- 5b. No se puede crear una reserva huérfana
--     (si se pudiera, la SUM de disponibilidad del §5.4 la ignoraría en silencio)
BEGIN;
  INSERT INTO "ReservaPliego" ("id","shop","pliegoId","reglaId","refId","largoCm","anchoPedidoCm","altoPedidoCm")
  VALUES ('tmp_huerfana','dturkia.myshopify.com','pliego_que_no_existe','x','tmp_ref',100,100,100);
ROLLBACK;
-- ✅ ERROR: ... violates foreign key constraint "ReservaPliego_pliegoId_fkey"

-- 5c. Inventario de FK
SELECT tc.table_name, tc.constraint_name, rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_name IN ('Pliego', 'ReservaPliego', 'MovimientoPliego')
ORDER BY tc.table_name;
-- ✅ MovimientoPliego | MovimientoPliego_pliegoId_fkey | RESTRICT
--    Pliego           | Pliego_reglaId_fkey            | RESTRICT
--    ReservaPliego    | ReservaPliego_pliegoId_fkey    | RESTRICT
