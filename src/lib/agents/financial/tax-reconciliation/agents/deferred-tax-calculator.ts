// ---------------------------------------------------------------------------
// Agente 2: Deferred Tax Calculator (NIC 12) — outcome-first GPT-5.4
// ---------------------------------------------------------------------------
// Schema: DeferredTaxReportSchema. Adapter local mantiene el shape legacy
// `DeferredTaxResult` consumido por el orchestrator de consolidación.
// ---------------------------------------------------------------------------

import { MODELS, MODELS_CONFIG } from '@/lib/config/models';
import { callFinancialAgent } from '../../agents/runtime';
import {
  DeferredTaxReportSchema,
  type DeferredTaxReportJson,
} from '../../contracts/tax-reconciliation';
import { formatCopFromCents, parseMoneyCop } from '../../contracts/money';
import { buildDeferredTaxCalculatorPrompt } from '../prompts/deferred-tax-calculator.prompt';
import type { CompanyInfo } from '../../types';
import type {
  DifferenceIdentifierResult,
  DeferredTaxResult,
  TaxReconciliationProgressEvent,
} from '../types';

/**
 * Takes identified NIIF-fiscal differences from Agent 1 and calculates
 * deferred tax assets/liabilities, effective tax rate reconciliation,
 * Formato 2516 mapping and journal entry recommendations.
 */
export async function runDeferredTaxCalculator(
  differenceOutput: DifferenceIdentifierResult,
  company: CompanyInfo,
  language: 'es' | 'en',
  onProgress?: (event: TaxReconciliationProgressEvent) => void,
  signal?: AbortSignal,
): Promise<DeferredTaxResult> {
  const system = buildDeferredTaxCalculatorPrompt(company, language);

  const userContent = [
    '<context>',
    'ANALISIS DE DIFERENCIAS NIIF-FISCAL IDENTIFICADAS POR EL AGENTE 1:',
    '',
    differenceOutput.fullContent,
    '</context>',
  ].join('\n');

  onProgress?.({
    type: 'stage_progress',
    stage: 2,
    detail: 'Calculando impuesto diferido y conciliando tasa efectiva...',
  });

  const { json } = await callFinancialAgent({
    agentName: 'deferred-tax-calculator',
    model: MODELS.FINANCIAL_PIPELINE,
    schema: DeferredTaxReportSchema,
    system,
    userContent,
    ...MODELS_CONFIG.deferredTaxCalculator,
    signal,
  });

  return toLegacyShape(json);
}

// ---------------------------------------------------------------------------
// Adapter local
// ---------------------------------------------------------------------------

function toLegacyShape(json: DeferredTaxReportJson): DeferredTaxResult {
  const deferredTaxWorksheet = renderWorksheet(json);
  const dtaDtlSchedule = renderDtaDtl(json);
  const currentVsDeferredBreakdown = renderBreakdown(json);
  const effectiveTaxRateReconciliation = renderEffectiveRate(json);
  const formato2516Mapping = renderFormato(json);
  const journalEntries = renderJournalEntries(json);

  const fullContent = [
    '## 1. HOJA DE CALCULO DE IMPUESTO DIFERIDO',
    '',
    deferredTaxWorksheet,
    '',
    '## 2. CUADRO DTA / DTL',
    '',
    dtaDtlSchedule,
    '',
    '## 3. DESGLOSE GASTO CORRIENTE VS DIFERIDO',
    '',
    currentVsDeferredBreakdown,
    '',
    '## 4. CONCILIACION DE TASA EFECTIVA',
    '',
    effectiveTaxRateReconciliation,
    '',
    '## 5. MAPEO FORMATO 2516 DIAN',
    '',
    formato2516Mapping,
    '',
    '## 6. ASIENTOS CONTABLES RECOMENDADOS',
    '',
    journalEntries,
    json.preparerNotes.length > 0
      ? ['', '### Notas del Preparador', ...json.preparerNotes.map((n) => `- ${n}`)].join('\n')
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    deferredTaxWorksheet,
    dtaDtlSchedule,
    currentVsDeferredBreakdown,
    effectiveTaxRateReconciliation,
    formato2516Mapping,
    journalEntries,
    fullContent,
  };
}

function renderWorksheet(json: DeferredTaxReportJson): string {
  if (json.worksheet.length === 0) return '_No hay diferencias temporarias._';
  const rows = json.worksheet
    .map(
      (w) =>
        `| ${w.differenceItemId} | ${w.concept} | ${money(w.temporaryDifferenceCents)} | ${w.type} | ${w.taxRatePct}% | ${money(w.dtaCents)} | ${money(w.dtlCents)} | ${w.dtaRecognized ? 'Sí' : 'No'} | ${money(w.recognizedDtaCents)} |`,
    )
    .join('\n');
  return [
    '| ID | Concepto | Diferencia temporaria | Tipo | Tarifa | DTA bruto | DTL | DTA reconocido | DTA en balance |',
    '|---|---|---|---|---|---|---|---|---|',
    rows,
  ].join('\n');
}

