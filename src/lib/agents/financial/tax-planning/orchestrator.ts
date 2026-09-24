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
import { getHechosEmpresaBlock } from '@/lib/facts/report-facts';
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

  const hechosEmpresa = await getHechosEmpresaBlock(
    options.workspaceId,
    company.fiscalPeriod,
    language,
  );

  const taxOptimizerResult = await runTaxOptimizer(
    rawData,
    company,
    language,
    instructions,
    onProgress,
    undefined,
    hechosEmpresa,
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
    taxOptimizerResult.impuestoBasicoOrdinarioCents,
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

export async function computeDonationDiscount(
  workspaceId: string | undefined,
  fiscalPeriod: string,
  impuestoACargoVerificadoCents: string | null,
  impuestoBasicoEstimadoCents: string,
): Promise<DonationDiscountBlock | null> {
  if (!workspaceId) return null;
  // El período de un hecho donation se guarda como 'YYYY'; el company.fiscalPeriod
  // del reporte es texto libre (max 20). Se extrae el año de 4 dígitos para casar
  // ambos lados sin depender del formato exacto del request.
  const yearMatch = fiscalPeriod.match(/\d{4}/);
  const period = yearMatch ? yearMatch[0] : fiscalPeriod;
  const facts = await getActiveFacts(workspaceId, period);
  const donation = facts.find(
    (f) => f.kind === 'donation' && f.fiscalPeriod === period,
  );
  if (!donation) return null;
  const montoDonadoCents =
    typeof (donation.structured as { montoCentavos?: unknown } | null)?.montoCentavos === 'string'
      ? (donation.structured as { montoCentavos: string }).montoCentavos
      : '0';
  const rule = resolveRule('descuento_donaciones_257', period); // fail-loud
  const { tasaDescuentoPct, limitePctImpuesto } = art257Params(rule);
  const creditoCents = computeCredito257(montoDonadoCents, tasaDescuentoPct);
  // Base: impuesto a cargo verificado si existiera; hoy el optimizador no lo
  // verifica (TTD N/D), así que se usa el impuesto básico ordinario estimado
  // y el bloque se publica como ESTIMACIÓN, no como total vinculante.
  const baseVerificada = impuestoACargoVerificadoCents !== null;
  const impuestoBaseCents = impuestoACargoVerificadoCents ?? impuestoBasicoEstimadoCents;
  // Art. 258: el 25% es tope CONJUNTO de 255 + 256 + 257. Sin datos de 255/256
  // en esta ruta, el consumo previo es 0 y se advierte en el render.
  const otrosDescuentos255_256Cents = '0';
  const { limiteCents, descuentoCents, impuestoNetoCents } = computeDescuentoAplicado257({
    creditoCents,
    impuestoBaseCents,
    limitePctImpuesto,
  });
  const excedente = BigInt(creditoCents) - BigInt(descuentoCents);
  return {
    fiscalPeriod: period,
    ruleKey: 'descuento_donaciones_257',
    ruleVersion: rule.version,
    montoDonadoCents,
    creditoCents,
    limiteCents,
    otrosDescuentos255_256Cents,
    descuentoCents,
    excedenteTrasladableCents: (excedente > BigInt(0) ? excedente : BigInt(0)).toString(),
    impuestoACargoCents: impuestoBaseCents,
    impuestoNetoCents,
    baseVerificada,
    baseFuente: baseVerificada
      ? 'Impuesto a cargo verificado'
      : 'Impuesto básico ordinario estimado por el optimizador (renta líquida estimada × 35%); la TTD y el impuesto a cargo final son N/D',
  };
}

function renderDonationDiscountBlock(b: DonationDiscountBlock, language: 'es' | 'en'): string {
  const money = (c: string) => formatCopFromCents(parseMoneyCop(c), false);
  const t = (es: string, en: string) => (language === 'es' ? es : en);
  const titulo = b.baseVerificada
    ? t('DESCUENTO POR DONACIONES (Art. 257 E.T.) — TOTAL VINCULANTE', 'DONATION DISCOUNT (Art. 257) — BINDING TOTAL')
    : t('DESCUENTO POR DONACIONES (Art. 257 E.T.) — ESTIMACIÓN (base del optimizador)', 'DONATION DISCOUNT (Art. 257) — ESTIMATE (optimizer base)');
  return [
    `## ${titulo}`,
    `> ${t(
      `Crédito calculado de forma determinista (regla ${b.ruleKey} v${b.ruleVersion}). Base del tope: ${b.baseFuente}.`,
      `Credit computed deterministically (rule ${b.ruleKey} v${b.ruleVersion}). Cap base: ${b.baseFuente}.`,
    )}`,
    `> ${t(
      'El tope del 25% del Art. 258 E.T. es CONJUNTO para los descuentos de los Arts. 255, 256 y 257: si la empresa usa descuentos 255/256 en el mismo año, el espacio para el 257 se reduce. El exceso del 257 no descontado puede tomarse en el periodo gravable siguiente (Art. 258 num. 3).',
      'The 25% cap of Art. 258 is JOINT for Arts. 255, 256 and 257 discounts: any 255/256 discount used in the same year reduces the room for Art. 257. Unused Art. 257 excess may be taken in the following tax year (Art. 258 num. 3).',
    )}`,
    '',
    '| Concepto | Valor |',
    '|---|---|',
    `| ${t('Valor donado', 'Donation value')} | ${money(b.montoDonadoCents)} |`,
    `| ${t('Crédito Art. 257 (25%)', 'Art. 257 credit (25%)')} | ${money(b.creditoCents)} |`,
    `| ${t('Base del tope (impuesto)', 'Cap base (tax)')} | ${money(b.impuestoACargoCents)}${b.baseVerificada ? '' : t(' (estimada)', ' (estimated)')} |`,
    `| ${t('Tope conjunto Art. 258 (25%)', 'Joint cap Art. 258 (25%)')} | ${money(b.limiteCents)} |`,
    `| ${t('Descuentos 255/256 que consumen el tope', '255/256 discounts using the cap')} | ${b.otrosDescuentos255_256Cents === '0' ? t('Sin datos (se asume $0 — verificar)', 'No data (assumed $0 — verify)') : money(b.otrosDescuentos255_256Cents)} |`,
    `| ${t('Descuento aplicado', 'Applied discount')} | ${money(b.descuentoCents)} |`,
    `| ${t('Excedente trasladable al periodo siguiente', 'Excess carried to next year')} | ${money(b.excedenteTrasladableCents)} |`,
    `| **${b.baseVerificada ? t('Impuesto neto (TOTAL VINCULANTE)', 'Net tax (BINDING TOTAL)') : t('Impuesto neto estimado', 'Estimated net tax')}** | **${money(b.impuestoNetoCents)}** |`,
  ].join('\n');
}
