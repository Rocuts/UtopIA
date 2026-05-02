'use client';

/**
 * JournalEntryForm — editable double-entry journal form.
 *
 * Visual contract:
 *   - Header: date input + description.
 *   - Body: editable rows for `account / third-party / cost-center /
 *     description / debit / credit`.
 *   - Footer: live totals, balance badge (green = balanced, red = out),
 *     and the two action buttons (Save draft, Post).
 *
 * Behavioral contract:
 *   - All monetary state is held as user-format strings ("1.234.567,89").
 *     The COP helpers in `@/lib/format/cop` parse them to JS-numeric
 *     strings ("1234567.89") before POST.
 *   - Live totals are computed in centavos via `sumCOPStrings()` so
 *     long entries don't accumulate float error.
 *   - "Post" is disabled unless the entry is balanced AND every line has
 *     either a debit OR a credit (never both, never neither).
 *
 * API surface (assumed; see CLAUDE.md / agent-1.E spec):
 *   POST /api/accounting/journal     { workspaceId?, periodId, entryDate,
 *                                       description, lines, status }
 *   GET  /api/accounting/accounts?tree=1
 *   GET  /api/accounting/accounts?postable=1&search=…  (via AccountAutocomplete)
 *
 * This component is intentionally `workspaceId`-agnostic on the wire —
 * the route handler resolves the workspace from the cookie set by
 * `getOrCreateWorkspace()`.
 */

