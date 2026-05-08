'use client';

/**
 * ValorExecutiveCards — 4 tarjetas ejecutivas del Pilar Valor.
 *
 * Vista del dueño/CFO: EBITDA · Margen · Ratio · FCF, animadas con CountUp.
 * Coexisten ARRIBA de los 3 KPIs técnicos NIIF (Margen Neto / ROE / EVA).
 * Datos 100% derivados del balance procesado por el Curator (Cierre Virtual R8 +
 * EFE indirecto NIC 7 R2). NUNCA hardcoded.
 *
 * Contrato visual:
 *   EBITDA  → azul     (sky)
 *   Margen  → naranja  (amber)
 *   Ratio   → morada   (violet)
 *   FCF     → verde    (emerald)
 */

import { useMemo } from 'react';
import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react';

import { CountUp } from '@/components/ui/ParallaxWrapper';
import { Card } from '@/components/ui/Card';
import type {
  ExecutiveCard,
  ExecutiveCardColor,
  PillarStatus,
  ValorExecutiveCards as ValorExecutiveCardsData,
} from '@/lib/pillars/types';

interface Props {
  cards?: ValorExecutiveCardsData;
  language: 'es' | 'en';
  density?: 'comfortable' | 'compact';
}

export function ValorExecutiveCards({ cards, language, density = 'comfortable' }: Props) {
  if (!cards) return null;

  const order: Array<keyof Pick<ValorExecutiveCardsData, 'ebitda' | 'waoo' | 'ratio' | 'fcf'>> = [
    'ebitda',
    'waoo',
    'ratio',
    'fcf',
  ];

  return (
    <div
      className={
        density === 'compact'
          ? 'grid grid-cols-2 lg:grid-cols-4 gap-2'
          : 'grid grid-cols-2 lg:grid-cols-4 gap-3'
      }
    >
      {order.map((key) => (
        <ExecutiveCardTile
          key={key}
          card={cards[key]}
          language={language}
          density={density}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tile individual
// ---------------------------------------------------------------------------

interface TileProps {
  card: ExecutiveCard;
  language: 'es' | 'en';
  density: 'comfortable' | 'compact';
}

function ExecutiveCardTile({ card, language, density }: TileProps) {
  const isEs = language === 'es';
  const label = isEs ? card.labelEs : card.labelEn;
  const description = isEs ? card.descriptionEs : card.descriptionEn;
  const formula = isEs ? card.formulaEs : card.formulaEn;

  const display = useMemo(() => formatCardValue(card.value, card.unit), [card.value, card.unit]);
  const deltaDisplay = useMemo(
    () => formatDelta(card.deltaVsComparative, card.unit),
    [card.deltaVsComparative, card.unit],
  );

  const accent = COLOR_TOKENS[card.color];
  const statusDot = STATUS_TOKENS[card.status];

  return (
    <Card
      variant="glass"
      padding={density === 'compact' ? 'sm' : 'md'}
      title={`${label} · ${formula}`}
    >
      <div className="flex flex-col gap-2 h-full">
        {/* Top: color bar + label + status dot */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span
              aria-hidden="true"
              className={`h-2 w-2 rounded-full ${accent.bar} shrink-0`}
            />
            <span className="text-xs-mono uppercase tracking-eyebrow text-n-700 truncate">
              {label}
            </span>
          </div>
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${statusDot.dot}`}
            title={STATUS_LABELS[isEs ? 'es' : 'en'][card.status]}
          />
        </div>

        {/* Middle: animated value */}
        <div className={`font-serif-elite text-2xl lg:text-3xl ${accent.text} leading-none`}>
          {card.value === null ? (
            <span className="text-n-500">—</span>
          ) : (
            <CountUp target={display} />
          )}
        </div>

        {/* Bottom: delta + description */}
        <div className="flex flex-col gap-1 mt-auto">
          {deltaDisplay && (
            <DeltaBadge
              direction={
                card.deltaVsComparative === null || card.deltaVsComparative === 0
                  ? 'flat'
                  : card.deltaVsComparative > 0
                    ? 'up'
                    : 'down'
              }
              text={deltaDisplay}
              betterIsHigher={card.key !== 'ratio'}
            />
          )}
          <p className="text-[10px] leading-snug text-n-700 line-clamp-2">{description}</p>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Delta badge (variación vs comparativo)
// ---------------------------------------------------------------------------

function DeltaBadge({
  direction,
  text,
  betterIsHigher,
}: {
  direction: 'up' | 'down' | 'flat';
  text: string;
  betterIsHigher: boolean;
}) {
  const isPositive =
    (direction === 'up' && betterIsHigher) || (direction === 'down' && !betterIsHigher);
  const Icon = direction === 'flat' ? ArrowRight : direction === 'up' ? ArrowUp : ArrowDown;
  const tone = direction === 'flat'
    ? 'text-n-600'
    : isPositive
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-red-600 dark:text-red-400';

  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${tone}`}>
      <Icon className="h-2.5 w-2.5" aria-hidden="true" />
      {text}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Format helpers (puros, memoizables)
// ---------------------------------------------------------------------------

function formatCardValue(value: number | null, unit: ExecutiveCard['unit']): string {
  if (value === null) return '—';
  if (unit === 'cop') return formatCopAbbr(value);
  if (unit === 'pct') return `${(value * 100).toFixed(1)}%`;
  if (unit === 'ratio') return value.toFixed(2);
  if (unit === 'count') return formatCount(value);
  if (unit === 'score') return formatScore(value);
  if (unit === 'months') return formatMonths(value);
  return String(value);
}

function formatDelta(value: number | null, unit: ExecutiveCard['unit']): string | null {
  if (value === null || value === 0) return null;
  const abs = Math.abs(value);
  if (unit === 'cop') {
    const sign = value > 0 ? '+' : '−';
    return `${sign}${formatCopAbbr(abs).replace(/^\$/, '$')}`;
  }
  if (unit === 'pct') {
    const sign = value > 0 ? '+' : '−';
    return `${sign}${(abs * 100).toFixed(1)} pp`;
  }
  if (unit === 'ratio') {
    const sign = value > 0 ? '+' : '−';
    return `${sign}${abs.toFixed(2)}`;
  }
  if (unit === 'count') {
    const sign = value > 0 ? '+' : '−';
    return `${sign}${Math.round(abs)}`;
  }
  if (unit === 'score') {
    const sign = value > 0 ? '+' : '−';
    return `${sign}${abs.toFixed(0)} pts`;
  }
  if (unit === 'months') {
    const sign = value > 0 ? '+' : '−';
    return `${sign}${Math.round(abs)} meses`;
  }
  return null;
}

/** Formato count: entero sin sufijo. */
function formatCount(value: number): string {
  return `${Math.round(value)}`;
}

/** Formato score: entero / 100. */
function formatScore(value: number): string {
  return `${value.toFixed(0)} / 100`;
}

/** Formato months: X meses. */
function formatMonths(value: number): string {
  return `${Math.round(value)} meses`;
}

/** Formato COP abreviado: $X,XB / $X,XM / $X.XXX. Negativo se prefija con −. */
function formatCopAbbr(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '−' : '';
  if (abs >= 1_000_000_000) {
    const v = (amount / 1_000_000_000).toFixed(1).replace('.', ',');
    return `${sign}$${v.replace(/^-/, '')}B`;
  }
  if (abs >= 1_000_000) {
    const v = (amount / 1_000_000).toFixed(0);
    return `${sign}$${v.replace(/^-/, '')}M`;
  }
  if (abs >= 1_000) {
    const v = (amount / 1_000).toFixed(0);
    return `${sign}$${v.replace(/^-/, '')}K`;
  }
  return `${sign}$${Math.abs(amount).toFixed(0)}`;
}

// ---------------------------------------------------------------------------
// Color tokens (deliberadamente fuera del sistema n-XXX para diferenciar)
// ---------------------------------------------------------------------------

const COLOR_TOKENS: Record<ExecutiveCardColor, { bar: string; text: string }> = {
  blue: { bar: 'bg-sky-500', text: 'text-sky-700 dark:text-sky-300' },
  orange: { bar: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-300' },
  purple: { bar: 'bg-violet-500', text: 'text-violet-700 dark:text-violet-300' },
  green: { bar: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-300' },
};

const STATUS_TOKENS: Record<PillarStatus, { dot: string }> = {
  healthy: { dot: 'bg-emerald-500' },
  watch: { dot: 'bg-amber-500' },
  warning: { dot: 'bg-orange-500' },
  critical: { dot: 'bg-red-500' },
};

const STATUS_LABELS: Record<'es' | 'en', Record<PillarStatus, string>> = {
  es: {
    healthy: 'Saludable',
    watch: 'En observación',
    warning: 'Advertencia',
    critical: 'Crítico',
  },
  en: {
    healthy: 'Healthy',
    watch: 'Watch',
    warning: 'Warning',
    critical: 'Critical',
  },
};

export default ValorExecutiveCards;
