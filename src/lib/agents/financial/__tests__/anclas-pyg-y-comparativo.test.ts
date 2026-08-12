// ---------------------------------------------------------------------------
// Las cifras del P&G y la columna comparativa dejan de ser libres
// ---------------------------------------------------------------------------
// La auditoría de cálculos 2026-08 (docs/AUDITORIA_CALCULOS_2026-08.md) midió,
// sobre el único balance de cliente real del repo y con el output de una
// corrida con LLM real, que estas manipulaciones producían **0 errores, 0
// warnings, `clean = true` y descarga habilitada**:
//
//   · impuesto de renta inventado de $700.000.000
//   · impuesto de renta como ingreso (−$700.000.000)
//   · `grossProfitPrimary` inflado en $500.000.000  ← y la cifra falsa se
//     promovía a *binding figure* del HTML, donde `reconcileBindingFigures`
//     EXIGE reproducirla literalmente
//   · `operatingProfitPrimary` (EBIT) inflado en $500.000.000
//   · el subtotal impreso "UTILIDAD ANTES DE IMPUESTOS" inflado
//   · `incomeStatement.lines = []`
//   · el renglón de ingresos multiplicado ×3
//   · la duplicación del Grupo 53 (E8 existía y nadie le pasaba el total)
//
// Y que la columna comparativa del Balance salía con "n/c" en las once líneas
// de detalle bajo un TOTAL ACTIVOS 2024 de $2.798.204.117,50 que ningún
// renglón sostenía (NIIF para las PYMES §3.14).
//
// Este test fija esas mediciones. No usa mocks de agentes: parte del balance
// real, lo pasa por el preprocesador determinista y valida con las MISMAS
// opciones que arma el orquestador en producción (`buildNiifValidatorOptions`),
// para que no pueda repetirse el patrón que la auditoría integral nombró —un
// cruce escrito, correcto, y sin llamador.
// ---------------------------------------------------------------------------

import { describe, expect, it, beforeAll } from 'vitest';
import path from 'node:path';
import ExcelJS from 'exceljs';

import {
  parseTrialBalanceCSV,
  preprocessTrialBalance,
  type PreprocessedBalance,
} from '@/lib/preprocessing/trial-balance';
import { buildReportAnchors } from '@/lib/agents/financial/contracts/anchors';
import {
  reconcileAnchors,
  completeBreakdownFromSnapshot,
  fillComparativeBreakdownFromSnapshot,
} from '@/lib/agents/financial/agents/reconcile-anchors';
import { validateNiifReportJson } from '@/lib/agents/financial/validators/niif-json-validator';
import { buildNiifValidatorOptions } from '@/lib/agents/financial/orchestrator';
import { parseMoneyCop, serializeMoneyCop } from '@/lib/agents/financial/contracts/money';
import { NiifReportSchema, type NiifReportJson } from '@/lib/agents/financial/contracts/niif-report';

const FIXTURES = path.resolve(process.cwd(), 'src/lib/preprocessing/__fixtures__');

/** El único export de ERP real del repo: header en la fila 8, saldos firmados. */
async function loadRealBalance(): Promise<PreprocessedBalance> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(FIXTURES, 'grupo-empresarial-2tres-sas.xlsx'));
  const ws = wb.worksheets[0];
  const lines: string[] = [];
  ws.eachRow((row) => {
    const values = row.values as unknown[];
    lines.push(
      values
        .slice(1)
        .map((v) => {
          if (v === null || v === undefined) return '';
          if (typeof v === 'string') return v;
          if (typeof v === 'number') return String(v);
          const o = v as { text?: string; result?: unknown };
          return o.text ?? (o.result !== undefined ? String(o.result) : String(v));
        })
        .join(','),
    );
  });
  return preprocessTrialBalance(parseTrialBalanceCSV(lines.slice(7).join('\n')));
}

function linea(
  account: string | null,
  label: string,
  cents: string,
  level: 0 | 1 | 2 | 3 | 4,
  comparative: string | null = null,
) {
  return {
    account,
    label,
    amountPrimary: cents,
    amountComparative: comparative,
    level,
    isAbsolute: true,
    confidence: 'high' as const,
    anomalyFlag: null,
  };
}

/**
 * Estados financieros tal como los emitió el modelo en la corrida real de
 * cierre (`.fase0-final2/raw-…-run1.json`), reducidos a lo que estos
 * invariantes miran. Las cifras son literales de esa corrida.
 */
