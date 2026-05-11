# UtopIA Editorial PDF — ESLOP Visual System Spec

**Status:** Builder contract — v1 (2026-05-11)
**Owner:** Johan Rocuts
**Reference document:** `Documentos de orientacion/Informe_Sostenibilidad_CI_ESLOP_2024.pdf`
**Single source of truth for color tokens:** `src/lib/export/pdf-elite-react/tokens.ts`
**Audience:** 4 parallel Sonnet builder teams (A=primitives, B=opener/closing, C=financial, D=narrative)

> Goal: rebuild every page of the editorial PDF report in the visual language of the CI ESLOP 2024 Sustainability Report — landscape A4, deep-forest base, sage / sand-gold accents, generous topographic ornaments, large mixed-weight headlines, circular page-number badge, and split forest/cream layouts for the financial pages. This document is a **builder contract**; if it disagrees with what you see in your IDE or the reference PDF, this spec wins (and you should flag it).

---

## 0. Pipeline contract (do not break)

```
composeEditorialReport(report, preprocessed, pillars)    // unchanged
  → EditorialReport (IR in types.ts, unchanged)
    → EditorialReportDoc({ doc })                        // page composition only
      → <Page> components in pages/*.tsx                 // rebuilt visually
        → primitives + charts                            // rebuilt visually
```

- **`types.ts` is frozen for this refactor.** No new fields, no renames. Pages consume the existing IR; the rebuild is purely visual.
- **`compose.ts` is frozen.** All data shaping continues to work as-is.
- **API routes (`/api/financial-report/export`) are untouched.** The Buffer the renderer streams is opaque to them.
- **Page primitive must be invoked with `size="A4"` and `orientation="landscape"`.** This is the single biggest contract change — every `<Page>` in `pages/*.tsx` must pass `orientation="landscape"` (or `size={[PAGE_W, PAGE_H]}` where the tokens are now landscape). Forgetting this gives portrait 595×842 — the bug looks like "everything wraps and the cover is squished."

---

## 1. Visual DNA

### 1.1 Palette (sampled from reference; canonicalized in `tokens.ts`)

| Token | Hex | Where it shows in the reference | Where we use it |
|---|---|---|---|
| `FOREST_900` | `#0E3A2B` | Cover background, section dividers, financial right-panels, narrative banners | Default dark surface |
| `FOREST_800` | `#114635` | Slightly lighter forest for elevation (e.g. value-prop dark column on p.18) | Hover / elevated dark |
| `FOREST_700` | `#1A5A45` | Mid-forest used in the donut chart (p.25), pie-slice complement | Chart fills, mid-tone fills |
| `FOREST_600` | `#256B55` | Sage-leaning rounded banners (e.g. "Tabla de contenido" pill p.6, dark sage button) | Banner pills, accents |
| `SAGE_500` | `#5A8F7B` | "Crédito" lightbulb circle, donut chart secondary (p.25) | Decorative circles, soft accents |
| `SAGE_400` | `#7EB39E` | Dotted world-map dots (p.11), donut light slice (p.25) | Tertiary accents |
| `SAGE_300` | `#AECEC0` | "GRI 2-22" eyebrow (p.4), "Construcción de Confianza" eyebrows (p.18), light sage highlight | Eyebrow / subtitle ink |
| `SAGE_200` | `#CDE0D6` | Sage highlight rectangle behind "nuestra gerencia" headline (p.4) | Highlight box behind word |
| `SAND_500` | `#C9A875` | Cover sub-headline "C.I. ESLOP S.A.S." gold ink (p.1); section-divider hero "02" numeral (p.83) | Section-divider hero numerals, gold ink |
| `SAND_400` | `#D9BE8E` | Sand-filled pill ("Itsmina" map label p.10) | Pills, totals row backgrounds |
| `SAND_300` | `#E5D2AB` | Page-number circle filled (p.4 onwards) — cream-gold | Page-number badge fill |
| `SAND_200` | `#EFE2C7` | Sand horizontal underline thread along bottom of every page | Bottom gold-rule color |
| `CREAM_50` | `#F6F1E6` | Page background on light pages (p.5, p.9, p.13, p.18, p.20, p.76, p.78L, p.80, p.81) | Default light surface |
| `CREAM_0` | `#FBF8F1` | Cleanest cream (mild brightening over `CREAM_50` for high-contrast tables) | Statement table backgrounds |
| `CHARCOAL_900` | `#1A1A1A` | Body text on cream pages | Default ink on light |
| `CHARCOAL_700` | `#3D3D3D` | Secondary body ink | Captions, footnotes |
| `WINE_700` | `#722F37` | (legacy — kept for BLOQUEADO watermark; not in reference) | BLOQUEADO border accent |

**Polarity rule:** forest pages take `CREAM_0/SAND_300` ink. Cream pages take `FOREST_900/CHARCOAL_900` ink. Never mix.

**2026 trend alignment:** eucalyptus + clay + sand + cream is the dominant 2026 editorial palette (per LinkedIn Design Insights 2026 and It's Nice That's 2026 trend report). The CI ESLOP doc is on-trend by accident — we benefit.

### 1.2 Typography

- **Display (massive headlines, hero numerals):** `Fraunces` 600/700 — already registered. Used for the "50 / 92 / 44%" mega-numbers (p.13-14), the hero numeral "02" on section dividers (p.83), the EVA `$10.885.221.335` callout (p.79).
- **Sans (body, tables, eyebrows):** `Geist` 300/400/500/700 — already registered. The reference uses what looks like a sister-of-Geist humanist sans; Geist is the closest match in our font stack and visually indistinguishable at 9–14pt.
- **Mono (number cells in tables, WACC formula labels, control-totals appendix):** `GeistMono` 400/500 — already registered.

**Scale (landscape A4):**

| Token | Pt size | Used for |
|---|---|---|
| `TYPE_DISPLAY` | `200` | Section-divider hero numeral ("02" on p.83) |
| `TYPE_HERO` | `120` | KPI mega-numbers on KPIGridPage ("50", "44%") |
| `TYPE_H1` | `54` | Cover title ("Reporte NIIF Élite") |
| `TYPE_H2` | `42` | Page-title headlines ("Mensaje de nuestra gerencia", "Estado de situación financiera") |
| `TYPE_H3` | `22` | Sub-titles, value-prop bullets, donut center numeral |
| `TYPE_LEAD` | `13` | Letter intro paragraph, financial captions ("Capital invertido en la operación") |
| `TYPE_BODY` | `10` | Default body copy, statement table cells |
| `TYPE_SMALL` | `9` | Table cell secondary, GRI/NIIF norm pills |
| `TYPE_CAPTION` | `8` | Footnotes, "Generado: …" timestamp |
| `TYPE_PILL` | `9` | Normative pills ("NIIF 1", "Art. 240 E.T.") |
| `TYPE_EYEBROW` | `10` | Uppercase eyebrow labels ("UPSTREAM", "DOWNSTREAM", "GRI 2-22") with letter-spacing 1.5 |

**Letter-spacing canon:**
- Hero / H1: `0` (none — Fraunces breathes already)
- Eyebrows / uppercase: `1.5`
- Sand-gold company name on cover: `2.0`
- Body / tables: `0` to `0.2`

### 1.3 Ornament catalog

Three SVG ornament classes, each with multiple positioning variants. Single primitive (`TopoOrnament`) takes `variant + position + opacity + accent + seed`.

| Variant | What it is | Position variants | Opacity range |
|---|---|---|---|
| `topo-contour` | The signature topographic concentric blobs (see cover, p.5, p.16, p.83). Closed Bézier loops with concentric inner offsets, like a contour map. Replaces current `ribbons` variant. | `corner-tr` (top-right, p.5/p.17), `corner-bl` (bottom-left, p.6/p.16), `corner-tr-large` (full quadrant, p.83), `full-bleed` (cover) | 0.08–0.18 on forest; 0.12–0.20 on cream |
| `topo-half-disc` | Half-disc (D-shape) clipped to right edge of page with topo lines inside it (see cover crescent secondary, p.9 ESLOP logo backplate, p.6 TOC pill in negative space). Distinct from CrescentMask — that's a separate primitive. | `right-edge`, `left-edge`, `bottom-edge` | 1.0 (fill) with topo lines at 0.12 inside |
| `topo-ring` | Standalone circular topographic disc — like the small contour-filled circle on p.1 next to the woman's image. Free-floating, no clipping. | Free position + radius | 0.18 on forest |

