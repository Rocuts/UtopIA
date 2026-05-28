// ---------------------------------------------------------------------------
// Capa 4 — Módulo 8 — Prompt: Modo Supervivencia Élite
// ---------------------------------------------------------------------------
//
// Se activa cuando Score DIAN > 60 o cuando el caller fuerza el modo. Consolida
// señales de los 5 submódulos del Escudo (TET, Escudo Retenciones, Anti-DIAN,
// Reserva Contingencia, Optimización Dividendos) en un plan de acción
// inmediato con exposición fiscal cuantificada y acciones priorizadas.
//
// reasoningEffort = 'high' — decisiones bajo crisis.
// ---------------------------------------------------------------------------

import type { Language } from '../types';
import { buildFiscalAgentHeader, buildLanguageLine } from './fiscal-agent.prompt';

export function buildSupervivenciaPrompt(
  language: Language,
  nitContext?: string,
): string {
  const header = buildFiscalAgentHeader({
    language,
    useCase: 'modo_supervivencia',
    nitContext,
  });

  return `${header}

<task>
Componer el dictamen de Modo Supervivencia Élite: razón de activación, riesgo detectado, 3-5 acciones inmediatas priorizadas con fecha límite e impacto cuantificado, exposición fiscal estimada y exposición mitigada si se actúa. Cinco submódulos: TET, Escudo Retenciones, Anti-DIAN, Reserva Contingencia, Optimización Dividendos.
</task>

<success_criteria>
- \`data.activo\` es true cuando Score DIAN > 60 o la activación fue forzada por el caller.
- \`data.razonActivacion\` cita el factor detonante (ej. "Score 72 — TET 0% en F09 con UAI material").
- \`data.riesgoDetectado\` describe en 2-4 líneas la naturaleza del riesgo: posible emplazamiento (Art. 685 E.T.), pliego de cargos por inexactitud (Art. 647 E.T.), o sanción por extemporaneidad si aplica.
- \`data.accionesInmediatas\` lista 3-5 acciones con prioridad numérica (1 = más urgente), norma soporte, fecha límite ISO si aplica, e impacto estimado en MoneyCop.
- \`data.exposicionFiscalEstimada\` cuantifica el monto del riesgo si NO se actúa.
- \`data.exposicionMitigada\` cuantifica el monto del riesgo si se ejecutan las acciones inmediatas.
- \`data.tet\`: TET actual (F09), brecha vs 15% (Ley 2277/2022 Art. 10), impuesto adicional estimado.
- \`data.escudoRetenciones\`: F03, ratio F10, recomendación específica (solicitar certificados, autorretención, compensación).
- \`data.antiDian\`: resumen del análisis Anti-DIAN, citando "Art. 771-5 par. 1 E.T." o "Art. 771-5 par. 2 E.T." según el tope que aplique.
- \`data.reservaContingencia\`: provisión sugerida (10% de utilidad neta sugerido), pctUtilidad.
- \`data.dividendos\`: recomendación ("capitalizar" / "distribuir" / "hibrido") con norma soporte (Art. 36-3 capitalización o Art. 242 distribución).
- El markdown sigue el formato:
    "MODO SUPERVIVENCIA ACTIVO
    Riesgo detectado: <razón>
    Acción inmediata 1: <acción> → fecha límite <fecha o ASAP>
    Acción inmediata 2: ...
    Exposición fiscal estimada: $<monto>
    Si se actúa antes de [<fecha>]: reducción posible a $<monto mitigado>"
  + cierre del agente.
</success_criteria>

<constraints>
ALWAYS cita "Art. 240 par. 6 E.T." al hablar de la TTD mínima del 15%.
ALWAYS cita "Art. 771-5 par. 1 E.T." o "Art. 771-5 par. 2 E.T." según el tope de bancarización (general individual respectivamente).
ALWAYS cita "Art. 36-3 E.T." al recomendar capitalización de utilidades.
ALWAYS cita "Art. 242 E.T." al recomendar distribución de dividendos (NUNCA "Art. 243" — confusión común).
ALWAYS cita "Art. 707 E.T." al hablar del pliego de cargos como riesgo procedimental.
NEVER cites "Concepto 481/2018" para capitalización — está en la blacklist. Para capitalización, el sustento normativo es Art. 36-3 E.T. y, si aplica, Oficio DIAN 0348/2020 (whitelisted).
NEVER prometas reducción a cero — la mitigación es probabilística, no garantizada.
If las acciones requieren plazo legal (corrección Art. 644, devolución Art. 854, etc.) entonces incluye la fecha límite exacta en \`fechaLimite\`.
If no hay socios identificables en el balance entonces el submódulo dividendos emite \`recomendacion: "capitalizar"\` con justificación en warnings.
</constraints>

<context>
{anchor_F01_F10_y_alertas}
{risk_score_breakdown}
{conciliacion_si_se_corrio}
{anti_dian_si_se_corrio}
{preprocessed_balance_summary}
</context>

${buildLanguageLine(language)}`;
}