function informeCorrecto(): NiifReportJson {
  return {
    company: {
      name: 'Grupo Empresarial 2 Tres SAS',
      nit: '901.714.014-6',
      entityType: 'SAS',
      sector: null,
      niifGroup: 2,
      fiscalPeriod: '2025',
      comparativePeriod: '2024',
      city: null,
      signatories: null,
    },
    balanceSheet: {
      assets: [
        linea('11', 'Efectivo y equivalentes de efectivo', '241367788864', 2),
        linea('13', 'Deudores comerciales y otras cuentas por cobrar', '9817925895', 2),
        linea('14', 'Inventarios', '167021576929', 2),
        linea('15', 'Propiedades, planta y equipo', '6638628', 2),
        linea('18', 'Otros activos', '383953800', 2),
      ],
      liabilities: [
        linea('22', 'Proveedores', '180151828812', 2),
        linea('23', 'Cuentas por pagar', '3059408350', 2),
        linea('24', 'Impuestos, gravámenes y tasas', '10553782441', 2),
        linea('28', 'Otros pasivos', '2488865359', 2),
      ],
      equity: [
        linea('36', 'Resultados del ejercicio', '222849678973', 2),
        linea('37', 'Resultados de ejercicios anteriores', '-505679819', 2),
      ],
      totalAssetsPrimary: '418597884116',
      totalAssetsComparative: '279820411750',
      totalLiabilitiesPrimary: '196253884962',
      totalLiabilitiesComparative: '123226317839',
      totalEquityPrimary: '222343999154',
      totalEquityComparative: '156594093911',
      notes: [],
      modeBanner: null,
    },
    incomeStatement: {
      lines: [
        linea('4', 'Ingresos de actividades ordinarias', '242910953157', 1, '167631515047'),
        linea('74', '(-) Costos de producción', '1250000000', 2, '1250000000'),
        linea(null, 'UTILIDAD BRUTA', '241660953157', 3, '166381515047'),
        linea('51', '(-) Gastos administrativos', '16654133410', 2, '7886222859'),
        linea('52', '(-) Gastos de ventas', '543139932', 2, '464886667'),
        linea(null, 'RESULTADO OPERACIONAL — EBIT', '224463679815', 3, '158030405521'),
        linea('53', '(-) Gastos no operacionales', '1614000842', 2, '758258225'),
        linea(null, 'UTILIDAD ANTES DE IMPUESTOS', '222849678973', 3, '157272147296'),
        linea('54', '(-) Gasto por impuesto de renta', '0', 2, '0'),
        linea(null, 'UTILIDAD NETA DEL EJERCICIO', '222849678973', 4, '157272147296'),
      ],
      grossProfitPrimary: '241660953157',
      grossProfitComparative: '166381515047',
      operatingProfitPrimary: '224463679815',
      operatingProfitComparative: '158030405521',
      netIncomePrimary: '222849678973',
      netIncomeComparative: '157272147296',
      oriPrimary: '0',
      oriComparative: '0',
      notes: [],
      modeBanner: null,
    },
    cashFlow: {
      sections: [
        {
          section: 'operating',
          lines: [linea(null, 'Utilidad neta del periodo', '222849678973', 2)],
          netFlow: '85019233463',
        },
        { section: 'investing', lines: [], netFlow: '0' },
        { section: 'financing', lines: [], netFlow: '0' },
      ],
      netChange: '85019233463',
      cashOpening: '156348555401',
      cashClosing: '241367788864',
      methodNote: 'indirect',
      degeneracyFlag: null,
    },
    equityChanges: {
      rows: [
        {
          kind: 'opening_balance',
          label: 'Saldo al 1 de enero de 2025',
          capitalSocial: '0',
          primaColocacion: '0',
          reservaLegal: '0',
          otrasReservas: '0',
          resultadosAcumulados: '-505679819',
          resultadoEjercicio: '0',
          ori: '0',
          total: '-505679819',
        },
        {
          kind: 'profit_for_period',
          label: 'Resultado del ejercicio 2025',
          capitalSocial: '0',
          primaColocacion: '0',
          reservaLegal: '0',
          otrasReservas: '0',
          resultadosAcumulados: '0',
          resultadoEjercicio: '222849678973',
          ori: '0',
          total: '222849678973',
        },
        {
          kind: 'closing_balance',
          label: 'Saldo al 31 de diciembre de 2025',
          capitalSocial: '0',
          primaColocacion: '0',
          reservaLegal: '0',
          otrasReservas: '0',
          resultadosAcumulados: '-505679819',
          resultadoEjercicio: '222849678973',
          ori: '0',
          total: '222343999154',
        },
      ],
      notes: [],
    },
    technicalNotes: [],
    curatorFlags: {
      equityConvergenceApplied: false,
      cashFlowClosureForced: false,
      negativeAssetReclassified: false,
      presumedCostWarning: false,
      reclassifiedAmountCop: '0',
    },
    reportMode: 'COMPARATIVO_COMPLETO',
  };
}

