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
Producir el análisis de viabilidad de devolución o compensación de un saldo a favor de renta. El saldo a favor que puede devolverse es el LIQUIDADO en la declaración (Formulario 110); F04 < 0 en el Âncora es sólo una estimación contable (UAI × 35% − F03) y nunca base de devolución. El tool \`refund-analyzer\` precomputó saldo, viabilidad, plazos y documentos base — tu trabajo es contextualizar y advertir riesgos.
</task>

<success_criteria>
- \`data.saldoAFavor\`, \`data.viabilidad\`, \`data.plazoDian\`, \`data.plazoConGarantia\` y \`data.normaRef\` se copian del análisis precomputado (el sistema los sobrescribe).
- \`data.documentosRequeridos\` lista los documentos del análisis precomputado, ampliados con cualquier soporte específico del caso.
- \`data.pasosProcedimentales\` describe la secuencia operativa que debe seguir el contribuyente.
- \`data.riesgosIdentificados\` lista riesgos: compensación previa por la DIAN, prescripción de 2 años (Art. 854 E.T.), verificación previa Art. 857 E.T.
- El markdown muestra resumen ejecutivo + hoja de ruta + cierre del agente.
</success_criteria>

<constraints>
ALWAYS cita "Art. 850 E.T." como fuente del derecho a la devolución / compensación.
ALWAYS cita "Art. 854 E.T." al recordar la prescripción de 2 años para solicitar.
ALWAYS cita "Art. 855 E.T." al hablar del plazo DIAN para resolver (50 días hábiles) y "Art. 860 E.T." para la devolución con garantía de entidad bancaria o compañía de seguros (20 días).
ALWAYS recuerda que si el contribuyente tiene obligaciones tributarias pendientes, la DIAN puede compensar antes de devolver.
NEVER prometas plazos distintos a los de los Arts. 855 y 860 E.T.
NEVER presentes F04 como saldo a favor ni cuantifiques una devolución sin saldo declarado.
NEVER cites "Concepto 100208192-1631/2019" ni "Concepto 906445/2022" — NO están verificados en normograma (blacklist).
If \`data.viabilidad\` es "no_determinable" entonces explica que falta la declaración con el saldo liquidado, que F04 es estimación contable, y cierra sin cuantía ni pasos de solicitud.
If \`data.viabilidad\` es "no_aplica" entonces explica que la declaración no liquida saldo a favor y cierra sin pasos procedimentales.
If el saldo proviene principalmente de retenciones (F10 alto) entonces enfatiza la importancia de la relación de retenedores con NIT como documento crítico.
</constraints>

<context>
{anchor_F04_F03_F10}
{refund_analysis_precomputado}
{instrucciones_libres_del_usuario}
</context>

${buildLanguageLine(language)}`;
}
