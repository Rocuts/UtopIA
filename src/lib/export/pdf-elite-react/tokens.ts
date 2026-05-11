// tokens.ts — ESLOP editorial palette + landscape A4 geometry for React-PDF.
//
// This is the SINGLE SOURCE OF TRUTH for every primitive and page in the
// editorial PDF renderer. React-PDF cannot read CSS custom properties, so all
// design tokens live here as named constants (PDF points; 1pt = 1/72in).
//
// ───────────────────────────────────────────────────────────────────────────
// Migration notes — v1 ESLOP rebuild (2026-05-11)
// ───────────────────────────────────────────────────────────────────────────
//   • Palette shifted from champagne-cream to deep-forest + sage + sand + cream
//     (sampled from `Documentos de orientacion/Informe_Sostenibilidad_CI_ESLOP_2024.pdf`).
//   • Geometry shifted from PORTRAIT A4 (595×842) to LANDSCAPE A4 (842×595).
//     Every <Page> must pass `orientation="landscape"`.
//   • Legacy `N0..N1000` and `GOLD_300..GOLD_700` constants are kept as
//     BACKWARDS-COMPAT aliases mapped to the closest new color, so partially
//     migrated pages still compile. They are @deprecated — new code must use
//     the FOREST / SAGE / SAND / CREAM / CHARCOAL token families.
//   • `WINE_400/500/700` survive for the BLOQUEADO watermark variant.
//   • `AREA_HEX` retuned so escudo/valor/verdad/futuro harmonize with forest.
//   • Type scale enlarged for landscape (hero 120pt, display 200pt).
// ───────────────────────────────────────────────────────────────────────────

import type { AreaKey } from './types';

// ───────────────────────────────────────────────────────────────────────────
// ESLOP — Forest (deep green base, used as dominant surface) ----------------
// ───────────────────────────────────────────────────────────────────────────
export const FOREST_900 = '#0E3A2B'; // cover, section dividers, financial right-panel
export const FOREST_800 = '#114635'; // slight elevation, hover/active
export const FOREST_700 = '#1A5A45'; // mid-forest, chart fills
export const FOREST_600 = '#256B55'; // sage-leaning rounded banners (TOC pill)
export const FOREST_500 = '#357D67'; // softer forest, link tints

// ───────────────────────────────────────────────────────────────────────────
// Sage (cool green-grey, supporting accent) ---------------------------------
// ───────────────────────────────────────────────────────────────────────────
export const SAGE_600 = '#447763'; // deep sage for icon discs on cream
export const SAGE_500 = '#5A8F7B'; // primary sage — circles, donut secondary
export const SAGE_400 = '#7EB39E'; // dotted world-map, donut light slice
export const SAGE_300 = '#AECEC0'; // eyebrow ink (GRI/normative labels)
export const SAGE_200 = '#CDE0D6'; // highlight rectangle behind emphasis word
export const SAGE_100 = '#E2EDE7'; // ultra-light sage tint (rare)

// ───────────────────────────────────────────────────────────────────────────
// Sand (warm gold-tan, signature accent) ------------------------------------
// ───────────────────────────────────────────────────────────────────────────
export const SAND_600 = '#B3935F'; // deepest sand, rare
export const SAND_500 = '#C9A875'; // primary sand-gold — cover sub-headline, hero numerals on dividers
export const SAND_400 = '#D9BE8E'; // pills, totals row backgrounds
export const SAND_300 = '#E5D2AB'; // page-number badge fill, group-bracket strokes
export const SAND_200 = '#EFE2C7'; // bottom gold-rule color
export const SAND_100 = '#F5EBD8'; // softest sand, rare

// ───────────────────────────────────────────────────────────────────────────
// Cream (warm off-white, default light surface) -----------------------------
// ───────────────────────────────────────────────────────────────────────────
export const CREAM_0 = '#FBF8F1';  // cleanest cream — statement table bg
export const CREAM_50 = '#F6F1E6'; // default light surface (TOC, KPIs, Notes…)
export const CREAM_100 = '#EDE6D5'; // soft elevation on cream

