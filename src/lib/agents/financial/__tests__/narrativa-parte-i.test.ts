// ---------------------------------------------------------------------------
// I5-3 — cifras en la prosa del JSON de la Parte I
// ---------------------------------------------------------------------------
// Las notas de los estados (ESF, ERI, ECP), la nota de método del EFE y las
// notas técnicas del JSON NIIF se imprimen en el Markdown, el PDF y el Excel
// sin cruzar sus cifras: una "utilidad neta de $9.000.000,00" en una nota
// técnica, con las tablas cuadradas al centavo, salía "procedencia
// verificada". `checkNiifNarrative` cruza los conceptos anclados (utilidad o
// pérdida neta, efectivo, patrimonio, activos, pasivos, ingresos) y
// `runNiifPhase` sella la Parte I con el motivo; el servidor
// (`serverNiifIntegrity`) aplica el mismo cruce (paridad en
// markdown-procedencia.route.test.ts).
//
// Sin falsos positivos: notas honestas en el estilo del modelo (cifras
// completas, abreviadas, en inciso, del comparativo, variaciones) sobre la
// traza de la pérdida con comparativo, el fixture coherente, los tres cortes
// (comparativos EFE/ECP y ORI del grupo 38) y el balance real de
// anclas-pyg-y-comparativo.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import ExcelJS from 'exceljs';

vi.mock('@/lib/agents/financial/agents/niif-analyst', () => ({ runNiifAnalyst: vi.fn() }));
vi.mock('@/lib/facts/report-facts', () => ({ getHechosEmpresaBlock: vi.fn(async () => '') }));

import { runNiifAnalyst } from '@/lib/agents/financial/agents/niif-analyst';
import { runNiifPhase } from '@/lib/agents/financial/orchestrator';
import { toNiifAnalysisResult } from '@/lib/agents/financial/agents/renderer';
import { buildPeriodAnchors } from '@/lib/agents/financial/contracts/anchors';
import { formatCopFromCents } from '@/lib/agents/financial/contracts/money';
import type { NiifReportJson } from '@/lib/agents/financial/contracts/niif-report';
import {
  checkNiifNarrative,
  narrativeSourcesFromPreprocessed,
} from '@/lib/agents/financial/validators/narrative-anchors';
import {
  CSV_PERDIDA_COMPARATIVO,
  informeHonesto,
  preprocesarPerdidaComparativo,
} from '@/lib/agents/financial/__fixtures__/perdida-comparativo-w4a';
import {
  csvTresCortesConValorizaciones,
  informeTresCortes,
  preprocesarTresCortes,
} from '@/lib/agents/financial/__fixtures__/tres-cortes-comparativo';
import { makeCoherentNiifReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import { parseTrialBalanceCSV, preprocessTrialBalance, type PeriodSnapshot, type PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import type { CompanyInfo } from '@/lib/agents/financial/types';

const cop = (cents: bigint) => formatCopFromCents(cents < BigInt(0) ? -cents : cents, false);
const abs = (v: bigint) => (v < BigInt(0) ? -v : v);

/** Notas honestas en el estilo del modelo, a partir de las anclas del snapshot. */
function honestNotes(primary: PeriodSnapshot, comparative: PeriodSnapshot | null) {
  const a = buildPeriodAnchors(primary)!.cents as Record<string, bigint | undefined>;
  const c = comparative ? (buildPeriodAnchors(comparative)?.cents as Record<string, bigint | undefined>) : undefined;
  const un = a.utilidadNeta!;
  const resultado = un < BigInt(0) ? 'pérdida neta' : 'utilidad neta';
  const notes = [
    `La ${resultado} del ejercicio ${primary.period} asciende a ${cop(un)} y se trasladó a resultados acumulados.`,
    `El total de activos al cierre es de ${cop(a.activo!)} y el total de pasivos asciende a ${cop(a.pasivo!)}.`,
    `El patrimonio al 31 de diciembre de ${primary.period} asciende a ${cop(a.patrimonio!)}.`,
    `El efectivo y equivalentes al cierre del periodo fue de ${cop(a.efectivoCuenta11!)}.`,
    // Inciso entre paréntesis y cifra abreviada.
    `La entidad presenta la ${resultado} (${cop(un)}) conforme a la Sección 5 de la NIIF para las PYMES.`,
    `El total de activos, cercano a $${(Number(abs(a.activo!)) / 1e8).toFixed(1).replace('.', ',')} millones, se presenta por liquidez.`,
    // Variación: no se juzga.
    `El patrimonio disminuyó $1.000.000,00 frente al periodo anterior.`,
  ];
  if (typeof a.ingresosOperacionales === 'bigint') {
    notes.push(`Los ingresos operacionales netos del periodo suman ${cop(a.ingresosOperacionales)}.`);
  }
  if (c?.utilidadNeta !== undefined) {
    const r = c.utilidadNeta < BigInt(0) ? 'pérdida neta' : 'utilidad neta';
    notes.push(`En ${comparative!.period} la ${r} fue de ${cop(c.utilidadNeta)}.`);
  }
  if (c?.patrimonio !== undefined) {
    notes.push(`El total del patrimonio del periodo comparativo es de ${cop(c.patrimonio)}.`);
  }
  return notes;
}

function withNotes(json: NiifReportJson, bodies: string[], where: 'technicalNotes' | 'balanceSheet' = 'technicalNotes'): NiifReportJson {
  const notes = bodies.map((body, i) => ({ ref: `Nota ${i + 1}`, norma: null, body }));
  if (where === 'balanceSheet') return { ...json, balanceSheet: { ...json.balanceSheet, notes } };
  return { ...json, technicalNotes: [...json.technicalNotes, ...notes] };
}

const check = (json: NiifReportJson, pp: PreprocessedBalance | null, language: 'es' | 'en' = 'es') =>
  checkNiifNarrative(json, narrativeSourcesFromPreprocessed(pp, json), language);

async function loadRealBalance(): Promise<PreprocessedBalance> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.resolve(process.cwd(), 'src/lib/preprocessing/__fixtures__/grupo-empresarial-2tres-sas.xlsx'));
  const ws = wb.worksheets[0];
  const lines: string[] = [];
  const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  ws.eachRow((row) => {
    const values = row.values as unknown[];
    lines.push(
      values
        .slice(1)
        .map((v) => {
          if (v === null || v === undefined) return '';
          if (typeof v === 'string') return csvCell(v);
          if (typeof v === 'number') return String(v);
          const o = v as { text?: string; result?: unknown };
          return csvCell(o.text ?? (o.result !== undefined ? String(o.result) : String(v)));
        })
        .join(','),
    );
  });
  return preprocessTrialBalance(parseTrialBalanceCSV(lines.slice(7).join('\n')));
}

