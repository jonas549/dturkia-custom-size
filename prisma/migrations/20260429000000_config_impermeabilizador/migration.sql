-- CreateTable: ConfiguracionImpermeabilizador
CREATE TABLE "ConfiguracionImpermeabilizador" (
    "id"         TEXT NOT NULL,
    "shop"       TEXT NOT NULL,
    "costoPorM2" DOUBLE PRECISION NOT NULL DEFAULT 13100,
    "updatedAt"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfiguracionImpermeabilizador_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: unique por tienda
CREATE UNIQUE INDEX "ConfiguracionImpermeabilizador_shop_key"
    ON "ConfiguracionImpermeabilizador"("shop");
