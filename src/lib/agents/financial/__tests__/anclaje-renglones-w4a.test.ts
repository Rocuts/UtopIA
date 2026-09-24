// ---------------------------------------------------------------------------
// Anclaje renglón a renglón de los cuatro estados (re-auditoría 2026-09-24)
// ---------------------------------------------------------------------------
// e2e-niif-01/02/05/06/07/08/09/12: el validador anclaba TOTALES; dentro de
// ellos el modelo podía mover importes entre grupos PUC (13↔15, 41/61), en
// cualquiera de las dos columnas, sustituir la utilidad neta por un renglón
// "UTILIDAD NETA" con el signo invertido, imprimir un EBITDA libre dentro del
// ERI, inflar la depreciación del EFE compensándola en deudores, rotular la
// deuda como aportes de socios, desplazar componentes de la apertura del ECP y
// fabricar dividendos y capitalizaciones. Cada caso se mide sobre el MISMO
// balance con las MISMAS opciones que arma producción
// (`buildNiifValidatorOptions`).
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { validateNiifReportJson } from '../validators/niif-json-validator';
import { buildNiifValidatorOptions } from '../orchestrator';
import {
  clonar,
  filaEcp,
  informeHonesto,
  linea,
  preprocesarPerdidaComparativo,
} from '../__fixtures__/perdida-comparativo-w4a';
import type { NiifReportJson } from '../contracts/niif-report';

const pp = preprocesarPerdidaComparativo();
const options = buildNiifValidatorOptions(pp);
const X = BigInt(100_000_000); // $1.000.000,00
const add = (v: string, d: bigint) => (BigInt(v) + d).toString();
type J = NiifReportJson;
const esf = (j: J, sect: 'assets' | 'liabilities' | 'equity', acc: string) =>
  j.balanceSheet[sect].find((l) => l.account === acc)!;
const eri = (j: J, acc: string) => j.incomeStatement.lines.find((l) => l.account === acc)!;

function errores(manipular: (j: J) => void): string[] {
  const j = clonar(informeHonesto(pp));
  manipular(j);
  return validateNiifReportJson(j, options).errors;
}

describe('informe honesto — sin falsos positivos', () => {
  it('el informe que copia anclas y desglose determinista no tiene errores', () => {
    expect(validateNiifReportJson(informeHonesto(pp), options).errors).toEqual([]);
  });

  it('las opciones de producción traen las hojas de ambos periodos', () => {
    expect(options.ledgers?.primary.length).toBeGreaterThan(0);
    expect(options.ledgers?.comparative?.length).toBeGreaterThan(0);
    expect(options.comparativeIsOpening).toBe(false);
  });

  it('"15" bruto + "1592" depreciación separados también cuadran (hoja al código más específico)', () => {
    const e = errores((j) => {
      const i = j.balanceSheet.assets.findIndex((l) => l.account === '15');
      j.balanceSheet.assets.splice(
        i,
        1,
        linea('15', 'Propiedades, planta y equipo (costo)', '10000000000', '10000000000', { isAbsolute: true }),
        linea('1592', 'Depreciación acumulada', '2000000000', '1000000000', { isAbsolute: true }),
      );
    });
    expect(e).toEqual([]);
  });
});

describe('E21 — ESF anclado por grupo PUC en ambas columnas (e2e-niif-05)', () => {
  it('A1: $1.000.000 de deudores (13) movido a PPE (15), total igual', () => {
    const e = errores((j) => {
      esf(j, 'assets', '13').amountPrimary = add(esf(j, 'assets', '13').amountPrimary, -X);
      esf(j, 'assets', '15').amountPrimary = add(esf(j, 'assets', '15').amountPrimary, X);
    });
    expect(e.filter((m) => m.startsWith('E21.'))).toHaveLength(2);
    expect(e.join('\n')).toMatch(/13 — .* imprime \$14\.000\.000,00 .* suman \$15\.000\.000,00/);
  });

  it('A2: el mismo traslado en la columna comparativa 2024', () => {
    const e = errores((j) => {
      esf(j, 'assets', '13').amountComparative = add(esf(j, 'assets', '13').amountComparative!, -X);
      esf(j, 'assets', '15').amountComparative = add(esf(j, 'assets', '15').amountComparative!, X);
    });
    expect(e.some((m) => m.startsWith('E21.') && m.includes('periodo comparativo 2024'))).toBe(true);
  });

  it('pasivo: obligaciones financieras (21) ↔ proveedores (22)', () => {
    const e = errores((j) => {
      esf(j, 'liabilities', '21').amountPrimary = add(esf(j, 'liabilities', '21').amountPrimary, X);
      esf(j, 'liabilities', '22').amountPrimary = add(esf(j, 'liabilities', '22').amountPrimary, -X);
    });
    expect(e.filter((m) => m.startsWith('E21.'))).toHaveLength(2);
  });
});