All three accept `areaAccent: AreaKey` and resolve color via `AREA_HEX`. Default accent on forest pages = `SAND_300`; on cream pages = `FOREST_700`.

### 1.4 Page geometry

- **Orientation: LANDSCAPE A4** — `PAGE_W = 842`, `PAGE_H = 595` (in PDF points; landscape = the longer side is horizontal)
- **Default margin: 48pt** — same as today. Verified against ref p.4 (≈48pt left margin for "Mensaje de nuestra gerencia").
- **Two-column body grid (cream pages):** `[col-left: 360, gutter: 32, col-right: 360, right-margin: 90]` — note the right-margin reserves space for the portrait/avatar disc.
- **Two-column body grid (forest financial right-panel pages, e.g. p.77):** `[col-left-cream: 480 (60%), col-right-forest: 362 (40%)]` — the forest panel hard-edges from the cream panel; no gutter.
- **Section dividers (p.2, p.83):** full bleed forest, no inner padding except for the hero numeral.

### 1.5 Bottom-of-page signature

Every body page (NOT cover, NOT section dividers) ends with:
- Thin **gold rule** (`SAND_200`, height `0.5pt`) running edge-to-edge at `y = PAGE_H - 28`.
- Tiny **`SAND_300` dot** at the right end of the rule.
- **`PageNumberBadge`** floating just above the right end of the rule — a `SAND_300`-filled circle Ø24pt with the page number in `FOREST_900` Fraunces 11pt centered. This is **the signature ESLOP frame** — every page wears it.

---

## 2. Primitive inventory

All primitives live in `src/lib/export/pdf-elite-react/primitives/`. Each is a pure function component returning a positioned React-PDF subtree. Primitives are layout-neutral unless explicitly absolutely-positioned (TopoOrnament, GoldRule, PageNumberBadge).

### 2.1 `TopoOrnament` (REWORK — already exists)

**File:** `primitives/TopoOrnament.tsx`
**Status:** keep filename, rebuild SVG paths.

```ts
export interface TopoOrnamentProps {
  variant: 'contour' | 'half-disc' | 'ring';
  position?:
    | 'corner-tr' | 'corner-tr-large'
    | 'corner-bl' | 'corner-br'
    | 'right-edge' | 'left-edge' | 'bottom-edge'
    | 'full-bleed' | 'free';
  /** Required when position === 'free'. */
  free?: { x: number; y: number; size: number };
  opacity?: number;     // default 0.12
  areaAccent?: AreaKey; // default SAND_300 on forest, FOREST_700 on cream
  seed?: number;        // deterministic
  /** Override default tinted stroke; rare. */
  stroke?: string;
  /** Background tint for half-disc/ring fill (defaults sage-500 alpha 0.6). */
  fill?: string;
}
```

**Visual specs per variant:**

- **`contour`** (replaces `ribbons`): 5–9 nested closed Bézier loops — irregular potato shapes — that look like topographic contour lines around a hill. Each subsequent loop is a 4-8% inward offset of the previous, with slight perturbation. Stroke only, no fill. Reference: cover crescent right side, p.5 right corner, p.83 large blob.
- **`half-disc`**: filled half-circle (D shape) clipped at one of the four edges. Inside the disc, render `contour` at low opacity. Used as the dark backplate behind the ESLOP logo (p.9) and behind the TOC pill (p.6). Fill = `SAGE_500` alpha 0.85 by default; `FOREST_900` solid when explicitly placed on cream pages.
- **`ring`**: just one closed Bézier loop with concentric inner offsets (like contour) but tightly constrained inside a circle Ø `free.size`. Used as the small `~80pt` circle on cover (left side, alongside the title), and the ornamental rings throughout the report.

**Approach:** seeded LCG for determinism (already in code). Bézier control points placed in normalized [0,1] space then scaled. Each loop has 8–12 anchor points spaced around the perimeter with 5–15% radial jitter.

### 2.2 `PageNumberBadge` (NEW — replaces `PaginationFooter`)

**File:** `primitives/PageNumberBadge.tsx`
**Retires:** `primitives/PaginationFooter.tsx` (delete after migration is done — but during the build, leave it untouched so partially-migrated pages still compile).

```ts
export interface PageNumberBadgeProps {
  /** If absent, uses React-PDF's render-slot pageNumber. */
  pageNumber?: number;
  /** Background tint of the badge — defaults to SAND_300. */
  fill?: string;
  /** Numeral color — defaults to FOREST_900. */
  textColor?: string;
}
```

**Visual:** circle Ø24pt, `fill = SAND_300`, centered numeral in `Fraunces 11pt, weight 600, color FOREST_900`. Absolutely-positioned `bottom: 18, right: 36`. Uses React-PDF's `<Text render={({ pageNumber }) => …} fixed />` pattern. The badge floats just above the gold rule.

**Forest-page variant:** when the surrounding page background is `FOREST_900`, the badge fill stays `SAND_300` and text stays `FOREST_900` — it's identical, just visually pops more on dark. No conditional needed.

### 2.3 `NormativePill` (NEW — replaces `AuthorityChip`)

**File:** `primitives/NormativePill.tsx`
**Retires:** `primitives/AuthorityChip.tsx` (same migration strategy — leave for now, delete in cleanup).

```ts
export interface NormativePillProps {
  /** "NIIF 1", "IFRS 16", "Art. 240 E.T.", "NIA 705", "GRI 2-22"-equivalent */
  label: string;
  /** Optional link target — Suin Juriscol / IFRS.org URL. */
  href?: string;
  /** Defaults to 'sage' on forest pages, 'forest' on cream pages. */
  tone?: 'sage' | 'forest' | 'sand' | 'cream';
  size?: 'sm' | 'md';  // sm = 18pt height, md = 24pt height
}
```

**Visual:** rounded pill with `borderRadius: 9999`, padding `[6, 14]` (sm) or `[8, 18]` (md). Border 0.5pt of the same tone darkened 30%. Label uses `GeistMono` 9pt (sm) / 10pt (md), letter-spacing 1.0, uppercase, color: cream on forest tones, forest on cream/sand tones.

**Tone palette:**
- `sage`: bg `SAGE_500`, text `CREAM_0`
- `forest`: bg `FOREST_900`, text `SAND_300`
- `sand`: bg `SAND_300`, text `FOREST_900`
- `cream`: bg `CREAM_50`, border `FOREST_700` 1pt, text `FOREST_900`

### 2.4 `MixedWeightHeadline` (NEW)

**File:** `primitives/MixedWeightHeadline.tsx`

```ts
export interface MixedWeightHeadlineProps {
  /**
   * Array of segments. Each segment can be light/regular/bold + optional
   * sage-box highlight behind it. Spaces between segments are added
   * automatically.
   */
  segments: Array<{
    text: string;
    weight?: 300 | 400 | 600 | 700;  // default 400
    highlight?: boolean;             // sage-200 rectangle behind
    color?: string;                  // overrides theme default
  }>;
  size: 'display' | 'hero' | 'h1' | 'h2' | 'h3';
  /** Determines default color: dark on cream, light on forest. */
  tone: 'dark-on-light' | 'light-on-dark';
  /** Optional max width to allow line-wrapping; default unbounded. */
  maxWidth?: number;
  /** Default font family — Fraunces for display/hero/h1, Geist for h2/h3. */
  font?: 'fraunces' | 'geist';
}
```

**Visual:** inline-flow text using React-PDF `<Text>` with nested `<Text>` for each segment. The `highlight` flag wraps the segment in a `<View>` with `backgroundColor: SAGE_200`, padding `[2, 6, 4, 6]`, borderRadius 2 — visually a soft pill behind the word. Tone determines `color: light → CREAM_0`, `dark → FOREST_900`. Reference exemplars:
- p.4: "Mensaje de **`{nuestra gerencia}`**" — bold + sage highlight behind "nuestra gerencia"
- p.5: "Presentación del **Informe Sostenibilidad**" — bold on second line, no highlight
- p.18: "PROPUESTA **DE VALOR:**" — heavy bold on emphasized portion

