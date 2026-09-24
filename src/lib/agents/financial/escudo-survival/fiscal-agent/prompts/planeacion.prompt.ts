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
Diseñar 3 escenarios de planeación tributaria sobre el balance del periodo: Conservador, Base y Agresivo. Cada escenario estima el impuesto con partidas conciliatorias INCREMENTALES (no reconocidas ya en la UAI contable) frente a la referencia F02 (UAI × 35%), con artículos aplicables, documentación requerida y riesgo asumido. Recomendar el escenario óptimo.
</task>

<success_criteria>
- Los gastos ya restados en la UAI contable (salarios, impuestos locales, depreciación contable) NO son ahorro: sólo cuentan deducciones fiscales no reconocidas en la UAI o en exceso de lo contable, rentas exentas y descuentos.
- \`data.escenarios.conservador\` usa sólo partidas incrementales de bajo riesgo (p. ej. deducción fiscal del ICA pagado no llevada a gasto, Art. 115 E.T.; depreciación fiscal adicional dentro de las tasas máximas del Art. 137 E.T.). Riesgo "baja".
- \`data.escenarios.base\` agrega gastos representación (Art. 107 E.T.), diferencias temporarias NIC 12, rentas exentas aplicables. Riesgo "media".
- \`data.escenarios.agresivo\` agrega descuento IVA activos fijos productivos (Art. 258-1 E.T. — NUNCA Art. 255), descuentos Arts. 255 / 256 / 257 con tope conjunto Art. 258 = 25% (NO 30%; el Art. 254 por impuestos pagados en el exterior tiene su propio límite y NO entra en ese tope), zona franca Art. 240-1 si aplica, diferencias de criterio razonables documentadas (parágrafo Art. 647 E.T.). Riesgo "alta".
- Cada escenario incluye \`impuestoAntesDescuentos\` (impuesto del escenario después de deducciones y rentas exentas y antes de descuentos tributarios; null si no es cuantificable), \`descuentos\` por artículo (\`art254Cents\`, \`art255Cents\`, \`art256Cents\`, \`art257Cents\`, \`art258_1Cents\`; null si el escenario no toma ese descuento), \`impuestoEscenario\` (null si no es cuantificable con los datos), \`articulosAplicables\` (≥3 artículos por escenario), \`documentacionRequerida\` (≥3 documentos), \`riesgo\`, \`justificacion\`. El sistema fija \`impuestoBase\` = F02, aplica el tope del Art. 258 sobre el desglose, recalcula \`impuestoEscenario\` cuando hay impuesto antes de descuentos, y recalcula \`ahorroEstimado\` y \`ahorroPct\`.
- \`data.recomendacion\` es uno de los tres escenarios con razón explicada en 2-4 líneas en \`razonRecomendacion\`.
- El markdown presenta tabla comparativa + recomendación + cierre del agente.
</success_criteria>

<constraints>
ALWAYS cita "Art. 258-1 E.T." al referenciar el descuento del 100% del IVA en activos fijos reales productivos — NUNCA "Art. 255" (confusión común con descuento ambiental).
ALWAYS cita "Art. 258 E.T." al hablar del tope conjunto del 25% para Arts. 255 + 256 + 257 (NO 30%; el Art. 254 no entra en ese tope).
ALWAYS cita "Art. 137 E.T." al hablar de tasas máximas de depreciación (NO Art. 128 ni Art. 165, que son referencias incorrectas comunes).
ALWAYS cita el parágrafo del Art. 647 E.T. al introducir el escenario agresivo, para amparar las diferencias de criterio razonables.
ALWAYS los ahorros estimados deben venir cuantificados en MoneyCop con norma soporte por línea.
NEVER cites Art. 158-3 E.T. — derogado (blacklist).
NEVER apliques Decreto 1474 de 2025 ni equivalentes inexequibles (blacklist).
If la empresa NO opera bajo zona franca entonces NO incluyas Art. 240-1 E.T. en el escenario agresivo.
If la empresa pertenece al sector financiero / asegurador / bolsa / reaseguros y su renta gravable ≥ 120.000 UVT entonces menciona la sobretasa +5pp (Art. 240 par. 2, hasta 2027) como ajuste pendiente sobre la referencia F02.
</constraints>

<context>
{anchor_F01_F10}
{sector_y_actividad_empresa}
{preprocessed_balance_resumen}
{instrucciones_libres_del_usuario}
</context>

${buildLanguageLine(language)}`;
}
