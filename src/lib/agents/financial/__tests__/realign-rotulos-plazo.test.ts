// ---------------------------------------------------------------------------
// Revisión I5-niif — rótulos del modelo tras sustituir una sección por plazo
// ---------------------------------------------------------------------------
// La sustitución por E27 (I5-niif 2) y el completado por brecha conservan el
// rótulo que escribió el modelo para cada grupo PUC. Se buscaba sólo por
// código, así que un grupo que el modelo ubicó en el bloque equivocado pasaba
// al bloque correcto con un rótulo que nombraba el plazo equivocado: "Otros
// pasivos no corrientes" bajo "Total pasivo corriente" (virtual de R1), o
// "Inversiones temporales de corto plazo" bajo "Total activo no corriente"
// (vencimiento declarado). Y un grupo que el modelo presentó en los dos bloques
// con rótulos distintos recibía el último en ambos.
//
// Ahora el rótulo se busca por grupo Y plazo: el del modelo en su bloque; en
// el otro bloque sólo si no nombra un plazo; si lo nombra, el del catálogo.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';

const callFinancialAgentMock = vi.fn();
vi.mock('@/lib/agents/financial/agents/runtime', () => ({
  callFinancialAgent: (opts: unknown) => callFinancialAgentMock(opts),
}));
vi.mock('@/lib/facts/report-facts', () => ({ getHechosEmpresaBlock: vi.fn(async () => '') }));

import {
  aplicarVencimientosDeclarados,
  parseTrialBalanceCSVWithMeta,
  preprocessTrialBalance,
  type PreprocessedBalance,
} from '@/lib/preprocessing/trial-balance';
import type { NiifReportJson } from '../contracts/niif-report';
import { CSV_R1, M, det, esfQueSigueElPrompt, preprocesarR1, sub } from '../__fixtures__/r1-anticipo-credito';
import { informeHonesto, linea } from '../__fixtures__/perdida-comparativo-w4a';
import { realignEsfTermsFromSnapshot } from '../agents/reconcile-anchors';
import { runNiifPhase } from '../orchestrator';

function mockPasses(json: NiifReportJson) {
  callFinancialAgentMock.mockImplementation(async (opts: { agentName: string }) => {
    if (opts.agentName.startsWith('niif-analyst-pass1')) {
      return {
        json: {
          company: json.company,
          balanceSheet: json.balanceSheet,
          incomeStatement: json.incomeStatement,
          curatorFlags: json.curatorFlags,
          reportMode: json.reportMode,
        },
        meta: {},
      };
    }
    if (opts.agentName === 'niif-analyst-pass2') {
      return { json: { cashFlow: json.cashFlow, equityChanges: { rows: json.equityChanges.rows, notes: [] } }, meta: {} };
    }
    return { json: { technicalNotes: [] }, meta: {} };
  });
}

beforeEach(() => {
  callFinancialAgentMock.mockReset();
});

/** El modelo ubica el grupo 28 de R1 en el bloque no corriente y lo rotula por ese plazo. */
function r1ComoNoCorriente(pp: PreprocessedBalance, rotulo28: string): NiifReportJson {
  const json = esfQueSigueElPrompt(pp);
  json.balanceSheet.liabilities = [
    det('21', 'Obligaciones financieras', 45, 40),
    det('22', 'Proveedores', 25, 30),
    sub('Total pasivo corriente', 70, 70),
    det('28', rotulo28, 5, null),
    linea(null, 'Total pasivo no corriente', M(5), null, { level: 3, isAbsolute: true }),
  ];
  return json;
}

