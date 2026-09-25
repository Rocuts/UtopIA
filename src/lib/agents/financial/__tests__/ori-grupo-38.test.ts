// ---------------------------------------------------------------------------
// ORI del periodo = variación del grupo PUC 38 (enmienda 12, spec v2.1)
// ---------------------------------------------------------------------------
// Conflicto de diseño heredado de P2 (integración I4, objetivo 1): el ECP
// determinista registra la variación del grupo 38 (superávit por
// valorizaciones / ORI) en la columna ORI; E24 exige que esa columna sea el
// saldo del grupo 38 en cada corte y E6 que su variación sea el ORI del ERI;
// E6b, en cambio, exigía ORI $0 en el ERI (ORI_COMPONENT_MAP vacío). Con un
// grupo 38 que se movió en el año, ninguna cifra del ERI satisfacía E6 y E6b a
// la vez: el informe honesto salía sellado.
//
// Regla (NIIF para las PYMES, Secciones 5 y 6 — 6.3(c): el ORI del estado del
// resultado integral es el cambio de la columna ORI del ECP): el ORI del
// periodo es Δ grupo 38 entre el corte de apertura y el de cierre, lo calcula
// el código (`buildOriAnchors`) y el ERI lo copia en ambos periodos. Sin corte
// de apertura del comparativo y con saldo en el grupo 38, el ORI comparativo es
// N/D (null), nunca $0.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';

const callFinancialAgentMock = vi.fn();
vi.mock('@/lib/agents/financial/agents/runtime', () => ({
  callFinancialAgent: (opts: unknown) => callFinancialAgentMock(opts),
}));
vi.mock('@/lib/facts/report-facts', () => ({ getHechosEmpresaBlock: vi.fn(async () => '') }));

import { buildNiifValidatorOptions, runNiifPhase } from '@/lib/agents/financial/orchestrator';
import {
  csvDosCortes,
  csvTresCortesConValorizaciones,
  informeTresCortes,
  preprocesarTresCortes,
} from '@/lib/agents/financial/__fixtures__/tres-cortes-comparativo';
import { clonar } from '@/lib/agents/financial/__fixtures__/perdida-comparativo-w4a';
import {
  buildComparativeStatementsBasis,
  buildDeterministicEquityChanges,
  buildOriAnchors,
} from '@/lib/agents/financial/contracts/deterministic-breakdown';
import type { NiifReportJson } from '@/lib/agents/financial/contracts/niif-report';
import {
  buildNiifAnalystPass1Prompt,
  buildNiifAnalystPass2Prompt,
} from '@/lib/agents/financial/prompts/niif-analyst.prompt';
import { validateNiifReportJson } from '@/lib/agents/financial/validators/niif-json-validator';
import type { CompanyInfo } from '@/lib/agents/financial/types';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';

const M = (pesos: number) => (BigInt(pesos) * BigInt(100)).toString();

const COMPANY: CompanyInfo = {
  name: 'Demo Tres Cortes SAS',
  nit: '900765432-6',
  entityType: 'SAS',
  fiscalPeriod: '2025',
  comparativePeriod: '2024',
  niifGroup: 2,
};

function validar(json: NiifReportJson, pp: PreprocessedBalance) {
  return validateNiifReportJson(json, buildNiifValidatorOptions(pp));
}

const e6 = (errors: string[]) => errors.filter((e) => /^E6/.test(e));

/** El LLM devuelve el informe honesto, pase por pase. */
function mockPasses(json: NiifReportJson) {
  callFinancialAgentMock.mockImplementation(async (opts: { agentName: string }) => {
    if (opts.agentName.startsWith('niif-analyst-pass1')) {
      return {
        json: {
          company: json.company,
          balanceSheet: json.balanceSheet,
          incomeStatement: json.incomeStatement,
          curatorFlags: json.curatorFlags,
          reportMode: json.reportMode,
        },
        meta: {},
      };
    }
    if (opts.agentName === 'niif-analyst-pass2') {
      return {
        json: {
          cashFlow: {
            ...json.cashFlow,
            sections: json.cashFlow.sections.map((s) => ({
              section: s.section,
              netFlow: s.netFlow,
              lines: s.lines.filter((l) => l.amountPrimary !== '0'),
            })),
          },
          equityChanges: { rows: json.equityChanges.rows, notes: [] },
        },
        meta: {},
      };
    }
    return { json: { technicalNotes: [] }, meta: {} };
  });
}

beforeEach(() => {
  callFinancialAgentMock.mockReset();
});

