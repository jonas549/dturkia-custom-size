-- Fase 3 — la trama elegida viaja al pedido igual que el borde.
--
-- Aditiva y nullable, exactamente como se hizo con "borde" en
-- 20260507000000_bordes_imp_textos. Los pedidos existentes quedan con NULL.
-- No toca pliegos: `pliegoId`/`pliegoCodigo`/`rotada` siguen igual.

ALTER TABLE "PedidoCustom" ADD COLUMN "trama" TEXT;
