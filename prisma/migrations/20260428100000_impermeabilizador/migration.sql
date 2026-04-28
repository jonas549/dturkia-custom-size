-- AlterTable: add tipo column to PedidoCustom (default 'medida' para no romper datos existentes)
ALTER TABLE "PedidoCustom" ADD COLUMN "tipo" TEXT NOT NULL DEFAULT 'medida';

-- CreateTable: ReglaImpermeabilizador
CREATE TABLE "ReglaImpermeabilizador" (
    "id"           TEXT NOT NULL,
    "shop"         TEXT NOT NULL,
    "productId"    TEXT NOT NULL,
    "productTitle" TEXT NOT NULL DEFAULT '',
    "activa"       BOOLEAN NOT NULL DEFAULT true,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReglaImpermeabilizador_pkey" PRIMARY KEY ("id")
);

-- CreateTable: VarianteImpermeabilizador
CREATE TABLE "VarianteImpermeabilizador" (
    "id"           TEXT NOT NULL,
    "reglaId"      TEXT NOT NULL,
    "variantId"    TEXT NOT NULL,
    "variantTitle" TEXT NOT NULL DEFAULT '',
    "precio"       DOUBLE PRECISION NOT NULL,
    "aplica"       BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "VarianteImpermeabilizador_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: unique por tienda + producto
CREATE UNIQUE INDEX "ReglaImpermeabilizador_shop_productId_key"
    ON "ReglaImpermeabilizador"("shop", "productId");

-- CreateIndex: unique por regla + variante
CREATE UNIQUE INDEX "VarianteImpermeabilizador_reglaId_variantId_key"
    ON "VarianteImpermeabilizador"("reglaId", "variantId");

-- AddForeignKey: cascade delete variantes al borrar regla
ALTER TABLE "VarianteImpermeabilizador"
    ADD CONSTRAINT "VarianteImpermeabilizador_reglaId_fkey"
    FOREIGN KEY ("reglaId")
    REFERENCES "ReglaImpermeabilizador"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