describe('ancla del ORI — Δ grupo 38 por periodo', () => {
  it('tres cortes: ORI actual = Δ38 2024→2025 y ORI comparativo = Δ38 2023→2024', () => {
    const pp = preprocesarTresCortes(csvTresCortesConValorizaciones([0, 3_000_000, 8_000_000]));
    const a = buildOriAnchors(pp);
    expect(a.primary).toEqual({ kind: 'measured', cents: BigInt(M(5_000_000)), openingPeriod: '2024', closingPeriod: '2025' });
    expect(a.comparative).toEqual({ kind: 'measured', cents: BigInt(M(3_000_000)), openingPeriod: '2023', closingPeriod: '2024' });
  });

  it('el ECP determinista lleva exactamente el ancla en su fila de ORI', () => {
    const pp = preprocesarTresCortes(csvTresCortesConValorizaciones([0, 3_000_000, 8_000_000]));
    const ecp = buildDeterministicEquityChanges(pp.comparative!, pp.primary);
    if (!('rows' in ecp)) throw new Error(ecp.reason);
    const ori = ecp.rows.find((r) => r.kind === 'other_comprehensive_income')!;
    expect(ori.ori).toBe(M(5_000_000));
    expect(buildComparativeStatementsBasis(pp)!.oriCents).toBe(BigInt(M(3_000_000)));
  });

  it('dos cortes: el ORI comparativo no es medible — N/D con saldo en el grupo 38, $0 sin él', () => {
    const conSaldo = preprocesarTresCortes(csvDosCortesDe(csvTresCortesConValorizaciones([0, 3_000_000, 8_000_000])));
    const b = buildOriAnchors(conSaldo);
    expect(b.primary).toMatchObject({ kind: 'measured', cents: BigInt(M(5_000_000)) });
    expect(b.comparative?.kind).toBe('notMeasurable');
    const sinSaldo = buildOriAnchors(preprocesarTresCortes(csvDosCortes()));
    expect(sinSaldo.comparative).toEqual({ kind: 'noGroup38', cents: BigInt(0) });
  });
});

