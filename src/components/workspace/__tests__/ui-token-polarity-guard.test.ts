import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join, relative, sep } from 'node:path';

/**
 * Guardas de polaridad de tokens (regla dura de CLAUDE.md).
 *
 * La escala n-0..n-1000 se INVIERTE en [data-theme="dark"] (globals.css:285-301)
 * y el `@custom-variant dark` (globals.css:13) dispara con EXACTAMENTE el mismo
 * selector. Por eso:
 *
 *  1. Una variante `dark:` sobre un token n-* invierte dos veces:
 *     `text-n-800 dark:text-n-200` renderiza en oscuro n-200 = #27231D sobre
 *     fondo #0A0907 → 1.3:1 (texto invisible), y `bg-white dark:bg-n-900`
 *     pinta una tarjeta CREMA (#EFE8D3) dentro de un panel oscuro.
 *  2. n-100..n-400 nunca alcanzan 4.5:1 como tinta en NINGUNO de los dos modos
 *     (n-400 claro #B3AA95 sobre #FCFBF8 = 2.2:1; n-400 oscuro #5A5246 sobre
 *     #0A0907 = 2.6:1), así que están prohibidos como texto legible.
 *
 * MODO DE FALLO QUE ESTE GUARD EXISTE PARA ATAJAR: el bug es invisible en
 * revisión de código (la clase "se lee bien") y sólo aparece al cambiar de tema,
 * que es justo lo que nadie hace al revisar un PR. Por eso se verifica en CI y
 * no a ojo.
 *
 * HISTORIA: este guard ya existía con la regex correcta pero su lista de
 * archivos cubría 4 de 38 — el patrón "gate existente pero DESCONECTADO" de la
 * auditoría 2026-08. Ahora camina TODO src/ para que ningún archivo nuevo
 * pueda introducir la doble inversión sin romper CI.
 *
 * Excluido a propósito: src/modules/pyme/** usa su propia paleta inline en hex
 * (decisión de diseño documentada), así que la escala n-* no aplica allí.
 */

const REPO = resolve(__dirname, '../../../..');
const SRC = resolve(REPO, 'src');

/** Rutas (prefijo relativo a src/) fuera del alcance de la escala adaptativa. */
const EXCLUIDOS = [
  'modules/pyme', // paleta propia inline-hex por diseño
];

/**
 * Deuda conocida FUERA de la frontera del equipo que endureció este guard.
 * Es una CUARENTENA, no una excepción permanente: el test de más abajo exige
 * que la lista sea EXACTA (ni entradas de más ni de menos), de modo que
 *   - arreglar un archivo obliga a borrarlo de aquí, y
 *   - ensuciar un archivo nuevo rompe CI aunque no esté listado.
 * Sólo puede encoger.
 */
const CUARENTENA_DOBLE_INVERSION = [
  'src/app/workspace/contabilidad/cuentas/page.tsx',
  'src/app/workspace/verdad/dictamenes/page.tsx',
  'src/components/workspace/AreaCard.tsx',
  'src/components/workspace/areas/SurvivalModePanel.tsx',
  'src/components/workspace/cards/AntiDianCard.tsx',
  'src/components/workspace/cards/ContingencyReserveCard.tsx',
  'src/components/workspace/cards/DividendOptimizerCard.tsx',
  'src/components/workspace/cards/FiscalAnchorCard.tsx',
  'src/components/workspace/cards/RetentionShieldCard.tsx',
  'src/components/workspace/cards/SurvivalCard.tsx',
  'src/components/workspace/cards/SynthesisHeaderCard.tsx',
  'src/components/workspace/cards/TetCard.tsx',
  'src/components/workspace/repair/RepairChat.tsx',
];

/**
 * Archivos con auditoría de contraste WCAG hecha a mano (frontera del Equipo A
 * + los 4 originales). Sobre estos se exige además tinta legible y polaridad de
 * hover. El resto de src/ arrastra deuda previa de `text-n-400` que no se puede
 * tocar sin auditar caso por caso, así que se cubre sólo la doble inversión.
 */
const AUDITADOS_CONTRASTE = [
  'src/app/workspace/escudo/agente-fiscal/page.tsx',
  'src/components/workspace/intake/NiifReportIntake.tsx',
  'src/components/workspace/AnalysisPanel.tsx',
  'src/components/workspace/ERPConnector.tsx',
  'src/components/workspace/contabilidad/BankAccountForm.tsx',
  'src/components/workspace/ReportFollowUpChat.tsx',
  'src/components/ui/Button.tsx',
];

