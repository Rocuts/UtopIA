// NM-13 (re-auditoría normativa-metricas, 2026-09-24) — textos residuales de la
// «TMT sobre utilidad contable» y rótulos F01/F09 que presentan la UAI como
// base del impuesto.
//   · Art. 240 par. 6 E.T. (texto del corpus, estatuto_tributario_completo.md):
//     la Tasa de Tributación Depurada es TTD = ID / UD; si es < 15 % se liquida
//     el Impuesto a Adicionar IA = UD × 15 % − ID. No es «tomar el mayor» entre
//     35 % de la renta líquida y 15 % de la utilidad contable.
//   · Sin ID/UD verificados la TTD es N/D; la UAI contable no es base fiscal.
//   · F09 del Âncora Fiscal = gasto de renta (grupo 54) / UAI: tasa efectiva
//     CONTABLE, no «carga sobre utilidad neta» ni la TTD.
import { describe, expect, it } from 'vitest';

import {
  auditReportEmittable,
  reportIncluyeTMTCalculada,
  type AuditCompanyContext,
} from '@/lib/pillars/audit-report-emittable';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import { dict } from '@/lib/i18n/dictionaries';
import { buildFiscalAnchorBlockMarkdown } from '@/lib/agents/financial/escudo-survival/fiscal-anchor/block-builder';
import { buildFiscalAnchor } from '@/lib/agents/financial/escudo-survival/fiscal-anchor';
import { buildCcvFiscalPrompt } from '@/lib/agents/financial/escudo-survival/fiscal-agent/prompts/ccv-fiscal.prompt';
import { buildMotorNormativoPrompt } from '@/lib/agents/financial/escudo-survival/normative/prompts/motor-normativo.prompt';
import type { FinancialReport } from '@/lib/agents/financial/types';

const CSV = [
  'codigo,nombre,nivel,transaccional,Saldo 2025',
  '110505,Caja,Auxiliar,1,150000000',
  '240405,Impuesto de renta,Auxiliar,1,35000000',
  '310505,Capital,Auxiliar,1,50000000',
  '413550,Ventas,Auxiliar,1,300000000',
  '510506,Sueldos,Auxiliar,1,200000000',
  '540505,Impuesto de renta y complementarios,Auxiliar,1,35000000',
].join('\n');

const COMPANY: AuditCompanyContext = {
  razonSocialFromFile: null,
  nitFromFile: null,
  nit: null,
  niifGroup: 2,
  tipoSocietario: 'SAS',
};

function report(text: string): FinancialReport {
  return {
    company: { name: 'Demo SAS', nit: '900123456-7', entityType: 'SAS', fiscalPeriod: '2025', niifGroup: 2 },
    niifAnalysis: { balanceSheet: '', incomeStatement: '', cashFlowStatement: '', equityChangesStatement: '', technicalNotes: '', fullContent: '' },
    strategicAnalysis: { kpiDashboard: '', breakEvenAnalysis: '', projectedCashFlow: '', strategicRecommendations: '', fullContent: '' },
    governance: { financialNotes: '', shareholderMinutes: '', fullContent: '' },
    consolidatedReport: text,
    generatedAt: '2026-09-24T00:00:00.000Z',
  } as FinancialReport;
}

describe('NM-13 — gate V10 con la regla TTD = ID/UD', () => {
  const snap = preprocessTrialBalance(parseTrialBalanceCSV(CSV)).primary;

  it('el mensaje de V10 describe la TTD (ID/UD, impuesto a adicionar, N/D sin base) y no «tomar el mayor» sobre utilidad contable', () => {
    const r = auditReportEmittable(report('# Informe sin mención tributaria'), snap, COMPANY);
    const v10 = r.blockers.find((b) => b.code === 'V10');
    expect(v10).toBeDefined();
    expect(v10!.message).not.toMatch(/tomar el mayor/i);
    expect(v10!.message).not.toMatch(/utilidad contable depurada/i);
    expect(v10!.message).not.toMatch(/\bTMT\b/);
    expect(v10!.message).toContain('TTD = ID / UD');
    expect(v10!.message).toMatch(/N\/D/);
    expect(v10!.message).toMatch(/no es base fiscal/i);
  });

  it('un informe que declara la TTD con la terminología canónica no se bloquea por V10', () => {
    for (const texto of [
      'Tasa de Tributación Depurada (TTD, Art. 240 par. 6 E.T.): N/D sin ID/UD verificados.',
      'TTD (parágrafo 6 del art. 240 E.T.): N/D sin ID/UD verificados.',
      'La tasa mínima de tributación del Art. 240 parágrafo 6 no se calcula sin impuesto depurado.',
    ]) {
      expect(reportIncluyeTMTCalculada(texto)).toBe(true);
      const r = auditReportEmittable(report(texto), snap, COMPANY);
      expect(r.blockers.some((b) => b.code === 'V10')).toBe(false);
    }
    expect(reportIncluyeTMTCalculada('Informe sin tributación.')).toBe(false);
  });
});

