#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// FASE 0 — Medición de deriva del LLM frente a las anclas del preprocesador
// ---------------------------------------------------------------------------
// Antes de construir el reconciliador determinista hay que saber CUÁNTO
// desobedece el modelo hoy: en qué campos, con qué frecuencia y con qué
// magnitud. Sin ese dato, cualquier arquitectura es especulación.
//
// Qué hace, por balance de entrada:
//   1. parseTrialBalanceCSV + preprocessTrialBalance  (verdad determinista)
//   2. prepareFinancialContext                        (bloque TOTALES VINCULANTES)
//   3. runNiifAnalyst                                 (3 pases con LLM real)
//   4. buildReportAnchors(primary, comparative)       (anclas exactas en centavos)
//   5. Diff ancla-por-ancla contra lo que EMITIÓ el modelo
//   6. validateNiifReportJson                         (salvedades E1..E15)
//
// Uso:
//   dotenv -e .env.local -- tsx scripts/fase0-anchor-drift.ts
//   FASE0_RUNS=2 FASE0_ONLY=elite dotenv -e .env.local -- tsx scripts/fase0-anchor-drift.ts
//
// Salida: JSON + resumen Markdown en FASE0_OUT (default: .fase0/).
// ---------------------------------------------------------------------------

import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import ExcelJS from 'exceljs';

import {
  extractCompanyMetadata,
  parseTrialBalanceCSV,
  preprocessTrialBalance,
  type PreprocessedBalance,
} from '@/lib/preprocessing/trial-balance';
import { prepareFinancialContext } from '@/lib/agents/financial/orchestrator';
import { runNiifAnalyst } from '@/lib/agents/financial/agents/niif-analyst';
import {
  buildReportAnchors,
  ANCHOR_LABELS,
  type AnchorKey,
} from '@/lib/agents/financial/contracts/anchors';
import { validateNiifReportJson } from '@/lib/agents/financial/validators/niif-json-validator';
import type { NiifReportJson } from '@/lib/agents/financial/contracts/niif-report';
import type { CompanyInfo } from '@/lib/agents/financial/types';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const OUT_DIR = process.env.FASE0_OUT ?? path.resolve(process.cwd(), '.fase0');
const RUNS = Number(process.env.FASE0_RUNS ?? 1);
const ONLY = process.env.FASE0_ONLY?.toLowerCase();

interface FixtureSpec {
  id: string;
  label: string;
  file: string;
  kind: 'csv' | 'xlsx';
  /** Filas de metadata a descartar antes del header (XLSX exportados). */
  skipRows?: number;
  /**
   * Normaliza el signo de las clases de naturaleza crédito (2, 3, 4) antes de
   * parsear. Los ERP que exportan UNA sola columna de saldo firmado publican
   * esas clases en negativo; `parseTrialBalanceCSV` sólo deriva el signo por
   * naturaleza PUC cuando existen columnas débito Y crédito separadas
   * (trial-balance.ts:793-796), así que el saldo llega invertido y el balance
   * no cuadra. Medido en FASE 0: sin normalizar, R8 absorbe un residual del
   * 210% del activo; normalizado, 0,12%.
   */
  normalizeCreditSigns?: boolean;
}

/**
 * Invierte el signo de los saldos de las clases 2/3/4 (naturaleza crédito).
 * Prueba de concepto de FASE 0 — la corrección definitiva vive en el parser,
 * con detección automática de la convención.
 */
function normalizeCreditSignsCsv(csv: string): string {
  const rows = csv.split('\n');
  if (rows.length === 0) return csv;
  const out = [rows[0]];
  for (const row of rows.slice(1)) {
    const cols = row.split(',');
    const code = (cols[2] ?? '').trim();
    if (!/^[234]/.test(code)) {
      out.push(row);
      continue;
    }
    for (let i = 3; i < cols.length; i++) {
      const n = Number(cols[i]);
      if (cols[i] !== '' && Number.isFinite(n)) cols[i] = String(-n);
    }
    out.push(cols.join(','));
  }
  return out.join('\n');
}

