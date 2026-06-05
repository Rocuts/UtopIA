# Identidad verde de Contabilidad Pyme — "Cuarto verde" (`area-pyme`)

- **Fecha:** 2026-06-05
- **Estado:** aprobado (brainstorming) → implementación a `main`
- **Autor:** Johan + Claude (Opus)
- **Relacionado:** [[project-pyme-cockpit-don-carlos]], `feedback_token_polarity_rule`, CLAUDE.md §"Visual token polarity"

## Objetivo

Darle a **Contabilidad Pyme** una identidad cromática **verde** propia, distinta del oro/vino
de las áreas "élite". El color funciona como **señalética de pertenencia**: cuando un tendero
(usuario tipo "Don Carlos") entra al módulo, debe *saber por la colorimetría* que llegó a su
lugar — mientras que el resto de la app (oro champagne, vino bordeaux) está pensado para
contadores / CFO. Color como segmentación de usuario.

## Decisión de diseño

Nivel **B — "Cuarto verde"** (de 3 niveles evaluados: A solo-acento, B cuarto-verde, C reskin total):
el verde se *siente* como ambiente, no es solo un acento tímido, pero las **superficies siguen en
tokens `n-*`** para no romper dark mode ni el acabado premium.

### Por qué NO se hardcodean los hex del mock original

El mock de referencia usaba `#f0f7ea` / `#1a2e0d` / `#4DA820` fijos. Clavarlos rompería dark
mode y violaría la regla de polaridad de tokens (CLAUDE.md). En su lugar se introduce un **token
de acento de área** con valor claro + valor oscuro, idéntico a como ya existen
`area-verdad` / `area-valor` / `area-futuro` / `area-escudo`.

## Arquitectura

### 1. Token nuevo `area-pyme` (`src/app/globals.css`)

Espejo exacto del patrón `area-escudo` + `glow-gold`:

| Token | Claro | Oscuro |
|---|---|---|
| `--color-area-pyme` | `#357A28` (verde dinero, AA-safe como texto) | `#7BC95B` (verde luminoso para fondo oscuro) |
| `--shadow-glow-pyme` / `-soft` | `rgb(53 122 40 / .26)` / `.16` | `rgb(123 201 91 / .30)` / `.22` |
| `--area-pyme-glow` (alias `:root`) | `rgb(53 122 40 / .18)` | `rgb(123 201 91 / .22)` |

El verde claro se eligió **suficientemente profundo para cumplir WCAG AA (≥4.5:1) como texto
pequeño** sobre `n-0`, igual que `area-escudo` es text-safe. Genera utilidades Tailwind v4
`text-area-pyme` / `bg-area-pyme` / `border-area-pyme` (+ alpha) y `shadow-glow-pyme[-soft]`,
todas dark-aware.

### 2. Extensión aditiva de 2 componentes compartidos

- `SectionHeader` — `accent: 'gold' | 'wine'` → **+ `'pyme'`** (entrada en `ACCENT_TEXT` y
  `DIVIDER_GRADIENT`). Consumidores gold/wine intactos.
- `PremiumKpiCard` — `KpiAccent` → **+ `'pyme'`** (glow `shadow-glow-pyme`, chip de ícono
  `bg-area-pyme/12 text-area-pyme`, y **el número héroe en verde** sólo cuando `accent==='pyme'
  && variant==='hero'`). Sin efecto en gold/wine.

### 3. Aplicación del "cuarto verde"

- **`PymeCockpit.tsx`**: lavado verde ambiental arriba (gradiente `from-area-pyme/[~0.09]` →
  transparente, decorativo, dark-safe) detrás de header + KPI héroe; `SectionHeader accent="pyme"`;
  KPI héroe + 4 KPIs `accent="pyme"`; píldora de régimen, callout de Consejo → verde.
- **`PymeAccessTile.tsx`**: chip de ícono, borde, hover y focus-ring de oro → `area-pyme`.
- **`ExecutiveDashboard.tsx`**: la tarjeta "Contabilidad Pyme" del Centro de Comando pasa de
  vino (`area-escudo`) → `area-pyme`, para que el tendero vea verde **desde antes de entrar**.

## Qué NO cambia (invariantes)

- Superficies en `n-*` (dark mode invierte correcto; nada de fondos verdes fijos).
- **Texto pequeño de lectura** queda neutro (`n-700/1000`); el verde se reserva para acentos,
  íconos, bordes, lavado y el número héroe (grande).
- `PymeDeadlinesCard` conserva su semántica ámbar (warning) — los vencimientos son urgencia,
  no identidad de marca.
- Bordes glass (`border-elite-gold`) de las cards se conservan (parte del lenguaje glass; el
  verde lo aportan acento + lavado + íconos + héroe + tiles).
- Libros reales (`/workspace/pyme/libros`), backend pyme, layout/container-queries y los otros
  3 módulos: intactos. `area-pyme` sólo lo consumen el cockpit + la tarjeta del Comando → blast
  radius cero.

## Validación

- `utopia-contrast-auditor` sobre los combos verde-sobre-superficie en **claro y oscuro**
  (ratios medidos, todos ≥ AA: texto ≥4.5:1, gráfico/grande ≥3:1).
- `npx tsc --noEmit` + `npm run build` verdes.
- Revisión adversarial: cero hex hardcodeado, cero oro residual donde toca verde, extensiones
  puramente aditivas.

## Notas de afinación

El verde exacto es un cambio de 1 línea en `--color-area-pyme` (claro/oscuro). Si tras verlo en
pantalla se quiere más vivo, se puede subir saturación para usos de relleno (chips/bordes/héroe,
que sólo requieren 3:1), manteniendo un tono text-safe si se usa en texto pequeño.
