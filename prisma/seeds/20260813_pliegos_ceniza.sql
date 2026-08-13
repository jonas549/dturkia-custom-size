-- Semilla — 11 pliegos físicos de la trama CENIZA
-- Ver BITACORA_STOCK_PLIEGOS_2026-08-12.md §1.5
--
-- Inventario de origen (formato MEDIDA | CANTIDAD | TRAMA):
--   4 X 20.10 M | 3 | Ceniza   → CEN-400-01..03   ancho 400 cm, largo 2010 cm
--   3 X 21.70 M | 4 | Ceniza   → CEN-300-01..04   ancho 300 cm, largo 2170 cm
--   1 X 21.00 M | 4 | Ceniza   → CEN-100-01..04   ancho 100 cm, largo 2100 cm
--
--   Total: 11 rollos · 23110 cm = 231.10 m lineales
--   (3×2010 = 6030) + (4×2170 = 8680) + (4×2100 = 8400) = 23110
--
--   ⚠️ La bitácora §1.5 dice "232.90 m". Es un error aritmético del documento:
--      la suma real del inventario listado es 231.10 m. Corregido aquí y en §1.5.
--
-- ---------------------------------------------------------------------------
-- ⛔ REQUISITO PREVIO — NO SE PUEDE EJECUTAR TODAVÍA (2026-08-13)
--
-- Este script resuelve el reglaId buscando la ReglaPersonalizada de Ceniza por
-- nombre. Al 2026-08-13 esa regla NO EXISTE: la tabla solo tiene 2 reglas de
-- prueba ("Alfombra Medida Personalizada (TEST)" y "Alfombra test 2"), y no hay
-- ningún producto llamado Ceniza con el tag medida-personalizada en la tienda.
--
-- El script está escrito para FALLAR RUIDOSAMENTE (RAISE EXCEPTION) en vez de
-- colgar los 11 pliegos de una regla equivocada. Correrlo hoy aborta sin
-- escribir nada — es seguro intentarlo.
--
-- Para poder sembrar hace falta primero, en este orden:
--   1. Crear el producto "Ceniza" en Shopify con el tag `medida-personalizada`.
--   2. Crear su ReglaPersonalizada en /app/reglas apuntando a ese producto,
--      con "Ceniza" en el nombre.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_shop     TEXT := 'dturkia.myshopify.com';
  v_regla_id TEXT;
  v_n_reglas INT;
  v_insertados INT;
BEGIN
  -- Resolver la regla de Ceniza por nombre.
  SELECT COUNT(*) INTO v_n_reglas
  FROM "ReglaPersonalizada"
  WHERE shop = v_shop AND nombre ILIKE '%ceniza%';

  IF v_n_reglas = 0 THEN
    RAISE EXCEPTION
      'ABORTADO: no existe ninguna ReglaPersonalizada con "ceniza" en el nombre para %. Crear el producto Ceniza + su regla antes de sembrar.',
      v_shop;
  END IF;

  IF v_n_reglas > 1 THEN
    RAISE EXCEPTION
      'ABORTADO: hay % reglas con "ceniza" en el nombre para %. Ambiguo — sembrar a mano con el id correcto.',
      v_n_reglas, v_shop;
  END IF;

  SELECT id INTO v_regla_id
  FROM "ReglaPersonalizada"
  WHERE shop = v_shop AND nombre ILIKE '%ceniza%';

  RAISE NOTICE 'Regla de Ceniza resuelta: %', v_regla_id;

  -- Alta de los 11 pliegos. largoRestanteCm = largoTotalCm (rollos enteros).
  -- ON CONFLICT: re-ejecutar el script no duplica nada (idempotente por shop+codigo).
  INSERT INTO "Pliego" (
    "id", "shop", "reglaId", "codigo",
    "anchoCm", "largoTotalCm", "largoRestanteCm",
    "activo", "nota", "createdAt"
  )
  SELECT
    gen_random_uuid()::TEXT, v_shop, v_regla_id, p.codigo,
    p.ancho, p.largo, p.largo,
    true, '', NOW()
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

  -- Auditoría: un movimiento 'alta' por cada pliego recién creado.
  INSERT INTO "MovimientoPliego" ("id", "shop", "pliegoId", "largoCm", "motivo", "nota", "createdAt")
  SELECT
    gen_random_uuid()::TEXT, v_shop, pl.id, pl."largoTotalCm",
    'alta', 'Semilla inicial Ceniza (rollo entero)', NOW()
  FROM "Pliego" pl
  WHERE pl.shop = v_shop
    AND pl."reglaId" = v_regla_id
    AND NOT EXISTS (
      SELECT 1 FROM "MovimientoPliego" m
      WHERE m."pliegoId" = pl.id AND m.motivo = 'alta'
    );
END $$;
