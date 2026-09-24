// ---------------------------------------------------------------------------
// ELITE Pulido Diamante — smoke del bloque vinculante (LLM-facing).
// ---------------------------------------------------------------------------
// Verifica que `renderSnapshotLines(snapshot_post_Curator)` (helper que el
// orquestador financiero usa para construir el bloque "TOTALES VINCULANTES"
// que el LLM consume) emite las 4 secciones Curator esperadas cuando se le
// pasa el snapshot 2025 del fixture Pulido Diamante.
//
// Secciones (auditoría 2026-09):
//   - "## Reclasificaciones aplicadas (Curator R1)" — el fixture tiene un
//     saldo crédito material en 120505.
//   - "## Cierre Virtual aplicado (Curator R8)" — hay actividad P&L.
//   - "## Advertencia de Valoracion (Curator R7)" — margen bruto > 85%.
//   - NO "Anclaje patrimonial (R5)" ni "Cierre de Flujo de Efectivo (R6)":
//     R5 ya no reescribe el patrimonio y R6 sólo absorbe redondeos; el
//     descuadre deliberado del fixture (379505) bloquea en vez de maquillarse.
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
  // Notas (auditoría 2026-09, niif-preproceso-06/-15/-16, recalculo-08):
  //
  // (a) R8 ya no absorbe el descuadre del fixture (379505, −$1.572M) en
  //     3710VC: sólo reclasifica el 3605 anterior ($145M). El residual queda
  //     bloqueante y R5 no ancla el patrimonio, así que la sección
  //     "## Anclaje patrimonial aplicado (Curator R5)" NO aparece.
  //
  // (b) R6 sólo absorbe redondeos (≤ $1). La brecha del EFE de este fixture
  //     es la variación del descuadre entre periodos ($177,5M) y queda
  //     visible: la sección R6 NO aparece y el EFE se declara no reconciliado.
  // -------------------------------------------------------------------------
  it('renderSnapshotLines emite R1 + R8 + R7 (R5 y R6 no maquillan el descuadre)', () => {
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

    // Sub-string 3: R5 (anclaje patrimonial) — NO debe aparecer: desde la
    // auditoría 2026-09 R5 nunca reescribe el patrimonio (sólo revela una
    // brecha desglose ↔ clase 3 y bloquea), así que no hay anclaje que pintar.
    expect(
      text,
      'La seccion R5 NO deberia emitirse: R5 ya no ancla el patrimonio. ' +
        'Output recibido:\n' +
        text,
    ).not.toContain('## Anclaje patrimonial aplicado (Curator R5)');

    // Sub-string 4: R6 (cierre EFE) — NO debe aparecer. Auditoría 2026-09:
    // R6 sólo absorbe redondeos (≤ $1). Este fixture no cuadra (379505), el
    // EFE queda con brecha visible y el bloque lo declara "Reconciliado: no"
    // en lugar de presentar un ajuste de capital de trabajo inventado.
    expect(
      text,
      'La seccion R6 NO deberia emitirse: no hubo cierre forzado. Output recibido:\n' + text,
    ).not.toContain('## Cierre de Flujo de Efectivo aplicado (Curator R6)');
    expect(text).toContain('Reconciliado: no');

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

    // R8: la reclasificación del 3605 anterior ($145M → 3710VC) aparece
    // literal (formato es-CO). Auditoría 2026-09: R8 ya no absorbe el
    // descuadre del fixture (antes pintaba un "ajuste residual" de
    // $1.719,5M); ese residual bloquea en el gate 422 y no se presenta al LLM
    // como parte del patrimonio.
    expect(text).toMatch(/145\.000\.000/);
    expect(text).not.toMatch(/Ajuste residual absorbido/);

    // R7: el callout debe traer titulo y cuerpo (no vacios).
    expect(text).toMatch(/Texto literal del callout/);
  });
});
