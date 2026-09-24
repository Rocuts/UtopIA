// ---------------------------------------------------------------------------
// EFE determinista: la revaluación reconocida en el ORI no es flujo de efectivo
// (re-auditoría 2 · recalculo-final2-03)
// ---------------------------------------------------------------------------
// El EFE agregaba el grupo 38 (superávit / ORI) con el 19 (valorizaciones) en
// UN renglón "Partidas no monetarias netas" de OPERACIÓN. Con el 19 y el 38
// moviéndose juntos el renglón se anula; con el modelo de revaluación (NIC 16 /
// Sección 17: la revaluación se registra en el propio activo, p. ej. 152410,
// contra el 38, sin grupo 19) la Δ38 entraba al flujo de operación y la Δ15
// completa —revaluación incluida— salía como "adquisición y disposición de
// propiedades, planta y equipo" en inversión. Medido sobre el balance de tres
// cortes con 152410 5M / 8M / 6M contra 381005: EFE 2025 operación $17M e
// inversión +$2M (una disposición inexistente); comparativo 2024 operación
// $14M e inversión −$23M. Las del mismo balance sin revaluación son $19M / $0
// y $11M / −$20M, y la variación neta de caja cuadraba igual: ningún
// validador lo veía, y E18/E23 anclan el informe a esas cifras.
//
// La revaluación es una transacción no monetaria (NIC 7 ¶43 / NIIF para las
// PYMES Sección 7): Δ38 − Δ19 se excluye de operación y se descuenta de la
// variación del activo de inversión que la registra.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import {
  buildComparativeStatementsBasis,
  buildDeterministicCashFlow,
  type DeterministicCashFlow,
} from '../contracts/deterministic-breakdown';
import { buildNiifValidatorOptions } from '../orchestrator';
import { validateNiifReportJson } from '../validators/niif-json-validator';
import {
  csvTresCortes,
  csvTresCortesConRevaluacion,
  csvTresCortesConValorizaciones,
  informeTresCortes,
  preprocesarTresCortes,
} from '../__fixtures__/tres-cortes-comparativo';

const M = (millones: number) => BigInt(millones) * BigInt(100_000_000);
const netos = (efe: DeterministicCashFlow | null | undefined) =>
  Object.fromEntries(efe!.sections.map((s) => [s.section, s.netFlowCents]));
const cuentas = (efe: DeterministicCashFlow, section: string) =>
  efe.sections.find((s) => s.section === section)!.rows.map((r) => [r.account, r.cents]);

const t0 = preprocesarTresCortes();
const t1b = preprocesarTresCortes(csvTresCortesConRevaluacion([5_000_000, 8_000_000, 6_000_000]));
const efeT0 = buildDeterministicCashFlow(t0.primary, t0.comparative!)!;
const efeT1b = buildDeterministicCashFlow(t1b.primary, t1b.comparative!)!;
const cmpT0 = buildComparativeStatementsBasis(t0)!.cashFlow!;
const cmpT1b = buildComparativeStatementsBasis(t1b)!.cashFlow!;

describe('EFE — revaluación del grupo 15 contra el 38, sin grupo 19', () => {
  it('2025: operación $19M e inversión $0, las del mismo balance sin revaluación', () => {
    expect(efeT1b.reconciled).toBe(true);
    expect(netos(efeT1b)).toEqual(netos(efeT0));
    expect(netos(efeT1b)).toEqual({ operating: M(19), investing: M(0), financing: M(-24) });
    // Ni "Partidas no monetarias netas (valorizaciones)" en operación ni una
    // "disposición" de PPE por la revaluación.
    expect(cuentas(efeT1b, 'operating')).toEqual(cuentas(efeT0, 'operating'));
    expect(cuentas(efeT1b, 'investing')).toEqual([]);
  });

  it('comparativo 2024: operación $11M e inversión −$20M', () => {
    expect(cmpT1b.reconciled).toBe(true);
    expect(netos(cmpT1b)).toEqual(netos(cmpT0));
    expect(netos(cmpT1b)).toEqual({ operating: M(11), investing: M(-20), financing: M(24) });
    expect(cuentas(cmpT1b, 'investing')).toEqual([['15', M(-20)]]);
  });

  it('la revaluación del periodo queda identificada para revelarla (Δ38 − Δ19 y el grupo que la registra)', () => {
    expect(efeT1b.oriRevaluation).toEqual({ cents: M(-2), group: '15' });
    expect(cmpT1b.oriRevaluation).toEqual({ cents: M(3), group: '15' });
    expect(efeT0.oriRevaluation).toBeNull();
  });

  it('el informe honesto sobre ese balance (EFE y comparativos del determinista) valida sin errores', () => {
    const json = informeTresCortes(t1b);
    const op = json.cashFlow.sections.find((s) => s.section === 'operating')!;
    expect(op.netFlow).toBe(M(19).toString());
    expect(op.netFlowComparative).toBe(M(11).toString());
    expect(validateNiifReportJson(json, buildNiifValidatorOptions(t1b)).errors).toEqual([]);
  });
});

