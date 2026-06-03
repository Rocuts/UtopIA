# Pyme desktop redesign — design spec

- **Date:** 2026-06-03
- **Status:** Approved (build started)
- **Scope:** `/workspace/pyme` module ONLY. No app-wide responsive refactor.

## Problem

The just-built `/workspace/pyme` cockpit is a 390px "phone" mock embedded in a desktop app
(`PymeCockpit.tsx`), with emoji-as-icons, an off-brand warm-green scoped theme that ignores dark
mode, Nunito/DM_Mono fonts, a bottom tab bar, and persona kitsch ("Don Carlos 👋"). It reads as an
"AI template" and clashes with the app's real desktop design language. (Full evidence: recon team
briefs — design-language, responsive, teardown, 2026 best-practices.)

## Goal

Rebuild `/workspace/pyme` as a **desktop owner command-center** that is native to the app's design
language, responsive within the module, dark-mode aware, and professional-warm in tone — at
top-tier 2026 quality (no emoji, no phone frame, no second accent color).

## Non-goals (explicitly out of scope)

- No app-wide responsive system (no `@theme` fluid-type/clamp, no global container queries, no
  shared `PageContainer`, no header/sidebar/areas/intake/cards/tables/accounting changes).
- No real-data wiring — stays on MOCK fixtures (`/api/pyme/*` wiring is a later batch).
- No changes outside `src/components/workspace/pyme/**`, its route, and local cleanup in
  `globals.css` + `layout.tsx`.

## Design

### Identity & tone
- Surface = **owner executive cockpit**, sits above the professional `/workspace/contabilidad`.
- Accent = **gold** (the app's value/money accent). No new green. No persona kitsch.
- Tone = professional-warm (clear, non-jargon owner language), bilingual ES/EN.

### Visual language (native to the app)
- Frame mirrors the sibling landing `ContabilidadLanding` idiom: centered container,
  `px-4 sm:px-6 lg:px-10`, on `bg-n-0`, content header via **`SectionHeader`** (eyebrow → Fraunces
  H1 → subtitle → gold divider).
- Cards via **`Card` (glass-elite)** + **`PremiumKpiCard`** for KPIs.
- **lucide-react** icons only (stroke 1.6–1.75 in tinted gold chips). Zero emoji.
- Tokens `--n-*` (dark-mode aware): primary `text-n-1000`, secondary `text-n-700/800`, eyebrow
  `text-n-500/600`. Numbers in Geist Mono `.num`; one Fraunces hero number max.
- Entrance stagger + `useReducedMotion`, matching the areas.

### Layout (command-center)
1. **Header**: `SectionHeader` — eyebrow "Contabilidad Pyme · {negocio}", H1 "Tu resumen de
   {mes}", subtitle "Panel del propietario · {régimen chip}".
2. **KPI hero row**: north-star "Ganancia del mes" (Fraunces hero, gold, + trend + sparkline) as a
   `glass-elite-elevated` primary card, beside secondary KPIs (Ventas, Compras, Margen, IVA acum.)
   as `PremiumKpiCard`. Grid `grid-cols-1 md:grid-cols-2 xl:grid-cols-4` (hero spans 2).
3. **Vencimientos** card (semantic warning/wine, lucide `CalendarClock`/`AlertTriangle`) — the 2
   urgent items.
4. **Accesos** grid — 6 `glass-elite` cards with lucide icons in gold chips + status-pill badges.
   "Mis libros" → real `/workspace/pyme/libros`; not-yet-built → "Próximamente" status pill (no
   fake navigation, no bottom nav).
5. **Consejo** card (lucide `Lightbulb`).

### Responsive (module-scoped, using the app's existing ladder)
- Standard Tailwind breakpoints like the areas: `grid-cols-1 md:grid-cols-2 xl:grid-cols-4`,
  `px-4 sm:px-6 lg:px-10`. Works desktop → tablet → mobile. No new global system.

### Navigation
- Drop `BottomNav`. Navigation uses the existing shell (sidebar/header) + on-page cards.
- `/workspace/pyme` becomes a single command-center landing (no internal screen-switching island).

### Salvage (keep)
- `hooks/useGreeting`, `hooks/useOfflineStatus` (SSR-safe; drop emoji at call site).
- `types.ts` (change `PymeModule.icon` from emoji string → lucide component ref).
- `mockData.ts` (de-emoji; rewrite folksy copy).
- `context/RegimeContext.tsx` (régimen chip).
- i18n keys `t.pyme.cockpit.*` (rewrite copy; keep ES/EN parity).
- Preserved books route `/workspace/pyme/libros` (`PymeBooksClassic`).

### Cleanup (delete)
- `.pyme-cockpit` theme block + custom scroll classes in `globals.css`.
- `--font-pyme` / `--font-pyme-mono` from `@theme`; Nunito + DM_Mono imports/vars from `layout.tsx`.
- `BottomNav.tsx`, `ComingSoon.tsx`, the 6 emoji screens, the cockpit-themed
  `MetricCard/AlertCard/SectionLabel`, and the 390px phone-frame shell.

## File plan (all under `src/components/workspace/pyme/**` + local cleanup)
- Rebuild `cockpit/PymeCommandCenter.tsx` (replaces `PymeCockpit.tsx`).
- New native sub-components as needed (KPI tiles via `PremiumKpiCard`, access card, alert card).
- `PymeLanding.tsx` re-exports the new command-center.
- Edit `types.ts`, `mockData.ts`, dictionaries (copy), `globals.css`, `layout.tsx`.

## Verification
- `tsc --noEmit`, `eslint`, `npm run build` green.
- Opus audit team: design fidelity vs app, responsive at 360/768/1024/1440px, WCAG 2.2 AA
  (targets ≥24px, focus not obscured), dark mode, no emoji/leftover cockpit theme.
- Live Playwright snapshot at desktop + mobile widths, light + dark.
