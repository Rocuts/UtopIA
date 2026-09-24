// ---------------------------------------------------------------------------
// Detección de cabecera y columnas de saldo del balance de prueba
// (ingesta-06, ingesta-07, ingesta-08, niif-preproceso-02 lado parser)
// ---------------------------------------------------------------------------
// Balance natural cuadrado: A 1.000.000 = P 400.000 + K 600.000 (saldo final).
// El saldo inicial (800.000 de activo) es distinto para que cualquier
// confusión entre columnas se vea en las cifras.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import {
  detectYearFromString,
  parseTrialBalanceCSV,
  preprocessTrialBalance,
} from '@/lib/preprocessing/trial-balance';

// codigo, nombre, saldoInicial, debitos, creditos, saldoFinal (convención natural)
const DATA: Array<[string, string, number, number, number, number]> = [
  ['11050501', 'Caja general', 100000, 80000, 30000, 150000],
  ['11100501', 'Bancos nacionales', 200000, 100000, 50000, 250000],
  ['13050501', 'Clientes nacionales', 100000, 50000, 50000, 100000],
  ['15200101', 'Maquinaria y equipo', 400000, 100000, 0, 500000],
  ['22050101', 'Proveedores nacionales', 100000, 0, 50000, 150000],
  ['23359501', 'Otros costos por pagar', 100000, 0, 0, 100000],
  ['24080101', 'IVA por pagar', 50000, 0, 50000, 100000],
  ['25050101', 'Salarios por pagar', 50000, 0, 0, 50000],
  ['31050501', 'Capital autorizado', 400000, 0, 0, 400000],
  ['33050501', 'Reserva legal', 100000, 0, 100000, 200000],
  ['14350101', 'Mercancias', 0, 0, 0, 0],
];

type Row = (typeof DATA)[number];

function csv(header: string[], row: (d: Row) => (string | number)[], sep = ','): string {
  return [header.join(sep), ...DATA.map((d) => row(d).join(sep))].join('\n');
}

const finalOnly = ([c, n, , , , sf]: Row) => [c, n, sf];

function totals(text: string, opts?: Parameters<typeof parseTrialBalanceCSV>[1]) {
  const pp = preprocessTrialBalance(parseTrialBalanceCSV(text, opts));
  const ct = pp.primary.controlTotals;
  return {
    pp,
    periods: pp.periods.map((p) => p.period),
    activo: ct.activo,
    pasivo: ct.pasivo,
    patrimonio: ct.patrimonio,
  };
}

describe('ingesta-08 — cabeceras con tildes, Windows-1252 y filas de título', () => {
  it('"Código;Descripción;Saldo" (UTF-8 con tildes) se reconoce', () => {
    const t = totals(csv(['Código', 'Descripción', 'Saldo'], finalOnly, ';'));
    expect(t.activo).toBe(1_000_000);
    expect(t.pasivo).toBe(400_000);
  });

  it('CSV Windows-1252 leído como UTF-8 ("C\\uFFFDdigo") se reconoce', () => {
    const t = totals(csv(['C�digo', 'Descripci�n', 'Saldo'], finalOnly, ';'));
    expect(t.activo).toBe(1_000_000);
  });

  it('preámbulo de ERP (razón social, NIT, periodo) antes de la cabecera', () => {
    const text = [
      'EMPRESA DEMO SAS,,',
      'NIT 900.123.456-7,,',
      'Balance de prueba de enero a diciembre 2025,,',
      '',
      csv(['Codigo', 'Nombre', 'Saldo'], finalOnly),
    ].join('\n');
    const t = totals(text);
    expect(t.activo).toBe(1_000_000);
    expect(t.patrimonio).toBe(600_000);
  });

  it('fila con más celdas que la cabecera (coma sin comillas en el nombre) bloquea: sus saldos están corridos', () => {
    const text = [
      'Codigo,Nombre,Saldo inicial 2024,Saldo final 2025',
      '11050501,Caja,100000,1000000',
      '13551501,Anticipo Retención en la fuente 2,5%,24249425.49,39056341.46',
      '21050501,Obligaciones,50000,400000',
      '31050501,Capital,50000,600000',
    ].join('\n');
    const t = totals(text);
    expect(t.periods).toEqual(['2024', '2025']);
    // El periodo principal (2025) recibió la cifra de otra columna: se declara.
    expect(t.pp.primary.validation.blocking).toBe(true);
    expect(t.pp.primary.validation.reasons.join('\n')).toMatch(/13551501.*desplaz/);
  });

  it('"Descripción" no se confunde con la columna crédito ("cr") en un archivo débito/crédito', () => {
    const text = csv(['Código', 'Descripción', 'Débitos', 'Créditos'], ([c, n, , , , sf]) => {
      const debitNature = ['1', '5', '6', '7'].includes(c[0]);
      return [c, n, debitNature ? sf : 0, debitNature ? 0 : sf];
    });
    const t = totals(text);
    expect(t.activo).toBe(1_000_000);
    expect(t.pasivo).toBe(400_000);
    expect(t.patrimonio).toBe(600_000);
  });

  it('columna "Naturaleza" (D/C) no se toma como nivel de la cuenta', () => {
    const text = csv(['codigo', 'nombre', 'naturaleza', 'saldo'], ([c, n, , , , sf]) => [
      c,
      n,
      ['1', '5', '6', '7'].includes(c[0]) ? 'D' : 'C',
      sf,
    ]);
    const t = totals(text);
    expect(t.activo).toBe(1_000_000);
    expect(t.pp.auxiliaryCount).toBe(DATA.length);
  });
});

