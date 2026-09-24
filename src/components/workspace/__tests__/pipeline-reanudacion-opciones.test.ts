// ---------------------------------------------------------------------------
// I5-6 — la reanudación usa `provisional`, `instructions` y `excludedFactIds`
// del checkpoint, no del intake vigente
// ---------------------------------------------------------------------------
// Tras I3-3 la reanudación toma el balance y el ledger del checkpoint, pero
// `provisional`, `instructions` y `excludedFactIds` seguían saliendo del intake
// vigente. Secuencia (revisión I3-intake):
//   1. Corrida A marcada "Continuar de todas formas" (provisional) con
//      instrucciones y hechos excluidos; /strategy falla → checkpoint A.
//   2. Regeneración con ajustes del Doctor (limpia `provisional`, otras
//      instrucciones) → /niif falla. El checkpoint A sobrevive; el intake
//      vigente es el de la regeneración.
//   3. "Completar reporte": /strategy y /governance recibían las instrucciones
//      y exclusiones de la regeneración sobre el balance de A, y /consolidate
//      consolidaba A sin el sello BORRADOR (o se lo ponía a una corrida que no
//      era provisional).
// Ahora esas opciones viajan con el checkpoint (en memoria y en el registro de
// localStorage del checkpoint NIIF) y la reanudación usa las suyas.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AdjustmentLedger } from '@/lib/agents/repair/types';
import type { NiifReportIntake } from '@/types/platform';
import {
  buildConsolidationRequestBody,
  buildRegenerationIntake,
  loadCheckpointLedger,
  loadCheckpointRunOptions,
  resolveRunOptions,
  runOptionsOf,
  saveCheckpointLedger,
  type NiifRunIntake,
} from '../PipelineWorkspace';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    removeItem: (k: string) => {
      m.delete(k);
    },
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
  };
}

const BASE: NiifReportIntake = {
  caseType: 'niif_report',
  company: { name: 'Demo SAS', nit: '900123456-8', entityType: 'SAS' },
  niifGroup: 2,
  fiscalPeriod: '2025',
  rawData: 'codigo,nombre,saldo 2025\n110505,Caja,100',
  outputOptions: {
    financialStatements: true,
    kpiDashboard: true,
    cashFlowProjection: true,
    breakevenAnalysis: true,
    notesToFinancialStatements: true,
    shareholdersMinutes: true,
    auditPipeline: false,
    metaAudit: false,
    excelExport: true,
    comparativeAnalysis: false,
  },
};

/** Corrida A: provisional, con instrucciones y un hecho excluido. */
const INTAKE_A: NiifRunIntake = {
  ...BASE,
  specialInstructions: 'Instrucciones de la corrida A',
  excludedFactIds: ['hecho-a'],
  provisional: { active: true, reason: 'Balance sin cierre del ejercicio' },
};

/** Regeneración con ajustes (limpia provisional) y otras instrucciones/exclusiones. */
const LEDGER: AdjustmentLedger = {
  adjustments: [
    {
      id: 'r1',
      accountCode: '110505',
      accountName: 'Caja',
      amount: 10,
      rationale: 'Ajuste confirmado',
      status: 'applied',
      proposedAt: '2026-09-24T10:00:00.000Z',
    },
  ],
};
const REGEN: NiifRunIntake = {
  ...buildRegenerationIntake(INTAKE_A, LEDGER.adjustments),
  specialInstructions: 'Instrucciones de la regeneración',
  excludedFactIds: ['hecho-b', 'hecho-c'],
};