function renderDtaDtl(json: DeferredTaxReportJson): string {
  const s = json.dtaDtlSummary;
  const m = json.movement;
  return [
    '**Resumen DTA/DTL:**',
    '',
    '| Concepto | Importe |',
    '|---|---|',
    `| Total DTA bruto | ${money(s.totalDtaCents)} |`,
    `| Total DTA reconocido (NIC 12 §24) | ${money(s.totalRecognizedDtaCents)} |`,
    `| Total DTL | ${money(s.totalDtlCents)} |`,
    `| **Posición neta** | **${money(s.netPositionCents)}** |`,
    '',
    '**Movimiento del ejercicio:**',
    '',
    '| Concepto | DTA | DTL |',
    '|---|---|---|',
    `| Saldo inicial | ${m.openingBalanceDtaCents !== null ? money(m.openingBalanceDtaCents) : '— (single-period)'} | ${m.openingBalanceDtlCents !== null ? money(m.openingBalanceDtlCents) : '— (single-period)'} |`,
    `| Cargo a resultados | ${m.pnlChargeDtaCents !== null ? money(m.pnlChargeDtaCents) : '—'} | ${m.pnlChargeDtlCents !== null ? money(m.pnlChargeDtlCents) : '—'} |`,
    `| Cargo a ORI | ${m.oriChargeDtaCents !== null ? money(m.oriChargeDtaCents) : '—'} | ${m.oriChargeDtlCents !== null ? money(m.oriChargeDtlCents) : '—'} |`,
    `| **Saldo final** | **${money(m.closingBalanceDtaCents)}** | **${money(m.closingBalanceDtlCents)}** |`,
  ].join('\n');
}

function renderBreakdown(json: DeferredTaxReportJson): string {
  const b = json.expenseBreakdown;
  return [
    '| Componente | Importe |',
    '|---|---|',
    `| Utilidad contable antes de impuestos (NIIF) | ${money(b.accountingProfitBeforeTaxCents)} |`,
    `| (+) Diferencias permanentes que incrementan la renta | ${money(b.permanentIncreaseCents)} |`,
    `| (−) Diferencias permanentes que disminuyen la renta | ${money(b.permanentDecreaseCents)} |`,
    `| (+/−) Diferencias temporarias del periodo | ${money(b.temporaryNetCents)} |`,
    `| = **Renta líquida fiscal** | **${money(b.taxableIncomeCents)}** |`,
    `| × Tarifa nominal | ${b.taxRatePct}% |`,
    `| = **Impuesto corriente** | **${money(b.currentTaxCents)}** |`,
    `| (+/−) Gasto (ingreso) por impuesto diferido del periodo | ${money(b.deferredTaxExpenseCents)} |`,
    `| = **Gasto total por impuesto de renta (NIC 12)** | **${money(b.totalTaxExpenseCents)}** |`,
  ].join('\n');
}

function renderEffectiveRate(json: DeferredTaxReportJson): string {
  const e = json.effectiveRateReconciliation;
  const itemRows = e.reconcilingItems
    .map(
      (i) =>
        `| ${i.concept} | ${i.effectPctPoints > 0 ? '+' : ''}${i.effectPctPoints.toFixed(2)} pp | ${i.norma ?? '—'} |`,
    )
    .join('\n');
  return [
    '| Concepto | Efecto (pp) | Norma |',
    '|---|---|---|',
    `| Tasa nominal (Art. 240 E.T.) | ${e.nominalRatePct.toFixed(2)}% | Art. 240 E.T. |`,
    itemRows,
    `| **Tasa efectiva** | **${e.effectiveRatePct.toFixed(2)}%** | — |`,
  ].join('\n');
}

function renderFormato(json: DeferredTaxReportJson): string {
  if (json.formato2516Mapping.length === 0) return '_Sin mapeo Formato 2516._';
  const sectionLabel: Record<string, string> = {
    I_ingresos: 'Sección I — Ingresos',
    II_costos_deducciones: 'Sección II — Costos y Deducciones',
    III_patrimonio: 'Sección III — Patrimonio',
    IV_temporarias_permanentes: 'Sección IV — Temporarias / Permanentes',
  };
  return json.formato2516Mapping
    .map((s) => {
      const rows = s.rowReferences.map((r) => `- [${r.differenceItemId}] → ${r.formRowLabel}`).join('\n');
      return [`**${sectionLabel[s.section]}:**`, '', rows].join('\n');
    })
    .join('\n\n');
}

function renderJournalEntries(json: DeferredTaxReportJson): string {
  if (json.journalEntries.length === 0) return '_Sin asientos requeridos._';
  return json.journalEntries
    .map((j) => {
      const rows = j.lines
        .map(
          (l) =>
            `| ${l.pucAccount} | ${l.accountName} | ${money(l.debitCents)} | ${money(l.creditCents)} |`,
        )
        .join('\n');
      return [
        `### ${j.description} (${j.date})`,
        '',
        '| Cuenta | Nombre | Débito | Crédito |',
        '|---|---|---|---|',
        rows,
      ].join('\n');
    })
    .join('\n\n');
}

function money(cents: string): string {
  return formatCopFromCents(parseMoneyCop(cents), false);
}
