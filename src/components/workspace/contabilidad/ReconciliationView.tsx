'use client';

// ---------------------------------------------------------------------------
// ReconciliationView — vista principal de conciliación bancaria (WS3).
//
// Exports:
//   ConciliacionClientShell  — usado por el page.tsx (carga cuentas, sidebar)
//   ReconciliationView        — panel de detalle para una cuenta seleccionada
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Plus,
  RefreshCw,
  Building2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Upload,
  Loader2,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BankAccountRow } from '@/lib/accounting/banking/types';
import type { ReconciliationStatus } from '@/lib/accounting/banking/types';
import type { AccountingPeriodRow } from '@/lib/db/schema';
import { BankAccountForm, type BankAccountFormData } from './BankAccountForm';
import { ImportStatementDialog } from './ImportStatementDialog';

// ---------------------------------------------------------------------------
// Helpers de formato
// ---------------------------------------------------------------------------

const COP = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

function formatCOP(value: string | null | undefined): string {
  if (value == null) return '—';
  const n = Number(value);
  if (Number.isNaN(n)) return '—';
  return COP.format(n);
}

function diffColor(blocking: boolean, differenceCop: string): string {
  const diff = Math.abs(Number(differenceCop));
  if (diff === 0) return 'text-emerald-400';
  if (blocking) return 'text-red-400';
  return 'text-amber-400';
}

const STATUS_CONFIG: Record<
  ReconciliationStatus['status'],
  { label: string; color: string; icon: typeof CheckCircle2 }
> = {
  balanced: {
    label: 'Conciliado',
    color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    icon: CheckCircle2,
  },
  reviewed: {
    label: 'Revisado',
    color: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    icon: CheckCircle2,
  },
  open: {
    label: 'Pendiente',
    color: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    icon: Clock,
  },
};

// ---------------------------------------------------------------------------
// ReconciliationView — panel de detalle
// ---------------------------------------------------------------------------

interface ReconciliationViewProps {
  bankAccount: BankAccountRow;
  periodId: string;
  onRefreshNeeded?: () => void;
}

