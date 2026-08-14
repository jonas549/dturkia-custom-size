-- ============================================================================
-- STOCK POR TRAMA — ver BITACORA_STOCK_PLIEGOS_2026-08-12.md §4.4
--
-- Hasta ahora `Pliego.reglaId` colgaba los rollos de la REGLA (= el producto),
-- así que todas las tramas de un producto compartían un pozo común. A partir de
-- aquí cada TRAMA tiene su propio inventario de rollos y su propio precio/m².
--
-- Las tramas eran entradas de `ReglaPersonalizada.tramas Json` sin identidad
-- propia; pasan a ser el modelo `Trama` (tabla real con id).
--
-- ⚠️ NINGUNA fila se borra ni se re-clavea. `Pliego` conserva su id, su codigo y
--    su largoRestanteCm: solo gana una columna. Por eso `ReservaPliego`,
--    `MovimientoPliego` y `PedidoCustom` NO se tocan — cuelgan de `pliegoId`, y
--    `pliegoId` no cambia.
--
-- Reversible: DROP COLUMN "tramaId" + DROP TABLE "Trama" y el código anterior
-- vuelve a funcionar sobre datos intactos. Por eso tampoco se borra la columna
-- muerta `ReglaPersonalizada.tramas`.
-- ============================================================================

-- ── 1. La tabla ─────────────────────────────────────────────────────────────
CREATE TABLE "Trama" (
    "id"          TEXT             NOT NULL,
    "shop"        TEXT             NOT NULL,
    "reglaId"     TEXT             NOT NULL,
    "nombre"      TEXT             NOT NULL,
    "url"         TEXT             NOT NULL DEFAULT '',
    "orden"       INTEGER          NOT NULL DEFAULT 0,
    "precioPorM2" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "activa"      BOOLEAN          NOT NULL DEFAULT true,
    "createdAt"   TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Trama_pkey" PRIMARY KEY ("id")
);

-- Restrict: no se puede borrar una regla que tenga tramas. Mismo criterio que
-- Pliego → ReglaPersonalizada (§4.3).
ALTER TABLE "Trama" ADD CONSTRAINT "Trama_reglaId_fkey"
    FOREIGN KEY ("reglaId") REFERENCES "ReglaPersonalizada"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- El nombre es la identidad visible y la que viaja al pedido (PedidoCustom.trama),
-- así que no puede repetirse dentro de una misma regla.
CREATE UNIQUE INDEX "Trama_reglaId_nombre_key" ON "Trama"("reglaId", "nombre");
CREATE INDEX "Trama_shop_reglaId_activa_idx" ON "Trama"("shop", "reglaId", "activa");

-- ── 2. Backfill desde el Json ───────────────────────────────────────────────
-- Una fila por slot con nombre. Los slots vacíos que el admin guarda por
-- comodidad (§2.2 de la bitácora de sesión) se descartan aquí.
-- `WITH ORDINALITY` conserva el orden en que estaban en el selector.
-- El precio arranca igual al de la regla: hasta hoy era el único que había.
INSERT INTO "Trama" ("id", "shop", "reglaId", "nombre", "url", "orden", "precioPorM2", "activa", "createdAt")
SELECT gen_random_uuid()::text,
       r."shop",
       r."id",
       TRIM(t.elem->>'nombre'),
       COALESCE(t.elem->>'url', ''),
       (t.ord - 1)::int,
       r."precioPorM2",
       true,
       NOW()
FROM "ReglaPersonalizada" r,
     LATERAL jsonb_array_elements(r."tramas"::jsonb) WITH ORDINALITY AS t(elem, ord)
WHERE COALESCE(TRIM(t.elem->>'nombre'), '') <> '';

-- ── 3. La columna, nullable de momento ──────────────────────────────────────
ALTER TABLE "Pliego" ADD COLUMN "tramaId" TEXT;

-- ── 4. Asignación de los 11 rollos existentes ───────────────────────────────
-- EXPLÍCITA y con los ids literales, a propósito. Una heurística del tipo "si la
-- regla tiene una sola trama, asigna esa" funcionaría hoy y se rompería callada
-- el día que haya dos. Los 11 rollos son CEN-* y son de Ceniza.
UPDATE "Pliego" p
SET "tramaId" = t."id"
FROM "Trama" t
WHERE t."reglaId" = 'cmoipz5lp0000l704zvl3nx6h'
  AND t."nombre"  = 'Ceniza'
  AND p."reglaId" = 'cmoipz5lp0000l704zvl3nx6h';

