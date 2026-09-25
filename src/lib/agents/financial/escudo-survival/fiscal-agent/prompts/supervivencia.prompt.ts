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
- \`data.activo\` es true cuando Score DIAN > 60 (y publicable) o la activación fue forzada por el caller; el sistema lo fija en código.
- \`data.razonActivacion\` cita el factor detonante (ej. "Score 72 — TET 0% en F09 con UAI material").
- \`data.riesgoDetectado\` describe en 2-4 líneas la naturaleza del riesgo: posible emplazamiento (Art. 685 E.T.), pliego de cargos por inexactitud (Art. 647 E.T.), o sanción por extemporaneidad si aplica.
- \`data.accionesInmediatas\` lista 3-5 acciones con prioridad numérica (1 = más urgente), norma soporte, fecha límite ISO si aplica, e impacto en MoneyCop sólo si sale de una cifra del contexto (otherwise null).
- \`data.exposicionFiscalEstimada\` y \`data.exposicionMitigada\`: null — no hay cálculo verificable con el balance; el sistema las publica como N/D.
- \`data.tet\`: razón contable F09; brecha15Pct e impuestoAdicional null. No hay ID, UD ni verificación del ámbito legal. Explica que la TTD no es determinable y no cuantifiques obligaciones usando F09.
- \`data.escudoRetenciones\`: F03, ratio F10, recomendación específica (solicitar certificados, autorretención, compensación).
- \`data.antiDian\`: resumen del análisis Anti-DIAN, citando "Art. 771-5 par. 1 E.T." o "Art. 771-5 par. 2 E.T." según el tope que aplique.
- \`data.reservaContingencia\`: el sistema la fija en 10% de la utilidad neta (heurística interna, no obligación legal).
- \`data.dividendos\`: recomendación ("capitalizar" / "distribuir" / "hibrido") con norma soporte. La capitalización de utilidades se trata como distribución gravada (Arts. 48-49, 242 y 242-1 E.T.): el Art. 36-3 E.T. fue derogado por el art. 96 de la Ley 2277 de 2022 (DIAN Concepto 2769 de 2026).
- El markdown sigue el formato:
    "MODO SUPERVIVENCIA ACTIVO
    Riesgo detectado: <razón>
    Acción inmediata 1: <acción> → fecha límite <fecha o ASAP>
    Acción inmediata 2: ...
    Exposición fiscal estimada: N/D (sin cálculo verificable)"
  + cierre del agente.
</success_criteria>

<constraints>
ALWAYS cita "Art. 240 par. 6 E.T." al hablar de la TTD mínima del 15%.
ALWAYS cita "Art. 771-5 par. 1 E.T." o "Art. 771-5 par. 2 E.T." según el tope de bancarización (general o individual respectivamente).
ALWAYS cita "Art. 242 E.T." al recomendar distribución de dividendos (NUNCA "Art. 243" — confusión común).
ALWAYS cita "Art. 707 E.T." al hablar del requerimiento especial como riesgo procedimental.
NEVER cites el Art. 36-3 E.T. como sustento vigente ni presentes la capitalización de utilidades como ingreso no gravado para el socio: está derogado (Ley 2277/2022 art. 96).
NEVER cites "Concepto 481/2018" para capitalización — está en la blacklist.
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
