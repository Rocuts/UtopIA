import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/*
 * Doble inversión de polaridad: `dark:` sobre la escala n-*.
 *
 * `@custom-variant dark` (globals.css:13) dispara con EXACTAMENTE el mismo
 * selector con el que globals.css:285-301 invierte los `--color-n-*`. O sea que
 * la escala YA se invierte sola por tema y una variante `dark:` encima invierte
 * por segunda vez, devolviendo el token a su valor de modo claro.
 *
 * El fallo es silencioso: compila, pasa el type-check y "se lee bien" en el
 * diff. Sólo se ve cambiando de tema, que es justo lo que nadie hace revisando
 * un PR. Casos reales que esto atrapa:
 *   - `dark:prose-strong:text-n-100` sobre GlassModal → 1.00:1, MISMO hex.
 *   - `bg-n-50 dark:bg-n-900` + `text-n-700` → 1.56:1, botón invisible.
 *   - `bg-n-0 dark:bg-n-900` → tarjeta CREMA dentro de un panel oscuro.
 *
 * La regla correcta es no escribir `dark:` nunca sobre n-*: se elige el token
 * por ROL (tinta primaria n-1000, secundaria n-700/800) y el tema hace el resto.
 * Hay un guard equivalente en vitest
 * (src/components/workspace/__tests__/ui-token-polarity-guard.test.ts) que
 * además cubre la tinta prohibida n-100..n-400 y los peldaños inexistentes.
 *
 * src/modules/** queda fuera por el globalIgnores de abajo: usa su propia
 * paleta inline en hex, no la escala adaptativa.
 */
// `ring-offset` va ANTES de `ring` sólo por legibilidad: la alternancia
// retrocede igual, pero sin el prefijo largo listado la regla no veria
// `dark:ring-offset-n-900` (probado: "ring" casa y luego exige "-n-", que no
// llega). Era el unico hueco entre esta regla y el guard de vitest.
const UTILIDADES_N =
  "(text|bg|border|divide|ring-offset|ring|from|to|via|placeholder|fill|stroke|accent|decoration|outline|shadow)";
const DARK_SOBRE_TOKEN_N = String.raw`dark:([a-z-]+:)*${UTILIDADES_N}-n-\d`;

const MENSAJE_POLARIDAD =
  "Doble inversion de polaridad: la escala n-* ya se invierte sola en [data-theme=dark] " +
  "(globals.css:285), asi que una variante dark: encima la devuelve al valor de modo claro " +
  "(p.ej. dark:text-n-200 renderiza #27231D sobre fondo #0A0907 = 1.3:1). " +
  "Borra la variante dark: y elige el token por ROL: tinta primaria text-n-1000, " +
  "secundaria text-n-700/800, terciaria text-n-500/600.";

const REGLA_POLARIDAD = {
  "no-restricted-syntax": [
    "error",
    {
      selector: `Literal[value=/${DARK_SOBRE_TOKEN_N}/]`,
      message: MENSAJE_POLARIDAD,
    },
    {
      selector: `TemplateElement[value.raw=/${DARK_SOBRE_TOKEN_N}/]`,
      message: MENSAJE_POLARIDAD,
    },
  ],
};

/*
 * CUARENTENA, no excepcion permanente. Son los archivos que ya arrastraban la
 * doble inversion cuando se conecto esta regla y que pertenecen a otra frontera
 * de trabajo. La lista sólo puede ENCOGER: el guard de vitest verifica que sea
 * exacta, así que limpiar un archivo obliga a borrarlo de aquí y ensuciar uno
 * nuevo rompe CI aunque no este listado.
 */
const CUARENTENA_DOBLE_INVERSION = [
  "src/app/workspace/contabilidad/cuentas/page.tsx",
  "src/app/workspace/verdad/dictamenes/page.tsx",
  "src/components/workspace/AreaCard.tsx",
  "src/components/workspace/areas/SurvivalModePanel.tsx",
  "src/components/workspace/cards/AntiDianCard.tsx",
  "src/components/workspace/cards/ContingencyReserveCard.tsx",
  "src/components/workspace/cards/DividendOptimizerCard.tsx",
  "src/components/workspace/cards/FiscalAnchorCard.tsx",
  "src/components/workspace/cards/RetentionShieldCard.tsx",
  "src/components/workspace/cards/SurvivalCard.tsx",
  "src/components/workspace/cards/SynthesisHeaderCard.tsx",
  "src/components/workspace/cards/TetCard.tsx",
  "src/components/workspace/repair/RepairChat.tsx",
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Node.js CJS utility scripts — not part of the Next.js build
    "scripts/convert-pdfs.js",
    // Agent git worktrees (git-ignored, multi-GB) — not source; linting them
    // floods the report with thousands of stale-checkout findings.
    ".claude/worktrees/**",
    // Self-contained mobile module with its own inline-hex palette and
    // module-scoped fonts (NOT the n-* token system) — out of lint scope.
    "src/modules/**",
  ]),
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: REGLA_POLARIDAD,
  },
  {
    // El guard lleva ejemplos del bug como literales de prueba: si la regla los
    // marcara, no se podria probar que el detector detecta.
    files: ["src/components/workspace/__tests__/ui-token-polarity-guard.test.ts"],
    rules: { "no-restricted-syntax": "off" },
  },
  {
    files: CUARENTENA_DOBLE_INVERSION,
    rules: { "no-restricted-syntax": "off" },
  },
]);

export default eslintConfig;