const FIXTURES: FixtureSpec[] = [
  {
    id: 'elite-pulido-diamante',
    label: 'Élite Pulido Diamante (fixture canónico CSV)',
    file: 'src/lib/preprocessing/__fixtures__/elite-pulido-diamante.csv',
    kind: 'csv',
  },
  {
    id: 'grupo-empresarial-2tres',
    label: 'Grupo Empresarial 2 Tres SAS (XLSX testigo)',
    file: 'src/lib/preprocessing/__fixtures__/grupo-empresarial-2tres-sas.xlsx',
    kind: 'xlsx',
    skipRows: 7,
  },
  {
    id: 'grupo-2tres-signos-ok',
    label: 'Grupo Empresarial 2 Tres SAS — mismo balance con signos normalizados',
    file: 'src/lib/preprocessing/__fixtures__/grupo-empresarial-2tres-sas.xlsx',
    kind: 'xlsx',
    skipRows: 7,
    normalizeCreditSigns: true,
  },
  // NOTA (FASE 0, 2026-08-07): `src/data/uploads/1777392615926_1._BALANCE_1_PRUEBA.xlsx`
  // es byte-equivalente al fixture testigo Grupo Empresarial 2 Tres SAS (mismos
  // 206 renglones, mismos totales) — no aporta un caso distinto. Los demás
  // uploads (`Reporte_Financiero_1mas1_*.xlsx`) son SALIDAS del pipeline, no
  // balances de entrada: `parseTrialBalanceCSV` devuelve 0 filas sobre ellos.
];

// ---------------------------------------------------------------------------
// Carga de balances
// ---------------------------------------------------------------------------

async function xlsxToLines(file: string): Promise<string[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  const lines: string[] = [];
  ws.eachRow((row) => {
    const values = row.values as unknown[];
    const cells = values.slice(1).map((v) => {
      if (v === null || v === undefined) return '';
      if (typeof v === 'string') return v;
      if (typeof v === 'number') return String(v);
      if (typeof v === 'object') {
        const obj = v as {
          text?: string;
          result?: unknown;
          richText?: Array<{ text: string }>;
        };
        if (obj.text) return obj.text;
        if (obj.richText) return obj.richText.map((rt) => rt.text).join('');
        if (obj.result !== undefined) return String(obj.result);
      }
      return String(v);
    });
    lines.push(cells.join(','));
  });
  return lines;
}

/**
 * Localiza la fila de encabezado del balance. Los XLSX exportados por los ERP
 * llevan 1..N filas de metadata (razón social, NIT, periodo) antes del header
 * real; `skipRows` es la pista manual, y esta heurística la verifica.
 */
function findHeaderIndex(lines: string[]): number {
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    const l = lines[i].toLowerCase();
    const hasCode = /(c[oó]digo|cuenta|codigo cuenta)/.test(l);
    const hasName = /(nombre|descripci[oó]n)/.test(l);
    const hasBalance = /(saldo|d[eé]bito|cr[eé]dito|inicial|final)/.test(l);
    if (hasCode && (hasName || hasBalance)) return i;
  }
  return 0;
}

async function loadFixture(
  spec: FixtureSpec,
): Promise<{ csv: string; rawText: string } | null> {
  const abs = path.resolve(process.cwd(), spec.file);
  if (!fs.existsSync(abs)) {
    console.warn(`[fase0] fixture ausente, se omite: ${spec.file}`);
    return null;
  }
  if (spec.kind === 'csv') {
    const text = fs.readFileSync(abs, 'utf8');
    return { csv: text, rawText: text };
  }
  const lines = await xlsxToLines(abs);
  const rawText = lines.join('\n');
  const headerIdx = spec.skipRows ?? findHeaderIndex(lines);
  let csv = lines.slice(headerIdx).join('\n');
  if (spec.normalizeCreditSigns) csv = normalizeCreditSignsCsv(csv);
  return { csv, rawText };
}

// ---------------------------------------------------------------------------
// Diff de anclas
// ---------------------------------------------------------------------------

type EmittedLookup = Partial<Record<AnchorKey, string | null>>;

/** Mapea el JSON del analista a las claves de ancla del preprocesador. */
function emittedAnchors(json: NiifReportJson): {
  primary: EmittedLookup;
  comparative: EmittedLookup;
} {
  const bs = json.balanceSheet;
  const is = json.incomeStatement;
  return {
    primary: {
      activo: bs.totalAssetsPrimary,
      pasivo: bs.totalLiabilitiesPrimary,
      patrimonio: bs.totalEquityPrimary,
      utilidadNeta: is.netIncomePrimary,
      efectivoCuenta11: json.cashFlow.cashClosing,
    },
    comparative: {
      activo: bs.totalAssetsComparative,
      pasivo: bs.totalLiabilitiesComparative,
      patrimonio: bs.totalEquityComparative,
      utilidadNeta: is.netIncomeComparative,
    },
  };
}

