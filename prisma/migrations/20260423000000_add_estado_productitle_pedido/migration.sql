-- AlterTable: agrega estado y productTitle a PedidoCustom
ALTER TABLE "PedidoCustom" ADD COLUMN "estado" TEXT NOT NULL DEFAULT 'pendiente';
ALTER TABLE "PedidoCustom" ADD COLUMN "productTitle" TEXT NOT NULL DEFAULT '';