**Why a primitive (and not just nested Text):** the highlight rectangle needs `<View>` + `<Text>` composition with `position: relative` semantics, and React-PDF requires it to be absolutely-positioned to overlay text, which means we need a wrapper. Standard practice in @react-pdf is the segment-array pattern.

### 2.5 `NumberedSectionHeader` (NEW)

**File:** `primitives/NumberedSectionHeader.tsx`

```ts
export interface NumberedSectionHeaderProps {
  /** Section index, two-digit ("01", "02"…) */
  index: string;
  /** Main title — UPPERCASE in reference */
  title: string;
  /** Optional italic subtitle ("Orientaciones Estratégicas:") */
  subtitle?: string;
  /** Background tone — defaults to FOREST_900 */
  bg?: string;
}
```

**Visual:** full-content-width rounded banner (`borderRadius: 14pt`, `backgroundColor: FOREST_900`, padding `[18, 28]`). On the left, a circular `SAND_300`-filled disc Ø44pt with the index numeral in Fraunces 22pt weight 700, color FOREST_900. To the right of the disc, two stacked text lines:
1. **Title** — Geist 14pt weight 700, color CREAM_0, uppercase, letter-spacing 0.8
2. **Subtitle** (optional) — Geist 11pt weight 400, italic, color SAGE_300

Right side of the banner has a small `SAND_300` circle Ø6pt as a visual terminator (see ref p.20 top banner).

Reference exemplar: p.20 header "01. EXPANSIÓN DEL NEGOCIO Y SOLIDEZ FINANCIERA / Orientaciones Estratégicas:".

### 2.6 `GoldRule` (NEW)

**File:** `primitives/GoldRule.tsx`

```ts
export interface GoldRuleProps {
  /** Vertical offset from page bottom. Default 28. */
  bottom?: number;
  /** Horizontal inset from edges. Default 48. */
  inset?: number;
  /** Rule color. Default SAND_200. */
  color?: string;
  /** Show the right-end dot. Default true. */
  dot?: boolean;
}
```

**Visual:** absolutely-positioned `<View>` with `height: 0.5`, `borderBottomWidth: 0.5`, `borderBottomColor: SAND_200`. If `dot`, a small Ø4pt `SAND_300` circle absolutely-positioned at `right: inset - 2, top: -1.5` so it sits on the rule. This composes with `PageNumberBadge` (which floats above it).

**Why a primitive:** every page renders this exact element. Today it's inlined in 13 places; centralizing it lets us tune the rule once.

### 2.7 `CrescentMask` (KEEP — verify against cover crescent)

