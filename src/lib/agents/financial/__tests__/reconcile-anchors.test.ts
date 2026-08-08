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

import {
  reconcileAnchors,
  buildQualificationSeal,
  describeQualifications,
  type ReconciliationOutcome,
} from '../agents/reconcile-anchors';
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
      // Por defecto Pasivo y Patrimonio traen un renglón que cuadra su total:
      // un estado con total material y CERO renglones es el descuadre más
      // severo que el reconciliador detecta, no una forma neutra de fixture.
      liabilities: over.liabilities ?? [linea('22', over.totalLiabilities ?? '40000000')],
      equity: over.equity ?? [linea('31', over.totalEquity ?? '60000000')],
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

  it('un estado con total material y CERO renglones es el descuadre más severo', () => {
    // Medido en producción (2026-08-08): el Pasivo del informe salió con los dos
    // encabezados de sección y ningún renglón, declarando $1.962.538.849,62 sin
    // una sola cuenta debajo. La regla anterior lo dejaba pasar en silencio.
    const json = makeReport({ assets: [], totalAssets: '100000000' });
    const gap = reconcileAnchors(json, anchors()).lineGaps.find((g) => g.statement === 'Activo');
    expect(gap).toBeDefined();
    expect(gap?.lineCount).toBe(0);
    expect(gap?.sumCents).toBe('0');
    expect(gap?.gapCents).toBe('-100000000');
  });

  it('un estado en cero sin renglones sí es legítimo', () => {
    const json = makeReport({ assets: [], totalAssets: '0', totalLiabilities: '0', totalEquity: '0', liabilities: [], equity: [] });
    expect(reconcileAnchors(json, {
      primary: { period: '2025', cents: {} },
      comparative: null,
    }).lineGaps).toHaveLength(0);
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

describe('buildQualificationSeal — el sello que cambia el artefacto', () => {
  const conGap: ReconciliationOutcome = {
    deviations: [],
    lineGaps: [
      {
        statement: 'Activo',
        lineCount: 3,
        sumCents: '245975129640',
        totalCents: '418597884116',
        gapCents: '-172622754476',
      },
    ],
    repairAttempted: true,
    clean: false,
  };

  it('no sella nada cuando la reconciliación quedó limpia', () => {
    const limpio: ReconciliationOutcome = {
      deviations: [],
      lineGaps: [],
      repairAttempted: false,
      clean: true,
    };
    expect(buildQualificationSeal(limpio)).toBe('');
    expect(describeQualifications(limpio)).toEqual([]);
  });

  it('sella la portada con el encabezado y la cifra exacta de la brecha', () => {
    const seal = buildQualificationSeal(conGap);
    expect(seal).toContain('REPORTE CON SALVEDADES');
    expect(seal).toContain('NO es firmable');
    // La brecha medida en FASE 0 corrida 2: $1.726.227.544,76 sin desglosar.
    expect(seal).toContain('$1.726.227.544,76');
    expect(seal).toContain('Se intentó una reparación acotada');
  });

  it('el sello es un blockquote Markdown, para que sobreviva a la composición', () => {
    // Viaja dentro del cuerpo del informe: si no fuera Markdown válido, se
    // rompería al concatenarse con los estados financieros.
    for (const line of buildQualificationSeal(conGap).split('\n')) {
      if (line.trim() === '') continue;
      expect(line.startsWith('>')).toBe(true);
    }
  });

  it('distingue la desviación corregida de la que no se pudo corregir', () => {
    const outcome: ReconciliationOutcome = {
      deviations: [
        {
          period: 'primary',
          field: 'balanceSheet.totalAssetsPrimary',
          label: 'Total Activo',
          key: 'activo',
          emitted: '100',
          expected: '200',
          gapCents: '-100',
          overwritten: true,
        },
        {
          period: 'primary',
          field: 'incomeStatement.netIncomePrimary',
          label: 'Utilidad Neta',
          key: 'utilidadNeta',
          emitted: '300',
          expected: '400',
          gapCents: '-100',
          overwritten: false,
        },
      ],
      lineGaps: [],
      repairAttempted: false,
      clean: false,
    };
    const textos = describeQualifications(outcome);
    expect(textos[0]).toContain('corregido automáticamente');
    expect(textos[1]).toContain('NO corregido');
  });

  it('respeta el idioma del informe', () => {
    expect(buildQualificationSeal(conGap, 'en')).toContain('REPORT WITH QUALIFICATIONS');
  });
});
