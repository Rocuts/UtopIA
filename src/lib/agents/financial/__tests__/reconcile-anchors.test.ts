// ---------------------------------------------------------------------------
// Reconciliador determinista de anclas — regresión (2026-08-07)
// ---------------------------------------------------------------------------
// Antes de esta corrección el LLM AUTORABA cada cifra del schema y E14 se
// limitaba a comparar cuatro totales y avisar. La medición de FASE 0 mostró que
// el modelo sí copia las anclas (0 desviaciones en 9 anclas × 3 corridas), pero
// que el DESGLOSE varía entre el 0,1% y el 41% del activo de corrida en corrida
// sobre el mismo balance. El reconciliador convierte la obediencia observada en
// una garantía estructural y, sobre todo, DETECTA el descuadre del desglose para
// que el bucle de reparación lo pueda atacar.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { reconcileAnchors } from '../agents/reconcile-anchors';
import type { ReportAnchors } from '../contracts/anchors';
import type { NiifReportJson } from '../contracts/niif-report';

function linea(account: string | null, amount: string, level: 0 | 1 | 2 | 3 | 4 = 2) {
  return {
    account,
    label: account ?? 'Subtotal',
    amountPrimary: amount,
    amountComparative: null,
    level,
    isAbsolute: true,
  };
}

function makeReport(over: Partial<{
  assets: ReturnType<typeof linea>[];
  liabilities: ReturnType<typeof linea>[];
  equity: ReturnType<typeof linea>[];
  totalAssets: string;
  totalLiabilities: string;
  totalEquity: string;
  netIncome: string;
  cashClosing: string;
}> = {}): NiifReportJson {
  return {
    company: {
      name: 'Prueba SAS',
      nit: '900123456',
      entityType: 'SAS',
      sector: 'Comercio',
      niifGroup: 2,
      fiscalPeriod: '2025',
      comparativePeriod: null,
      city: 'Bogotá',
      signatories: null,
    },
    balanceSheet: {
      assets: over.assets ?? [],
      liabilities: over.liabilities ?? [],
      equity: over.equity ?? [],
      totalAssetsPrimary: over.totalAssets ?? '100000000',
      totalAssetsComparative: null,
      totalLiabilitiesPrimary: over.totalLiabilities ?? '40000000',
      totalLiabilitiesComparative: null,
      totalEquityPrimary: over.totalEquity ?? '60000000',
      totalEquityComparative: null,
      notes: [],
      modeBanner: null,
    },
    incomeStatement: {
      lines: [],
      grossProfitPrimary: '0',
      grossProfitComparative: null,
      operatingProfitPrimary: '0',
      operatingProfitComparative: null,
      netIncomePrimary: over.netIncome ?? '0',
      netIncomeComparative: null,
      oriPrimary: '0',
      oriComparative: null,
      notes: [],
      modeBanner: null,
    },
    cashFlow: {
      sections: [
        { section: 'operating', lines: [], netFlow: '0' },
        { section: 'investing', lines: [], netFlow: '0' },
        { section: 'financing', lines: [], netFlow: '0' },
      ],
      netChange: '0',
      cashOpening: '0',
      cashClosing: over.cashClosing ?? '0',
      methodNote: 'indirect',
      degeneracyFlag: null,
    },
    equityChanges: { rows: [], notes: [] },
    technicalNotes: [],
    curatorFlags: {
      equityConvergenceApplied: false,
      cashFlowClosureForced: false,
      negativeAssetReclassified: false,
      presumedCostWarning: false,
      reclassifiedAmountCop: '0',
    },
    reportMode: null,
  } as unknown as NiifReportJson;
}

function anchors(over: Partial<Record<string, bigint>> = {}): ReportAnchors {
  return {
    primary: {
      period: '2025',
      cents: {
        activo: BigInt(100_000_000),
        pasivo: BigInt(40_000_000),
        patrimonio: BigInt(60_000_000),
        utilidadNeta: BigInt(0),
        efectivoCuenta11: BigInt(0),
        ...over,
      },
    },
    comparative: null,
  };
}

describe('reconcileAnchors — sobrescritura del tríptico patrimonial', () => {
  it('sobrescribe el total desviado con la cifra del preprocesador y registra la desviación', () => {
    const json = makeReport({ totalAssets: '99999999' });
    const { json: out, deviations } = reconcileAnchors(json, anchors());

    expect(out.balanceSheet.totalAssetsPrimary).toBe('100000000');
    const dev = deviations.find((d) => d.field === 'balanceSheet.totalAssetsPrimary');
    expect(dev).toBeDefined();
    expect(dev?.emitted).toBe('99999999');
    expect(dev?.expected).toBe('100000000');
    expect(dev?.gapCents).toBe('-1');
    expect(dev?.overwritten).toBe(true);
  });

  it('no registra desviación cuando el modelo copió la cifra exacta', () => {
    const { deviations } = reconcileAnchors(makeReport(), anchors());
    expect(deviations).toHaveLength(0);
  });

  it('sobrescribe el tríptico de forma atómica, preservando A = P + K', () => {
    // El modelo emite un balance internamente coherente pero inventado.
    const json = makeReport({
      totalAssets: '500000000',
      totalLiabilities: '200000000',
      totalEquity: '300000000',
    });
    const { json: out } = reconcileAnchors(json, anchors());

    expect(out.balanceSheet.totalAssetsPrimary).toBe('100000000');
    expect(out.balanceSheet.totalLiabilitiesPrimary).toBe('40000000');
    expect(out.balanceSheet.totalEquityPrimary).toBe('60000000');
    // E1 sigue cerrando porque el preprocesador es coherente por construcción.
    expect(
      BigInt(out.balanceSheet.totalLiabilitiesPrimary) +
        BigInt(out.balanceSheet.totalEquityPrimary),
    ).toBe(BigInt(out.balanceSheet.totalAssetsPrimary));
  });

  it('no muta el JSON de entrada', () => {
    const json = makeReport({ totalAssets: '99999999' });
    reconcileAnchors(json, anchors());
    expect(json.balanceSheet.totalAssetsPrimary).toBe('99999999');
  });

  it('es inocuo cuando el preprocesador no aportó anclas', () => {
    const json = makeReport({ totalAssets: '77' });
    const { json: out, deviations } = reconcileAnchors(json, {
      primary: null,
      comparative: null,
    });
    expect(out.balanceSheet.totalAssetsPrimary).toBe('77');
    expect(deviations).toHaveLength(0);
  });
});

