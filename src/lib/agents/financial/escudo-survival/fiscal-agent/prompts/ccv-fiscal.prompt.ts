// ---------------------------------------------------------------------------
// Capa 4 — Módulo 1 — Prompt: CCV Fiscal F01-F10
// ---------------------------------------------------------------------------
//
// Outcome-first GPT-5.4 (CTCO + XML). Schema enforced via experimental_output
// (ccvModuleSchema). El system prompt NO incluye el schema en prosa — solo el
// outcome y los criterios de éxito narrativos.
//
// Estructura cache-friendly: cabecera estable arriba (identidad + Motor
// Normativo + constantes), <task> / <success_criteria> / <constraints>,
// <context> dinámico abajo (skeleton con F01-F10 + alerta tasa mínima
// precomputadas).
// ---------------------------------------------------------------------------

import type { Language } from '../types';
import { buildFiscalAgentHeader, buildLanguageLine } from './fiscal-agent.prompt';

export function buildCcvFiscalPrompt(
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
Producir el análisis narrativo del CCV Fiscal F01-F10 sobre el snapshot determinístico precomputado del Bloque Âncora (Capa 1). Los números F01-F10 ya están calculados — tu trabajo es interpretarlos, identificar alertas y proponer acciones.
</task>

<success_criteria>
- El campo \`markdown\` contiene 10 secciones, una por cada cifra F01-F10, cada una con: valor (formato es-CO), interpretación contable/fiscal en 1-3 líneas, norma soporte exacta.
- Si \`alertaTasaMinima.aplica\` es true, el markdown incluye sección dedicada "ALERTA TASA MÍNIMA" citando Art. 240 par. 6 E.T. y cuantificando el impuesto adicional estimado.
- El markdown cierra con la firma obligatoria de El Escudo.
- En \`data\`, repite los valores numéricos del snapshot SIN modificarlos. NO recalcules — los anchors son vinculantes.
- En \`data.eficienciaFiscal\` mantén el valor del snapshot ("alta" / "media" / "baja") salvo que justifiques el cambio en warnings.
- \`warnings\` enumera limitaciones del análisis (ej. "F03 no incluye anticipos del Art. 850 — proxy basado en cuentas 1355 + 1805").
</success_criteria>

<constraints>
ALWAYS cita "Art. 240 par. 6 E.T." al hablar de la TTD y "Ley 2277/2022 Art. 10" como norma de origen.
ALWAYS cita "Art. 850 E.T." al interpretar F04 < 0 (saldo a favor).
ALWAYS cita "Art. 376 E.T." al interpretar F06 (retención por declarar).
ALWAYS preserva exactamente los valores MoneyCop del snapshot — no redondees ni reformulees.
NEVER inventes valores: si un campo es "0" en el snapshot porque la cuenta no existe, dilo y agrega warning.
NEVER cites Art. 158-3 E.T. como vigente (está derogado por Ley 1819/2016 Art. 376 — en la blacklist).
If F01 ≤ 0 entonces F02 = "0" y F09 = 0 — interprétalo como periodo sin utilidad fiscal (pérdida fiscal) y recomienda evaluar Art. 147 E.T. (compensación de pérdidas) en el siguiente periodo.
If F10 < 50% entonces la cobertura de retenciones es baja — recomienda revisar omisiones del agente retenedor o solicitar certificados de no retención.
If F09 < 15% y F01 > 0 entonces incluye en el markdown la sección de impuesto adicional estimado por TTD.
</constraints>

<context>
{snapshot_F01_F10_y_alerta_tasa_minima_precomputado}
{anchor_calendario_dian_y_alertas_capa_1}
</context>

${buildLanguageLine(language)}`;
}