describe('ingesta-06 — "Saldo Inicial … Saldo Final": el periodo es el saldo final', () => {
  const header = ['Cuenta', 'Nombre', 'Saldo Inicial', 'Débitos', 'Créditos', 'Saldo Final'];
  const all = ([c, n, si, d, cr, sf]: Row) => [c, n, si, d, cr, sf];

  it('sin año (upload CSV): primario = saldo final, comparativo = saldo inicial', () => {
    const t = totals(csv(header, all));
    expect(t.activo).toBe(1_000_000);
    expect(t.pp.comparative?.controlTotals.activo).toBe(800_000);
  });

  it('con currentYear (API v1): el saldo final no se descarta', () => {
    const t = totals(csv(header, all), { currentYear: '2025' });
    expect(t.periods).toEqual(['2024', '2025']);
    expect(t.activo).toBe(1_000_000);
  });

  it('"Saldo Anterior | Saldo Actual" y "Nuevo Saldo" también se resuelven por palabra clave', () => {
    const h1 = ['Cuenta', 'Nombre', 'Saldo Anterior', 'Débitos', 'Créditos', 'Nuevo Saldo'];
    expect(totals(csv(h1, all)).activo).toBe(1_000_000);
    const h2 = ['Cuenta', 'Nombre', 'Saldo Actual', 'Saldo Anterior'];
    expect(totals(csv(h2, ([c, n, si, , , sf]) => [c, n, sf, si])).activo).toBe(1_000_000);
  });

  it('"Movimiento neto" no es una columna de saldo', () => {
    const h = ['Cuenta', 'Nombre', 'Saldo Anterior', 'Débitos', 'Créditos', 'Movimiento Neto', 'Saldo Final'];
    const t = totals(csv(h, ([c, n, si, d, cr, sf]) => [c, n, si, d, cr, sf - si, sf]));
    expect(t.activo).toBe(1_000_000);
  });

  it('años de dos dígitos con mes ("Saldo Dic-24 | Saldo Dic-25")', () => {
    expect(detectYearFromString('Saldo Dic-24')).toBe('2024');
    expect(detectYearFromString("dic'25")).toBe('2025');
    expect(detectYearFromString('Saldo a Nov 30')).toBeNull();
    const t = totals(csv(['Cuenta', 'Nombre', 'Saldo Dic-24', 'Saldo Dic-25'], ([c, n, si, , , sf]) => [c, n, si, sf]));
    expect(t.periods).toEqual(['2024', '2025']);
    expect(t.activo).toBe(1_000_000);
  });

  it('"Saldo Inicial 2025 | Saldo Final 2025": la apertura corresponde al cierre 2024', () => {
    const t = totals(csv(['Cuenta', 'Nombre', 'Saldo Inicial 2025', 'Saldo Final 2025'], ([c, n, si, , , sf]) => [c, n, si, sf]));
    expect(t.periods).toEqual(['2024', '2025']);
    expect(t.activo).toBe(1_000_000);
  });

  it('dos columnas de saldo sin año ni palabra clave → motivo bloqueante, no heurística posicional', () => {
    const t = totals(csv(['Cuenta', 'Nombre', 'Saldo', 'Saldo'], ([c, n, si, , , sf]) => [c, n, si, sf]));
    expect(t.pp.primary.validation.blocking).toBe(true);
    expect(t.pp.primary.validation.reasons.join('\n')).toMatch(/mismo periodo/i);
  });
});

