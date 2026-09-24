// ---------------------------------------------------------------------------
// Superficies de exportación: ningún renglón del LLM lleva a PDF, Excel o
// Markdown una cifra distinta de la determinista (re-auditoría 2026-09-24)
// ---------------------------------------------------------------------------
// e2e-niif-01: un renglón "UTILIDAD NETA DEL PERÍODO" por +$40.000.000 SUSTITUÍA
//   el total anclado (pérdida de −$40.000.000) en los tres entregables.
// e2e-niif-09: rótulos del ECP fechados en 2023 y "13 — Inventarios de
//   mercancía" llegaban tal cual al PDF y al Excel.
// e2e-niif-12: el gate de exportación comparaba subtotales del ESF en valor
//   absoluto.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';

import {
  clonar,
  informeExportable,
  informeHonesto,
  linea,
  preprocesarPerdidaComparativo,
} from '@/lib/agents/financial/__fixtures__/perdida-comparativo-w4a';
import { generateFinancialExcel } from '../excel-export';
import { financialExportBlockers, niifArithmeticBlockers } from '../financial-export-validation';
import {
  niifJsonToBalanceTable,
  niifJsonToEquityTable,
  niifJsonToIncomeTable,
} from '../pdf-elite-react/compose-statements-from-json';
import { renderIncomeStatement } from '@/lib/agents/financial/agents/renderer';
import type { FinancialReport } from '@/lib/agents/financial/types';
import type { NiifReportJson } from '@/lib/agents/financial/contracts/niif-report';

const pp = preprocesarPerdidaComparativo();

async function hojas(report: FinancialReport, preprocessed = pp) {
  const buf = await generateFinancialExcel({ report, preprocessed });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as never);
  return wb;
}

/** [rótulo, periodo actual, comparativo]: col3 actual, col4 comparativo (reportes-export-20). */
function filas(ws: ExcelJS.Worksheet): Array<[string, unknown, unknown]> {
  const out: Array<[string, unknown, unknown]> = [];
  ws.eachRow((row) => {
    const label = row.getCell(2).value;
    if (typeof label === 'string') out.push([label, row.getCell(3).value, row.getCell(4).value]);
  });
  return out;
}

/** A7: el analista añade "UTILIDAD NETA DEL PERÍODO" +$40M sobre una pérdida de −$40M. */
function conUtilidadFalsa(): NiifReportJson {
  const j = clonar(informeHonesto(pp));
  j.incomeStatement.lines.push(linea(null, 'UTILIDAD NETA DEL PERÍODO', '4000000000', '3000000000', { level: 3 }));
  return j;
}

describe('e2e-niif-01 — los totales del ERI salen siempre de los campos anclados', () => {
  it('PDF: imprime PÉRDIDA NETA ($40.000.000,00) y ningún renglón de utilidad por $40M', () => {
    const t = niifJsonToIncomeTable(conUtilidadFalsa());
    const rows = t.rows.map((r) => [r.account, ...r.cells]);
    expect(rows).toContainEqual(['PÉRDIDA NETA DEL PERÍODO', '($40.000.000,00)', '($30.000.000,00)']);
    expect(rows.some(([label]) => /UTILIDAD NETA/.test(String(label)))).toBe(false);
    expect(rows.filter(([label]) => /NETA DEL PER/.test(String(label)))).toHaveLength(1);
  });

  it('Excel: la hoja Estado Resultados no contiene el +$40M del analista', async () => {
    const wb = await hojas(informeExportable(conUtilidadFalsa()));
    const rows = filas(wb.getWorksheet('Estado Resultados')!);
    expect(rows).toContainEqual(['PÉRDIDA NETA DEL PERÍODO', -40_000_000, -30_000_000]);
    // (El grupo 51 suma legítimamente $40M; lo que no puede existir es un
    // resultado neto positivo.)
    expect(rows.some(([label]) => /UTILIDAD NETA/.test(label))).toBe(false);
    expect(rows.filter(([label]) => /NETA DEL PER/.test(label))).toHaveLength(1);
  });

  it('Markdown: la misma fila anclada, sin la utilidad del analista', () => {
    const md = renderIncomeStatement(conUtilidadFalsa());
    expect(md).toContain('| **PÉRDIDA NETA DEL PERÍODO** | **($40.000.000,00)** | **($30.000.000,00)** |');
    expect(md).not.toMatch(/UTILIDAD NETA DEL PER[IÍ]ODO/);
  });

  it('el gate de exportación bloquea el informe (E22)', () => {
    const b = financialExportBlockers(informeExportable(conUtilidadFalsa()), pp);
    expect(b.some((m) => m.startsWith('E22.'))).toBe(true);
  });
});

