// ---------------------------------------------------------------------------
// ELITE Pulido Diamante — smoke del bloque vinculante (LLM-facing).
// ---------------------------------------------------------------------------
// Verifica que `renderSnapshotLines(snapshot_post_Curator)` (helper que el
// orquestador financiero usa para construir el bloque "TOTALES VINCULANTES"
// que el LLM consume) emite las 4 secciones Curator esperadas cuando se le
// pasa el snapshot 2025 del fixture Pulido Diamante.
//
// Las 4 secciones:
//   - "## Reclasificaciones aplicadas (Curator R1)" — porque el fixture tiene
//     saldos negativos materiales en 120505 y 159205.
//   - "## Anclaje patrimonial aplicado (Curator R5)" — porque hay gap ECP↔Balance
//     de $1.572M.
//   - "## Cierre de Flujo de Efectivo aplicado (Curator R6)" — POST re-calibracion
//     del fixture (gap dentro de guardrail al 50%).
//   - "## Advertencia de Valoracion (Curator R7)" — porque margen bruto > 85%.
//
// Si alguna seccion falta, el LLM no veria el campo Curator correspondiente
// y el reporte final se generaria sin el ajuste — la regresion mas peligrosa
// del Pulido Diamante.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { renderSnapshotLines } from '@/lib/agents/financial/orchestrator';

import {
  parseTrialBalanceCSV,
  preprocessTrialBalance,
} from '../trial-balance';

const FIXTURE_PATH = resolve(
  __dirname,
  '..',
  '__fixtures__',
  'elite-pulido-diamante.csv',
);

function loadPrimarySnapshot() {
  const csv = readFileSync(FIXTURE_PATH, 'utf-8');
  const rows = parseTrialBalanceCSV(csv);
  const result = preprocessTrialBalance(rows);
  if (!result.primary) {
    throw new Error('preprocessTrialBalance no produjo snapshot primario.');
  }
  return result.primary;
}

describe('ELITE Pulido Diamante — smoke del bloque vinculante (LLM-facing)', () => {
  it('renderSnapshotLines emite las 4 secciones Curator cuando el snapshot las trae', () => {
    const snap = loadPrimarySnapshot();
    const lines = renderSnapshotLines(snap);
    const text = lines.join('\n');

    // Sub-string 1: R1 (reclasificaciones)
    expect(
      text,
      'Falta seccion R1 — el LLM no veria las reclasificaciones del Curator. ' +
        'Output recibido:\n' +
        text,
    ).toContain('## Reclasificaciones aplicadas (Curator R1)');

    // Sub-string 2: R5 (anclaje patrimonial)
    expect(
      text,
      'Falta seccion R5 — el LLM no veria el anclaje patrimonial Balance↔ECP. ' +
        'Output recibido:\n' +
        text,
    ).toContain('## Anclaje patrimonial aplicado (Curator R5)');

    // Sub-string 3: R6 (cierre EFE)
    expect(
      text,
      'Falta seccion R6 — el LLM no veria el cierre del EFE contra PUC 11. ' +
        'Output recibido:\n' +
        text,
    ).toContain('## Cierre de Flujo de Efectivo aplicado (Curator R6)');

    // Sub-string 4: R7 (costo presunto)
    expect(
      text,
      'Falta seccion R7 — el LLM no veria la advertencia de costo presunto. ' +
        'Output recibido:\n' +
        text,
    ).toContain('## Advertencia de Valoracion (Curator R7)');
  });

  it('Las cifras literales aparecen en el bloque (sanity-check del helper fmtCop)', () => {
    const snap = loadPrimarySnapshot();
    const lines = renderSnapshotLines(snap);
    const text = lines.join('\n');

    // R1: las dos reclasificaciones (120505 = $50M y 159205 = $130M) deben
    // aparecer literales con sus codigos.
    expect(text).toMatch(/120505/);
    expect(text).toMatch(/159205/);

    // R5: el ajuste de $1.572M debe aparecer.
    expect(text).toMatch(/1\.572\.000\.000/);

    // R7: el callout debe traer titulo y cuerpo (no vacios).
    expect(text).toMatch(/Texto literal del callout/);
  });
});
