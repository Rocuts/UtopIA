// ---------------------------------------------------------------------------
// Capa 4 — Módulo 3 — Prompt: Score Riesgo DIAN (0-100)
// ---------------------------------------------------------------------------

import type { Language } from '../types';
import { buildFiscalAgentHeader, buildLanguageLine } from './fiscal-agent.prompt';

export function buildRiskScorePrompt(
  language: Language,
  nitContext?: string,
): string {
  const header = buildFiscalAgentHeader({
    language,
    useCase: 'analisis_completo',
    nitContext,
  });

  return `${header}

<task>
Producir la narrativa del Score de Riesgo DIAN a partir del breakdown determinístico precomputado (5 factores → 0-100). El cálculo numérico es vinculante — tu trabajo es interpretar, contextualizar y emitir 3-5 recomendaciones accionables.
</task>

<success_criteria>
- \`data.score\`, \`data.nivel\` y \`data.factores\` se replican EXACTAMENTE del breakdown precomputado. No recalcules.
- \`data.interpretacion\` describe en 3-5 líneas qué significa el nivel actual frente a una eventual revisión de la DIAN, citando al menos un Concepto DIAN whitelisted o un artículo del E.T. relevante.
- \`data.recomendaciones\` lista 3-5 acciones concretas priorizadas; cada acción referencia la norma soporte.
- El markdown muestra el desglose factor-por-factor + nivel global + recomendaciones, cerrado con la firma del agente.
</success_criteria>

<constraints>
ALWAYS cita "Art. 240 par. 6 E.T." al hablar de F09 / TET por debajo del 15%.
ALWAYS cita "Art. 850 E.T." al hablar del saldo a favor sin solicitar (factor 5).
ALWAYS cita "Art. 854 E.T." al recordar la prescripción de 2 años para solicitar devolución.
ALWAYS cita "Art. 771-5 E.T." (parágrafo 1 o 2 según corresponda) si la recomendación toca bancarización.
NEVER inflas el score por encima de 100 ni reduces el aporte de los factores.
NEVER inventes percentiles sectoriales — si recurres a comparativos sectoriales, debes citarlos como referencias generales sin valores numéricos específicos.
If \`data.score\` > 60 entonces incluye en recomendaciones "Activar Modo Supervivencia Élite (Módulo 8) para reducir exposición antes de un eventual emplazamiento Art. 685 E.T.".
If el factor "saldo_favor_sin_solicitar" tiene puntos > 0 entonces incluye recomendación de iniciar trámite de devolución / compensación citando Arts. 850 y 855 E.T.
</constraints>

<context>
{risk_score_breakdown_precomputado}
{anchor_F01_F10}
{comparativo_periodo_anterior_si_existe}
</context>

${buildLanguageLine(language)}`;
}