import {
  useCallback,
  useId,
  useMemo,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  Check,
  Loader2,
  Plus,
  Trash2,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { cn } from '@/lib/utils';
import {
  formatCOP,
  parseCOP,
  sumCOPStrings,
} from '@/lib/format/cop';
import {
  AccountAutocomplete,
  type AccountSuggestion,
} from './AccountAutocomplete';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PeriodOption {
  id: string;
  year: number;
  month: number;
  status: 'open' | 'closed' | 'locked';
  label?: string;
}

interface DraftLine {
  id: string;
  account: AccountSuggestion | null;
  thirdPartyId: string | null;
  costCenterId: string | null;
  description: string;
  /** User-format string ("1.234.567,89"). Empty = 0. */
  debit: string;
  /** User-format string. Empty = 0. */
  credit: string;
}

export interface JournalEntryFormProps {
  /** Periods available for this workspace. The active period is the
   * default selection. */
  periods: PeriodOption[];
  /** Default period id (typically the open period for the current month). */
  defaultPeriodId: string | null;
  /** Optional: pre-warm the period selector when the parent already
   * resolved it server-side. */
  defaultEntryDate?: string;
}

function nowIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function newLine(): DraftLine {
  return {
    id:
      typeof window !== 'undefined' && window.crypto?.randomUUID
        ? window.crypto.randomUUID()
        : `l-${Math.random().toString(36).slice(2)}`,
    account: null,
    thirdPartyId: null,
    costCenterId: null,
    description: '',
    debit: '',
    credit: '',
  };
}

function periodLabel(p: PeriodOption): string {
  if (p.label) return p.label;
  const month = String(p.month).padStart(2, '0');
  return `${p.year}-${month}`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function JournalEntryForm({
  periods,
  defaultPeriodId,
  defaultEntryDate,
}: JournalEntryFormProps) {
  const { t, language } = useLanguage();
  const router = useRouter();
  const formId = useId();
  const ac = t.accounting;

  // ─── Header state ─────────────────────────────────────────────────────────
  const [periodId, setPeriodId] = useState<string>(
    defaultPeriodId ?? periods.find((p) => p.status === 'open')?.id ?? '',
  );
  const [entryDate, setEntryDate] = useState<string>(defaultEntryDate ?? nowIso());
  const [description, setDescription] = useState<string>('');

  // ─── Lines state ──────────────────────────────────────────────────────────
  const [lines, setLines] = useState<DraftLine[]>(() => [newLine(), newLine()]);

  // ─── Form-level state ─────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState<null | 'draft' | 'posted'>(null);
  const [error, setError] = useState<string | null>(null);

  // ─── Totals (live, in centavos via BigInt to avoid float drift) ───────────
  const totals = useMemo(() => {
    const debitStr = sumCOPStrings(lines.map((l) => parseCOP(l.debit)));
    const creditStr = sumCOPStrings(lines.map((l) => parseCOP(l.credit)));
    const diffStr = sumCOPStrings([debitStr, '-' + creditStr.replace(/^-/, '')]);
    const isBalanced = Number(debitStr) === Number(creditStr);
    return {
      debit: debitStr,
      credit: creditStr,
      diff: diffStr,
      isBalanced,
    };
  }, [lines]);

  // ─── Validation ───────────────────────────────────────────────────────────
  const validation = useMemo(() => {
    const errors: string[] = [];
    if (!description.trim()) errors.push(ac.validationDescriptionRequired);
    if (!periodId) errors.push(language === 'es' ? 'Seleccione un periodo' : 'Select a period');

    let nonEmptyLines = 0;
    for (const ln of lines) {
      const d = Number(parseCOP(ln.debit));
      const c = Number(parseCOP(ln.credit));
      const hasAmount = d > 0 || c > 0;
      if (!hasAmount && !ln.account) continue; // empty draft row, skip
      nonEmptyLines += 1;

      if (!ln.account) {
        errors.push(ac.validationLineRequired);
        break;
      }
      if (d > 0 && c > 0) {
        errors.push(language === 'es' ? 'Una línea no puede tener débito y crédito a la vez' : 'A line cannot hold both a debit and a credit');
        break;
      }
      if (!hasAmount) {
        errors.push(ac.validationLineRequired);
        break;
      }
    }
    if (nonEmptyLines < 2) {
      errors.push(language === 'es' ? 'Un asiento requiere al menos 2 líneas' : 'A journal entry needs at least 2 lines');
    }
    if (!totals.isBalanced) {
      errors.push(ac.validationUnbalanced);
    }
    return { errors, ok: errors.length === 0 };
  }, [lines, description, periodId, totals.isBalanced, ac, language]);

  // ─── Handlers ─────────────────────────────────────────────────────────────
  const updateLine = useCallback(
    (id: string, patch: Partial<DraftLine>) => {
      setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    },
    [],
  );

  const addLine = useCallback(() => {
    setLines((prev) => [...prev, newLine()]);
  }, []);

  const removeLine = useCallback((id: string) => {
    setLines((prev) => (prev.length <= 2 ? prev : prev.filter((l) => l.id !== id)));
  }, []);

  // Lock the cell that's not being edited: if the user types in `debit`,
  // we clear `credit` (and vice-versa) so a single line never carries both.
  const handleDebitChange = useCallback(
    (id: string, val: string) => {
      const normalized = val;
      setLines((prev) =>
        prev.map((l) =>
          l.id === id
            ? { ...l, debit: normalized, credit: normalized.trim() === '' ? l.credit : '' }
            : l,
        ),
      );
    },
    [],
  );

  const handleCreditChange = useCallback(
    (id: string, val: string) => {
      const normalized = val;
      setLines((prev) =>
        prev.map((l) =>
          l.id === id
            ? { ...l, credit: normalized, debit: normalized.trim() === '' ? l.debit : '' }
            : l,
        ),
      );
    },
    [],
  );

  const submit = useCallback(
    async (status: 'draft' | 'posted') => {
      setError(null);
      if (status === 'posted' && !validation.ok) {
        setError(validation.errors[0] ?? ac.errorGeneric);
        return;
      }
      if (status === 'draft' && !description.trim()) {
        setError(ac.validationDescriptionRequired);
        return;
      }
      setSubmitting(status);
      try {
        const payloadLines = lines
          .filter((l) => {
            const d = Number(parseCOP(l.debit));
            const c = Number(parseCOP(l.credit));
            return l.account && (d > 0 || c > 0);
          })
          .map((l) => ({
            accountId: l.account!.id,
            thirdPartyId: l.thirdPartyId,
            costCenterId: l.costCenterId,
            description: l.description.trim() || null,
            debit: parseCOP(l.debit),
            credit: parseCOP(l.credit),
          }));

        const res = await fetch('/api/accounting/journal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            periodId,
            entryDate,
            description: description.trim(),
            status,
            lines: payloadLines,
            sourceType: 'manual',
          }),
        });

        if (!res.ok) {
          let msg = ac.errorGeneric;
          try {
            const j = (await res.json()) as { error?: string; message?: string };
            msg = j.error ?? j.message ?? msg;
          } catch {
            /* ignore */
          }
          throw new Error(msg);
        }

        // Success — bounce back to /workspace/contabilidad so the
        // "Recent entries" section reloads via SSR.
        router.push('/workspace/contabilidad');
        router.refresh();
      } catch (err) {
        const msg = err instanceof Error ? err.message : ac.errorGeneric;
        setError(msg);
      } finally {
        setSubmitting(null);
      }
    },
    [validation, description, lines, periodId, entryDate, ac, router],
  );

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <form
      id={formId}
      onSubmit={(e) => e.preventDefault()}
      className="flex flex-col gap-6"
      aria-labelledby={`${formId}-title`}
    >
      {/* Header */}
      <section
        aria-label={ac.entry}
        className={cn(
          'rounded-xl border border-gold-500/20 bg-n-0',
          'p-5 grid grid-cols-1 md:grid-cols-3 gap-4',
        )}
      >
        <div>
          <label
            htmlFor={`${formId}-period`}
            className="block text-xs-mono uppercase tracking-eyebrow text-n-700 font-medium mb-1"
          >
            {ac.period}
          </label>
          <select
            id={`${formId}-period`}
            value={periodId}
            onChange={(e) => setPeriodId(e.target.value)}
            className={cn(
              'w-full h-9 px-3 rounded-md border bg-n-0',
              'border-gold-500/25 focus:border-gold-500/60 outline-none',
              'text-sm text-n-1000',
              'focus-visible:ring-2 focus-visible:ring-gold-500',
            )}
          >
            <option value="" disabled>
              {ac.selectPeriod}
            </option>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {periodLabel(p)} {p.status !== 'open' ? `(${p.status})` : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor={`${formId}-date`}
            className="block text-xs-mono uppercase tracking-eyebrow text-n-700 font-medium mb-1"
          >
            {ac.date}
          </label>
          <input
            id={`${formId}-date`}
            type="date"
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
            className={cn(
              'w-full h-9 px-3 rounded-md border bg-n-0',
              'border-gold-500/25 focus:border-gold-500/60 outline-none',
              'text-sm text-n-1000 tabular-nums',
              'focus-visible:ring-2 focus-visible:ring-gold-500',
            )}
          />
        </div>

        <div>
          <label
            htmlFor={`${formId}-desc`}
            className="block text-xs-mono uppercase tracking-eyebrow text-n-700 font-medium mb-1"
          >
            {ac.description}
          </label>
          <input
            id={`${formId}-desc`}
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={
              language === 'es'
                ? 'Ej. Causación nómina abril 2026'
                : 'e.g. April 2026 payroll accrual'
            }
            className={cn(
              'w-full h-9 px-3 rounded-md border bg-n-0',
              'border-gold-500/25 focus:border-gold-500/60 outline-none',
              'text-sm text-n-1000 placeholder:text-n-500',
              'focus-visible:ring-2 focus-visible:ring-gold-500',
            )}
          />
        </div>
      </section>

      {/* Lines */}
      <section
        aria-label={language === 'es' ? 'Líneas del asiento' : 'Entry lines'}
        className={cn(
          'rounded-xl border border-gold-500/20 bg-n-0 overflow-hidden',
        )}
      >
        <div className="overflow-x-auto styled-scrollbar">
          <table className="min-w-full text-sm">
            <thead className="bg-n-50 border-b border-gold-500/15">
              <tr>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs-mono uppercase tracking-eyebrow font-medium text-n-600 w-[28%]"
                >
                  {ac.account}
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs-mono uppercase tracking-eyebrow font-medium text-n-600 w-[12%]"
                >
                  {ac.thirdParty}
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs-mono uppercase tracking-eyebrow font-medium text-n-600 w-[12%]"
                >
                  {ac.costCenter}
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs-mono uppercase tracking-eyebrow font-medium text-n-600 w-[18%]"
                >
                  {ac.description}
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-right text-xs-mono uppercase tracking-eyebrow font-medium text-n-600 w-[12%]"
                >
                  {ac.debit}
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-right text-xs-mono uppercase tracking-eyebrow font-medium text-n-600 w-[12%]"
                >
                  {ac.credit}
                </th>
                <th scope="col" className="w-[6%]" aria-hidden="true" />
              </tr>
            </thead>
            <tbody>
              {lines.map((ln, idx) => (
                <tr
                  key={ln.id}
                  className={cn(
                    'border-b last:border-b-0 border-gold-500/10',
                    'even:bg-n-50 hover:bg-gold-500/8 transition-colors',
                  )}
                >
                  <td className="px-2 py-1.5 align-top">
                    <AccountAutocomplete
                      size="sm"
                      value={ln.account}
                      onSelect={(acc) => updateLine(ln.id, { account: acc })}
                      placeholder={ac.accountSearch}
                      emptyText={
                        language === 'es' ? 'Sin coincidencias' : 'No matches'
                      }
                    />
                    {ln.account?.requiresThirdParty && !ln.thirdPartyId && (
                      <p className="mt-1 text-2xs text-warning flex items-center gap-1">
                        <AlertCircle aria-hidden="true" className="h-3 w-3" />
                        {ac.requiresThirdParty}
                      </p>
                    )}
                    {ln.account?.requiresCostCenter && !ln.costCenterId && (
                      <p className="mt-1 text-2xs text-warning flex items-center gap-1">
                        <AlertCircle aria-hidden="true" className="h-3 w-3" />
                        {ac.requiresCostCenter}
                      </p>
                    )}
                  </td>
                  <td className="px-2 py-1.5 align-top">
                    <input
                      type="text"
                      value={ln.thirdPartyId ?? ''}
                      onChange={(e) =>
                        updateLine(ln.id, { thirdPartyId: e.target.value || null })
                      }
                      placeholder="—"
                      aria-label={`${ac.thirdParty} línea ${idx + 1}`}
                      className={cn(
                        'w-full h-8 px-2 rounded border bg-n-0 text-xs',
                        'border-gold-500/15 focus:border-gold-500/45 outline-none',
                        'text-n-1000 placeholder:text-n-500',
                        'focus-visible:ring-2 focus-visible:ring-gold-500',
                      )}
                    />
                  </td>
                  <td className="px-2 py-1.5 align-top">
                    <input
                      type="text"
                      value={ln.costCenterId ?? ''}
                      onChange={(e) =>
                        updateLine(ln.id, { costCenterId: e.target.value || null })
                      }
                      placeholder="—"
                      aria-label={`${ac.costCenter} línea ${idx + 1}`}
                      className={cn(
                        'w-full h-8 px-2 rounded border bg-n-0 text-xs',
                        'border-gold-500/15 focus:border-gold-500/45 outline-none',
                        'text-n-1000 placeholder:text-n-500',
                        'focus-visible:ring-2 focus-visible:ring-gold-500',
                      )}
                    />
                  </td>
                  <td className="px-2 py-1.5 align-top">
                    <input
                      type="text"
                      value={ln.description}
                      onChange={(e) => updateLine(ln.id, { description: e.target.value })}
                      placeholder="—"
                      aria-label={`${ac.description} línea ${idx + 1}`}
                      className={cn(
                        'w-full h-8 px-2 rounded border bg-n-0 text-xs',
                        'border-gold-500/15 focus:border-gold-500/45 outline-none',
                        'text-n-1000 placeholder:text-n-500',
                        'focus-visible:ring-2 focus-visible:ring-gold-500',
                      )}
                    />
                  </td>
                  <td className="px-2 py-1.5 align-top text-right">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={ln.debit}
                      onChange={(e) => handleDebitChange(ln.id, e.target.value)}
                      placeholder="0,00"
                      aria-label={`${ac.debit} línea ${idx + 1}`}
                      className={cn(
                        'w-full h-8 px-2 rounded border bg-n-0 text-xs text-right',
                        'border-gold-500/15 focus:border-gold-500/45 outline-none',
                        'text-n-1000 placeholder:text-n-500 tabular-nums',
                        'focus-visible:ring-2 focus-visible:ring-gold-500',
                      )}
                    />
                  </td>
                  <td className="px-2 py-1.5 align-top text-right">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={ln.credit}
                      onChange={(e) => handleCreditChange(ln.id, e.target.value)}
                      placeholder="0,00"
                      aria-label={`${ac.credit} línea ${idx + 1}`}
                      className={cn(
                        'w-full h-8 px-2 rounded border bg-n-0 text-xs text-right',
                        'border-gold-500/15 focus:border-gold-500/45 outline-none',
                        'text-n-1000 placeholder:text-n-500 tabular-nums',
                        'focus-visible:ring-2 focus-visible:ring-gold-500',
                      )}
                    />
                  </td>
                  <td className="px-1 py-1.5 align-top text-center">
                    <button
                      type="button"
                      onClick={() => removeLine(ln.id)}
                      disabled={lines.length <= 2}
                      aria-label={ac.removeLine}
                      className={cn(
                        'p-1.5 rounded text-n-500 hover:text-danger hover:bg-danger/8',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-danger',
                        'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent',
                        'disabled:hover:text-n-500',
                      )}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-n-50 border-t-2 border-gold-500/30">
              <tr>
                <td colSpan={4} className="px-3 py-2 text-left">
                  <button
                    type="button"
                    onClick={addLine}
                    className={cn(
                      'inline-flex items-center gap-1.5 px-2 py-1 rounded',
                      'text-xs font-medium text-gold-600 hover:bg-gold-500/8',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
                    )}
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    {ac.addLine}
                  </button>
                </td>
                <td
                  className={cn(
                    'px-3 py-2 text-right text-sm font-mono font-semibold tabular-nums',
                    'text-n-1000',
                  )}
                  aria-label={ac.totals + ' ' + ac.debit}
                >
                  <span className="block text-2xs uppercase tracking-eyebrow text-n-600 font-medium">
                    {ac.totals}
                  </span>
                  {formatCOP(totals.debit)}
                </td>
                <td
                  className={cn(
                    'px-3 py-2 text-right text-sm font-mono font-semibold tabular-nums',
                    'text-n-1000',
                  )}
                  aria-label={ac.totals + ' ' + ac.credit}
                >
                  <span className="block text-2xs uppercase tracking-eyebrow text-n-600 font-medium">
                    {ac.totals}
                  </span>
                  {formatCOP(totals.credit)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* Status badge + actions */}
      <section
        aria-label={language === 'es' ? 'Estado del balance' : 'Balance status'}
        className="flex flex-col md:flex-row md:items-center md:justify-between gap-3"
      >
        <div role="status" aria-live="polite">
          {totals.isBalanced && Number(totals.debit) > 0 ? (
            <span
              className={cn(
                'inline-flex items-center gap-2 px-3 py-1.5 rounded-md',
                'bg-success/10 border border-success/30',
                'text-success font-semibold text-sm',
              )}
            >
              <Check className="h-4 w-4" aria-hidden="true" />
              {ac.balanced}
            </span>
          ) : Number(totals.debit) > 0 || Number(totals.credit) > 0 ? (
            <span
              className={cn(
                'inline-flex items-center gap-2 px-3 py-1.5 rounded-md',
                'bg-danger/10 border border-danger/30',
                'text-danger font-semibold text-sm',
              )}
            >
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              {ac.unbalanced}: {formatCOP(totals.diff)}
            </span>
          ) : (
            <span className="text-xs-mono uppercase tracking-eyebrow text-n-500 font-medium">
              {language === 'es'
                ? 'Ingrese al menos dos líneas'
                : 'Enter at least two lines'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => submit('draft')}
            disabled={submitting !== null}
            className={cn(
              'inline-flex items-center gap-1.5 px-4 py-2 rounded-md',
              'border border-gold-500/30 text-n-1000 bg-n-0',
              'hover:bg-gold-500/8 transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'text-sm font-medium',
            )}
          >
            {submitting === 'draft' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : null}
            {ac.saveDraft}
          </button>
          <button
            type="button"
            onClick={() => submit('posted')}
            disabled={submitting !== null || !validation.ok}
            className={cn(
              'inline-flex items-center gap-1.5 px-4 py-2 rounded-md',
              'bg-gold-500 text-n-0 hover:bg-gold-600 transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
              'focus-visible:ring-offset-2 focus-visible:ring-offset-n-0',
              'disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-gold-500/30',
              'text-sm font-semibold',
            )}
          >
            {submitting === 'posted' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {ac.post}
          </button>
        </div>
      </section>

      {error && (
        <div
          role="alert"
          className={cn(
            'rounded-md border border-danger/30 bg-danger/8 px-3 py-2',
            'text-sm text-danger flex items-center gap-2',
          )}
        >
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}
    </form>
  );
}

export default JournalEntryForm;
