// ---------------------------------------------------------------------------
// pipeline-flujo-03 — acta sin aritmética determinista verificable
// ---------------------------------------------------------------------------
// runGovernancePhase sólo reconciliaba el acta si había preprocesado. Sin él
// (reanudación tras recarga con `preprocessed: null`, o flujo de carga sin
// preprocesado) un acta que reparte utilidades o capitaliza salía con
// `actaQualifications` undefined y el gate de exportación la aceptaba. Un acta
// se FIRMA y reparte dinero: una cifra de destinación sin ancla no es
// emitible.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

let nextJson: unknown = null;
vi.mock('@/lib/agents/financial/agents/runtime', () => ({
  callFinancialAgent: vi.fn(async () => ({ json: nextJson, meta: {} })),
}));

import { runGovernancePhase } from '@/lib/agents/financial/orchestrator';
import { actaArithmeticSeal } from '@/lib/agents/financial/agents/governance-specialist';
import { financialExportBlockers } from '@/lib/export/financial-export-validation';
import { makeExportableReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import type { NiifAnalysisResult, StrategicAnalysisResult } from '@/lib/agents/financial/types';

const CSV = [
  'codigo,nombre,nivel,transaccional,saldo 2025',
  '110505,Caja,Auxiliar,1,50000000',
  '130505,Clientes,Auxiliar,1,40000000',
  '220505,Proveedores,Auxiliar,1,30000000',
  '311505,Capital,Auxiliar,1,40000000',
  '360505,Utilidad del ejercicio,Auxiliar,1,20000000',
  '410505,Ventas,Auxiliar,1,100000000',
  '510505,Sueldos,Auxiliar,1,80000000',
].join('\n');

function govJson(opts: {
  distributionApplies: boolean;
  lines: Array<{ label: string; amountCop: string }>;
  capitalizationApplies?: boolean;
  capitalizationAmountCop?: string;
}) {
  const agenda = Array.from({ length: 8 }, (_, i) => ({ number: i + 1, topic: `Punto ${i + 1}` }));
  return {
    company: { name: 'X SA', nit: '900123456', fiscalPeriod: '2025' },
    reportMode: 'LINEA_BASE',
    financialNotes: [{ number: 1, title: 'Entidad', body: 'Nota.', normReference: null, materiality: 'material' }],
    shareholderMinutes: {
      assemblyType: 'Asamblea General de Accionistas',
      entityRegimeCitation: 'C.Co.',
      city: null,
      meetingDate: null,
      convocationStatement: 'ok',
      quorumStatement: 'ok',
      agenda,
      developments: [],
      resultDistribution: {
        netIncomeCop: '2000000000',
        applies: opts.distributionApplies,
        neutralProposalText: opts.distributionApplies ? null : 'La asamblea decidirá.',
        lines: opts.lines.map((l) => ({ ...l, normReference: 'Art. 452 C.Co.' })),
      },
      capitalizationProposal: {
        applies: opts.capitalizationApplies ?? false,
        retainedEarningsBaseCop: '0',
        capitalizationAmountCop: opts.capitalizationAmountCop ?? '0',
        legalReference: 'n/a',
        body: 'No aplica.',
      },
      signatures: [
        { role: 'presidente_asamblea', name: null, identification: null },
        { role: 'secretario_asamblea', name: null, identification: null },
        { role: 'representante_legal', name: null, identification: null },
      ],
      fiscalReviewerOpinion: {
        applies: false,
        reviewerName: null,
        reviewerTp: null,
        opinionType: null,
        opinionBody: null,
        exemptionReason: 'n/a',
      },
      closingStatement: 'Fin.',
    },
    complianceChecklist: [],
    disclaimers: [],
    preparerNotes: [],
  };
}

const input = (preprocessed: ReturnType<typeof preprocessTrialBalance> | undefined) => ({
  niifResult: { fullContent: 'NIIF' } as NiifAnalysisResult,
  strategyResult: { fullContent: 'E' } as StrategicAnalysisResult,
  bindingTotals: 'TOTALES VINCULANTES',
  preprocessed,
  company: { name: 'X SA', nit: '900123456', fiscalPeriod: '2025', entityType: 'SA' },
  language: 'es' as const,
});

beforeEach(() => {
  nextJson = null;
});

describe('runGovernancePhase — acta sin preprocesado', () => {
  it('reparto de utilidades sin ancla → acta sellada y NO exportable', async () => {
    nextJson = govJson({
      distributionApplies: true,
      lines: [
        { label: 'Reserva legal', amountCop: '1200000000' },
        { label: 'Saldo distribuible', amountCop: '800000000' },
      ],
    });
    const g = await runGovernancePhase(input(undefined));
    expect(g.actaQualifications?.clean).toBe(false);
    expect(g.actaQualifications?.motivos.join(' ')).toMatch(/sin aritmética determinista/);
    expect(g.shareholderMinutes).toContain('ACTA CON SALVEDADES');
    // I5-7 — paridad: el sello de la fase es el de `actaArithmeticSeal`, la
    // misma función que usa el re-render del servidor (part-markdown.ts).
    expect(g.shareholderMinutes.startsWith(actaArithmeticSeal(g.actaQualifications!.motivos, false, 'es'))).toBe(true);
    expect(g.fullContent.startsWith(actaArithmeticSeal(g.actaQualifications!.motivos, false, 'es'))).toBe(true);

    const report = makeExportableReport();
    report.governance = g;
    expect(financialExportBlockers(report).length).toBeGreaterThan(0);
  });

  it('capitalización sin ancla → acta sellada', async () => {
    nextJson = govJson({
      distributionApplies: false,
      lines: [],
      capitalizationApplies: true,
      capitalizationAmountCop: '800000000',
    });
    const g = await runGovernancePhase(input(undefined));
    expect(g.actaQualifications?.clean).toBe(false);
  });

  it('acta sin cifras de destinación (applies=false, sin renglones) no se sella', async () => {
    nextJson = govJson({ distributionApplies: false, lines: [] });
    const g = await runGovernancePhase(input(undefined));
    expect(g.actaQualifications).toBeUndefined();
    expect(g.shareholderMinutes).not.toContain('ACTA CON SALVEDADES');
  });

  it('con preprocesado se sigue reconciliando contra la aritmética determinista', async () => {
    nextJson = govJson({
      distributionApplies: true,
      lines: [
        { label: 'Reserva legal', amountCop: '1200000000' },
        { label: 'Saldo distribuible', amountCop: '800000000' },
      ],
    });
    const pp = preprocessTrialBalance(parseTrialBalanceCSV(CSV));
    const g = await runGovernancePhase(input(pp));
    expect(g.actaQualifications?.clean).toBe(false);
    expect(g.actaQualifications?.motivos.join(' ')).not.toMatch(/sin aritmética determinista/);
    // I5-7 — paridad del sello anclado con el del servidor.
    expect(g.shareholderMinutes.startsWith(actaArithmeticSeal(g.actaQualifications!.motivos, true, 'es'))).toBe(true);
  });
});
