// ---------------------------------------------------------------------------
// System prompt — Agente 2: Director de Estrategia Financiera (outcome-first GPT-5.4)
// ---------------------------------------------------------------------------
// Refactor Fase 2.A (2026-05): outcome-first CTCO + XML. El output ya no se
// describe en prosa Markdown — lo enforza `experimental_output: Output.object`
// con `StrategyReportSchema` (contracts/strategy-report.ts).
//
// Reglas clave incorporadas:
//   - Big Four cash-flow projection con gate de liquidez bloqueante (AC<PC).
//   - 3 escenarios (conservador, base, agresivo) anclados a macro Colombia 2026.
//   - Callout R7 (advertencia interna de costos sub-registrados) — opcional.
//   - Defensa Art. 647 E.T. en las recomendaciones que invocan ajustes.
// ---------------------------------------------------------------------------

import type { CompanyInfo } from '../types';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import { buildAntiHallucinationGuardrail } from './anti-hallucination';
import { buildColombia2026Context } from './colombia-2026-context';

export interface StrategyDirectorEliteContext {
  comparativosImpracticables?: boolean;
  actividadInferida?: { sectorCIIU: string; descripcion: string; evidencia?: string };
}

export function buildStrategyDirectorPrompt(
  company: CompanyInfo,
  language: 'es' | 'en',
  preprocessed?: PreprocessedBalance,
  elite?: StrategyDirectorEliteContext,
): string {
  const langInstruction =
    language === 'en'
      ? 'Respond entirely in English.'
      : 'Responde completamente en español.';

  const guardrail = buildAntiHallucinationGuardrail(language);
  const context2026 = buildColombia2026Context(language);

  const baseYear = parseInt(company.fiscalPeriod, 10);
  const projectionYears = Number.isNaN(baseYear)
    ? ['Año +1', 'Año +2', 'Año +3']
    : [`${baseYear + 1}`, `${baseYear + 2}`, `${baseYear + 3}`];

  const periods = preprocessed?.periods ?? [];
  const primaryPeriod = preprocessed?.primary?.period ?? company.fiscalPeriod;
  const comparativePeriod = preprocessed?.comparative?.period ?? null;
  const isComparative = periods.length >= 2 && !!primaryPeriod && !!comparativePeriod;
  const periodsListed = periods.map((p) => p.period).join(', ');

  const ppLoose = preprocessed as unknown as {
    comparativos_impracticables?: boolean;
    actividadInferida?: { sectorCIIU?: string; descripcion?: string; evidencia?: string };
  } | undefined;

  const comparativosImpracticables =
    elite?.comparativosImpracticables ?? ppLoose?.comparativos_impracticables ?? null;
  const actividadInferida =
    elite?.actividadInferida ?? (ppLoose?.actividadInferida
      ? {
          sectorCIIU: ppLoose.actividadInferida.sectorCIIU ?? '',
          descripcion: ppLoose.actividadInferida.descripcion ?? '',
          evidencia: ppLoose.actividadInferida.evidencia,
        }
      : null);
  const isComercio =
    actividadInferida && (actividadInferida.sectorCIIU || '').toUpperCase().startsWith('G');

  return `${guardrail}

${context2026}

<task>Producir el reporte estratégico C-Level de ${company.name} (NIT ${company.nit}) — dashboard ejecutivo, KPIs financieros, break-even, proyección de flujo de caja Big Four a 3 años (${projectionYears.join(', ')}) y 3-5 recomendaciones estratégicas ancladas a cifras del Agente 1 — devolviendo JSON validado contra StrategyReportSchema.</task>

<success_criteria>
- Todas las cifras ancla (Total Activo, Total Pasivo, Total Patrimonio, Ingresos, EBITDA, UAI, Utilidad Neta, Caja) coinciden con TOTALES VINCULANTES al centavo.
- Identidad fiscal en el dashboard: utilidadNeta = utilidadAntesImpuestos − impuestoCausado. Si no se cumple en el binding, copiar los tres valores LITERALES y registrar la inconsistencia en preparerNotes.
- kpis array contiene ≥1 KPI en CADA UNA de las 4 categorías obligatorias: profitability, liquidity, solvency, efficiency. Categorías ausentes son spec violation (Parte 7.II §2 — tabla KPIs). Cada KPI lleva fórmula con números sustituidos.
- recommendations.length ≥ 3 y ≤ 5; cada recomendación cita un rubro concreto del Agente 1 (no consejos genéricos).
- projectedCashFlow.liquidityGate.triggered=true cuando AC < PC; en ese caso, scenarios=[], controlKpis=[] y la primera recomendación es priority=high + horizon=immediate sobre liquidez.
- projectedCashFlow.liquidityGate.triggered=false implica scenarios.length=3 (conservative, base, aggressive), cada uno con assumptions explícitos y 3 controlKpis (net_cash_margin, days_of_autonomy, cumulative_return_on_flow).
${isComparative ? `- Modo comparativo: KPIs presentan resultComparative y yoyVariation; trends.qualitativeCommentary cita variaciones absolutas y % YoY.` : `- Modo single-period: KPIs presentan resultComparative=null; trends=null.`}
</success_criteria>

<constraints>
- MUST: anclar TODA cifra del dashboard, KPIs y recomendaciones al bloque TOTALES VINCULANTES. No re-calcular Total Activo, Total Pasivo, etc. desde el balance crudo.
- MUST: MoneyCop serializado en CENTAVOS como string entero. Ratios y porcentajes como strings decimales (ej. "1,33"; "35,2"). NO incluir signo de pesos en MoneyCop.
- MUST: el gasto por impuesto de renta SIEMPRE aparece como RESTA en el dashboard (precedido por (-)); utilidadNeta = utilidadAntesImpuestos − impuestoCausado. PROHIBIDO sumar el impuesto a UAI para llegar a utilidad neta.
- MUST: en el Flujo de Caja proyectado, el Saldo Inicial Caja es EXCLUSIVAMENTE PUC 11 (Efectivo y Equivalentes) — NO Activo Corriente total, NO Deudores (PUC 13), NO Inventarios (PUC 14), NO Inversiones (PUC 12).
- MUST: Cuentas por Pagar (PUC 23), Obligaciones Laborales (PUC 25) e Impuestos por Pagar (PUC 24) son salidas obligatorias del Año +1 (exigibilidad legal CST + calendario DIAN).
- MUST: provisión de renta = Utilidad Operativa Proyectada × 35% (Art. 240 E.T.); pago de caja se refleja en el periodo SIGUIENTE (calendario DIAN marzo-abril).
- MUST: separar Gastos Fijos Administrativos (indexados a inflación 4-5% IPC) de Costos de Operación (escalables a ingresos). Documentar el factor en assumptionsNote.
- NEVER emitir recomendaciones genéricas ("optimizar capital de trabajo") sin citar un rubro concreto + valor + periodo.
- NEVER emitir las frases "no se suministró información", "información no detallada", "datos no disponibles". Si un dato falta, citar la norma de impracticabilidad o usar el placeholder \`— (dato no suministrado)\` solo dentro de preparerNotes.
- NEVER inventar splits 50/50 ni porcentajes de distribución de utilidades que no vengan de los insumos.

**Anclaje de KPIs a TOTALES VINCULANTES (cuando el preprocessor los expone).** Cuando el bloque TOTALES VINCULANTES contiene un KPI ya pre-calculado (anclado por el preprocessor determinista), MUST usar ese valor LITERAL en la columna resultPrimary del KPI correspondiente — NO recalcular. Campos esperados (cuando estén disponibles en el binding):
- EBIT (Utilidad Operativa) → KPI MARGEN_OPERATIVO con formula = "EBIT / Ingresos × 100", resultPrimary = binding.MARGEN_OPERATIVO_CALCULADO.
- Margen Neto (preprocessor) → KPI MARGEN_NETO.
- ROE Dinámico (con patrimonio promedio) → KPI ROE.
- ROA (con activo promedio) → KPI ROA.
- Razón Corriente, Prueba Ácida, Endeudamiento Total, Apalancamiento Financiero → KPIs del mismo nombre.
- Cobertura de Intereses → poblar SOLO si gastoFinanciero5305 > 0; otherwise omitir el KPI con diagnosis "Sin gasto financiero en el periodo (cuenta 5305 = $0)".
- Días Cartera, Días Inventario, Días Proveedores → aplicar WARNING anti-división de abajo antes de poblar.

If bindingTotals NO contiene el KPI pre-calculado then calcularlo a partir del primitivo más cercano disponible (ej. UtilidadNeta / Patrimonio para ROE estático), pero documentar en formula "calculado por agente, no anclado al preprocessor" + agregar a diagnosis la frase "El preprocessor no expuso este KPI; verificar coherencia con cifras del Pilar Valor" otherwise citar el valor anclado tal cual.

**WARNING anti-división (Parte 6 spec v2.0) — Días Inventario / Proveedores.** Para los KPIs DIAS_INVENTARIO y DIAS_PROVEEDORES (categoría efficiency):

If (costoVentas6 + costoProduccion7) / ingresos < 0.01 (base de costos < 1% de ingresos) then NEVER reportar el valor numérico del KPI; en su lugar:
  - resultPrimary = "ND"
  - resultComparative = "ND" (si modo comparativo)
  - formula = "ND — denominador anómalamente pequeño (Clase 6 + Clase 7 < 1% Ingresos)"
  - diagnosis = "No confiable: base de costos insuficiente para calcular ciclo operativo (Clase 6 + Clase 7 < 1% Ingresos). El balance puede tener subregistro de costos (NIA 240 — riesgo de fraude) o pertenecer a una empresa de servicios sin inventario significativo."
  - yoyVariation = null
otherwise calcular con la fórmula spec normal (Inventarios × 365 / Costo de Ventas; Cuentas por Pagar × 365 / Compras) y resultado decimal.

Esta regla cubre el bug clásico de dividir entre un denominador ~$0 que produce resultados astronómicos sin sentido económico (ej. 36.500 días de inventario).

Macro-supuestos Colombia 2026 (referenciales):
- PIB esperado: 2-3% (BanRep / DANE).
- IPC inflación: 4-5% (BanRep meta 3% +/- rango).
- UVT 2026: $52.374 COP (DIAN).
- Tarifa renta PJ: 35% (Art. 240 E.T., Ley 2277/2022).
- Tarifa Mínima de Tributación (TMT): 15% (Art. 240 parágrafo 6 E.T.).
- Dividendos: 20% (Art. 242 E.T.).

Estructura de los 3 escenarios obligatorios cuando no haya gate de liquidez:
- Conservative: ingresos −15% YoY, costos indexados a inflación máxima (5%), TMT 15% activa.
- Base: ingresos crecen al PIB esperado (2,5%), costos a inflación esperada (4%), tarifa 35% sobre UAI.
- Aggressive: ingresos +15% YoY (justificado por palanca específica), costos a inflación mínima (4%), tarifa 35%.

If Activo Corriente < Pasivo Corriente then projectedCashFlow.liquidityGate.triggered=true, scenarios=[], controlKpis=[] y la primera recommendation es priority=high + horizon=immediate citando la brecha en pesos; el message de liquidityGate es LITERAL "ALERTA DE LIQUIDEZ: AC ($X) < PC ($Y). Brecha: $Z. NO se proyecta flujo hasta resolver esta inconsistencia." (reemplazar X, Y, Z con los valores de TOTALES VINCULANTES) otherwise projectar normalmente.

If DSO ≤ 30 días then 100% del cobro de cartera (PUC 13) entra en H1 Año +1; if DSO 31-90 días then 60% H1 + 40% H2 Año +1; if DSO > 90 días then 30% Año +1 + 70% Año +2 (documentar riesgo de cartera en preparerNotes).

If isComercio=true Y margen bruto observado > 80% then incluir en kpis.diagnosis (categoría profitability) la frase "verdad financiera condicionada — NIIF for SMEs §13.20 — recomendar opinión con salvedad NIA 705 §7" otherwise omitir.

If TOTALES VINCULANTES contiene \`presumedCostWarning\` (o observedGrossMargin > 0,85 + inventoryCop > revenue × 0,5) then poblar presumedCostWarning con observedGrossMarginPct, costOfSalesCop, revenueCop, inventoryClosingCop, sectorBenchmarkPct, recommendedActions (lista de validaciones), technicalCitation="NIC 2 §25 + Sección 13 PYMES"; PROHIBIDO usar este lenguaje en kpis ni en recommendations — es callout INTERNO de preparador, no firmable otherwise presumedCostWarning=null.

If comparativosImpracticables=true then trends=null + en kpis cada resultComparative=null; los escenarios proyectados se calibran SOLO con macro-supuestos (no con tasas YoY históricas) otherwise calibrar el escenario base con la tasa YoY de ingresos del Agente 1.

Recomendaciones — cobertura mínima de 2 ejes según pertinencia:
- Liquidez y capital de trabajo (optimización cartera, inventario, política proveedores, tesorería).
- Estructura de capital (reestructuración deuda, fondeo, dividendos, aportes).
- Rentabilidad operativa (racionalización de costos, mix de producto, pricing).
- Fiscal / Tributario (Art. 256/255 ET, Zona Franca, ZOMAC, CHC Art. 894 ET, dividendos Art. 242).
- Cumplimiento / Gobierno (reserva legal, IFRS 18 si Grupo 1, calendario DIAN).

Defensa Art. 647 E.T.: si una recomendación invoca un ajuste técnico-contable que pudiera disentir del software contable de origen (Siigo, World Office, Helisa) o de la liquidación tributaria del periodo anterior, incluir en normReference la cita "Art. 647 E.T. — diferencia de criterio + Concepto DIAN 100208221-1352 de 2018" para anular sanción por inexactitud.
</constraints>

<context>
## DATOS DE LA EMPRESA
- Razón Social: ${company.name}
- NIT: ${company.nit}
- Sector: ${company.sector || '— (dato no suministrado)'}
- Periodo Fiscal: ${primaryPeriod}
${comparativePeriod ? `- Periodo Comparativo: ${comparativePeriod}` : ''}

${isComparative
  ? `## MODO COMPARATIVO (${periods.length} periodos: ${periodsListed})
KPIs y dashboard presentan resultPrimary (${primaryPeriod}) Y resultComparative (${comparativePeriod}) + yoyVariation. Trends emite yoyRevenue, yoyEbitda, yoyNetIncome, yoyEquity y marginDeltaPp citando variaciones absolutas + %.`
  : periods.length === 1
    ? `## MODO SINGLE-PERIOD
Solo periodo ${primaryPeriod}. resultComparative=null; trends=null. Proyecciones se calibran con macro-supuestos.`
    : ''}

${actividadInferida && actividadInferida.descripcion ? `## Actividad económica inferida
CIIU letra ${actividadInferida.sectorCIIU} — ${actividadInferida.descripcion}${actividadInferida.evidencia ? ` (evidencia: ${actividadInferida.evidencia})` : ''}.${isComercio ? ' Sector COMERCIO — vigilar margen bruto > 80% (NIIF for SMEs §13.20).' : ''}` : ''}

${comparativosImpracticables === true ? `## Impracticabilidad declarada
El Agente 1 declaró impracticabilidad del comparativo (NIIF for SMEs §3.14, §10.21). trends=null; YoY no calculable.` : ''}

## Años de proyección
- Año actual: ${primaryPeriod}
- Año +1: ${projectionYears[0]}
- Año +2: ${projectionYears[1]}
- Año +3: ${projectionYears[2]}

${langInstruction}
</context>`;
}
