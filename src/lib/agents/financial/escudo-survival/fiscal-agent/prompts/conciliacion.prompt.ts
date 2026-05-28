// ---------------------------------------------------------------------------
// Capa 4 — Módulo 2 — Prompt: Conciliación Fiscal Borrador
// ---------------------------------------------------------------------------

import type { Language } from '../types';
import { buildFiscalAgentHeader, buildLanguageLine } from './fiscal-agent.prompt';

export function buildConciliacionPrompt(
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
Producir el BORRADOR de la conciliación fiscal del periodo. Partiendo de la UAI contable (F01), llegar a la renta líquida gravable y al saldo final a pagar o a favor mediante adiciones, deducciones, rentas exentas, INCRGNO, descuentos tributarios, retenciones y anticipos. NO es la liquidación oficial — es un borrador que el contador valida antes de presentar.
</task>

<success_criteria>
- \`data.uaiContable\` = F01 del Âncora (intocable).
- \`data.lineas\` contiene líneas con concepto, monto MoneyCop (positivo suma, negativo resta), norma exacta del Estatuto Tributario, tipo (adicion / deduccion / renta_exenta / incrgno / descuento / retencion / anticipo).
- \`data.rentaLiquidaGravable\` = UAI + Σ adiciones − Σ deducciones − Σ rentas_exentas − Σ incrgno.
- \`data.tarifaPct\` = 35 por defecto; ajusta solo si la empresa califica para tarifa especial (zona franca Art. 240-1, hidroeléctricas / financieras Art. 240 par. 2, etc.).
- \`data.impuestoBruto\` = rentaLiquidaGravable × tarifa.
- \`data.totalDescuentos\` = Σ descuentos (Arts. 254 / 256 / 257 / 257-1 / 258-1).
- \`data.impuestoNeto\` = impuestoBruto − totalDescuentos.
- \`data.retencionesYAnticipos\` = F03 del Âncora (intocable).
- \`data.saldoFinal\` = impuestoNeto − retencionesYAnticipos (positivo a pagar, negativo a favor — Art. 850 E.T.).
- \`data.disclaimer\` cierra con: "Las diferencias amparadas por el parágrafo del Art. 647 E.T. (diferencia de criterio razonable) requieren documentación que sustente la interpretación."
- El markdown muestra la conciliación como tabla en formato es-CO + cierre del agente.
</success_criteria>

<constraints>
ALWAYS cita "Art. 107 E.T." al referenciar deducción de expensas necesarias.
ALWAYS cita "Art. 108 E.T." al referenciar deducción de salarios con requisito parafiscales.
ALWAYS cita "Art. 115 E.T." al deducir ICA / GMF / impuestos pagados.
ALWAYS cita "Art. 258 E.T." (tope conjunto 25%) cuando agregues descuentos Arts. 255 + 256 + 257 + 257-1.
ALWAYS cita "Art. 258-1 E.T." cuando incluyas el descuento del 100% del IVA en activos fijos reales productivos — éste NO entra en el tope conjunto.
NEVER cites Art. 158-3 E.T. ni Art. 128/165 como deducciones vigentes (Art. 158-3 derogado por Ley 1819/2016; Arts. 128/165 referencias incorrectas — la depreciación vive en Arts. 134-141 con tasas en Art. 137).
NEVER apliques tarifa plana 10% a dividendos PN residentes (Ley 2277/2022 los integra a base ordinaria — Arts. 241 + 242).
If no hay datos sobre rentas exentas en el balance entonces no inventes líneas — emite array sin entradas de tipo "renta_exenta" y declara warning.
If la empresa es financiera / aseguradora / bolsa / reaseguradora entonces \`tarifaPct\` = 40 (Art. 240 par. 2 E.T., vigente hasta 2027).
If la empresa es hidroeléctrica / acueducto entonces \`tarifaPct\` = 38 (Art. 240 par. 2 E.T., vigente hasta 2026).
</constraints>

<context>
{skeleton_conciliacion_precomputado_con_uai_impuestoBrutoBase_retencionesF03_saldoFinalBase}
{anchor_F01_F10_y_alertas}
{instrucciones_libres_del_usuario_si_existen}
</context>

${buildLanguageLine(language)}`;
}
