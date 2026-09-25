// ---------------------------------------------------------------------------
// Especialista en Gobierno — degradación visible y capitalización del acta
// ---------------------------------------------------------------------------
// pipeline-flujo-15: `onDegraded` no se registraba en el Especialista en
//   Gobierno; una sección regenerada con razonamiento reducido salía sin aviso.
// pipeline-flujo-12: con pérdida o utilidad bajo el umbral la aritmética
//   determinista dice que la capitalización NO aplica, pero si el LLM emitía
//   applies=true el acta imprimía "_Monto a capitalizar:_" con su cifra.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';

const queue: unknown[] = [];
vi.mock('@/lib/agents/financial/agents/runtime', () => ({
  callFinancialAgent: vi.fn(async () => ({ json: queue.shift(), meta: {} })),
}));

import { runGovernanceSpecialist } from '../governance-specialist';
import { callFinancialAgent } from '@/lib/agents/financial/agents/runtime';
import { buildActaExpectedArithmetic } from '../../prompts/governance-specialist.prompt';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import type { GovernanceReportJson } from '../../contracts/governance-report';
import type { CompanyInfo } from '../../types';

const SAS: CompanyInfo = { name: 'Acta SAS', nit: '900123456', fiscalPeriod: '2025', entityType: 'SAS', niifGroup: 2 };

/** Pérdida del ejercicio de $30.000.000 (ingresos 50M, gastos 80M). */
const CSV_PERDIDA = [
  'codigo,nombre,nivel,transaccional,saldo 2025',
  '110505,Caja,Auxiliar,1,40000000',
  '220505,Proveedores,Auxiliar,1,30000000',
  '311505,Capital,Auxiliar,1,40000000',
  '360505,Pérdida del ejercicio,Auxiliar,1,-30000000',
  '410505,Ventas,Auxiliar,1,50000000',
  '510505,Sueldos,Auxiliar,1,80000000',
].join('\n');

/** Utilidad del ejercicio de $20.000.000. */
const CSV_UTILIDAD = [
  'codigo,nombre,nivel,transaccional,saldo 2025',
  '110505,Caja,Auxiliar,1,90000000',
  '220505,Proveedores,Auxiliar,1,30000000',
  '311505,Capital,Auxiliar,1,40000000',
  '360505,Utilidad del ejercicio,Auxiliar,1,20000000',
  '410505,Ventas,Auxiliar,1,100000000',
  '510505,Sueldos,Auxiliar,1,80000000',
].join('\n');

function govJson(capitalization: Partial<GovernanceReportJson['shareholderMinutes']['capitalizationProposal']>): GovernanceReportJson {
  return {
    company: {
      name: 'Acta SAS', nit: '900123456', entityType: 'SAS', sector: null, niifGroup: 2,
      fiscalPeriod: '2025', comparativePeriod: null, city: null, signatories: null,
    },
    reportMode: 'LINEA_BASE',
    signatories: null,
    financialNotes: [
      { number: 1, title: 'Entidad', body: 'Sociedad comercial.', normReference: null, materiality: 'material', confidence: null },
    ],
    shareholderMinutes: {
      assemblyType: 'Asamblea General de Accionistas',
      entityRegimeCitation: 'Ley 1258 de 2008 (SAS)',
      city: null,
      meetingDate: null,
      convocationStatement: 'Se convocó por comunicación escrita.',
      quorumStatement: 'Se verificó el quorum conforme a los estatutos sociales.',
      agenda: [{ number: 1, topic: 'Aprobación de estados financieros' }],
      developments: [],
      resultDistribution: { netIncomeCop: '0', applies: false, lines: [], neutralProposalText: 'La asamblea decide.' },
      capitalizationProposal: {
        applies: false,
        retainedEarningsBaseCop: '0',
        capitalizationAmountCop: '0',
        legalReference: 'Ley 1258/2008 art. 29',
        body: 'Capitalización.',
        ...capitalization,
      },
      signatures: [{ role: 'representante_legal', name: null, identification: null }],
      fiscalReviewerOpinion: {
        applies: false, reviewerName: null, reviewerTp: null, opinionType: null, opinionBody: null,
        exemptionReason: 'No obligada.',
      },
      closingStatement: 'Se levanta la sesión.',
    },
    complianceChecklist: [],
    disclaimers: [],
    preparerNotes: [],
  } as GovernanceReportJson;
}

