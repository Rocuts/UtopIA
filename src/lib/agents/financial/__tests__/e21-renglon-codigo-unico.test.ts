// ---------------------------------------------------------------------------
// E21 renglón a renglón: un renglón, un código (re-auditoría 2 · e2e-niif2-01)
// ---------------------------------------------------------------------------
// E21 anclaba GRUPOS de renglones unidos por un código PUC compartido
// (`anchorGroups`, unión de conjuntos) y sólo comparaba la suma del grupo. Un
// renglón puente en $0 con dos códigos ("13 15", "41 61", "21 22") unía dos
// grupos y permitía trasladar importes entre ellos con la suma intacta; dos
// renglones con el mismo código (51 + "51 — Honorarios pagados a socios")
// permitían inventar sub-renglones. El informe salía limpio y el Excel/PDF
// con "PROCEDENCIA VERIFICADA": deudores $14M (real $15M), PPE $81M, ingresos
// $81M / costo $71M (real $80M / $70M).
//
// Ahora cada renglón con código se ancla a SU cuenta o grupo (la hoja se
// asigna al código listado más específico): varios códigos en un renglón son
// error; un código repetido sólo se admite en las dos porciones corriente / no
// corriente de un grupo que el balance de prueba parte por plazo, con los
// importes de la proyección determinista.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/agents/financial/agents/niif-analyst', () => ({ runNiifAnalyst: vi.fn() }));
vi.mock('@/lib/facts/report-facts', () => ({ getHechosEmpresaBlock: vi.fn(async () => '') }));

import {
  aplicarVencimientosDeclarados,
  parseTrialBalanceCSVWithMeta,
  preprocessTrialBalance,
  type PreprocessedBalance,
} from '@/lib/preprocessing/trial-balance';
import { financialExportBlockers } from '@/lib/export/financial-export-validation';
import { runNiifAnalyst } from '../agents/niif-analyst';
import { toNiifAnalysisResult } from '../agents/renderer';
import { buildNiifValidatorOptions, runNiifPhase } from '../orchestrator';
import { validateNiifReportJson } from '../validators/niif-json-validator';
import type { NiifReportJson } from '../contracts/niif-report';
import type { CompanyInfo } from '../types';
import {
  CSV_PERDIDA_COMPARATIVO,
  clonar,
  informeExportable,
  informeHonesto,
  linea,
  preprocesarPerdidaComparativo,
} from '../__fixtures__/perdida-comparativo-w4a';
import { informeTresCortes, preprocesarTresCortes } from '../__fixtures__/tres-cortes-comparativo';
import { CSV_R1, det, sub } from '../__fixtures__/r1-anticipo-credito';

type J = NiifReportJson;
const X = BigInt(100_000_000); // $1.000.000,00
const add = (v: string, d: bigint) => (BigInt(v) + d).toString();
const esf = (j: J, s: 'assets' | 'liabilities' | 'equity', acc: string) =>
  j.balanceSheet[s].find((l) => l.account === acc)!;
const eri = (j: J, acc: string) => j.incomeStatement.lines.find((l) => l.account === acc)!;

const pp = preprocesarPerdidaComparativo();
const options = buildNiifValidatorOptions(pp);

function e21(manipular: (j: J) => void, base: PreprocessedBalance = pp, build = informeHonesto): string[] {
  const j = clonar(build(base));
  manipular(j);
  const opts = base === pp ? options : buildNiifValidatorOptions(base);
  return validateNiifReportJson(j, opts).errors.filter((m) => m.startsWith('E21.'));
}

