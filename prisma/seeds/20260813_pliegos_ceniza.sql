-- Semilla — 11 pliegos físicos para el MVP del módulo de stock por pliego
-- Ver BITACORA_STOCK_PLIEGOS_2026-08-12.md §1.5
--
-- ---------------------------------------------------------------------------
-- ⚠️ SOBRE "CENIZA" — NO VOLVER A ASUMIR QUE EXISTE
--
-- Ceniza era SOLO el ejemplo del Excel del cliente. NO existe como producto ni
-- como ReglaPersonalizada, y NO se va a crear ahora.
--
-- TODO el MVP y el QA se hacen sobre la regla de prueba ya existente:
--     "Alfombra test 2" · id cmoipz5lp0000l704zvl3nx6h · ACTIVE
--     producto gid://shopify/Product/8557639893127
--
-- Los códigos siguen diciendo CEN-* porque son los del inventario de ejemplo y
-- sirven para el QA. Cuando el MVP se valide, se creará el producto Ceniza real
-- y se reapuntarán estos pliegos a su regla (un UPDATE de "reglaId"). Eso NO es
-- ahora.
-- ---------------------------------------------------------------------------
--
-- Inventario de origen (formato MEDIDA | CANTIDAD | TRAMA):
--   4 X 20.10 M | 3 | Ceniza   → CEN-400-01..03   ancho 400 cm, largo 2010 cm
--   3 X 21.70 M | 4 | Ceniza   → CEN-300-01..04   ancho 300 cm, largo 2170 cm
--   1 X 21.00 M | 4 | Ceniza   → CEN-100-01..04   ancho 100 cm, largo 2100 cm
--
--   Total: 11 rollos · 23110 cm = 231.10 m lineales
--   (3×2010 = 6030) + (4×2170 = 8680) + (4×2100 = 8400) = 23110
--
--   ⚠️ La bitácora §1.5 decía "232.90 m". Error aritmético del documento:
--      la suma real del inventario listado es 231.10 m. Ya corregido.
--
-- Idempotente: re-ejecutarlo no duplica nada (ON CONFLICT por shop+codigo).

DO $$
DECLARE
  v_shop       TEXT := 'dturkia.myshopify.com';
  v_regla_id   TEXT := 'cmoipz5lp0000l704zvl3nx6h';  -- "Alfombra test 2"
  v_nombre     TEXT;
  v_insertados INT;
  v_altas      INT;
BEGIN
  -- Verificar que la regla objetivo existe antes de colgarle nada.
  SELECT nombre INTO v_nombre
  FROM "ReglaPersonalizada"
  WHERE id = v_regla_id AND shop = v_shop;

  IF v_nombre IS NULL THEN
    RAISE EXCEPTION
      'ABORTADO: no existe la ReglaPersonalizada % en %. Verificar el id antes de sembrar.',
      v_regla_id, v_shop;
  END IF;

  RAISE NOTICE 'Sembrando sobre la regla "%" (%)', v_nombre, v_regla_id;

  -- Alta de los 11 pliegos. largoRestanteCm = largoTotalCm (rollos enteros).
  INSERT INTO "Pliego" (
    "id", "shop", "reglaId", "codigo",
    "anchoCm", "largoTotalCm", "largoRestanteCm",
    "activo", "nota", "createdAt"
  )
  SELECT
    gen_random_uuid()::TEXT, v_shop, v_regla_id, p.codigo,
    p.ancho, p.largo, p.largo,
    true, 'Semilla MVP — inventario de ejemplo Ceniza', NOW()
  FROM (VALUES
    ('CEN-400-01', 400, 2010),
    ('CEN-400-02', 400, 2010),
    ('CEN-400-03', 400, 2010),
    ('CEN-300-01', 300, 2170),
    ('CEN-300-02', 300, 2170),
    ('CEN-300-03', 300, 2170),
    ('CEN-300-04', 300, 2170),
    ('CEN-100-01', 100, 2100),
    ('CEN-100-02', 100, 2100),
    ('CEN-100-03', 100, 2100),
    ('CEN-100-04', 100, 2100)
  ) AS p(codigo, ancho, largo)
  ON CONFLICT ("shop", "codigo") DO NOTHING;

  GET DIAGNOSTICS v_insertados = ROW_COUNT;
  RAISE NOTICE 'Pliegos insertados: % (0 = ya estaban)', v_insertados;

  -- Auditoría: un movimiento 'alta' por cada pliego que aún no lo tenga.
  INSERT INTO "MovimientoPliego" ("id", "shop", "pliegoId", "largoCm", "motivo", "nota", "createdAt")
  SELECT
    gen_random_uuid()::TEXT, v_shop, pl.id, pl."largoTotalCm",
    'alta', 'Semilla MVP (rollo entero)', NOW()
  FROM "Pliego" pl
  WHERE pl.shop = v_shop
    AND pl."reglaId" = v_regla_id
    AND NOT EXISTS (
      SELECT 1 FROM "MovimientoPliego" m
      WHERE m."pliegoId" = pl.id AND m.motivo = 'alta'
    );

  GET DIAGNOSTICS v_altas = ROW_COUNT;
  RAISE NOTICE 'Movimientos de alta creados: %', v_altas;
END $$;
