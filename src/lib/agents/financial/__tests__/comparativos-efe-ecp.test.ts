// ---------------------------------------------------------------------------
// Comparativos del EFE y del ECP (auditoría integral 2026-09-24, pendiente #3)
// ---------------------------------------------------------------------------
// NIIF para las PYMES 3.14 exige información comparativa de todos los importes
// de los estados del periodo, salvo impracticabilidad (3.14 / 10.21). El
// informe presentaba el EFE y el ECP sólo con el periodo actual. El comparativo
// de esos dos estados es calculable cuando el balance trae el corte ANTERIOR al
// comparativo (tres cortes); sin él se declara impracticable con una nota
// determinista, nunca con cifras del modelo.
//
// Fixture: src/lib/preprocessing/__fixtures__/tres-cortes-comparativo.csv
// (2023 / 2024 / 2025). EFE 2024: operación 11M, inversión −20M, financiación
// 24M, Δ caja 15M (20M → 35M). ECP 2024: 73M → 102M.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import {
  csvDosCortes,
  csvTresCortes,
  informeTresCortes,
  preprocesarTresCortes,
} from '../__fixtures__/tres-cortes-comparativo';
import { clonar } from '../__fixtures__/perdida-comparativo-w4a';
import {
  attachComparativeStatements,
  buildComparativeStatementsBasis,
  buildDeterministicCashFlow,
  checkCashFlowInvariants,
  formatCashFlowViolations,
} from '../contracts/deterministic-breakdown';
import {
  assembleNiifReport,
  CashFlowAndEquitySubSchema,
  NiifReportSchema,
  type NiifReportJson,
} from '../contracts/niif-report';
import { buildNiifValidatorOptions } from '../orchestrator';
import { validateNiifReportJson } from '../validators/niif-json-validator';

const M = (pesos: number) => (BigInt(pesos) * BigInt(100)).toString();

function validar(json: NiifReportJson, pp = preprocesarTresCortes()) {
  return validateNiifReportJson(json, buildNiifValidatorOptions(pp));
}

function seccion(json: NiifReportJson, s: 'operating' | 'investing' | 'financing') {
  return json.cashFlow.sections.find((x) => x.section === s)!;
}