-- ── 5. Cerrar el invariante: no hay pliegos sin trama ───────────────────────
-- Este bloque es LA VERIFICACIÓN de la migración, no un trámite: si quedó algún
-- pliego sin asignar, aborta con el detalle en vez de dejar datos a medias.
DO $$
DECLARE
    huerfanos INTEGER;
    detalle   TEXT;
BEGIN
    SELECT COUNT(*), COALESCE(string_agg(DISTINCT "reglaId", ', '), '—')
      INTO huerfanos, detalle
      FROM "Pliego" WHERE "tramaId" IS NULL;

    IF huerfanos > 0 THEN
        RAISE EXCEPTION
          'Migración abortada: % pliego(s) sin trama asignada (reglas: %). Añade el UPDATE explícito para esas reglas antes de continuar.',
          huerfanos, detalle;
    END IF;
END $$;

ALTER TABLE "Pliego" ALTER COLUMN "tramaId" SET NOT NULL;

ALTER TABLE "Pliego" ADD CONSTRAINT "Pliego_tramaId_fkey"
    FOREIGN KEY ("tramaId") REFERENCES "Trama"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- El índice que usa el selector pasa a ser por trama. El de reglaId se conserva
-- para las vistas por regla del admin.
CREATE INDEX "Pliego_shop_tramaId_activo_anchoCm_idx"
    ON "Pliego"("shop", "tramaId", "activo", "anchoCm");

-- ── 6. Alta de la trama Alba y su inventario ────────────────────────────────
-- Precio: el mismo que Ceniza por ahora (placeholder explícito, pendiente de
-- que el cliente confirme el precio real de Alba).
INSERT INTO "Trama" ("id", "shop", "reglaId", "nombre", "url", "orden", "precioPorM2", "activa", "createdAt")
SELECT gen_random_uuid()::text, r."shop", r."id", 'Alba', '', 1, r."precioPorM2", true, NOW()
FROM "ReglaPersonalizada" r
WHERE r."id" = 'cmoipz5lp0000l704zvl3nx6h'
ON CONFLICT ("reglaId", "nombre") DO NOTHING;

-- 11 rollos: 382x2100 (1) · 380x2100 (1) · 378x2040 (1) · 300x2070 (4) · 80x270 (4)
-- largoRestante = largoTotal (rollos enteros), todos activos, código ALB-<ancho>-<NN>.
WITH t AS (
    SELECT "id", "shop", "reglaId" FROM "Trama"
    WHERE "reglaId" = 'cmoipz5lp0000l704zvl3nx6h' AND "nombre" = 'Alba'
),
spec("anchoCm", "largoCm", "cantidad") AS (
    VALUES (382, 2100, 1),
           (380, 2100, 1),
           (378, 2040, 1),
           (300, 2070, 4),
           ( 80,  270, 4)
)
INSERT INTO "Pliego"
    ("id", "shop", "reglaId", "tramaId", "codigo", "anchoCm", "largoTotalCm",
     "largoRestanteCm", "activo", "nota", "createdAt")
SELECT gen_random_uuid()::text, t."shop", t."reglaId", t."id",
       'ALB-' || s."anchoCm" || '-' || LPAD(g::text, 2, '0'),
       s."anchoCm", s."largoCm", s."largoCm", true,
       'Carga inicial de Alba (2026-08-14)', NOW()
FROM t, spec s, LATERAL generate_series(1, s."cantidad") AS g
ON CONFLICT ("shop", "codigo") DO NOTHING;

-- Auditoría: un movimiento 'alta' por rollo, igual que hace `altaMasiva()`.
INSERT INTO "MovimientoPliego" ("id", "shop", "pliegoId", "largoCm", "motivo", "nota", "createdAt")
SELECT gen_random_uuid()::text, p."shop", p."id", p."largoTotalCm", 'alta',
       'Carga inicial de Alba (2026-08-14)', NOW()
FROM "Pliego" p
JOIN "Trama" t ON t."id" = p."tramaId"
WHERE t."reglaId" = 'cmoipz5lp0000l704zvl3nx6h'
  AND t."nombre"  = 'Alba';
