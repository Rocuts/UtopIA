/**
 * raw-data — lectura compartida del texto de balance (ingesta-01/03/04/12).
 */
import { describe, it, expect } from 'vitest';
import {
  extractUploadDataSection,
  parseUploadedTrialBalanceText,
  detectSheetPeriod,
  headerHasExplicitPeriodBalanceColumn,
  looksLikeTabularTrialBalance,
  preprocessUploadedTrialBalanceText,
  TrialBalanceIngestError,
} from '../raw-data';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '../trial-balance';

const CSV = [
  'codigo,nombre,saldo',
  '11050501,Caja general,150000',
  '11100501,Bancos,250000',
  '13050501,Clientes,100000',
  '15200101,"Propiedades, planta y equipo",500000',
  '22050101,Proveedores,150000',
  '23359501,Otros,100000',
  '25050101,Salarios,50000',
  '24080101,IVA,100000',
  '31050501,Capital,400000',
  '33050501,Reserva legal,200000',
  '14350101,Mercancias,0',
].join('\n');

function block(label: string, csv: string): string {
  return `[period=${label}]\n${csv}\n[/period]`;
}

describe('extractUploadDataSection', () => {
  it('quita el informe antepuesto por /api/upload', () => {
    const pp = preprocessTrialBalance(parseTrialBalanceCSV(CSV));
    const text = `${pp.validationReport}\n\n---\n\nDATOS ORIGINALES:\n${CSV}`;
    const out = extractUploadDataSection(text);
    expect(out.hadValidationReport).toBe(true);
    expect(out.data).toBe(CSV);
  });

  it('quita el bloque "DATOS LIMPIOS" de las rutas legacy', () => {
    const text = `# INFORME DE VALIDACION ARITMETICA DEL BALANCE DE PRUEBA\n\nx\n\n---\n\nDATOS LIMPIOS (auxiliares validados):\n${CSV}`;
    expect(extractUploadDataSection(text).data).toBe(CSV);
  });

  it('deja intacto un CSV sin informe', () => {
    expect(extractUploadDataSection(CSV)).toEqual({ data: CSV, hadValidationReport: false });
  });
});

describe('parseUploadedTrialBalanceText', () => {
  it('el texto con informe antepuesto produce las mismas filas que el CSV (ingesta-01)', () => {
    const pp = preprocessTrialBalance(parseTrialBalanceCSV(CSV));
    const text = `${pp.validationReport}\n\n---\n\nDATOS ORIGINALES:\n${CSV}`;
    // Antes: parseTrialBalanceCSV(text) → 0 filas (encabezado = título del informe).
    expect(parseTrialBalanceCSV(text)).toHaveLength(0);
    const parsed = parseUploadedTrialBalanceText(text);
    expect(parsed.hadValidationReport).toBe(true);
    expect(parsed.rows).toHaveLength(11);
    expect(preprocessTrialBalance(parsed.rows).primary.controlTotals.activo).toBe(1_000_000);
  });

  it('bloques XLSX con informe antepuesto', () => {
    const blocks = block('Balance 2025', CSV);
    const pp = preprocessTrialBalance(parseUploadedTrialBalanceText(blocks).rows);
    const text = `${pp.validationReport}\n\n---\n\nDATOS ORIGINALES:\n${blocks}`;
    const again = preprocessTrialBalance(parseUploadedTrialBalanceText(text).rows);
    expect(again.primary.period).toBe('2025');
    expect(again.primary.controlTotals.activo).toBe(1_000_000);
  });

  it('una sola hoja conserva las filas repetidas como el CSV y avisa', () => {
    const csv = `${CSV}\n13050501,Clientes tercero B,5000`;
    const parsed = parseUploadedTrialBalanceText(block('Balance 2025', csv));
    expect(parsed.rows.filter((r) => r.code === '13050501')).toHaveLength(2);
    expect(parsed.warnings.join(' ')).toContain('13050501');
  });

  it('hojas idénticas del mismo periodo no se duplican y dejan aviso', () => {
    const parsed = parseUploadedTrialBalanceText(
      [block('Balance 2025', CSV), block('Copia 2025', CSV)].join('\n\n'),
    );
    expect(parsed.rows).toHaveLength(11);
    expect(parsed.warnings.join(' ')).toMatch(/repiten las mismas cifras/);
  });

  it('mezcla de hojas mensuales con un año posterior sin mes → error explícito', () => {
    const half = CSV.replace(/,(\d+)$/gm, (_m, v) => `,${Math.round(Number(v) / 2)}`);
    expect(() =>
      parseUploadedTrialBalanceText(
        [block('Jun 2025', half), block('Dic 2025', CSV), block('2026', CSV)].join('\n\n'),
      ),
    ).toThrow(TrialBalanceIngestError);
  });

  it('hojas sin filas contables (notas) no participan', () => {
    const parsed = parseUploadedTrialBalanceText(
      [block('Notas', 'Nota\nTexto libre'), block('Balance 2025', CSV)].join('\n\n'),
    );
    expect(parsed.rows).toHaveLength(11);
    expect(Object.keys(parsed.rows[0].balancesByPeriod)).toEqual(['2025']);
  });
});

