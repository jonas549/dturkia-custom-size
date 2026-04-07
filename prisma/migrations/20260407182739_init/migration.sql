-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReglaPersonalizada" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "minAncho" INTEGER NOT NULL,
    "maxAncho" INTEGER NOT NULL,
    "minAlto" INTEGER NOT NULL,
    "maxAlto" INTEGER NOT NULL,
    "precioPorCm2" DOUBLE PRECISION NOT NULL,
    "waterproofActivo" BOOLEAN NOT NULL DEFAULT true,
    "waterproofPorCm2" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReglaPersonalizada_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PedidoCustom" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "ancho" INTEGER NOT NULL,
    "alto" INTEGER NOT NULL,
    "waterproof" BOOLEAN NOT NULL DEFAULT false,
    "precioTotal" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PedidoCustom_pkey" PRIMARY KEY ("id")
);
