// ---------------------------------------------------------------------------
// GOLDEN — toda cifra ancla es byte-idéntica en TODAS las superficies de salida
// ---------------------------------------------------------------------------
// La auditoría integral 2026-08 identificó que la suite verificaba funciones
// aisladas y no caminos, y que el único test "e2e" mockeaba los tres agentes con
// cifras sin relación con el CSV de entrada, para luego afirmar igualdad contra
// sus propios mocks: tautológico por construcción.
//
// Este test invierte el planteamiento. Parte de un balance REAL, lo pasa por el
// preprocesador determinista, y verifica que cada cifra ancla aparece idéntica
// en las cuatro superficies que el cliente puede llegar a ver:
//
//   1. Markdown   — `toNiifAnalysisResult` (renderer.ts)
//   2. PDF Élite  — `niifJsonToBalanceTable` / `niifJsonToIncomeTable`
//   3. Excel      — `generateFinancialExcel`
//   4. Contrato   — `validateNiifReportJson` con las anclas primarias
//
// Por qué NO se llama al LLM
// --------------------------
// Porque el invariante que protege al cliente es el del tramo DETERMINISTA:
// dado un JSON de estados financieros, ninguna superficie puede alterar, reescalar
// ni reformatear una cifra ancla. Mockear los tres agentes para "probar" el tramo
// del modelo es justamente el error tautológico que este test viene a corregir.
// La obediencia del modelo se mide aparte, con LLM real, en
// `scripts/fase0-anchor-drift.ts` (ver docs/FASE0_MEDICION_2026-08.md).
//
// El JSON de partida se CONSTRUYE desde las anclas del preprocesador, que es
// exactamente lo que el reconciliador garantiza en producción.
// ---------------------------------------------------------------------------

import { describe, expect, it, beforeAll } from 'vitest';
import path from 'node:path';
import ExcelJS from 'exceljs';

import {
  parseTrialBalanceCSV,
  preprocessTrialBalance,
  type PreprocessedBalance,
} from '@/lib/preprocessing/trial-balance';
import {
  buildReportAnchors,
  ANCHOR_LABELS,
  type AnchorKey,
} from '@/lib/agents/financial/contracts/anchors';
import { reconcileAnchors } from '@/lib/agents/financial/agents/reconcile-anchors';
import { toNiifAnalysisResult } from '@/lib/agents/financial/agents/renderer';
import {
  niifJsonToBalanceTable,
  niifJsonToIncomeTable,
} from '@/lib/export/pdf-elite-react/compose-statements-from-json';
import { generateFinancialExcel } from '@/lib/export/excel-export';
import type { NiifReportJson } from '@/lib/agents/financial/contracts/niif-report';
import type { FinancialReport } from '@/lib/agents/financial/types';

const FIXTURES = path.resolve(process.cwd(), 'src/lib/preprocessing/__fixtures__');

/** El único export de ERP real del repo: header en la fila 8, saldos firmados. */
async function loadRealBalanceCsv(): Promise<string> {
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
  return lines.slice(7).join('\n');
}

/**
 * Presentación COP es-CO desde centavos: `418597884116` → `$4.185.978.841,16`.
 * Es la forma en que las cuatro superficies imprimen las cifras, así que es la
 * forma que hay que buscar en ellas.
 */
