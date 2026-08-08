'use client';
/**
 * Primitivos visuales del módulo Contabilidad Pyme.
 *
 * TODO color sale de `tokens.ts` (PYME / SOFT) vía referencia o `rgba()`.
 * Ningún componente de pantalla debe escribir un literal de color: compone
 * estos primitivos. Montos y tasas SIEMPRE en DM Mono con tabular-nums.
 */
import React, { useState } from 'react';
import { PYME, SOFT, RADIUS, BORDER, FONT, WHITE, rgba, gradient } from './tokens';
import { formatCOP, formatRate } from '../data/calc';

/* ─────────────────────────── Tipografía ─────────────────────────── */

export const uiFont: React.CSSProperties = { fontFamily: FONT.ui };
export const monoFont: React.CSSProperties = {
  fontFamily: FONT.mono,
  fontVariantNumeric: 'tabular-nums',
};

/* ───────────────────────── Card / superficie ───────────────────────── */

export function Card({
  children,
  style,
  radius = RADIUS.lg,
  pad = '0.75rem',
  onClick,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  radius?: string;
  pad?: string | number;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        background: PYME.card,
        border: `${BORDER} ${rgba(PYME.greenDark, 0.12)}`,
        borderRadius: radius,
        padding: pad,
        cursor: onClick ? 'pointer' : undefined,
        ...uiFont,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/* ───────────────────────── SectionHeader ───────────────────────── */

type HeaderTone = 'green' | 'purple';

export function SectionHeader({
  title,
  subtitle,
  icon,
  tone = 'green',
  right,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  tone?: HeaderTone;
  right?: React.ReactNode;
}) {
  const grad =
    tone === 'purple'
      ? gradient(145, PYME.purpleDark, PYME.purple)
      : gradient(145, PYME.greenDark, PYME.green);
  return (
    <div
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: grad,
        borderRadius: RADIUS.lg,
        padding: '1rem',
        ...uiFont,
      }}
    >
      {/* círculo decorativo sutil arriba-derecha */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: -34,
          right: -24,
          width: 96,
          height: 96,
          borderRadius: '50%',
          background: rgba(WHITE, 0.05),
        }}
      />
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10 }}>
        {icon && <div style={{ fontSize: 22, lineHeight: 1 }}>{icon}</div>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: WHITE, fontSize: 15, fontWeight: 800, lineHeight: 1.2 }}>{title}</div>
          {subtitle && (
            <div style={{ color: rgba(WHITE, 0.65), fontSize: 10, marginTop: 2 }}>{subtitle}</div>
          )}
        </div>
        {right && <div style={{ position: 'relative' }}>{right}</div>}
      </div>
    </div>
  );
}

/* ───────────────────────── Total destacado ───────────────────────── */

export function TotalCard({
  label,
  value,
  hint,
  decimals = false,
  footer,
}: {
  label: string;
  value: number;
  hint?: string;
  decimals?: boolean;
  footer?: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: gradient(135, PYME.navy, PYME.navy2),
        borderRadius: RADIUS.lg,
        padding: '0.9rem 1rem',
        ...uiFont,
      }}
    >
      <div style={{ color: rgba(WHITE, 0.7), fontSize: 11, fontWeight: 700 }}>{label}</div>
      <div
        style={{
          ...monoFont,
          color: PYME.gold,
          fontSize: 26,
          fontWeight: 500,
          marginTop: 4,
          letterSpacing: '-0.5px',
        }}
      >
        {formatCOP(value, decimals)}
      </div>
      {hint && <div style={{ color: rgba(WHITE, 0.55), fontSize: 10, marginTop: 2 }}>{hint}</div>}
      {footer && <div style={{ marginTop: 8 }}>{footer}</div>}
    </div>
  );
}

/* ───────────────────────── Money / Rate ───────────────────────── */

export type MoneyKind = 'pos' | 'neg' | 'total' | 'ink' | 'navy' | 'purple';

function moneyColor(kind: MoneyKind): string {
  switch (kind) {
    case 'pos':
      return PYME.success;
    case 'neg':
      return PYME.danger;
    case 'total':
      return PYME.gold;
    case 'navy':
      return PYME.navy;
    case 'purple':
      return PYME.purple;
    case 'ink':
    default:
      return PYME.text;
  }
}