describe('EFE — sin regresión con valorizaciones 19 ↔ 38', () => {
  it('el 19 y el 38 moviéndose juntos no generan renglón en ninguna actividad', () => {
    const pp = preprocesarTresCortes(csvTresCortesConValorizaciones([5_000_000, 8_000_000, 6_000_000]));
    const efe = buildDeterministicCashFlow(pp.primary, pp.comparative!)!;
    expect(netos(efe)).toEqual(netos(efeT0));
    expect(cuentas(efe, 'operating')).toEqual(cuentas(efeT0, 'operating'));
    expect(efe.oriRevaluation).toBeNull();
  });

  it('parte del ORI con valorizaciones (19) y parte con revaluación en el 15: sólo la segunda se descuenta de inversión', () => {
    // 19: 1M / 2M / 3M; revaluación en 152410: 5M / 8M / 6M; 38 = la suma.
    const csv = csvTresCortes()
      .replace('159205,', '190505,Valorizaciones,Auxiliar,1,1000000,2000000,3000000\n152410,Revaluacion equipo,Auxiliar,1,5000000,8000000,6000000\n159205,')
      .replace('370505,', '381005,Superavit ORI,Auxiliar,1,6000000,10000000,9000000\n370505,');
    const pp = preprocesarTresCortes(csv);
    const efe = buildDeterministicCashFlow(pp.primary, pp.comparative!)!;
    expect(efe.reconciled).toBe(true);
    expect(netos(efe)).toEqual(netos(efeT0));
    expect(efe.oriRevaluation).toEqual({ cents: M(-2), group: '15' });
    expect(netos(buildComparativeStatementsBasis(pp)!.cashFlow)).toEqual(netos(cmpT0));
  });
});

describe('EFE — sin ORI en el periodo (Δ38 = 0) no hay revaluación que descontar', () => {
  // Revisión F-contrato: el 38 (una revaluación de años anteriores, 5M) no se
  // mueve y el 19 sube 1M por año contra otro pasivo (28). Δ38 − Δ19 = −1M no
  // es ORI del periodo: antes de esta regla salía como "revaluación" y una
  // adquisición de PPE en inversión, con operación inflada en 1M.
  it('el 19 que se mueve sin el 38 queda en el renglón no monetario y el EFE es el del balance base', () => {
    const csv = csvTresCortes()
      .replace('159205,', '190505,Valorizaciones,Auxiliar,1,1000000,2000000,3000000\n152410,Revaluacion equipo,Auxiliar,1,5000000,5000000,5000000\n159205,')
      .replace('220505,', '280505,Otros pasivos,Auxiliar,1,1000000,2000000,3000000\n220505,')
      .replace('370505,', '381005,Superavit ORI,Auxiliar,1,5000000,5000000,5000000\n370505,');
    const pp = preprocesarTresCortes(csv);
    const efe = buildDeterministicCashFlow(pp.primary, pp.comparative!)!;
    const cmp = buildComparativeStatementsBasis(pp)!.cashFlow!;
    expect(efe.reconciled && cmp.reconciled).toBe(true);
    expect(efe.oriRevaluation).toBeNull();
    expect(cmp.oriRevaluation).toBeNull();
    expect(netos(efe)).toEqual(netos(efeT0));
    expect(netos(cmp)).toEqual(netos(cmpT0));
    expect(cuentas(efe, 'investing')).toEqual(cuentas(efeT0, 'investing'));
    expect(cuentas(efe, 'operating')).toContainEqual(['19/38', M(-1)]);
  });
});

describe('EFE — revaluación con varios grupos de inversión', () => {
  // Inversiones (12) sin movimiento en los tres cortes, compensadas en capital.
  const conInversiones = (csv: string) =>
    csv
      .replace('130505,', '120505,Acciones,Auxiliar,1,1000000,1000000,1000000\n130505,')
      .replace('311505,Capital suscrito y pagado,Auxiliar,1,50000000,70000000,70000000', '311505,Capital suscrito y pagado,Auxiliar,1,51000000,71000000,71000000');

  it('el ajuste va en un renglón propio de inversión (grupo no atribuible) y nunca en operación', () => {
    const base = preprocesarTresCortes(conInversiones(csvTresCortes()));
    const rev = preprocesarTresCortes(conInversiones(csvTresCortesConRevaluacion([5_000_000, 8_000_000, 6_000_000])));
    const efeBase = buildDeterministicCashFlow(base.primary, base.comparative!)!;
    const efe = buildDeterministicCashFlow(rev.primary, rev.comparative!)!;
    expect(efe.reconciled).toBe(true);
    expect(netos(efe)).toEqual(netos(efeBase));
    expect(cuentas(efe, 'operating')).toEqual(cuentas(efeBase, 'operating'));
    const inv = efe.sections.find((s) => s.section === 'investing')!.rows;
    expect(inv.map((r) => [r.account, r.cents])).toEqual([
      ['15', M(2)],
      ['38', M(-2)],
    ]);
    expect(inv[1].label).toMatch(/Revaluación .* ORI .*no monetaria/);
    expect(efe.oriRevaluation).toEqual({ cents: M(-2), group: null });
  });
});