describe('E6/E6b coherentes con el ECP determinista (objetivo 1)', () => {
  it('grupo 38 que se mueve en el periodo actual: el informe honesto (ORI del ERI = Δ38) no dispara E6/E6b', () => {
    const pp = preprocesarTresCortes(csvTresCortesConValorizaciones([0, 0, 5_000_000]));
    const json = informeTresCortes(pp);
    expect(json.incomeStatement.oriPrimary).toBe(M(5_000_000));
    expect(json.equityChanges.rows.find((r) => r.kind === 'other_comprehensive_income')?.ori).toBe(M(5_000_000));
    expect(e6(validar(json, pp).errors)).toEqual([]);
    expect(validar(json, pp).errors).toEqual([]);
  });

  it('ese mismo informe con ORI $0 en el ERI es error (E6 contra el ECP y E6b contra el ancla)', () => {
    const pp = preprocesarTresCortes(csvTresCortesConValorizaciones([0, 0, 5_000_000]));
    const json = clonar(informeTresCortes(pp));
    json.incomeStatement.oriPrimary = '0';
    const errors = validar(json, pp).errors;
    expect(errors.some((e) => e.startsWith('E6. '))).toBe(true);
    expect(errors.filter((e) => e.startsWith('E6b.'))).toEqual([
      'E6b. ORI del ERI 2025 ($0,00) ≠ variación del grupo PUC 38 (superávit por valorizaciones / ORI) ' +
        'entre los cortes 2024 y 2025 ($5.000.000,00). Brecha: -$5.000.000,00. El ORI del periodo es el ' +
        'movimiento de la columna ORI del ECP (NIIF para las PYMES, Secciones 5 y 6 — 6.3(c)); lo calcula el ' +
        'código y el ERI lo copia.',
    ]);
  });

  it('un ORI inventado que el ECP acompaña sigue bloqueado aunque cuadre consigo mismo (E6b + E24)', () => {
    const pp = preprocesarTresCortes(csvTresCortesConValorizaciones([0, 0, 5_000_000]));
    const json = clonar(informeTresCortes(pp));
    json.incomeStatement.oriPrimary = M(6_000_000);
    const row = json.equityChanges.rows.find((r) => r.kind === 'other_comprehensive_income')!;
    row.ori = M(6_000_000);
    row.total = String(BigInt(row.total) + BigInt(M(1_000_000)));
    const errors = validar(json, pp).errors;
    expect(errors.some((e) => e.startsWith('E6b.'))).toBe(true);
  });

  it('grupo 38 que se mueve sólo en el comparativo: ORI comparativo = Δ38 del comparativo; $0 es error', () => {
    const pp = preprocesarTresCortes(csvTresCortesConValorizaciones([0, 5_000_000, 5_000_000]));
    const json = informeTresCortes(pp);
    expect(json.incomeStatement.oriPrimary).toBe('0');
    expect(json.incomeStatement.oriComparative).toBe(M(5_000_000));
    expect(validar(json, pp).errors).toEqual([]);

    const cero = clonar(json);
    cero.incomeStatement.oriComparative = '0';
    const errors = validar(cero, pp).errors;
    expect(errors.some((e) => e.startsWith('E6b.') && e.includes('comparativo 2024'))).toBe(true);
    expect(errors.some((e) => e.startsWith('E6. ECP (periodo comparativo 2024)'))).toBe(true);

    // Un ORI comparativo N/D cuando el código lo midió distinto de $0 también es error.
    const nd = clonar(json);
    nd.incomeStatement.oriComparative = null;
    expect(validar(nd, pp).errors.some((e) => e.startsWith('E6b.'))).toBe(true);
  });

  it('dos cortes con saldo en el grupo 38: el ORI comparativo se presenta N/D (null); $0 es error', () => {
    const csv = csvDosCortesDe(csvTresCortesConValorizaciones([0, 3_000_000, 8_000_000]));
    const pp = preprocesarTresCortes(csv);
    const json = informeTresCortes(pp);
    expect(json.incomeStatement.oriPrimary).toBe(M(5_000_000));
    expect(json.incomeStatement.oriComparative).toBeNull();
    expect(validar(json, pp).errors).toEqual([]);

    const cero = clonar(json);
    cero.incomeStatement.oriComparative = '0';
    expect(validar(cero, pp).errors.filter((e) => e.startsWith('E6b.'))).toEqual([
      'E6b. ORI del ERI comparativo 2024 ($0,00): sin un corte de apertura utilizable del periodo ' +
        'comparativo la variación del grupo PUC 38 (saldo al cierre de 2024: $3.000.000,00) no es medible; ' +
        'el ORI comparativo se presenta N/D (null), no $0,00.',
    ]);
  });

  it('fixtures honestos sin grupo 38 no cambian: ORI $0 en ambos periodos y sin errores', () => {
    const pp = preprocesarTresCortes();
    const json = informeTresCortes(pp);
    expect(json.incomeStatement.oriPrimary).toBe('0');
    expect(json.incomeStatement.oriComparative).toBe('0');
    expect(validar(json, pp).errors).toEqual([]);
    const pp2 = preprocesarTresCortes(csvDosCortes());
    expect(validar(informeTresCortes(pp2), pp2).errors).toEqual([]);
  });
});

