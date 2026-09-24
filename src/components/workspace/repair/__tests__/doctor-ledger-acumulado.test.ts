// ---------------------------------------------------------------------------
// I5-9 — los ajustes de una sesión anterior del Doctor de Datos no se pierden
// en una segunda regeneración
// ---------------------------------------------------------------------------
// Secuencia (revisión I3-intake):
//   1. /niif falla → sesión 1 del Doctor → el usuario confirma a1 → regenera
//      (el intake lleva el ledger [a1]).
//   2. /niif vuelve a fallar → `repairConvId` se reinicia (una sesión por
//      error, para la telemetría) → sesión 2 con el ledger VACÍO → confirma a2
//      → regenera. `buildRegenerationIntake` sustituía el ledger por [a2]: a1,
//      que el usuario ya había confirmado, desaparecía del informe.
// Ahora: (a) la sesión 2 arranca con los ajustes confirmados de la corrida
// (el Doctor revalida sobre el mismo balance que procesó /niif y no vuelve a
// proponer a1 con otro id), y (b) la regeneración acumula el ledger
// confirmado de las sesiones sin duplicar por id.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Adjustment, RepairContext } from '@/lib/agents/repair/types';
import type { NiifReportIntake } from '@/types/platform';
import { buildRegenerationIntake, mergeConfirmedAdjustments } from '../../PipelineWorkspace';
import { useRepairChat } from '../useRepairChat';

const adj = (id: string, accountCode: string, amount: number, status: Adjustment['status'] = 'applied'): Adjustment => ({
  id,
  accountCode,
  accountName: `Cuenta ${accountCode}`,
  amount,
  rationale: 'Ajuste confirmado en el Doctor de Datos',
  status,
  proposedAt: '2026-09-24T10:00:00.000Z',
});

const INTAKE: NiifReportIntake = {
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

const a1 = adj('a1', '110505', 1_000);
const a2 = adj('a2', '220505', 2_000);

describe('regeneración: el ledger confirmado se acumula entre sesiones del Doctor', () => {
  it('segunda sesión SIN los ajustes de la primera: a1 no se pierde', () => {
    const first = buildRegenerationIntake(INTAKE, [a1]);
    const second = buildRegenerationIntake(first, [a2]);
    expect(second.adjustmentLedger?.adjustments.map((a) => a.id)).toEqual(['a1', 'a2']);
  });

  it('segunda sesión sembrada con a1: no se duplica por id (gana la versión más reciente)', () => {
    const first = buildRegenerationIntake(INTAKE, [a1]);
    const a1Again = { ...a1, appliedAt: '2026-09-24T11:00:00.000Z' };
    const second = buildRegenerationIntake(first, [a1Again, a2]);
    expect(second.adjustmentLedger?.adjustments).toEqual([a1Again, a2]);
  });

  it('sólo viajan ajustes confirmados; provisional se limpia como antes', () => {
    const provisional = { ...INTAKE, provisional: { active: true, reason: 'x' } } as NiifReportIntake;
    const out = buildRegenerationIntake(provisional, [a1, adj('p1', '130505', 5, 'proposed')]);
    expect(out.adjustmentLedger?.adjustments.map((a) => a.id)).toEqual(['a1']);
    expect(out.provisional).toBeUndefined();
    expect(mergeConfirmedAdjustments(null, [adj('r1', '1', 1, 'rejected')])).toEqual([]);
  });
});

describe('la sesión nueva del Doctor arranca con los ajustes confirmados de la corrida', () => {
  const context: RepairContext = {
    errorMessage: 'La ecuación patrimonial no cuadra',
    rawCsv: INTAKE.rawData,
    language: 'es',
    conversationId: 'repair-2',
  };

  function Probe(props: { confirmed?: Adjustment[] }) {
    const chat = useRepairChat(context, { confirmedAdjustments: props.confirmed });
    return createElement('pre', null, JSON.stringify(chat.adjustments.map((a) => `${a.id}:${a.status}`)));
  }

  it('el ledger inicial del hook son los confirmados (sólo `applied`)', () => {
    const html = renderToStaticMarkup(
      createElement(Probe, { confirmed: [a1, adj('p1', '130505', 5, 'proposed')] }),
    );
    expect(html).toContain('a1:applied');
    expect(html).not.toContain('p1');
    expect(renderToStaticMarkup(createElement(Probe, {}))).toContain('[]');
  });

  it('contrato: el host pasa al Doctor el ledger confirmado de la corrida vigente', () => {
    const src = readFileSync(resolve(__dirname, '../../PipelineWorkspace.tsx'), 'utf8');
    expect(src).toMatch(/confirmedAdjustments=\{/);
    const chat = readFileSync(resolve(__dirname, '../RepairChat.tsx'), 'utf8');
    expect(chat).toMatch(/useRepairChat\(enhancedContext, \{ confirmedAdjustments \}\)/);
  });
});