describe('NM-13 — rótulos F01/F09 del Âncora Fiscal (es/en)', () => {
  it('F01 es la UAI contable, no la base del impuesto', () => {
    expect(dict.es.elite.areas.escudo.fiscalAnchor.f01.description).not.toMatch(/Base del impuesto/i);
    expect(dict.es.elite.areas.escudo.fiscalAnchor.f01.description).toMatch(/no es base fiscal/i);
    expect(dict.en.elite.areas.escudo.fiscalAnchor.f01.description).not.toMatch(/Income tax base/i);
    expect(dict.en.elite.areas.escudo.fiscalAnchor.f01.description).toMatch(/not the tax base/i);
  });

  it('F09 es la tasa efectiva contable (grupo 54 / UAI) en tarjeta, bloque de contexto y CCV', () => {
    const es = dict.es.elite.areas.escudo;
    const en = dict.en.elite.areas.escudo;
    for (const s of [es.fiscalAnchor.f09.title, es.autowire.contextBlock.f09, es.fiscalAgent.cards.ccv.f09]) {
      expect(s).toMatch(/tasa efectiva contable/i);
      expect(s).not.toMatch(/Utilidad Neta|Carga sobre/i);
    }
    for (const s of [en.fiscalAnchor.f09.title, en.autowire.contextBlock.f09, en.fiscalAgent.cards.ccv.f09]) {
      expect(s).toMatch(/accounting effective tax rate/i);
      expect(s).not.toMatch(/Net Income|Tax Burden/i);
    }
    expect(es.fiscalAnchor.f09.description).toMatch(/no es la TTD/i);
    expect(en.fiscalAnchor.f09.description).toMatch(/not the TTD/i);
  });

  it('el motivo de score no determinable no llama «base gravable» a F01 (UAI contable)', () => {
    const es = dict.es.elite.dataStatus.escudo.riskNotDeterminableReason;
    const en = dict.en.elite.dataStatus.escudo.riskNotDeterminableReason;
    expect(es).not.toMatch(/base gravable/i);
    expect(en).not.toMatch(/taxable base/i);
    expect(es).toMatch(/UAI/);
  });

  it('las filas F06/F07 del CCV en inglés rotulan las mismas cuentas que en español (2365 / 2368)', () => {
    const en = dict.en.elite.areas.escudo.fiscalAgent.cards.ccv;
    expect(en.f06).toMatch(/withholding/i);
    expect(en.f07).toMatch(/ICA withheld/i);
    expect(en.f07).not.toMatch(/Property|Vehicles/i);
  });

  it('el rótulo de la alerta de tasa mínima nombra la TTD del Art. 240 par. 6', () => {
    expect(dict.es.elite.areas.escudo.fiscalAgent.cards.ccv.alertaTasaMinima).toMatch(/Tributación Depurada.*Art\. 240 par\. 6/);
    expect(dict.en.elite.areas.escudo.fiscalAgent.cards.ccv.alertaTasaMinima).toMatch(/TTD.*Art\. 240 par\. 6/);
  });

  it('el bloque markdown del Âncora rotula F09 como tasa efectiva contable, no la TTD', () => {
    const pp = preprocessTrialBalance(parseTrialBalanceCSV(CSV));
    const fa = buildFiscalAnchor({ preprocessed: pp, company: { name: 'Demo', nit: '900123456-7' }, hoy: new Date('2026-09-24') });
    const md = buildFiscalAnchorBlockMarkdown(fa);
    const f09 = md.split('\n').find((l) => l.includes('F09'))!;
    expect(f09).toMatch(/tasa efectiva contable/i);
    expect(f09).toMatch(/no es la TTD/i);
  });

  it('el Motor Normativo describe la TTD como ID / UD con impuesto a adicionar y N/D sin base', () => {
    const m = buildMotorNormativoPrompt({ language: 'es' });
    expect(m).not.toContain('TTD mínima: 15% sobre utilidad depurada');
    expect(m).toContain('TTD = ID / UD');
    expect(m).toContain('IA = UD × 15% − ID');
  });

  it('el prompt del CCV no pide cuantificar un impuesto adicional sin ID/UD', () => {
    const p = buildCcvFiscalPrompt('es');
    expect(p).not.toMatch(/cuantificando el impuesto adicional estimado/);
    expect(p).toMatch(/ID\/UD/);
  });
});