export function Money({
  value,
  kind = 'ink',
  size = 14,
  weight = 600,
  decimals = false,
  prefix,
  style,
}: {
  value: number;
  kind?: MoneyKind;
  size?: number;
  weight?: number;
  decimals?: boolean;
  /** Fuerza un signo visual: '+' (devengado) o '−' (descuento). */
  prefix?: '+' | '−';
  style?: React.CSSProperties;
}) {
  const text = prefix
    ? `${prefix}${formatCOP(Math.abs(value), decimals)}`
    : formatCOP(value, decimals);
  return (
    <span
      style={{ ...monoFont, color: moneyColor(kind), fontSize: size, fontWeight: weight, ...style }}
    >
      {text}
    </span>
  );
}

export function Rate({
  value,
  size = 14,
  weight = 600,
  color = PYME.green,
  style,
}: {
  value: number;
  size?: number;
  weight?: number;
  color?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span style={{ ...monoFont, color, fontSize: size, fontWeight: weight, ...style }}>
      {formatRate(value)}
    </span>
  );
}

/* ───────────────────────── Nota normativa ───────────────────────── */

/** Norma técnica como glosa pequeña gris itálica al pie de un concepto. */
export function NotaNormativa({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ color: PYME.textHint, fontSize: 9.5, fontStyle: 'italic', lineHeight: 1.3 }}>
      {children}
    </span>
  );
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        color: PYME.textSec,
        fontSize: 10,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
      }}
    >
      {children}
    </div>
  );
}

/* ───────────────────────── Badge / chip ───────────────────────── */

export type BadgeTone = 'success' | 'warn' | 'danger' | 'info' | 'neutral';

const BADGE: Record<BadgeTone, { bg: string; fg: string }> = {
  success: { bg: PYME.successBg, fg: PYME.successDark },
  warn: { bg: PYME.warnBg, fg: PYME.warnText },
  danger: { bg: PYME.dangerBg, fg: PYME.dangerText },
  info: { bg: rgba(PYME.blue, 0.12), fg: PYME.blueText },
  neutral: { bg: rgba(PYME.textSec, 0.12), fg: PYME.textSec },
};

export function Badge({ tone, children }: { tone: BadgeTone; children: React.ReactNode }) {
  const c = BADGE[tone];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        background: c.bg,
        color: c.fg,
        fontSize: 9.5,
        fontWeight: 800,
        padding: '2px 7px',
        borderRadius: 999,
        ...uiFont,
      }}
    >
      {children}
    </span>
  );
}

/* ───────────────────────── Botones ───────────────────────── */

function useHover() {
  const [hover, setHover] = useState(false);
  return {
    hover,
    bind: {
      onMouseEnter: () => setHover(true),
      onMouseLeave: () => setHover(false),
    },
  };
}

export function PrimaryButton({
  children,
  onClick,
  full,
  icon,
  style,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  full?: boolean;
  icon?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const { hover, bind } = useHover();
  return (
    <button
      type="button"
      onClick={onClick}
      {...bind}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        width: full ? '100%' : undefined,
        background: hover ? PYME.greenDark : PYME.green,
        color: WHITE,
        border: 'none',
        borderRadius: RADIUS.md,
        padding: '0.7rem 1rem',
        fontSize: 13,
        fontWeight: 800,
        cursor: 'pointer',
        transition: 'background 120ms ease',
        ...uiFont,
        ...style,
      }}
    >
      {icon}
      {children}
    </button>
  );
}

/** Pill secundaria (acciones de alerta, chips de acción). */
export function PillButton({
  children,
  onClick,
  tone = 'green',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  tone?: 'green' | 'red' | 'amber' | 'success' | 'neutral';
}) {
  const map = {
    green: PYME.green,
    red: PYME.danger,
    amber: PYME.warn,
    success: PYME.success,
    neutral: PYME.textSec,
  } as const;
  const base = map[tone];
  const { hover, bind } = useHover();
  return (
    <button
      type="button"
      onClick={onClick}
      {...bind}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        background: hover ? base : rgba(base, 0.12),
        color: hover ? WHITE : base,
        border: `1px solid ${rgba(base, 0.35)}`,
        borderRadius: 999,
        padding: '4px 12px',
        fontSize: 10.5,
        fontWeight: 800,
        cursor: 'pointer',
        transition: 'all 120ms ease',
        ...uiFont,
      }}
    >
      {children}
    </button>
  );
}