**File:** `primitives/CrescentMask.tsx`
**Status:** keep API; verify visual matches reference cover crescent (the C-shape behind the woman's image). If the current code renders a different shape, retune the inner-radius / outer-radius / angle params to match the reference.

The cover crescent (ref p.1) is a thick C-arc with: outer radius ~340pt, inner radius ~260pt, opening angle ~280° rotated so the gap faces the bottom-left. Image is clipped inside the crescent.

### 2.8 `EditorialTitle` (REVIEW — upgrade to use `MixedWeightHeadline`)

**File:** `primitives/EditorialTitle.tsx`
**Status:** keep API for backwards-compat, but internally delegate to `MixedWeightHeadline`. The `emphasisStyle: 'box'` becomes the `highlight: true` flag on the emphasis segment. The `size: 'hero' | 'page' | 'section'` maps to `'h1' | 'h2' | 'h3'`. The `tone: 'light-on-dark' | 'dark-on-light'` passes straight through.

This is the migration shim — existing pages keep calling `EditorialTitle`, but the new primitive does the work. Builders writing new pages should call `MixedWeightHeadline` directly for full control.

### 2.9 `AvatarInitials` (REVIEW)

**File:** `primitives/AvatarInitials.tsx`
**Status:** keep — but rebuild the gradient stops. Reference p.4 / p.5 portrait discs use a sand-gold concentric ring around the portrait photo. For the financial-report use case (no real photo, just initials), render: circle Ø96pt, fill `SAGE_500` alpha 0.4, inner circle Ø80pt with `SAND_300` fill, initials in Fraunces 28pt weight 600, color FOREST_900. Outer ring is a thin `SAND_300` 1pt stroke at `r = 50pt`.

### 2.10 `WatermarkWord` (KEEP)

**File:** `primitives/WatermarkWord.tsx`
**Status:** keep API. Just update default color from `GOLD_500` → `SAND_400` in the new palette context.

### 2.11 `MarkdownToPdf` (KEEP, retune typography)

**File:** `primitives/MarkdownToPdf.tsx`
**Status:** keep API — but update default `color` to `CHARCOAL_900` (on cream pages) and add an explicit `tone: 'dark-on-light' | 'light-on-dark'` prop that flips defaults. Body font Geist 10pt, headings Fraunces 14pt → 18pt → 22pt for h3 → h2 → h1.

### 2.12 Retired primitives

These two primitives are **no longer canonical** but remain in the file system during migration so partially-updated pages still compile. They are deleted once **all** pages have migrated.

- `primitives/AuthorityChip.tsx` → replaced by `NormativePill`
- `primitives/PaginationFooter.tsx` → replaced by `PageNumberBadge` + `GoldRule`

When deleting, remove from `primitives/index.ts` first, then `git rm`.

---

## 3. Page-by-page spec

Each page is **landscape A4 (842 × 595pt)**. Every page MUST call `<Page size="A4" orientation="landscape" …>`. Every body page MUST render `<GoldRule />` and `<PageNumberBadge />` at the bottom.

### 3.1 `CoverPage.tsx` — Forest hero with crescent + image-less title

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                                                       ╭──╮      │  ← UtopIA logomark (top-right)
│                                                       ╰──╯      │
│                                  ╭──────────╮                   │
│                                 ╱  contour  ╲                   │
│   Reporte                      ╱   crescent  ╲                  │ ← FOREST_900 full bleed
│   ▓▓NIIF Élite▓▓              ╱   ─ ─ ─ ─ ─  ╲                 │   (sage-highlight on emphasis)
│                              │   topo-ring    │                  │
│   {COMPANY NAME}              ╲                ╲                 │
│   NIT 901.234.567-8            ╲              ╱                 │
│   Periodo 2026                  ╲────────────╱                  │
│                                                                  │
│                                                  topo-ring      │
│                                                  (sand)         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                                                          UtopIA  ← watermark word, bottom-right
```

- **Background:** `FOREST_900` full bleed.
- **Layout:** title block left-aligned, x ≈ 80pt, vertically centered. Crescent + topo-ring composition fills the right two-thirds.
- **Title:** `MixedWeightHeadline` with segments `[{ text: 'Reporte', weight: 300 }, { text: 'NIIF Élite', weight: 700, highlight: true }]`, size `display`, tone `light-on-dark`. Sage-200 highlight box behind "NIIF Élite". Watermark variants override emphasis word ("BORRADOR" sand-highlight, "BLOQUEADO" bordeaux WINE_700-highlight).
- **Identity block:** below title — `companyName` in `SAND_500` Geist 16pt letter-spacing 2.0, then `NormativePill` (`tone='sand'`) with `NIT {nit}`, then `Periodo {fiscalPeriod} {comparativePeriod ? `vs ${comparativePeriod}` : ''}` in `CREAM_50` Geist 13pt.
- **Right composition:** large `TopoOrnament` with `variant='contour' position='corner-tr-large' opacity=0.25 areaAccent='valor' seed=42`. Behind it, a `CrescentMask` clipped element (the C-shape). The reference uses a photo inside the crescent — for the financial report, we render a smaller `TopoOrnament variant='ring'` instead (no stock photography). One additional small `topo-ring` at `(x=200, y=420, size=70)` sand-tinted.
- **Data inputs:** `doc.meta.companyName`, `doc.meta.nit`, `doc.meta.fiscalPeriod`, `doc.meta.comparativePeriod`, `doc.cover.accentArea`, `doc.meta.watermark`, `doc.meta.watermarkSubtitle`.
- **No PageNumberBadge** (cover is unnumbered).
- **No GoldRule** on cover.
- **Page-wrap:** hard single page.
- **Mimics ref:** p.1 (cover) + the geometry-only abstraction of p.83 (large numeral).

### 3.2 `DirectorLetter.tsx` — Mixed-weight headline + 2-col body + portrait disc

```
┌─────────────────────────────────────────────────────────────────┐
│  Mensaje de ▓▓nuestra gerencia▓▓                        ╭───╮   │ ← H2 mixed-weight headline
│  [NormativePill: "Art. 28 Ley 222/95"]                  │ V │   │
│  Estimados accionistas, …                               │ E │   │ ← AvatarInitials (sand/sage ring)
│                                                          ╰───╯   │
│  Lorem ipsum dolor sit amet,    │ Sed do eiusmod tempor          │
│  consectetur adipiscing elit.   │ incididunt ut labore et dolore │
│  Body paragraph 1 …             │ magna aliqua …                 │
│  ……………………………………………………………       │ …………………………………………………………       │
│  **Crecimiento sostenido**       │ **Visión 2026: foresight**     │
│  Body … cite NIIF 1, NIIF 7      │ Body … cite Art. 240 E.T.      │
│                                                                   │
│                                                          Vanessa Espinal
│                                                          Gerente General
│  ───────────────────────────────────────────────────────────  •  │
│                                                              ⓟ  │
└─────────────────────────────────────────────────────────────────┘
```

- **Background:** `FOREST_900` full bleed (matches ref p.4 — letter is on forest, not cream).
- **Top-right ornament:** small `TopoOrnament variant='contour' position='corner-tr' opacity=0.18 areaAccent='valor'`.
- **Title:** `MixedWeightHeadline` h2, tone `light-on-dark`, segments `[{ text: 'Mensaje de', weight: 300 }, { text: 'nuestra gerencia', weight: 700, highlight: true }]`.
- **Pill row:** below title, render `directorLetter.citations.slice(0, 3)` as `NormativePill` tone=`sage`.
- **Eyebrow:** "Estimados accionistas, colaboradores, clientes …" in `SAGE_300` Geist 11pt italic.
- **Body:** 2-column layout, `MarkdownToPdf` rendering `directorLetter.bodyMarkdown` with `tone='light-on-dark'`. Bold headings inside the markdown use `SAND_300` ink. Column width ≈ 290pt each, gutter 28pt.
- **Portrait:** right-aligned `AvatarInitials` Ø96pt, sand-gold ring, `initials = directorLetter.portrait.initials` (default "VE" for Vanessa-Espinal demo). Vertical position: ~y=70 (top-aligned with body).
- **Signature:** below the avatar, name `signerName` (Geist 12pt 700, CREAM_0) and role `signerRole` (Geist 10pt 400, SAGE_300). A small SAND_200 underline 80pt under it.
- **Bottom:** `GoldRule` + `PageNumberBadge`.
- **Data inputs:** `doc.directorLetter.{portrait, bodyMarkdown, citations, signerName, signerRole}`.
- **Page-wrap:** if `bodyMarkdown` exceeds one page worth, allow wrapping — second page repeats no headline, just the body with `wrap` enabled.
- **Mimics ref:** p.4 + portrait styling from p.5.

### 3.3 `TocPage.tsx` — Title-as-pill + numbered TOC dotted entries

```
┌─────────────────────────────────────────────────────────────────┐
│  ╭──────────────────────╮                                       │
│  │  Tabla de contenido  │      (FOREST_600 rounded pill)        │
│  ╰──────────────────────╯                                       │
│                                                                  │
│  Acerca de nuestro informe   ─────────────────────  7  ··········│
│  Acerca de nosotros          ─────────────────────  9            │
│  Nuestra Cadena de valor     ─────────────────────  11           │
│  Modelo de Negocio           ─────────────────────  14           │
│                                                                  │
│                            TEMA 1: GOBERNANZA …      ──── 38     │
│                            TEMA 2: MINERÍA …         ──── 51     │
│                            TEMA 3: ADAPTACIÓN …      ──── 60     │
│                                                                  │
│  ──────────────────────────────────────────────────────────  •  │
│                                                              ⓟ  │
└─────────────────────────────────────────────────────────────────┘
```

- **Background:** `CREAM_50` full bleed.
- **Title pill:** rounded forest-600 pill at top-left with "Tabla de contenido" inside in Geist 18pt 700, color CREAM_0. Borders fully rounded (R 16pt).
- **TOC body:** 2 columns. Each `TocEntry` renders a row:
  - **Label** Geist 11pt, color FOREST_900, weight 400 (uppercased weight 700 if `entry.uppercase`)
  - **Connector dots:** thin `CHARCOAL_700` horizontal line, height 0.5pt, growing to fill space (use `flex: 1` between label and page-number)
  - **Page number:** Geist 11pt 700, color FOREST_900, right-aligned
- Inserted between sections, render small section-divider rows: `TEMA N: TITLE` with letter-spacing 1.0, uppercase, color SAGE_300.
- **Decorative:** right side bottom, a `TopoOrnament variant='ring' free={{x: 700, y: 420, size: 140}} areaAccent='futuro' opacity=0.6`. And a small `topo-contour` at top-right corner low-opacity.
- **Data inputs:** `doc.toc.entries: TocEntry[]`.
- **Page-wrap:** allow wrapping to a second TOC page if entries > 18.
- **Mimics ref:** p.6.

### 3.4 `SectionDivider.tsx` — Full-bleed forest with hero numeral

```
┌─────────────────────────────────────────────────────────────────┐
│   ╭──╮                                                          │
│  ╱    ╲   topo-contour (large, corner-tr)                       │ ← FOREST_900 full bleed
│ │     │                                                          │
│  ╲    ╱                                                          │
│   ╰──╯                                                           │
│                                                                  │
│       ┌─────────╮                                                │
│       │  Estados│                       ██████████               │
│       │ ◯       │                       ██  ██  ██               │
│       │  financ.│                       ██  ██  ██               │
│       └─────────╯                       ██████████               │
│                                            01                    │
│                                                                  │
│  ⓟ                                                              │ ← page-number badge, bottom-left
└─────────────────────────────────────────────────────────────────┘
```

- **Background:** `FOREST_900` full bleed.
- **Hero numeral:** Fraunces 200pt weight 700, color `SAND_500`, positioned at `right: 60, bottom: 60`. Letter-spacing -8 (tight). Content: "01" / "02" / "03" depending on which bloque (Estados Financieros, Análisis Estratégico, Gobierno Corporativo).
- **Section title:** `MixedWeightHeadline` size `h1`, tone `light-on-dark`, positioned at `left: 80, top: 240`. Segments `[{ text: sectionTitle, weight: 300 }, { text: sectionEmphasis, weight: 700 }]`. A small `SAGE_500` filled Ø80pt circle behind the emphasis word at offset.
- **Ornament:** large `TopoOrnament variant='contour' position='full-bleed' opacity=0.22 areaAccent='valor' seed=200`.
- **Small SAND_300 dot** at top-right corner (~Ø8pt) — terminator detail.
- **PageNumberBadge** at `left: 36, bottom: 18` (left-aligned on dividers — see ref p.83).
- **No GoldRule** on dividers (the bottom of the page is owned by the hero numeral).
- **Data inputs:** `areaAccent`, `sectionTitle`, `sectionEmphasis`, `sectionIndex: string` (NEW prop — see migration note below).
- **Migration note:** the current `SectionDivider` takes only `areaAccent`, `sectionTitle`, `sectionEmphasis`. To get the hero numeral, the page must know its index ("01" / "02" / "03"). Add an optional `sectionIndex?: string` prop, default it to derive from `areaAccent` mapping (`valor → '01'`, `verdad → '02'`, `escudo → '03'`, `futuro → '04'`). EditorialReportDoc.tsx must pass it explicitly.
- **Mimics ref:** p.83.

### 3.5 `KPIGridPage.tsx` — Hero-numeral KPI page

```
┌─────────────────────────────────────────────────────────────────┐
│  Indicadores ▓▓clave del período▓▓                              │ ← Headline + sage-highlight emphasis
│  [Pills: NIIF 1.10 · IFRS 18 · NIIF 7]                          │
│                                                                  │
│  ┌─────────┬─────────┬─────────┬─────────┐                      │
│  │ Ingresos│ Utilidad│ ROA     │ ROE     │                      │
│  │ ───     │ ───     │ ───     │ ───     │                      │
│  │  $1.97B │  $9.1B  │ 13,79%  │ 46,51%  │  ← TYPE_HERO Fraunces│
│  │ ▲ 165%  │ ▲ 507%  │ ▲ 7,2   │ ▲ 18,6  │                      │
│  ├─────────┼─────────┼─────────┼─────────┤                      │
│  │ Margen  │ Razón   │ Días CxC│ Endeud. │                      │
│  │ EBITDA  │ Cte.    │         │         │                      │
│  │  1,54%  │  1,22   │  5,77   │ 13,93%  │                      │
│  │ ▼ 0,3   │ flat    │ ▲ 1,2   │ ▼ 12,1  │                      │
│  └─────────┴─────────┴─────────┴─────────┘                      │
│                                                                  │
│  ──────────────────────────────────────────────────────────  •  │
│                                                              ⓟ  │
└─────────────────────────────────────────────────────────────────┘
```

- **Background:** `CREAM_50`.
- **Title:** `MixedWeightHeadline` h2 tone `dark-on-light`.
- **Grid:** 4 columns × up-to-3 rows. Each cell is a `<View>` with:
  - `label` (Geist 10pt, color CHARCOAL_700, letter-spacing 0.5, uppercase, weight 600)
  - **value** Fraunces 36pt weight 700, color FOREST_900 (size scales down to 28pt if value string > 8 chars)
  - **unit** (small) Geist 11pt FOREST_700 to the right of the value (e.g. "%")
  - **delta** small row: arrow ▲ / ▼ / "flat" + percent. Color: `SAGE_500` for positive, `WINE_700` for critical, `SAND_500` for warning, `CHARCOAL_700` for neutral.
- **Hero-number override:** if `kpis.length === 1`, blow up to TYPE_HERO (120pt) with a HUGE "44%" treatment (ref p.14 mega-percentage). UtopIA's NIIF reports rarely use 1 KPI so this is a nice-to-have.
- **Decorative:** `TopoOrnament variant='ring' free={{x: 760, y: 480, size: 90}} areaAccent='valor' opacity=0.5` in the bottom-right.
- **Data inputs:** `doc.kpiGrid.kpis: KpiCell[]` (max 12, 4×3 grid).
- **Page-wrap:** hard single page (12 KPIs cap).
- **Mimics ref:** p.13 (hero numerals) + p.20 (KPI grid layout) + p.80 (badge row variant).

### 3.6 `StatementsPages.tsx` — Split cream/forest IFRS pages (CRITICAL)

This is the **money page**. Four sub-pages (Balance, P&L, Cash-Flow, Equity-Changes), each with the same split layout. Builder C must nail this — it's the differentiator vs. competitors that ship plain markdown tables.

```
┌──────────────────────────────────────┬─────────────────────────┐
│ Activos                              │                          │
│ Activos corrientes                   │ Estado de                │ ← Title in CREAM_0
│ Efectivo y equiv.       2.4B   7.4B  │ situación financiera    │   on FOREST_900
│ Inversiones LP            —    8.2B  │                          │
│ Deudores comerc.        25.8B 31.2B  │ Capital invertido        │
│ ────────────────────────────────     │ en la operación          │ ← Caption in SAGE_300
│ Activos corrientes      29.0B 62.2B  │                          │
│                                       │ + 7.407.819.761          │
│ Activos no corrientes                │ + 31.270.146.483         │ ← Mono numbers on dark,
│ Propiedad, planta        1.0B  1.6B  │ + 1.526.574.150          │   CREAM_0 ink
│ Intangibles              0.0B  1.9B  │ + 13.815.508.718         │
│ ────────────────────────────────     │              ╮            │
│ Activos no corrientes    1.7B  3.8B  │              ├ Activos    │ ← Bracket connector
│ ────────────────────────────────     │              │   Operativos│  in SAND_300, with
│ Activos totales        30.8B 66.0B   │              │  $57.889M   │  label callout
│                                       │              ╯            │
│ PASIVOS Y PATRIMONIO                 │                            │
│ Obligaciones financ.    20.4M  7.2B  │ - 28.852.760.996          │
│ …                                     │                            │
│                                       │   $20.612.165.204         │ ← Total in SAND_500
│                                       │   (FINAL TOTAL)            │   bold Fraunces 16pt
│ ──────────────────────  •            │                            │ ← GoldRule + dot crosses
│                                  ⓟ   │                            │   under the seam
└──────────────────────────────────────┴─────────────────────────┘
   ←  cream panel 60% (≈505pt)  →    ← forest panel 40% (≈337pt) →
```

- **Background:** `<Page>` background `CREAM_0` (light cream — slightly cleaner than `CREAM_50` to maximize table contrast). The right 40% is overlaid with a full-height `<View>` `backgroundColor: FOREST_900`.
- **Left panel (cream, 60%):** the full IFRS table — `<TableView>` renders `doc.statements.balance | income | cashFlow | equity`.
  - Headers: Geist 9pt 700, uppercase, letter-spacing 0.6, color FOREST_900, with bottom border 1pt FOREST_900.
  - Body cells: account name in Geist 9pt 400 FOREST_900, value cells in GeistMono 9pt CHARCOAL_900 right-aligned.
  - **Subtotal rows** (`emphasis === 'subtotal'`): top-border 0.5pt FOREST_700, bg `SAND_300` alpha 0.2, font weight 600, ink FOREST_900.
  - **Total rows** (`emphasis === 'total'`): top-border 1pt FOREST_900, bg `SAND_300` solid, font weight 700, ink FOREST_900. (Reference p.77 — sand-tinted bands behind totals.)
  - Group header rows ("Activos corrientes", "PASIVOS Y PATRIMONIO"): Geist 10pt 700 FOREST_700, no underline, padded top 8pt for breathing room.
- **Right panel (forest, 40%):**
  - **Header block:** `MixedWeightHeadline` size `h2` tone `light-on-dark`, lines [leadText "Estado de", emphasisText "situación financiera"]. Below it, caption text in `SAGE_300` italic Geist 11pt ("Capital invertido en la operación", "Utilidad Operativa después de impuestos (UODI)", etc.) — caption is **per-statement** (data lives in `table.caption` for now; see builder note below).
  - **Abstraction figures:** stack of mono-aligned numbers grouped by NIIF-category bracket. Each row: GeistMono 11pt CREAM_0, sign-prefixed (`+ 7.407.819.761`, `- 28.852.760.996`). Group brackets drawn as SVG `<Path>` (a square-cornered curly brace on the right edge of the number column) with `stroke=SAND_300 strokeWidth=0.8`.
  - **Group label** (next to the bracket): Geist 11pt 700, color CREAM_0 (e.g. "Activos Operativos"), with sum below in Fraunces 13pt 700 SAND_300 (`+ 57.889.422.043`).
  - **Final TOTAL** at bottom: Fraunces 22pt 700, color SAND_500 (e.g. "$20.612.165.204"). Centered or right-aligned in panel.
- **Connector lines (optional, from reference p.77):** ultra-thin SAGE_400 strokeWidth 0.4 lines drawn diagonally from each LEFT-panel value to its corresponding RIGHT-panel abstraction figure. These are decorative — implemented as absolutely-positioned SVG paths. If too complex, omit on the first pass; design still reads without them.
- **Builder note on captions per statement:** the right-panel caption text differs per statement:
  - Balance: "Capital invertido en la operación"
  - Income: "Utilidad Operativa después de impuestos (UODI)"
  - Cash Flow: "Flujo de caja libre del período"
  - Equity: "Variación en el patrimonio neto"

  These are static strings — hardcode them in `StatementsPages.tsx` keyed by statement name. Do not push back into the IR.
- **Builder note on abstraction figures:** the right-panel grouped figures are NOT in the IR. Compute them inline from `table.rows` by reading the rows tagged with `emphasis === 'subtotal'` (these are the natural group sums). If a statement has no subtotals, fall back to showing the rows with `emphasis === 'total'`. Worst case (no emphasis tags), render just the title + the bottom TOTAL = last row.
- **NormativePill row** below the title: `[NormativePill label='NIIF 1.10 - 1.114' tone='sand']`, `[NormativePill label='Art. 35 Ley 222/95' tone='sand']`. Customized per statement:
  - Balance: NIIF 1.10, IAS 1.54
  - Income: NIIF 5.36, IAS 1.81
  - Cash Flow: NIIF 7, IAS 7.10
  - Equity: NIIF 6.20, IAS 1.106
- **Page-wrap:** the LEFT panel allows `wrap` — long balance sheets cascade to a second page. The RIGHT panel renders only on the **first** page of each statement (use `<View fixed>` for header, regular for abstraction figures). The forest panel must STAY visually intact on subsequent wrapped pages even with no abstraction figures — fill it with a low-opacity `topo-contour` ornament instead.
- **Bottom:** `GoldRule` (crosses both panels — full-bleed) + `PageNumberBadge` on the cream side.
- **Mimics ref:** p.77 (balance, the gold standard), p.78 (income).

### 3.7 `WaterfallPnLPage.tsx` — Waterfall chart, cream surface

```
┌─────────────────────────────────────────────────────────────────┐
│  Composición del ▓▓Resultado Neto▓▓                              │
│  [NormativePill: "IAS 1.81" "NIIF 5.36"]                         │
│                                                                  │
│         █████                                                    │
│         █████ Ventas       (+)                                   │
│         █████  ─────  ─── Costo Vtas  (-)                        │
│         █████  ─────  ─── ───── Gastos Op (-)                    │
│         █████  ─────  ─── ───── ───── Impuestos (-)              │
│         █████  ─────  ─── ───── ───── ─────  █████ Utilidad      │
│         █████  ─────  ─── ───── ───── ─────  █████ Neta          │
│   1.976B  -1.933B  -13B  -7.9B  -7.9B           9.1B             │
│                                                                  │
│  ──────────────────────────────────────────────────────────  •  │
│                                                              ⓟ  │
└─────────────────────────────────────────────────────────────────┘
```

- **Background:** `CREAM_50`.
- **Title:** `MixedWeightHeadline` h2 dark-on-light, "Composición del **Resultado Neto**" (sage-highlight on "Resultado Neto").
- **Chart:** `WaterfallPnL` component renders bars with `SAGE_500` for positives, `WINE_700` for negatives, `SAND_500` for totals. Each bar labeled below with `label` and `amount` (formatted with `formatCOP()`). X-axis: no line. Y-axis: light SAND_200 gridlines every 25% of total range. Bar widths: 60pt with 20pt gap.
- **Decorative:** small `TopoOrnament variant='contour' position='corner-bl' opacity=0.12 areaAccent='valor'`.
- **Data inputs:** `doc.waterfall.items: WaterfallItem[]`.
- **Page-wrap:** hard single page.
- **Mimics ref:** the bar-chart pages aren't in the reference, but the visual language (large title, sand/sage bars on cream, gold-rule footer) is consistent with p.20.

### 3.8 `DialGaugePage.tsx` — Multi-gauge dashboard

```
┌─────────────────────────────────────────────────────────────────┐
│  Indicadores ▓▓de salud financiera▓▓                            │
│                                                                  │
│      ╭───╮              ╭───╮              ╭───╮                 │
│     ╱     ╲            ╱     ╲            ╱     ╲                │
│    │  ◑    │          │   ◑   │          │   ◑   │               │
│     ╲     ╱            ╲     ╱            ╲     ╱                │
│      ╰───╯              ╰───╯              ╰───╯                 │
│      1,22                46,51%             13,93%               │
│   Razón Cte.            ROE                 Endeud.              │
│   ───────               ───────             ───────              │
│   Ideal: ≥1,5           Ideal: ≥20%         Ideal: <40%          │
│                                                                  │
│  ──────────────────────────────────────────────────────────  •  │
│                                                              ⓟ  │
└─────────────────────────────────────────────────────────────────┘
```

- **Background:** `CREAM_50`.
- **Layout:** up to 3 gauges per row, with up to 2 rows (max 6 gauges). Each gauge is Ø160pt diameter.
- **Gauge styling:** arc width 14pt, track color SAND_200, value-arc gradient: SAGE_500 (low zone) → SAND_500 (mid zone) → WINE_700 (high zone) keyed by `thresholds`. Numeral inside in Fraunces 32pt 700 FOREST_900.
- **Label below:** `gauge.label` in Geist 12pt 600 FOREST_900, then thin SAND_200 underline 50pt, then `gauge.caption` in Geist 9pt CHARCOAL_700 italic.
- **Decorative:** none (page is data-dense, let breathe).
- **Data inputs:** `doc.dialGauges.gauges: DialGaugeSpec[]`.
- **Page-wrap:** hard single page (cap 6 gauges).
- **Mimics ref:** p.80 (badge-row variant — our gauges are circular evolutions of those badges).

### 3.9 `OrbitalPillarsPage.tsx` — 4-pillar orbital diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  Cuatro pilares ▓▓de gestión integral▓▓                          │
│                                                                  │
│                  ◯ Escudo                                        │
│                  Defensa DIAN                                    │
│      ◯ Verdad                       ◯ Valor                      │
│      Rigor NIIF      ◯  87/100      Flagship EBITDA              │
│                       OVERALL                                    │
│                  ◯ Futuro                                        │
│                  Foresight                                       │
│                                                                  │
│  ──────────────────────────────────────────────────────────  •  │
│                                                              ⓟ  │
└─────────────────────────────────────────────────────────────────┘
```

- **Background:** `CREAM_50` or `FOREST_900` — page is OPTIONALLY rendered (when `doc.pillars` exists). On forest, the diagram pops more; on cream, it integrates with the rest of the report. **Default: FOREST_900.**
- **Center:** large circle Ø100pt with `pillars.overall` numeral in Fraunces 48pt 700 SAND_500 inside. Below it "OVERALL" eyebrow Geist 10pt 600 SAGE_300.
- **Satellites:** 4 satellite circles Ø80pt around the center at compass positions (N=Escudo, E=Valor, S=Futuro, W=Verdad — matches the AreaKey mapping). Each filled in its `areaAccent` color (FOREST_700 / SAND_500 / SAGE_500 / WINE_700). Score numeral inside (Fraunces 18pt 700 CREAM_0). Label above/below: name + topKpi.
- **Connectors:** thin SAND_300 0.5pt lines from center → each satellite.
- **Data inputs:** `doc.pillars: PillarsSpec`.
- **Page-wrap:** hard single page.

### 3.10 `NotesPage.tsx` — Auto-wrapping notes (1-N pages)

```
┌─────────────────────────────────────────────────────────────────┐
│  Notas a los ▓▓estados financieros▓▓                            │
│                                                                  │
│  Nota 1 — Reconocimiento de ingresos                             │
│  [NormativePill: "NIIF 15"]                                      │
│  Los ingresos se reconocen cuando … (body markdown)              │
│                                                                  │
│  Nota 2 — Provisión impuestos                                    │
│  [NormativePill: "NIC 12" "Art. 240 E.T."]                       │
│  El cálculo del impuesto corriente …                             │
│                                                                  │
│  ──────────────────────────────────────────────────────────  •  │
│                                                              ⓟ  │
└─────────────────────────────────────────────────────────────────┘
```

- **Background:** `CREAM_50`.
- **Title:** `MixedWeightHeadline` h2 dark-on-light, "Notas a los **estados financieros**".
- **Body:** for each `NoteBlock`, render:
  - **Heading:** Geist 13pt 700 FOREST_900, prefix with "Nota N — " where N is 1-indexed by block order.
  - **Pill row:** `block.citations` → `NormativePill` tone=`forest` size=`sm`.
  - **Body:** `MarkdownToPdf` rendering `block.bodyMarkdown` with `tone='dark-on-light'`.
  - **Spacer:** 24pt between notes.
- **Page-wrap:** **CRITICAL** — auto-wrap. Use React-PDF's `wrap` prop on the body `<View>`. Each note tries to keep its heading + first paragraph together (`break: false` if available, or use the `wrap` algorithm).
- **PageNumberBadge** renders correctly across wrapped pages because it uses the render-slot pageNumber.
- **Data inputs:** `doc.notes.blocks: NoteBlock[]`.
- **Mimics ref:** p.5 (presentation page — typography pattern for body).

### 3.11 `RecommendationsPage.tsx` — Pillar-tagged actionable list

```
┌─────────────────────────────────────────────────────────────────┐
│  Recomendaciones ▓▓ejecutivas▓▓                                  │
│                                                                  │
│  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓     │
│  ┃  [01]   [VALOR — gold pill]                            ┃     │
│  ┃  Aumentar EBITDA en 12% vía optimización tributaria    ┃     │
│  ┃  ──                                                     ┃     │
│  ┃  Body markdown with rationale + NIIF/tax citations.    ┃     │
│  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛     │
│                                                                  │
│  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓     │
│  ┃  [02]   [ESCUDO — wine pill]                           ┃     │
│  ┃  Fortalecer defensa DIAN (Art. 647 E.T.)               ┃     │
│  ┃  Body markdown.                                         ┃     │
│  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛     │
│                                                                  │
│  ──────────────────────────────────────────────────────────  •  │
│                                                              ⓟ  │
└─────────────────────────────────────────────────────────────────┘
```

- **Background:** `CREAM_50`.
- **Title:** `MixedWeightHeadline` h2 dark-on-light.
- **Recommendation cards:** each `RecommendationItem` rendered as a rounded card (R 14pt, border 1pt CHARCOAL_700 alpha 0.1, padding 24pt). Internally:
  - **Index pill (sand)** + **area pill (`areaAccent`)** in a flex row at top
  - **Title** Geist 14pt 700 FOREST_900
  - **Body** Markdown render tone=`dark-on-light`
- **Page-wrap:** cards wrap; never split a card across pages (use `wrap={false}` on each card).
- **Data inputs:** `doc.recommendations.items: RecommendationItem[]`.
- **Mimics ref:** p.18 value-prop card style, p.22 list of bullets — adapted for boxed cards.

### 3.12 `NormativeAppendix.tsx` — Adjustments + binding totals + warnings

```
┌─────────────────────────────────────────────────────────────────┐
│  Apéndice ▓▓normativo y de control▓▓                             │
│                                                                  │
│  Ajustes propuestos                                              │
│  ┌──────┬──────────────────────┬───────────┬─────────┐           │
│  │ Cta. │ Descripción          │  Ajuste   │  Norma  │           │
│  ├──────┼──────────────────────┼───────────┼─────────┤           │
│  │ 1355 │ Anticipos prov.      │  +2.4M    │ NIIF 9  │           │
│  │ 1120 │ Ahorros …            │  +180K    │ NIIF 7  │           │
│  └──────┴──────────────────────┴───────────┴─────────┘           │
│                                                                  │
│  Totales vinculantes (mono block) ────────────────────────       │
│  ▓  Activo total:           $66.089.422.044                       │
│  ▓  Pasivo total:           $46.486.807.993                       │
│  ▓  Patrimonio total:       $19.602.614.050                       │
│  ▓  Comprobación: A = P + Pat → ✓                                │
│                                                                  │
│  ──────────────────────────────────────────────────────────  •  │
│                                                              ⓟ  │
└─────────────────────────────────────────────────────────────────┘
```

- **Background:** `CREAM_50`.
- **Title:** `MixedWeightHeadline` h2 dark-on-light.
- **Adjustments table:** rendered with the same TableView as Statements, but compact. Norma column gets a `NormativePill tone='cream' size='sm'` instead of plain text.
- **Binding totals block:** `<View>` with `backgroundColor: SAND_300 alpha 0.25` (a soft sand band), padding 16pt, borderLeftWidth 3pt borderLeftColor SAND_500. Inside, `<Text>` per line using GeistMono 10pt FOREST_900. Lines come from `doc.appendix.bindingTotalsBlock` (already pre-formatted by the validator — it's a multi-line monospaced string).
- **Validation warnings:** if `doc.appendix.validationWarnings?.length`, render below in a bordered box (border-left 3pt WINE_700). Each warning as a bullet.
- **Page-wrap:** allow wrap (`<View wrap>`).
- **Data inputs:** `doc.appendix.{adjustmentsTable, validationWarnings, bindingTotalsBlock}`.
- **Mimics ref:** no direct equivalent in ESLOP; visual language inherits from p.6 + p.81.

### 3.13 `ClosingPage.tsx` — Forest credits/signatures page

```
┌─────────────────────────────────────────────────────────────────┐
│  ╭───╮                                                          │
│  │ ⚖ │                Créditos:                                 │ ← lightbulb icon disc (sage)
│  ╰───╯                                                          │   reference p.3
│                                                                  │
│  ╭─────────────────╮  Página web                                 │
│  │   topo-contour  │  www.utopia.tax                             │
│  │   right-edge    │                                             │
│  │   crescent      │  Equipo Auditor                             │
│  │                 │  Vanessa Espinal (Representante Legal)      │
│  │                 │  Andrés Pérez (Revisor Fiscal — TP 12345-T) │
│  │                 │  Equipo UtopIA (Contador Público)           │
│  │                 │                                             │
│  │                 │  Firmas                                     │
│  │                 │  {signatureBlock.rendered (multiline)}      │
│  │                 │                                             │
│  │                 │  Emisión: {generatedAt}                     │
│  ╰─────────────────╯                                             │
│                                                              ⓟ  │
└─────────────────────────────────────────────────────────────────┘
```

- **Background:** `CREAM_50` (right 60%) + `FOREST_900` (left 40% via overlay View).
- **Left panel (forest 40%):** filled with `TopoOrnament variant='contour' position='full-bleed' opacity=0.18 areaAccent='valor'`. A small sage-filled circle Ø60pt with the "scale of justice" icon glyph (or a simple ⚖ unicode if a real SVG isn't available — UtopIA stock icon).
- **Right panel (cream):** stacked sections:
  - **"Créditos:"** in Fraunces 32pt 700 FOREST_900.
  - **Página web** label (Geist 11pt 700) + URL (Geist 11pt CHARCOAL_700).
  - **Equipo Auditor** label + each signatory name (Geist 11pt 400 FOREST_900 with role in italic CHARCOAL_700).
  - **Firmas (multilinea):** `doc.signatureBlock.rendered` in `GeistMono 9pt CHARCOAL_900` — preserve whitespace via `<Text wrap>`. If `signatureBlock` is null, render 3 placeholder lines `"_________________________________"` with role label below each.
  - **Emisión:** Geist 9pt CHARCOAL_700 with timestamp.
  - **Emphasis paragraphs** (NIA 706): if `doc.emphasisParagraphs?.length`, render below "Firmas" as collapsible-feeling section. Each has heading (Geist 11pt 700) + body markdown.
- **PageNumberBadge** bottom-right.
- **Data inputs:** `doc.signatureBlock`, `doc.emphasisParagraphs`, `doc.meta.generatedAt`.
- **Mimics ref:** p.3 (Créditos page — exact pattern: topo-contour forest panel left, light right with stacked credits).

---

## 4. Translation rules — reference visual → UtopIA financial

| Reference visual | UtopIA equivalent |
|---|---|
| "GRI 2-22" / "GRI 201-1" eyebrow pill | `NormativePill` with NIIF/IAS/E.T. codes: "NIIF 1.10", "NIIF 7", "Art. 240 E.T.", "IAS 1.81", "NIA 705" |
| Cover hero "Informe de sostenibilidad 2024" | "Reporte NIIF Élite" or "Reporte NIIF — {Empresa} — Periodo {YYYY}" |
| Sub-hero "C.I. ESLOP S.A.S" (sand caps) | `{companyName}` in sand + NIT pill + period (already in CoverSpec) |
| "Desde el origen hacia el progreso" (cover p.2) | Subtle hero variant — render the `meta.watermarkSubtitle` if present, as a poetic line below the title |
| Section divider "SOCIAL 02" (p.83) | "Estados financieros 01" / "Análisis estratégico 02" / "Gobierno corporativo 03" — three bloques matching the existing section split |
| TEMA 1: GOBERNANZA … (TOC) | "BLOQUE 1: Estados Financieros" / "BLOQUE 2: Análisis Estratégico" / "BLOQUE 3: Gobierno Corporativo" — three top-level groupings in the TOC. The composer can derive these from the existing entries via a simple group-by based on the section dividers it inserts. |
| Mega-numbers "50 / 92 / 44%" (p.13-14) | `KPIGridPage` hero variant — when 1-3 KPIs, blow up the value typo to TYPE_HERO (120pt) |
| Valor Económico Generado GRI 201-1 (p.76) | `StatementsPages` — the "Estado de situación financiera" sub-page replicates this exact split |
| WACC bubble formula (p.79) | Future page — `WACCBubbleFormulaPage` (not in current pipeline). If a builder has time, add it as an optional page driven by a new `wacc?: WACCSpec` field. **Out of scope for this rebuild.** |
| KPI badge row (p.80) | `DialGaugePage` — circular gauges with thin SAND_200 connectors |
| Donut chart (p.25) | Future page — out of scope |
| Lightbulb icon disc (Créditos page p.3) | `ClosingPage` — render a simple ⚖ or 🛡 unicode glyph inside a sage circle (no custom SVG icons in V1; keep it simple) |
| Topographic contour blobs (everywhere) | `TopoOrnament variant='contour'` — the workhorse |

---

## 5. Out of scope

These are explicitly NOT in this rebuild. Builders should NOT attempt them — the scope is already large.

- **Stock photography** (reference uses photos of miners, the gold-panning woman, the boardroom — we cannot ship those for arbitrary clients). All photo regions become topo-contour ornaments or sage-tinted color blocks.
- **The WACC bubble-formula page (p.79).** Beautiful but the formula data isn't in our IR. Add later via a new `wacc?: WACCSpec` field on `EditorialReport`.
- **The donut/pie chart page (p.25).** Same reason — no donut data in IR.
- **The world-export map (p.11).** No geographic data in IR.
- **The business-model wheel (p.15).** Same.
- **Multi-language font fallback.** We render Spanish primarily; English uses the same Geist/Fraunces stack and works fine.
- **Custom SVG icons** (the lightbulb, the cog, the truck, the magnifier). Use unicode glyphs (⚖, 📑, 🛡) as placeholders. A separate icon-pack PR is the right way to handle real icons.
- **Pagination footer numbers across multi-page sections** (NotesPage, long Balance). The current PaginationFooter uses React-PDF's render slot which works correctly per page — but the *section label* it shows on each wrapped page may go stale. Acceptable for V1; track-down in V2.

---

## 6. Builder task checklist

Pull tasks from here. Each Sonnet team owns one bucket; tasks within a bucket may run sequentially in one team's worktree (no parallelism inside a bucket — keeps diffs small).

### Team A — Primitives (1 worktree, sequential)

- [ ] **A1** — Rewrite `primitives/TopoOrnament.tsx` to support `variant: 'contour' | 'half-disc' | 'ring'` and the `position` prop. Keep backwards-compat: old `variant='ribbons'` is aliased to `'contour'`; old `variant='hex'` / `'lines'` are kept as separate variants and not deprecated (they still work, just unused). Add seeded Bézier-loop contour generator.
- [ ] **A2** — Create `primitives/PageNumberBadge.tsx`. Export from `primitives/index.ts`.
- [ ] **A3** — Create `primitives/NormativePill.tsx`. Export from `primitives/index.ts`.
- [ ] **A4** — Create `primitives/MixedWeightHeadline.tsx`. Export from `primitives/index.ts`.
- [ ] **A5** — Create `primitives/NumberedSectionHeader.tsx`. Export from `primitives/index.ts`.
- [ ] **A6** — Create `primitives/GoldRule.tsx`. Export from `primitives/index.ts`.
- [ ] **A7** — Refactor `primitives/EditorialTitle.tsx` to internally delegate to `MixedWeightHeadline`. Keep the existing props interface exactly — this is a no-op for callers.
- [ ] **A8** — Refactor `primitives/AvatarInitials.tsx` to use the new sand/sage ring style (see §2.9).
- [ ] **A9** — Ensure `primitives/AuthorityChip.tsx` and `primitives/PaginationFooter.tsx` still compile (do NOT delete — partial migration safety net). Mark with `@deprecated` JSDoc.
- [ ] **A10** — `npx tsc --noEmit` clean.

### Team B — Opener + Closing (1 worktree, sequential)

- [ ] **B1** — Rebuild `pages/CoverPage.tsx` against §3.1. Use new tokens. Landscape.
- [ ] **B2** — Rebuild `pages/DirectorLetter.tsx` against §3.2.
- [ ] **B3** — Rebuild `pages/TocPage.tsx` against §3.3.
- [ ] **B4** — Rebuild `pages/SectionDivider.tsx` against §3.4. Add optional `sectionIndex?: string` prop; default derived from `areaAccent`.
- [ ] **B5** — Update `EditorialReportDoc.tsx` to pass `sectionIndex` to each `<SectionDivider>` it renders.
- [ ] **B6** — Rebuild `pages/ClosingPage.tsx` against §3.13.
- [ ] **B7** — `npx tsc --noEmit` clean.

### Team C — Financial pages (1 worktree, sequential — the longest bucket)

- [ ] **C1** — Rebuild `pages/StatementsPages.tsx` against §3.6. This is the most critical page. Add the split cream/forest layout. Hardcode per-statement captions + normative pills.
- [ ] **C2** — Optional: implement the SVG bracket connectors in the right forest panel (§3.6). If time-boxed, skip on first pass.
- [ ] **C3** — Rebuild `pages/KPIGridPage.tsx` against §3.5.
- [ ] **C4** — Rebuild `pages/WaterfallPnLPage.tsx` against §3.7. Update `charts/WaterfallPnL.tsx` to use new tokens (SAGE_500 positives, WINE_700 negatives, SAND_500 totals).
- [ ] **C5** — Rebuild `pages/DialGaugePage.tsx` against §3.8. Update `charts/DialGauge.tsx` to use new tokens.
- [ ] **C6** — Rebuild `pages/NormativeAppendix.tsx` against §3.12.
- [ ] **C7** — `npx tsc --noEmit` clean.

### Team D — Narrative pages (1 worktree, sequential)

- [ ] **D1** — Rebuild `pages/NotesPage.tsx` against §3.10. Make sure `wrap` propagates correctly across long notes.
- [ ] **D2** — Rebuild `pages/RecommendationsPage.tsx` against §3.11.
- [ ] **D3** — Rebuild `pages/OrbitalPillarsPage.tsx` against §3.9. Update `charts/OrbitalPillars.tsx` to use new tokens.
- [ ] **D4** — `npx tsc --noEmit` clean.

### Final integration

- After all 4 teams land:
  - [ ] **Z1** — Smoke-test: render the fixture in `__fixtures__/` and visually verify each page in a PDF viewer.
  - [ ] **Z2** — Delete `primitives/AuthorityChip.tsx` and `primitives/PaginationFooter.tsx`. Remove their exports from `primitives/index.ts`.
  - [ ] **Z3** — Run the existing snapshot tests in `__tests__/` and update them (they will all break — visual snapshots).
  - [ ] **Z4** — `npm run build` clean.

---

## 7. Anti-pattern checklist (what builders MUST NOT do)

- Do NOT change `types.ts` or `compose.ts`. IR shape is frozen.
- Do NOT add new dependencies. Everything is React-PDF + existing fonts.
- Do NOT use `text-` Tailwind classes — this is `@react-pdf/renderer`, not the web app. All styling is inline `style={{ … }}` with constants from `tokens.ts`.
- Do NOT hardcode hex values inside page components. Import from `tokens.ts`.
- Do NOT forget `orientation="landscape"` on every `<Page>`.
- Do NOT use stock photographs (we don't have rights and clients vary).
- Do NOT inline the gold-rule + page-number footer — use `<GoldRule />` + `<PageNumberBadge />`.
- Do NOT delete `AuthorityChip` / `PaginationFooter` during the build — only after Z2 final integration.
- Do NOT change `models.ts` or any AI SDK setup. PDF rendering has zero LLM dependency.

---

## 8. References

- **CI ESLOP 2024 Sustainability Report** — primary reference, `Documentos de orientacion/Informe_Sostenibilidad_CI_ESLOP_2024.pdf`.
- **2026 editorial design trends** — eucalyptus green + clay + sand are dominant per LinkedIn's Design Insights 2026 and It's Nice That's Q1 2026 trend report. Bold mixed-weight typography + topographic ornament + circular badges align with corporate-editorial 2026 direction.
- **React-PDF docs** — `@react-pdf/renderer` v6+, supports `orientation`, `<Page>`, `<View>`, `<Text>`, `<Svg>`, `<Path>`, `<Link>`, `<Image>`. No CSS-in-JS, no Tailwind.
- **Typography references** — Fraunces (Google Fonts, by Undercase Type) for display; Geist (Vercel) for sans + mono.
- **UtopIA architecture** — see `CLAUDE.md` for the broader codebase context; this spec only touches `src/lib/export/pdf-elite-react/`.
