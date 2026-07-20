// ---------------------------------------------------------------------------
// Tax Planning Orchestrator — sequential pipeline coordinator
// ---------------------------------------------------------------------------
// Pipeline: Company Data -> Agent 1 (Tax Optimizer) -> Agent 2 (NIIF Impact)
//           -> Agent 3 (Compliance Validator) -> Consolidation
// ---------------------------------------------------------------------------

import { runTaxOptimizer } from './agents/tax-optimizer';
import { runNiifImpactAnalyst } from './agents/niif-impact-analyst';
import { runComplianceValidator } from './agents/compliance-validator';
import { getActiveFacts } from '@/lib/db/facts';
import { resolveRule } from '@/lib/normativa/rules-registry';
import {
  art257Params,
  computeCredito257,
  computeDescuentoAplicado257,
} from '@/lib/normativa/descuento-donaciones-257';
import { formatCopFromCents, parseMoneyCop } from '../contracts/money';
import type {
  TaxPlanningRequest,
  TaxPlanningReport,
  TaxPlanningProgressEvent,
  DonationDiscountBlock,
} from './types';

export interface OrchestrateTaxPlanningOptions {
  onProgress?: (event: TaxPlanningProgressEvent) => void;
  /** Workspace del solicitante (cookie, resuelto en la route) — para leer hechos. */
  workspaceId?: string;
}

/**
 * Execute the full tax planning pipeline.
 *
 * Sequential flow with SSE progress events:
 * 1. Tax Optimizer analyzes current structure → strategies + projected savings
 * 2. NIIF Impact Analyst evaluates accounting effects → deferred tax, disclosures
 * 3. Compliance Validator checks regulatory risk → checklists, red flags
 * 4. Orchestrator consolidates everything into one master report
 */
export async function orchestrateTaxPlanning(
  request: TaxPlanningRequest,
  options: OrchestrateTaxPlanningOptions = {},
): Promise<TaxPlanningReport> {
  const { rawData, company, language, instructions } = request;
  const { onProgress } = options;

  // ---------------------------------------------------------------------------
  // Stage 1: Tax Optimizer
  // ---------------------------------------------------------------------------
  onProgress?.({
    type: 'stage_start',
    stage: 1,
    label: 'Optimizador Tributario — Analizando estructura fiscal y evaluando estrategias',
  });

  const taxOptimizerResult = await runTaxOptimizer(
    rawData,
    company,
    language,
    instructions,
    onProgress,
  );

  onProgress?.({
    type: 'stage_complete',
    stage: 1,
    label: 'Estrategias de optimizacion tributaria generadas',
  });

  // ---------------------------------------------------------------------------
  // Neteo determinista: descuento por donaciones (Art. 257) → TOTAL VINCULANTE.
  // Números de cálculo determinista (no LLM): lee la donación activa del período,
  // recomputa el crédito y aplica el tope contra el impuesto a cargo del optimizador.
  // ---------------------------------------------------------------------------
  const donationDiscount = await computeDonationDiscount(
    options.workspaceId,
    company.fiscalPeriod,
    taxOptimizerResult.impuestoACargoCents,
  );

  // ---------------------------------------------------------------------------
  // Stage 2: NIIF Impact Analyst
  // ---------------------------------------------------------------------------
  onProgress?.({
    type: 'stage_start',
    stage: 2,
    label: 'Analista de Impacto NIIF — Evaluando efectos contables de cada estrategia',
  });

  const niifImpactResult = await runNiifImpactAnalyst(
    taxOptimizerResult,
    company,
    language,
    onProgress,
  );

  onProgress?.({
    type: 'stage_complete',
    stage: 2,
    label: 'Analisis de impacto NIIF completado',
  });

  // ---------------------------------------------------------------------------
  // Stage 3: Compliance Validator
  // ---------------------------------------------------------------------------
  onProgress?.({
    type: 'stage_start',
    stage: 3,
    label: 'Validador de Cumplimiento — Verificando riesgos regulatorios y anti-abuso',
  });

  const complianceResult = await runComplianceValidator(
    taxOptimizerResult,
    niifImpactResult,
    company,
    language,
    onProgress,
  );

  onProgress?.({
    type: 'stage_complete',
    stage: 3,
    label: 'Validacion de cumplimiento regulatorio completada',
  });

  // ---------------------------------------------------------------------------
  // Stage 4: Consolidation
  // ---------------------------------------------------------------------------
  onProgress?.({
    type: 'stage_start',
    stage: 4,
    label: 'Consolidando reporte de planeacion tributaria',
  });

  const consolidatedReport = buildConsolidatedReport(
    company,
    taxOptimizerResult.fullContent,
    niifImpactResult.fullContent,
    complianceResult.fullContent,
    language,
    donationDiscount,
  );

  const report: TaxPlanningReport = {
    company,
    taxOptimization: taxOptimizerResult,
    niifImpact: niifImpactResult,
    complianceValidation: complianceResult,
    consolidatedReport,
    donationDiscount,
    generatedAt: new Date().toISOString(),
  };

  onProgress?.({
    type: 'stage_complete',
    stage: 4,
    label: 'Reporte de planeacion tributaria consolidado listo',
  });

  onProgress?.({ type: 'done' });

  return report;
}

// ---------------------------------------------------------------------------
// Build the final consolidated Markdown report
// ---------------------------------------------------------------------------