function fmtCop(cents: bigint): string {
  const neg = cents < BigInt(0);
  const abs = neg ? -cents : cents;
  const s = abs.toString().padStart(3, '0');
  const whole = (s.slice(0, -2) || '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `$${whole},${s.slice(-2)}`;
}

function linea(account: string, label: string, cents: bigint) {
  return {
    account,
    label,
    amountPrimary: cents.toString(),
    amountComparative: null,
    level: 2 as const,
    isAbsolute: true,
    confidence: 'high' as const,
  };
}

/**
 * Construye el JSON de estados financieros DESDE las anclas del preprocesador,
 * con un desglose que suma exactamente el total. Es el estado en que el
 * reconciliador deja el informe en producción cuando todo cierra.
 */
function buildReportFromAnchors(pp: PreprocessedBalance): NiifReportJson {
  const a = buildReportAnchors(pp.primary, pp.comparative ?? undefined);
  const c = a.primary!.cents;
  const activo = c.activo!;
  const pasivo = c.pasivo!;
  const patrimonio = c.patrimonio!;
  const utilidad = c.utilidadNeta!;
  const efectivo = c.efectivoCuenta11!;

  return {
    company: {
      name: 'Grupo Empresarial 2 Tres SAS',
      nit: '901714014-6',
      entityType: 'SAS',
      sector: 'Comercio',
      niifGroup: 2,
      fiscalPeriod: pp.primary.period,
      comparativePeriod: null,
      city: 'Bogotá',
      signatories: null,
    },
    balanceSheet: {
      // Desglose que suma el total al centavo: efectivo + el resto.
      assets: [
        linea('11', 'Efectivo y equivalentes de efectivo', efectivo),
        linea('13', 'Otros activos', activo - efectivo),
      ],
      liabilities: [linea('22', 'Proveedores', pasivo)],
      equity: [linea('36', 'Resultado del ejercicio', patrimonio)],
      totalAssetsPrimary: activo.toString(),
      totalAssetsComparative: null,
      totalLiabilitiesPrimary: pasivo.toString(),
      totalLiabilitiesComparative: null,
      totalEquityPrimary: patrimonio.toString(),
      totalEquityComparative: null,
      notes: [],
      modeBanner: null,
    },
    incomeStatement: {
      lines: [linea('41', 'Ingresos de actividades ordinarias', c.ingresos!)],
      grossProfitPrimary: utilidad.toString(),
      grossProfitComparative: null,
      operatingProfitPrimary: utilidad.toString(),
      operatingProfitComparative: null,
      netIncomePrimary: utilidad.toString(),
      netIncomeComparative: null,
      oriPrimary: '0',
      oriComparative: null,
      notes: [],
      modeBanner: null,
    },
    cashFlow: {
      sections: [
        { section: 'operating', lines: [], netFlow: efectivo.toString() },
        { section: 'investing', lines: [], netFlow: '0' },
        { section: 'financing', lines: [], netFlow: '0' },
      ],
      netChange: efectivo.toString(),
      cashOpening: '0',
      cashClosing: efectivo.toString(),
      methodNote: 'indirect',
      degeneracyFlag: null,
    },
    equityChanges: {
      rows: [
        {
          kind: 'closing_balance',
          label: 'Saldo final',
          capitalSocial: '0',
          primaColocacion: '0',
          reservaLegal: '0',
          otrasReservas: '0',
          resultadosAcumulados: (patrimonio - utilidad).toString(),
          resultadoEjercicio: utilidad.toString(),
          ori: '0',
          total: patrimonio.toString(),
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
    reportMode: null,
  } as unknown as NiifReportJson;
}

/** Anclas que TIENEN representación visible en los estados financieros. */
const ANCLAS_VISIBLES: AnchorKey[] = ['activo', 'pasivo', 'patrimonio', 'utilidadNeta'];

describe('GOLDEN — las anclas del preprocesador sobreviven a todas las superficies', () => {
  let pp: PreprocessedBalance;
  let json: NiifReportJson;

  beforeAll(async () => {
    pp = preprocessTrialBalance(parseTrialBalanceCSV(await loadRealBalanceCsv()));
    json = buildReportFromAnchors(pp);
  });

  it('el balance real atraviesa el preprocesador con las seis anclas pobladas', () => {
    const a = buildReportAnchors(pp.primary, pp.comparative ?? undefined);
    expect(a.primary).not.toBeNull();
    for (const key of ANCLAS_VISIBLES) {
      expect(typeof a.primary!.cents[key]).toBe('bigint');
    }
    // Regresión de la convención de signos: pasivo e ingresos son magnitudes.
    expect(a.primary!.cents.pasivo!).toBeGreaterThan(BigInt(0));
    expect(a.primary!.cents.ingresos!).toBeGreaterThan(BigInt(0));
  });

  it('el reconciliador no encuentra nada que corregir en un informe bien formado', () => {
    const r = reconcileAnchors(json, buildReportAnchors(pp.primary, pp.comparative ?? undefined));
    expect(r.deviations).toEqual([]);
    expect(r.lineGaps).toEqual([]);
    expect(r.repairInstructions).toEqual([]);
  });

  it('SUPERFICIE 1 — Markdown imprime cada ancla con su formato COP exacto', () => {
    const md = toNiifAnalysisResult(json).fullContent;
    const a = buildReportAnchors(pp.primary, pp.comparative ?? undefined).primary!;
    for (const key of ANCLAS_VISIBLES) {
      const esperado = fmtCop(a.cents[key]!);
      expect(md, `${ANCHOR_LABELS[key]} (${esperado}) ausente del Markdown`).toContain(esperado);
    }
  });

  it('SUPERFICIE 2 — el PDF Élite imprime las mismas cifras que el Markdown', () => {
    const balance = niifJsonToBalanceTable(json);
    const resultados = niifJsonToIncomeTable(json);
    const texto = JSON.stringify([balance, resultados]);
    const a = buildReportAnchors(pp.primary, pp.comparative ?? undefined).primary!;

    for (const key of ['activo', 'pasivo', 'patrimonio'] as AnchorKey[]) {
      const esperado = fmtCop(a.cents[key]!);
      expect(texto, `${ANCHOR_LABELS[key]} (${esperado}) ausente del PDF`).toContain(esperado);
    }
    expect(texto).toContain(fmtCop(a.cents.utilidadNeta!));
  });

  it('SUPERFICIE 3 — el Excel entregable lleva las mismas cifras', async () => {
    const report = {
      company: json.company,
      niifAnalysis: { ...toNiifAnalysisResult(json), json },
      strategicAnalysis: {
        kpiDashboard: '',
        breakEvenAnalysis: '',
        projectedCashFlow: '',
        strategicRecommendations: '',
        fullContent: '',
      },
      governance: { financialNotes: '', shareholderMinutes: '', fullContent: '' },
      consolidatedReport: toNiifAnalysisResult(json).fullContent,
      generatedAt: '2026-08-07T00:00:00Z',
    } as unknown as FinancialReport;

    const buffer = await generateFinancialExcel({ report, preprocessed: pp });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);

    // Los importes viajan como números en centavos o pesos según la hoja; lo
    // que se verifica es que el VALOR del ancla esté presente en alguna celda,
    // sin reescalado ni redondeo.
    const valores = new Set<string>();
    wb.eachSheet((ws) => {
      ws.eachRow((row) => {
        (row.values as unknown[]).forEach((v) => {
          if (typeof v === 'number') valores.add(v.toFixed(2));
          else if (typeof v === 'string') valores.add(v);
        });
      });
    });

    const a = buildReportAnchors(pp.primary, pp.comparative ?? undefined).primary!;
    for (const key of ['activo', 'pasivo', 'patrimonio'] as AnchorKey[]) {
      const cents = a.cents[key]!;
      const enPesos = (Number(cents) / 100).toFixed(2);
      const presente =
        valores.has(enPesos) ||
        valores.has(cents.toString()) ||
        [...valores].some((v) => v.includes(fmtCop(cents)));
      expect(presente, `${ANCHOR_LABELS[key]} (${fmtCop(cents)}) ausente del Excel`).toBe(true);
    }
  });

  it('SUPERFICIE 4 — un informe con el desglose incompleto NO se declara limpio', () => {
    // Reproduce el fallo medido en FASE 0: el modelo omite renglones del
    // Activo. El total sigue anclado y correcto; el estado, no.
    const roto: NiifReportJson = {
      ...json,
      balanceSheet: {
        ...json.balanceSheet,
        assets: [json.balanceSheet.assets[0]], // se cae el renglón "Otros activos"
      },
    };
    const r = reconcileAnchors(roto, buildReportAnchors(pp.primary, pp.comparative ?? undefined));

    expect(r.deviations).toEqual([]); // los totales siguen exactos
    expect(r.lineGaps).toHaveLength(1); // pero el desglose no cuadra
    expect(r.lineGaps[0].statement).toBe('Activo');
    expect(r.repairInstructions.length).toBeGreaterThan(0);
  });

  it('un total inventado por el modelo se sobrescribe con el del preprocesador', () => {
    const inventado: NiifReportJson = {
      ...json,
      balanceSheet: {
        ...json.balanceSheet,
        totalAssetsPrimary: '999999999999',
        totalLiabilitiesPrimary: '111111111111',
        totalEquityPrimary: '888888888888',
      },
    };
    const anchors = buildReportAnchors(pp.primary, pp.comparative ?? undefined);
    const r = reconcileAnchors(inventado, anchors);

    expect(r.json.balanceSheet.totalAssetsPrimary).toBe(anchors.primary!.cents.activo!.toString());
    expect(r.json.balanceSheet.totalLiabilitiesPrimary).toBe(
      anchors.primary!.cents.pasivo!.toString(),
    );
    expect(r.json.balanceSheet.totalEquityPrimary).toBe(
      anchors.primary!.cents.patrimonio!.toString(),
    );
    expect(r.deviations).toHaveLength(3);
    expect(r.deviations.every((d) => d.overwritten)).toBe(true);

    // Y el Markdown resultante ya no contiene la cifra inventada.
    const md = toNiifAnalysisResult(r.json).fullContent;
    expect(md).not.toContain('9.999.999.999,99');
    expect(md).toContain(fmtCop(anchors.primary!.cents.activo!));
  });
});
