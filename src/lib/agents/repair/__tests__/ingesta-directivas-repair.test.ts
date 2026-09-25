// ---------------------------------------------------------------------------
// Doctor de Datos — el balance se reconstruye con la regla común de ingesta
// (P4 cross-dep)
// ---------------------------------------------------------------------------
// `runRepairAgent` parseaba `rawCsv` (el `rawData` del pipeline) con
// `parseTrialBalanceCSV` directo: ignoraba la unidad confirmada (cifras 1.000
// veces menores), sumaba las hojas de un XLSX en un solo periodo y
// `recheck_validation` respondía `ok: true` con una unidad declarada sin
// confirmar, aunque /niif la bloquea con motivo. Ahora usa
// `preprocessUploadedTrialBalanceText` y el recheck conserva los motivos
// persistentes que ningún ajuste resuelve (los mismos que el gate de /niif).
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { rebuildRepairBalance } from '../agent';
import { buildRepairSystemPrompt } from '../prompt';
import { executeRepairTool } from '../tools';
import type { RecheckValidationOutput, RepairContext } from '../types';

// A = 570.000 (miles) = P 220.000 + K 350.000.
const CSV_MILES = [
  'codigo,nombre,nivel,Saldo 2025 (miles de pesos)',
  '110505,Caja,Auxiliar,570000',
  '220505,Proveedores,Auxiliar,220000',
  '310505,Capital,Auxiliar,350000',
].join('\n');

const hoja = (anio: string, caja: number) =>
  [
    `[period=${anio}]`,
    'codigo,nombre,nivel,Saldo',
    `110505,Caja,Auxiliar,${caja}`,
    `310505,Capital,Auxiliar,${caja}`,
    '[/period]',
  ].join('\n');

const ctxBase: RepairContext = {
  errorMessage: 'El balance de prueba tiene inconsistencias criticas.',
  rawCsv: null,
  language: 'es',
  conversationId: 'test-ingesta',
};

describe('rebuildRepairBalance — misma lectura que /niif', () => {
  it('la directiva de unidad confirmada reexpresa a pesos', () => {
    const { preprocessed, ingestReasons } = rebuildRepairBalance(`[unidad-confirmada=miles]\n${CSV_MILES}`);
    expect(ingestReasons).toEqual([]);
    expect(preprocessed?.primary.controlTotals.activo).toBe(570_000_000);
  });

  it('XLSX por hojas: cada hoja es su periodo', () => {
    const { preprocessed } = rebuildRepairBalance(`${hoja('2025', 100_000_000)}\n${hoja('2024', 80_000_000)}`);
    expect(preprocessed?.primary.period).toBe('2025');
    expect(preprocessed?.primary.controlTotals.activo).toBe(100_000_000);
    expect(preprocessed?.comparative?.period).toBe('2024');
  });

  it('hojas incompatibles: sin balance y con los motivos de la ingesta en el prompt', () => {
    const conflicto = [
      '[period=2025]',
      'codigo,nombre,nivel,Saldo',
      '110505,Caja,Auxiliar,100',
      '310505,Capital,Auxiliar,100',
      '[/period]',
      '[period=2025]',
      'codigo,nombre,nivel,Saldo',
      '110505,Caja,Auxiliar,90',
      '310505,Capital,Auxiliar,90',
      '[/period]',
    ].join('\n');
    const { preprocessed, ingestReasons } = rebuildRepairBalance(conflicto);
    expect(preprocessed).toBeNull();
    expect(ingestReasons.length).toBeGreaterThan(0);
    const prompt = buildRepairSystemPrompt({ ...ctxBase, rawCsv: conflicto }, preprocessed, [], ingestReasons);
    expect(prompt).toContain(ingestReasons[0]);
  });
});

describe('recheck_validation — motivos persistentes como en /niif', () => {
  it('unidad declarada sin confirmar: ok=false con el motivo aunque la ecuación cuadre', async () => {
    const { preprocessed } = rebuildRepairBalance(CSV_MILES);
    expect(preprocessed).not.toBeNull();
    const out = (await executeRepairTool('recheck_validation', {}, {
      preprocessed,
      language: 'es',
      adjustments: [],
    })) as RecheckValidationOutput;
    expect(out.controlTotals.ecuacionDiff).toBe(0);
    expect(out.ok).toBe(false);
    expect(out.errors.join(' ')).toMatch(/declara las cifras en miles de pesos/);
  });

  it('unidad confirmada: ok=true', async () => {
    const { preprocessed } = rebuildRepairBalance(`[unidad-confirmada=miles]\n${CSV_MILES}`);
    const out = (await executeRepairTool('recheck_validation', {}, {
      preprocessed,
      language: 'es',
      adjustments: [],
    })) as RecheckValidationOutput;
    expect(out.ok).toBe(true);
    expect(out.errors).toEqual([]);
  });
});
