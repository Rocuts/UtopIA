'use client';

import { Shield, AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCOP } from '@/lib/format/cop';
import { NormaCitation } from './SurvivalCard';
import type { FiscalAnchorBlock, FiscalAlerta } from '@/lib/agents/financial/escudo-survival/fiscal-anchor/types';

// ---------------------------------------------------------------------------
// Translator shape — subset of the i18n key tree for this card
// ---------------------------------------------------------------------------

export interface FiscalAnchorTranslations {
  title: string;
  eyebrow: string;
  eyebrowDemo: string;
  disclaimer: string;
  f01: { title: string; description: string; norma: string };
  f02: { title: string; description: string; norma: string };
  f03: { title: string; description: string; norma: string };
  f04: { title: string; description: string; norma: string };
  f05: { title: string; description: string; norma: string };
  f06: { title: string; description: string; norma: string };
  f07: { title: string; description: string; norma: string };
  f08: { title: string; description: string; norma: string };
  f09: { title: string; description: string; norma: string };
  f10: { title: string; description: string; norma: string };
  calendario: {
    titulo: string;
    retencionFuente: string;
    ivaBimestral: string;
    rentaJuridica: string;
    icaBogota: string;
    diasRestantes: string;
    vencido: string;
  };
  alertas: {
    A5_SIN_PROVISION: string;
    SALDO_A_FAVOR: string;
    VENCIMIENTO_15D: string;
    F10_BAJA: string;
    ICA_ESTIMACION_SIN_CIIU: string;
  };
}

export interface FiscalAnchorCardProps {
  block: FiscalAnchorBlock;
  language: 'es' | 'en';
  t: FiscalAnchorTranslations;
}

// ---------------------------------------------------------------------------
// MoneyCop — centavos string → formatted COP
// ---------------------------------------------------------------------------

function MoneyCop({ centavos, signed = false }: { centavos: string; signed?: boolean }) {
  const n = Number(centavos) / 100;
  if (!Number.isFinite(n)) return <span className="text-n-500">—</span>;
  const formatted = formatCOP(n);
  const isNeg = n < 0;
  const colorClass = signed && isNeg ? 'text-success' : signed && n > 0 ? 'text-danger' : 'text-n-1000';
  return <span className={cn('font-mono num tabular-nums', colorClass)}>{formatted}</span>;
}

// ---------------------------------------------------------------------------
// Fiscal metric row
// ---------------------------------------------------------------------------

interface FMetricProps {
  code: string;
  title: string;
  description: string;
  norma: string;
  value: string;
  signed?: boolean;
  pct?: false;
}

interface FMetricPctProps {
  code: string;
  title: string;
  description: string;
  norma: string;
  pct: true;
  value: number;
}