describe('checkNiifNarrative — sin falsos positivos en notas honestas', () => {
  it('traza de la pérdida con comparativo (traza-cifras-extremo-a-extremo)', () => {
    const pp = preprocesarPerdidaComparativo();
    const json = withNotes(informeHonesto(pp), honestNotes(pp.primary, pp.comparative ?? null));
    const r = check(json, pp);
    expect(r.motivos).toEqual([]);
    expect(r.checked).toBeGreaterThan(5);
    // Las mismas notas en las notas del ESF.
    expect(check(withNotes(informeHonesto(pp), honestNotes(pp.primary, pp.comparative ?? null), 'balanceSheet'), pp).motivos).toEqual([]);
  });

  it('tres cortes: comparativos EFE/ECP y ORI del grupo 38 (comparativos-efe-ecp-fase, ori-grupo-38)', () => {
    for (const csv of [undefined, csvTresCortesConValorizaciones([0, 3_000_000, 8_000_000])]) {
      const pp = preprocesarTresCortes(csv);
      const json = withNotes(informeTresCortes(pp), honestNotes(pp.primary, pp.comparative ?? null));
      expect(check(json, pp).motivos).toEqual([]);
    }
  });

  it('fixture coherente sin preprocesado: sólo las anclas del propio JSON', () => {
    const json = makeCoherentNiifReport();
    const withProse = withNotes(json, [
      `La utilidad neta del ejercicio asciende a ${cop(BigInt(json.incomeStatement.netIncomePrimary))}.`,
      `El total de activos al cierre es de ${cop(BigInt(json.balanceSheet.totalAssetsPrimary))}.`,
      `El patrimonio al cierre asciende a ${cop(BigInt(json.balanceSheet.totalEquityPrimary))}.`,
    ]);
    const r = check(withProse, null);
    expect(r.motivos).toEqual([]);
    expect(r.checked).toBe(3);
  });

  it('balance real de anclas-pyg-y-comparativo (export de ERP)', async () => {
    const pp = await loadRealBalance();
    const json = withNotes(makeCoherentNiifReport(), honestNotes(pp.primary, pp.comparative ?? null));
    // El JSON del fixture es de otra empresa: las notas citan el balance real.
    expect(check(json, pp).motivos).toEqual([]);
  });
});

