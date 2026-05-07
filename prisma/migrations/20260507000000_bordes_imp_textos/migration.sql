-- AddColumn: bordes JSON en ReglaPersonalizada
ALTER TABLE "ReglaPersonalizada" ADD COLUMN "bordes" JSONB NOT NULL DEFAULT '[]';

-- AddColumn: borde snapshot en PedidoCustom
ALTER TABLE "PedidoCustom" ADD COLUMN "borde" TEXT;

-- AddColumns: textos configurables del impermeabilizador
ALTER TABLE "ConfiguracionImpermeabilizador"
  ADD COLUMN "eyebrow"     TEXT NOT NULL DEFAULT 'CUIDADO · RECOMENDADO',
  ADD COLUMN "titulo"      TEXT NOT NULL DEFAULT 'Impermeabiliza tu alfombra',
  ADD COLUMN "descripcion" TEXT NOT NULL DEFAULT 'Protector Textil por sólo {precio}',
  ADD COLUMN "disclaimer"  TEXT NOT NULL DEFAULT '* Los plazos de entrega pueden ser desde 5 días hábiles',
  ADD COLUMN "chipTexto"   TEXT NOT NULL DEFAULT 'AGREGAR';