describe('detectSheetPeriod', () => {
  it.each([
    ['Balance 2025', { year: '2025', month: null }],
    ['Dic 2025', { year: '2025', month: 12 }],
    ['Dic2025', { year: '2025', month: 12 }],
    ['Balance_2025', { year: '2025', month: null }],
    ['2025-06', { year: '2025', month: 6 }],
    ['06-2025', { year: '2025', month: 6 }],
    ['Junio', { year: null, month: 6 }],
    ['Hoja1', { year: null, month: null }],
    ['Libro Mayor 2024', { year: '2024', month: null }],
  ])('%s', (label, expected) => {
    expect(detectSheetPeriod(label)).toEqual(expected);
  });
});

describe('headerHasExplicitPeriodBalanceColumn', () => {
  it('reconoce columnas de saldo con año', () => {
    expect(headerHasExplicitPeriodBalanceColumn('codigo,nombre,Saldo 2025,Saldo 2024\n1,2')).toBe(true);
    expect(headerHasExplicitPeriodBalanceColumn('codigo;nombre;saldo [2025-12]')).toBe(true);
  });
  it('ignora columnas sin año y movimientos con año', () => {
    expect(headerHasExplicitPeriodBalanceColumn('codigo,nombre,saldo')).toBe(false);
    expect(headerHasExplicitPeriodBalanceColumn('codigo,nombre,Debito 2025,saldo')).toBe(false);
  });
});

