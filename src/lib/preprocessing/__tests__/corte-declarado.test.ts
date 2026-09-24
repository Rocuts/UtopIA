// ---------------------------------------------------------------------------
// P4 (c) — pendiente #4 de la auditoría integral 2026-09-24 y
// niif-preproceso-29: etiquetas de sólo año en cortes parciales.
//
// Una columna "Saldo 2025" se trata como 12 meses por convención de cierre
// anual; IW2 publicó así un corte a junio (ROE y días de medio año como
// anuales). Si el archivo declara la fecha de corte en su título ("a junio 30
// de 2025", "De Enero 2025 a Diciembre 2025", "Corte: 30/06/2025") el
// preprocesador deriva los meses; si no, conserva el supuesto anual y lo
// revela en la nota de base de los KPIs. Un corte anual declarado deja el
// periodo 'cerrado' (la nota OBLIGATORIA de R8 se emite).
// ---------------------------------------------------------------------------
import path from 'node:path';

import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { xlsxRowToCsvLine } from '@/lib/upload/xlsx-csv';

import { parseUploadedTrialBalanceText, preprocessUploadedTrialBalanceText } from '../raw-data';
import { parseTrialBalanceCSVWithMeta, preprocessTrialBalance } from '../trial-balance';

// A 1.000.000 = P 400.000 + K 500.000 + resultado 100.000 (sin 3605: R8 actúa).
const CUERPO = [
  'codigo,nombre,nivel,Saldo 2025',
  '110505,Caja,Auxiliar,300000',
  '130505,Clientes,Auxiliar,200000',
  '152405,Equipo,Auxiliar,500000',
  '220505,Proveedores,Auxiliar,400000',
  '310505,Capital,Auxiliar,500000',
  '413505,Ventas,Auxiliar,600000',
  '613505,Costo de ventas,Auxiliar,300000',
  '510506,Sueldos,Auxiliar,200000',
];
const conTitulo = (...titulo: string[]) => [...titulo, ...CUERPO].join('\n');
const pp = (csv: string) => preprocessTrialBalance(parseTrialBalanceCSVWithMeta(csv).rows);