describe('E21 — un renglón con varios códigos es error (renglón puente)', () => {
  it('H1a / N1: puente "13 15" en $0 con 13 −$1M y 15 +$1M', () => {
    const e = e21((j) => {
      esf(j, 'assets', '13').amountPrimary = add(esf(j, 'assets', '13').amountPrimary, -X);
      esf(j, 'assets', '15').amountPrimary = add(esf(j, 'assets', '15').amountPrimary, X);
      j.balanceSheet.assets.push(linea('13 15', 'Reclasificaciones entre grupos', '0', '0'));
    });
    const txt = e.join('\n');
    expect(txt).toMatch(/"13 15 — Reclasificaciones entre grupos" declara varios códigos PUC \(13, 15\)/);
    expect(txt).toMatch(/"13 — [^"]*" imprime \$14\.000\.000,00 y las cuentas del balance de prueba de ese código suman \$15\.000\.000,00/);
    expect(txt).toMatch(/"15 — [^"]*" imprime \$81\.000\.000,00 y las cuentas del balance de prueba de ese código suman \$80\.000\.000,00/);
  });

  it('el puente solo, sin mover importes, también es error (no hay código que lo ancle)', () => {
    const e = e21((j) => {
      j.balanceSheet.assets.push(linea('13 15', 'Reclasificaciones entre grupos', '0', '0'));
    });
    expect(e).toHaveLength(1);
    expect(e[0]).toMatch(/periodo 2025.*varios códigos PUC \(13, 15\)/);
  });

  it('N1c: el traslado en la columna comparativa 2024 bajo el puente', () => {
    const e = e21((j) => {
      esf(j, 'assets', '13').amountComparative = add(esf(j, 'assets', '13').amountComparative!, -X);
      esf(j, 'assets', '15').amountComparative = add(esf(j, 'assets', '15').amountComparative!, X);
      j.balanceSheet.assets.push(linea('13 15', 'Reclasificaciones', '0', '0'));
    });
    expect(e.filter((m) => m.includes('periodo comparativo 2024') && /imprime \$19\.000\.000,00/.test(m))).toHaveLength(1);
    expect(e.filter((m) => m.includes('periodo comparativo 2024') && /imprime \$91\.000\.000,00/.test(m))).toHaveLength(1);
  });

  it('N18: pasivo, puente "21 22" con obligaciones financieras −$5M y proveedores +$5M', () => {
    const Y = BigInt(500_000_000);
    const e = e21((j) => {
      esf(j, 'liabilities', '21').amountPrimary = add(esf(j, 'liabilities', '21').amountPrimary, -Y);
      esf(j, 'liabilities', '22').amountPrimary = add(esf(j, 'liabilities', '22').amountPrimary, Y);
      j.balanceSheet.liabilities.push(linea('21 22', 'Reclasificaciones', '0', '0'));
    });
    const txt = e.join('\n');
    expect(txt).toMatch(/Pasivo \(periodo 2025\): "21 — [^"]*" imprime \$40\.000\.000,00/);
    expect(txt).toMatch(/Pasivo \(periodo 2025\): "22 — [^"]*" imprime \$30\.000\.000,00/);
    expect(txt).toMatch(/"21 22 — Reclasificaciones" declara varios códigos PUC/);
  });

  it('H1b / N2: ERI, puente "41 61" con ingresos $81M y costo $71M (UB intacta)', () => {
    const e = e21((j) => {
      eri(j, '41').amountPrimary = add(eri(j, '41').amountPrimary, X);
      eri(j, '61').amountPrimary = add(eri(j, '61').amountPrimary, X);
      j.incomeStatement.lines.push(linea('41 61', 'Reclasificación', '0', '0', { isAbsolute: true }));
    });
    const txt = e.join('\n');
    expect(txt).toMatch(/Estado de Resultados \(periodo 2025\): "41 — [^"]*" aporta \$81\.000\.000,00/);
    expect(txt).toMatch(/Estado de Resultados \(periodo 2025\): "61 — [^"]*" aporta -\$71\.000\.000,00/);
    expect(txt).toMatch(/"41 61 — Reclasificación" declara varios códigos PUC \(41, 61\)/);
  });

  it('N3: puente "51 53" que mueve $1M de gastos operativos a financieros (EBIT cambia)', () => {
    const e = e21((j) => {
      eri(j, '51').amountPrimary = add(eri(j, '51').amountPrimary, -X);
      eri(j, '53').amountPrimary = add(eri(j, '53').amountPrimary, X);
      j.incomeStatement.lines.push(linea('51 53', 'Reclasificación', '0', '0', { isAbsolute: true }));
    });
    expect(e.some((m) => m.includes('"51 — '))).toBe(true);
    expect(e.some((m) => m.includes('"53 — '))).toBe(true);
  });

  it('N2b: puente "51 52" con un 52 "Gastos de ventas" que el libro no tiene', () => {
    const e = e21((j) => {
      eri(j, '51').amountPrimary = add(eri(j, '51').amountPrimary, -X);
      j.incomeStatement.lines.splice(3, 0, linea('52', 'Gastos de ventas', X.toString(), '0', { isAbsolute: true }));
      j.incomeStatement.lines.push(linea('51 52', 'Reclasificación', '0', '0', { isAbsolute: true }));
    });
    expect(e.some((m) => m.includes('"52 — Gastos de ventas" aporta -$1.000.000,00'))).toBe(true);
    expect(e.some((m) => m.includes('"51 — '))).toBe(true);
  });

  it('N1b: tres cortes, puente "13 14" con deudores +$1M e inventarios −$1M (ambos corrientes)', () => {
    const tres = preprocesarTresCortes();
    const e = e21(
      (j) => {
        esf(j, 'assets', '13').amountPrimary = add(esf(j, 'assets', '13').amountPrimary, X);
        esf(j, 'assets', '14').amountPrimary = add(esf(j, 'assets', '14').amountPrimary, -X);
        j.balanceSheet.assets.push(linea('13 14', 'Reclasificaciones', '0', '0'));
      },
      tres,
      informeTresCortes,
    );
    expect(e.some((m) => /"13 — [^"]*" imprime \$46\.000\.000,00/.test(m))).toBe(true);
    expect(e.some((m) => /"14 — [^"]*" imprime \$27\.000\.000,00/.test(m))).toBe(true);
  });
});

describe('E21 — un código repetido sólo en las porciones de un grupo partido por plazo', () => {
  it('H1c / N5: "51 — Honorarios pagados a socios" $1M inventado junto al 51 por $39M', () => {
    const e = e21((j) => {
      const l51 = eri(j, '51');
      l51.amountPrimary = add(l51.amountPrimary, -X);
      j.incomeStatement.lines.splice(
        j.incomeStatement.lines.indexOf(l51) + 1,
        0,
        linea('51', 'Honorarios pagados a socios', X.toString(), '0', { isAbsolute: true }),
      );
    });
    expect(e.join('\n')).toMatch(/Estado de Resultados \(periodo 2025\): el código 51 aparece en 2 renglones/);
    expect(e.join('\n')).toContain('Honorarios pagados a socios');
  });

  it('N4: el grupo 13 partido en "Clientes" $14M y "Cuentas por cobrar a socios" $1M', () => {
    const e = e21((j) => {
      const l13 = esf(j, 'assets', '13');
      l13.amountPrimary = add(l13.amountPrimary, -X);
      j.balanceSheet.assets.splice(j.balanceSheet.assets.indexOf(l13) + 1, 0, linea('13', 'Cuentas por cobrar a socios', X.toString(), '0'));
    });
    expect(e.join('\n')).toMatch(/Activo \(periodo 2025\): el código 13 aparece en 2 renglones/);
  });

  it('un grupo que el libro NO parte por plazo no admite dos renglones aunque sumen lo mismo y vayan en bloques distintos', () => {
    const e = e21((j) => {
      const [c11, c13, c15] = ['11', '13', '15'].map((a) => BigInt(esf(j, 'assets', a).amountPrimary));
      j.balanceSheet.assets = [
        linea('11', 'Efectivo', c11.toString(), null),
        linea('13', 'Deudores', (c13 - X).toString(), null),
        linea(null, 'Total activo corriente', (c11 + c13 - X).toString(), null, { level: 3 }),
        linea('13', 'Cuentas por cobrar a socios', X.toString(), null),
        linea('15', 'PPE', c15.toString(), null),
        linea(null, 'Total activo no corriente', (c15 + X).toString(), null, { level: 3 }),
      ];
    });
    expect(e.some((m) => /el código 13 aparece en 2 renglones/.test(m))).toBe(true);
  });

  it('patrimonio: el capital (31) en dos renglones es error', () => {
    const e = e21((j) => {
      const l31 = esf(j, 'equity', '31');
      l31.amountPrimary = add(l31.amountPrimary, -X);
      j.balanceSheet.equity.push(linea('31', 'Capital por suscribir', X.toString(), '0'));
    });
    expect(e.some((m) => /Patrimonio \(periodo 2025\): el código 31 aparece en 2 renglones/.test(m))).toBe(true);
  });

  it('ERI: un renglón con un código que no es de resultados (1105, 2805, 9) no se imprime; el 38 del ORI no es E21', () => {
    for (const acc of ['1105', '2805', '9']) {
      const e = e21((j) => {
        j.incomeStatement.lines.push(linea(acc, 'Utilidad neta del ejercicio', '9999999900', null, { isAbsolute: true }));
      });
      expect(e.join('\n')).toMatch(new RegExp(`"${acc} — Utilidad neta del ejercicio" lleva un código que no es de resultados`));
    }
    const ori = e21((j) => {
      j.incomeStatement.lines.push(linea('3805', 'Superávit por revaluación (ORI)', '0', '0'));
    });
    expect(ori).toEqual([]);
  });

  it('un sub-renglón con código de detalle se ancla a su hoja: 510599 inexistente es error; 510506 + 516015 cuadran', () => {
    const inventado = e21((j) => {
      const l51 = eri(j, '51');
      l51.amountPrimary = add(l51.amountPrimary, -X);
      j.incomeStatement.lines.push(linea('510599', 'Honorarios a socios', X.toString(), '0', { isAbsolute: true }));
    });
    expect(inventado.some((m) => m.includes('"510599 — Honorarios a socios" aporta -$1.000.000,00'))).toBe(true);
    const honesto = e21((j) => {
      const i = j.incomeStatement.lines.indexOf(eri(j, '51'));
      j.incomeStatement.lines.splice(
        i,
        1,
        linea('510506', 'Sueldos', '3000000000', '4000000000', { isAbsolute: true }),
        linea('516015', 'Depreciación', '1000000000', '0', { isAbsolute: true }),
      );
    });
    expect(honesto).toEqual([]);
  });
});

// Grupo 21 partido por un vencimiento declarado (210510 → no corriente) y el
// grupo 28 de R1 (virtual 2810ZZ-133005, corriente por su origen) con una
// cuenta propia no corriente (281005).
const CSV_PARTIDO = CSV_R1.replace(
  '110505,Caja general,Auxiliar,1,30000000,10000000',
  '110505,Caja general,Auxiliar,1,30000000,18000000',
)
  .replace('220505,', '210510,Pagare a 3 anos,Auxiliar,1,0,5000000\n220505,')
  .replace('311505,', '281005,Depositos recibidos,Auxiliar,1,0,3000000\n311505,');

function ppPartido(): PreprocessedBalance {
  const { rows, errores } = aplicarVencimientosDeclarados(parseTrialBalanceCSVWithMeta(CSV_PARTIDO).rows, {
    '210510': 'no_corriente',
  });
  expect(errores).toEqual([]);
  return preprocessTrialBalance(rows);
}

/** ESF del modelo con los grupos 21 y 28 en sus dos porciones, una por bloque. */
function esfPartido(p: PreprocessedBalance): J {
  const json = informeHonesto(p);
  json.balanceSheet.assets = [
    det('11', 'Efectivo y equivalentes al efectivo', 18, 30),
    det('13', 'Deudores comerciales y otras cuentas por cobrar', 15, 20),
    sub('Total activo corriente', 33, 50),
    det('15', 'Propiedades, planta y equipo (neto)', 80, 90),
    sub('Total activo no corriente', 80, 90),
  ];
  json.balanceSheet.liabilities = [
    det('21', 'Obligaciones financieras de corto plazo', 45, 40),
    det('22', 'Proveedores', 25, 30),
    det('28', 'Otros pasivos — anticipo reclasificado (Nota R1)', 5, null),
    sub('Total pasivo corriente', 75, 70),
    det('21', 'Obligaciones financieras de largo plazo', 5, 0),
    det('28', 'Depósitos recibidos', 3, 0),
    sub('Total pasivo no corriente', 8, 0),
  ];
  return json;
}

describe('E21 — grupos partidos por plazo (sin falsos positivos)', () => {
  const p = ppPartido();
  const opts = buildNiifValidatorOptions(p);
  const errs = (j: J) => validateNiifReportJson(j, opts).errors.filter((m) => /^E2[17]\./.test(m));

  it('el fixture parte 21 (vencimiento declarado) y 28 (virtual de R1 + cuenta propia)', () => {
    expect(p.primary.controlTotals.pasivoCorriente).toBe(75_000_000);
    expect(p.primary.controlTotals.pasivoNoCorriente).toBe(8_000_000);
  });

  it('las dos porciones de cada grupo, una por bloque, con los importes de la proyección: sin E21 ni E27', () => {
    expect(errs(esfPartido(p))).toEqual([]);
  });

  it('sin subtotales de plazo (bloques no determinables) las porciones también cuadran como multiconjunto', () => {
    const j = esfPartido(p);
    j.balanceSheet.liabilities = j.balanceSheet.liabilities.filter((l) => l.account !== null);
    expect(validateNiifReportJson(j, opts).errors.filter((m) => m.startsWith('E21.'))).toEqual([]);
  });

  it('$1M trasladado entre las dos porciones del 21 (subtotales ajustados) es error E21', () => {
    const j = esfPartido(p);
    const [cp, lp] = j.balanceSheet.liabilities.filter((l) => l.account === '21');
    cp.amountPrimary = add(cp.amountPrimary, -X);
    lp.amountPrimary = add(lp.amountPrimary, X);
    const sc = j.balanceSheet.liabilities.find((l) => l.label === 'Total pasivo corriente')!;
    const snc = j.balanceSheet.liabilities.find((l) => l.label === 'Total pasivo no corriente')!;
    sc.amountPrimary = add(sc.amountPrimary, -X);
    snc.amountPrimary = add(snc.amountPrimary, X);
    const e = validateNiifReportJson(j, opts).errors.filter((m) => m.startsWith('E21.'));
    expect(e).toHaveLength(1);
    expect(e[0]).toMatch(/el grupo 21 se presenta partido por plazo.*\$44\.000\.000,00 \(corriente\).*\$6\.000\.000,00 \(no corriente\).*\$45\.000\.000,00.*\$5\.000\.000,00/);
  });

  it('las dos porciones intercambiadas de bloque son error E21', () => {
    const j = esfPartido(p);
    const [cp, lp] = j.balanceSheet.liabilities.filter((l) => l.account === '21');
    [cp.amountPrimary, lp.amountPrimary] = [lp.amountPrimary, cp.amountPrimary];
    expect(validateNiifReportJson(j, opts).errors.some((m) => /^E21\..*grupo 21 se presenta partido/.test(m))).toBe(true);
  });

  it('las dos porciones en el mismo bloque son error E21', () => {
    const j = esfPartido(p);
    const lp = j.balanceSheet.liabilities.find((l) => l.label === 'Obligaciones financieras de largo plazo')!;
    j.balanceSheet.liabilities = j.balanceSheet.liabilities.filter((l) => l !== lp);
    j.balanceSheet.liabilities.splice(1, 0, lp);
    expect(validateNiifReportJson(j, opts).errors.some((m) => /^E21\..*código 21 aparece en 2 renglones del mismo bloque/.test(m))).toBe(true);
  });

  it('un tercer renglón del grupo partido es error E21', () => {
    const j = esfPartido(p);
    j.balanceSheet.liabilities.splice(5, 0, det('21', 'Obligaciones con socios', 0, 0));
    expect(validateNiifReportJson(j, opts).errors.some((m) => /^E21\..*código 21 aparece en 3 renglones/.test(m))).toBe(true);
  });
});

describe('ruta real — la fase NIIF sella y el gate de exportación bloquea', () => {
  const COMPANY: CompanyInfo = {
    name: 'Demo Perdidas SAS',
    nit: '900123456-8',
    entityType: 'SAS',
    fiscalPeriod: '2025',
    niifGroup: 2,
  };
  const puente = (): J => {
    const j = clonar(informeHonesto(pp));
    esf(j, 'assets', '13').amountPrimary = add(esf(j, 'assets', '13').amountPrimary, -X);
    esf(j, 'assets', '15').amountPrimary = add(esf(j, 'assets', '15').amountPrimary, X);
    j.balanceSheet.assets.push(linea('13 15', 'Reclasificaciones entre grupos', '0', '0'));
    return j;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runNiifPhase: el puente "13 15" deja la reconciliación sucia con E21 en el informe', async () => {
    vi.mocked(runNiifAnalyst).mockResolvedValue({
      ...toNiifAnalysisResult(puente()),
      reconciliation: { clean: true, deviations: [], lineGaps: [], repairAttempted: false },
    });
    const phase = await runNiifPhase(
      { rawData: CSV_PERDIDA_COMPARATIVO, company: COMPANY, language: 'es' },
      { preprocessed: preprocesarPerdidaComparativo() },
    );
    expect(phase.niif.reconciliation?.clean).toBe(false);
    expect(phase.niif.fullContent).toMatch(/E21\. Estado de Situación Financiera — Activo \(periodo 2025\): el renglón "13 15/);
  });

  it('financialExportBlockers: el mismo informe no se exporta (fuente incoherente E21)', () => {
    const b = financialExportBlockers(informeExportable(puente()), pp);
    expect(b.some((m) => m.startsWith('E21.') && m.includes('13 15'))).toBe(true);
  });

  it('el informe honesto sigue exportándose sin bloqueos', () => {
    expect(financialExportBlockers(informeExportable(informeHonesto(pp)), pp)).toEqual([]);
  });
});