function buildConsolidatedReport(
  company: TaxPlanningRequest['company'],
  taxOptimizerContent: string,
  niifImpactContent: string,
  complianceContent: string,
  language: 'es' | 'en',
  donationDiscount: DonationDiscountBlock | null,
): string {
  const donationSection =
    donationDiscount !== null
      ? `${renderDonationDiscountBlock(donationDiscount, language)}\n\n---\n\n`
      : '';
  const title =
    language === 'en'
      ? 'TAX PLANNING REPORT'
      : 'REPORTE DE PLANEACION TRIBUTARIA';

  const subtitle =
    language === 'en'
      ? 'Comprehensive Tax Optimization Analysis'
      : 'Analisis Integral de Optimizacion Tributaria';

  const date = new Date().toLocaleDateString(
    language === 'es' ? 'es-CO' : 'en-US',
    { year: 'numeric', month: 'long', day: 'numeric' },
  );

  return `# ${title}
## ${subtitle}

---

| Campo | Detalle |
|-------|---------|
| **Empresa** | ${company.name} |
| **NIT** | ${company.nit} |
| **Tipo Societario** | ${company.entityType || 'N/A'} |
| **Sector** | ${company.sector || 'N/A'} |
| **Periodo Fiscal** | ${company.fiscalPeriod} |
| **Fecha de Generacion** | ${date} |
| **Generado por** | 1+1 — Tax Planning Pipeline (3 Agentes Especializados) |

---

${donationSection}# PARTE I: DIAGNOSTICO Y ESTRATEGIAS DE OPTIMIZACION TRIBUTARIA
*Preparado por: Agente Optimizador Tributario*

${taxOptimizerContent}

---

# PARTE II: ANALISIS DE IMPACTO NIIF
*Preparado por: Agente Analista de Impacto NIIF*

${niifImpactContent}

---

# PARTE III: VALIDACION DE CUMPLIMIENTO REGULATORIO
*Preparado por: Agente Validador de Cumplimiento*

${complianceContent}

---

> **Nota Legal:** Este reporte fue generado por 1+1, un sistema de inteligencia artificial. Las estrategias de planeacion tributaria propuestas deben ser validadas por un abogado tributarista y un contador publico certificado antes de su implementacion. 1+1 no reemplaza la asesoria profesional. La planeacion tributaria (elusion legal) es un derecho del contribuyente; sin embargo, la evasion fiscal es un delito. Toda estrategia debe cumplir con la clausula anti-abuso del Art. 869 del Estatuto Tributario.
`;
}

// ---------------------------------------------------------------------------
// Neteo determinista del descuento por donaciones (Art. 257) — server-side
// ---------------------------------------------------------------------------
// Degrada a `null` (sin bloque) si no hay workspace o no hay donación activa
// del período. Fail-loud SÓLO vía `resolveRule` si existe la donación pero no
// hay regla vigente — nunca cae silenciosamente a una regla vieja.

async function computeDonationDiscount(
  workspaceId: string | undefined,
  fiscalPeriod: string,
  impuestoACargoCents: string,
): Promise<DonationDiscountBlock | null> {
  if (!workspaceId) return null;
  const facts = await getActiveFacts(workspaceId, fiscalPeriod);
  const donation = facts.find(
    (f) => f.kind === 'donation' && f.fiscalPeriod === fiscalPeriod,
  );
  if (!donation) return null;
  const montoDonadoCents =
    typeof (donation.structured as { montoCentavos?: unknown } | null)?.montoCentavos === 'string'
      ? (donation.structured as { montoCentavos: string }).montoCentavos
      : '0';
  const rule = resolveRule('descuento_donaciones_257', fiscalPeriod); // fail-loud
  const { tasaDescuentoPct, limitePctImpuesto } = art257Params(rule);
  const creditoCents = computeCredito257(montoDonadoCents, tasaDescuentoPct);
  const { limiteCents, descuentoCents, impuestoNetoCents } = computeDescuentoAplicado257({
    creditoCents,
    impuestoBaseCents: impuestoACargoCents,
    limitePctImpuesto,
  });
  return {
    fiscalPeriod,
    ruleKey: 'descuento_donaciones_257',
    ruleVersion: rule.version,
    montoDonadoCents,
    creditoCents,
    limiteCents,
    descuentoCents,
    impuestoACargoCents,
    impuestoNetoCents,
  };
}

function renderDonationDiscountBlock(b: DonationDiscountBlock, language: 'es' | 'en'): string {
  const money = (c: string) => formatCopFromCents(parseMoneyCop(c), false);
  const t = (es: string, en: string) => (language === 'es' ? es : en);
  return [
    `## ${t('DESCUENTO POR DONACIONES (Art. 257 E.T.) — TOTAL VINCULANTE', 'DONATION DISCOUNT (Art. 257) — BINDING TOTAL')}`,
    `> ${t(
      `Descuento calculado de forma DETERMINISTA (regla ${b.ruleKey} v${b.ruleVersion}). El impuesto a cargo base proviene del diagnóstico del Optimizador Tributario.`,
      `Discount computed DETERMINISTICALLY (rule ${b.ruleKey} v${b.ruleVersion}). The base tax-on-charge comes from the Tax Optimizer's diagnosis.`,
    )}`,
    '',
    '| Concepto | Valor |',
    '|---|---|',
    `| ${t('Valor donado', 'Donation value')} | ${money(b.montoDonadoCents)} |`,
    `| ${t('Crédito Art. 257 (25%)', 'Art. 257 credit (25%)')} | ${money(b.creditoCents)} |`,
    `| ${t('Tope (25% del impuesto)', 'Cap (25% of tax)')} | ${money(b.limiteCents)} |`,
    `| ${t('Descuento aplicado', 'Applied discount')} | ${money(b.descuentoCents)} |`,
    `| ${t('Impuesto a cargo', 'Tax before discount')} | ${money(b.impuestoACargoCents)} |`,
    `| **${t('Impuesto neto (TOTAL VINCULANTE)', 'Net tax (BINDING TOTAL)')}** | **${money(b.impuestoNetoCents)}** |`,
  ].join('\n');
}
