-- ---------------------------------------------------------------------------
-- 0022 — Integridad del libro mayor (auditoría WP10, handcrafted)
-- ---------------------------------------------------------------------------
--
-- 1. REVERSOS (contab-nomina-01). El original de un reverso conserva
--    status='posted' y sólo recibe reversed_by_entry_id: original + reverso
--    netean a cero en TODOS los lectores que filtran status='posted' (vista
--    de pilares, consultas del mayor, cierre, conciliación, forense, hash).
--    Antes el original pasaba a 'reversed', salía de esos filtros y el
--    reverso quedaba solo (efecto neto −original). Backfill: las filas
--    'reversed' vuelven a 'posted'. El valor del enum se conserva por
--    compatibilidad pero ya no se produce.
--
-- 2. INMUTABILIDAD EN BD (contab-nomina-13). Transiciones permitidas:
--      draft  → draft | posted (posted sólo con período 'open')
--      posted → posted  únicamente para enlazar reversed_by_entry_id
--               (NULL → valor) y subir version; ningún otro campo cambia.
--    Cualquier otra (posted→draft, cambios de cifras, etc.) se rechaza.
--    DELETE de asientos y UPDATE/DELETE de líneas sólo sobre borradores.
--    Los borrados en cascada (p. ej. al eliminar un workspace) se permiten
--    (pg_trigger_depth() > 1).
--
-- 3. VISTA DE PILARES (contab-nomina-04). Excluye asientos source_type
--    'closing': el traslado de resultados a patrimonio (cierre anual,
--    período 13) no debe anular el P&G del período reportado.
--
-- 4. IDEMPOTENCIA DE AJUSTES AUTOMÁTICOS (contab-nomina-05). Índice único
--    parcial sobre (workspace, source_type, source_ref) para asientos vivos
--    generados por depreciación/amortización/provisiones/cierre. Si ya hay
--    duplicados históricos el índice no se crea (NOTICE) y rige el control
--    de la aplicación (createEntry idempotentBySource en TX serializable).
--
-- 5. CONCILIACIÓN 1:1 (contab-nomina-10). Una línea contable sólo puede
--    conciliar un movimiento bancario. Los emparejamientos duplicados
--    existentes se liberan (se conserva el manual o el más antiguo) antes de
--    crear el índice único parcial.
--
-- 6. CONCILIACIÓN (contab-nomina-09). bank_reconciliations.bank_balance y
--    difference admiten NULL: sin extracto del período no hay diferencia.
--
-- Idempotente: CREATE OR REPLACE / IF NOT EXISTS / DROP TRIGGER IF EXISTS.
-- ---------------------------------------------------------------------------

-- 1. Backfill ANTES de reemplazar el trigger (el trigger viejo permite
--    reversed → posted porque sólo bloquea posted → posted).
UPDATE journal_entries SET status = 'posted' WHERE status = 'reversed';
--> statement-breakpoint

-- 2a. journal_entries: transiciones estrictas.
CREATE OR REPLACE FUNCTION assert_je_immutable() RETURNS TRIGGER AS $$
DECLARE p_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'draft' OR pg_trigger_depth() > 1 THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Posted journal entries cannot be deleted. Use a reversal entry instead.';
  END IF;

  IF OLD.status = 'draft' THEN
    IF NEW.status = 'draft' THEN
      RETURN NEW;
    END IF;
    IF NEW.status = 'posted' THEN
      SELECT ap.status INTO p_status FROM accounting_periods ap WHERE ap.id = NEW.period_id;
      IF p_status IS DISTINCT FROM 'open' THEN
        RAISE EXCEPTION 'Cannot post a journal entry into a % period.', coalesce(p_status, 'missing');
      END IF;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Invalid journal entry transition draft -> %.', NEW.status;
  END IF;

  IF OLD.status = 'posted' THEN
    IF NEW.status = 'posted'
       AND OLD.reversed_by_entry_id IS NULL
       AND NEW.reversed_by_entry_id IS NOT NULL
       AND (to_jsonb(NEW) - 'reversed_by_entry_id' - 'version')
           = (to_jsonb(OLD) - 'reversed_by_entry_id' - 'version') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Posted journal entries are immutable. Use a reversal entry instead.';
  END IF;

  RAISE EXCEPTION 'Journal entry in status % is immutable.', OLD.status;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS journal_entries_immutable ON journal_entries;
--> statement-breakpoint
CREATE TRIGGER journal_entries_immutable
BEFORE UPDATE ON journal_entries
FOR EACH ROW EXECUTE FUNCTION assert_je_immutable();
--> statement-breakpoint
DROP TRIGGER IF EXISTS journal_entries_no_delete ON journal_entries;
--> statement-breakpoint
CREATE TRIGGER journal_entries_no_delete
BEFORE DELETE ON journal_entries
FOR EACH ROW EXECUTE FUNCTION assert_je_immutable();
--> statement-breakpoint