describe('gate de exportación con el balance de la petición', () => {
  it('el informe honesto se exporta sin bloqueos', () => {
    expect(financialExportBlockers(informeExportable(informeHonesto(pp)), pp)).toEqual([]);
  });

  it('A1 (13 → 15, total igual) se declara fuente incoherente (E21)', () => {
    const j = clonar(informeHonesto(pp));
    const l13 = j.balanceSheet.assets.find((l) => l.account === '13')!;
    const l15 = j.balanceSheet.assets.find((l) => l.account === '15')!;
    l13.amountPrimary = (BigInt(l13.amountPrimary) - BigInt(100_000_000)).toString();
    l15.amountPrimary = (BigInt(l15.amountPrimary) + BigInt(100_000_000)).toString();
    const b = financialExportBlockers(informeExportable(j), pp);
    expect(b.some((m) => m.startsWith('Fuentes incoherentes'))).toBe(true);
    expect(b.filter((m) => m.startsWith('E21.'))).toHaveLength(2);
  });

  it('e2e-niif-12: un subtotal del ESF con el signo invertido bloquea (comparación con signo)', () => {
    const j = clonar(informeHonesto(pp));
    const eq = j.balanceSheet.equity;
    const i36 = eq.findIndex((l) => l.account === '36');
    eq.splice(i36 + 1, 0, linea(null, 'Resultado neto del período', '4000000000', '3000000000', { level: 3 }));
    const b = niifArithmeticBlockers(j);
    expect(b.some((m) => m.startsWith('Balance 2025: el subtotal "Resultado neto del período"'))).toBe(true);
    expect(b.some((m) => m.startsWith('Balance 2024: el subtotal "Resultado neto del período"'))).toBe(true);
  });

  it('comparativo de saldos de apertura: P&G comparativo N/D no bloquea (E9 + proyección sólo del ESF)', () => {
    const apertura = preprocesarPerdidaComparativo();
    apertura.comparative!.saldosDeApertura = true;
    const j = clonar(informeHonesto(apertura));
    j.incomeStatement.grossProfitComparative = null;
    j.incomeStatement.operatingProfitComparative = null;
    j.incomeStatement.netIncomeComparative = null;
    j.incomeStatement.oriComparative = null;
    for (const l of j.incomeStatement.lines) l.amountComparative = null;
    expect(niifArithmeticBlockers(j, { preprocessed: apertura })).toEqual([]);
    // Sin la marca de apertura, E9 exige el P&G comparativo.
    expect(niifArithmeticBlockers(j, { preprocessed: pp }).some((m) => m.startsWith('E9.'))).toBe(true);
  });
});

describe('e2e-niif-09 — rótulos deterministas en PDF, Excel y Markdown', () => {
  function conRotulosFalsos(): NiifReportJson {
    const j = clonar(informeHonesto(pp));
    j.balanceSheet.assets.find((l) => l.account === '13')!.label = 'Inventarios de mercancía';
    j.equityChanges.rows[0].label = 'Saldo al 1 de enero de 2023';
    j.equityChanges.rows[j.equityChanges.rows.length - 1].label = 'Saldo al 31 de diciembre de 2023';
    j.equityChanges.rows.find((r) => r.kind === 'profit_for_period')!.label =
      'Utilidad neta del ejercicio 2025 (ganancia)';
    return j;
  }

  it('PDF: el grupo 13 lleva su rótulo PUC y el ECP el periodo del informe', () => {
    const j = conRotulosFalsos();
    const esf = niifJsonToBalanceTable(j).rows.map((r) => r.account);
    expect(esf).toContain('13 — Deudores comerciales y otras cuentas por cobrar');
    expect(esf.some((a) => /Inventarios de mercanc/.test(a))).toBe(false);
    const ecp = niifJsonToEquityTable(j, { primaryPeriodoTipo: 'cerrado' }).rows.map((r) => r.account);
    expect(ecp).toEqual([
      'Saldo al 1 de enero de 2025',
      'Traslado del resultado 2024 a resultados acumulados',
      'Pérdida del ejercicio 2025',
      'Saldo al 31 de diciembre de 2025',
    ]);
    // Sin tipo de periodo identificado no se afirma el 1-ene / 31-dic.
    expect(niifJsonToEquityTable(j).rows[0].account).toBe('Saldo al inicio del periodo 2025');
  });

  it('Excel: ningún rótulo del ECP ni del ESF conserva 2023 ni "ganancia"', async () => {
    const wb = await hojas(informeExportable(conRotulosFalsos()));
    const textos: string[] = [];
    for (const name of ['Balance NIIF', 'Cambios en Patrimonio']) {
      wb.getWorksheet(name)!.eachRow((row) => {
        row.eachCell((c) => {
          if (typeof c.value === 'string') textos.push(c.value);
        });
      });
    }
    const todo = textos.join('\n');
    expect(todo).not.toMatch(/2023/);
    expect(todo).not.toMatch(/ganancia/i);
    expect(todo).not.toMatch(/Inventarios de mercanc/);
    expect(todo).toContain('Pérdida del ejercicio 2025');
  });

  it('un rótulo del analista que sí nombra su grupo se conserva', () => {
    const j = clonar(informeHonesto(pp));
    j.balanceSheet.equity.find((l) => l.account === '37')!.label = 'Pérdidas acumuladas';
    expect(niifJsonToBalanceTable(j).rows.map((r) => r.account)).toContain('37 — Pérdidas acumuladas');
  });
});