describe('ingesta-07 — "Saldo Débito | Saldo Crédito" con tilde es UNA columna neta por naturaleza', () => {
  const byNature = ([c, n, , , , sf]: Row) => {
    const debitNature = ['1', '5', '6', '7'].includes(c[0]);
    return [c, n, debitNature ? sf : 0, debitNature ? 0 : sf];
  };

  it('con tilde', () => {
    const t = totals(csv(['Cuenta', 'Nombre', 'Saldo Débito', 'Saldo Crédito'], byNature));
    expect(t.periods).toHaveLength(1);
    expect([t.activo, t.pasivo, t.patrimonio]).toEqual([1_000_000, 400_000, 600_000]);
  });

  it('"Saldo Deudor | Saldo Acreedor"', () => {
    const t = totals(csv(['Cuenta', 'Nombre', 'Saldo Deudor', 'Saldo Acreedor'], byNature));
    expect([t.activo, t.pasivo, t.patrimonio]).toEqual([1_000_000, 400_000, 600_000]);
  });

  it('par débito/crédito del saldo final junto a un saldo anterior', () => {
    const h = ['Cuenta', 'Nombre', 'Saldo Anterior', 'Débitos', 'Créditos', 'Saldo Final Débito', 'Saldo Final Crédito'];
    const t = totals(csv(h, (d) => {
      const [c, n, si, dd, cr] = d;
      const [, , sfd, sfc] = byNature(d);
      return [c, n, si, dd, cr, sfd, sfc];
    }));
    expect([t.activo, t.pasivo, t.patrimonio]).toEqual([1_000_000, 400_000, 600_000]);
    expect(t.pp.comparative?.controlTotals.activo).toBe(800_000);
  });
});

describe('separador y orden de periodos (cross-deps de WP01)', () => {
  it('un ";" dentro de un nombre entrecomillado no cambia el separador del archivo', () => {
    const text = [
      'codigo,"nombre; descripción",saldo',
      '11050501,Caja,1000000',
      '21050501,Obligaciones,400000',
      '31050501,Capital,600000',
    ].join('\n');
    const t = totals(text);
    expect([t.activo, t.pasivo, t.patrimonio]).toEqual([1_000_000, 400_000, 600_000]);
  });

  it('"YYYY" (cierre del año) y "YYYY-MM" se ordenan cronológicamente', () => {
    const text = [
      'codigo,nombre,saldo [2025-06],saldo [2024]',
      '11050501,Caja,1500000,1000000',
      '21050501,Obligaciones,600000,400000',
      '31050501,Capital,900000,600000',
    ].join('\n');
    const t = totals(text);
    expect(t.periods).toEqual(['2024', '2025-06']);
    expect(t.activo).toBe(1_500_000);

    const t2 = totals(text.replace('saldo [2024]', 'saldo [2025]'));
    expect(t2.periods).toEqual(['2025-06', '2025']);
  });
});

describe('forcePeriod (hoja XLSX) — lado parser de ingesta-03 / niif-preproceso-02', () => {
  it('columnas con año explícito conservan su año aunque la hoja se llame "Hoja1"', () => {
    const text = csv(['codigo', 'nombre', 'Saldo 2025', 'Saldo 2024'], ([c, n, si, , , sf]) => [c, n, sf, si]);
    const rows = parseTrialBalanceCSV(text, { forcePeriod: 'Hoja1' });
    expect(rows[0].balancesByPeriod).toEqual({ '2025': 150000, '2024': 100000 });
  });

  it('"Saldo Final | Saldo Anterior" bajo forcePeriod toma el saldo final (no la última columna)', () => {
    const text = csv(['codigo', 'nombre', 'Saldo Final', 'Saldo Anterior'], ([c, n, si, , , sf]) => [c, n, sf, si]);
    const rows = parseTrialBalanceCSV(text, { forcePeriod: '2025' });
    expect(rows[0].balancesByPeriod).toEqual({ '2025': 150000 });
  });
});
