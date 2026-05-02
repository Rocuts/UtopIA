'use client';

/**
 * LedgerView — read-only general ledger.
 *
 * Renders journal lines with a running balance per account. The "balance"
 * column is computed client-side from the (debit - credit) cumulative
 * stream so the user can scroll through and see how each entry shifts the
 * account total without requiring the server to materialize a balances
 * table for this view.
 *
 * Filters supported (server-side): account, period, third-party, cost
 * center. The component fires a fresh `GET /api/accounting/journal?…`
 * whenever any filter changes, debounced 200 ms.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  AlertCircle,
  Calendar,
  Loader2,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { cn } from '@/lib/utils';
import { formatPesos } from '@/lib/format/cop';

interface LedgerLine {
  id: string;
  entryId: string;
  entryNumber: number;
  entryDate: string;
  status: 'draft' | 'posted' | 'reversed' | 'voided';
  description: string | null;
  account: { id: string; code: string; name: string };
  thirdParty: { id: string; legalName: string } | null;
  costCenter: { id: string; code: string; name: string } | null;
  debit: string;
  credit: string;
}

interface PeriodOption {
  id: string;
  year: number;
  month: number;
  status: 'open' | 'closed' | 'locked';
  label?: string;
}

interface AccountOption {
  id: string;
  code: string;
  name: string;
  isPostable: boolean;
}

const STATUS_BADGE: Record<LedgerLine['status'], string> = {
  draft: 'bg-n-100 text-n-700 border-n-300',
  posted: 'bg-success/10 text-success border-success/30',
  reversed: 'bg-warning/10 text-warning border-warning/30',
  voided: 'bg-danger/10 text-danger border-danger/30',
};

function periodLabel(p: PeriodOption): string {
  if (p.label) return p.label;
  const month = String(p.month).padStart(2, '0');
  return `${p.year}-${month}`;
}

export function LedgerView() {
  const { t, language } = useLanguage();
  const ac = t.accounting;

  const [lines, setLines] = useState<LedgerLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [periods, setPeriods] = useState<PeriodOption[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);

  const [periodId, setPeriodId] = useState<string>('');
  const [accountId, setAccountId] = useState<string>('');
  const [thirdPartyQuery, setThirdPartyQuery] = useState<string>('');
  const [costCenterQuery, setCostCenterQuery] = useState<string>('');

  // ─── Boot: load filter options ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const year = new Date().getFullYear();
        const [pr, ar] = await Promise.all([
          fetch(`/api/accounting/periods?year=${year}`),
          fetch('/api/accounting/accounts?postable=1'),
        ]);
        if (cancelled) return;
        if (pr.ok) {
          const j = (await pr.json()) as
            | { ok: true; periods: PeriodOption[] }
            | PeriodOption[];
          const list: PeriodOption[] = Array.isArray(j)
            ? j
            : 'periods' in j && Array.isArray(j.periods)
              ? j.periods
              : [];
          setPeriods(list);
          const open = list.find((p) => p.status === 'open');
          setPeriodId(open?.id ?? list[0]?.id ?? '');
        }
        if (ar.ok) {
          const j = (await ar.json()) as
            | { ok: true; accounts: AccountOption[] }
            | AccountOption[];
          const list: AccountOption[] = Array.isArray(j)
            ? j
            : 'accounts' in j && Array.isArray(j.accounts)
              ? j.accounts
              : [];
          setAccounts(list);
        }
      } catch {
        if (!cancelled) setError(ac.errorGeneric);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ac.errorGeneric]);

  // ─── Fetch ledger ───────────────────────────────────────────────────────
  const fetchLedger = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (periodId) params.set('period', periodId);
      if (accountId) params.set('account', accountId);
      if (thirdPartyQuery) params.set('thirdParty', thirdPartyQuery);
      if (costCenterQuery) params.set('costCenter', costCenterQuery);
      params.set('view', 'ledger');
      const res = await fetch(`/api/accounting/journal?${params.toString()}`);
      if (!res.ok) throw new Error('ledger_failed');
      const json = (await res.json()) as
        | { ok: true; lines: LedgerLine[] }
        | LedgerLine[];
      const list: LedgerLine[] = Array.isArray(json)
        ? json
        : 'lines' in json && Array.isArray(json.lines)
          ? json.lines
          : [];
      setLines(list);
    } catch {
      setError(ac.errorGeneric);
      setLines([]);
    } finally {
      setLoading(false);
    }
  }, [periodId, accountId, thirdPartyQuery, costCenterQuery, ac.errorGeneric]);

  useEffect(() => {
    const id = setTimeout(() => {
      void fetchLedger();
    }, 200);
    return () => clearTimeout(id);
  }, [fetchLedger]);

  // ─── Running balance ────────────────────────────────────────────────────
  const linesWithBalance = useMemo(() => {
    let running = 0;
    return lines.map((l) => {
      const d = Number(l.debit) || 0;
      const c = Number(l.credit) || 0;
      running += d - c;
      return { ...l, balance: running.toFixed(2) };
    });
  }, [lines]);

  return (
    <div className="flex flex-col gap-4">
      {/* Filters */}
      <section
        aria-label={language === 'es' ? 'Filtros' : 'Filters'}
        className={cn(
          'rounded-xl border border-gold-500/20 bg-n-0',
          'p-4 grid grid-cols-1 md:grid-cols-4 gap-3',
        )}
      >
        <div>
          <label
            htmlFor="ledger-period"
            className="block text-xs-mono uppercase tracking-eyebrow text-n-700 font-medium mb-1"
          >
            {ac.filterPeriod}
          </label>
          <select
            id="ledger-period"
            value={periodId}
            onChange={(e) => setPeriodId(e.target.value)}
            className={cn(
              'w-full h-9 px-3 rounded-md border bg-n-0',
              'border-gold-500/25 focus:border-gold-500/60 outline-none',
              'text-sm text-n-1000',
              'focus-visible:ring-2 focus-visible:ring-gold-500',
            )}
          >
            <option value="">
              {language === 'es' ? 'Todos' : 'All'}
            </option>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {periodLabel(p)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="ledger-account"
            className="block text-xs-mono uppercase tracking-eyebrow text-n-700 font-medium mb-1"
          >
            {ac.filterAccount}
          </label>
          <select
            id="ledger-account"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className={cn(
              'w-full h-9 px-3 rounded-md border bg-n-0',
              'border-gold-500/25 focus:border-gold-500/60 outline-none',
              'text-sm text-n-1000',
              'focus-visible:ring-2 focus-visible:ring-gold-500',
            )}
          >
            <option value="">
              {language === 'es' ? 'Todas' : 'All'}
            </option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="ledger-tp"
            className="block text-xs-mono uppercase tracking-eyebrow text-n-700 font-medium mb-1"
          >
            {ac.filterThirdParty}
          </label>
          <input
            id="ledger-tp"
            type="text"
            value={thirdPartyQuery}
            onChange={(e) => setThirdPartyQuery(e.target.value)}
            placeholder={language === 'es' ? 'NIT o nombre' : 'NIT or name'}
            className={cn(
              'w-full h-9 px-3 rounded-md border bg-n-0',
              'border-gold-500/25 focus:border-gold-500/60 outline-none',
              'text-sm text-n-1000 placeholder:text-n-500',
              'focus-visible:ring-2 focus-visible:ring-gold-500',
            )}
          />
        </div>

        <div>
          <label
            htmlFor="ledger-cc"
            className="block text-xs-mono uppercase tracking-eyebrow text-n-700 font-medium mb-1"
          >
            {ac.filterCostCenter}
          </label>
          <input
            id="ledger-cc"
            type="text"
            value={costCenterQuery}
            onChange={(e) => setCostCenterQuery(e.target.value)}
            placeholder={language === 'es' ? 'Código' : 'Code'}
            className={cn(
              'w-full h-9 px-3 rounded-md border bg-n-0',
              'border-gold-500/25 focus:border-gold-500/60 outline-none',
              'text-sm text-n-1000 placeholder:text-n-500',
              'focus-visible:ring-2 focus-visible:ring-gold-500',
            )}
          />
        </div>
      </section>

      {/* Body */}
      {loading ? (
        <div
          role="status"
          aria-busy="true"
          className="flex items-center gap-2 px-4 py-12 text-n-500 justify-center"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          <span className="text-sm">{ac.loading}</span>
        </div>
      ) : error ? (
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
      ) : linesWithBalance.length === 0 ? (
        <div
          className={cn(
            'rounded-xl border border-dashed border-gold-500/30 bg-n-0',
            'p-10 text-center text-sm text-n-500',
          )}
        >
          <Calendar
            className="mx-auto h-8 w-8 text-n-500 mb-2"
            aria-hidden="true"
          />
          {ac.noEntries}
        </div>
      ) : (
        <div
          className={cn(
            'rounded-xl border border-gold-500/20 bg-n-0 overflow-hidden',
          )}
        >
          <div className="overflow-x-auto styled-scrollbar">
            <table className="min-w-full text-sm">
              <thead className="bg-n-50 sticky top-0 z-10 border-b border-gold-500/15">
                <tr>
                  <th
                    scope="col"
                    className="px-3 py-2 text-left text-xs-mono uppercase tracking-eyebrow font-medium text-n-600"
                  >
                    {ac.date}
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2 text-right text-xs-mono uppercase tracking-eyebrow font-medium text-n-600"
                  >
                    {ac.number}
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2 text-left text-xs-mono uppercase tracking-eyebrow font-medium text-n-600"
                  >
                    {ac.account}
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2 text-left text-xs-mono uppercase tracking-eyebrow font-medium text-n-600"
                  >
                    {ac.thirdParty}
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2 text-left text-xs-mono uppercase tracking-eyebrow font-medium text-n-600"
                  >
                    {ac.description}
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2 text-right text-xs-mono uppercase tracking-eyebrow font-medium text-n-600"
                  >
                    {ac.debit}
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2 text-right text-xs-mono uppercase tracking-eyebrow font-medium text-n-600"
                  >
                    {ac.credit}
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2 text-right text-xs-mono uppercase tracking-eyebrow font-medium text-n-600"
                  >
                    {ac.balance}
                  </th>
                </tr>
              </thead>
              <tbody>
                {linesWithBalance.map((l) => (
                  <tr
                    key={l.id}
                    className={cn(
                      'border-b last:border-b-0 border-gold-500/10',
                      'even:bg-n-50 hover:bg-gold-500/8 transition-colors',
                    )}
                  >
                    <td className="px-3 py-2 text-n-1000 tabular-nums whitespace-nowrap">
                      {new Date(l.entryDate).toLocaleDateString('es-CO')}
                    </td>
                    <td className="px-3 py-2 text-right text-n-700 tabular-nums">
                      <span className="font-mono">#{l.entryNumber}</span>
                      <span
                        className={cn(
                          'ml-1 inline-block text-[10px] font-mono uppercase tracking-eyebrow',
                          'rounded border px-1 py-0.5 align-middle',
                          STATUS_BADGE[l.status],
                        )}
                      >
                        {l.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-n-1000">
                      <span className="font-mono text-xs-mono tabular-nums mr-1">
                        {l.account.code}
                      </span>
                      <span className="text-n-700 text-xs">{l.account.name}</span>
                    </td>
                    <td className="px-3 py-2 text-n-700 truncate max-w-[160px]">
                      {l.thirdParty?.legalName ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-n-700 truncate max-w-[260px]">
                      {l.description ?? '—'}
                    </td>
                    <td
                      className={cn(
                        'px-3 py-2 text-right tabular-nums font-mono',
                        Number(l.debit) > 0 ? 'text-n-1000' : 'text-n-500',
                      )}
                    >
                      {formatPesos(l.debit)}
                    </td>
                    <td
                      className={cn(
                        'px-3 py-2 text-right tabular-nums font-mono',
                        Number(l.credit) > 0 ? 'text-n-1000' : 'text-n-500',
                      )}
                    >
                      {formatPesos(l.credit)}
                    </td>
                    <td
                      className={cn(
                        'px-3 py-2 text-right tabular-nums font-mono font-medium',
                        Number(l.balance) >= 0
                          ? 'text-success'
                          : 'text-danger',
                      )}
                    >
                      {formatPesos(l.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default LedgerView;
