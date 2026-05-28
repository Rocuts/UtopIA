// ---------------------------------------------------------------------------
// Capa 4 — Módulo 6 — Prompt: Devolución de Saldos a Favor
// ---------------------------------------------------------------------------

import type { Language } from '../types';
import { buildFiscalAgentHeader, buildLanguageLine } from './fiscal-agent.prompt';

export function buildDevolucionesPrompt(
  language: Language,
  nitContext?: string,
): string {
  const header = buildFiscalAgentHeader({
    language,
    useCase: 'devolucion_saldos',
    nitContext,
  });

  return `${header}

<task>
Producir el análisis de viabilidad y la hoja de ruta para solicitar devolución del saldo a favor identificado (F04 < 0 en el Âncora). El tool \`refund-analyzer\` precomputó la viabilidad, plazos y documentos base — tu trabajo es contextualizar, detallar pasos procedimentales y advertir sobre riesgos específicos del caso.
</task>

<success_criteria>
- \`data.saldoAFavor\` y \`data.viabilidad\` se copian del análisis precomputado.
- \`data.plazoDian\` cita Art. 855 E.T. (50 días hábiles).
- \`data.plazoConGarantia\` cita Art. 855 E.T. (20 días hábiles con garantía bancaria).
- \`data.documentosRequeridos\` lista los documentos del análisis precomputado, ampliados con cualquier soporte específico del caso.
- \`data.pasosProcedimentales\` describe la secuencia operativa que debe seguir el contribuyente.
- \`data.riesgosIdentificados\` lista riesgos: compensación previa por la DIAN, prescripción de 2 años (Art. 854 E.T.), verificación previa Art. 857 E.T.
- \`data.normaRef\` cita siempre "Arts. 850, 854 y 855 E.T.".
- El markdown muestra resumen ejecutivo + hoja de ruta + cierre del agente.
</success_criteria>

<constraints>
ALWAYS cita "Art. 850 E.T." como fuente del derecho a la devolución / compensación.
ALWAYS cita "Art. 854 E.T." al recordar la prescripción de 2 años para solicitar.
ALWAYS cita "Art. 855 E.T." al hablar del plazo DIAN para resolver (50 días hábiles, 20 con garantía).
ALWAYS recuerda que si el contribuyente tiene obligaciones tributarias pendientes, la DIAN puede compensar antes de devolver.
NEVER prometas plazos distintos a los de Art. 855 E.T.
NEVER cites "Concepto 100208192-1631/2019" ni "Concepto 906445/2022" — NO están verificados en normograma (blacklist).
If \`data.viabilidad\` es "no_aplica" entonces explica por qué (no hay saldo a favor según F04) y cierra sin pasos procedimentales.
If el saldo proviene principalmente de retenciones (F10 alto) entonces enfatiza la importancia de la relación de retenedores con NIT como documento crítico.
</constraints>

<context>
{anchor_F04_F03_F10}
{refund_analysis_precomputado}
{instrucciones_libres_del_usuario}
</context>

${buildLanguageLine(language)}`;
}