describe('E21 — ERI anclado por grupo PUC (e2e-niif-06)', () => {
  it('A4: ingresos 41 y costo 61 inflados en la misma cifra (UB intacta)', () => {
    const e = errores((j) => {
      eri(j, '41').amountPrimary = add(eri(j, '41').amountPrimary, X);
      eri(j, '61').amountPrimary = add(eri(j, '61').amountPrimary, X);
    });
    expect(e.filter((m) => m.startsWith('E21. Estado de Resultados'))).toHaveLength(2);
  });

  it('A5: 51 −$1M y un "52 — Gastos de ventas" inventado (EBIT intacto)', () => {
    const e = errores((j) => {
      eri(j, '51').amountPrimary = add(eri(j, '51').amountPrimary, -X);
      j.incomeStatement.lines.splice(3, 0, linea('52', 'Gastos de ventas', X.toString(), '0', { isAbsolute: true }));
    });
    expect(e.some((m) => m.startsWith('E21.') && m.includes('52 — Gastos de ventas'))).toBe(true);
    expect(e.some((m) => m.startsWith('E21.') && m.includes('51 — '))).toBe(true);
  });

  it('A6: 41 y 61 inflados en la columna comparativa', () => {
    const e = errores((j) => {
      eri(j, '41').amountComparative = add(eri(j, '41').amountComparative!, X);
      eri(j, '61').amountComparative = add(eri(j, '61').amountComparative!, X);
    });
    expect(e.filter((m) => m.startsWith('E21.') && m.includes('periodo comparativo 2024'))).toHaveLength(2);
  });
});

describe('E22 — renglones sin código del ERI, con signo (e2e-niif-01/02)', () => {
  it('A7: "UTILIDAD NETA DEL PERÍODO" +$40M (nivel 3) sobre una pérdida de −$40M', () => {
    const e = errores((j) => {
      j.incomeStatement.lines.push(linea(null, 'UTILIDAD NETA DEL PERÍODO', '4000000000', '3000000000', { level: 3 }));
    });
    expect(e.filter((m) => m.startsWith('E22. Estado de Resultados'))).toHaveLength(2);
    expect(e.join('\n')).toMatch(/UTILIDAD NETA DEL PERÍODO.*\$40\.000\.000,00.*-\$40\.000\.000,00/);
  });

  it('A8: renglón de nivel 2 "UTILIDAD NETA DEL PERÍODO" por $12.345.678,00', () => {
    const e = errores((j) => {
      j.incomeStatement.lines.push(linea(null, 'UTILIDAD NETA DEL PERÍODO', '1234567800', null, { level: 2 }));
    });
    expect(e.some((m) => m.startsWith('E22.') && m.includes('$12.345.678,00'))).toBe(true);
  });

  it('A9: "EBITDA" de nivel 2 por $55.555.555,00 dentro del ERI', () => {
    const e = errores((j) => {
      j.incomeStatement.lines.push(linea(null, 'EBITDA', '5555555500', null, { level: 2 }));
    });
    expect(e.some((m) => m.startsWith('E22.') && m.includes('EBITDA'))).toBe(true);
  });

  it('un subtotal honesto (con su signo) y un encabezado en $0 no bloquean', () => {
    const e = errores((j) => {
      const l = j.incomeStatement.lines;
      l.unshift(linea(null, 'INGRESOS', '0', '0', { level: 0 }));
      l.splice(3, 0, linea(null, 'UTILIDAD BRUTA', j.incomeStatement.grossProfitPrimary, j.incomeStatement.grossProfitComparative, { level: 3 }));
      l.push(linea(null, 'PÉRDIDA NETA DEL EJERCICIO', '4000000000', '3000000000', { level: 4 }));
      l.push(linea(null, 'Total gastos de administración', eri(j, '51').amountPrimary, eri(j, '51').amountComparative, { level: 3 }));
    });
    expect(e).toEqual([]);
  });
});