/**
 * Deuda conocida FUERA de la frontera para `ring-offset` con peldaño de TINTA.
 * Misma disciplina que la cuarentena de arriba: sólo puede encoger.
 */
const CUARENTENA_RING_OFFSET_TINTA = [
  'src/app/workspace/valor/page.tsx',
  'src/components/ui/Card.tsx',
  'src/components/ui/PremiumKpiCard.tsx',
  'src/components/workspace/NiifEliteButton.tsx',
];

/** Variante dark: aplicada a un token adaptativo n-<n>. */
const DARK_SOBRE_TOKEN_N =
  /\bdark:(?:[a-z-]+:)*(?:text|bg|border|divide|ring-offset|ring|from|to|via|placeholder|fill|stroke|accent|decoration|outline|shadow)-n-\d/g;

/**
 * `ring-offset` pinta la BANDA entre el elemento y el anillo de foco, así que su
 * color debe seguir a la SUPERFICIE sobre la que se dibuja (regla 4 de
 * CLAUDE.md), no a la tinta. Un peldaño de tinta (n-600..n-1000) convierte el
 * offset en un halo máximamente contrastado: `ring-offset-n-1000` sobre una
 * página `bg-n-0` dibuja un marco casi negro (#0C0A06 vs #FCFBF8, 19:1)
 * alrededor de cada control enfocado por teclado — y en oscuro el mismo token
 * lo pinta CREMA. El fallo sólo aparece navegando con Tab, que es justo lo que
 * nadie hace revisando un PR, y por eso se atrapa aquí y no a ojo.
 */
const RING_OFFSET_TINTA = /\bring-offset-n-(?:600|700|800|900|1000)\b/g;

/**
 * Tinta prohibida. `text-n-100..400` como color de texto. No aplica a
 * placeholder:text-n-400 (placeholders sí pueden ser tenues) ni a border/bg.
 */
const TINTA_PROHIBIDA =
  /(?<!placeholder:)(?<![a-z-])(?:hover:|focus:|group-hover:|disabled:)?text-n-(?:100|200|300|400)\b/g;

/**
 * Peldaños que la escala n-* realmente define en globals.css. Cualquier otro
 * (p.ej. `n-950`) compila a NADA: Tailwind no genera la utilidad y el elemento
 * se queda con el fondo heredado. Es un fallo silencioso, no un error de build.
 */
const PELDANOS_VALIDOS = new Set([0, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
const CUALQUIER_TOKEN_N =
  /\b(?:text|bg|border|divide|ring|ring-offset|from|to|via|placeholder|fill|stroke|accent|decoration|outline|shadow)-n-(\d{1,4})\b/g;

function sinComentarios(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function violaciones(src: string, patron: RegExp): string[] {
  return sinComentarios(src).match(patron) ?? [];
}

/** Recorre src/ y devuelve rutas relativas al repo, con `/` siempre. */
function archivosFuente(dir: string, acc: string[] = []): string[] {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, ent.name);
    const rel = relative(REPO, abs).split(sep).join('/');
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
      if (EXCLUIDOS.some((p) => rel === `src/${p}` || rel.startsWith(`src/${p}/`))) continue;
      archivosFuente(abs, acc);
    } else if (/\.tsx?$/.test(ent.name)) {
      acc.push(rel);
    }
  }
  return acc;
}

// Este mismo archivo lleva ejemplos del bug en literales de prueba.
const ESTE_ARCHIVO = relative(REPO, __filename).split(sep).join('/');
const TODO_SRC = archivosFuente(SRC).filter((f) => f !== ESTE_ARCHIVO);

function leer(rel: string): string {
  return readFileSync(resolve(REPO, rel), 'utf8');
}

// Extracto REAL del código anterior al fix (agente-fiscal/page.tsx:35/102/148 y
// NiifReportIntake.tsx:244/735). Sirve de prueba del detector: si alguien
// debilita las regex para "hacer pasar" el guard, estos casos dejan de saltar.
const CODIGO_PREVIO_AL_FIX = `
  <div className="min-h-screen bg-n-50 dark:bg-n-950 text-n-1000 dark:text-n-1000">
  className="text-n-500 hover:text-n-800 dark:hover:text-n-200 transition-colors"
  className="rounded-xl border border-n-200 dark:border-n-800 bg-white dark:bg-n-900 p-4"
  <div className="text-sm font-medium text-n-900 dark:text-n-100 truncate">{d.title}</div>
  <span className={values.company.sector ? 'text-n-900' : 'text-n-400'}>
  reached ? 'text-success' : active ? 'text-gold-500' : 'text-n-400',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-n-1000',
`;

