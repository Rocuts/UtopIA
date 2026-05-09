-- ---------------------------------------------------------------------------
-- 0006_nasty_darwin — firmas dinámicas en `workspaces` (Modo Élite NIIF).
-- ---------------------------------------------------------------------------
-- drizzle-kit generó originalmente esta migración como un mega-snapshot que
-- intentaba CREATE TYPE / CREATE TABLE / ADD CONSTRAINT para infraestructura
-- pre-existente en producción (tax_regime_kind, sentinel_*, erp_account_mapping,
-- etc.) — todo eso ya vive en la DB desde migraciones 0001..0005 + DDL manual.
-- Aplicar el snapshot completo fallaba con `42710 — type already exists`.
--
-- Reducimos la migración a sus 5 únicos ADD COLUMN nuevos: las columnas que
-- soportan el bloque de firmas dinámicas (Ley 43/1990 art. 10/13) consumido
-- por `loadSignatoriesForWorkspace()` y `renderSignatureBlock()` en el
-- pipeline de fiscal-opinion. `IF NOT EXISTS` mantiene la migración
-- idempotente y respeta la convención de las migraciones 0003/0005.
-- ---------------------------------------------------------------------------

ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "representante_legal_nombre" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "revisor_fiscal_nombre" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "revisor_fiscal_tp" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "contador_publico_nombre" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "contador_publico_tp" text;