-- 2b. journal_lines: sólo se modifican/borran líneas de borradores.
CREATE OR REPLACE FUNCTION assert_jl_mutable() RETURNS TRIGGER AS $$
DECLARE e_status text;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  SELECT je.status INTO e_status FROM journal_entries je WHERE je.id = OLD.entry_id;
  IF e_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'journal_lines of a % entry are immutable.', coalesce(e_status, 'missing');
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.entry_id IS DISTINCT FROM OLD.entry_id THEN
      SELECT je.status INTO e_status FROM journal_entries je WHERE je.id = NEW.entry_id;
      IF e_status IS DISTINCT FROM 'draft' THEN
        RAISE EXCEPTION 'Cannot move journal_lines into a % entry.', coalesce(e_status, 'missing');
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS journal_lines_immutable ON journal_lines;
--> statement-breakpoint
CREATE TRIGGER journal_lines_immutable
BEFORE UPDATE OR DELETE ON journal_lines
FOR EACH ROW EXECUTE FUNCTION assert_jl_mutable();
--> statement-breakpoint

-- 3. Vista de pilares sin asientos de cierre.
CREATE OR REPLACE VIEW "pillar_kpis_view" AS
SELECT
  je.workspace_id,
  je.period_id,
  COUNT(DISTINCT je.id)::integer AS posted_entries_count,
  COALESCE(
    SUM(
      CASE
        WHEN coa.code LIKE '24%'
        THEN jl.credit - jl.debit
        ELSE 0
      END
    ),
    0
  )::numeric(20, 2) AS resiliencia_total_provision_taxes_cop,
  (
    COALESCE(
      SUM(
        CASE
          WHEN coa.code LIKE '4%'
          THEN jl.credit - jl.debit
          ELSE 0
        END
      ),
      0
    )
    - COALESCE(
      SUM(
        CASE
          WHEN coa.code LIKE '5%' OR coa.code LIKE '6%' OR coa.code LIKE '7%'
          THEN jl.debit - jl.credit
          ELSE 0
        END
      ),
      0
    )
  )::numeric(20, 2) AS valor_ebitda_cop,
  (
    COALESCE(
      SUM(
        CASE
          WHEN coa.code LIKE '1105%' OR coa.code LIKE '1110%'
          THEN jl.debit - jl.credit
          ELSE 0
        END
      ),
      0
    )
    - COALESCE(
      SUM(
        CASE
          WHEN coa.code LIKE '21%'
          THEN jl.credit - jl.debit
          ELSE 0
        END
      ),
      0
    )
  )::numeric(20, 2) AS futuro_free_cash_flow_cop
FROM journal_entries je
INNER JOIN journal_lines jl ON jl.entry_id = je.id
INNER JOIN chart_of_accounts coa ON coa.id = jl.account_id
WHERE je.status = 'posted'
  AND je.source_type <> 'closing'
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries o
    WHERE o.id = je.reversal_of_entry_id AND o.source_type = 'closing'
  )
GROUP BY je.workspace_id, je.period_id;
--> statement-breakpoint

-- 4. Idempotencia de asientos automáticos (sólo si no hay duplicados vivos).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM journal_entries
    WHERE status = 'posted'
      AND reversed_by_entry_id IS NULL
      AND source_type IN ('depreciation', 'adjustment', 'closing')
      AND (source_ref LIKE 'period:%' OR source_ref LIKE 'fiscal-year:%')
    GROUP BY workspace_id, source_type, source_ref
    HAVING COUNT(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS je_auto_source_live_uniq
      ON journal_entries (workspace_id, source_type, source_ref)
      WHERE status = 'posted'
        AND reversed_by_entry_id IS NULL
        AND source_type IN ('depreciation', 'adjustment', 'closing')
        AND (source_ref LIKE 'period:%' OR source_ref LIKE 'fiscal-year:%');
  ELSE
    RAISE NOTICE 'je_auto_source_live_uniq no creado: existen asientos automaticos duplicados vivos; reverselos y reaplique esta sentencia.';
  END IF;
END $$;
--> statement-breakpoint

-- 5. Conciliación bancaria 1:1: liberar emparejamientos duplicados y
--    crear el índice único parcial.
UPDATE bank_transactions bt
SET matched_journal_line_id = NULL,
    match_confidence = NULL,
    match_method = NULL,
    matched_at = NULL,
    matched_by = NULL
FROM (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY matched_journal_line_id
           ORDER BY (match_method = 'manual') DESC, matched_at ASC NULLS LAST, created_at ASC, id ASC
         ) AS rn
  FROM bank_transactions
  WHERE matched_journal_line_id IS NOT NULL
) d
WHERE bt.id = d.id AND d.rn > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS bt_matched_line_uniq
  ON bank_transactions (matched_journal_line_id)
  WHERE matched_journal_line_id IS NOT NULL;
--> statement-breakpoint

-- 6. Conciliación sin extracto del período (contab-nomina-09): saldo bancario
--    y diferencia pasan a ser NULL (no conciliable) en vez de 0.
ALTER TABLE bank_reconciliations ALTER COLUMN bank_balance DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE bank_reconciliations ALTER COLUMN difference DROP NOT NULL;
