'use client';

/**
 * PeriodsManagementView — Gestor de Periodos Fiscales (1+1).
 *
 * Tabla de todos los periodos contables del workspace con acciones de
 * apertura, cierre, bloqueo y reapertura. La API ya valida overlap,
 * concurrencia (SELECT FOR UPDATE) y transiciones de estado en el server,
 * así que aquí mantenemos UI optimista mínima y hacemos refetch tras cada
 * mutación.
 *
 * Diseño:
 *   - Hero con título + sub
 *   - Toolbar: filtro por año + botón "Abrir nuevo periodo"
 *   - Tabla densa (compatible con `[data-density='compact']`)
 *   - Empty state contextual (con QuickStart si no hay ningún periodo)
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CalendarPlus,
  Loader2,
  Lock,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/design-system/components/Toast';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/utils';

import { OpenPeriodModal } from './OpenPeriodModal';
import { ClosePeriodConfirmDialog } from './ClosePeriodConfirmDialog';
import { QuickStartPeriodButton } from './QuickStartPeriodButton';

export interface AccountingPeriod {
  id: string;
  year: number;
  month: number;
  status: 'open' | 'closed' | 'locked';
  startsAt: string;
  endsAt: string;
  closedAt: string | null;
  closedBy: string | null;
  lockedAt: string | null;
}

const MONTH_NAMES_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  'Cierre Anual', // 13
];
const MONTH_NAMES_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
  'Year Close', // 13
];

function getMonthLabel(month: number, lang: 'es' | 'en'): string {
  const idx = Math.max(1, Math.min(13, month)) - 1;
  return (lang === 'es' ? MONTH_NAMES_ES : MONTH_NAMES_EN)[idx];
}

function statusBadgeStatus(s: AccountingPeriod['status']): 'success' | 'info' | 'warning' {
  if (s === 'open') return 'success';
  if (s === 'closed') return 'info';
  return 'warning';
}

export function PeriodsManagementView() {
  const { language } = useLanguage();
  const { toast } = useToast();
  const isEs = language === 'es';
  const locale = isEs ? 'es-CO' : 'en-US';
  const now = useMemo(() => new Date(), []);
  const currentYear = now.getFullYear();

  const [year, setYear] = useState<number>(currentYear);
  const [periods, setPeriods] = useState<AccountingPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [allPeriodsCount, setAllPeriodsCount] = useState<number | null>(null);

  // Modales
  const [openModal, setOpenModal] = useState(false);
  const [closeTarget, setCloseTarget] = useState<AccountingPeriod | null>(null);
  const [actionInFlightId, setActionInFlightId] = useState<string | null>(null);

  const fetchPeriods = useCallback(
    async (targetYear: number) => {
      try {
        setLoading(true);
        setError(null);

        // Lista filtrada por año + lista global (para detectar empty global vs filtro)
        const [resYear, resAll] = await Promise.all([
          fetch(`/api/accounting/periods?year=${targetYear}`, { cache: 'no-store' }),
          fetch(`/api/accounting/periods`, { cache: 'no-store' }),
        ]);

        if (!resYear.ok) throw new Error('periods_fetch_failed');
        const jsonYear = (await resYear.json()) as
          | { ok: true; periods: AccountingPeriod[] }
          | AccountingPeriod[];
        const yearList: AccountingPeriod[] = Array.isArray(jsonYear)
          ? jsonYear
          : jsonYear.periods ?? [];
        setPeriods(yearList);

        if (resAll.ok) {
          const jsonAll = (await resAll.json()) as
            | { ok: true; periods: AccountingPeriod[] }
            | AccountingPeriod[];
          const allList = Array.isArray(jsonAll) ? jsonAll : jsonAll.periods ?? [];
          setAllPeriodsCount(allList.length);
        }
      } catch {
        setError(isEs ? 'No se pudieron cargar los periodos.' : 'Could not load periods.');
      } finally {
        setLoading(false);
      }
    },
    [isEs],
  );

  useEffect(() => {
    fetchPeriods(year);
  }, [year, fetchPeriods]);

  // ─── Mutaciones ────────────────────────────────────────────────────────

  const performAction = useCallback(
    async (
      period: AccountingPeriod,
      action: 'lock' | 'reopen',
    ) => {
      setActionInFlightId(period.id);
      try {
        const res = await fetch(`/api/accounting/periods/${action}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ periodId: period.id }),
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          const code = json.error ?? 'action_failed';
          toast(
            'error',
            isEs
              ? `Error: ${code.replace(/_/g, ' ')}`
              : `Error: ${code.replace(/_/g, ' ')}`,
            6000,
          );
          return;
        }
        const okMsg =
          action === 'lock'
            ? isEs
              ? `Periodo ${getMonthLabel(period.month, 'es')} ${period.year} bloqueado`
              : `Period ${getMonthLabel(period.month, 'en')} ${period.year} locked`
            : isEs
              ? `Periodo reabierto`
              : `Period reopened`;
        toast('success', okMsg);
        await fetchPeriods(year);
      } catch {
        toast('error', isEs ? 'Falla de red.' : 'Network failure.');
      } finally {
        setActionInFlightId(null);
      }
    },
    [fetchPeriods, isEs, toast, year],
  );

  // ─── Render ────────────────────────────────────────────────────────────

  const yearOptions = useMemo(() => {
    const out: number[] = [];
    for (let y = currentYear - 2; y <= currentYear + 1; y += 1) out.push(y);
    return out;
  }, [currentYear]);

  const isGlobalEmpty = allPeriodsCount === 0;

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-8 md:py-10">
      {/* Hero */}
      <header className="mb-8">
        <p className="font-mono text-xs-mono uppercase tracking-eyebrow text-area-escudo font-medium">
          {isEs ? 'Contabilidad' : 'Accounting'} · 1+1
        </p>
        <h1 className="mt-2 font-serif-elite text-3xl md:text-4xl text-n-1000 tracking-tight">
          {isEs ? 'Periodos Fiscales' : 'Fiscal Periods'}
        </h1>
        <p className="mt-1.5 text-sm text-n-700 max-w-2xl">
          {isEs
            ? 'Gestiona los ciclos contables de tu empresa: apertura, cierre durable con hash de integridad, y bloqueo terminal post-DIAN.'
            : 'Manage your accounting cycles: opening, durable close with integrity hash, and terminal lock post-DIAN.'}
        </p>
      </header>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <label className="flex items-center gap-2 text-sm text-n-700">
          <span className="font-mono text-xs-mono uppercase tracking-eyebrow text-n-600">
            {isEs ? 'Año' : 'Year'}
          </span>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className={cn(
              'rounded-md border border-gold-500/25 bg-n-0 px-3 py-1.5',
              'text-sm text-n-1000 font-mono',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
            )}
            aria-label={isEs ? 'Filtrar por año' : 'Filter by year'}
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => setOpenModal(true)}
          className={cn(
            'inline-flex items-center gap-2 rounded-md px-4 py-2',
            'bg-gold-500 text-n-0 hover:bg-gold-600 transition-colors',
            'text-sm font-semibold',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
            'focus-visible:ring-offset-2 focus-visible:ring-offset-n-0',
            'ml-auto',
          )}
        >
          <CalendarPlus className="h-4 w-4" aria-hidden="true" />
          {isEs ? 'Abrir nuevo periodo' : 'Open new period'}
        </button>
      </div>

      {/* Body */}
      {loading ? (
        <div role="status" aria-busy="true" className="flex items-center justify-center gap-2 py-16 text-n-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          <span className="text-sm">{isEs ? 'Cargando…' : 'Loading…'}</span>
        </div>
      ) : error ? (
        <div role="alert" className="rounded-md border border-danger/30 bg-danger/8 px-3 py-2 text-sm text-danger flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : periods.length === 0 ? (
        isGlobalEmpty ? (
          <div className="flex justify-center">
            <QuickStartPeriodButton
              year={now.getFullYear()}
              month={now.getMonth() + 1}
              variant="card"
              onPeriodOpened={() => fetchPeriods(year)}
            />
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-gold-500/30 bg-n-0 p-10 text-center text-sm text-n-700">
            {isEs ? `Sin periodos en ${year}.` : `No periods in ${year}.`}
          </div>
        )
      ) : (
        <Card variant="default" padding="none" className="overflow-hidden p-0!">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-n-50 border-b border-n-200">
                <tr className="text-left">
                  <Th>{isEs ? 'Año' : 'Year'}</Th>
                  <Th>{isEs ? 'Mes' : 'Month'}</Th>
                  <Th>{isEs ? 'Estado' : 'Status'}</Th>
                  <Th>{isEs ? 'Inicio' : 'Starts'}</Th>
                  <Th>{isEs ? 'Fin' : 'Ends'}</Th>
                  <Th>{isEs ? 'Cerrado el' : 'Closed at'}</Th>
                  <Th align="right">{isEs ? 'Acciones' : 'Actions'}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-n-200">
                {periods.map((p) => {
                  const monthLabel = getMonthLabel(p.month, language);
                  const inFlight = actionInFlightId === p.id;
                  return (
                    <tr key={p.id} className="hover:bg-gold-500/4 transition-colors">
                      <Td mono>{p.year}</Td>
                      <Td>
                        <span className="text-n-1000">{monthLabel}</span>{' '}
                        <span className="text-n-500 font-mono text-xs-mono">({p.month})</span>
                      </Td>
                      <Td>
                        <Badge variant="status" status={statusBadgeStatus(p.status)}>
                          {p.status === 'open' ? (isEs ? 'Abierto' : 'Open') :
                           p.status === 'closed' ? (isEs ? 'Cerrado' : 'Closed') :
                           (isEs ? 'Bloqueado' : 'Locked')}
                        </Badge>
                      </Td>
                      <Td mono>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(p.startsAt))}</Td>
                      <Td mono>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(p.endsAt))}</Td>
                      <Td mono className="text-n-500">
                        {p.closedAt
                          ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(p.closedAt))
                          : '—'}
                      </Td>
                      <Td align="right">
                        <div className="flex items-center justify-end gap-1.5">
                          {p.status === 'open' && (
                            <>
                              <ActionBtn
                                onClick={() => setCloseTarget(p)}
                                disabled={inFlight}
                                tone="warning"
                                icon={XCircle}
                                label={isEs ? 'Cerrar' : 'Close'}
                              />
                              <ActionBtn
                                onClick={() => performAction(p, 'lock')}
                                disabled={inFlight}
                                tone="danger"
                                icon={Lock}
                                label={isEs ? 'Bloquear' : 'Lock'}
                                title={isEs ? 'Requiere cierre previo' : 'Must close first'}
                              />
                            </>
                          )}
                          {p.status === 'closed' && (
                            <>
                              <ActionBtn
                                onClick={() => performAction(p, 'lock')}
                                disabled={inFlight}
                                tone="danger"
                                icon={Lock}
                                label={isEs ? 'Bloquear' : 'Lock'}
                              />
                              <ActionBtn
                                onClick={() => performAction(p, 'reopen')}
                                disabled={inFlight}
                                tone="neutral"
                                icon={RotateCcw}
                                label={isEs ? 'Reabrir' : 'Reopen'}
                              />
                            </>
                          )}
                          {p.status === 'locked' && (
                            <span className="inline-flex items-center gap-1 text-xs-mono uppercase tracking-eyebrow text-n-500">
                              <Lock className="h-3 w-3" aria-hidden="true" />
                              {isEs ? 'Terminal' : 'Terminal'}
                            </span>
                          )}
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Modales */}
      <OpenPeriodModal
        open={openModal}
        onClose={() => setOpenModal(false)}
        existingPeriods={periods}
        defaultYear={year}
        onPeriodOpened={() => {
          setOpenModal(false);
          fetchPeriods(year);
        }}
      />
      <ClosePeriodConfirmDialog
        period={closeTarget}
        onClose={() => setCloseTarget(null)}
        onClosed={() => {
          setCloseTarget(null);
          fetchPeriods(year);
        }}
      />
    </div>
  );
}

