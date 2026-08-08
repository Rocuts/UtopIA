import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Guardas de polaridad de tokens (regla dura de CLAUDE.md).
 *
 * La escala n-0..n-1000 se INVIERTE en [data-theme="dark"] (globals.css) y el
 * `@custom-variant dark` dispara con EXACTAMENTE el mismo selector. Por eso:
 *
 *  1. Una variante `dark:` sobre un token n-* invierte dos veces:
 *     `text-n-800 dark:text-n-200` renderiza en oscuro n-200 = #27231D sobre
 *     fondo #0A0907 → 1.3:1 (texto invisible), y `bg-white dark:bg-n-900`
 *     pinta una tarjeta CREMA dentro de un panel oscuro.
 *  2. n-100..n-400 nunca alcanzan 4.5:1 como tinta en NINGUNO de los dos modos
 *     (n-400 claro #B3AA95 sobre #FCFBF8 = 2.2:1; n-400 oscuro #5A5246 sobre
 *     #0A0907 = 2.6:1), así que están prohibidos como texto legible.
 *
 * Excluido a propósito: src/modules/pyme/** usa su propia paleta inline en hex.
 */

const REPO = resolve(__dirname, '../../../..');

const ARCHIVOS = [
  'src/app/workspace/escudo/agente-fiscal/page.tsx',
  'src/components/workspace/intake/NiifReportIntake.tsx',
  'src/components/workspace/AnalysisPanel.tsx',
  'src/components/workspace/ERPConnector.tsx',
];

/** Variante dark: aplicada a un token adaptativo n-<n>. */
const DARK_SOBRE_TOKEN_N = /\bdark:(?:[a-z-]+:)*(?:text|bg|border|divide|ring|from|to|via|placeholder|fill|stroke|accent|decoration|outline|shadow)-n-\d/g;

/**
 * Tinta prohibida. `text-n-100..400` como color de texto. No aplica a
 * placeholder:text-n-400 (placeholders sí pueden ser tenues) ni a border/bg.
 */
const TINTA_PROHIBIDA = /(?<!placeholder:)(?<![a-z-])(?:hover:|focus:|group-hover:|disabled:)?text-n-(?:100|200|300|400)\b/g;

function sinComentarios(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function violaciones(src: string, patron: RegExp): string[] {
  return sinComentarios(src).match(patron) ?? [];
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
`;

describe('polaridad de tokens n-*', () => {
  it('el detector marca el código previo al fix (prueba del guard)', () => {
    expect(violaciones(CODIGO_PREVIO_AL_FIX, DARK_SOBRE_TOKEN_N).length).toBeGreaterThan(0);
    expect(violaciones(CODIGO_PREVIO_AL_FIX, TINTA_PROHIBIDA).length).toBeGreaterThan(0);
  });

  it.each(ARCHIVOS)('%s no usa variantes dark: sobre tokens n-* adaptativos', (rel) => {
    const src = readFileSync(resolve(REPO, rel), 'utf8');
    expect(violaciones(src, DARK_SOBRE_TOKEN_N)).toEqual([]);
  });

  it.each(ARCHIVOS)('%s no usa text-n-100..400 como tinta legible', (rel) => {
    const src = readFileSync(resolve(REPO, rel), 'utf8');
    expect(violaciones(src, TINTA_PROHIBIDA)).toEqual([]);
  });

  it('ningún hover invierte la polaridad (n-700+ que baja a n-400 o menos)', () => {
    const HOVER_INVERTIDO = /text-n-(\d{3,4})\s+hover:text-n-(\d{2,4})\b/g;
    for (const rel of ARCHIVOS) {
      const src = sinComentarios(readFileSync(resolve(REPO, rel), 'utf8'));
      for (const m of src.matchAll(HOVER_INVERTIDO)) {
        expect(
          Number(m[2]),
          `${rel}: "${m[0]}" aclara la tinta al hacer hover`,
        ).toBeGreaterThanOrEqual(Number(m[1]));
      }
    }
  });
});
