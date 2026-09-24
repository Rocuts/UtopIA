// IW4 (valoracion-04/18) — El servicio macro ya expone procedencia por campo;
// Valoración y Factibilidad recibían `macro` vacío (bloque <macro_vigente> todo
// N/D) porque nadie lo mapeaba. El mapeo conserva vigencia y fuente, no rellena
// campos sin dato y nunca bloquea el pipeline.
import { describe, expect, it, vi } from 'vitest';

const getMacroFactors = vi.hoisted(() => vi.fn());
vi.mock('../service', () => ({ getMacroFactors }));

import { getMacroSnapshotForPrompts, macroFactorsToSnapshot } from '../prompt-snapshot';
import { buildMacroVigenteBlock } from '@/lib/agents/financial/valuation/macro-context';
import type { MacroFactors } from '@/lib/pillars/types';

const factors: MacroFactors = {
  ipc: {
    value: 0.0512, source: 'dane', asOf: '2026-08', fetchedAt: '2026-09-20T10:00:00.000Z',
    stale: false, reason: null,
  },
  trm: {
    value: 3_987.65, source: 'superfinanciera', asOf: '2026-09-19', fetchedAt: '2026-09-10T10:00:00.000Z',
    stale: true, reason: 'La fuente respondió HTTP 503.',
  },
  tasaBanRep: {
    value: null, source: null, asOf: null, fetchedAt: null, stale: false,
    reason: 'Serie oficial no configurada.',
  },
  fechaActualizacion: '2026-09-20T10:00:00.000Z',
  fuente: 'por-campo',
};

describe('macroFactorsToSnapshot', () => {
  it('mapea IPC (%), TRM y deja N/D la tasa sin dato; conserva vigencia y fuente', () => {
    const snap = macroFactorsToSnapshot(factors)!;
    expect(snap.inflationCopYoYPercent).toEqual({
      value: 5.12, asOf: '2026-08', source: 'DANE — IPC, variación anual',
    });
    expect(snap.trmCopPerUsd?.value).toBe(3_987.65);
    expect(snap.trmCopPerUsd?.asOf).toBe('2026-09-19');
    expect(snap.trmCopPerUsd?.source).toMatch(/Superintendencia Financiera.*último dato verificado, consultado 2026-09-10/);
    expect(snap.policyRatePercent).toBeNull();

    const block = buildMacroVigenteBlock(snap);
    expect(block).toMatch(/Inflación anual Colombia \(IPC\): 5,12% \(vigencia 2026-08; fuente: DANE/);
    expect(block).toMatch(/Tasa de política monetaria BanRep: N\/D/);
    expect(block).toMatch(/TES 10Y COP \(rendimiento bruto\): N\/D/);
  });

  it('sin factores ⇒ null (todo N/D)', () => {
    expect(macroFactorsToSnapshot(null)).toBeNull();
  });
});

describe('getMacroSnapshotForPrompts', () => {
  it('devuelve el snapshot del servicio', async () => {
    getMacroFactors.mockResolvedValueOnce(factors);
    const snap = await getMacroSnapshotForPrompts();
    expect(snap?.inflationCopYoYPercent?.value).toBe(5.12);
  });

  it('si el servicio falla no bloquea: null', async () => {
    getMacroFactors.mockRejectedValueOnce(new Error('db down'));
    expect(await getMacroSnapshotForPrompts()).toBeNull();
  });

  it('si el servicio tarda más que el límite: null', async () => {
    getMacroFactors.mockImplementationOnce(() => new Promise(() => {}));
    expect(await getMacroSnapshotForPrompts(20)).toBeNull();
  });
});