// ─── helpers de tabla ───────────────────────────────────────────────────────

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      scope="col"
      className={cn(
        'px-4 py-2.5 font-mono text-xs-mono uppercase tracking-eyebrow text-n-600 font-medium',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = 'left',
  mono = false,
  className,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  mono?: boolean;
  className?: string;
}) {
  return (
    <td
      className={cn(
        'px-4 py-2.5',
        align === 'right' ? 'text-right' : 'text-left',
        mono && 'font-mono text-xs-mono tabular-nums text-n-1000',
        className,
      )}
    >
      {children}
    </td>
  );
}

interface ActionBtnProps {
  onClick: () => void;
  disabled?: boolean;
  tone: 'warning' | 'danger' | 'neutral';
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  title?: string;
}

function ActionBtn({ onClick, disabled, tone, icon: Icon, label, title }: ActionBtnProps) {
  const toneClasses = {
    warning: 'text-warning hover:bg-warning/10 border-warning/30',
    danger: 'text-danger hover:bg-danger/10 border-danger/30',
    neutral: 'text-n-700 hover:bg-n-100 border-n-300',
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2.5 py-1',
        'text-xs font-medium transition-colors',
        toneClasses,
        'disabled:opacity-50 disabled:cursor-not-allowed',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  );
}

export default PeriodsManagementView;