describe('opciones de la corrida: completa vs reanudación', () => {
  it('corrida completa: las del intake', () => {
    expect(resolveRunOptions('niif', INTAKE_A, null)).toEqual({
      provisional: { active: true, reason: 'Balance sin cierre del ejercicio' },
      instructions: 'Instrucciones de la corrida A',
      excludedFactIds: ['hecho-a'],
    });
    expect(REGEN.provisional).toBeUndefined();
    expect(resolveRunOptions('niif', REGEN, { run: runOptionsOf(INTAKE_A) })).toEqual({
      provisional: null,
      instructions: 'Instrucciones de la regeneración',
      excludedFactIds: ['hecho-b', 'hecho-c'],
    });
  });

  it('reanudación: SIEMPRE las del checkpoint, aunque el intake vigente sea otra corrida', () => {
    const checkpointA = { run: runOptionsOf(INTAKE_A) };
    for (const start of ['strategy', 'governance'] as const) {
      expect(resolveRunOptions(start, REGEN, checkpointA)).toEqual(runOptionsOf(INTAKE_A));
      // Sin intake en memoria (recarga): igual.
      expect(resolveRunOptions(start, null, checkpointA)).toEqual(runOptionsOf(INTAKE_A));
      // Checkpoint NO provisional e intake vigente provisional: sin BORRADOR.
      const checkpointRegen = { run: runOptionsOf(REGEN) };
      expect(resolveRunOptions(start, INTAKE_A, checkpointRegen).provisional).toBeNull();
    }
  });

  it('/consolidate de la reanudación lleva el BORRADOR de la corrida del checkpoint', () => {
    const run = resolveRunOptions('governance', REGEN, { run: runOptionsOf(INTAKE_A) });
    const body = buildConsolidationRequestBody({
      rawData: BASE.rawData,
      company: { name: 'Demo SAS', nit: '900123456-8', fiscalPeriod: '2025' },
      language: 'es',
      niifResult: {} as never,
      strategyResult: {} as never,
      governanceResult: {} as never,
      provisional: run.provisional,
    });
    expect(body.provisional).toEqual({ active: true, reason: 'Balance sin cierre del ejercicio' });
  });
});

describe('opciones guardadas con el checkpoint NIIF (localStorage)', () => {
  it('se guardan con el ledger del checkpoint, por conversación', () => {
    const local = memoryStorage();
    saveCheckpointLedger('report-A', null, local, runOptionsOf(INTAKE_A));
    expect(loadCheckpointRunOptions('report-A', local)).toEqual(runOptionsOf(INTAKE_A));
    expect(loadCheckpointRunOptions('report-B', local)).toBeNull();
    // El ledger del registro sigue leyéndose igual.
    expect(loadCheckpointLedger('report-A', local)).toEqual({ found: true, adjustmentLedger: null });
  });

  it('un registro sin opciones (checkpoint anterior a I5-6) no inventa unas', () => {
    const local = memoryStorage();
    saveCheckpointLedger('report-A', LEDGER, local);
    expect(loadCheckpointRunOptions('report-A', local)).toBeNull();
  });

  it('valores ilegibles del registro se descartan campo a campo', () => {
    const local = memoryStorage();
    local.setItem(
      'utopia_pipeline_niif_checkpoint_ledger',
      JSON.stringify({
        conversationId: 'report-A',
        adjustmentLedger: null,
        run: { provisional: { active: 'sí' }, instructions: 42, excludedFactIds: ['ok', 7] },
      }),
    );
    expect(loadCheckpointRunOptions('report-A', local)).toEqual({
      provisional: null,
      instructions: null,
      excludedFactIds: ['ok'],
    });
  });
});

describe('contrato: el componente usa las opciones del checkpoint al reanudar', () => {
  const src = readFileSync(resolve(__dirname, '../PipelineWorkspace.tsx'), 'utf8');

  it('runPipeline toma provisional, instrucciones y exclusiones de resolveRunOptions', () => {
    expect(src).toContain('resolveRunOptions(start, intakeWithExtras, resumeCheckpoint)');
    expect(src).not.toMatch(/const provisional = intakeWithExtras\?\.provisional/);
    expect(src).not.toMatch(/const excludedFactIds = intake\?\.excludedFactIds/);
    expect(src).not.toMatch(/const instructions = intake\?\.specialInstructions/);
  });

  it('el checkpoint guarda y rehidrata sus opciones', () => {
    expect(src).toContain('saveCheckpointLedger(nextConvId, adjustmentLedger, undefined, runOptions)');
    expect(src).toContain('run: loadCheckpointRunOptions(lastCompletedReport.conversationId)');
  });
});