const run = (json: GovernanceReportJson, csv?: string, onProgress?: (e: unknown) => void) => {
  queue.push(json);
  const pp = csv ? preprocessTrialBalance(parseTrialBalanceCSV(csv)) : undefined;
  return runGovernanceSpecialist(
    { fullContent: 'niif' } as never, { fullContent: 'strategy' } as never, SAS, 'es', undefined,
    'TOTALES', pp, onProgress,
  );
};

beforeEach(() => { queue.length = 0; });

describe('pipeline-flujo-12 — capitalización que la aritmética determinista no habilita', () => {
  it('con pérdida y applies=true del LLM, el acta no imprime monto a capitalizar', async () => {
    const pp = preprocessTrialBalance(parseTrialBalanceCSV(CSV_PERDIDA));
    expect(buildActaExpectedArithmetic(SAS, pp)?.capitalizationApplies).toBe(false);
    const res = await run(
      govJson({ applies: true, retainedEarningsBaseCop: '10000000000', capitalizationAmountCop: '4000000000' }),
      CSV_PERDIDA,
    );
    expect(res.shareholderMinutes).not.toContain('_Monto a capitalizar:_');
    expect(res.shareholderMinutes).not.toContain('$40.000.000,00');
    // El JSON conserva lo emitido: el reconciliador del orquestador lo sella.
    expect(res.json?.shareholderMinutes.capitalizationProposal.applies).toBe(true);
  });

  it('con utilidad sobre el umbral la capitalización se sigue imprimiendo', async () => {
    const pp = preprocessTrialBalance(parseTrialBalanceCSV(CSV_UTILIDAD));
    const expected = buildActaExpectedArithmetic(SAS, pp);
    expect(expected?.capitalizationApplies).toBe(true);
    const res = await run(
      govJson({
        applies: true,
        retainedEarningsBaseCop: expected!.capitalizationBaseCop,
        capitalizationAmountCop: expected!.capitalizationAmountCop,
      }),
      CSV_UTILIDAD,
    );
    expect(res.shareholderMinutes).toContain('_Monto a capitalizar:_');
  });
});

describe('pipeline-flujo-15 — degradación visible del Especialista en Gobierno', () => {
  it('onDegraded se registra: aviso en notas, acta y cuerpo; campo degraded', async () => {
    const json = govJson({});
    vi.mocked(callFinancialAgent).mockImplementationOnce((async (opts: {
      agentName: string;
      onDegraded?: (i: { agentName: string; requestedEffort: string; message: string }) => void;
    }) => {
      opts.onDegraded?.({ agentName: opts.agentName, requestedEffort: 'medium', message: 'Gobierno regenerado con esfuerzo bajo.' });
      return { json, meta: { degraded: true } };
    }) as never);
    const events: unknown[] = [];
    const res = await runGovernanceSpecialist(
      { fullContent: 'niif' } as never, { fullContent: 'strategy' } as never, SAS, 'es', undefined,
      'TOTALES', undefined, (e) => events.push(e),
    );
    expect(res.degraded).toBe(true);
    expect(res.fullContent.startsWith('> **SECCIÓN GENERADA CON RAZONAMIENTO REDUCIDO**')).toBe(true);
    expect(res.shareholderMinutes).toContain('RAZONAMIENTO REDUCIDO');
    expect(res.financialNotes).toContain('RAZONAMIENTO REDUCIDO');
    expect(events).toContainEqual({ type: 'stage_progress', stage: 3, detail: 'Gobierno regenerado con esfuerzo bajo.' });
  });

  it('sin degradación no hay aviso ni campo degraded', async () => {
    const res = await run(govJson({}));
    expect(res.degraded).toBeUndefined();
    expect(res.fullContent).not.toContain('RAZONAMIENTO REDUCIDO');
  });
});
