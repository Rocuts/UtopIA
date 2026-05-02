'use client';

/**
 * ContabilidadLanding — landing client-side para `/workspace/contabilidad`.
 *
 * Entrega:
 *   - hero del módulo + 3 acciones primarias (Nuevo asiento / PUC / Apertura),
 *   - sección "Últimos asientos" con la salida de `GET /api/accounting/journal`,
 *   - empty-state si no hay asientos: CTA grande "Empieza importando saldos…".
 *
 * Por qué fetch en cliente (y no Server Component): el endpoint resuelve
 * el workspace vía cookie httpOnly, así que recogerla + reenviarla en SSR
 * implicaría duplicar lógica que `proxy.ts` ya cubre. Sigue el mismo patrón
 * que `PymeLanding`. La página `page.tsx` queda como un wrapper SSR fino.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BookOpen,
  Calendar,
  FileText,
  Loader2,
  PlusCircle,
  Upload,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { cn } from '@/lib/utils';
import { formatPesos } from '@/lib/format/cop';

interface RecentEntry {
  id: string;
  entryNumber: number;
  entryDate: string;
  description: string;
  status: 'draft' | 'posted' | 'reversed' | 'voided';
  totalDebit: string;
  totalCredit: string;
  currency?: string;
}

interface ActivePeriod {
  id: string;
  year: number;
  month: number;
  status: 'open' | 'closed' | 'locked';
  label?: string;
}

const STATUS_BADGE: Record<RecentEntry['status'], string> = {
  draft: 'bg-n-100 text-n-700 border-n-300',
  posted: 'bg-success/10 text-success border-success/30',
  reversed: 'bg-warning/10 text-warning border-warning/30',
  voided: 'bg-danger/10 text-danger border-danger/30',
};

export function ContabilidadLanding() {
  const { t, language } = useLanguage();
  const ac = t.accounting;

  const [activePeriod, setActivePeriod] = useState<ActivePeriod | null>(null);
  const [entries, setEntries] = useState<RecentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ─── Boot: resolve open period, then fetch latest entries ───────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const year = new Date().getFullYear();
        const pr = await fetch(`/api/accounting/periods?year=${year}`);
        if (!pr.ok) throw new Error('periods_failed');
        const pj = (await pr.json()) as
          | { ok: true; periods: ActivePeriod[] }
          | ActivePeriod[];
        const list: ActivePeriod[] = Array.isArray(pj)
          ? pj
          : 'periods' in pj && Array.isArray(pj.periods)
            ? pj.periods
            : [];
        const open = list.find((p) => p.status === 'open') ?? list[0] ?? null;
        if (cancelled) return;
        setActivePeriod(open);

        const params = new URLSearchParams({ limit: '10' });
        if (open) params.set('period', open.id);
        const er = await fetch(`/api/accounting/journal?${params.toString()}`);
        if (!er.ok) throw new Error('entries_failed');
        const ej = (await er.json()) as
          | { ok: true; entries: RecentEntry[] }
          | RecentEntry[];
        const ents: RecentEntry[] = Array.isArray(ej)
          ? ej
          : 'entries' in ej && Array.isArray(ej.entries)
            ? ej.entries
            : [];
        if (cancelled) return;
        setEntries(ents);
      } catch {
        if (!cancelled) setError(ac.errorGeneric);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ac.errorGeneric]);

  const periodLabel = useMemo(() => {
    if (!activePeriod) return null;
    if (activePeriod.label) return activePeriod.label;
    const month = String(activePeriod.month).padStart(2, '0');
    return `${activePeriod.year}-${month}`;
  }, [activePeriod]);

  const isEs = language === 'es';

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-8 md:py-10">
      {/* Hero */}
      <header className="mb-10">
        <p className="font-mono text-xs-mono uppercase tracking-eyebrow text-area-escudo font-medium">
          {isEs ? 'Módulo' : 'Module'} · {ac.title}
        </p>
        <h1 className="mt-2 font-serif-elite text-3xl md:text-4xl text-n-1000 tracking-tight">
          {ac.title}
        </h1>
        <p className="mt-1.5 text-sm text-n-700 max-w-2xl">{ac.tagline}</p>
        {periodLabel && (
          <span
            className={cn(
              'mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full',
              'border border-gold-500/25 bg-gold-500/5',
              'text-xs-mono uppercase tracking-eyebrow text-gold-600 font-medium',
            )}
          >
            <Calendar className="h-3 w-3" aria-hidden="true" />
            {ac.period}: {periodLabel}
          </span>
        )}
      </header>

      {/* Primary actions */}
      <section
        aria-label={isEs ? 'Acciones principales' : 'Primary actions'}
        className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10"
      >
        <ActionTile
          href="/workspace/contabilidad/asientos/nuevo"
          icon={PlusCircle}
          title={ac.newEntry}
          description={ac.newEntryDesc}
          accent="gold"
        />
        <ActionTile
          href="/workspace/contabilidad/cuentas"
          icon={BookOpen}
          title={ac.chartOfAccounts}
          description={ac.chartOfAccountsDesc}
          accent="escudo"
        />
        <ActionTile
          href="/workspace/contabilidad/apertura"
          icon={Upload}
          title={ac.openingBalance}
          description={ac.openingBalanceDesc}
          accent="verdad"
        />
      </section>

      {/* Recent entries */}
      <section
        aria-label={ac.recentEntries}
        className="flex flex-col gap-3"
      >
        <header className="flex items-center justify-between">
          <h2 className="font-mono text-xs-mono uppercase tracking-eyebrow text-n-600 font-medium">
            {ac.recentEntries}
          </h2>
          <Link
            href="/workspace/contabilidad/mayor"
            className={cn(
              'inline-flex items-center gap-1 text-xs-mono uppercase tracking-eyebrow',
              'text-gold-600 hover:text-gold-500 transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 rounded',
            )}
          >
            {ac.ledger}
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </header>

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
            className={cn(
              'rounded-md border border-warning/30 bg-warning/8 px-3 py-2',
              'text-sm text-warning',
            )}
            role="status"
          >
            {/* The most likely failure here is "agents B/C/D haven't shipped
                their endpoints yet". We surface a friendly note instead of
                blocking the UI. */}
            {error}
          </div>
        ) : entries.length === 0 ? (
          <EmptyState
            cta={ac.emptyCta}
            hint={ac.emptyHint}
            primaryHref="/workspace/contabilidad/apertura"
            secondaryHref="/workspace/contabilidad/asientos/nuevo"
            secondaryLabel={ac.newEntry}
          />
        ) : (
          <div
            className={cn(
              'rounded-xl border border-gold-500/20 bg-n-0 overflow-hidden',
            )}
          >
            <ul className="divide-y divide-gold-500/10">
              {entries.map((e) => (
                <li
                  key={e.id}
                  className={cn(
                    'flex items-center gap-4 px-4 py-3',
                    'even:bg-n-50 hover:bg-gold-500/8 transition-colors',
                  )}
                >
                  <div className="flex flex-col items-start gap-0.5 min-w-[88px]">
                    <span className="font-mono text-xs-mono tabular-nums text-n-1000 font-medium">
                      #{e.entryNumber}
                    </span>
                    <span className="text-2xs text-n-500 tabular-nums">
                      {new Date(e.entryDate).toLocaleDateString('es-CO')}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-n-1000 truncate">
                      {e.description}
                    </p>
                    <span
                      className={cn(
                        'inline-block text-[10px] font-mono uppercase tracking-eyebrow',
                        'rounded border px-1.5 py-0.5 mt-1',
                        STATUS_BADGE[e.status],
                      )}
                    >
                      {ac.status[e.status]}
                    </span>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="block font-mono text-sm text-n-1000 tabular-nums">
                      {formatPesos(e.totalDebit)}
                    </span>
                    <span className="block text-2xs text-n-500 uppercase tracking-eyebrow font-mono">
                      {ac.debit} / {ac.credit}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Subcomponents ─────────────────────────────────────────────────────────

interface ActionTileProps {
  href: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  description: string;
  accent: 'gold' | 'escudo' | 'verdad' | 'futuro';
}

const ACCENT: Record<
  ActionTileProps['accent'],
  { tint: string; text: string; border: string }
> = {
  gold: {
    tint: 'bg-gold-500/10',
    text: 'text-gold-600',
    border: 'group-hover:border-gold-500/50',
  },
  escudo: {
    tint: 'bg-area-escudo/10',
    text: 'text-area-escudo',
    border: 'group-hover:border-area-escudo/50',
  },
  verdad: {
    tint: 'bg-area-verdad/10',
    text: 'text-area-verdad',
    border: 'group-hover:border-area-verdad/50',
  },
  futuro: {
    tint: 'bg-area-futuro/10',
    text: 'text-area-futuro',
    border: 'group-hover:border-area-futuro/50',
  },
};

function ActionTile({
  href,
  icon: Icon,
  title,
  description,
  accent,
}: ActionTileProps) {
  const palette = ACCENT[accent];
  return (
    <Link
      href={href}
      className={cn(
        'group relative flex items-start gap-4 rounded-xl border bg-n-0',
        'border-gold-500/20',
        palette.border,
        'p-5 transition-all duration-200',
        'hover:-translate-y-0.5 hover:shadow-e3',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
        'focus-visible:ring-offset-2 focus-visible:ring-offset-n-0',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex h-12 w-12 shrink-0 items-center justify-center rounded-lg',
          palette.tint,
          palette.text,
        )}
      >
        <Icon className="h-6 w-6" strokeWidth={1.6} />
      </span>
      <div className="flex-1 min-w-0">
        <h3 className="text-base font-serif-elite font-normal text-n-1000">
          {title}
        </h3>
        <p className="mt-0.5 text-sm text-n-700 font-light">{description}</p>
      </div>
      <ArrowRight
        className="h-5 w-5 shrink-0 text-n-500 transition-transform group-hover:translate-x-1 group-hover:text-gold-500"
        strokeWidth={1.6}
        aria-hidden="true"
      />
    </Link>
  );
}

interface EmptyStateProps {
  cta: string;
  hint: string;
  primaryHref: string;
  secondaryHref: string;
  secondaryLabel: string;
}

function EmptyState({
  cta,
  hint,
  primaryHref,
  secondaryHref,
  secondaryLabel,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-dashed border-gold-500/30 bg-n-0',
        'p-10 text-center flex flex-col items-center gap-4',
      )}
    >
      <span
        aria-hidden="true"
        className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-gold-500/10 text-gold-600"
      >
        <FileText className="h-6 w-6" />
      </span>
      <div>
        <h3 className="text-lg font-serif-elite text-n-1000">{cta}</h3>
        <p className="text-sm text-n-700 max-w-md mx-auto mt-1">{hint}</p>
      </div>
      <div className="flex items-center gap-2">
        <Link
          href={primaryHref}
          className={cn(
            'inline-flex items-center gap-2 px-4 py-2 rounded-md',
            'bg-gold-500 text-n-0 hover:bg-gold-600 transition-colors',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
            'focus-visible:ring-offset-2 focus-visible:ring-offset-n-0',
            'text-sm font-semibold',
          )}
        >
          <Upload className="h-3.5 w-3.5" aria-hidden="true" />
          {cta}
        </Link>
        <Link
          href={secondaryHref}
          className={cn(
            'inline-flex items-center gap-2 px-4 py-2 rounded-md',
            'border border-gold-500/30 text-n-1000 bg-n-0',
            'hover:bg-gold-500/8 transition-colors',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
            'text-sm font-medium',
          )}
        >
          <PlusCircle className="h-3.5 w-3.5" aria-hidden="true" />
          {secondaryLabel}
        </Link>
      </div>
    </div>
  );
}

export default ContabilidadLanding;