interface AnchorDiff {
  period: 'primary' | 'comparative';
  key: AnchorKey;
  label: string;
  expectedCents: string;
  emittedCents: string | null;
  gapCents: string;
  /** |gap| / |expected| — magnitud relativa de la desviación. */
  relative: number | null;
  status: 'exact' | 'drift' | 'missing';
}

function diffAnchors(
  expected: ReturnType<typeof buildReportAnchors>,
  emitted: ReturnType<typeof emittedAnchors>,
): AnchorDiff[] {
  const out: AnchorDiff[] = [];
  for (const period of ['primary', 'comparative'] as const) {
    const exp = expected[period];
    if (!exp) continue;
    const emi = emitted[period];
    for (const [k, cents] of Object.entries(exp.cents) as Array<[AnchorKey, bigint]>) {
      if (!(k in emi)) continue; // el schema no expone esa ancla en este periodo
      const raw = emi[k];
      if (raw === null || raw === undefined) {
        out.push({
          period,
          key: k,
          label: ANCHOR_LABELS[k],
          expectedCents: cents.toString(),
          emittedCents: null,
          gapCents: cents.toString(),
          relative: null,
          status: 'missing',
        });
        continue;
      }
      let emittedCents: bigint;
      try {
        emittedCents = BigInt(raw);
      } catch {
        out.push({
          period,
          key: k,
          label: ANCHOR_LABELS[k],
          expectedCents: cents.toString(),
          emittedCents: raw,
          gapCents: 'NaN',
          relative: null,
          status: 'drift',
        });
        continue;
      }
      const gap = emittedCents - cents;
      const ZERO = BigInt(0);
      const abs = gap < ZERO ? -gap : gap;
      const absExp = cents < ZERO ? -cents : cents;
      out.push({
        period,
        key: k,
        label: ANCHOR_LABELS[k],
        expectedCents: cents.toString(),
        emittedCents: emittedCents.toString(),
        gapCents: gap.toString(),
        relative: absExp === ZERO ? null : Number(abs) / Number(absExp),
        status: gap === ZERO ? 'exact' : 'drift',
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------

interface RunResult {
  fixtureId: string;
  run: number;
  ok: boolean;
  error?: string;
  elapsedMs: number;
  company: { name: string; nit: string; fiscalPeriod: string; comparativePeriod?: string };
  reportMode?: string;
  diffs: AnchorDiff[];
  validation?: { errors: string[]; warnings: string[] };
  preprocessSummary?: {
    periods: string[];
    activoCents?: string;
    pasivoCents?: string;
    patrimonioCents?: string;
  };
}

async function runOne(spec: FixtureSpec, run: number): Promise<RunResult> {
  const started = Date.now();
  const base: RunResult = {
    fixtureId: spec.id,
    run,
    ok: false,
    elapsedMs: 0,
    company: { name: '', nit: '', fiscalPeriod: '' },
    diffs: [],
  };

  const loaded = await loadFixture(spec);
  if (!loaded) return { ...base, error: 'fixture ausente', elapsedMs: Date.now() - started };

  const meta = extractCompanyMetadata(loaded.rawText);
  const rows = parseTrialBalanceCSV(loaded.csv);
  if (rows.length === 0) {
    return { ...base, error: 'parseTrialBalanceCSV devolvió 0 filas', elapsedMs: Date.now() - started };
  }
  const pp: PreprocessedBalance = preprocessTrialBalance(rows);

  const company: CompanyInfo = {
    name: meta.razonSocialFromFile ?? spec.label,
    nit: meta.nitFromFile ?? '900.000.000-0',
    fiscalPeriod: pp.primary.period,
    comparativePeriod: pp.comparative?.period,
    niifGroup: 2,
    entityType: 'SAS',
  };
  base.company = {
    name: company.name,
    nit: company.nit,
    fiscalPeriod: company.fiscalPeriod,
    comparativePeriod: company.comparativePeriod,
  };
  base.preprocessSummary = {
    periods: pp.periods.map((p) => p.period),
    activoCents: pp.primary.controlTotals.cents?.activo?.toString(),
    pasivoCents: pp.primary.controlTotals.cents?.pasivo?.toString(),
    patrimonioCents: pp.primary.controlTotals.cents?.patrimonio?.toString(),
  };

  let ctx;
  try {
    ctx = await prepareFinancialContext(
      { rawData: loaded.csv, company, language: 'es' },
      { preprocessed: pp },
    );
  } catch (err) {
    return {
      ...base,
      error: `prepareFinancialContext: ${err instanceof Error ? err.message : String(err)}`,
      elapsedMs: Date.now() - started,
    };
  }
  base.reportMode = ctx.reportMode;

  let json: NiifReportJson;
  try {
    const result = await runNiifAnalyst(
      ctx.effectiveRawData,
      ctx.effectiveCompany,
      'es',
      undefined,
      ctx.bindingTotalsBlock,
      ctx.ppForAgents,
      (e) => {
        if (e.type === 'stage_progress') process.stdout.write(`    · ${e.detail}\n`);
      },
      ctx.eliteForNiif,
      undefined,
      ctx.reportMode,
    );
    const withJson = result as typeof result & { json?: NiifReportJson };
    if (!withJson.json) throw new Error('runNiifAnalyst no expuso `json`');
    json = withJson.json;
  } catch (err) {
    return {
      ...base,
      error: `runNiifAnalyst: ${err instanceof Error ? err.message : String(err)}`,
      elapsedMs: Date.now() - started,
    };
  }

  const expected = buildReportAnchors(pp.primary, pp.comparative ?? undefined);
  base.diffs = diffAnchors(expected, emittedAnchors(json));

  const cents = pp.primary.controlTotals.cents;
  const cmpCents = pp.comparative?.controlTotals.cents;
  const validation = validateNiifReportJson(json, {
    cashAccountPuc11Cents: cents?.efectivoCuenta11?.toString(),
    bindingPrimaryTotalsCents: {
      totalAssets: cents?.activo?.toString(),
      totalLiabilities: cents?.pasivo?.toString(),
      totalEquity: cents?.patrimonio?.toString(),
      netIncome: cents?.utilidadNeta?.toString(),
      utilidadAntesImpuestos: cents?.utilidadAntesImpuestos?.toString(),
      impuestoCausado: cents?.impuestoCausado?.toString(),
    },
    bindingComparativeTotalsCents: cmpCents
      ? {
          totalAssets: cmpCents.activo?.toString(),
          totalLiabilities: cmpCents.pasivo?.toString(),
          totalEquity: cmpCents.patrimonio?.toString(),
          netIncome: cmpCents.utilidadNeta?.toString(),
        }
      : undefined,
  });
  base.validation = { errors: validation.errors, warnings: validation.warnings };

  // Persistir el JSON crudo del analista: es la evidencia de la corrida.
  fs.writeFileSync(
    path.join(OUT_DIR, `raw-${spec.id}-run${run}.json`),
    JSON.stringify(json, null, 2),
  );

  return { ...base, ok: true, elapsedMs: Date.now() - started };
}

// ---------------------------------------------------------------------------
// Reporte
// ---------------------------------------------------------------------------

function fmtCents(c: string): string {
  if (c === 'NaN') return 'NaN';
  const neg = c.startsWith('-');
  const abs = neg ? c.slice(1) : c;
  const padded = abs.padStart(3, '0');
  const whole = (padded.slice(0, -2) || '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '-' : ''}$${whole},${padded.slice(-2)}`;
}

function summarize(results: RunResult[]): string {
  const lines: string[] = [];
  lines.push('# FASE 0 — Deriva del LLM frente a las anclas del preprocesador');
  lines.push('');
  lines.push(`Corridas: ${results.length} · ${new Date().toISOString()}`);
  lines.push('');

  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  lines.push('## Corridas');
  lines.push('');
  lines.push('| Balance | Run | Estado | Modo | Anclas | Exactas | Deriva | Ausentes | Errores E | Warnings |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const exact = r.diffs.filter((d) => d.status === 'exact').length;
    const drift = r.diffs.filter((d) => d.status === 'drift').length;
    const missing = r.diffs.filter((d) => d.status === 'missing').length;
    lines.push(
      `| ${r.fixtureId} | ${r.run} | ${r.ok ? 'OK' : 'FALLO'} | ${r.reportMode ?? '—'} | ${r.diffs.length} | ${exact} | ${drift} | ${missing} | ${r.validation?.errors.length ?? '—'} | ${r.validation?.warnings.length ?? '—'} |`,
    );
  }
  lines.push('');

  if (failed.length > 0) {
    lines.push('### Fallos');
    lines.push('');
    for (const r of failed) lines.push(`- \`${r.fixtureId}\` run ${r.run}: ${r.error}`);
    lines.push('');
  }

  // Agregado por campo: dónde desvía el modelo.
  const byKey = new Map<string, { total: number; drift: number; missing: number; maxRel: number }>();
  for (const r of ok) {
    for (const d of r.diffs) {
      const k = `${d.period}.${d.key}`;
      const cur = byKey.get(k) ?? { total: 0, drift: 0, missing: 0, maxRel: 0 };
      cur.total++;
      if (d.status === 'drift') cur.drift++;
      if (d.status === 'missing') cur.missing++;
      if (d.relative !== null && d.relative > cur.maxRel) cur.maxRel = d.relative;
      byKey.set(k, cur);
    }
  }
  lines.push('## Obediencia por campo ancla');
  lines.push('');
  lines.push('| Campo | Observaciones | Exactas | Deriva | Ausente | Peor desviación relativa |');
  lines.push('|---|---|---|---|---|---|');
  for (const [k, v] of [...byKey.entries()].sort()) {
    const exact = v.total - v.drift - v.missing;
    lines.push(
      `| ${k} | ${v.total} | ${exact} | ${v.drift} | ${v.missing} | ${(v.maxRel * 100).toFixed(4)}% |`,
    );
  }
  lines.push('');

  lines.push('## Desviaciones observadas (detalle)');
  lines.push('');
  const anyDrift = ok.flatMap((r) =>
    r.diffs.filter((d) => d.status !== 'exact').map((d) => ({ r, d })),
  );
  if (anyDrift.length === 0) {
    lines.push('Ninguna. Todas las anclas emitidas coinciden al centavo con el preprocesador.');
  } else {
    lines.push('| Balance | Run | Periodo | Ancla | Preprocesador | LLM | Brecha |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const { r, d } of anyDrift) {
      lines.push(
        `| ${r.fixtureId} | ${r.run} | ${d.period} | ${d.label} | ${fmtCents(d.expectedCents)} | ${d.emittedCents ? fmtCents(d.emittedCents) : '(ausente)'} | ${fmtCents(d.gapCents)} |`,
      );
    }
  }
  lines.push('');

  lines.push('## Salvedades E1..E15 observadas');
  lines.push('');
  const eCount = new Map<string, number>();
  for (const r of ok) {
    for (const msg of [...(r.validation?.errors ?? []), ...(r.validation?.warnings ?? [])]) {
      const code = msg.match(/^(E\d+)\./)?.[1] ?? 'sin-codigo';
      eCount.set(code, (eCount.get(code) ?? 0) + 1);
    }
  }
  if (eCount.size === 0) {
    lines.push('Ninguna.');
  } else {
    lines.push('| Código | Ocurrencias |');
    lines.push('|---|---|');
    for (const [c, n] of [...eCount.entries()].sort()) lines.push(`| ${c} | ${n} |`);
    lines.push('');
    lines.push('### Mensajes');
    lines.push('');
    for (const r of ok) {
      for (const msg of r.validation?.errors ?? []) lines.push(`- **[error]** \`${r.fixtureId}#${r.run}\` ${msg}`);
      for (const msg of r.validation?.warnings ?? []) lines.push(`- [warn] \`${r.fixtureId}#${r.run}\` ${msg}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const specs = ONLY ? FIXTURES.filter((f) => f.id.includes(ONLY)) : FIXTURES;
  console.log(`[fase0] ${specs.length} balance(s) × ${RUNS} corrida(s) → ${OUT_DIR}`);

  const results: RunResult[] = [];
  for (const spec of specs) {
    for (let run = 1; run <= RUNS; run++) {
      console.log(`\n[fase0] ▶ ${spec.id} (run ${run}/${RUNS}) — ${spec.label}`);
      const r = await runOne(spec, run);
      results.push(r);
      if (r.ok) {
        const drift = r.diffs.filter((d) => d.status !== 'exact').length;
        console.log(
          `[fase0] ✓ ${spec.id}#${run} — ${r.diffs.length} anclas, ${drift} desviadas, ` +
            `${r.validation?.errors.length ?? 0} errores E, ${Math.round(r.elapsedMs / 1000)}s`,
        );
      } else {
        console.log(`[fase0] ✗ ${spec.id}#${run} — ${r.error}`);
      }
      fs.writeFileSync(path.join(OUT_DIR, 'results.json'), JSON.stringify(results, null, 2));
      fs.writeFileSync(path.join(OUT_DIR, 'REPORT.md'), summarize(results));
    }
  }

  console.log(`\n[fase0] listo → ${path.join(OUT_DIR, 'REPORT.md')}`);
}

main().catch((err) => {
  console.error('[fase0] fallo fatal:', err);
  process.exit(1);
});
