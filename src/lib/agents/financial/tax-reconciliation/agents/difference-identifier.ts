// ---------------------------------------------------------------------------
// Agente 1: Difference Identifier (NIIF-Fiscal) — outcome-first GPT-5.4
// ---------------------------------------------------------------------------
// Schema: TaxDifferenceReportSchema. El Agente 2 (Deferred Tax Calculator)
// consume el shape legacy fullContent vía orchestrator; este adapter lo
// sintetiza desde el JSON validado.
// ---------------------------------------------------------------------------

import { MODELS, MODELS_CONFIG } from '@/lib/config/models';
import { callFinancialAgent } from '../../agents/runtime';
import {
  TaxDifferenceReportSchema,
  type TaxDifferenceReportJson,
} from '../../contracts/tax-reconciliation';
import { formatCopFromCents, parseMoneyCop } from '../../contracts/money';
import { buildDifferenceIdentifierPrompt } from '../prompts/difference-identifier.prompt';
import type { CompanyInfo } from '../../types';
import type { DifferenceIdentifierResult, TaxReconciliationProgressEvent } from '../types';

/**
 * Processes raw accounting data and identifies all NIIF-to-fiscal differences,
 * classifying them as permanent or temporary (deductible/taxable).
 */
export async function runDifferenceIdentifier(
  rawData: string,
  company: CompanyInfo,
  language: 'es' | 'en',
  instructions?: string,
  onProgress?: (event: TaxReconciliationProgressEvent) => void,
  signal?: AbortSignal,
): Promise<DifferenceIdentifierResult> {
  const system = buildDifferenceIdentifierPrompt(company, language);

  const userContent = [
    '<context>',
    'DATOS CONTABLES PARA CONCILIACION FISCAL:',
    '',
    rawData,
    instructions ? `\nINSTRUCCIONES ADICIONALES DEL USUARIO:\n${instructions}` : '',
    '</context>',
  ]
    .filter(Boolean)
    .join('\n');

  onProgress?.({
    type: 'stage_progress',
    stage: 1,
    detail: 'Identificando diferencias entre bases contables NIIF y bases fiscales ET...',
  });

  const { json } = await callFinancialAgent({
    agentName: 'difference-identifier',
    model: MODELS.FINANCIAL_PIPELINE,
    schema: TaxDifferenceReportSchema,
    system,
    userContent,
    ...MODELS_CONFIG.differenceIdentifier,
    signal,
  });

  return toLegacyShape(json);
}

// ---------------------------------------------------------------------------
// Adapter local
// ---------------------------------------------------------------------------

function toLegacyShape(json: TaxDifferenceReportJson): DifferenceIdentifierResult {
  const revenueDifferences = renderCategory(json, 'ingresos');
  const costDeductionDifferences = renderCategory(json, 'costos_deducciones');
  const assetDifferences = renderCategory(json, 'activos');
  const liabilityDifferences = renderCategory(json, 'pasivos');
  const equityDifferences = renderCategory(json, 'patrimonio');
  const bridgeSchedule = renderBridge(json);

  const fullContent = [
    '## 1. DIFERENCIAS EN INGRESOS',
    '',
    revenueDifferences,
    '',
    '## 2. DIFERENCIAS EN COSTOS Y DEDUCCIONES',
    '',
    costDeductionDifferences,
    '',
    '## 3. DIFERENCIAS EN ACTIVOS',
    '',
    assetDifferences,
    '',
    '## 4. DIFERENCIAS EN PASIVOS',
    '',
    liabilityDifferences,
    '',
    '## 5. DIFERENCIAS EN PATRIMONIO',
    '',
    equityDifferences,
    '',
    '## 6. CEDULA PUENTE — PATRIMONIO NIIF A PATRIMONIO FISCAL',
    '',
    bridgeSchedule,
    '',
    renderFormato2516Mapping(json),
    json.preparerNotes.length > 0
      ? ['', '### Notas del Preparador', ...json.preparerNotes.map((n) => `- ${n}`)].join('\n')
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    revenueDifferences,
    costDeductionDifferences,
    assetDifferences,
    liabilityDifferences,
    equityDifferences,
    bridgeSchedule,
    fullContent,
  };
}

function renderCategory(
  json: TaxDifferenceReportJson,
  category: 'ingresos' | 'costos_deducciones' | 'activos' | 'pasivos' | 'patrimonio',
): string {
  const items = json.differences.filter((d) => d.category === category);
  if (items.length === 0) {
    return `_No se identificaron diferencias en la categoría._`;
  }
  const rows = items
    .map(
      (i) =>
        `| ${i.id} | ${i.concept} | ${money(i.accountingBaseCents)} | ${money(i.fiscalBaseCents)} | ${money(i.differenceCents)} | ${classificationLabel(i.classification)} | ${i.niifReference} | ${i.fiscalReference} | ${money(i.deferredTaxAssetCents)} | ${money(i.deferredTaxLiabilityCents)} |`,
    )
    .join('\n');
  return [
    '| ID | Concepto | Base contable NIIF | Base fiscal E.T. | Diferencia | Clasificación | Norma NIIF | Norma fiscal | DTA | DTL |',
    '|---|---|---|---|---|---|---|---|---|---|',
    rows,
  ].join('\n');
}

function renderBridge(json: TaxDifferenceReportJson): string {
  const rows = json.bridgeSchedule
    .map(
      (r) =>
        `| ${r.label} | ${money(r.amountCents)} | ${r.classification} | ${r.reference ?? '—'} |`,
    )
    .join('\n');
  return [
    `**Patrimonio contable NIIF:** ${money(json.patrimonioNiifCents)}`,
    `**Patrimonio fiscal (Art. 282 E.T.):** ${money(json.patrimonioFiscalCents)}`,
    '',
    '| Concepto | Importe | Tipo | Referencia |',
    '|---|---|---|---|',
    rows,
  ].join('\n');
}

function renderFormato2516Mapping(json: TaxDifferenceReportJson): string {
  if (json.formato2516Mapping.length === 0) return '';
  const sectionLabel: Record<string, string> = {
    I_ingresos: 'Sección I — Conciliación de Ingresos',
    II_costos_deducciones: 'Sección II — Conciliación de Costos y Deducciones',
    III_patrimonio: 'Sección III — Conciliación Patrimonial',
    IV_temporarias_permanentes: 'Sección IV — Diferencias Temporarias y Permanentes',
  };
  return [
    '### Mapeo Formato 2516 DIAN',
    '',
    json.formato2516Mapping
      .map((s) => {
        const rows = s.rowReferences
          .map((r) => `- [${r.differenceItemId}] → ${r.formRowLabel}`)
          .join('\n');
        return [`**${sectionLabel[s.section]}:**`, '', rows].join('\n');
      })
      .join('\n\n'),
  ].join('\n');
}

function classificationLabel(c: 'permanente' | 'temporaria_deducible' | 'temporaria_imponible'): string {
  switch (c) {
    case 'permanente':
      return 'Permanente';
    case 'temporaria_deducible':
      return 'Temporaria deducible (DTA)';
    case 'temporaria_imponible':
      return 'Temporaria imponible (DTL)';
  }
}

function money(cents: string): string {
  return formatCopFromCents(parseMoneyCop(cents), false);
}