// ───────────────────────────────────────────────────────────────────────────
// Charcoal (ink) -------------------------------------------------------------
// ───────────────────────────────────────────────────────────────────────────
export const CHARCOAL_900 = '#1A1A1A'; // primary ink on cream
export const CHARCOAL_800 = '#2A2A2A';
export const CHARCOAL_700 = '#3D3D3D'; // secondary ink, captions

// ───────────────────────────────────────────────────────────────────────────
// Bordeaux / Wine (BLOQUEADO watermark, defensa-DIAN accents) --------------
// ───────────────────────────────────────────────────────────────────────────
export const WINE_400 = '#C46A76';
export const WINE_500 = '#A04855';
export const WINE_700 = '#722F37';

// ───────────────────────────────────────────────────────────────────────────
// Semantic colors ------------------------------------------------------------
// ───────────────────────────────────────────────────────────────────────────
export const SUCCESS = '#5A8F7B';   // = SAGE_500 (positive deltas, healthy ratios)
export const WARNING = '#C9A875';   // = SAND_500 (caution, attention)
export const DANGER = '#722F37';    // = WINE_700 (critical, breach, sanctions)
export const INFO = '#357D67';      // = FOREST_500 (informational)

// ───────────────────────────────────────────────────────────────────────────
// Area accents — 4 pilares (retuned for forest base) ------------------------
// Why: harmonize with the deep-forest dominant surface. ESCUDO stays
// bordeaux-dark to telegraph defensa-DIAN gravity; VALOR is the signature
// sand-gold (flagship); VERDAD is darkened forest (rigor NIIF); FUTURO is
// sage (foresight).
// ───────────────────────────────────────────────────────────────────────────
export const AREA_ESCUDO = '#722F37'; // = WINE_700 — bordeaux, defensa DIAN
export const AREA_VALOR = '#C9A875';  // = SAND_500 — sand-gold, flagship
export const AREA_VERDAD = '#0E3A2B'; // = FOREST_900 — darkest forest, rigor
export const AREA_FUTURO = '#5A8F7B'; // = SAGE_500 — sage, foresight

export const AREA_HEX: Record<AreaKey, string> = {
  escudo: AREA_ESCUDO,
  valor: AREA_VALOR,
  verdad: AREA_VERDAD,
  futuro: AREA_FUTURO,
};

// ───────────────────────────────────────────────────────────────────────────
// Spacing scale (PDF points) ------------------------------------------------
// ───────────────────────────────────────────────────────────────────────────
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

// ───────────────────────────────────────────────────────────────────────────
// Radius (PDF points) -------------------------------------------------------
// ───────────────────────────────────────────────────────────────────────────
export const R_SM = 3;
export const R_MD = 6;
export const R_LG = 12;
export const R_XL = 14;
export const R_2XL = 22;
export const R_PILL = 9999;

// ───────────────────────────────────────────────────────────────────────────
// Page geometry — LANDSCAPE A4 ---------------------------------------------
// 1 mm = 2.8346pt. A4 portrait = 210×297mm → 595×842pt. Landscape swaps:
// width = 297mm = 842pt; height = 210mm = 595pt.
// Every <Page> must pass `orientation="landscape"` (or `size={[PAGE_W, PAGE_H]}`)
// so React-PDF emits the correct MediaBox.
// ───────────────────────────────────────────────────────────────────────────
/** A4 width in PDF points (LANDSCAPE — long edge, 297mm). */
export const PAGE_W = 842;
/** A4 height in PDF points (LANDSCAPE — short edge, 210mm). */
export const PAGE_H = 595;
/** Page orientation string (passed to <Page orientation={…}>). */
export const PAGE_ORIENTATION = 'landscape' as const;
/** Default outer page margin (matches reference editorial layout). */
export const PAGE_MARGIN = 48;
/** Bottom margin reserved for GoldRule + PageNumberBadge (do not overlap). */
export const PAGE_BOTTOM_RESERVED = 56;

// ───────────────────────────────────────────────────────────────────────────
// Type families (must match @react-pdf Font.register names in fonts.ts) ----
// ───────────────────────────────────────────────────────────────────────────
export const FONT_SANS = 'Geist';
export const FONT_MONO = 'GeistMono';
export const FONT_DISPLAY = 'Fraunces';