/* ───────────────────────── Alertas ───────────────────────── */

export type AlertVariant = 'red' | 'amber' | 'green';

const ALERT: Record<
  AlertVariant,
  { border: string; bg: string; title: string; pill: 'red' | 'amber' | 'success' }
> = {
  red: { border: rgba(PYME.danger, 0.25), bg: SOFT.alertRedBg, title: PYME.dangerDark, pill: 'red' },
  amber: {
    border: rgba(PYME.warn, 0.2),
    bg: SOFT.alertAmberBg,
    title: SOFT.alertAmberTitle,
    pill: 'amber',
  },
  green: {
    border: rgba(PYME.success, 0.2),
    bg: SOFT.alertGreenBg,
    title: PYME.successDark,
    pill: 'success',
  },
};

export function Alert({
  variant,
  icon,
  title,
  children,
  actionLabel,
  onAction,
}: {
  variant: AlertVariant;
  icon: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const c = ALERT[variant];
  return (
    <div
      style={{
        display: 'flex',
        gap: 9,
        border: `${BORDER} ${c.border}`,
        background: c.bg,
        borderRadius: RADIUS.md,
        padding: '0.7rem 0.75rem',
        ...uiFont,
      }}
    >
      <div style={{ fontSize: 18, lineHeight: 1 }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: c.title, fontSize: 11, fontWeight: 800 }}>{title}</div>
        {children && (
          <div style={{ color: PYME.textSec, fontSize: 10, marginTop: 3, lineHeight: 1.4 }}>
            {children}
          </div>
        )}
        {actionLabel && (
          <div style={{ marginTop: 7 }}>
            <PillButton tone={c.pill} onClick={onAction}>
              {actionLabel}
            </PillButton>
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── Burbuja IA ───────────────────────── */

export function AIBubble({
  title,
  children,
  buttonLabel = 'Pregúntale a la IA',
  onAsk,
}: {
  title: string;
  children: React.ReactNode;
  buttonLabel?: string;
  onAsk?: () => void;
}) {
  const { hover, bind } = useHover();
  return (
    <div
      style={{
        background: gradient(135, SOFT.aiFrom, SOFT.aiTo),
        border: `${BORDER} ${rgba(PYME.green, 0.3)}`,
        borderRadius: RADIUS.lg,
        padding: '0.85rem',
        ...uiFont,
      }}
    >
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ fontSize: 20, lineHeight: 1 }}>🤖</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: PYME.greenDark, fontSize: 12.5, fontWeight: 800 }}>{title}</div>
          <div style={{ color: SOFT.iaText, fontSize: 11, marginTop: 3, lineHeight: 1.45 }}>
            {children}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onAsk}
        {...bind}
        style={{
          marginTop: 9,
          width: '100%',
          background: hover ? PYME.greenDark : PYME.green,
          color: WHITE,
          border: 'none',
          borderRadius: RADIUS.md,
          padding: '0.55rem',
          fontSize: 12,
          fontWeight: 800,
          cursor: 'pointer',
          transition: 'background 120ms ease',
          ...uiFont,
        }}
      >
        {buttonLabel}
      </button>
    </div>
  );
}

/* ───────────────────────── Avatar ───────────────────────── */

export function Avatar({ initials, size = 34 }: { initials: string; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: gradient(135, PYME.green, PYME.greenLight),
        color: WHITE,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.4,
        fontWeight: 800,
        flexShrink: 0,
        ...uiFont,
      }}
    >
      {initials}
    </div>
  );
}

/* ───────────────────────── Métrica / KV row ───────────────────────── */