function FMetric(props: FMetricProps | FMetricPctProps) {
  return (
    <div className="flex flex-col gap-0.5 p-3 rounded-lg bg-[rgb(168_56_56_/_0.06)] ring-1 ring-[rgb(168_56_56_/_0.12)]">
      <span className="text-[10px] uppercase tracking-eyebrow text-n-500 font-medium">
        {props.code}
      </span>
      <span className="text-xs font-medium text-n-700">{props.title}</span>
      <span className="text-[11px] text-n-600 leading-snug">{props.description}</span>
      <div className="mt-1.5 flex items-end justify-between gap-2">
        {props.pct ? (
          <span className="font-mono num tabular-nums text-n-1000 text-base font-semibold">
            {props.value.toFixed(1)}%
          </span>
        ) : (
          <MoneyCop centavos={props.value} signed={props.signed ?? false} />
        )}
        <NormaCitation norma={props.norma} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Alerta chip
// ---------------------------------------------------------------------------

const ALERTA_STYLES: Record<FiscalAlerta['severidad'], string> = {
  error: 'bg-[rgb(239_68_68_/_0.13)] text-danger ring-1 ring-[rgb(239_68_68_/_0.35)]',
  warning: 'bg-[rgb(234_179_8_/_0.13)] text-warning ring-1 ring-[rgb(234_179_8_/_0.32)]',
  info: 'bg-[rgb(59_130_246_/_0.12)] text-[rgb(96_165_250)] ring-1 ring-[rgb(59_130_246_/_0.28)]',
};

const ALERTA_ICON: Record<FiscalAlerta['severidad'], typeof AlertTriangle> = {
  error: AlertTriangle,
  warning: AlertCircle,
  info: Info,
};

function AlertaChip({ alerta, label }: { alerta: FiscalAlerta; label: string }) {
  const Icon = ALERTA_ICON[alerta.severidad];
  return (
    <li
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
        ALERTA_STYLES[alerta.severidad],
      )}
    >
      <Icon className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden="true" />
      {label}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Deadline row
// ---------------------------------------------------------------------------

const ESTADO_DOT: Record<string, string> = {
  vencido: 'bg-danger',
  proximo: 'bg-warning',
  pendiente: 'bg-n-500',
  verificar: 'bg-n-500',
};

function formatDeadlineDate(iso: string, language: 'es' | 'en'): string {
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(language === 'es' ? 'es-CO' : 'en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d);
}

// ---------------------------------------------------------------------------
// Main card
// ---------------------------------------------------------------------------

export function FiscalAnchorCard({ block, language, t }: FiscalAnchorCardProps) {
  const cal = block.calendarioDian;
  const nit = cal?.nit ?? '—';
  const eyebrow = t.eyebrow.replace('{nit}', nit);

  const fEntries: Array<{ code: string; def: { title: string; description: string; norma: string }; val: string | number; pct: boolean; signed?: boolean }> = [
    { code: 'F01', def: t.f01, val: block.f01, pct: false },
    { code: 'F02', def: t.f02, val: block.f02, pct: false },
    { code: 'F03', def: t.f03, val: block.f03, pct: false },
    { code: 'F04', def: t.f04, val: block.f04, pct: false, signed: true },
    { code: 'F05', def: t.f05, val: block.f05, pct: false },
    { code: 'F06', def: t.f06, val: block.f06, pct: false },
    { code: 'F07', def: t.f07, val: block.f07, pct: false },
    { code: 'F08', def: t.f08, val: block.f08, pct: false },
    { code: 'F09', def: t.f09, val: block.f09, pct: true },
    { code: 'F10', def: t.f10, val: block.f10, pct: true },
  ];

  return (
    <article
      className={cn(
        'relative flex flex-col gap-5 p-6 rounded-xl',
        'glass-elite-elevated',
        'ring-1 ring-[rgb(168_56_56_/_0.3)]',
      )}
      aria-label={t.title}
    >
      {/* Ambient glow */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-16 -left-16 w-[220px] h-[220px] rounded-full blur-[80px] opacity-15"
        style={{
          background: 'radial-gradient(circle, rgb(168 56 56 / 0.7) 0%, transparent 70%)',
        }}
      />

      {/* Header */}
      <div className="relative flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <span
            aria-hidden="true"
            className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[rgb(168_56_56_/_0.18)] text-area-escudo"
          >
            <Shield className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-eyebrow text-n-500 font-medium mb-0.5">
              {eyebrow}
            </p>
            <h3 className="font-serif-elite text-xl leading-tight font-medium tracking-tight text-n-1000">
              {t.title}
            </h3>
          </div>
        </div>
        <span
          className={cn(
            'shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full',
            'text-xs font-medium uppercase tracking-label',
            'bg-[rgb(168_56_56_/_0.13)] text-area-escudo ring-1 ring-[rgb(168_56_56_/_0.35)]',
          )}
        >
          <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-area-escudo" />
          {language === 'es' ? 'Capa 1' : 'Layer 1'}
        </span>
      </div>

      {/* F01-F10 grid */}
      <div className="relative grid grid-cols-1 sm:grid-cols-2 gap-3">
        {fEntries.map((entry) =>
          entry.pct ? (
            <FMetric
              key={entry.code}
              code={entry.code}
              title={entry.def.title}
              description={entry.def.description}
              norma={entry.def.norma}
              pct={true}
              value={entry.val as number}
            />
          ) : (
            <FMetric
              key={entry.code}
              code={entry.code}
              title={entry.def.title}
              description={entry.def.description}
              norma={entry.def.norma}
              pct={false}
              value={entry.val as string}
              signed={entry.signed}
            />
          ),
        )}
      </div>

      {/* Calendario DIAN */}
      {cal && cal.vencimientos.length > 0 && (
        <div className="flex flex-col gap-3">
          <h4 className="text-xs uppercase tracking-eyebrow text-n-500 font-medium">
            {t.calendario.titulo}
          </h4>
          <ul role="list" className="flex flex-col gap-2">
            {cal.vencimientos.map((v, i) => {
              const diasLabel =
                v.diasRestantes < 0
                  ? t.calendario.vencido
                  : t.calendario.diasRestantes.replace('{n}', String(v.diasRestantes));
              return (
                <li
                  key={`${v.obligacion}-${i}`}
                  className="flex items-start gap-2.5 text-sm leading-snug"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'mt-1.5 h-1.5 w-1.5 rounded-full shrink-0',
                      ESTADO_DOT[v.estado] ?? 'bg-n-500',
                    )}
                  />
                  <span className="flex-1 min-w-0 flex items-center justify-between gap-3">
                    <span className="text-n-800 truncate">{v.obligacion}</span>
                    <span className="text-n-500 shrink-0 tabular-nums num text-xs">
                      {formatDeadlineDate(v.proximoVencimiento, language)}
                      {' · '}
                      <span
                        className={cn(
                          v.diasRestantes <= 15 && v.diasRestantes >= 0 ? 'text-danger font-medium' :
                          v.diasRestantes <= 45 && v.diasRestantes >= 0 ? 'text-warning' :
                          v.diasRestantes < 0 ? 'text-danger font-medium' :
                          'text-n-600',
                        )}
                      >
                        {diasLabel}
                      </span>
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Alertas */}
      {block.alertas.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="text-xs uppercase tracking-eyebrow text-n-500 font-medium">
            {language === 'es' ? 'Alertas fiscales' : 'Fiscal alerts'}
          </h4>
          <ul
            role="list"
            className="flex flex-wrap gap-2"
            aria-label={language === 'es' ? 'Alertas fiscales activas' : 'Active fiscal alerts'}
          >
            {block.alertas.map((alerta, i) => {
              const label = t.alertas[alerta.codigo] ?? alerta.mensaje;
              return (
                <AlertaChip key={`${alerta.codigo}-${i}`} alerta={alerta} label={label} />
              );
            })}
          </ul>
        </div>
      )}

      {/* Footer normativo */}
      <footer className="mt-auto pt-3 border-t border-n-200/40 dark:border-n-800/40">
        <p className="text-[11px] leading-relaxed text-n-600">
          {t.disclaimer}
        </p>
      </footer>
    </article>
  );
}