describe('reconcileAnchors — anclas que se reportan pero NO se sobrescriben', () => {
  it('reporta la desviación de utilidad neta sin tocarla', () => {
    // Sobrescribir netIncome en solitario rompería la cascada del P&L y el
    // cierre del ECP (E4), que el código no puede recomponer sin autorar
    // contabilidad. Se reporta para que el bucle de reparación la ataque.
    const json = makeReport({ netIncome: '123' });
    const { json: out, deviations } = reconcileAnchors(
      json,
      anchors({ utilidadNeta: BigInt(456) }),
    );

    expect(out.incomeStatement.netIncomePrimary).toBe('123');
    const dev = deviations.find((d) => d.field === 'incomeStatement.netIncomePrimary');
    expect(dev?.overwritten).toBe(false);
    expect(dev?.expected).toBe('456');
  });

  it('reporta la desviación de efectivo de cierre sin tocarla', () => {
    // cashClosing está amarrado por E2 (cashOpening + netChange). Sobrescribirlo
    // fabricaría una incoherencia dentro del propio EFE.
    const json = makeReport({ cashClosing: '10' });
    const { json: out, deviations } = reconcileAnchors(
      json,
      anchors({ efectivoCuenta11: BigInt(999) }),
    );

    expect(out.cashFlow.cashClosing).toBe('10');
    expect(
      deviations.find((d) => d.field === 'cashFlow.cashClosing')?.overwritten,
    ).toBe(false);
  });
});

describe('reconcileAnchors — descuadre del desglose (el fallo medido en FASE 0)', () => {
  it('detecta que los renglones de activo no suman el total', () => {
    // Reproduce la corrida 2 de FASE 0: el modelo imprime 3 renglones por
    // $2.459M bajo un total de $4.186M.
    const json = makeReport({
      totalAssets: '100000000',
      assets: [linea('11', '60000000'), linea('13', '10000000')],
    });
    const { lineGaps } = reconcileAnchors(json, anchors());

    const gap = lineGaps.find((g) => g.statement === 'Activo');
    expect(gap).toBeDefined();
    expect(gap?.sumCents).toBe('70000000');
    expect(gap?.totalCents).toBe('100000000');
    expect(gap?.gapCents).toBe('-30000000');
  });

  it('no reporta descuadre cuando los renglones sí suman', () => {
    const json = makeReport({
      totalAssets: '100000000',
      assets: [linea('11', '60000000'), linea('13', '40000000')],
    });
    expect(reconcileAnchors(json, anchors()).lineGaps).toHaveLength(0);
  });

  it('mide el descuadre contra el total YA reconciliado, no contra el que emitió el modelo', () => {
    // Si midiéramos contra el total emitido, un modelo que inventa un total
    // coherente con sus propios renglones pasaría limpio.
    const json = makeReport({
      totalAssets: '70000000',
      assets: [linea('11', '60000000'), linea('13', '10000000')],
    });
    const { lineGaps } = reconcileAnchors(json, anchors());
    expect(lineGaps.find((g) => g.statement === 'Activo')?.gapCents).toBe('-30000000');
  });

  it('ignora los estados sin desglose — no hay nada que cuadrar', () => {
    expect(reconcileAnchors(makeReport(), anchors()).lineGaps).toHaveLength(0);
  });
});

describe('reconcileAnchors — resumen para el bucle de reparación', () => {
  it('describe cada discrepancia en términos accionables para el prompt', () => {
    const json = makeReport({
      totalAssets: '100000000',
      assets: [linea('11', '60000000')],
      netIncome: '123',
    });
    const { repairInstructions } = reconcileAnchors(
      json,
      anchors({ utilidadNeta: BigInt(456) }),
    );

    expect(repairInstructions.length).toBeGreaterThan(0);
    const joined = repairInstructions.join('\n');
    expect(joined).toContain('456'); // la cifra vinculante que debe copiar
    expect(joined).toContain('Activo'); // el estado cuyo desglose no cuadra
  });

  it('no produce instrucciones cuando todo cuadra', () => {
    const json = makeReport({
      totalAssets: '100000000',
      assets: [linea('11', '100000000')],
    });
    expect(reconcileAnchors(json, anchors()).repairInstructions).toHaveLength(0);
  });
});