export function MetricChip({
  label,
  value,
  tone = 'ink',
}: {
  label: string;
  value: React.ReactNode;
  tone?: MoneyKind;
}) {
  return (
    <div
      style={{
        background: rgba(PYME.greenDark, 0.04),
        border: `1px solid ${rgba(PYME.greenDark, 0.08)}`,
        borderRadius: RADIUS.sm,
        padding: '7px 8px',
        ...uiFont,
      }}
    >
      <div style={{ color: PYME.textHint, fontSize: 9, fontWeight: 700, lineHeight: 1.2 }}>
        {label}
      </div>
      <div style={{ ...monoFont, color: moneyColor(tone), fontSize: 12.5, fontWeight: 600, marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}

/** Fila etiqueta-valor para tablas de referencia y liquidación. */
export function KVRow({
  label,
  nota,
  children,
  emphasis = false,
}: {
  label: React.ReactNode;
  nota?: React.ReactNode;
  children: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        padding: '8px 0',
        borderTop: `1px solid ${rgba(PYME.greenDark, 0.08)}`,
        ...uiFont,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            color: PYME.text,
            fontSize: 12,
            fontWeight: emphasis ? 800 : 600,
            lineHeight: 1.25,
          }}
        >
          {label}
        </div>
        {nota && (
          <div style={{ marginTop: 1 }}>
            <NotaNormativa>{nota}</NotaNormativa>
          </div>
        )}
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>{children}</div>
    </div>
  );
}

/* ───────────────────────── Acción de card (botón con icono) ───────────────────────── */

export function ActionButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
}) {
  const { hover, bind } = useHover();
  return (
    <button
      type="button"
      onClick={onClick}
      {...bind}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 3,
        flex: 1,
        background: hover ? rgba(PYME.green, 0.1) : PYME.bgPale,
        border: `1px solid ${rgba(PYME.greenDark, 0.1)}`,
        borderRadius: RADIUS.sm,
        padding: '7px 4px',
        color: PYME.greenDark,
        fontSize: 9.5,
        fontWeight: 700,
        cursor: 'pointer',
        transition: 'background 120ms ease',
        ...uiFont,
      }}
    >
      <span style={{ fontSize: 15 }}>{icon}</span>
      {label}
    </button>
  );
}

/* ───────────────────────── Inputs (calculadoras) ───────────────────────── */

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label
      style={{
        display: 'block',
        color: PYME.textSec,
        fontSize: 11,
        fontWeight: 700,
        marginBottom: 5,
        ...uiFont,
      }}
    >
      {children}
    </label>
  );
}

/** Input numérico (montos / días / horas) — valor en DM Mono. */
export function NumberInput({
  value,
  onChange,
  suffix,
  min = 0,
  step = 1,
}: {
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  min?: number;
  step?: number;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        background: PYME.card,
        border: `1.5px solid ${rgba(PYME.greenDark, 0.15)}`,
        borderRadius: RADIUS.md,
        padding: '0 10px',
      }}
    >
      <input
        type="number"
        inputMode="numeric"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        step={step}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        style={{
          ...monoFont,
          flex: 1,
          minWidth: 0,
          border: 'none',
          outline: 'none',
          background: 'transparent',
          color: PYME.navy,
          fontSize: 14,
          fontWeight: 600,
          padding: '0.6rem 0',
        }}
      />
      {suffix && (
        <span style={{ color: PYME.textHint, fontSize: 11, fontWeight: 700, ...uiFont }}>
          {suffix}
        </span>
      )}
    </div>
  );
}

/** Selector segmentado (causa de terminación, opciones). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${options.length}, 1fr)`,
        gap: 6,
      }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            style={{
              background: active ? PYME.green : PYME.bgPale,
              color: active ? WHITE : PYME.greenDark,
              border: `1px solid ${active ? PYME.green : rgba(PYME.greenDark, 0.12)}`,
              borderRadius: RADIUS.sm,
              padding: '8px 6px',
              fontSize: 11,
              fontWeight: 800,
              cursor: 'pointer',
              transition: 'all 120ms ease',
              ...uiFont,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Switch on/off con etiqueta. */
export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        padding: 0,
        ...uiFont,
      }}
    >
      <span
        style={{
          width: 38,
          height: 22,
          borderRadius: 999,
          background: checked ? PYME.green : rgba(PYME.textSec, 0.3),
          position: 'relative',
          transition: 'background 120ms ease',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: checked ? 18 : 2,
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: WHITE,
            transition: 'left 120ms ease',
          }}
        />
      </span>
      <span style={{ color: PYME.text, fontSize: 12, fontWeight: 600, textAlign: 'left' }}>
        {label}
      </span>
    </button>
  );
}

/* ───────────────────────── Layout helper ───────────────────────── */

export function Stack({
  gap = 12,
  children,
  style,
}: {
  gap?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap, ...style }}>{children}</div>
  );
}