// ───────────────────────────────────────────────────────────────────────────
// Typographic scale (PDF points) — landscape A4 -----------------------------
// Hero numerals are MASSIVE in the reference (the "50", "92", "44%" on
// p.13–14 are ≈120pt; the "02" section-divider numeral on p.83 is ≈200pt).
// ───────────────────────────────────────────────────────────────────────────
export const TYPE_DISPLAY = 200; // section-divider hero numeral ("02")
export const TYPE_HERO = 120;    // KPI mega-numbers
export const TYPE_H1 = 54;       // cover title
export const TYPE_H2 = 42;       // page-title headlines
export const TYPE_H3 = 22;       // sub-titles, donut center numeral
export const TYPE_LEAD = 13;     // letter intro, financial captions
export const TYPE_BODY = 10;     // default body, table cells
export const TYPE_SMALL = 9;     // table secondary, norm pills sm
export const TYPE_CAPTION = 8;   // footnotes, timestamps
export const TYPE_PILL = 9;      // NormativePill default
export const TYPE_EYEBROW = 10;  // uppercase eyebrow labels (letter-spacing 1.5)

// Legacy aliases — kept so existing prim/page imports still compile during
// the parallel rebuild. New code MUST use the names above.
/** @deprecated Use TYPE_H1. */
export const TYPE_PAGE = TYPE_H2;
/** @deprecated Use TYPE_H3. */
export const TYPE_SECTION = TYPE_H3;
/** @deprecated Use TYPE_PILL. */
export const TYPE_CHIP = TYPE_PILL;

// ───────────────────────────────────────────────────────────────────────────
// Letter-spacing canon ------------------------------------------------------
// ───────────────────────────────────────────────────────────────────────────
export const TRACK_HERO = 0;
export const TRACK_EYEBROW = 1.5;
export const TRACK_CAPS = 2.0; // cover company-name in sand
export const TRACK_BODY = 0;

// ───────────────────────────────────────────────────────────────────────────
// Helpers (preserved verbatim from previous tokens.ts) ----------------------
// ───────────────────────────────────────────────────────────────────────────

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

// ───────────────────────────────────────────────────────────────────────────
// LEGACY ALIASES — DO NOT USE IN NEW CODE ----------------------------------
// These map the previous champagne-cream tokens to their closest ESLOP
// equivalents. Pages partially migrated to the new palette will pick up the
// right colors automatically; pages still on the old palette continue to
// compile. Delete this block after every page has been migrated (Z2 in the
// builder checklist).
// ───────────────────────────────────────────────────────────────────────────

/** @deprecated Use CREAM_0. */ export const N0 = CREAM_0;
/** @deprecated Use CREAM_50. */ export const N50 = CREAM_50;
/** @deprecated Use CREAM_100. */ export const N100 = CREAM_100;
/** @deprecated Use SAND_200. */ export const N200 = SAND_200;
/** @deprecated Use SAND_300. */ export const N300 = SAND_300;
/** @deprecated Use SAGE_300. */ export const N400 = SAGE_300;
/** @deprecated Use SAGE_500. */ export const N500 = SAGE_500;
/** @deprecated Use CHARCOAL_700. */ export const N600 = CHARCOAL_700;
/** @deprecated Use FOREST_700. */ export const N700 = FOREST_700;
/** @deprecated Use FOREST_800. */ export const N800 = FOREST_800;
/** @deprecated Use FOREST_900. */ export const N900 = FOREST_900;
/** @deprecated Use FOREST_900. */ export const N1000 = FOREST_900;

/** @deprecated Use SAND_300. */ export const GOLD_300 = SAND_300;
/** @deprecated Use SAND_400. */ export const GOLD_400 = SAND_400;
/** @deprecated Use SAND_500. */ export const GOLD_500 = SAND_500;
/** @deprecated Use SAND_600. */ export const GOLD_600 = SAND_600;
/** @deprecated Use darken(SAND_500, 0.2). */ export const GOLD_700 = darken(SAND_500, 0.2);