describe('looksLikeTabularTrialBalance', () => {
  it('true para un balance CSV cuyo encabezado no se reconoce', () => {
    const text = CSV.replace('codigo,nombre,saldo', 'EMPRESA DEMO SAS,,');
    expect(parseTrialBalanceCSV(text)).toHaveLength(0);
    expect(looksLikeTabularTrialBalance(text)).toBe(true);
  });
  it('true para un export de ERP con filas de título y el código en la tercera columna', () => {
    const erp = [
      'Balance de prueba general,,,',
      'Grupo Demo SAS,,,',
      'Nivel,Transaccional,Código cuenta contable,Nombre,Saldo final 2025',
      ...CSV.split('\n').slice(1).map((l) => `Auxiliar,Si,${l}`),
    ].join('\n');
    expect(looksLikeTabularTrialBalance(erp)).toBe(true);
  });
  it('false para texto de PDF (una línea por cuenta con importes en formato CO)', () => {
    const pdf = CSV.split('\n')
      .slice(1)
      .map((l) => l.replace(/"/g, '').split(',').join(' ') + ',00')
      .join('\n');
    expect(looksLikeTabularTrialBalance(pdf)).toBe(false);
  });
  it('false para texto OCR en tablas Markdown y para prosa', () => {
    const md = CSV.split('\n').map((l) => `| ${l.split(',').join(' | ')} |`).join('\n');
    expect(looksLikeTabularTrialBalance(md)).toBe(false);
    expect(looksLikeTabularTrialBalance('Acta de asamblea ordinaria')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ingesta-09 (W3-A): columnas de saldo inicial/anterior → `openingPeriods`
// ---------------------------------------------------------------------------
describe('openingPeriods — comparativo desde la columna de apertura', () => {
  const OPENING_CSV = [
    'codigo,nombre,nivel,transaccional,saldo inicial 2025,saldo final 2025',
    '110505,Caja,Auxiliar,1,50000000,80000000',
    '130505,Clientes,Auxiliar,1,40000000,60000000',
    '220505,Proveedores,Auxiliar,1,30000000,40000000',
    '311505,Capital,Auxiliar,1,40000000,40000000',
    '360505,Utilidad del ejercicio,Auxiliar,1,0,40000000',
    '370505,Utilidades acumuladas,Auxiliar,1,20000000,20000000',
    '410505,Ventas,Auxiliar,1,0,150000000',
    '510505,Sueldos,Auxiliar,1,0,110000000',
  ].join('\n');

  it('CSV plano: el periodo de la columna de apertura se publica y marca el snapshot', () => {
    expect(parseUploadedTrialBalanceText(OPENING_CSV).openingPeriods).toEqual(['2024']);
    const read = preprocessUploadedTrialBalanceText(OPENING_CSV);
    if (read.kind !== 'ok') throw new Error('fixture inválido');
    expect(read.preprocessed.comparative?.period).toBe('2024');
    expect(read.preprocessed.comparative?.saldosDeApertura).toBe(true);
    expect(read.preprocessed.primary.saldosDeApertura).toBeUndefined();
    // KPIs de resultados del comparativo N/D con motivo.
    expect(read.preprocessed.comparative?.controlTotals.roe ?? null).toBeNull();
  });

  it('bloque XLSX cuyo encabezado decide: también publica la apertura', () => {
    const parsed = parseUploadedTrialBalanceText(block('Balance', OPENING_CSV));
    expect(parsed.openingPeriods).toEqual(['2024']);
  });

  it('un cierre real del mismo periodo en otra hoja no se marca como apertura', () => {
    const cierre2024 = [
      'codigo,nombre,nivel,transaccional,saldo',
      '110505,Caja,Auxiliar,1,50000000',
      '130505,Clientes,Auxiliar,1,40000000',
      '220505,Proveedores,Auxiliar,1,30000000',
      '311505,Capital,Auxiliar,1,40000000',
      '360505,Utilidad del ejercicio,Auxiliar,1,0',
      '370505,Utilidades acumuladas,Auxiliar,1,20000000',
      '410505,Ventas,Auxiliar,1,0',
      '510505,Sueldos,Auxiliar,1,0',
    ].join('\n');
    const parsed = parseUploadedTrialBalanceText(
      [block('Balance', OPENING_CSV), block('Dic 2024', cierre2024)].join('\n\n'),
    );
    expect(parsed.openingPeriods).toEqual([]);
  });

  it('CSV sin columna de apertura: lista vacía', () => {
    expect(parseUploadedTrialBalanceText(CSV).openingPeriods).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ratios-kpis-18 / ingesta-09 (W3-A): una hoja de corte parcial conserva el mes
// ---------------------------------------------------------------------------
describe('periodo de la hoja con mes distinto de diciembre', () => {
  const periodsOf = (text: string) =>
    [...new Set(parseUploadedTrialBalanceText(text).rows.flatMap((r) => Object.keys(r.balancesByPeriod)))].sort();

  it('una sola hoja "Junio 2025" queda como 2025-06 (P&G de 6 meses)', () => {
    expect(periodsOf(block('Junio 2025', CSV))).toEqual(['2025-06']);
    const read = preprocessUploadedTrialBalanceText(block('Junio 2025', CSV));
    if (read.kind !== 'ok') throw new Error('fixture inválido');
    expect(read.preprocessed.primary.period).toBe('2025-06');
    expect(read.preprocessed.primary.controlTotals.mesesPeriodo).toBe(6);
  });

  it('"Jun 2024" y "Dic 2025" (años distintos): 2024-06 y 2025-12', () => {
    expect(periodsOf([block('Jun 2024', CSV), block('Dic 2025', CSV)].join('\n\n'))).toEqual([
      '2024-06',
      '2025-12',
    ]);
  });

  it('hojas de diciembre o sin mes conservan el año (sin cambios)', () => {
    expect(periodsOf([block('Dic 2024', CSV), block('Dic 2025', CSV)].join('\n\n'))).toEqual([
      '2024',
      '2025',
    ]);
    expect(periodsOf(block('Balance 2025', CSV))).toEqual(['2025']);
    expect(periodsOf(block('Diciembre 2025', CSV))).toEqual(['2025']);
  });

  it('"Balance 2024" y "Jun 2025": 2024 (anual) y 2025-06', () => {
    expect(periodsOf([block('Balance 2024', CSV), block('Jun 2025', CSV)].join('\n\n'))).toEqual([
      '2024',
      '2025-06',
    ]);
  });
});
