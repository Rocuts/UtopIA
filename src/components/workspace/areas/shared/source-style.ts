// ---------------------------------------------------------------------------
// Estilo cromático por fuente de datos + acento de zona (tokens UtopIA).
// ---------------------------------------------------------------------------
// Colores DECORATIVOS de identidad de fuente (metadata, no tinta de lectura) —
// permitido por la regla de polaridad #5. Cada fuente mapea a un token de marca
// (success/info/gold/warning/wine) con su variante de opacidad para chip/dot.
// ---------------------------------------------------------------------------

import type { SourceKey, ZoneAccent } from './types';

export interface SourceStyle {
  /** Punto de color (dot) que identifica la fuente. */
  dot: string;
  /** Color de tinta del chip (token que adapta por modo). */
  text: string;
  /** Fondo tenue + borde del chip. */
  chipBg: string;
  chipBorder: string;
  /** Fondo del ícono de la tarjeta de fuente. */
  iconBg: string;
}

export const SOURCE_STYLE: Record<SourceKey, SourceStyle> = {
  balance: {
    dot: 'bg-success',
    text: 'text-success',
    chipBg: 'bg-success/12',
    chipBorder: 'border-success/30',
    iconBg: 'bg-success/12',
  },
  auxiliares: {
    dot: 'bg-info',
    text: 'text-info',
    chipBg: 'bg-info/12',
    chipBorder: 'border-info/30',
    iconBg: 'bg-info/12',
  },
  erp: {
    dot: 'bg-gold-500',
    text: 'text-gold-600',
    chipBg: 'bg-gold-500/12',
    chipBorder: 'border-gold-500/30',
    iconBg: 'bg-gold-500/12',
  },
  apiDIAN: {
    dot: 'bg-warning',
    text: 'text-warning',
    chipBg: 'bg-warning/12',
    chipBorder: 'border-warning/30',
    iconBg: 'bg-warning/12',
  },
  apiBanco: {
    dot: 'bg-wine-500',
    text: 'text-area-escudo',
    chipBg: 'bg-wine-500/12',
    chipBorder: 'border-wine-500/30',
    iconBg: 'bg-wine-500/12',
  },
  pronto: {
    dot: 'bg-n-500',
    text: 'text-n-600',
    chipBg: 'bg-n-200/60',
    chipBorder: 'border-n-300',
    iconBg: 'bg-n-200/60',
  },
};

/** Acento del ícono de zona → clases de fondo + tinta. */
export const ZONE_ACCENT: Record<ZoneAccent, { bg: string; text: string }> = {
  wine: { bg: 'bg-wine-500/12', text: 'text-area-escudo' },
  gold: { bg: 'bg-gold-500/12', text: 'text-gold-600' },
  info: { bg: 'bg-info/12', text: 'text-info' },
  success: { bg: 'bg-success/12', text: 'text-success' },
  futuro: { bg: 'bg-area-futuro/12', text: 'text-area-futuro' },
};
