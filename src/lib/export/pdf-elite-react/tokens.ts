// tokens.ts — Hex translation of globals.css @theme tokens for React-PDF.
// React-PDF cannot read CSS custom properties; this file is the single source
// of truth for every primitive/page in the editorial PDF renderer. Light-mode
// values (the print default) are exported as named constants. Spacing uses
// PDF points (1pt = 1/72in).
// ───────────────────────────────────────────────────────────────────────────

import type { AreaKey } from './types';

// ---- Brand / neutrals (warm off-white → espresso black) -------------------
export const N0 = '#FCFBF8';
export const N50 = '#F7F5F0';
export const N100 = '#EFEBE2';
export const N200 = '#E3DDD0';
export const N300 = '#D1C9B8';
export const N400 = '#B3AA95';
export const N500 = '#8A8170';
export const N600 = '#6B6354';
export const N700 = '#4D4638';
export const N800 = '#2F2A20';
export const N900 = '#1A1611';
export const N1000 = '#0C0A06';

// ---- Champagne gold (single brand accent) ---------------------------------
export const GOLD_300 = '#E6D19A';
export const GOLD_400 = '#D4B876';
export const GOLD_500 = '#B8934A';
export const GOLD_600 = '#9A7A38';
export const GOLD_700 = '#7A5F2C';

// ---- Bordeaux (wine — defensa, dictámenes graves) -------------------------
export const WINE_400 = '#C46A76';
export const WINE_500 = '#A04855';
export const WINE_700 = '#722F37';

// ---- Semantic --------------------------------------------------------------
export const SUCCESS = '#4F7A4C';
export const WARNING = '#C48A2E';
export const DANGER = '#A83838';
export const INFO = '#3D6B7E';

// ---- Area accents (4 pilares) ---------------------------------------------
export const AREA_ESCUDO = '#A83838'; // bordeaux — defensa DIAN
export const AREA_VALOR = '#B8934A';  // champagne gold — flagship
export const AREA_VERDAD = '#3D6B7E'; // azul medianoche — rigor
export const AREA_FUTURO = '#5A7F7A'; // teal petróleo — foresight

export const AREA_HEX: Record<AreaKey, string> = {
  escudo: AREA_ESCUDO,
  valor: AREA_VALOR,
  verdad: AREA_VERDAD,
  futuro: AREA_FUTURO,
};

// ---- Spacing scale (in points) --------------------------------------------
export const S1 = 4;
export const S2 = 8;
export const S3 = 12;
export const S4 = 16;
export const S5 = 24;
export const S6 = 32;
export const S7 = 48;
export const S8 = 64;
export const S9 = 96;
export const S10 = 128;

// ---- Radius (in points) ----------------------------------------------------
export const R_SM = 3;
export const R_MD = 6;
export const R_LG = 12;
export const R_PILL = 9999;

// ---- Page geometry ---------------------------------------------------------
/** A4 width in PDF points (210mm). */
export const PAGE_W = 595;
/** A4 height in PDF points (297mm). */
export const PAGE_H = 842;
/** Default outer page margin (matches editorial reference). */
export const PAGE_MARGIN = 48;

// ---- Type families (must match @react-pdf Font.register names) ------------
export const FONT_SANS = 'Geist';
export const FONT_MONO = 'GeistMono';
export const FONT_DISPLAY = 'Fraunces';

// ---- Typographic scale (points) used by primitives ------------------------
export const TYPE_HERO = 60;
export const TYPE_PAGE = 36;
export const TYPE_SECTION = 24;
export const TYPE_BODY = 11;
export const TYPE_CAPTION = 8;
export const TYPE_CHIP = 7;

// ---- Helper: 30%-darker shade for gradient bottoms ------------------------
/** Mix a hex toward black by `pct` (0..1). Useful for gradient stops. */
export function darken(hex: string, pct: number): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return hex;
  const v = parseInt(m[1], 16);
  const r = Math.max(0, Math.round(((v >> 16) & 0xff) * (1 - pct)));
  const g = Math.max(0, Math.round(((v >> 8) & 0xff) * (1 - pct)));
  const b = Math.max(0, Math.round((v & 0xff) * (1 - pct)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** Mix a hex toward white by `pct` (0..1). */
export function lighten(hex: string, pct: number): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return hex;
  const v = parseInt(m[1], 16);
  const r = Math.min(255, Math.round(((v >> 16) & 0xff) + (255 - ((v >> 16) & 0xff)) * pct));
  const g = Math.min(255, Math.round(((v >> 8) & 0xff) + (255 - ((v >> 8) & 0xff)) * pct));
  const b = Math.min(255, Math.round((v & 0xff) + (255 - (v & 0xff)) * pct));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
