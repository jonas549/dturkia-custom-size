-- Fase 1 — Módulo de control de stock por pliego
-- Ver BITACORA_STOCK_PLIEGOS_2026-08-12.md §4 (modelo de datos)
--
-- MIGRACIÓN ADITIVA PURA: crea 3 tablas nuevas y agrega 4 columnas a PedidoCustom.
-- No modifica ni borra ningún dato existente. Todas las columnas nuevas de
-- PedidoCustom tienen DEFAULT, así que las filas actuales quedan válidas.
--
-- Convención del proyecto: SQL manual, NUNCA `prisma migrate dev`.

-- ---------------------------------------------------------------------------
-- CreateTable: Pliego — un rollo físico individual
-- ---------------------------------------------------------------------------
CREATE TABLE "Pliego" (
    "id"              TEXT NOT NULL,
    "shop"            TEXT NOT NULL,
    "reglaId"         TEXT NOT NULL,
    "codigo"          TEXT NOT NULL,
    "anchoCm"         INTEGER NOT NULL,
    "largoTotalCm"    INTEGER NOT NULL,
    "largoRestanteCm" INTEGER NOT NULL,
    "activo"          BOOLEAN NOT NULL DEFAULT true,
    "nota"            TEXT NOT NULL DEFAULT '',
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pliego_pkey" PRIMARY KEY ("id")
);

-- Red de seguridad final a nivel DB: el largo restante nunca puede ser negativo.
ALTER TABLE "Pliego"
    ADD CONSTRAINT "Pliego_largoRestanteCm_no_negativo"
    CHECK ("largoRestanteCm" >= 0);

-- ---------------------------------------------------------------------------
-- CreateTable: ReservaPliego — ocupación temporal (15 min) o confirmada
-- ---------------------------------------------------------------------------
CREATE TABLE "ReservaPliego" (
    "id"            TEXT NOT NULL,
    "shop"          TEXT NOT NULL,
    "pliegoId"      TEXT NOT NULL,
    "reglaId"       TEXT NOT NULL,
    "refId"         TEXT NOT NULL,
    "largoCm"       INTEGER NOT NULL,
    "anchoPedidoCm" INTEGER NOT NULL,
    "altoPedidoCm"  INTEGER NOT NULL,
    "rotada"        BOOLEAN NOT NULL DEFAULT false,
    "estado"        TEXT NOT NULL DEFAULT 'pendiente',
    "draftOrderId"  TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resueltaAt"    TIMESTAMP(3),

    CONSTRAINT "ReservaPliego_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- CreateTable: MovimientoPliego — auditoría de altas y ajustes manuales
-- ---------------------------------------------------------------------------
CREATE TABLE "MovimientoPliego" (
    "id"        TEXT NOT NULL,
    "shop"      TEXT NOT NULL,
    "pliegoId"  TEXT NOT NULL,
    "largoCm"   INTEGER NOT NULL,
    "motivo"    TEXT NOT NULL,
    "nota"      TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovimientoPliego_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- Índices
-- ---------------------------------------------------------------------------

-- Código de pliego único por tienda
CREATE UNIQUE INDEX "Pliego_shop_codigo_key"
    ON "Pliego"("shop", "codigo");

-- Índice que usa el selector de la sentencia atómica (§5.4)
CREATE INDEX "Pliego_shop_reglaId_activo_anchoCm_idx"
    ON "Pliego"("shop", "reglaId", "activo", "anchoCm");

-- Idempotencia: un refId (= id del item de localStorage) reserva una sola vez.
-- Es lo que hace que el ON CONFLICT (refId) DO NOTHING del checkout funcione.
CREATE UNIQUE INDEX "ReservaPliego_refId_key"
    ON "ReservaPliego"("refId");

-- Índice del cálculo de disponibilidad (SUM de reservas pendientes no vencidas)
CREATE INDEX "ReservaPliego_pliegoId_estado_createdAt_idx"
    ON "ReservaPliego"("pliegoId", "estado", "createdAt");

-- ---------------------------------------------------------------------------
-- AddForeignKey: no se puede borrar una regla que tenga pliegos vivos
-- ---------------------------------------------------------------------------
ALTER TABLE "Pliego"
    ADD CONSTRAINT "Pliego_reglaId_fkey"
    FOREIGN KEY ("reglaId")
    REFERENCES "ReglaPersonalizada"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- AlterTable: PedidoCustom — asignación de pliego (§4.2)
-- ---------------------------------------------------------------------------
ALTER TABLE "PedidoCustom"
    ADD COLUMN "pliegoId"     TEXT,
    ADD COLUMN "pliegoCodigo" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "rotada"       BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "orderName"    TEXT NOT NULL DEFAULT '';