describe('base determinista del comparativo — tres cortes', () => {
  it('el EFE 2024 se calcula desde el corte 2023 y concilia con el PUC 11', () => {
    const basis = buildComparativeStatementsBasis(preprocesarTresCortes())!;
    expect(basis.comparativePeriod).toBe('2024');
    expect(basis.openingPeriod).toBe('2023');
    expect(basis.cashFlowNote).toBeNull();
    const efe = basis.cashFlow!;
    expect(efe.reconciled).toBe(true);
    const net = Object.fromEntries(efe.sections.map((s) => [s.section, s.netFlowCents.toString()]));
    expect(net).toEqual({ operating: M(11_000_000), investing: M(-20_000_000), financing: M(24_000_000) });
    expect(efe.netChangeCents.toString()).toBe(M(15_000_000));
    expect(efe.cashOpeningCents.toString()).toBe(M(20_000_000));
    expect(efe.cashClosingCents.toString()).toBe(M(35_000_000));
  });

  it('el ECP 2024 va de 73M a 102M, cuadra columna a columna y registra la utilidad 2024', () => {
    const basis = buildComparativeStatementsBasis(preprocesarTresCortes())!;
    expect(basis.equityNote).toBeNull();
    const rows = basis.equityRows!;
    expect(rows[0].kind).toBe('opening_balance');
    expect(rows[0].total).toBe(M(73_000_000));
    const closing = rows[rows.length - 1];
    expect(closing.kind).toBe('closing_balance');
    expect(closing.total).toBe(M(102_000_000));
    expect(rows.find((r) => r.kind === 'profit_for_period')!.resultadoEjercicio).toBe(M(15_000_000));
    const cancel = rows.find((r) => r.kind === 'prior_period_result_cancellation')!;
    expect(cancel.total).toBe('0');
    const cols = ['capitalSocial', 'primaColocacion', 'reservaLegal', 'otrasReservas',
      'resultadosAcumulados', 'resultadoEjercicio', 'ori', 'total'] as const;
    for (const c of cols) {
      const movimientos = rows.slice(0, -1).reduce((acc, r) => acc + BigInt(r[c]), BigInt(0));
      expect(movimientos.toString(), c).toBe(closing[c]);
    }
  });

  it('el informe adjunta la columna comparativa: cada actividad suma su subtotal y el cierre 2024 es la apertura 2025', () => {
    const json = informeTresCortes(preprocesarTresCortes());
    const cf = json.cashFlow;
    expect(cf.comparativeNote).toBeNull();
    expect(cf.cashOpeningComparative).toBe(M(20_000_000));
    expect(cf.cashClosingComparative).toBe(cf.cashOpening);
    expect(cf.netChangeComparative).toBe(M(15_000_000));
    for (const s of cf.sections) {
      const sum = s.lines.reduce((acc, l) => acc + BigInt(l.amountComparative ?? '0'), BigInt(0));
      expect(sum.toString(), s.section).toBe(s.netFlowComparative);
      expect(s.lines.every((l) => l.amountComparative !== null), s.section).toBe(true);
    }
    // El primer renglón de operación es el resultado de cada periodo.
    const first = seccion(json, 'operating').lines[0];
    expect(first.amountPrimary).toBe(json.incomeStatement.netIncomePrimary);
    expect(first.amountComparative).toBe(json.incomeStatement.netIncomeComparative);
    // La inversión 2024 (equipo por 20M) no se movió en 2025: renglón alineado.
    const inv = seccion(json, 'investing').lines.find((l) => l.amountComparative === M(-20_000_000));
    expect(inv?.amountPrimary).toBe('0');
    const ec = json.equityChanges;
    expect(ec.comparativeNote).toBeNull();
    const cmpClosing = ec.comparativeRows![ec.comparativeRows!.length - 1];
    const opening = ec.rows[0];
    expect(cmpClosing.total).toBe(opening.total);
    expect(cmpClosing.capitalSocial).toBe(opening.capitalSocial);
    expect(cmpClosing.resultadosAcumulados).toBe(opening.resultadosAcumulados);
  });

  it('el validador anclado no encuentra errores ni avisos del comparativo', () => {
    const pp = preprocesarTresCortes();
    const r = validar(informeTresCortes(pp), pp);
    expect(r.errors).toEqual([]);
    expect(r.warnings.filter((w) => /^E(18|24)c\./.test(w))).toEqual([]);
    expect(checkCashFlowInvariants(informeTresCortes(pp).cashFlow)).toEqual([]);
  });

  it('las cifras comparativas que escriba el modelo se descartan y se recalculan', () => {
    const pp = preprocesarTresCortes();
    const json = clonar(informeTresCortes(pp));
    for (const s of json.cashFlow.sections) for (const l of s.lines) l.amountComparative = '999';
    json.cashFlow.netChangeComparative = '1';
    const again = attachComparativeStatements(
      json,
      buildComparativeStatementsBasis(pp),
      buildDeterministicCashFlow(pp.primary, pp.comparative!),
    );
    expect(again.cashFlow.netChangeComparative).toBe(M(15_000_000));
    expect(again.cashFlow.sections.flatMap((s) => s.lines).some((l) => l.amountComparative === '999')).toBe(false);
    expect(validar(again, pp).errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Revisión adversarial P2: renglones del EFE 2025 con el MISMO importe y
// comparativos distintos. Variante del fixture: en 2025 deudores (13) e
// inventarios (14) consumen $5M cada uno; en 2024, $10M y $5M. El
// emparejamiento sólo por importe (y por orden) asignaba al renglón de
// inventarios el comparativo de deudores cuando el modelo los presentaba en
// otro orden — cifras cruzadas que el validador no detectaba.
// ---------------------------------------------------------------------------

function csvEmpate2025(): string {
  return csvTresCortes()
    .replace(
      '143505,Mercancias no fabricadas por la empresa,Auxiliar,1,25000000,30000000,28000000',
      '143505,Mercancias no fabricadas por la empresa,Auxiliar,1,25000000,30000000,35000000',
    )
    .replace(
      '210505,Bancos nacionales,Auxiliar,1,30000000,40000000,25000000',
      '210505,Bancos nacionales,Auxiliar,1,30000000,40000000,32000000',
    );
}

/** El informe honesto con la operación reescrita como la presentaría el modelo: inventarios antes que deudores. */
function informeConEmpate(conCodigo: boolean) {
  const pp = preprocesarTresCortes(csvEmpate2025());
  const honest = informeTresCortes(pp);
  const primary = buildDeterministicCashFlow(pp.primary, pp.comparative!)!;
  const rows = primary.sections.find((s) => s.section === 'operating')!.rows;
  const rotulo = (account: string, label: string) =>
    account === '14' ? 'Aumento de inventarios' : account === '13' ? 'Aumento de deudores comerciales' : label;
  type Linea = NiifReportJson['cashFlow']['sections'][number]['lines'][number];
  const lines: Linea[] = rows.map((r) => ({
    account: conCodigo ? r.account : null,
    label: rotulo(r.account, r.label),
    amountPrimary: r.cents.toString(),
    amountComparative: null,
    level: 2,
    isAbsolute: false,
    confidence: null,
    anomalyFlag: null,
  }));
  const i13 = lines.findIndex((l) => l.label === 'Aumento de deudores comerciales');
  const i14 = lines.findIndex((l) => l.label === 'Aumento de inventarios');
  [lines[i13], lines[i14]] = [lines[i14], lines[i13]];
  const json: NiifReportJson = {
    ...honest,
    cashFlow: {
      ...honest.cashFlow,
      sections: honest.cashFlow.sections.map((s) =>
        s.section === 'operating' ? { ...s, lines } : { ...s, lines: s.lines.filter((l) => l.amountPrimary !== '0') },
      ),
    },
  };
  const out = attachComparativeStatements(json, buildComparativeStatementsBasis(pp), primary);
  return { pp, out, op: seccion(out, 'operating') };
}

describe('revisión P2 — renglones del EFE con el mismo importe en el periodo actual', () => {
  it('con el código PUC del bloque, cada renglón recibe el comparativo de su propio grupo', () => {
    const { pp, out, op } = informeConEmpate(true);
    expect(op.lines.find((l) => l.label === 'Aumento de inventarios')?.amountComparative).toBe(M(-5_000_000));
    expect(op.lines.find((l) => l.label === 'Aumento de deudores comerciales')?.amountComparative).toBe(M(-10_000_000));
    expect(validar(out, pp).errors).toEqual([]);
  });

  it('sin código PUC ni rótulo que los distinga, los renglones toman el rótulo de su partida (ninguna cifra cambia)', () => {
    const { pp, out, op } = informeConEmpate(false);
    const par = op.lines
      .filter((l) => l.amountPrimary === M(-5_000_000))
      .map((l) => [l.account, l.amountComparative, /inventarios/i.test(l.label) ? '14' : /deudores/i.test(l.label) ? '13' : '?']);
    expect(par).toHaveLength(2);
    for (const [account, comparative, rotulo] of par) {
      expect(rotulo).toBe(account);
      expect(comparative).toBe(account === '13' ? M(-10_000_000) : M(-5_000_000));
    }
    expect(validar(out, pp).errors).toEqual([]);
  });
});

describe('dos cortes — comparativo impracticable, nota determinista', () => {
  it('sin el corte 2023 no hay cifras comparativas del EFE ni del ECP, sólo la nota 3.14/10.21', () => {
    const pp = preprocesarTresCortes(csvDosCortes());
    expect(pp.periods.map((p) => p.period)).toEqual(['2024', '2025']);
    const basis = buildComparativeStatementsBasis(pp)!;
    expect(basis.cashFlow).toBeNull();
    expect(basis.equityRows).toBeNull();
    for (const note of [basis.cashFlowNote!, basis.equityNote!]) {
      expect(note).toMatch(/información comparativa 2024 no presentada/);
      expect(note).toMatch(/corte anterior al periodo comparativo \(2023\)/);
      expect(note).toMatch(/3\.14 y 10\.21/);
    }
    const json = informeTresCortes(pp);
    const cf = json.cashFlow;
    expect([cf.netChangeComparative, cf.cashOpeningComparative, cf.cashClosingComparative]).toEqual([null, null, null]);
    expect(cf.sections.every((s) => s.netFlowComparative === null)).toBe(true);
    expect(cf.sections.flatMap((s) => s.lines).every((l) => l.amountComparative === null)).toBe(true);
    expect(cf.comparativeNote).toBe(basis.cashFlowNote);
    expect(json.equityChanges.comparativeRows).toBeNull();
    expect(json.equityChanges.comparativeNote).toBe(basis.equityNote);
    expect(validar(json, pp).errors).toEqual([]);
  });

  it('presentar un comparativo del EFE o del ECP sin corte de apertura es error (E18 / E24)', () => {
    const pp3 = preprocesarTresCortes();
    const pp2 = preprocesarTresCortes(csvDosCortes());
    const json = informeTresCortes(pp3);
    // El informe con comparativos contra un balance de dos cortes: no hay base.
    const r = validateNiifReportJson(json, buildNiifValidatorOptions(pp2));
    expect(r.errors.some((e) => /^E18\. EFE \(periodo comparativo 2024\): se presenta una columna comparativa sin base determinista/.test(e))).toBe(true);
    expect(r.errors.some((e) => /^E24\. ECP \(periodo comparativo 2024\): se presentan filas del periodo comparativo sin base determinista/.test(e))).toBe(true);
  });

  it('corte anterior que no es el cierre inmediatamente anterior → impracticable', () => {
    const csv = csvTresCortes().replace('saldo 2023', 'saldo 2022');
    const basis = buildComparativeStatementsBasis(preprocesarTresCortes(csv))!;
    expect(basis.cashFlow).toBeNull();
    expect(basis.cashFlowNote).toMatch(/2022\) no es el cierre inmediatamente anterior/);
  });

  it('comparativo de saldos de apertura → impracticable (no hay P&G del comparativo)', () => {
    const pp = preprocesarTresCortes();
    pp.comparative!.saldosDeApertura = true;
    const basis = buildComparativeStatementsBasis(pp)!;
    expect(basis.cashFlow).toBeNull();
    expect(basis.equityRows).toBeNull();
    expect(basis.cashFlowNote).toMatch(/saldos de apertura/);
  });

  it('sin periodo comparativo no hay base ni nota', () => {
    expect(buildComparativeStatementsBasis({ periods: [], comparative: null })).toBeNull();
    expect(buildComparativeStatementsBasis(undefined)).toBeNull();
  });
});

describe('validador — la columna comparativa cumple E2/E3/E11/E18/E23 y el ECP comparativo E4/E7/E19/E20/E24', () => {
  const pp = preprocesarTresCortes();
  const base = () => clonar(informeTresCortes(pp));

  it('E25: el año anterior al comparativo (2023) sólo se admite en las filas del ECP comparativo', () => {
    // Revisión adversarial P2: el año 2023 se había admitido en TODOS los
    // rótulos del informe; un "31 de diciembre de 2023" en el ESF, el EFE o el
    // ECP del periodo 2025 (el caso de e2e-niif-09) volvía a pasar sin error.
    const ok = validar(base(), pp).errors;
    expect(ok.filter((e) => e.startsWith('E25.'))).toEqual([]);
    for (const mutate of [
      (j: NiifReportJson) => {
        j.balanceSheet.equity[0].label = `${j.balanceSheet.equity[0].label} al 31 de diciembre de 2023`;
      },
      (j: NiifReportJson) => {
        seccion(j, 'operating').lines[1].label = 'Depreciación del ejercicio 2023';
      },
      (j: NiifReportJson) => {
        const row = j.equityChanges.rows.find((r) => r.kind === 'profit_for_period')!;
        row.label = 'Utilidad del ejercicio 2023';
      },
    ]) {
      const j = base();
      mutate(j);
      expect(validar(j, pp).errors.some((e) => e.startsWith('E25.') && e.includes('2023'))).toBe(true);
    }
  });

  it('mover $1.000.000 entre renglones comparativos de la misma actividad → E23', () => {
    const j = base();
    const op = seccion(j, 'operating');
    op.lines[1].amountComparative = (BigInt(op.lines[1].amountComparative!) + BigInt(100_000_000)).toString();
    op.lines[2].amountComparative = (BigInt(op.lines[2].amountComparative!) - BigInt(100_000_000)).toString();
    const r = validar(j, pp);
    expect(r.errors.some((e) => e.startsWith('E23. (periodo comparativo 2024)'))).toBe(true);
  });

  it('un renglón comparativo que no suma su subtotal → E2 (y la invariante del EFE lo marca)', () => {
    const j = base();
    const op = seccion(j, 'operating');
    op.lines[1].amountComparative = (BigInt(op.lines[1].amountComparative!) + BigInt(1)).toString();
    const r = validar(j, pp);
    expect(r.errors.some((e) => /^E2\. EFE \(periodo comparativo 2024\) — actividades de operating/.test(e))).toBe(true);
    const inv = checkCashFlowInvariants(j.cashFlow);
    expect(inv.some((v) => v.column === 'comparative' && v.kind === 'section_sum')).toBe(true);
    expect(formatCashFlowViolations(inv).join('\n')).toMatch(/EFE \(columna comparativa\)/);
  });

  it('reclasificar entre actividades en el comparativo con totales intactos → E18', () => {
    const j = base();
    const op = seccion(j, 'operating');
    const inv = seccion(j, 'investing');
    op.lines[1].amountComparative = (BigInt(op.lines[1].amountComparative!) + BigInt(100)).toString();
    op.netFlowComparative = (BigInt(op.netFlowComparative!) + BigInt(100)).toString();
    inv.lines[0].amountComparative = (BigInt(inv.lines[0].amountComparative!) - BigInt(100)).toString();
    inv.netFlowComparative = (BigInt(inv.netFlowComparative!) - BigInt(100)).toString();
    const r = validar(j, pp);
    expect(r.errors.some((e) => e.startsWith('E18. (periodo comparativo 2024)'))).toBe(true);
  });

  it('el efectivo final comparativo distinto del inicial del periodo → E3', () => {
    const j = base();
    j.cashFlow.cashOpeningComparative = (BigInt(j.cashFlow.cashOpeningComparative!) + BigInt(1)).toString();
    j.cashFlow.cashClosingComparative = (BigInt(j.cashFlow.cashClosingComparative!) + BigInt(1)).toString();
    const r = validar(j, pp);
    expect(r.errors.some((e) => e.startsWith('E3. EFE (periodo comparativo 2024)'))).toBe(true);
  });

  it('columna comparativa incompleta → E2', () => {
    const j = base();
    j.cashFlow.cashOpeningComparative = null;
    const r = validar(j, pp);
    expect(r.errors.some((e) => /columna comparativa está incompleta/.test(e))).toBe(true);
  });

  it('el primer renglón de operación comparativo ≠ utilidad neta comparativa → E11', () => {
    const j = base();
    const op = seccion(j, 'operating');
    op.lines[0].amountComparative = (BigInt(op.lines[0].amountComparative!) + BigInt(1)).toString();
    op.lines[1].amountComparative = (BigInt(op.lines[1].amountComparative!) - BigInt(1)).toString();
    const r = validar(j, pp);
    expect(r.errors.some((e) => e.startsWith('E11. EFE (periodo comparativo 2024)'))).toBe(true);
  });

  it('ECP comparativo: mover $1.000.000 de acumulados a capital en el cierre 2024 → E24, E20c y E19', () => {
    const j = base();
    const rows = j.equityChanges.comparativeRows!;
    const closing = rows[rows.length - 1];
    closing.capitalSocial = (BigInt(closing.capitalSocial) + BigInt(100_000_000)).toString();
    closing.resultadosAcumulados = (BigInt(closing.resultadosAcumulados) - BigInt(100_000_000)).toString();
    const r = validar(j, pp);
    expect(r.errors.some((e) => e.startsWith('E24. ECP (periodo comparativo 2024)'))).toBe(true);
    expect(r.errors.some((e) => e.startsWith('E20c. ECP (periodo comparativo 2024) saldo final'))).toBe(true);
    expect(r.errors.some((e) => /^E19\. ECP: columna "capitalSocial" — saldo final del periodo comparativo 2024/.test(e))).toBe(true);
    expect(r.errors.some((e) => /^E7c\. ECP \(periodo comparativo 2024\) columna "capitalSocial"/.test(e))).toBe(true);
  });

  it('ECP comparativo con un resultado distinto de la utilidad comparativa → E7a', () => {
    const j = base();
    const rows = j.equityChanges.comparativeRows!;
    const profit = rows.find((r) => r.kind === 'profit_for_period')!;
    profit.resultadoEjercicio = (BigInt(profit.resultadoEjercicio) + BigInt(1)).toString();
    profit.total = (BigInt(profit.total) + BigInt(1)).toString();
    const r = validar(j, pp);
    expect(r.errors.some((e) => e.startsWith('E7a. ECP (periodo comparativo 2024)'))).toBe(true);
  });

  it('comparativo calculable y no presentado → aviso E18c / E24c (no bloquea)', () => {
    const pp2 = preprocesarTresCortes();
    const j = informeTresCortes(pp2);
    const sinComparativos = attachComparativeStatements(j, null, null);
    const r = validar(sinComparativos, pp2);
    expect(r.errors).toEqual([]);
    expect(r.warnings.some((w) => w.startsWith('E18c.'))).toBe(true);
    expect(r.warnings.some((w) => w.startsWith('E24c.'))).toBe(true);
  });

  it('sin anclas (opciones vacías) sólo se exige la coherencia interna de lo presentado', () => {
    expect(validateNiifReportJson(base()).errors).toEqual([]);
  });
});

describe('contrato — el comparativo del EFE/ECP no lo emite el modelo', () => {
  it('el sub-schema de Pass-2 no contiene los campos comparativos (los adjunta el código)', () => {
    const cfShape = CashFlowAndEquitySubSchema.shape.cashFlow.shape as Record<string, unknown>;
    const ecShape = CashFlowAndEquitySubSchema.shape.equityChanges.shape as Record<string, unknown>;
    for (const k of ['netChangeComparative', 'cashOpeningComparative', 'cashClosingComparative', 'comparativeNote']) {
      expect(k in cfShape, k).toBe(false);
    }
    expect('comparativeRows' in ecShape).toBe(false);
  });

  it('el ensamblaje descarta cualquier amountComparative del EFE que traiga el Pass-2', () => {
    const json = informeTresCortes(preprocesarTresCortes());
    const pass1 = {
      company: json.company,
      balanceSheet: json.balanceSheet,
      incomeStatement: json.incomeStatement,
      curatorFlags: json.curatorFlags,
      reportMode: json.reportMode,
    };
    const pass2 = {
      cashFlow: {
        ...json.cashFlow,
        sections: json.cashFlow.sections.map((s) => ({ section: s.section, lines: s.lines, netFlow: s.netFlow })),
      },
      equityChanges: { rows: json.equityChanges.rows, notes: [] },
    };
    const assembled = assembleNiifReport(
      pass1,
      CashFlowAndEquitySubSchema.parse(pass2),
      { technicalNotes: [] },
    );
    expect(assembled.cashFlow.sections.flatMap((s) => s.lines).every((l) => l.amountComparative === null)).toBe(true);
    expect(assembled.cashFlow.cashClosingComparative).toBeNull();
    expect(assembled.equityChanges.comparativeRows).toBeNull();
  });

  it('un informe serializado con el contrato anterior se lee con comparativos en null (no cero)', () => {
    const json = informeTresCortes(preprocesarTresCortes());
    const legacy = JSON.parse(JSON.stringify(json)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    delete legacy.cashFlow.netChangeComparative;
    delete legacy.cashFlow.cashOpeningComparative;
    delete legacy.cashFlow.cashClosingComparative;
    delete legacy.cashFlow.comparativeNote;
    for (const s of legacy.cashFlow.sections) delete s.netFlowComparative;
    delete legacy.equityChanges.comparativeRows;
    delete legacy.equityChanges.comparativeNote;
    const parsed = NiifReportSchema.safeParse(legacy);
    expect(parsed.success).toBe(true);
    const cf = parsed.data!.cashFlow;
    expect(cf.cashClosingComparative).toBeNull();
    expect(cf.sections.flatMap((s) => s.lines).every((l) => l.amountComparative === null)).toBe(true);
    expect(parsed.data!.equityChanges.comparativeRows).toBeNull();
    // Un informe con el contrato vigente pasa intacto.
    expect(NiifReportSchema.parse(json)).toEqual(json);
  });

  it('el validador trata como no presentado un comparativo ausente aunque el JSON no pase por el schema', () => {
    const pp = preprocesarTresCortes();
    const legacy = JSON.parse(JSON.stringify(attachComparativeStatements(informeTresCortes(pp), null, null)));
    delete legacy.cashFlow.netChangeComparative;
    delete legacy.cashFlow.cashOpeningComparative;
    delete legacy.cashFlow.cashClosingComparative;
    for (const s of legacy.cashFlow.sections) {
      delete s.netFlowComparative;
      for (const l of s.lines) delete l.amountComparative;
    }
    delete legacy.equityChanges.comparativeRows;
    const r = validar(legacy as NiifReportJson, pp);
    expect(r.errors).toEqual([]);
    expect(r.warnings.some((w) => w.startsWith('E18c.'))).toBe(true);
  });
});
