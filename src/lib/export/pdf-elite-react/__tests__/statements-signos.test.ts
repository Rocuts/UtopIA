// Regresiones de la auditoría de exportes 2026-09 sobre los estados del PDF
// Élite (compose-statements-from-json.ts):
//   reportes-export-01 — totales impresos en valor absoluto (pérdida y
//                        patrimonio negativo salían positivos).
//   reportes-export-17 — correctoras (1592) en positivo: la columna no suma.
//   reportes-export-15 — ERI "Integral" sin ORI ni resultado integral total.
//   reportes-export-13 — EFE/ECP sin comparativo y sin leyenda.
//   reportes-export-14 — sin fecha de corte / periodo cubierto / moneda.
import { describe, expect, it } from 'vitest';
import { makeCoherentNiifReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import type { NiifReportJson } from '@/lib/agents/financial/contracts/niif-report';
import {
  niifJsonToBalanceTable,
  niifJsonToCashFlowTable,
  niifJsonToEquityTable,
  niifJsonToIncomeTable,
} from '../compose-statements-from-json';
import { composeEditorialReport } from '../compose';
import { makeExportableReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import { validateNiifReportJson } from '@/lib/agents/financial/validators/niif-json-validator';

const line = (account: string | null, amountPrimary: string, extra: Partial<NiifReportJson['balanceSheet']['assets'][number]> = {}) => ({
  account, label: account ?? 'Ajuste', amountPrimary, amountComparative: null,
  level: 2 as const, isAbsolute: false, confidence: null, anomalyFlag: null, ...extra,
});

/** Pérdida neta de $2.000,00 y patrimonio negativo de ($1.000,00), coherente. */
function lossReport(): NiifReportJson {
  const json = makeCoherentNiifReport();
  json.balanceSheet.assets = [line('11', '170000'), line('13', '430000')];
  json.balanceSheet.liabilities = [line('22', '700000')];
  json.balanceSheet.equity = [line('31', '300000'), line('37', '-400000')];
  Object.assign(json.balanceSheet, {
    totalAssetsPrimary: '600000', totalLiabilitiesPrimary: '700000', totalEquityPrimary: '-100000',
  });
  json.incomeStatement.lines = [line('4', '100000'), line('6', '150000'), line('51', '100000'), line('53', '50000')];
  Object.assign(json.incomeStatement, {
    grossProfitPrimary: '-50000', operatingProfitPrimary: '-150000', netIncomePrimary: '-200000',
  });
  json.cashFlow.sections[0].lines = [line(null, '-200000'), line(null, '350000')];
  json.equityChanges.rows = [
    { ...json.equityChanges.rows[0], resultadosAcumulados: '-200000', reservaLegal: '0', total: '100000' },
    { ...json.equityChanges.rows[1], reservaLegal: '0', resultadosAcumulados: '-200000', resultadoEjercicio: '-200000', total: '-100000' },
  ];
  return json;
}

describe('reportes-export-01 — totales con signo en el PDF', () => {
  it('el fixture con pérdida y patrimonio negativo es coherente para el validador', () => {
    const v = validateNiifReportJson(lossReport());
    expect(v.errors).toEqual([]);
  });

  it('pérdida neta, EBIT y utilidad bruta negativos se imprimen entre paréntesis y rotulados PÉRDIDA', () => {
    const t = niifJsonToIncomeTable(lossReport());
    const byLabel = (l: string) => t.rows.find((r) => r.account === l);
    expect(byLabel('PÉRDIDA NETA DEL PERÍODO')?.cells[0]).toBe('($2.000,00)');
    expect(byLabel('PÉRDIDA OPERATIVA (EBIT)')?.cells[0]).toBe('($1.500,00)');
    expect(byLabel('PÉRDIDA BRUTA')?.cells[0]).toBe('($500,00)');
    expect(byLabel('UTILIDAD NETA DEL PERÍODO')).toBeUndefined();
  });

  it('patrimonio negativo y trailer A = P + C conservan el signo', () => {
    const t = niifJsonToBalanceTable(lossReport());
    expect(t.rows.find((r) => r.account === 'TOTAL PATRIMONIO')?.cells[0]).toBe('($1.000,00)');
    expect(t.rows.find((r) => r.account === '+ Patrimonio')?.cells[0]).toBe('($1.000,00)');
    expect(t.rows.find((r) => r.account === '= Pasivo')?.cells[0]).toBe('$7.000,00');
    expect(t.rows.find((r) => r.account.startsWith('✅'))?.cells[0]).toBe('$6.000,00');
    // Renglón de detalle negativo (pérdidas acumuladas) también con signo.
    expect(t.rows.find((r) => r.account.startsWith('37'))?.cells[0]).toBe('($4.000,00)');
  });

  it('no duplica el total cuando el analista ya emitió la fila con el rótulo de pérdida', () => {
    const json = lossReport();
    json.incomeStatement.lines.push({ ...line(null, '-200000'), label: 'PÉRDIDA NETA DEL PERÍODO', level: 4 });
    const t = niifJsonToIncomeTable(json);
    expect(t.rows.filter((r) => /NETA DEL PERÍODO/.test(r.account))).toHaveLength(1);
  });
});

describe('reportes-export-17 — correctoras restan en la columna impresa', () => {
  it('1592 con isAbsolute se imprime ($x) y la columna suma el TOTAL ACTIVOS', () => {
    const json = makeCoherentNiifReport();
    json.balanceSheet.assets = [
      line('11', '170000'),
      line('1524', '1000000', { isAbsolute: true }),
      line('1592', '200000', { isAbsolute: true }),
      line('13', '30000'),
    ];
    Object.assign(json.balanceSheet, { totalAssetsPrimary: '1000000' });
    const t = niifJsonToBalanceTable(json);
    const dep = t.rows.find((r) => r.account.startsWith('1592'));
    expect(dep?.cells[0]).toBe('($2.000,00)');
  });
});

describe('reportes-export-15 — ERI integral con ORI y resultado integral total', () => {
  it('añade OTRO RESULTADO INTEGRAL y RESULTADO INTEGRAL TOTAL (neto + ORI)', () => {
    const json = makeCoherentNiifReport();
    json.incomeStatement.oriPrimary = '50000';
    const t = niifJsonToIncomeTable(json);
    expect(t.rows.find((r) => r.account === 'OTRO RESULTADO INTEGRAL')?.cells[0]).toBe('$500,00');
    expect(t.rows.find((r) => r.account === 'RESULTADO INTEGRAL TOTAL')?.cells[0]).toBe('$2.500,00');
  });

  it('no duplica el total integral si el analista ya lo emitió con otro sufijo', () => {
    const json = makeCoherentNiifReport();
    json.incomeStatement.lines.push({ ...line(null, '200000'), label: 'RESULTADO INTEGRAL TOTAL DEL PERIODO', level: 4 });
    const t = niifJsonToIncomeTable(json);
    expect(t.rows.filter((r) => r.account.toUpperCase().startsWith('RESULTADO INTEGRAL TOTAL'))).toHaveLength(1);
  });
});

describe('reportes-export-13 / -14 — leyendas de comparativo, fecha y moneda', () => {
  const comparative = (): NiifReportJson => {
    const json = makeCoherentNiifReport();
    json.company.comparativePeriod = '2024';
    return json;
  };

  it('EFE y ECP declaran que el comparativo no se presenta', () => {
    const cf = niifJsonToCashFlowTable(comparative());
    const ec = niifJsonToEquityTable(comparative());
    expect(cf.legends?.join(' ')).toMatch(/comparativa 2024 no presentada/);
    expect(ec.legends?.join(' ')).toMatch(/comparativa 2024 no presentada/);
    expect(niifJsonToCashFlowTable(makeCoherentNiifReport()).legends ?? []).toEqual([]);
  });

  it('periodo cerrado: "Al 31 de diciembre" en el ESF y "Por el año terminado" en ERI/EFE/ECP, más la moneda', () => {
    const ctx = { primaryPeriodoTipo: 'cerrado' as const };
    const json = makeCoherentNiifReport();
    expect(niifJsonToBalanceTable(json, ctx).subtitle).toBe('Al 31 de diciembre de 2025');
    expect(niifJsonToIncomeTable(json, ctx).subtitle).toBe('Por el año terminado el 31 de diciembre de 2025');
    expect(niifJsonToCashFlowTable(json, ctx).subtitle).toBe('Por el año terminado el 31 de diciembre de 2025');
    expect(niifJsonToEquityTable(json, ctx).subtitle).toBe('Por el año terminado el 31 de diciembre de 2025');
    expect(niifJsonToBalanceTable(json, ctx).currencyNote).toMatch(/pesos colombianos \(COP\)/);
  });

  it('sin tipo de periodo confirmado no supone el 31 de diciembre', () => {
    const t = niifJsonToBalanceTable(makeCoherentNiifReport());
    expect(t.subtitle).toMatch(/fecha de corte no identificada/);
    expect(t.subtitle).not.toMatch(/31 de diciembre/);
  });

  it('compose propaga el tipo de periodo del preprocesado y las notas estructuradas del JSON', () => {
    const report = makeExportableReport();
    report.niifAnalysis.json!.balanceSheet.notes = [{ ref: 'Nota 3', norma: 'NIIF PYMES Secc. 17', body: 'PPE al costo.' }];
    report.niifAnalysis.json!.technicalNotes = [{ ref: null, norma: null, body: 'Mapeo PUC → NIIF.' }];
    const pre = { primary: { period: '2025', periodoTipo: 'cerrado', controlTotals: null } } as never;
    const doc = composeEditorialReport({ report, preprocessed: pre, pillars: null, language: 'es' });
    expect(doc.statements.balance.subtitle).toBe('Al 31 de diciembre de 2025');
    expect(doc.statements.balance.footnotes).toEqual(['Nota 3 — PPE al costo. (NIIF PYMES Secc. 17)']);
    expect(doc.notes.blocks.some((b) => b.bodyMarkdown.includes('Mapeo PUC → NIIF.'))).toBe(true);
  });
});