describe('E22 — subtotales sin código del ESF con signo (e2e-niif-12)', () => {
  it('A10: "Resultado neto del período" +$40M tras el renglón 36 (−$40M)', () => {
    const e = errores((j) => {
      const eq = j.balanceSheet.equity;
      const i36 = eq.findIndex((l) => l.account === '36');
      eq.splice(i36, 0, linea(null, 'Resultados', '0', null, { level: 1 }));
      eq.splice(i36 + 2, 0, linea(null, 'Resultado neto del período', '4000000000', '3000000000', { level: 3 }));
    });
    expect(e.some((m) => m.startsWith('E22. Estado de Situación Financiera — Patrimonio'))).toBe(true);
  });

  it('el mismo subtotal con su signo real no bloquea', () => {
    const e = errores((j) => {
      const eq = j.balanceSheet.equity;
      const i36 = eq.findIndex((l) => l.account === '36');
      eq.splice(i36 + 1, 0, linea(null, 'Resultado neto del período', '-4000000000', '-3000000000', { level: 3 }));
    });
    expect(e).toEqual([]);
  });
});

describe('E23 — EFE renglón a renglón (e2e-niif-07)', () => {
  const op = (j: J) => j.cashFlow.sections.find((s) => s.section === 'operating')!;
  const fin = (j: J) => j.cashFlow.sections.find((s) => s.section === 'financing')!;

  it('A13: depreciación +$1M y deudores −$1M dentro de operación (subtotal igual)', () => {
    const e = errores((j) => {
      op(j).lines[1].amountPrimary = add(op(j).lines[1].amountPrimary, X);
      op(j).lines[2].amountPrimary = add(op(j).lines[2].amountPrimary, -X);
    });
    expect(e.filter((m) => m.startsWith('E23.'))).toHaveLength(2);
  });

  it('A14: el renglón de obligaciones financieras rotulado "Aportes de capital de los socios"', () => {
    const e = errores((j) => {
      fin(j).lines[0].label = 'Aportes de capital de los socios';
    });
    expect(e.some((m) => m.startsWith('E23.') && m.includes('flujo con los socios'))).toBe(true);
  });

  it('A32: financiación partida en préstamo +$8M y "Utilidades giradas a los accionistas" −$3M', () => {
    const e = errores((j) => {
      fin(j).lines = [
        linea(null, 'Préstamos bancarios recibidos', '800000000', null),
        linea(null, 'Utilidades giradas a los accionistas', '-300000000', null),
      ];
    });
    expect(e.some((m) => m.startsWith('E23.') && m.includes('Utilidades giradas'))).toBe(true);
    // E18 reconoce ahora la distribución aunque su rótulo no diga "dividendos".
    expect(e.some((m) => m.startsWith('E18.') && m.includes('distribución a socios'))).toBe(true);
  });

  it('una pérdida rotulada "Utilidad neta del ejercicio" (rótulo canónico del prompt) no bloquea', () => {
    const e = errores((j) => {
      op(j).lines[0].label = 'Utilidad neta del ejercicio';
    });
    expect(e).toEqual([]);
  });
});