describe('ruta real — runNiifPhase con el LLM simulado', () => {
  it('Δ38 ≠ 0 en el periodo actual: el informe honesto sale limpio, sin sello ni E6/E6b', async () => {
    const csv = csvTresCortesConValorizaciones([0, 0, 5_000_000]);
    const pp = preprocesarTresCortes(csv);
    mockPasses(informeTresCortes(pp));
    const phase = await runNiifPhase({ rawData: csv, company: COMPANY, language: 'es' }, { preprocessed: pp });
    expect(phase.niif.fullContent).not.toMatch(/E6b?\./);
    expect(phase.niif.reconciliation?.clean).toBe(true);
    expect(phase.niif.json!.incomeStatement.oriPrimary).toBe(M(5_000_000));
  });

  it('el prompt del Pass-1 publica el ancla del ORI y el del Pass-2 ya no fija oriPrimary en "0"', () => {
    const pp = preprocesarTresCortes(csvTresCortesConValorizaciones([0, 3_000_000, 8_000_000]));
    const p1 = buildNiifAnalystPass1Prompt(COMPANY, 'es', 'COMPARATIVO_COMPLETO', pp);
    expect(p1).toContain(`[MoneyCop: ${M(5_000_000)}] → oriPrimary`);
    expect(p1).toContain(`[MoneyCop: ${M(3_000_000)}] → oriComparative`);
    const anchors = {
      totalAssetsPrimary: '0', totalLiabilitiesPrimary: '0', totalEquityPrimary: '0', netIncomePrimary: '0',
      oriPrimary: M(5_000_000), totalAssetsComparative: null, totalLiabilitiesComparative: null,
      totalEquityComparative: null, grossProfitComparative: null, operatingProfitComparative: null,
      netIncomeComparative: null, oriComparative: null,
      curatorFlags: {
        equityConvergenceApplied: false, cashFlowClosureForced: false, negativeAssetReclassified: false,
        presumedCostWarning: false, reclassifiedAmountCop: '0',
      },
    };
    const p2 = buildNiifAnalystPass2Prompt(COMPANY, 'es', 'COMPARATIVO_COMPLETO', anchors, pp);
    expect(p2).not.toContain('oriPrimary = "0"');
    expect(p2).toMatch(/other_comprehensive_income/);
  });

  it('revisión I4: la doctrina PresentationV3 que reciben los dos pases no fija el ORI del modo simple en $0,00', () => {
    // El modelo recibía a la vez el ancla Δ38 (bloque de la cascada) y la
    // plantilla `| OTRO RESULTADO INTEGRAL (ORI) | $0,00 | $0,00 |` con la
    // tabla de activación "ORI en una sola linea ($0)": si seguía la
    // doctrina, E6/E6b sellaban el informe honesto de una entidad cuyo grupo
    // 38 se movió (el falso positivo que cierra la enmienda 12).
    const pp = preprocesarTresCortes(csvTresCortesConValorizaciones([0, 3_000_000, 8_000_000]));
    const p1 = buildNiifAnalystPass1Prompt(COMPANY, 'es', 'COMPARATIVO_COMPLETO', pp);
    expect(p1).not.toContain('| OTRO RESULTADO INTEGRAL (ORI) | $0,00 | $0,00 |');
    expect(p1).not.toMatch(/ORI en una sola linea \(\$0\)/);
    expect(p1).toMatch(/MODO SIMPLE[\s\S]{0,400}CASCADA VINCULANTE DEL P&G/);
  });
});

/** Quita el corte 2023 de un CSV de tres cortes (misma regla que `csvDosCortes`). */
function csvDosCortesDe(csv: string): string {
  return csv
    .split('\n')
    .map((line) => {
      const cells = line.split(',');
      if (cells.length < 7) return line;
      if (cells[4] === 'saldo 2023' || /^\d+$/.test(cells[0])) cells.splice(4, 1);
      return cells.join(',');
    })
    .join('\n');
}

// Integración de la re-auditoría 2 (cross-deps de F-contrato): el prompt pide un
// código PUC por renglón (E21 ya no une renglones) y el bloque EFE VINCULANTE
// revela la revaluación reconocida en el ORI como partida no monetaria.
describe('prompt NIIF alineado con E21 y con la revaluación del EFE', () => {
  it('el Pass-1 pide un solo grupo o cuenta por renglón', () => {
    const pp = preprocesarTresCortes(csvTresCortesConValorizaciones([0, 3_000_000, 8_000_000]));
    const p1 = buildNiifAnalystPass1Prompt(COMPANY, 'es', 'COMPARATIVO_COMPLETO', pp);
    expect(p1).toContain('Cada renglón con código lleva UN solo grupo PUC');
    expect(p1).toContain('validador E21');
  });

  it('con revaluación en el grupo 15 contra el 38, el bloque EFE la declara no monetaria', async () => {
    const { csvTresCortesConRevaluacion } = await import('@/lib/agents/financial/__fixtures__/tres-cortes-comparativo');
    const pp = preprocesarTresCortes(csvTresCortesConRevaluacion([5_000_000, 8_000_000, 6_000_000]));
    const anchors = {
      totalAssetsPrimary: '0', totalLiabilitiesPrimary: '0', totalEquityPrimary: '0', netIncomePrimary: '0',
      oriPrimary: '0', totalAssetsComparative: null, totalLiabilitiesComparative: null,
      totalEquityComparative: null, grossProfitComparative: null, operatingProfitComparative: null,
      netIncomeComparative: null, oriComparative: null,
      curatorFlags: {
        equityConvergenceApplied: false, cashFlowClosureForced: false, negativeAssetReclassified: false,
        presumedCostWarning: false, reclassifiedAmountCop: '0',
      },
    };
    const p2 = buildNiifAnalystPass2Prompt(COMPANY, 'es', 'COMPARATIVO_COMPLETO', anchors, pp);
    expect(p2).toMatch(/Revaluación reconocida en el ORI del periodo \(grupo 38 sin contrapartida en el 19\)/);
    expect(p2).toContain('NO la presentes en operación');
  });
});