describe('realignEsfTermsFromSnapshot — el rótulo sigue al plazo', () => {
  it('un rótulo que nombra el plazo equivocado no acompaña al grupo al otro bloque', () => {
    const pp = preprocesarR1();
    const r = realignEsfTermsFromSnapshot(r1ComoNoCorriente(pp, 'Otros pasivos no corrientes'), pp.primary, pp.comparative);
    expect(r.replaced).toEqual(['Pasivo']);
    const l28 = r.json.balanceSheet.liabilities.find((l) => l.account === '28')!;
    expect(l28.label).not.toMatch(/no corriente/i);
    expect(l28.label).toBe('Otros pasivos');
    // Sigue en el bloque corriente que cierra "Total pasivo corriente".
    const labels = r.json.balanceSheet.liabilities.map((l) => l.label);
    expect(labels.indexOf(l28.label)).toBeLessThan(labels.indexOf('Total pasivo corriente'));
  });

  it('en inglés también ("Other non-current liabilities" no pasa al bloque corriente)', () => {
    const pp = preprocesarR1();
    const r = realignEsfTermsFromSnapshot(r1ComoNoCorriente(pp, 'Other non-current liabilities'), pp.primary, pp.comparative);
    expect(r.json.balanceSheet.liabilities.find((l) => l.account === '28')!.label).toBe('Otros pasivos');
  });

  it('un rótulo sin plazo se conserva aunque el grupo cambie de bloque', () => {
    const pp = preprocesarR1();
    const rotulo = 'Otros pasivos — saldo acreedor reclasificado de la cuenta 133005';
    const r = realignEsfTermsFromSnapshot(r1ComoNoCorriente(pp, rotulo), pp.primary, pp.comparative);
    expect(r.json.balanceSheet.liabilities.find((l) => l.account === '28')!.label).toBe(rotulo);
  });

  it('un grupo que el modelo presentó en los dos bloques conserva el rótulo de cada bloque', () => {
    // 210510 (pagaré a 3 años) declarado no corriente: el grupo 21 queda partido.
    const csv = CSV_R1.replace('110505,Caja general,Auxiliar,1,30000000,10000000', '110505,Caja general,Auxiliar,1,30000000,15000000')
      .replace('220505,', '210510,Pagare a 3 anos,Auxiliar,1,0,5000000\n220505,');
    const { rows } = aplicarVencimientosDeclarados(parseTrialBalanceCSVWithMeta(csv).rows, { '210510': 'no_corriente' });
    const pp = preprocessTrialBalance(rows);
    expect(pp.primary.controlTotals.pasivoCorriente).toBe(75_000_000);
    expect(pp.primary.controlTotals.pasivoNoCorriente).toBe(5_000_000);
    const json = informeHonesto(pp);
    json.balanceSheet.liabilities = [
      det('21', 'Obligaciones financieras de corto plazo', 45, 40),
      det('22', 'Proveedores', 25, 30),
      sub('Total pasivo corriente', 70, 70),
      det('21', 'Obligaciones financieras de largo plazo', 5, 0),
      det('28', 'Otros pasivos', 5, null),
      linea(null, 'Total pasivo no corriente', M(10), M(0), { level: 3, isAbsolute: true }),
    ];
    const r = realignEsfTermsFromSnapshot(json, pp.primary, pp.comparative);
    expect(r.replaced).toEqual(['Pasivo']);
    expect(r.json.balanceSheet.liabilities.map((l) => [l.account, l.label, l.amountPrimary])).toEqual([
      ['21', 'Obligaciones financieras de corto plazo', M(45)],
      ['22', 'Proveedores', M(25)],
      ['28', 'Otros pasivos', M(5)],
      [null, 'Total pasivo corriente', M(75)],
      ['21', 'Obligaciones financieras de largo plazo', M(5)],
      [null, 'Total pasivo no corriente', M(5)],
    ]);
  });
});

describe('ruta real — runNiifPhase', () => {
  it('el renglón 28 de R1 que el modelo rotuló "no corrientes" sale bajo el pasivo corriente sin ese rótulo', async () => {
    const pp = preprocesarR1();
    mockPasses(r1ComoNoCorriente(pp, 'Otros pasivos no corrientes'));
    const phase = await runNiifPhase(
      {
        rawData: CSV_R1,
        company: { name: 'Demo Perdidas SAS', nit: '900123456-8', entityType: 'SAS', fiscalPeriod: '2025', niifGroup: 2 },
        language: 'es',
      },
      { preprocessed: pp },
    );
    expect(phase.niif.reconciliation?.clean).toBe(true);
    const pasivo = phase.niif.json!.balanceSheet.liabilities;
    expect(pasivo.map((l) => [l.account, l.label, l.amountPrimary])).toEqual([
      ['21', 'Obligaciones financieras', M(45)],
      ['22', 'Proveedores', M(25)],
      ['28', 'Otros pasivos', M(5)],
      [null, 'Total pasivo corriente', M(75)],
    ]);
    expect(phase.niif.balanceSheet).not.toMatch(/Otros pasivos no corrientes/);
  });
});