function clonar(j: NiifReportJson): NiifReportJson {
  return JSON.parse(JSON.stringify(j)) as NiifReportJson;
}

function sumar(base: string, delta: bigint): string {
  return serializeMoneyCop(parseMoneyCop(base) + delta);
}

const QUINIENTOS_MILLONES = BigInt(50_000_000_000); // centavos

describe('anclas del P&G — las cuatro cifras que la auditoría midió como libres', () => {
  let pp: PreprocessedBalance;

  beforeAll(async () => {
    pp = await loadRealBalance();
  }, 60_000);

  it('el informe correcto sigue saliendo limpio (sin falsos positivos)', () => {
    const r = validateNiifReportJson(informeCorrecto(), buildNiifValidatorOptions(pp));
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('la fixture de referencia es un NiifReport válido para el schema estricto', () => {
    expect(NiifReportSchema.safeParse(informeCorrecto()).success).toBe(true);
  });

  it('el preprocesador entrega Utilidad Bruta y EBIT en centavos exactos, ambos periodos', () => {
    const a = buildReportAnchors(pp.primary, pp.comparative ?? undefined);
    expect(a.primary?.cents.utilidadBruta).toBe(BigInt('241660953157'));
    expect(a.primary?.cents.ebit).toBe(BigInt('224463679815'));
    expect(a.comparative?.cents.utilidadBruta).toBe(BigInt('166381515047'));
    expect(a.comparative?.cents.ebit).toBe(BigInt('158030405521'));
    // Σ Clase 5 — el total que E8 necesitaba y que el call-site no pasaba.
    expect(a.primary?.cents.gastosClase5).toBe(BigInt('18811274184'));
  });

  const manipulaciones: Array<[string, (j: NiifReportJson) => void]> = [
    [
      'impuesto de renta inventado de $700.000.000',
      (j) => {
        j.incomeStatement.lines.find((l) => l.account === '54')!.amountPrimary = '70000000000';
      },
    ],
    [
      'impuesto de renta como ingreso (−$700.000.000)',
      (j) => {
        j.incomeStatement.lines.find((l) => l.account === '54')!.amountPrimary = '-70000000000';
      },
    ],
    [
      'grossProfitPrimary inflado en $500.000.000',
      (j) => {
        j.incomeStatement.grossProfitPrimary = sumar(
          j.incomeStatement.grossProfitPrimary,
          QUINIENTOS_MILLONES,
        );
      },
    ],
    [
      'operatingProfitPrimary (EBIT) inflado en $500.000.000',
      (j) => {
        j.incomeStatement.operatingProfitPrimary = sumar(
          j.incomeStatement.operatingProfitPrimary,
          QUINIENTOS_MILLONES,
        );
      },
    ],
    [
      'grossProfitComparative inflado en $500.000.000',
      (j) => {
        j.incomeStatement.grossProfitComparative = sumar(
          j.incomeStatement.grossProfitComparative!,
          QUINIENTOS_MILLONES,
        );
      },
    ],
    [
      'operatingProfitComparative inflado en $500.000.000',
      (j) => {
        j.incomeStatement.operatingProfitComparative = sumar(
          j.incomeStatement.operatingProfitComparative!,
          QUINIENTOS_MILLONES,
        );
      },
    ],
    [
      'el subtotal impreso UTILIDAD ANTES DE IMPUESTOS inflado',
      (j) => {
        const l = j.incomeStatement.lines.find((x) => x.label.includes('ANTES DE IMPUESTOS'))!;
        l.amountPrimary = sumar(l.amountPrimary, QUINIENTOS_MILLONES);
      },
    ],
    [
      'P&G sin un solo renglón (lines = [])',
      (j) => {
        j.incomeStatement.lines = [];
      },
    ],
    [
      'renglón de ingresos multiplicado ×3',
      (j) => {
        const l = j.incomeStatement.lines.find((x) => x.account === '4')!;
        l.amountPrimary = serializeMoneyCop(parseMoneyCop(l.amountPrimary) * BigInt(3));
      },
    ],
    [
      'duplicación del Grupo 53 (grupo + subcuenta 5305)',
      (j) => {
        const l53 = j.incomeStatement.lines.find((x) => x.account === '53')!;
        j.incomeStatement.lines.push({
          ...l53,
          account: '5305',
          label: '(-) Gastos financieros 5305',
          amountPrimary: '1612203337',
        });
      },
    ],
  ];

  it.each(manipulaciones)('produce error: %s', (_nombre, manipular) => {
    const j = clonar(informeCorrecto());
    manipular(j);
    const r = validateNiifReportJson(j, buildNiifValidatorOptions(pp));
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.ok).toBe(false);
  });

  it('borrar un impuesto real deja de pasar limpio', () => {
    // El balance testigo tiene grupo 54 = $0, así que el escenario se construye
    // al revés: con un ancla de impuesto material, omitir la línea es un error.
    const j = clonar(informeCorrecto());
    j.incomeStatement.lines = j.incomeStatement.lines.filter((l) => l.account !== '54');
    const options = buildNiifValidatorOptions(pp);
    const conImpuestoReal = {
      ...options,
      bindingPrimaryTotalsCents: {
        ...options.bindingPrimaryTotalsCents,
        impuestoCausado: '6300000000', // $63.000.000
      },
    };
    const r = validateNiifReportJson(j, conImpuestoReal);
    expect(r.errors.some((e) => e.includes('Impuesto de renta del periodo'))).toBe(true);
  });
});

describe('columna comparativa del Balance (NIIF para las PYMES §3.14)', () => {
  let pp: PreprocessedBalance;

  beforeAll(async () => {
    pp = await loadRealBalance();
  }, 60_000);

  it('el desglose comparativo determinista cuadra con las tres anclas de 2024', () => {
    const anchors = buildReportAnchors(pp.primary, pp.comparative ?? undefined);
    const json = clonar(informeCorrecto());
    // El analista deja el detalle incompleto: es lo que dispara el completado.
    json.balanceSheet.assets = json.balanceSheet.assets.slice(0, 2);
    const rec = reconcileAnchors(json, anchors);
    expect(rec.lineGaps.length).toBeGreaterThan(0);

    const { json: completado } = completeBreakdownFromSnapshot(
      rec.json,
      rec.lineGaps,
      pp.primary,
      pp.comparative ?? undefined,
    );
    const { json: conComparativo } = fillComparativeBreakdownFromSnapshot(
      completado,
      pp.comparative ?? undefined,
    );

    const esperado: Record<'assets' | 'liabilities' | 'equity', bigint> = {
      assets: anchors.comparative!.cents.activo!,
      liabilities: anchors.comparative!.cents.pasivo!,
      equity: anchors.comparative!.cents.patrimonio!,
    };
    for (const seccion of ['assets', 'liabilities', 'equity'] as const) {
      const lineas = conComparativo.balanceSheet[seccion];
      // Cero "n/c": la auditoría midió 11 de 11 renglones sin cifra comparativa.
      expect(lineas.filter((l) => l.amountComparative === null)).toHaveLength(0);
      const suma = lineas.reduce(
        (acc, l) => acc + parseMoneyCop(l.amountComparative as string),
        BigInt(0),
      );
      // Tolerancia $0 — es la misma proyección determinista que el ancla.
      expect(suma).toBe(esperado[seccion]);
    }
  });

  it('el JSON con la columna comparativa sigue siendo válido para el schema estricto', () => {
    const { json } = fillComparativeBreakdownFromSnapshot(
      informeCorrecto(),
      pp.comparative ?? undefined,
    );
    expect(NiifReportSchema.safeParse(json).success).toBe(true);
  });

  it('no toca el desglose propio del analista cuando no es la proyección determinista', () => {
    const json = clonar(informeCorrecto());
    // Códigos de cuenta auxiliar (6 dígitos): mapearlos a grupos del comparativo
    // produciría doble conteo, así que la función debe abstenerse.
    json.balanceSheet.assets = [linea('110505', 'Caja general', '241367788864', 2)];
    const { filled } = fillComparativeBreakdownFromSnapshot(json, pp.comparative ?? undefined);
    expect(filled).not.toContain('Activo');
  });
});