describe('E19b/E24 — ECP por componente (e2e-niif-08)', () => {
  it('A15: apertura capital −$1M / acumulados +$1M, capitalización y dividendos fabricados', () => {
    const e = errores((j) => {
      const rows = j.equityChanges.rows;
      rows[0].capitalSocial = add(rows[0].capitalSocial, -X);
      rows[0].resultadosAcumulados = add(rows[0].resultadosAcumulados, X);
      rows.splice(
        rows.length - 1,
        0,
        filaEcp('capital_contribution', 'Capitalización aprobada por la asamblea', { capitalSocial: X }),
        filaEcp('dividend_distribution', 'Dividendos decretados', { resultadosAcumulados: -X }),
      );
    });
    expect(e.some((m) => m.startsWith('E24.') && m.includes('saldo inicial — Capital social (31)'))).toBe(true);
    expect(e.some((m) => m.startsWith('E24.') && m.includes('Dividendos decretados'))).toBe(true);
    expect(e.some((m) => m.startsWith('E24.') && m.includes('Capitalización aprobada'))).toBe(true);
  });

  it('E19b sin balance de prueba: la apertura por componente contra el patrimonio comparativo del ESF', () => {
    const j = clonar(informeHonesto(pp));
    // El grupo 37 no existía en 2024: su cifra comparativa es $0 impresa.
    j.balanceSheet.equity.find((l) => l.account === '37')!.amountComparative = '0';
    expect(validateNiifReportJson(j).errors).toEqual([]);
    const rows = j.equityChanges.rows;
    rows[0].capitalSocial = add(rows[0].capitalSocial, -X);
    rows[0].resultadosAcumulados = add(rows[0].resultadosAcumulados, X);
    const e = validateNiifReportJson(j).errors;
    expect(e.some((m) => m.startsWith('E19b.') && m.includes('Capital social (31)'))).toBe(true);
    expect(e.some((m) => m.startsWith('E19b.') && m.includes('Resultados acumulados (37)'))).toBe(true);
  });

  it('A3: ESF 31 +$1M / 37 −$1M con apertura y cierre del ECP desplazados igual', () => {
    const e = errores((j) => {
      esf(j, 'equity', '31').amountPrimary = add(esf(j, 'equity', '31').amountPrimary, X);
      esf(j, 'equity', '37').amountPrimary = add(esf(j, 'equity', '37').amountPrimary, -X);
      for (const r of j.equityChanges.rows) {
        if (r.kind === 'opening_balance' || r.kind === 'closing_balance') {
          r.capitalSocial = add(r.capitalSocial, X);
          r.resultadosAcumulados = add(r.resultadosAcumulados, -X);
        }
      }
    });
    expect(e.some((m) => m.startsWith('E21.') && m.includes('31 — '))).toBe(true);
    expect(e.some((m) => m.startsWith('E24.') && m.includes('saldo final'))).toBe(true);
    expect(e.some((m) => m.startsWith('E24.') && m.includes('saldo inicial'))).toBe(true);
  });
});

describe('E25 — rótulos fechados en otro periodo (e2e-niif-09)', () => {
  it('un renglón del EFE que cita 2023 en un informe 2025/2024 bloquea', () => {
    const e = errores((j) => {
      j.cashFlow.sections[0].lines[0].label = 'Pérdida neta del ejercicio 2023';
    });
    expect(e.some((m) => m.startsWith('E25.') && m.includes('2023'))).toBe(true);
  });

  it('los años de una cita normativa no cuentan', () => {
    const e = errores((j) => {
      j.balanceSheet.assets[0].label = 'Efectivo (Decreto 2420 de 2015; NIIF para las PYMES 2009)';
    });
    expect(e).toEqual([]);
  });
});

describe('E9 — comparativo de saldos de apertura (cross-dep W3-A, ingesta-09)', () => {
  it('con comparativeIsOpening el P&G comparativo puede viajar en null y no se cruza', () => {
    const j = clonar(informeHonesto(pp));
    j.incomeStatement.grossProfitComparative = null;
    j.incomeStatement.operatingProfitComparative = null;
    j.incomeStatement.netIncomeComparative = null;
    j.incomeStatement.oriComparative = null;
    for (const l of j.incomeStatement.lines) l.amountComparative = null;
    const cerrado = validateNiifReportJson(j, options);
    expect(cerrado.errors.some((m) => m.startsWith('E9.') && m.includes('grossProfitComparative'))).toBe(true);
    const apertura = validateNiifReportJson(j, { ...options, comparativeIsOpening: true });
    expect(apertura.errors).toEqual([]);
  });
});
