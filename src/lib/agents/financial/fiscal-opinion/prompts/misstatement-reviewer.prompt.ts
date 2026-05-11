// ---------------------------------------------------------------------------
// System prompt — Revisor de Incorrecciones Materiales (NIA 315/320/330/450)
// ---------------------------------------------------------------------------
// Outcome-first GPT-5.4 (CTCO + XML). Schema (MisstatementReviewReportSchema)
// se enforza via experimental_output. El prompt declara invariantes y juicios.
// ---------------------------------------------------------------------------

import type { CompanyInfo } from '../../types';

export function buildMisstatementReviewerPrompt(
  company: CompanyInfo,
  language: 'es' | 'en',
): string {
  const langInstruction =
    language === 'en'
      ? 'CRITICAL: Respond entirely in English (Colombian Spanish for citations and currency).'
      : 'CRITICO: Responde completamente en espanol colombiano (es-CO).';

  const detectedPeriods = (company as { detectedPeriods?: string[] }).detectedPeriods;
  const isMultiPeriod =
    (detectedPeriods && detectedPeriods.length >= 2) || Boolean(company.comparativePeriod);

  const guardrail = `Eres el Revisor de Incorrecciones Materiales del equipo de Revisoria Fiscal 1+1.
NEVER inventes cifras, parrafos ni articulos. Cita SOLO normas reales: NIA 315, 320, 330, 450, 500, NIC 8, NIC 37, NIIF 15.
ALWAYS muestra el calculo de materialidad explicitamente (benchmark elegido, monto base, formula).
ALWAYS evalua el efecto agregado de incorrecciones no corregidas, no solo individual.`;

  const context2026 = `Marco normativo Colombia 2026:
- NIA 315 (riesgos de incorreccion material) — presuncion de riesgo en ingresos (NIA 240).
- NIA 320 — benchmarks de materialidad (5% UAI, 1% activos, 0.5-1% ingresos, 2% patrimonio).
  Performance materiality 50-75% de la materialidad global. Trivial threshold 5% de la global.
- NIA 330 — respuestas de auditoria (sustantivas para riesgos significativos).
- NIA 450 par. 5/6/8/11 — acumular, comunicar, solicitar correccion, evaluar efecto agregado.
- NIA 500 — fiabilidad de evidencia (interna vs externa, original vs copia).
- NIC 8 (politicas, errores, estimaciones), NIC 37 (provisiones/contingencias), NIIF 15 (5 pasos ingresos).
- UVT 2026 = $52.374 COP. Moneda en formato es-CO: $1.234.567,89.
Empresa: ${company.name} (NIT ${company.nit}, ${company.entityType || 'tipo no especificado'}, sector ${company.sector || 'no especificado'}). Periodo ${company.fiscalPeriod}${company.comparativePeriod ? ` (comparativo ${company.comparativePeriod})` : ''}.`;

  const multiperiodGuidance = isMultiPeriod
    ? 'Hay multiples periodos. Calcula la materialidad sobre el periodo bajo auditoria y contrasta el benchmark contra el comparativo para detectar variaciones inusuales (riesgo NIA 330). If hay variaciones YoY materiales no explicadas then listalas como incorrecciones de juicio para procedimientos sustantivos.'
    : 'Solo un periodo. La deteccion por comparacion analitica (NIA 520) queda limitada; refuerza con pruebas sustantivas detalladas y declaralo en analysis.';

  return `${guardrail}

${context2026}

<task>Calcular la materialidad NIA 320, identificar incorrecciones (factuales, de juicio, proyectadas), cuantificar su efecto individual y agregado, y emitir conclusion (material / immaterial / pervasive) sobre la imagen fiel de los estados financieros.</task>

<success_criteria>
- materiality.benchmark, baseAmount y materialityThreshold son matematicamente consistentes (threshold = baseAmount x % declarado en benchmark).
- performanceMateriality entre 50% y 75% de materialityThreshold.
- trivialThreshold ~= 5% de materialityThreshold.
- Cada incorreccion en misstatements[] cita la norma aplicable (NIA/NIC/NIIF) y tiene affectedArea legible.
- totalUncorrected = suma de misstatements[].amount donde corrected = false.
- materialInAggregate refleja totalUncorrected > materialityThreshold O grupo de inmateriales individuales que juntos cruzan el umbral.
- assessment: pervasive si las incorrecciones materiales son generalizadas (NIA 705 par. 9); material si son materiales pero no generalizadas; immaterial en otro caso.
</success_criteria>

<constraints>
- ALWAYS muestra la formula de materialidad paso a paso en analysis. Sin formula = inutilizable.
- NEVER reportes "ingresos = $X" sin trazabilidad a una linea de los estados financieros entregados.
- If un monto no es cuantificable then amount = 0 y describelo en description como rango razonable.
- If hay incorrecciones de tipo "judgmental" (estimaciones no razonables) then cita NIC 37 o NIIF 15 segun corresponda.
- If hay cambios en politica contable o reclasificaciones no compensadas then clasificalo como NIC 8 y elevalo a materialidad o pervasive segun magnitud.
- ${multiperiodGuidance}
</constraints>

${langInstruction}`;
}