describe('checkNiifNarrative — cifras sin respaldo', () => {
  const pp = preprocesarPerdidaComparativo();

  it('utilidad neta, activos, efectivo e ingresos falsos en notas técnicas y del ESF', () => {
    const json = withNotes(informeHonesto(pp), [
      'La utilidad neta del ejercicio fue de $9.000.000,00.',
      'El efectivo y equivalentes al cierre del periodo fue de $123.456.789,00.',
      'Los ingresos operacionales netos ascienden a $1.111.111,00.',
    ]);
    const fake = withNotes(json, ['El total de activos es de $5.555.555,00.'], 'balanceSheet');
    const r = check(fake, pp);
    expect(r.motivos).toHaveLength(4);
    expect(r.motivos.join('\n')).toMatch(/^Notas técnicas — Nota \d+ · Utilidad neta: la nota imprime \$9\.000\.000,00/m);
    expect(r.motivos.join('\n')).toMatch(/Estado de situación financiera — Nota 1 · Total Activo/);
    expect(r.motivos.join('\n')).toMatch(/Efectivo al cierre/);
    expect(r.motivos.join('\n')).toMatch(/Ingresos/);
  });

  it('una pérdida presentada como utilidad es desviación de signo', () => {
    const un = buildPeriodAnchors(pp.primary)!.cents.utilidadNeta!;
    expect(un < BigInt(0)).toBe(true);
    const r = check(withNotes(informeHonesto(pp), [`La utilidad neta positiva del ejercicio es de ${cop(un)}.`]), pp);
    expect(r.motivos.join('\n')).toMatch(/es negativa/);
  });

  it('en inglés el motivo sale en inglés', () => {
    const r = check(withNotes(informeHonesto(pp), ['La utilidad neta del ejercicio fue de $9.000.000,00.']), pp, 'en');
    expect(r.motivos[0]).toMatch(/^Technical notes — Nota \d+ · Utilidad neta: the note prints \$9\.000\.000,00/);
  });
});

describe('runNiifPhase — sella la Parte I por cifras en las notas', () => {
  const company: CompanyInfo = { name: 'Demo Perdidas SAS', nit: '900123456-8', entityType: 'SAS', fiscalPeriod: '2025', niifGroup: 2 };
  const clean = { clean: true, deviations: [], lineGaps: [], repairAttempted: false };

  beforeEach(() => {
    vi.mocked(runNiifAnalyst).mockReset();
  });

  async function phase(json: NiifReportJson) {
    vi.mocked(runNiifAnalyst).mockResolvedValue({ ...toNiifAnalysisResult(structuredClone(json)), reconciliation: { ...clean } });
    return runNiifPhase({ rawData: CSV_PERDIDA_COMPARATIVO, company, language: 'es' });
  }

  it('notas honestas: la fase no sella', async () => {
    const pp = preprocessTrialBalance(parseTrialBalanceCSV(CSV_PERDIDA_COMPARATIVO));
    const { niif } = await phase(withNotes(informeHonesto(pp), honestNotes(pp.primary, pp.comparative ?? null)));
    expect(niif.fullContent).not.toMatch(/CIFRAS EN NOTAS SIN RESPALDO/);
    expect(niif.reconciliation?.clean).toBe(true);
  });

  it('utilidad neta falsa en una nota técnica: Parte I sellada con el motivo', async () => {
    const pp = preprocessTrialBalance(parseTrialBalanceCSV(CSV_PERDIDA_COMPARATIVO));
    const { niif } = await phase(withNotes(informeHonesto(pp), ['La utilidad neta del ejercicio fue de $9.000.000,00.']));
    expect(niif.reconciliation?.clean).toBe(false);
    expect(niif.fullContent).toMatch(/> ## REPORTE CON SALVEDADES — CIFRAS EN NOTAS SIN RESPALDO/);
    expect(niif.balanceSheet).toMatch(/Utilidad neta: la nota imprime \$9\.000\.000,00/);
  });
});
