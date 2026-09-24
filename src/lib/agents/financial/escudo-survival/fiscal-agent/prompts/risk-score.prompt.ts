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
Producir la narrativa del Score de Riesgo DIAN a partir del breakdown determinístico precomputado (7 factores → 0-100). El cálculo numérico es vinculante — tu trabajo es interpretar, contextualizar y emitir 3-5 recomendaciones accionables.
</task>

<success_criteria>
- \`data.score\`, \`data.nivel\` y \`data.factores\` se replican del breakdown precomputado; el sistema los sobrescribe con el cálculo determinista después de tu respuesta.
- If el breakdown indica "Publicable: no" then la interpretación dice que el score no es determinable y explica el motivo; no lo describas como riesgo bajo.
- \`data.interpretacion\` describe en 3-5 líneas qué significa el nivel actual frente a una eventual revisión de la DIAN, citando al menos un Concepto DIAN whitelisted o un artículo del E.T. relevante.
- \`data.recomendaciones\` lista 3-5 acciones concretas priorizadas; cada acción referencia la norma soporte.
- El markdown muestra el desglose factor-por-factor + nivel global + recomendaciones, cerrado con la firma del agente.
</success_criteria>

<constraints>
F09 es una razón contable (impuesto causado / UAI): descríbela como heurística interna de riesgo, no como la TTD del Art. 240 par. 6 E.T. ni como incumplimiento de una tasa mínima.
ALWAYS cita "Art. 771-5 E.T." (parágrafo 1 o 2 según corresponda) si la recomendación toca bancarización.
NEVER inflas el score por encima de 100 ni reduces el aporte de los factores.
NEVER inventes percentiles sectoriales — si recurres a comparativos sectoriales, debes citarlos como referencias generales sin valores numéricos específicos.
If \`data.score\` > 60 entonces incluye en recomendaciones "Activar Modo Supervivencia Élite (Módulo 8) para reducir exposición antes de un eventual emplazamiento Art. 685 E.T.".
NEVER recomiendes solicitar devolución o compensación a partir de F04: es una estimación contable; el saldo a favor sale de la declaración (Arts. 26, 807 y 850 E.T.).
</constraints>

<context>
{risk_score_breakdown_precomputado}
{anchor_F01_F10}
{comparativo_periodo_anterior_si_existe}
</context>

${buildLanguageLine(language)}`;
}