export function ReconciliationView({
  bankAccount,
  periodId,
  onRefreshNeeded,
}: ReconciliationViewProps) {
  const [status, setStatus] = useState<ReconciliationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [reconciling, setReconciling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/accounting/banking/status?periodId=${encodeURIComponent(periodId)}`,
      );
      if (!res.ok) throw new Error(`Error ${res.status} al cargar estado de conciliación.`);
      const data = (await res.json()) as ReconciliationStatus[];
      const found = Array.isArray(data)
        ? data.find((s) => s.bankAccountId === bankAccount.id) ?? null
        : null;
      setStatus(found);
    } catch (err) {
      setError((err as Error).message ?? 'Error desconocido.');
    } finally {
      setLoading(false);
    }
  }, [bankAccount.id, periodId]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  async function handleReconcile() {
    setReconciling(true);
    setError(null);
    try {
      const res = await fetch('/api/accounting/banking/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodId, bankAccountId: bankAccount.id }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `Error ${res.status} al reconciliar.`);
      }
      await fetchStatus();
      onRefreshNeeded?.();
    } catch (err) {
      setError((err as Error).message ?? 'Error al ejecutar la conciliación.');
    } finally {
      setReconciling(false);
    }
  }

  const cfg = status ? STATUS_CONFIG[status.status] : null;
  const StatusIcon = cfg?.icon ?? Clock;

  return (
    <div className="space-y-5">
      {/* ── Cabecera cuenta ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-6 py-5">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-mono uppercase tracking-widest text-zinc-500">
              Cuenta bancaria
            </p>
            <p className="mt-0.5 text-lg font-semibold text-zinc-100 leading-tight">
              {bankAccount.bankName}
            </p>
            <p className="text-sm text-zinc-400 font-mono">{bankAccount.accountNumber}</p>
            {bankAccount.holderName && (
              <p className="text-xs text-zinc-600 mt-0.5">{bankAccount.holderName}</p>
            )}
          </div>
          {cfg && (
            <span
              className={cn(
                'inline-flex items-center gap-1.5 self-start sm:self-auto rounded-full border px-3 py-1 text-xs font-medium',
                cfg.color,
              )}
            >
              <StatusIcon className="h-3.5 w-3.5" aria-hidden="true" />
              {cfg.label}
            </span>
          )}
        </div>
      </div>

      {/* ── Error banner ─────────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-800/40 bg-red-950/20 px-4 py-3 text-xs text-red-400">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ── Tiles de estado ──────────────────────────────────────────────── */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-xl bg-zinc-800/60"
            />
          ))}
        </div>
      ) : status ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Saldo libro mayor */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-5 py-4">
              <p className="text-xs text-zinc-500 uppercase tracking-widest font-mono">
                Saldo libro mayor
              </p>
              <p className="mt-2 text-2xl font-semibold text-zinc-100 tabular-nums">
                {formatCOP(status.ledgerBalanceCop)}
              </p>
            </div>
            {/* Saldo banco */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-5 py-4">
              <p className="text-xs text-zinc-500 uppercase tracking-widest font-mono">
                Saldo extracto
              </p>
              <p className="mt-2 text-2xl font-semibold text-zinc-100 tabular-nums">
                {formatCOP(status.bankBalanceCop)}
              </p>
              {status.lastStatementDate && (
                <p className="mt-1 text-xs text-zinc-600">
                  Corte:{' '}
                  {new Date(status.lastStatementDate).toLocaleDateString('es-CO', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  })}
                </p>
              )}
            </div>
            {/* Diferencia */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-5 py-4">
              <p className="text-xs text-zinc-500 uppercase tracking-widest font-mono">
                Diferencia
              </p>
              <p
                className={cn(
                  'mt-2 text-2xl font-semibold tabular-nums',
                  diffColor(status.blocking, status.differenceCop),
                )}
              >
                {formatCOP(status.differenceCop)}
              </p>
              {status.blocking && (
                <p className="mt-1 text-xs text-red-500 font-medium">
                  Bloqueante — cierre suspendido
                </p>
              )}
            </div>
          </div>

          {/* Match summary */}
          <p className="text-sm text-zinc-500">
            <span className="font-medium text-zinc-300">{status.matchedCount}</span>{' '}
            transacciones conciliadas ·{' '}
            <span
              className={cn(
                'font-medium',
                status.unmatchedCount > 0 ? 'text-amber-400' : 'text-zinc-300',
              )}
            >
              {status.unmatchedCount}
            </span>{' '}
            pendientes de conciliación
          </p>
        </>
      ) : (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 py-10 text-center">
          <p className="text-sm text-zinc-500">
            Sin estado de conciliación para este período. Importa el extracto
            para comenzar.
          </p>
        </div>
      )}

      {/* ── Fila de acciones ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => setImportOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-amber-500/10 px-4 py-2.5 text-sm font-medium text-amber-400 transition hover:bg-amber-500/20 border border-amber-500/20"
        >
          <Upload className="h-4 w-4" aria-hidden="true" />
          Importar extracto
        </button>

        <button
          onClick={() => void handleReconcile()}
          disabled={reconciling || loading}
          className={cn(
            'inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition',
            'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          {reconciling ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          )}
          {reconciling ? 'Reconciliando…' : 'Reconciliar automáticamente'}
        </button>
      </div>

      {/* ── Dialog importación ───────────────────────────────────────────── */}
      <ImportStatementDialog
        bankAccount={bankAccount}
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => {
          setImportOpen(false);
          void fetchStatus();
          onRefreshNeeded?.();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ConciliacionClientShell — orquestador con sidebar de cuentas
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

export function ConciliacionClientShell() {
  const [accounts, setAccounts] = useState<BankAccountRow[]>([]);
  const [periods, setPeriods] = useState<AccountingPeriodRow[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<BankAccountRow | null>(null);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('');
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [savingAccount, setSavingAccount] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  // Guard para evitar auto-select al agregar cuentas nuevas
  const hasAutoSelected = useRef(false);

  const fetchAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    setFetchError(null);
    try {
      const res = await fetch('/api/accounting/banking/accounts');
      if (!res.ok) throw new Error(`Error ${res.status} al cargar cuentas.`);
      const data = (await res.json()) as BankAccountRow[];
      const list = Array.isArray(data) ? data : [];
      setAccounts(list);
      if (!hasAutoSelected.current && list.length > 0) {
        setSelectedAccount(list[0]);
        hasAutoSelected.current = true;
      }
    } catch (err) {
      setFetchError((err as Error).message ?? 'Error al cargar cuentas bancarias.');
    } finally {
      setLoadingAccounts(false);
    }
  }, []);

  const fetchPeriods = useCallback(async () => {
    try {
      const year = new Date().getFullYear();
      const res = await fetch(`/api/accounting/periods?year=${year}`);
      if (!res.ok) return;
      const data = (await res.json()) as { periods: AccountingPeriodRow[] };
      const list = data.periods ?? [];
      setPeriods(list);
      // Selecciona el período abierto más reciente, o el último
      const open = list.filter((p) => p.status === 'open');
      const target = open.at(-1) ?? list.at(-1);
      if (target) setSelectedPeriodId(target.id);
    } catch {
      // Silencioso — períodos son opcionales en el render inicial
    }
  }, []);

  useEffect(() => {
    void fetchAccounts();
    void fetchPeriods();
  }, [fetchAccounts, fetchPeriods]);

  async function handleSaveAccount(data: BankAccountFormData) {
    setSavingAccount(true);
    const res = await fetch('/api/accounting/banking/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      throw new Error(body.message ?? body.error ?? `Error ${res.status}`);
    }
    setSavingAccount(false);
    setShowAddForm(false);
    hasAutoSelected.current = false; // permitir auto-select con la nueva cuenta
    await fetchAccounts();
  }

  // ── Render ──────────────────────────────────────────────────────────────

  if (loadingAccounts) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-zinc-800/60" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-xl bg-zinc-800/60" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6 items-start">
      {/* ── Sidebar izquierdo ── */}
      <aside className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400 font-mono">
            Cuentas
          </h2>
          <button
            onClick={() => setShowAddForm((v) => !v)}
            title={showAddForm ? 'Cancelar' : 'Agregar cuenta'}
            className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-800 hover:text-amber-400 transition"
          >
            {showAddForm ? (
              <X className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Plus className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>

        {fetchError && (
          <p className="mb-3 text-xs text-red-400 rounded-lg border border-red-800/40 bg-red-950/20 px-2 py-1.5">
            {fetchError}
          </p>
        )}

        {showAddForm ? (
          <div className="mb-4">
            <BankAccountForm
              onSave={handleSaveAccount}
              onCancel={() => setShowAddForm(false)}
              loading={savingAccount}
            />
          </div>
        ) : accounts.length === 0 ? (
          <div className="text-center py-6">
            <Building2 className="h-8 w-8 text-zinc-700 mx-auto mb-3" aria-hidden="true" />
            <p className="text-xs text-zinc-500 mb-3">
              Agrega tu primera cuenta bancaria para comenzar la conciliación.
            </p>
            <button
              onClick={() => setShowAddForm(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-400 hover:bg-amber-500/20 transition"
            >
              <Plus className="h-3.5 w-3.5" />
              Agregar cuenta
            </button>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {accounts.map((acc) => (
              <li key={acc.id}>
                <button
                  onClick={() => setSelectedAccount(acc)}
                  className={cn(
                    'w-full text-left rounded-lg px-3 py-2.5 transition',
                    selectedAccount?.id === acc.id
                      ? 'bg-amber-500/10 border border-amber-500/20'
                      : 'hover:bg-zinc-800 border border-transparent',
                  )}
                >
                  <p
                    className={cn(
                      'text-sm font-medium truncate',
                      selectedAccount?.id === acc.id ? 'text-amber-400' : 'text-zinc-300',
                    )}
                  >
                    {acc.bankName}
                  </p>
                  <p className="text-xs text-zinc-500 font-mono truncate mt-0.5">
                    {acc.accountNumber}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      {/* ── Panel principal ── */}
      <main className="min-w-0">
        {/* Selector de período */}
        {periods.length > 0 && (
          <div className="mb-5 flex items-center gap-3">
            <label
              htmlFor="period-select"
              className="text-xs text-zinc-500 uppercase tracking-widest font-mono shrink-0"
            >
              Período
            </label>
            <select
              id="period-select"
              value={selectedPeriodId}
              onChange={(e) => setSelectedPeriodId(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
            >
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {MONTH_NAMES[p.month]} {p.year}
                  {p.status === 'open' ? ' (abierto)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {selectedAccount && selectedPeriodId ? (
          <ReconciliationView
            key={`${selectedAccount.id}-${selectedPeriodId}`}
            bankAccount={selectedAccount}
            periodId={selectedPeriodId}
            onRefreshNeeded={fetchAccounts}
          />
        ) : selectedAccount && !selectedPeriodId ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 py-16 text-center">
            <p className="text-sm text-zinc-500">
              No hay períodos contables registrados.{' '}
              <a
                href="/workspace/contabilidad"
                className="text-amber-400 hover:underline"
              >
                Crea un período
              </a>{' '}
              para comenzar la conciliación.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 py-20 text-center">
            <Building2 className="h-10 w-10 text-zinc-700 mx-auto mb-4" aria-hidden="true" />
            <p className="text-sm text-zinc-500">
              Selecciona una cuenta bancaria para ver su estado de conciliación.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