describe('polaridad de tokens n-*', () => {
  it('el detector marca el código previo al fix (prueba del guard)', () => {
    expect(violaciones(CODIGO_PREVIO_AL_FIX, DARK_SOBRE_TOKEN_N).length).toBeGreaterThan(0);
    expect(violaciones(CODIGO_PREVIO_AL_FIX, TINTA_PROHIBIDA).length).toBeGreaterThan(0);
    expect(violaciones(CODIGO_PREVIO_AL_FIX, RING_OFFSET_TINTA).length).toBeGreaterThan(0);
  });

  it('el guard camina src/ entero, no una lista corta', () => {
    // Contra la regresión que hizo inútil a este guard: cubría 4 de 38 archivos.
    expect(TODO_SRC.length).toBeGreaterThan(300);
    expect(TODO_SRC).toContain('src/components/workspace/escudo/FiscalAlertsPanel.tsx');
    expect(TODO_SRC.filter((f) => f.startsWith('src/modules/pyme/'))).toEqual([]);
  });

  it('ningún archivo de src/ usa variantes dark: sobre tokens n-* adaptativos', () => {
    const sucios = TODO_SRC.filter((rel) => violaciones(leer(rel), DARK_SOBRE_TOKEN_N).length > 0);
    expect(sucios.filter((f) => !CUARENTENA_DOBLE_INVERSION.includes(f))).toEqual([]);
  });

  it('la cuarentena es exacta: sólo puede encoger', () => {
    // Si un archivo en cuarentena se limpia, hay que borrarlo de la lista. Si no
    // se exigiera esto, la lista se volvería una excepción permanente — que es
    // exactamente cómo este guard se murió la primera vez.
    const sucios = TODO_SRC.filter((rel) => violaciones(leer(rel), DARK_SOBRE_TOKEN_N).length > 0);
    const yaLimpios = CUARENTENA_DOBLE_INVERSION.filter((f) => !sucios.includes(f));
    expect(yaLimpios, 'archivos en cuarentena ya limpios: bórralos de la lista').toEqual([]);
  });

  it('ningún archivo de src/ usa un peldaño de TINTA como ring-offset', () => {
    const sucios = TODO_SRC.filter((rel) => violaciones(leer(rel), RING_OFFSET_TINTA).length > 0);
    expect(sucios.filter((f) => !CUARENTENA_RING_OFFSET_TINTA.includes(f))).toEqual([]);
  });

  it('la cuarentena de ring-offset es exacta: sólo puede encoger', () => {
    const sucios = TODO_SRC.filter((rel) => violaciones(leer(rel), RING_OFFSET_TINTA).length > 0);
    const yaLimpios = CUARENTENA_RING_OFFSET_TINTA.filter((f) => !sucios.includes(f));
    expect(yaLimpios, 'archivos en cuarentena ya limpios: bórralos de la lista').toEqual([]);
  });

  it('ningún archivo de src/ usa un peldaño n-* inexistente (compila a nada)', () => {
    const malos: string[] = [];
    for (const rel of TODO_SRC) {
      for (const m of sinComentarios(leer(rel)).matchAll(CUALQUIER_TOKEN_N)) {
        if (!PELDANOS_VALIDOS.has(Number(m[1]))) malos.push(`${rel}: n-${m[1]}`);
      }
    }
    expect(malos).toEqual([]);
  });

  it.each(AUDITADOS_CONTRASTE)('%s no usa text-n-100..400 como tinta legible', (rel) => {
    expect(violaciones(leer(rel), TINTA_PROHIBIDA)).toEqual([]);
  });

  it('ningún hover invierte la polaridad (n-700+ que baja a n-400 o menos)', () => {
    const HOVER_INVERTIDO = /text-n-(\d{3,4})\s+hover:text-n-(\d{2,4})\b/g;
    for (const rel of AUDITADOS_CONTRASTE) {
      const src = sinComentarios(leer(rel));
      for (const m of src.matchAll(HOVER_INVERTIDO)) {
        expect(
          Number(m[2]),
          `${rel}: "${m[0]}" aclara la tinta al hacer hover`,
        ).toBeGreaterThanOrEqual(Number(m[1]));
      }
    }
  });
});
