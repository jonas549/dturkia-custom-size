-- Rename price columns from per-cm² to per-m² to match new billing formula
ALTER TABLE "ReglaPersonalizada" RENAME COLUMN "precioPorCm2" TO "precioPorM2";
ALTER TABLE "ReglaPersonalizada" RENAME COLUMN "waterproofPorCm2" TO "waterproofPorM2";
