-- Ola 1.A — Triggers e invariantes del libro mayor (handcrafted, no
-- generables por drizzle-kit).
--
-- Tres garantías que se ejecutan en la DB para que ninguna ruta de
-- aplicación pueda violarlas (inserts directos, fallos de transacción,
-- futuros backfills):
--
--   1. journal_entries posted son inmutables (UPDATE bloqueado salvo
--      transición a 'reversed' al aplicar reversal). Para corregir
--      → reversal entry.
--   2. journal_lines NO se pueden insertar en períodos cerrados o
--      bloqueados (`accounting_periods.status != 'open'`).
--   3. journal_lines.account_id debe apuntar a una cuenta postable
--      (chart_of_accounts.is_postable = true; nivel 4-5 del PUC).
--
-- Diseño idempotente con CREATE OR REPLACE FUNCTION + DROP TRIGGER IF
-- EXISTS para que aplicar dos veces no falle.

CREATE OR REPLACE FUNCTION assert_je_immutable() RETURNS TRIGGER AS $$
BEGIN
  -- Permitido: draft -> posted, posted -> reversed (aplicación de reversal),
  -- y cambios menores en metadata mientras `status='draft'`.
  -- Bloqueado: cualquier cambio a una entry cuyo OLD.status='posted' y
  -- NEW.status='posted' (no transición). La única forma de "modificar"
  -- una entry posted es revertirla y emitir una nueva.
  IF OLD.status = 'posted' AND NEW.status = 'posted' THEN
    RAISE EXCEPTION 'Posted journal entries are immutable. Use a reversal entry instead.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS journal_entries_immutable ON journal_entries;
--> statement-breakpoint
CREATE TRIGGER journal_entries_immutable
BEFORE UPDATE ON journal_entries
FOR EACH ROW EXECUTE FUNCTION assert_je_immutable();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION assert_period_open() RETURNS TRIGGER AS $$
DECLARE p_status text;
BEGIN
  SELECT ap.status INTO p_status
  FROM accounting_periods ap
  JOIN journal_entries je ON je.period_id = ap.id
  WHERE je.id = NEW.entry_id;
  IF p_status IS NULL THEN
    RAISE EXCEPTION 'Cannot insert journal_lines: parent journal_entries.id=% has no period.', NEW.entry_id;
  END IF;
  IF p_status != 'open' THEN
    RAISE EXCEPTION 'Cannot insert journal_lines into a % period. Re-open it first.', p_status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS journal_lines_period_check ON journal_lines;
--> statement-breakpoint
CREATE TRIGGER journal_lines_period_check
BEFORE INSERT ON journal_lines
FOR EACH ROW EXECUTE FUNCTION assert_period_open();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION assert_account_postable() RETURNS TRIGGER AS $$
DECLARE acc_postable boolean;
BEGIN
  SELECT is_postable INTO acc_postable FROM chart_of_accounts WHERE id = NEW.account_id;
  IF acc_postable IS NULL THEN
    RAISE EXCEPTION 'Cannot insert journal_lines: account % not found.', NEW.account_id;
  END IF;
  IF NOT acc_postable THEN
    RAISE EXCEPTION 'Account % is not postable (not a leaf-level auxiliary).', NEW.account_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS journal_lines_account_postable ON journal_lines;
--> statement-breakpoint
CREATE TRIGGER journal_lines_account_postable
BEFORE INSERT ON journal_lines
FOR EACH ROW EXECUTE FUNCTION assert_account_postable();
