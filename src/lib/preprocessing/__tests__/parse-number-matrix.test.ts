// ---------------------------------------------------------------------------
// parseNumber — matriz CO / EN-US / JS / IEEE-754 (ingesta-02, niif-preproceso-05)
// ---------------------------------------------------------------------------
// Regla morfológica (V2-preprocesoa):
//   - Un único tipo de separador: es de MILES sólo si la cadena casa
//     ^[1-9]\d{0,2}([.,]\d{3})+$. Así "1.234" = 1234 y "1.234.567" = 1234567.
//   - Un único separador que NO casa la agrupación es DECIMAL: "1234.567",
//     "0.125", "300.29999999999995" (valor crudo de una fórmula de Excel).
//   - Con ambos separadores el último es el decimal y la parte entera debe
//     estar bien agrupada.
//   - Lo ambiguo o ilegible es NaN, y dentro de un balance se registra como
//     motivo de validación bloqueante (la fila no desaparece en silencio).
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import {
  parseNumber,
  parseTrialBalanceCSV,
  preprocessTrialBalance,
} from '@/lib/preprocessing/trial-balance';

type Case = [raw: string, expected: number | 'NaN'];

function check(cases: Case[]) {
  for (const [raw, expected] of cases) {
    it(`parseNumber(${JSON.stringify(raw)}) → ${expected}`, () => {
      const v = parseNumber(raw);
      if (expected === 'NaN') {
        expect(Number.isNaN(v)).toBe(true);
      } else {
        expect(v).toBe(expected);
      }
    });
  }
}

describe('parseNumber — formato colombiano (punto de miles, coma decimal)', () => {
  check([
    ['1.234', 1234],
    ['12.345', 12345],
    ['123.456', 123456],
    ['1.234.567', 1234567],
    ['1.234.567,89', 1234567.89],
    ['1.234,5', 1234.5],
    ['0,5', 0.5],
    ['1234,5', 1234.5],
    ['1234,567', 1234.567],
    ['$ 1.234.567', 1234567],
    ['COP 2.500', 2500],
    ['(1.234.567,00)', -1234567],
    ['1.234.567,00-', -1234567],
    ['-1.234', -1234],
    ['1 234 567,89', 1234567.89],
    ["1'234.567", 1234567],
    ["1'234.567,89", 1234567.89],
  ]);
});

describe('parseNumber — formato EN-US (coma de miles, punto decimal)', () => {
  check([
    ['1,234', 1234],
    ['1,234,567', 1234567],
    ['1,234,567.89', 1234567.89],
    ['1,234.5', 1234.5],
    ['-1234.5', -1234.5],
    ['12,5', 12.5],
  ]);
});

describe('parseNumber — String(number) de JS / valores IEEE-754 de Excel', () => {
  check([
    ['1234.567', 1234.567],
    ['300.29999999999995', 300.29999999999995],
    ['72000000.125', 72000000.125],
    ['0.125', 0.125],
    ['1234567.89', 1234567.89],
    ['0.1', 0.1],
    ['100.00', 100],
    ['1.2345', 1.2345],
    // Ruido sub-centavo de una resta en Excel (String(n) usa exponente < 1e-6).
    ['1.4551915228366852e-11', 0],
    ['-2.3283064365386963e-10', 0],
    ['1e-7', 0],
  ]);
});

describe('parseNumber — signo menos Unicode y notación científica', () => {
  check([
    ['−1.234', -1234],
    ['− 1.234.567,89', -1234567.89],
    // Notación científica de magnitud material: Excel "General" recorta la
    // precisión al guardar CSV → ilegible, nunca un número aproximado.
    ['1.23457E+11', 'NaN'],
    ['1,23457E+11', 'NaN'],
    ['1.5E+10', 'NaN'],
  ]);
});

describe('parseNumber — ambiguos e ilegibles → NaN', () => {
  check([
    ['1.23.456', 'NaN'],
    ['12.34,5', 'NaN'],
    ['1.234,567.89', 'NaN'],
    ['', 'NaN'],
    ['   ', 'NaN'],
    ['N/A', 'NaN'],
    ['#DIV/0!', 'NaN'],
    ['-', 'NaN'],
  ]);
});

describe('celdas ilegibles dentro del balance → motivo de validación (no se descartan)', () => {
  const base = [
    '11050501,Caja,1000000',
    '21050501,Obligaciones,400000',
    '31050501,Capital,600000',
  ];

  it('notación científica en el saldo: la fila se conserva y el periodo queda bloqueado citando la cuenta', () => {
    const csv = ['codigo,nombre,saldo', ...base, '11100501,Bancos,1.23457E+11'].join('\n');
    const rows = parseTrialBalanceCSV(csv);
    const bancos = rows.find((r) => r.code === '11100501');
    expect(bancos).toBeDefined();
    expect(bancos!.parseIssues?.length).toBe(1);

    const pp = preprocessTrialBalance(rows);
    expect(pp.primary.validation.blocking).toBe(true);
    expect(pp.primary.validation.reasons.join('\n')).toMatch(/11100501/);
    expect(pp.primary.validation.reasons.join('\n')).toMatch(/1\.23457E\+11/);
    // Motivo de integridad: ningún ajuste del curador lo resuelve.
    expect(pp.primary.validation.integrityReasons?.join('\n')).toMatch(/11100501/);
  });

  it('error de fórmula (#DIV/0!) en el saldo → motivo bloqueante', () => {
    const csv = ['codigo,nombre,saldo', ...base, '11100501,Bancos,#DIV/0!'].join('\n');
    const pp = preprocessTrialBalance(parseTrialBalanceCSV(csv));
    expect(pp.primary.validation.blocking).toBe(true);
    expect(pp.primary.validation.reasons.join('\n')).toMatch(/11100501/);
  });

  it('débito/crédito ilegible NO se convierte en 0 en silencio', () => {
    const csv = [
      'codigo,nombre,debito,credito',
      '11050501,Caja,1000000,0',
      '21050501,Obligaciones,0,400000',
      '31050501,Capital,0,abc',
    ].join('\n');
    const pp = preprocessTrialBalance(parseTrialBalanceCSV(csv));
    expect(pp.primary.validation.blocking).toBe(true);
    expect(pp.primary.validation.reasons.join('\n')).toMatch(/31050501/);
  });

  it('celdas vacías y el guion contable "-" no son ilegibles', () => {
    const csv = [
      'codigo,nombre,saldo 2024,saldo 2025',
      '11050501,Caja,,1000000',
      '21050501,Obligaciones,-,400000',
      '31050501,Capital,,600000',
    ].join('\n');
    const rows = parseTrialBalanceCSV(csv);
    expect(rows.every((r) => !r.parseIssues || r.parseIssues.length === 0)).toBe(true);
  });

  it('valor IEEE crudo de una fórmula de Excel ya no se infla ×10^n', () => {
    const csv = [
      'codigo,nombre,saldo',
      '11050501,Caja,999900.29999999995',
      '21050501,Obligaciones,399900.3',
      '31050501,Capital,600000',
    ].join('\n');
    const pp = preprocessTrialBalance(parseTrialBalanceCSV(csv));
    expect(pp.primary.controlTotals.activo).toBe(999900.3);
    expect(pp.primary.validation.blocking).toBe(false);
  });
});