describe('P4 (c) — fecha de corte declarada en el título', () => {
  it('"a junio 30 de 2025": la columna del año pasa a 2025-06 (6 meses), KPIs anualizados y nota visible', () => {
    const meta = parseTrialBalanceCSVWithMeta(
      conTitulo('EMPRESA PRUEBA SAS,,,', 'Balance de prueba a junio 30 de 2025,,,'),
    );
    expect(meta.corteDeclarado).toMatchObject({ year: '2025', month: 6 });
    expect(meta.balanceColumns.map((c) => c.period)).toEqual(['2025-06']);
    const s = preprocessTrialBalance(meta.rows).primary;
    expect(s.period).toBe('2025-06');
    expect(s.periodoTipo).toBe('parcial');
    expect(s.corteDeclarado).toEqual({ tipo: 'parcial', meses: 6, texto: 'Balance de prueba a junio 30 de 2025' });
    expect(s.controlTotals.mesesPeriodo).toBe(6);
    expect(s.controlTotals.kpiBaseNota).toMatch(/P&G de 6 meses \(corte declarado en el archivo/);
    expect(s.controlTotals.kpiBaseNota).toMatch(/anualizados × 12\/6/);
    expect(s.validation.adjustments.some((a) => /se trata como corte 2025-06/.test(a))).toBe(true);
    // R12/R8: un corte parcial no es un error de cierre.
    expect(s.findings?.librosNoCerrados).toBe(false);
    expect(s.virtualCloseAdjustment?.justification).toMatch(/NOTA EXPLICATIVA/);
  });

  it('niif-preproceso-29: "De Enero 2025 a Diciembre 2025" deja el periodo cerrado y R8 emite la nota OBLIGATORIA', () => {
    const s = pp(conTitulo('GRUPO EMPRESARIAL SAS,,,', 'De Enero 2025 a Diciembre 2025,De Enero 2025 a Diciembre 2025,,')).primary;
    expect(s.period).toBe('2025');
    expect(s.periodoTipo).toBe('cerrado');
    // La celda combinada repetida no se duplica en el texto citado.
    expect(s.corteDeclarado).toEqual({ tipo: 'cerrado', meses: 12, texto: 'De Enero 2025 a Diciembre 2025' });
    expect(s.virtualCloseAdjustment?.justification).toMatch(/NOTA OBLIGATORIA/);
    expect(s.controlTotals.kpiBaseNota).toMatch(/12 meses \(cierre anual\) \(corte declarado en el archivo/);
    expect(s.controlTotals.kpiBaseNota).not.toMatch(/SUPUESTO/);
  });

  it('sin fecha de corte declarada: se conserva el supuesto anual y la nota de base lo revela', () => {
    const s = pp(CUERPO.join('\n')).primary;
    expect(s.period).toBe('2025');
    expect(s.periodoTipo).toBe('indeterminado');
    expect(s.corteDeclarado).toBeUndefined();
    expect(s.controlTotals.mesesPeriodo).toBe(12);
    expect(s.controlTotals.kpiBaseNota).toMatch(/12 meses por SUPUESTO de cierre anual/);
    expect(s.controlTotals.kpiBaseNota).toMatch(/declare la fecha de corte/);
  });

  it('formatos numéricos y "al 30 de junio de 2025"', () => {
    for (const titulo of ['Corte: 30/06/2025', 'Fecha de corte 2025-06-30', 'Estado al 30 de junio de 2025']) {
      const s = pp(conTitulo(`${titulo},,,`)).primary;
      expect(s.period, titulo).toBe('2025-06');
      expect(s.controlTotals.mesesPeriodo, titulo).toBe(6);
    }
  });

  it('cortes que no determinan meses completos no se interpretan (queda el supuesto revelado)', () => {
    // A mitad de mes, un rango que no empieza en enero y dos meses distintos.
    for (const titulo of [
      'Balance a junio 15 de 2025',
      'De Julio 2024 a Junio 2025',
      'Balance a junio 30 de 2025 y a marzo 31 de 2025',
    ]) {
      const lineas = titulo.includes(' y a ')
        ? ['Balance a junio 30 de 2025,,,', 'Comparado a marzo 31 de 2025,,,']
        : [`${titulo},,,`];
      const s = pp(conTitulo(...lineas)).primary;
      expect(s.period, titulo).toBe('2025');
      expect(s.controlTotals.kpiBaseNota, titulo).toMatch(/SUPUESTO de cierre anual/);
    }
  });

  it('una columna con mes explícito o una etiqueta impuesta por el llamador no se re-rotula', () => {
    const csv = ['Balance a junio 30 de 2025,,,', 'codigo,nombre,nivel,Saldo [2025-03]', ...CUERPO.slice(1)].join('\n');
    expect(pp(csv).primary.period).toBe('2025-03');
    const conAnio = parseTrialBalanceCSVWithMeta(conTitulo('Balance a junio 30 de 2025,,,'), { forcePeriod: '2025' });
    expect(conAnio.balanceColumns.map((c) => c.period)).toEqual(['2025']);
  });

  it('comparativo: sólo se re-rotula la columna del año del corte', () => {
    const csv = [
      'Balance de prueba a junio 30 de 2025,,,,',
      'codigo,nombre,nivel,Saldo 2025,Saldo 2024',
      '110505,Caja,Auxiliar,300000,250000',
      '310505,Capital,Auxiliar,300000,250000',
    ].join('\n');
    const out = pp(csv);
    expect(out.periods.map((p) => p.period)).toEqual(['2024', '2025-06']);
  });

  it('XLSX: la hoja "Balance 2025" con título "a junio 30 de 2025" produce 2025-06 con la misma nota', () => {
    const hoja = ['Balance de prueba a junio 30 de 2025,,,', ...CUERPO].join('\n');
    const blocks = `[period=Balance 2025]\n${hoja}\n[/period]`;
    const parsed = parseUploadedTrialBalanceText(blocks);
    expect(Object.keys(parsed.rows[0].balancesByPeriod)).toEqual(['2025-06']);
    const read = preprocessUploadedTrialBalanceText(blocks);
    expect(read.kind).toBe('ok');
    if (read.kind !== 'ok') return;
    const s = read.preprocessed.primary;
    expect(s.period).toBe('2025-06');
    expect(s.corteDeclarado?.tipo).toBe('parcial');
    expect(s.controlTotals.kpiBaseNota).toMatch(/corte declarado en el archivo/);
    expect(s.validation.adjustments.some((a) => /Fecha de corte declarada/.test(a))).toBe(true);
  });

  it('XLSX: hoja "Balance 2025" con encabezado sin año: el corte del título decide el mes y deja la nota', () => {
    const hoja = [
      'Balance de prueba a junio 30 de 2025,,,',
      'codigo,nombre,nivel,saldo',
      ...CUERPO.slice(1),
    ].join('\n');
    const read = preprocessUploadedTrialBalanceText(`[period=Balance 2025]\n${hoja}\n[/period]`);
    expect(read.kind).toBe('ok');
    if (read.kind !== 'ok') return;
    const s = read.preprocessed.primary;
    expect(s.period).toBe('2025-06');
    expect(s.corteDeclarado).toEqual({ tipo: 'parcial', meses: 6, texto: 'Balance de prueba a junio 30 de 2025' });
    expect(s.validation.adjustments.some((a) => /hoja "Balance 2025"/.test(a))).toBe(true);
    expect(s.controlTotals.kpiBaseNota).toMatch(/corte declarado en el archivo/);
  });

  it('ingesta: un título con "Balance" y año antes del encabezado ya no le quita el periodo a la hoja', () => {
    // Antes `headerHasExplicitPeriodBalanceColumn` leía la PRIMERA línea como
    // encabezado: el título "Balance de prueba 2025" parecía una columna de
    // saldo con año y la hoja quedaba en el periodo genérico "current".
    const hoja = ['Balance de prueba 2025,,,', 'codigo,nombre,nivel,saldo', ...CUERPO.slice(1)].join('\n');
    const parsed = parseUploadedTrialBalanceText(`[period=Balance 2025]\n${hoja}\n[/period]`);
    expect(Object.keys(parsed.rows[0].balancesByPeriod)).toEqual(['2025']);
  });

  it('XLSX: dos hojas del mismo año, una con mes en el nombre y otra con el corte en el título', () => {
    const hoja = (titulo: string | null, caja: number) =>
      [...(titulo ? [`${titulo},,,`] : []), 'codigo,nombre,nivel,saldo', `110505,Caja,Auxiliar,${caja}`, `310505,Capital,Auxiliar,${caja}`].join('\n');
    const blocks =
      `[period=Diciembre 2025]\n${hoja(null, 900)}\n[/period]\n\n` +
      `[period=Balance 2025]\n${hoja('Balance a junio 30 de 2025', 600)}\n[/period]`;
    const out = preprocessUploadedTrialBalanceText(blocks);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    expect(out.preprocessed.periods.map((p) => p.period)).toEqual(['2025-06', '2025-12']);
  });

  it('niif-preproceso-29 sobre el balance real (fila 5 "De Enero 2025 a Diciembre 2025"): 2025 cerrado', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(
      path.resolve(process.cwd(), 'src/lib/preprocessing/__fixtures__/grupo-empresarial-2tres-sas.xlsx'),
    );
    const lines: string[] = [];
    wb.worksheets[0].eachRow((row) => {
      lines.push(xlsxRowToCsvLine(row.values as unknown[], lines.length === 0));
    });
    const s = pp(lines.join('\n')).primary;
    expect(s.period).toBe('2025');
    expect(s.periodoTipo).toBe('cerrado');
    expect(s.corteDeclarado?.texto).toMatch(/De Enero 2025 a Diciembre 2025/);
    expect(s.controlTotals.mesesPeriodo).toBe(12);
    // El archivo real no trasladó el resultado a 3605: R8 actúa con la nota de año cerrado.
    expect(s.virtualCloseAdjustment?.justification).toMatch(/NOTA OBLIGATORIA/);
  });
});
