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
  // -------------------------------------------------------------------------
  // Notas de la nueva arquitectura (post-R8, mayo 2026):
  //
  // (a) R8 (Cierre Virtual) reemplaza a R5 como absorbedor del gap del fixture:
  //     el residual de la cuenta 379505 (-$1,572B) + el gap 3605 viejo vs
  //     utilidad dinámica ($147,5M) terminan en la cuenta virtual 3710VC. R5
  //     solo ve la ecuación contable ya cuadrada y NO actúa, así que la
  //     sección "## Anclaje patrimonial aplicado (Curator R5)" NO aparece en
  //     el bloque vinculante. En su lugar aparece la sección R8.
  //
  // (b) R6 (Cierre EFE): la brecha del EFE indirecto vs la variación observada
  //     en PUC 11 es ≈ $312,5M — superior al 50 % de cualquier bucket
  //     operativo disponible. El guardrail Pulido Diamante R6 rechaza el
  //     cierre automático y NO popula `snap.cashFlowClosureAdjustment`, por
  //     lo que la sección R6 tampoco aparece.
  // -------------------------------------------------------------------------
  it('renderSnapshotLines emite R1 + R8 + R7 (R5/R6 inactivos por la nueva arquitectura)', () => {
    const snap = loadPrimarySnapshot();
    const lines = renderSnapshotLines(snap);
    const text = lines.join('\n');

    // Sub-string 1: R1 (reclasificaciones) — DEBE aparecer
    expect(
      text,
      'Falta seccion R1 — el LLM no veria las reclasificaciones del Curator. ' +
        'Output recibido:\n' +
        text,
    ).toContain('## Reclasificaciones aplicadas (Curator R1)');

    // Sub-string 2 (NUEVA): R8 (Cierre Virtual) — DEBE aparecer porque hay
    // actividad P&L en el fixture y R8 SIEMPRE muta en ese caso.
    expect(
      text,
      'Falta seccion R8 — el LLM no veria el Cierre Virtual aplicado. ' +
        'Output recibido:\n' +
        text,
    ).toContain('## Cierre Virtual aplicado (Curator R8)');

    // Sub-string 3: R5 (anclaje patrimonial) — NO debe aparecer: bajo la nueva
    // arquitectura R8 absorbe el gap antes y deja la ecuación cuadrada, por
    // lo que el guard de R5 lo deja pasar sin actuar.
    expect(
      text,
      'La seccion R5 NO deberia emitirse cuando R8 ya cuadró la ecuación. ' +
        'Output recibido:\n' +
        text,
    ).not.toContain('## Anclaje patrimonial aplicado (Curator R5)');

    // Sub-string 4: R6 (cierre EFE) — NO debe aparecer: el guardrail de
    // plausibilidad rechazó el cierre automático (brecha ≈ $312,5M > 50 %
    // de todos los buckets). El renderer omite esta sección correctamente.
    expect(
      text,
      'La seccion R6 NO deberia emitirse cuando el guardrail rechaza el cierre. ' +
        'Output recibido:\n' +
        text,
    ).not.toContain('## Cierre de Flujo de Efectivo aplicado (Curator R6)');

    // Sub-string 5: R7 (costo presunto) — DEBE aparecer
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

    // R8: el residual absorbido en 3710VC ≈ $1.719,5M debe aparecer literal
    // (formato es-CO: punto miles + coma decimal). El centsAdjustment es el
    // único valor con esa magnitud que el renderer pinta.
    expect(text).toMatch(/1\.719\.500\.000/);

    // R7: el callout debe traer titulo y cuerpo (no vacios).
    expect(text).toMatch(/Texto literal del callout/);
  });
});
