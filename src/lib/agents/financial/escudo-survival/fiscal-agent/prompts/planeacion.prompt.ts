// ---------------------------------------------------------------------------
// Capa 4 — Módulo 4 — Prompt: Planeación Tributaria (3 escenarios)
// ---------------------------------------------------------------------------

import type { Language } from '../types';
import { buildFiscalAgentHeader, buildLanguageLine } from './fiscal-agent.prompt';

export function buildPlaneacionPrompt(
  language: Language,
  nitContext?: string,
): string {
  const header = buildFiscalAgentHeader({
    language,
    useCase: 'planeacion_tributaria',
    nitContext,
  });

  return `${header}

<task>
Diseñar 3 escenarios de planeación tributaria sobre el balance del periodo: Conservador, Base y Agresivo. Cada escenario calcula el impuesto estimado, el ahorro vs base (F02 referencia 35%), los artículos aplicables, la documentación requerida y el riesgo asumido. Recomendar el escenario óptimo.
</task>

<success_criteria>
- \`data.escenarios.conservador\` usa solo deducciones de bajo riesgo: salarios+parafiscales (Art. 108 E.T.), impuestos locales (Art. 115 E.T.), depreciación (Art. 137 E.T.). Riesgo "baja".
- \`data.escenarios.base\` agrega gastos representación (Art. 107 E.T.), diferencias temporarias NIC 12, rentas exentas aplicables. Riesgo "media".
- \`data.escenarios.agresivo\` agrega descuento IVA activos fijos productivos (Art. 258-1 E.T. — NUNCA Art. 255), descuentos Arts. 254 / 256 / 257 con tope conjunto Art. 258 = 25% (NO 30%), zona franca Art. 240-1 si aplica, diferencias de criterio razonables documentadas (parágrafo Art. 647 E.T.). Riesgo "alta".
- Cada escenario incluye \`impuestoBase\` (F02 referencia tarifa 35%), \`impuestoEscenario\`, \`ahorroEstimado\`, \`ahorroPct\`, \`articulosAplicables\` (≥3 artículos por escenario), \`documentacionRequerida\` (≥3 documentos), \`riesgo\`, \`justificacion\`.
- \`data.recomendacion\` es uno de los tres escenarios con razón explicada en 2-4 líneas en \`razonRecomendacion\`.
- El markdown presenta tabla comparativa + recomendación + cierre del agente.
</success_criteria>

<constraints>
ALWAYS cita "Art. 258-1 E.T." al referenciar el descuento del 100% del IVA en activos fijos reales productivos — NUNCA "Art. 255" (confusión común con descuento ambiental).
ALWAYS cita "Art. 258 E.T." al hablar del tope conjunto del 25% para Arts. 255 + 256 + 257 + 257-1 (NO 30%).
ALWAYS cita "Art. 137 E.T." al hablar de tasas máximas de depreciación (NO Art. 128 ni Art. 165, que son referencias incorrectas comunes).
ALWAYS cita el parágrafo del Art. 647 E.T. al introducir el escenario agresivo, para amparar las diferencias de criterio razonables.
ALWAYS los ahorros estimados deben venir cuantificados en MoneyCop con norma soporte por línea.
NEVER cites Art. 158-3 E.T. — derogado (blacklist).
NEVER apliques Decreto 1474 de 2025 ni equivalentes inexequibles (blacklist).
If la empresa NO opera bajo zona franca entonces NO incluyas Art. 240-1 E.T. en el escenario agresivo.
If la empresa pertenece al sector financiero / asegurador / bolsa / reaseguros entonces la tarifa base es 40% (sobretasa +5pp Art. 240 par. 2 vigente hasta 2027) — refleja eso en el cálculo del impuesto base de los tres escenarios.
</constraints>

<context>
{anchor_F01_F10}
{sector_y_actividad_empresa}
{preprocessed_balance_resumen}
{instrucciones_libres_del_usuario}
</context>

${buildLanguageLine(language)}`;
}
