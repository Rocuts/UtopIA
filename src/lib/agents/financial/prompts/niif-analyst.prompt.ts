// ---------------------------------------------------------------------------
// System prompt — Agente 1: Analista Contable NIIF (outcome-first GPT-5.4)
// ---------------------------------------------------------------------------
// Refactor Fase 3.C (2026-05): split del prompt monolítico en TRES builders,
// uno por pass del agente chunked. Cada builder mantiene los 4 headers
// cache-friendly (anti-hallucination + colombia-2026 + niif-measurement +
// niif-disclosures) para maximizar el prompt-cache hit rate de GPT-5.4.
//
// Justificación (docs/wave-notes/chunked-niif-analyst.md):
// el schema monolítico `NiifReportSchema` sumado al reasoning de GPT-5.5 se
// acerca peligrosamente al budget de 32K output tokens. Tres pases con
// schemas más estrechos eliminan el bug por construcción y permiten volver
// a `gpt-5.4-mini` (~6x menos costo).
//
// Patrón outcome-first (CTCO + XML) aplicado por pass:
//   - Headers estables (anti-hallucination + colombia-2026 + niif-knowledge).
//   - `<task>` específico del pass (Balance+P&L | EFE+ECP | notas).
//   - `<success_criteria>` con invariantes contables propias del pass.
//   - `<constraints>` con safety rails (MUST/NEVER) + reglas If/then.
//   - `<context>` con DATOS DE LA EMPRESA / MODO COMPARATIVO + bloque
//     `<previously_computed>` (Pass-2/3) que cita LITERALMENTE las cifras
//     emitidas por pases anteriores — el modelo NUNCA debe recalcular.
//
// NOTA: el output schema NO se describe en prosa; se enforza con
// `experimental_output: Output.object({ schema: <SubSchema> })` en runtime.
// ---------------------------------------------------------------------------

import type { CompanyInfo } from '../types';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import type { ReportMode } from '../contracts/base';
import { buildAntiHallucinationGuardrail } from './anti-hallucination';
import { buildColombia2026Context } from './colombia-2026-context';
import {
  buildNiifMeasurementKnowledge,
  buildNiifDisclosureKnowledge,
} from './niif-colombia-knowledge';
import { buildResilienceSection0 } from './resilience-section0';
import { buildPresentationV3, type PresentationV3Data } from './presentation-v3';
import {
  buildDeterministicCashFlow,
  type DeterministicCashFlow,
} from '../contracts/deterministic-breakdown';
import { formatCopFromCents } from '../contracts/money';
import {
  buildReportAnchors,
  moneyCopToken,
  type PeriodAnchors,
  type ReportAnchors,
} from '../contracts/anchors';

/**
 * Contexto Élite consumido por el Agente 1 desde el orchestrator. Optional
 * chaining defensivo: A (preprocessor) está extendiendo el shape de
 * `PreprocessedBalance` y este contrato evita romper tsc mientras esos campos
 * se materializan. Cuando ausentes, el agente cae al comportamiento legacy.
 */
export interface NiifAnalystEliteContext {
  comparativosImpracticables?: boolean;
  actividadInferida?: { sectorCIIU: string; descripcion: string; evidencia?: string };
  reclasificacionesNoCompensacion?: Array<{
    cuenta_origen: string;
    saldo_invertido_centavos: bigint;
    cuenta_destino_pasivo: string;
    motivo_norma: string;
  }>;
  saldoAFavorImpuestoCents?: bigint;
  impuestoRentaNeto?: {
    brutoPasivo2404: number;
    anticipoActivo135515: number;
    netoAPagar: number;
    applicable: boolean;
  };
  /** Bloque <hechos_empresa> pre-renderizado (Ola 2). '' o undefined = no se inyecta. */
  hechosEmpresa?: string | null;
}

/**
 * Anchors numéricos emitidos por Pass-1 (Balance + P&L + curatorFlags).
 * Se inyectan literalmente como MoneyCop strings (centavos) en el bloque
 * `<previously_computed>` de los prompts de Pass-2 y Pass-3 para que el
 * modelo cite las cifras exactas sin recalcular.
 */
export interface PreviouslyComputedPass1Anchors {
  totalAssetsPrimary: string;
  totalLiabilitiesPrimary: string;
  totalEquityPrimary: string;
  netIncomePrimary: string;
  oriPrimary: string;
  // 2026-05-13 hotfix regresion comparativo (Wave 4 investigador):
  // Pass-2/Pass-3 leen este bloque y null-ean amountComparative cuando los
  // campos *Comparative no estan presentes. Antes de Fase 3 chunked, el
  // single-pass tenia visibilidad directa al bindingTotals con periodo
  // comparativo; ahora hay que propagarlos explicitamente entre passes.
  totalAssetsComparative: string | null;
  totalLiabilitiesComparative: string | null;
  totalEquityComparative: string | null;
  grossProfitComparative: string | null;
  operatingProfitComparative: string | null;
  netIncomeComparative: string | null;
  oriComparative: string | null;
  curatorFlags: {
    equityConvergenceApplied: boolean;
    cashFlowClosureForced: boolean;
    negativeAssetReclassified: boolean;
    presumedCostWarning: boolean;
    reclassifiedAmountCop: string;
  };
}

/**
 * Anchors numéricos emitidos por Pass-2 (EFE + ECP). Pass-3 los recibe junto
 * con los Pass-1 anchors para componer notas técnicas que citen cifras
 * autoritativas de los pases anteriores.
 */
export interface PreviouslyComputedPass2Anchors {
  cashOpening: string;
  cashClosing: string;
  netChange: string;
  ecpClosingTotal: string;
}

// ===========================================================================
// REGLAS ABSOLUTAS — Agente 1 (Analista NIIF) · Mayo 2026
// ===========================================================================
// Estas 5 reglas tienen PRIORIDAD ABSOLUTA sobre cualquier otra instrucción
// del prompt. Cuando exista conflicto entre una regla absoluta y otra parte
// del prompt (knowledge headers, success_criteria, constraints, context),
// las reglas absolutas GANAN SIEMPRE.
//
// Se inyectan en las PRIMERAS LÍNEAS del prompt de los 3 pases (Pass-1,
// Pass-2, Pass-3) para que el modelo las internalice antes de leer cualquier
// header técnico o el bloque <task>.
// ===========================================================================

function buildAbsoluteRulesAgente1(language: 'es' | 'en'): string {
  if (language === 'en') {
    return `# ABSOLUTE RULES — READ FIRST, ALWAYS
These 5 rules override any other instruction in this prompt. When in conflict, ABSOLUTE RULES WIN.

## RULE 1 — Income tax expense comes ONLY from group 54
- The income tax expense in the P&L is the balance of PUC group 54 and nothing else.
- Cta.1355 (tax advances and withholdings) is a BALANCE SHEET ASSET; only its income-tax subaccounts (e.g. 135515 withholding, 135505 advance) are income-tax credits; 135510/135517/135518 (ICA, VAT) are not.
- Cta.1805 in the PUC (Decree 2650/1993) is "Art and cultural assets": it is NOT a tax account unless its name in the trial balance says so (tax, advance, withholding, balance in favor).
- NEVER subtract 1355, 1805 or any balance-sheet account in the P&L, and NEVER compute a tax as a percentage of profit before tax.
- When group 54 is NOT present: income tax NOT recognized in the books — no tax line with an amount; Net Income = Profit Before Tax (the binding figure); note: "The entity recorded no income tax expense in group 54. No tax expense that is not in the books is estimated or presented; determining current and deferred tax (IAS 12 / Section 29 of the IFRS for SMEs) requires the accountant's tax reconciliation."
- When group 54 IS present: income tax expense = group 54 balance; Net Income = PBT − group 54.

## RULE 2 — The "§" SYMBOL IS FORBIDDEN
The "§" symbol MUST NOT appear anywhere in the report (notes, alerts, minutes, or any text). Mandatory replacements:
- "NIIF for SMEs §3" → "NIIF para PYMES, Sección 3"
- "NIIF for SMEs §4" → "NIIF para PYMES, Sección 4"
- "NIIF for SMEs §5" → "NIIF para PYMES, Sección 5"
- "NIIF for SMEs §6" → "NIIF para PYMES, Sección 6"
- "NIIF for SMEs §7" → "NIIF para PYMES, Sección 7"
- "NIIF for SMEs §8" → "NIIF para PYMES, Sección 8"
- "NIIF for SMEs §10" → "NIIF para PYMES, Sección 10"
- "NIIF for SMEs §11" → "NIIF para PYMES, Sección 11"
- "NIIF for SMEs §13" → "NIIF para PYMES, Sección 13"
- "NIIF for SMEs §14" → "NIIF para PYMES, Sección 14"
- "NIIF for SMEs §17" → "NIIF para PYMES, Sección 17"
- "NIIF for SMEs §23" → "NIIF para PYMES, Sección 23"
- "NIIF for SMEs §28" → "NIIF para PYMES, Sección 28"
- "NIIF for SMEs §29" → "NIIF para PYMES, Sección 29"
- "NIIF for SMEs §32" → "NIIF para PYMES, Sección 32"
- "NIC 1 §32" → "NIC 1, párrafo 32"
- "NIC 7 §18" → "NIC 7, párrafo 18"
- "NIC 12 §58" → "NIC 12, párrafo 58"
- "NIC 12 §80" → "NIC 12, párrafo 80"
- "NIC 28 §10" → "NIC 28, párrafo 10"
- "NIA 240 §A1-A6" → "NIA 240"
- "NIA 705 §7" → "NIA 705"
- "NIA 706 §7" → "NIA 706"
Verification before delivery: does "§" appear anywhere? If YES → replace it.

## RULE 3 — CENTAVOS IN DISPLAYED TEXT: FORBIDDEN
Monetary figures are NEVER displayed in centavos in the body of the report.
- FORBIDDEN: "419655824290 centavos", "222849678973 centavos COP", "activo total 2025 419655824290", "156348555401 centavos".
- MANDATORY Colombian format: "$4.196.558.242,90", "$2.228.496.789,73", "$2.413.677.888,64", "$1.563.485.554,01".
- Conversion rule when the system uses centavos: divide by 100 before display (419655824290 ÷ 100 = $4.196.558.242,90).
- This rule applies to displayed labels, narrative, notes, banners and headings — NOT to the internal MoneyCop centavos strings in the JSON output (those keep their string-of-centavos format as enforced by the schema).

## RULE 4 — INTERNAL NOTES MUST NOT APPEAR IN THE FINAL REPORT
The following section heading MUST NEVER appear in the output:
- "NOTAS INTERNAS DEL PREPARADOR (NO incluir en EEFF firmables)"
Also forbidden in any user-visible note, label or banner:
- "Nota curatorFlags"
- "anchors de Pass-1" / "anchors de Pass-2"
- "amountComparative igual a null"
- "bloque recibido no incluyó curatorFlags"
- Any reference to internal system variables (curator, anchors, Pass-1/2/3, preprocessor, validator, schema, MoneyCop, etc.)
These are system-internal notes — the client must never see them.

## RULE 5 — "DESTINACIÓN" FIELD OF THE ACTA: SINGLE SOURCE OF TRUTH
The "Net Income for the Period" field in the "Profit Allocation" section of the minutes has ONE single source: the last line of the Income Statement (netIncomePrimary).
- NEVER divide that value by 100, by 1000, or by any number.
- NEVER read it from internal system variables.
- NEVER recompute it from another source.
- Example: if Net Income in the P&L = $2.228.496.789,73 then the Allocation field = $2.228.496.789,73, the capitalization base = $2.228.496.789,73, and the 40% amount = $891.398.715,89.
- Verification: does the Allocation value == last line of the P&L? If they differ by even one cent → FIX before publishing.

---`;
  }
  return `# REGLAS ABSOLUTAS — LEER PRIMERO, SIEMPRE
Estas 5 reglas tienen PRIORIDAD sobre cualquier otra instrucción de este prompt. Cuando exista conflicto entre una regla absoluta y otra parte del prompt (knowledge headers, success_criteria, constraints, context), las REGLAS ABSOLUTAS GANAN SIEMPRE.

## REGLA 1 — El gasto por impuesto de renta sale SOLO del grupo 54
- El gasto por impuesto de renta del P&L es el saldo del grupo PUC 54 y nada más.
- Cta.1355 (anticipos de impuestos y contribuciones o saldos a favor) es ACTIVO DEL BALANCE; sólo sus subcuentas de renta (p. ej. 135515 retención en la fuente, 135505 anticipo de renta) son créditos del impuesto de renta; 135510/135517/135518 (ICA, IVA) no lo son.
- Cta.1805 en el PUC (Decreto 2650/1993) es "Bienes de arte y cultura": NO es cuenta de impuestos salvo que su nombre en el balance de prueba lo indique (impuesto, anticipo, retención, saldo a favor).
- NUNCA restar 1355, 1805 ni ninguna cuenta del balance en el P&L, y NUNCA calcular un impuesto como porcentaje de la utilidad antes de impuestos.
- Cuando NO existe grupo 54: impuesto de renta NO reconocido en libros — sin renglón de impuesto con monto; Utilidad Neta = Utilidad Antes de Impuestos (la cifra vinculante); nota: "La entidad no registró gasto por impuesto de renta en el grupo 54. No se estima ni se presenta un gasto por impuesto que no está en los libros; la determinación del impuesto corriente y diferido (NIC 12 / Sección 29 de la NIIF para las PYMES) requiere la conciliación fiscal del contador."
- Cuando SÍ existe grupo 54: gasto por impuesto = saldo del grupo 54; Utilidad Neta = UAI − grupo 54.

## REGLA 2 — PROHIBIDO el símbolo "§"
El símbolo "§" NO debe aparecer en ninguna parte del informe (ni notas, ni alertas, ni acta, ni ningún texto). Tabla de reemplazo obligatoria:
- "NIIF for SMEs §3" → "NIIF para PYMES, Sección 3"
- "NIIF for SMEs §4" → "NIIF para PYMES, Sección 4"
- "NIIF for SMEs §5" → "NIIF para PYMES, Sección 5"
- "NIIF for SMEs §6" → "NIIF para PYMES, Sección 6"
- "NIIF for SMEs §7" → "NIIF para PYMES, Sección 7"
- "NIIF for SMEs §8" → "NIIF para PYMES, Sección 8"
- "NIIF for SMEs §10" → "NIIF para PYMES, Sección 10"
- "NIIF for SMEs §11" → "NIIF para PYMES, Sección 11"
- "NIIF for SMEs §13" → "NIIF para PYMES, Sección 13"
- "NIIF for SMEs §14" → "NIIF para PYMES, Sección 14"
- "NIIF for SMEs §17" → "NIIF para PYMES, Sección 17"
- "NIIF for SMEs §23" → "NIIF para PYMES, Sección 23"
- "NIIF for SMEs §28" → "NIIF para PYMES, Sección 28"
- "NIIF for SMEs §29" → "NIIF para PYMES, Sección 29"
- "NIIF for SMEs §32" → "NIIF para PYMES, Sección 32"
- "NIC 1 §32" → "NIC 1, párrafo 32"
- "NIC 7 §18" → "NIC 7, párrafo 18"
- "NIC 12 §58" → "NIC 12, párrafo 58"
- "NIC 12 §80" → "NIC 12, párrafo 80"
- "NIC 28 §10" → "NIC 28, párrafo 10"
- "NIA 240 §A1-A6" → "NIA 240"
- "NIA 705 §7" → "NIA 705"
- "NIA 706 §7" → "NIA 706"
Verificación antes de entregar el informe: ¿aparece el símbolo "§" en alguna parte? Si SÍ → reemplazar.

## REGLA 3 — CENTAVOS en texto visible: PROHIBIDO
Las cifras monetarias NUNCA se escriben en centavos en el texto visible del informe.
- PROHIBIDO: "419655824290 centavos", "222849678973 centavos COP", "activo total 2025 419655824290", "156348555401 centavos".
- OBLIGATORIO formato colombiano: "$4.196.558.242,90", "$2.228.496.789,73", "$2.413.677.888,64", "$1.563.485.554,01".
- Regla de conversión cuando el sistema trabaja en centavos: dividir por 100 antes de mostrar (419655824290 ÷ 100 = $4.196.558.242,90).
- Esta regla aplica a labels visibles, narrativa, notas, banners y encabezados — NO al string interno MoneyCop en centavos del JSON (ese conserva su formato string-entero como exige el schema).

## REGLA 4 — NOTAS INTERNAS no aparecen en el informe final
El siguiente encabezado de sección NUNCA debe aparecer en el output:
- "NOTAS INTERNAS DEL PREPARADOR (NO incluir en EEFF firmables)"
Tampoco deben aparecer en ninguna nota, label o banner visible al cliente:
- "Nota curatorFlags"
- "anchors de Pass-1" / "anchors de Pass-2"
- "amountComparative igual a null"
- "bloque recibido no incluyó curatorFlags"
- Cualquier referencia a variables internas del sistema (curator, anchors, Pass-1/2/3, preprocesador, validator, schema, MoneyCop, etc.).
Estas son notas del sistema para uso interno. El cliente no las debe ver nunca.

## REGLA 5 — Campo "Destinación" del acta: fuente única
El campo "Utilidad Neta del Ejercicio" en la sección "Destinación del resultado" del acta tiene UNA SOLA fuente: el último renglón del Estado de Resultados (netIncomePrimary).
- NUNCA dividir ese valor por 100, por 1000, ni por ningún número.
- NUNCA leer de variables internas del sistema.
- NUNCA recalcular desde otra fuente.
- Ejemplo: si la Utilidad Neta del P&L = $2.228.496.789,73 entonces el campo Destinación = $2.228.496.789,73, la base de capitalización = $2.228.496.789,73 y el monto 40% = $891.398.715,89.
- Verificación: ¿el valor de Destinación == último renglón del P&L? Si difieren en un solo centavo → CORREGIR antes de publicar.

---`;
}

// ===========================================================================
// SHARED CONTEXT BUILDER
// ===========================================================================
// Toda la lógica de unpacking del Elite context, periodos, formatters y
// referencias PUC común a los 3 pases vive aquí para evitar drift entre los
// builders. Los pases consumen el shared context y añaden su <task>,
// <success_criteria>, <constraints> y <context> específicos.
// ===========================================================================

interface SharedPromptContext {
  langInstruction: string;
  niifFramework: string;
  isGroup1: boolean;
  guardrail: string;
  resilience0: string;
  context2026: string;
  niifMeasurement: string;
  niifDisclosures: string;
  primaryPeriod: string;
  comparativePeriod: string | null;
  isComparative: boolean;
  periodsListed: string;
  periodsCount: number;
  reportMode: ReportMode;
  comparativosImpracticables: boolean | null;
  actividadInferida: { sectorCIIU: string; descripcion: string; evidencia?: string } | null;
  reclasifNoComp: Array<{
    cuenta_origen: string;
    saldo_invertido_centavos: bigint;
    cuenta_destino_pasivo: string;
    motivo_norma: string;
  }>;
  saldoAFavorCents: bigint | undefined;
  tieneSaldoAFavor: boolean;
  impuestoRentaNeto:
    | { brutoPasivo2404: number; anticipoActivo135515: number; netoAPagar: number; applicable: boolean }
    | undefined;
  tieneAnticipoRentaMaterial: boolean;
  efeVarCxC: number | undefined;
  efeVarInv: number | undefined;
  efeVarCxP: number | undefined;
  /**
   * EFE determinista completo (renglones + subtotales + cierre) construido
   * desde los snapshots finales. `null` sin periodo comparativo: sin saldo de
   * apertura no hay variación que medir y el EFE no es calculable (NIC 7 ¶1).
   */
  deterministicCashFlow: DeterministicCashFlow | null;
  /**
   * Anclas del P&G (UB, EBIT, otros ingresos 42, gastos no operacionales, UAI,
   * impuesto, UN) de ambos periodos, en centavos exactos. Enmienda spec v2.1
   * 2026-09-24: el grupo 42 va debajo de la utilidad operacional.
   */
  pnlAnchors: ReportAnchors;
  // Corrección v2.4 — Saldo INICIAL de Cta.3605 (= utilidad del ejercicio del
  // periodo comparativo, que entra como utilidad acumulada en el patrimonio
  // de apertura del periodo actual). Si > $0 material, debe traviajar como
  // ajuste NO-CASH (signo negativo) en operating del EFE — nunca como salida
  // ficticia de financiación.
  openingUtilidadEjercicio3605: number | undefined;
  fmtCop: (cents: bigint | number) => string;
  company: CompanyInfo;
  presentationV3: string;
  presentationV3Data: PresentationV3Data | undefined;
  hechosEmpresa: string;
}

function buildSharedContext(
  company: CompanyInfo,
  language: 'es' | 'en',
  reportMode: ReportMode,
  preprocessed?: PreprocessedBalance,
  elite?: NiifAnalystEliteContext,
): SharedPromptContext {
  const langInstruction =
    language === 'en'
      ? 'Respond entirely in English.'
      : 'Responde completamente en español.';

  const niifFramework =
    company.niifGroup === 1
      ? 'NIIF Plenas (Grupo 1 — NIC/NIIF completas, Decreto 2420/2015)'
      : company.niifGroup === 3
        ? 'Contabilidad Simplificada (Grupo 3 — Decreto 2706/2012, compilado en Decreto 2420/2015)'
        : 'NIIF para PYMES (Grupo 2 — 35 secciones, Decreto 2420/2015)';
  const isGroup1 = company.niifGroup === 1;

  const guardrail = buildAntiHallucinationGuardrail(language);
  const resilience0 = buildResilienceSection0(language);
  const context2026 = buildColombia2026Context(language);
  const niifMeasurement = buildNiifMeasurementKnowledge(language);
  const niifDisclosures = buildNiifDisclosureKnowledge(language);
  const presentationV3 = buildPresentationV3(language);

  // ELITE CONTEXT — A (preprocessor) está extendiendo el shape; defensivo.
  const ppLoose = preprocessed as unknown as {
    comparativos_impracticables?: boolean;
    actividadInferida?: { sectorCIIU?: string; descripcion?: string; evidencia?: string };
    reclasificacionesNoCompensacion?: Array<{
      cuenta_origen?: string;
      saldo_invertido_centavos?: bigint | number;
      cuenta_destino_pasivo?: string;
      motivo_norma?: string;
    }>;
  } | undefined;

  const periods = preprocessed?.periods ?? [];
  const primaryPeriod = preprocessed?.primary?.period ?? company.fiscalPeriod;
  // Wave 5 — 2026-05-14: el periodo comparativo se resuelve con prioridad
  //   1. `preprocessed.comparative.period` (autoritativo cuando el preprocesador
  //      consolida un PeriodSnapshot completo del año anterior),
  //   2. `company.comparativePeriod` (echo desde `prepareFinancialContext` —
  //      pre-llenado vía `detectedPeriods` en el orchestrator).
  // Antes solo se consultaba (1). Cuando el preprocesador detectaba 2 periodos
  // pero la consolidación de `comparative` fallaba (e.g. balance de 2024
  // parcial), `isComparative` quedaba false y los prompts emitían MODO
  // SINGLE-PERIOD, perdiendo silenciosamente el comparativo que el usuario
  // sí solicitó. Ahora se respeta la intención de `company.comparativePeriod`.
  const comparativePeriod =
    preprocessed?.comparative?.period ?? company.comparativePeriod ?? null;
  const isComparative = !!primaryPeriod && !!comparativePeriod;
  const periodsListed = periods.map((p) => p.period).join(', ');

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
  const reclasifNoComp = elite?.reclasificacionesNoCompensacion
    ?? (Array.isArray(ppLoose?.reclasificacionesNoCompensacion)
      ? ppLoose!.reclasificacionesNoCompensacion!.map((r) => ({
          cuenta_origen: r.cuenta_origen ?? '',
          saldo_invertido_centavos: BigInt(r.saldo_invertido_centavos ?? 0),
          cuenta_destino_pasivo: r.cuenta_destino_pasivo ?? '',
          motivo_norma: r.motivo_norma ?? '',
        }))
      : []);
  const saldoAFavorCents = elite?.saldoAFavorImpuestoCents
    ?? (preprocessed?.primary?.controlTotals?.cents as
        unknown as { saldoAFavorImpuesto?: bigint } | undefined)?.saldoAFavorImpuesto;
  const tieneSaldoAFavor =
    typeof saldoAFavorCents === 'bigint' && saldoAFavorCents > BigInt(0);

  const impuestoRentaNeto =
    elite?.impuestoRentaNeto
    ?? (preprocessed?.primary?.controlTotals as
        unknown as { impuestoRentaNeto?: {
          brutoPasivo2404: number;
          anticipoActivo135515: number;
          netoAPagar: number;
          applicable: boolean;
        } } | undefined)?.impuestoRentaNeto;
  const tieneAnticipoRentaMaterial =
    !!impuestoRentaNeto && impuestoRentaNeto.applicable === true;

  // EFE indirecto — nombres REALES del curator R2 (PLURAL).
  const efeOp = preprocessed?.primary?.cashFlowIndirecto?.operating;
  const efeVarCxC = efeOp?.varCuentasPorCobrar;
  const efeVarInv = efeOp?.varInventarios;
  const efeVarCxP = efeOp?.varCuentasPorPagar;

  // EFE determinista — el estado completo, renglón a renglón, en centavos.
  // Reemplaza al EFE del curator R2 como autoridad del Pass-2: R2 fabricaba
  // una línea de "dividendos estimados" a partir de las cuentas VIRTUALES que
  // el propio curator R8 inyecta (medido: $1.570.997.737,30 = 64,9% del flujo
  // de operación, contra un balance donde la cuenta 2360 no existe), y sus
  // deltas se calculan a mitad del curator, antes de las reclasificaciones R1
  // (medido: $13.714.221,38 de diferencia en el grupo 14). El determinista se
  // construye sobre los snapshots FINALES —los mismos que publican el Balance—
  // y cierra contra el Δ PUC 11 con brecha $0.
  const deterministicCashFlow = preprocessed?.primary
    ? buildDeterministicCashFlow(preprocessed.primary, preprocessed.comparative ?? undefined)
    : null;

  // Cascada del P&G en centavos exactos, la misma que cruza el validador (E14/E9).
  const pnlAnchors: ReportAnchors = preprocessed?.primary
    ? buildReportAnchors(preprocessed.primary, preprocessed.comparative ?? undefined)
    : { primary: null, comparative: null };

  // Corrección v2.4 — utilidad del ejercicio del periodo comparativo,
  // que para el periodo ACTUAL representa el saldo INICIAL de Cta.3605
  // (utilidad acumulada arrastrada en el patrimonio de apertura).
  const openingUtilidadEjercicio3605 =
    preprocessed?.comparative?.equityBreakdown?.utilidadEjercicio;

  // Presentation v3.0 — anchors emitidos por el curator (buildPresentationV3Data).
  // El curator ya popula `primary.curator.presentationV3` al final de runCurator.
  const presentationV3Data: PresentationV3Data | undefined =
    preprocessed?.primary?.curator?.presentationV3;

  const hechosEmpresa = elite?.hechosEmpresa ?? '';

  const fmtCop = (cents: bigint | number): string => {
    const n = typeof cents === 'bigint' ? Number(cents) / 100 : cents;
    return n.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return {
    langInstruction,
    niifFramework,
    isGroup1,
    guardrail,
    resilience0,
    context2026,
    niifMeasurement,
    niifDisclosures,
    primaryPeriod,
    comparativePeriod,
    isComparative,
    periodsListed,
    periodsCount: periods.length,
    reportMode,
    comparativosImpracticables,
    actividadInferida,
    reclasifNoComp,
    saldoAFavorCents,
    tieneSaldoAFavor,
    impuestoRentaNeto,
    tieneAnticipoRentaMaterial,
    efeVarCxC,
    efeVarInv,
    efeVarCxP,
    deterministicCashFlow,
    pnlAnchors,
    openingUtilidadEjercicio3605,
    fmtCop,
    company,
    presentationV3,
    presentationV3Data,
    hechosEmpresa,
  };
}

// ===========================================================================
// SHARED SUB-BLOCKS
// ===========================================================================

/**
 * Bloque "DATOS DE LA EMPRESA" — idéntico en los 3 pases.
 */
function renderCompanyBlock(ctx: SharedPromptContext): string {
  return `## DATOS DE LA EMPRESA
- Razón Social: ${ctx.company.name}
- NIT: ${ctx.company.nit}
- Tipo Societario: ${ctx.company.entityType || '— (dato no suministrado)'}
- Sector: ${ctx.company.sector || '— (dato no suministrado)'}
- Marco Normativo: ${ctx.niifFramework}
- Periodo Fiscal: ${ctx.primaryPeriod}
${ctx.comparativePeriod ? `- Periodo Comparativo: ${ctx.comparativePeriod}` : ''}`;
}

/**
 * Bloque "MODO DEL REPORTE" (spec v8.1 §2) — idéntico en los 3 pases. Es el
 * primer comentario HTML del documento final y determina la voz narrativa,
 * los verbos permitidos (LINEA_BASE prohíbe "creció/mejoró/aumentó"), y el
 * layout de los estados financieros (banner en Balance/P&L, columnas n/c en
 * TRANSICION). El orchestrator (F0) deriva el valor con `deriveReportMode`.
 */
function renderReportModeBlock(ctx: SharedPromptContext): string {
  const implication =
    ctx.reportMode === 'LINEA_BASE'
      ? 'establece punto de partida — no hay comparativo material; el reporte documenta el ESTADO INICIAL bajo NIIF, no la EVOLUCIÓN respecto a un periodo anterior.'
      : ctx.reportMode === 'TRANSICION'
        ? 'reconcilia donde es comparable — el comparativo existe pero tiene líneas materiales faltantes; la narrativa solo compara los rubros con dato suficiente, marcando "n/c" donde no.'
        : 'compara contra periodo anterior — el comparativo es robusto; la narrativa puede usar verbos comparativos plenos (creció, varió, evolucionó).';
  return `## MODO DEL REPORTE (v8.1 §2)
- Valor: ${ctx.reportMode}
- Implicación: ${implication}`;
}

/**
 * Bloque "MODO COMPARATIVO" — idéntico en los 3 pases.
 */
function renderComparativeModeBlock(ctx: SharedPromptContext): string {
  if (ctx.isComparative) {
    return `## MODO COMPARATIVO (${ctx.periodsCount} periodos detectados: ${ctx.periodsListed})
Los datos vienen etiquetados con \`[period=YYYY]\` por bloque. Cada StatementLine del Balance y del P&L llena amountPrimary (${ctx.primaryPeriod}) y amountComparative (${ctx.comparativePeriod}). En el EFE amountComparative = null en todos los renglones: la columna comparativa del EFE y el ECP del periodo ${ctx.comparativePeriod} los calcula el código desde el balance de prueba o, si el balance no trae el corte que lo permite, los deja sin presentar con una nota propia que pide ese corte (NIIF para las PYMES 3.14). El ECP arranca con kind=opening_balance (cifras de \`preprocessed.comparative.equityBreakdown\`) → movimientos del periodo → kind=closing_balance (cifras de \`preprocessed.primary.equityBreakdown\`).`;
  }
  if (ctx.periodsCount === 1) {
    return `## MODO SINGLE-PERIOD (${ctx.primaryPeriod})
Sin periodo comparativo: amountComparative=null en TODAS las líneas. NO inventar cifras.`;
  }
  return '';
}

/**
 * Bloque Regla R1 (Impracticabilidad NIC 1) — aplicable a los 3 pases. En
 * Pass-1 afecta amountComparative del Balance/P&L. En Pass-2, mismo efecto
 * en EFE/ECP. En Pass-3 dispara la nota literal.
 */
function renderImpracticabilityBlock(ctx: SharedPromptContext): string {
  if (ctx.comparativosImpracticables === true) {
    return `## Regla R1 (Impracticabilidad NIC 1) — comparativo impracticable
El preprocesador determinó que el comparativo del periodo ${ctx.comparativePeriod ?? '(anterior)'} es IMPRACTICABLE de reconstruir. amountComparative=null en TODAS las líneas. technicalNotes DEBE incluir la nota literal: "Los estados financieros se presentan sin comparativos del periodo ${ctx.comparativePeriod ?? 'anterior'} dado que la información necesaria para reconstruirlos resultó impracticable de obtener (NIIF para PYMES, Secciones 3.14 y 10.21). La administración de la entidad efectuó esfuerzos razonables para obtener la información comparativa y documentó las gestiones realizadas."`;
  }
  if (ctx.comparativosImpracticables === false) {
    return `## Comparativo disponible
El Opening Balance del periodo ${ctx.comparativePeriod ?? '(anterior)'} está disponible — usar como columna comparativa del Balance y del P&L (la del EFE y el ECP del periodo comparativo la adjunta el código).`;
  }
  return '';
}

/**
 * Bloque MAPEO PUC → NIIF + identidad P&G. Pertenece al Pass-1 (Balance+P&L
 * lo necesita para clasificar Activo Corriente/No Corriente, Pasivo Cte./No
 * Cte., Patrimonio, Ingresos, Gastos y Costos).
 */
function renderPucMappingBlock(): string {
  return `## MAPEO PUC → NIIF (referencial)
| Clase | Grupos | Clasificación |
|-------|--------|---------------|
| 1 — Activo | 11xx Disponible, 12xx Inversiones, 13xx Deudores, 14xx Inventarios | Activo Corriente |
| 1 — Activo | 15xx PPE, 16xx Intangibles, 17xx Diferidos, 18xx Otros | Activo No Corriente |
| 2 — Pasivo | 21xx Obl. fin. CP, 22xx Proveedores, 23xx CxP, 24xx Impuestos, 25xx Laborales | Pasivo Corriente |
| 2 — Pasivo | 21xx Obl. fin. LP, 27xx Diferidos LP | Pasivo No Corriente |
| 3 — Patrimonio | 31xx Capital, 32xx Superávit, 33xx Reservas, 34xx Revalorización, 36xx Resultados | Patrimonio |
| 4 — Ingresos | 41xx Operacionales (4175 devoluciones restan) | Ingresos de actividades ordinarias |
| 4 — Ingresos | 42xx No operacionales (4210 financieros, 4245 utilidad en venta de PPE, 4250 recuperaciones…) | Otros ingresos — DEBAJO del resultado operacional |
| 5 — Gastos | 51xx Admin., 52xx Ventas | Gastos Operacionales |
| 5 — Gastos | 53xx No operacionales (5305 financieros…) | Otros gastos — DEBAJO del resultado operacional |
| 5 — Gastos | 54xx Impuesto de renta y complementarios | Gasto por impuesto |
| 6 — Costos | 61xx Costo de ventas, 62xx Compras, 63xx Producción | Costo de Ventas |
| 7 — Costos producción | 71xx-74xx MP, MOD, CIF | Costo de Producción |

Cascada del P&G (enmienda spec v2.1 del 2026-09-24):
- Utilidad Bruta = ingresos operacionales netos (grupo 41 − 4175) − Clase 6 − Clase 7.
- Resultado operacional (EBIT) = Utilidad Bruta − grupo 51 − grupo 52.
- UAI = EBIT + otros ingresos no operacionales (grupo 42) − grupo 53.
- Utilidad Neta = UAI − grupo 54. Equivale a Clase 4 − Clase 6 − Clase 7 − (51 + 52 + 53) − 54: el grupo 54 está DENTRO de la clase 5, así que no se resta dos veces.`;
}

/**
 * Bloque Regla R3.b (renta neto-bruto) — retenciones y anticipos de renta
 * (1355/1805, regla única de `@/lib/accounting/renta-credit`) materiales.
 * `anticipoActivo135515` conserva su nombre histórico, pero es la suma de
 * TODOS los créditos de renta, no sólo la 135515. Aplicable a Pass-1 (presentación neto-bruto en Balance + sub-nota Defensa
 * Art. 647 E.T.) y referenciado en Pass-3 (nota maestra).
 */
function renderAnticipoRentaBlock(ctx: SharedPromptContext): string {
  if (ctx.tieneAnticipoRentaMaterial && ctx.impuestoRentaNeto) {
    return `## Regla R3.b (renta neto-bruto) — valores autoritativos
- PUC 2404 (Bruto Pasivo): $${ctx.fmtCop(ctx.impuestoRentaNeto.brutoPasivo2404)} COP.
- Retenciones y anticipos de renta (1355/1805): $${ctx.fmtCop(ctx.impuestoRentaNeto.anticipoActivo135515)} COP.
- Neto a Pagar: $${ctx.fmtCop(ctx.impuestoRentaNeto.netoAPagar)} COP.
Citar en technicalNotes: "Conforme a la NIC 12, párrafo 71, y la NIIF para PYMES, Sección 29, el saldo del Impuesto de Renta corriente se presenta NETO en el Pasivo Corriente ($${ctx.fmtCop(ctx.impuestoRentaNeto.netoAPagar)}) porque la entidad tiene el derecho legal exigible de compensar las retenciones y anticipos de renta contra el impuesto a cargo y la intención de liquidar por el neto. Bruto: $${ctx.fmtCop(ctx.impuestoRentaNeto.brutoPasivo2404)}. Retenciones y anticipos de renta (1355/1805): $${ctx.fmtCop(ctx.impuestoRentaNeto.anticipoActivo135515)}."`;
  }
  return '';
}

/**
 * Bloque Regla R4 (No-Compensación NIC 1 §32) — reclasificaciones de saldos
 * contranatura (Activo que migra al Pasivo). Aplicable a Pass-1 (presentación)
 * y referenciado en Pass-3 (nota dedicada NIIF for SMEs §2.52 + NIC 1 §32).
 */
function renderReclasifNoCompBlock(ctx: SharedPromptContext): string {
  if (ctx.reclasifNoComp.length > 0) {
    return `## Regla R4 (No compensación, NIC 1, párrafo 32) — reclasificaciones detectadas (${ctx.reclasifNoComp.length})
${ctx.reclasifNoComp.map((r) => `- ${r.cuenta_origen} → ${r.cuenta_destino_pasivo} | saldo invertido: $${ctx.fmtCop(r.saldo_invertido_centavos)} | norma: ${r.motivo_norma}`).join('\n')}`;
  }
  return '';
}

/**
 * Bloque Regla R3 (Saldo a favor) — saldo a favor del impuesto separado en
 * Activos. Aplicable a Pass-1 y referenciado en Pass-3.
 */
function renderSaldoAFavorBlock(ctx: SharedPromptContext): string {
  if (ctx.tieneSaldoAFavor) {
    return `## Regla R3 (Saldo a favor) — saldo a favor del impuesto detectado
Saldo a favor de renta identificado por el preprocesador: $${ctx.fmtCop(ctx.saldoAFavorCents!)} COP. Presentar SEPARADO dentro de balanceSheet.assets — NUNCA neteado contra el gasto del P&L. La cuenta 1805 sólo es impuesto si su nombre en el balance de prueba lo indica.`;
  }
  return '';
}

/**
 * Bloque "CASCADA VINCULANTE DEL P&G" — los escalones del Estado de Resultados
 * en centavos exactos, con el token `[MoneyCop: N]` que el modelo copia.
 *
 * Por qué existe (auditoría 2026-09, niif-contrato-01): el bloque TOTALES
 * VINCULANTES no publicaba la Utilidad Bruta ni el EBIT, y el prompt definía
 * los ingresos operacionales como toda la clase 4. El modelo tenía que
 * derivarlos y el validador (E14/E9) los exige al centavo contra
 * `buildPeriodAnchors`. Con la enmienda spec v2.1 del 2026-09-24 el grupo 42
 * va DEBAJO del resultado operacional; este bloque publica esa cascada.
 */
function renderPnlCascadeBlock(ctx: SharedPromptContext): string {
  const renderPeriod = (label: string, a: PeriodAnchors | null): string | null => {
    if (!a) return null;
    const c = a.cents;
    if (c.utilidadBruta === undefined || c.ebit === undefined) {
      return `=== ${label} (${a.period}) ===
- La cascada no es derivable al centavo desde el balance de prueba de este periodo: construye la Utilidad Bruta y el EBIT con la definición del mapeo PUC (grupo 42 debajo del EBIT) y declara la limitación en incomeStatement.notes.`;
    }
    const line = (name: string, v: bigint | undefined, target: string): string =>
      v === undefined ? `- ${name}: N/D` : `- ${name}: ${formatCopFromCents(v)} COP ${moneyCopToken(v)}${target}`;
    return [
      `=== ${label} (${a.period}) ===`,
      line('Ingresos operacionales netos (grupo 41 − devoluciones 4175)', c.ingresosOperacionales, ''),
      line('Utilidad Bruta', c.utilidadBruta, ` → grossProfit${label === 'Periodo actual' ? 'Primary' : 'Comparative'}`),
      line('Resultado operacional (EBIT)', c.ebit, ` → operatingProfit${label === 'Periodo actual' ? 'Primary' : 'Comparative'}`),
      line('(+) Otros ingresos no operacionales (grupo 42)', c.otrosIngresos, ''),
      line('(−) Gastos no operacionales (grupo 53 y resto de clase 5 salvo 51/52/54)', c.gastosNoOperacionales, ''),
      line('Utilidad antes de impuestos (UAI)', c.utilidadAntesImpuestos, ''),
      line('(−) Impuesto de renta (grupo 54)', c.impuestoCausado, ''),
      line('Utilidad Neta', c.utilidadNeta, ` → netIncome${label === 'Periodo actual' ? 'Primary' : 'Comparative'}`),
    ].join('\n');
  };
  const primary = renderPeriod('Periodo actual', ctx.pnlAnchors.primary);
  if (!primary) return '';
  const comparative = ctx.isComparative ? renderPeriod('Periodo comparativo', ctx.pnlAnchors.comparative) : null;
  return `## CASCADA VINCULANTE DEL P&G (enmienda spec v2.1 2026-09-24 — grupo 42 debajo del EBIT)
Cifras exactas del preprocesador. Los subtotales del P&G copian el token [MoneyCop: N]; los renglones con código PUC deben sumar estos escalones (UB = 41 − 4175 − 6 − 7; EBIT = UB − 51 − 52; UAI = EBIT + 42 − 53; UN = UAI − 54).
${primary}${comparative ? `\n${comparative}` : ''}`;
}

/**
 * Bloque "EFE VINCULANTE" — el Estado de Flujos de Efectivo determinista,
 * renglón a renglón, en centavos. EXCLUSIVO de Pass-2 (Pass-1 no produce EFE;
 * Pass-3 lo recibe como anchor).
 *
 * Por qué el bloque imprime el estado COMPLETO y no tres deltas: la auditoría
 * de cálculos midió que, con sólo ΔCxC/ΔInv/ΔCxP en el prompt, el modelo
 * entregó una sección de operación cuyos 8 renglones sumaban $834.754.377,59
 * bajo un subtotal impreso de $2.421.190.071,93, y una sección de financiación
 * con CERO renglones bajo ($1.570.997.737,30). Copiar un estado ya cuadrado es
 * una tarea que el modelo hace bien; reconstruirlo desde deltas sueltos, no.
 *
 * El bloque además DEROGA explícitamente la línea "Dividendos estimados" del
 * bloque TOTALES VINCULANTES del orquestador (curator R2), porque esa cifra
 * sale de cuentas virtuales `3605VC`/`3710VC` que el propio curator inyecta y
 * no de una distribución real. Mientras esa línea siga imprimiéndose aguas
 * arriba, la derogación tiene que estar escrita aquí.
 */
function renderEfeAuthoritativeBlock(ctx: SharedPromptContext): string {
  const efe = ctx.deterministicCashFlow;

  // Sin EFE determinista (falta el comparativo) el estado NO es calculable por
  // el método indirecto. Se dice eso — no se rellena con estimaciones.
  if (!efe) {
    return `## EFE — no calculable por método indirecto
No hay periodo comparativo, así que no hay saldo de apertura contra el cual medir variaciones (NIC 7 ¶1). NO construyas un EFE con saldos de apertura asumidos en $0 ni con partidas estimadas: emite \`cashFlow.degeneracyFlag='indirect_method_unreliable'\` y la limitación al alcance en methodNote (NIC 7 ¶18 + NIA 705 ¶7). Si el bloque TOTALES VINCULANTES trae una línea "Dividendos estimados", IGNÓRALA: está derogada por este bloque.`;
  }

  const sectionTitle: Record<string, string> = {
    operating: 'Actividades de Operación',
    investing: 'Actividades de Inversión',
    financing: 'Actividades de Financiación',
  };

  const body: string[] = [];
  for (const section of efe.sections) {
    body.push(`### ${sectionTitle[section.section]} (\`${section.section}\`)`);
    if (section.rows.length === 0) {
      body.push(
        `- SIN RENGLONES. netFlow = 0 (MoneyCop "0"). La sección va vacía y su subtotal es CERO — no la rellenes.`,
      );
    } else {
      for (const row of section.rows) {
        body.push(
          `- [PUC ${row.account}] ${row.label} = ${formatCopFromCents(row.cents)} → MoneyCop "${row.cents.toString()}"`,
        );
      }
    }
    body.push(
      `- SUBTOTAL netFlow = ${formatCopFromCents(section.netFlowCents)} → MoneyCop "${section.netFlowCents.toString()}" (= suma exacta de los ${section.rows.length} renglones de arriba).`,
    );
  }

  const dividendLine = describeOwnerFlowsForEfe(efe);

  const gapLine =
    efe.reconciliationGapCents === BigInt(0)
      ? `- Brecha de reconciliación: $0,00. El EFE cierra exacto; no hay nada que ajustar.`
      : `- Brecha de reconciliación: ${formatCopFromCents(efe.reconciliationGapCents)}. NO la absorbas moviendo capital de trabajo ni inventando una línea de financiación: decláralarla en methodNote como limitación al alcance (NIC 7 ¶18 + NIA 705 ¶7) y emite \`degeneracyFlag='indirect_method_unreliable'\`.`;

  const unclassified =
    efe.unclassifiedGroups.length > 0
      ? `\n- Grupos PUC sin clasificación NIIF explícita, presentados en su sección por defecto: ${efe.unclassifiedGroups.join(', ')}. Menciónalos en methodNote.`
      : '';

  return `## EFE VINCULANTE (determinista, ${efe.comparativePeriod} → ${efe.primaryPeriod})
Este es el Estado de Flujos de Efectivo COMPLETO, calculado desde el balance de prueba. Cada renglón es la variación de un grupo PUC real; la suma de los renglones ES el subtotal de su sección, y la suma de las tres secciones ES la variación observada del PUC 11. Cópialo: la aritmética ya está hecha y es vinculante. Tu aporte es la etiqueta NIIF, el orden de presentación y la narrativa de \`methodNote\` — nunca las cifras.

${body.join('\n')}

### Cierre
- cashOpening = ${formatCopFromCents(efe.cashOpeningCents)} → MoneyCop "${efe.cashOpeningCents.toString()}"
- netChange = ${formatCopFromCents(efe.netChangeCents)} → MoneyCop "${efe.netChangeCents.toString()}"
- cashClosing = ${formatCopFromCents(efe.cashClosingCents)} → MoneyCop "${efe.cashClosingCents.toString()}"
${gapLine}
${dividendLine}${unclassified}`;
}

/**
 * Bloque compacto para Pass-3 (notas técnicas): la evidencia —o su ausencia—
 * de distribución a socios.
 *
 * Existe porque la cifra fabricada de dividendos no se quedó en el EFE: el
 * escéptico que corrió el LLM real la encontró verbatim en la Nota 6 del
 * informe entregado, con cita normativa de respaldo, mientras la tabla de
 * financiación salía vacía. Pass-3 lee TOTALES VINCULANTES igual que Pass-2,
 * así que la derogación tiene que repetirse aquí.
 */
function renderDividendEvidenceBlockForNotes(ctx: SharedPromptContext): string {
  const efe = ctx.deterministicCashFlow;
  if (!efe) return '';
  return `## Distribución a socios — lo que el balance de prueba permite afirmar
${describeOwnerFlowsForEfe(efe)}
- Cualquier nota que hable de dividendos, distribuciones o aportes cita EXCLUSIVAMENTE las cifras de este bloque (las mismas de la sección "EFE DETERMINISTA" de TOTALES VINCULANTES). No existen "dividendos estimados" ni presuntos: sin evidencia en el balance no hay distribución (NIC 7 ¶43).`;
}

/**
 * Qué puede decir el informe sobre los flujos con los socios, según el EFE
 * determinista (auditoría 2026-09, niif-contrato-03/04).
 *
 * El texto anterior afirmaba "en el período NO hubo distribución" siempre que
 * la 2360 no se moviera, y prohibía mencionar dividendos pagados. Un dividendo
 * decretado y pagado dentro del mismo año deja la 2360 en cero: esa regla
 * negaba un pago real. Ahora la afirmación sale del residuo patrimonial.
 */
function describeOwnerFlowsForEfe(efe: DeterministicCashFlow): string {
  const lines: string[] = [];
  const residual = efe.ownerFlows.residualCents;
  if (efe.dividendEvidence.found) {
    lines.push(
      `- Evidencia contable de distribución: cuentas ${efe.dividendEvidence.accounts.join(', ')} con movimiento. El flujo por la 2360 ya está en el EFE como ${formatCopFromCents(efe.dividendEvidence.cashFlowCents)}; NO lo dupliques ni lo re-estimes.`,
    );
  }
  switch (efe.ownerFlows.classification) {
    case 'distribution_pending_support':
      lines.push(
        `- El patrimonio disminuyó ${formatCopFromCents(-residual)} más de lo que explica el resultado del ejercicio. Se presenta en actividades de FINANCIACIÓN como distribuciones a socios (NIC 7 ¶34 / NIIF PYMES 7.14 — política de la entidad: dividendos pagados en financiación), pendiente de soporte (acta de asamblea y comprobante de egreso). methodNote y las notas declaran que el soporte debe verificarse; NO afirmes que no hubo distribución ni inventes una cifra distinta.`,
      );
      break;
    case 'unreconciled':
      lines.push(
        `- El patrimonio disminuyó ${formatCopFromCents(-residual)} más de lo que explica la utilidad publicada, y el periodo comparativo no tiene cierre contable: la utilidad del periodo puede incluir resultados de ejercicios anteriores. La diferencia va como PARTIDA NO CONCILIADA que el contador debe explicar (renglón del bloque). NO la presentes como partida no monetaria ni como dividendo; emite \`degeneracyFlag='indirect_method_unreliable'\` y decláralo en methodNote como limitación al alcance (NIC 7 ¶18 + NIA 705).`,
      );
      break;
    case 'contribution':
      lines.push(
        `- El patrimonio aumentó ${formatCopFromCents(residual)} más de lo que explica el resultado del ejercicio: se presenta en FINANCIACIÓN como aportes de socios, a verificar con el soporte del aporte en efectivo.`,
      );
      break;
    case 'none':
      if (!efe.dividendEvidence.found) {
        lines.push(
          `- No hay evidencia contable de distribución distinta de la variación de resultados acumulados: la 2360 (Dividendos o participaciones por pagar, Decreto 2650/1993) no registra movimiento y el patrimonio sólo varió por el resultado del ejercicio y traslados internos. El EFE no lleva línea de dividendos, ni "estimados", ni "presuntos", ni "inferidos".`,
        );
      }
      break;
  }
  if (efe.nonCashEquityMovements.length > 0) {
    lines.push(
      `- Movimientos internos del patrimonio del periodo (transacciones no monetarias — NIC 7 ¶43 / NIIF PYMES 7.18: se revelan en methodNote, NO son renglones del EFE): ${efe.nonCashEquityMovements
        .map((r) => `${r.label} (PUC ${r.account}) ${formatCopFromCents(r.cents)}`)
        .join('; ')}. La apropiación de reservas y la capitalización de utilidades son traslados entre cuentas de patrimonio, no flujos de efectivo.`,
    );
  }
  return lines.join('\n');
}

/**
 * Bloque "Actividad económica inferida" — aplicable a Pass-1 (gating de
 * notas) y Pass-3 (nota "verdad financiera condicionada").
 */
function renderActividadInferidaBlock(ctx: SharedPromptContext): string {
  if (ctx.actividadInferida && ctx.actividadInferida.descripcion) {
    return `## Actividad económica inferida
CIIU letra ${ctx.actividadInferida.sectorCIIU} — ${ctx.actividadInferida.descripcion}${ctx.actividadInferida.evidencia ? ` (evidencia: ${ctx.actividadInferida.evidencia})` : ''}. Usar solo letra CIIU; NO atribuir código de 4 dígitos sin RUT verificado.`;
  }
  return '';
}

/**
 * Sub-sección "PresentationV3 anchors" inyectada al final del bloque
 * TOTALES VINCULANTES / <context>. Presente SOLO cuando el curator emitió
 * `presentationV3` (post-cambio 2). Omitida silenciosamente en tests legacy
 * y callers sin curator v3 — la doctrina V3 ya le dice al LLM qué hacer si
 * los anchors están ausentes (modo simple).
 */
function renderPresentationV3AnchorsBlock(ctx: SharedPromptContext): string {
  const d = ctx.presentationV3Data;
  if (!d) return '';
  const { depreciation, oriComponents, ecpColumns } = d;
  return `## PresentationV3 anchors
- daCop: $${depreciation.daCop.toLocaleString('es-CO', { maximumFractionDigits: 2 })}
- roUAmortizationCop: $${depreciation.roUAmortizationCop.toLocaleString('es-CO', { maximumFractionDigits: 2 })}
- impairmentCop: $${depreciation.impairmentCop.toLocaleString('es-CO', { maximumFractionDigits: 2 })}
- oriComponents: ${JSON.stringify(oriComponents)}
- ecpColumns: { capital: ${ecpColumns.capital}, premium: ${ecpColumns.premium}, legalReserve: ${ecpColumns.legalReserve}, otherReserves: ${ecpColumns.otherReserves}, retainedEarnings: ${ecpColumns.retainedEarnings}, periodResult: ${ecpColumns.periodResult}, oci: ${ecpColumns.oci} }`;
}

/**
 * Bloque `<previously_computed>` con anchors de Pass-1 (utilizado por Pass-2
 * y Pass-3). Se cita LITERALMENTE: el modelo no debe recalcular.
 */
function renderPass1AnchorsBlock(anchors: PreviouslyComputedPass1Anchors): string {
  // 2026-05-13 hotfix: emitir tambien los anchors comparativos cuando existen,
  // para que Pass-2 (EFE/ECP) y Pass-3 (notas) puedan citar las dos columnas
  // sin null-ear amountComparative. Si la cifra comparativa no existe (null),
  // emitir "N/A" explicito en lugar de omitir la linea.
  //
  // Auditoría 2026-09 (niif-contrato-15): antes se imprimía `$419655824290`
  // —centavos con signo de pesos, que se lee como 100 veces el valor—. Ahora
  // cada ancla lleva la cifra legible es-CO y, aparte, el token MoneyCop.
  const fmt = (v: string | null): string =>
    v === null ? 'N/A (sin comparativo)' : moneyAnchor(v);
  return `## Anchors de Pass 1 (Balance + P&G - ya emitidos, no recalcular)
- totalAssetsPrimary: ${moneyAnchor(anchors.totalAssetsPrimary)}
- totalLiabilitiesPrimary: ${moneyAnchor(anchors.totalLiabilitiesPrimary)}
- totalEquityPrimary: ${moneyAnchor(anchors.totalEquityPrimary)}
- netIncomePrimary: ${moneyAnchor(anchors.netIncomePrimary)}
- oriPrimary: ${moneyAnchor(anchors.oriPrimary)}

## Anchors comparativos de Pass 1 (cuando isComparative=true)
- totalAssetsComparative: ${fmt(anchors.totalAssetsComparative)}
- totalLiabilitiesComparative: ${fmt(anchors.totalLiabilitiesComparative)}
- totalEquityComparative: ${fmt(anchors.totalEquityComparative)}
- grossProfitComparative: ${fmt(anchors.grossProfitComparative)}
- operatingProfitComparative: ${fmt(anchors.operatingProfitComparative)}
- netIncomeComparative: ${fmt(anchors.netIncomeComparative)}
- oriComparative: ${fmt(anchors.oriComparative)}

## curatorFlags (literal del orchestrator)
- equityConvergenceApplied: ${anchors.curatorFlags.equityConvergenceApplied}
- cashFlowClosureForced: ${anchors.curatorFlags.cashFlowClosureForced}
- negativeAssetReclassified: ${anchors.curatorFlags.negativeAssetReclassified}
- presumedCostWarning: ${anchors.curatorFlags.presumedCostWarning}
- reclassifiedAmountCop: ${moneyAnchor(anchors.curatorFlags.reclassifiedAmountCop)}`;
}

/**
 * Cifra de un ancla para `<previously_computed>`: legible es-CO (la que se cita
 * en texto) + token MoneyCop (la que se copia al schema). Un valor que no es
 * MoneyCop válido se imprime tal cual, sin inventar formato.
 */
function moneyAnchor(cents: string): string {
  if (!/^-?\d+$/.test(cents)) return cents;
  return `${formatCopFromCents(BigInt(cents))} [MoneyCop: ${cents}]`;
}

/**
 * Bloque `<previously_computed>` con anchors de Pass-2 (utilizado por
 * Pass-3 únicamente). Cifras EFE/ECP autoritativas para componer notas.
 */
function renderPass2AnchorsBlock(anchors: PreviouslyComputedPass2Anchors): string {
  return `## Anchors de Pass 2 (EFE + ECP — ya emitidos, no recalcular)
- cashOpening: ${moneyAnchor(anchors.cashOpening)}
- cashClosing: ${moneyAnchor(anchors.cashClosing)}
- netChange: ${moneyAnchor(anchors.netChange)}
- ecpClosingTotal: ${moneyAnchor(anchors.ecpClosingTotal)}`;
}

// ===========================================================================
// PASS 1 — Balance + P&L + curatorFlags
// ===========================================================================

/**
 * Builder del prompt de Pass-1 del Agente NIIF Analyst (chunked).
 *
 * Schema esperado: `BalanceAndPnlSubSchema`.
 *
 * Salida del modelo:
 *   - `balanceSheet` (assets, liabilities, equity, totales).
 *   - `incomeStatement` (lines, totales, ORI).
 *   - `curatorFlags` (literal del orchestrator).
 *
 * NO emite EFE, ECP ni notas técnicas globales — esas viven en Pass-2 y
 * Pass-3 respectivamente. Las sub-notas de Defensa Art. 647 E.T. asociadas
 * a ajustes específicos del Balance/P&L (R1, Regla R3.b) se ponen en
 * `balanceSheet.notes` / `incomeStatement.notes`.
 */
export function buildNiifAnalystPass1Prompt(
  company: CompanyInfo,
  language: 'es' | 'en',
  reportMode: ReportMode,
  preprocessed?: PreprocessedBalance,
  elite?: NiifAnalystEliteContext,
  /**
   * Discrepancias exactas del intento anterior, redactadas por
   * `reconcileAnchors`. Sólo viaja en la RE-invocación del bucle de reparación
   * (máximo un reintento). Se emite al FINAL del prompt a propósito: el prefijo
   * estable de arriba conserva el prompt cache entre el intento y su reparación.
   */
  repairInstructions?: string[],
): string {
  const ctx = buildSharedContext(company, language, reportMode, preprocessed, elite);

  // Bloque de reparación (2026-08). La medición de FASE 0 mostró que el modelo
  // copia bien los totales y en cambio omite renglones del desglose de forma
  // inestable: sobre el MISMO balance, el detalle del Activo se quedó corto un
  // 0,1%, un 41,2% y un 99,9% en tres corridas. Repetir la instrucción genérica
  // no sirve; lo que se le devuelve es la brecha exacta en pesos.
  const repairBlock =
    repairInstructions && repairInstructions.length > 0
      ? `

<correccion_obligatoria>
Tu intento anterior sobre ESTE MISMO balance quedó descuadrado. Cada punto trae la cifra
vinculante literal. Corrígelos TODOS en esta respuesta:

${repairInstructions.map((r, i) => `${i + 1}. ${r}`).join('\n')}

Cómo se corrige:
- Si falta desglose, AÑADE los renglones que faltan tomándolos del balance preprocesado que ya
  está en tu contexto. NUNCA inventes una cuenta de ajuste ni un renglón "otros" para cuadrar.
- Si sobra, hay doble conteo: elimina el renglón repetido. NUNCA reduzcas un saldo real.
- Los totales NO se tocan: son los del preprocesador y ya están correctos.
</correccion_obligatoria>`
      : '';

  // Why: el modeBanner canónico se inyecta dentro del prompt como instrucción
  // literal (no como string interpolable a posteriori). El LLM lo copia tal
  // cual en balanceSheet.modeBanner / incomeStatement.modeBanner.
  const modeBannerText =
    ctx.reportMode === 'LINEA_BASE'
      ? 'Periodo actual sin comparativo histórico. La columna derecha (YYYY+1) está reservada para el primer cierre plenamente comparable bajo NIIF para Pymes. No se renderiza vacía: se renderiza como compromiso.'
      : ctx.reportMode === 'TRANSICION'
        ? 'Periodo de transición. Se compara donde la información histórica es suficiente; se marca n/c donde no.'
        : 'null';

  return `${buildAbsoluteRulesAgente1(language)}

${ctx.guardrail}

${ctx.resilience0}

${ctx.presentationV3}

${ctx.context2026}

${ctx.niifMeasurement}

${ctx.niifDisclosures}

<task>Construir Balance General y Estado de Resultados de ${company.name} (NIT ${company.nit}) bajo ${ctx.niifFramework}, devolviendo JSON validado contra BalanceAndPnlSubSchema con cifras citadas LITERALMENTE de los TOTALES VINCULANTES y curatorFlags literal del orchestrator.</task>

<success_criteria>
- Activo = Pasivo + Patrimonio, tolerancia $0 (centavo).
- Ingresos de actividades ordinarias del P&L = grupo 41 neto de devoluciones 4175. El grupo 42 (ingresos no operacionales) se presenta en renglón(es) propio(s) DEBAJO del resultado operacional, con su código PUC. Toda la clase 4 queda presentada: 41 arriba, 42 abajo.
- grossProfitPrimary, operatingProfitPrimary y la UAI coinciden al centavo con el bloque "CASCADA VINCULANTE DEL P&G".
- Utilidad Neta del P&L coincide al centavo con TOTALES VINCULANTES (será el anchor para el closing_balance del ECP en Pass-2).
- Toda cifra global (totalAssetsPrimary, totalLiabilitiesPrimary, totalEquityPrimary, netIncomePrimary) coincide al centavo con TOTALES VINCULANTES.
- Utilidad Bruta (grossProfitPrimary) = ingresos operacionales netos (41 − 4175) − Clase 6 − Clase 7. NO incluye el grupo 42.
- EBIT (operatingProfitPrimary) = grossProfit − Grupo 51 − Grupo 52. NO incluye el grupo 42 ni deduce el Grupo 53. Tolerancia $0.
- UAI (utilidad antes de impuestos) = operatingProfitPrimary + otros ingresos (Grupo 42) − Grupo 53.
- netIncomePrimary = UAI − impuestoRenta. operatingProfitPrimary ≠ netIncomePrimary salvo cuando Grupo 53 = $0 e impuesto = $0.
- curatorFlags refleja LITERALMENTE el bloque vinculante (sin re-cálculo).
${ctx.isComparative ? `- Balance y P&L presentan amountPrimary (${ctx.primaryPeriod}) Y amountComparative (${ctx.comparativePeriod}); cuando un saldo comparativo no exista, amountComparative = null y se documenta en balanceSheet.notes / incomeStatement.notes.
- COMPARATIVO COMPLETO (Wave 5 — 2026-05-14): los SEIS totales globales del periodo comparativo (${ctx.comparativePeriod}) — totalAssetsComparative, totalLiabilitiesComparative, totalEquityComparative, grossProfitComparative, operatingProfitComparative, netIncomeComparative — DEBEN viajar como MoneyCop string (NUNCA null) y coincidir al centavo con el bloque "=== Periodo comparativo (${ctx.comparativePeriod}) ===" de TOTALES VINCULANTES. El validator E9 rechaza el reporte si cualquiera de ellos viaja null.
- Ecuación patrimonial comparativa: totalAssetsComparative = totalLiabilitiesComparative + totalEquityComparative, tolerancia $0 (centavo).
- company.comparativePeriod DEBE ecoarse LITERALMENTE como "${ctx.comparativePeriod}" (string, no null) cuando isComparative=true.` : '- isComparative=false: amountComparative = null en TODAS las líneas; totalAssetsComparative et al = null. company.comparativePeriod = null.'}
- CHECK 4 (Parte 8.1 spec — no duplicación gastos): TOTAL_GASTOS_P&L = Grupo 51 + Grupo 52 + Grupo 53 (cada grupo una sola vez). Subcuentas 53xx NO se cuentan en adición al total Grupo 53. Σ líneas de gastos en incomeStatement.lines ≤ controlTotals.gastos del bloque vinculante (tolerancia $1.000).
- Cada línea material (>1% del rubro padre) en balanceSheet.assets/liabilities/equity e incomeStatement.lines lleva campo \`confidence\` ∈ {high, medium, low} asignado.
- balanceSheet.modeBanner e incomeStatement.modeBanner reflejan el texto canónico del modo del reporte (o null cuando reportMode='COMPARATIVO_COMPLETO').
- Cuando reportMode='LINEA_BASE': ninguna línea, label ni nota contiene verbos comparativos (mejoró/creció/aumentó/se redujo/evolucionó/varió).
- reportMode (campo root del schema) ecoa LITERALMENTE el valor inyectado por el orchestrator.
</success_criteria>

<constraints>
- MUST: anclar TODA cifra global (totalAssetsPrimary, totalLiabilitiesPrimary, totalEquityPrimary, netIncomePrimary) al bloque TOTALES VINCULANTES. NO re-calcular desde el balance crudo.
- MUST: cada ancla de TOTALES VINCULANTES trae DOS representaciones del mismo importe: la legible en pesos (\`$4.196.558.242,90 COP\`) y el token \`[MoneyCop: 419655824290]\`. Al schema va el CONTENIDO LITERAL del token — se copia dígito por dígito. NEVER derivar el valor del schema a partir del formato legible: no se quitan puntos ni comas, no se multiplica por cien, no se convierte nada.
- MUST: cuando una cuenta auxiliar tenga saldo pero no aparezca en el resumen de Clase, integrarla de oficio y registrar la discrepancia en balanceSheet.notes o incomeStatement.notes.
- MUST: PRESENTACIÓN VISUAL ABSOLUTA en Balance y P&L — todas las líneas con \`isAbsolute=true\`. Excepción única: pérdida del ejercicio o resultados acumulados negativos (\`isAbsolute=false\`, valor con signo).
- MUST: MoneyCop serializado en CENTAVOS como string entero (ej. "150000000" = $1.500.000,00). Sin separadores, sin decimales, sin signo de pesos.

- MUST: ecoar \`reportMode\` (campo root del schema) LITERALMENTE con el valor "${ctx.reportMode}" del bloque "MODO DEL REPORTE" inyectado en <context>. NO inferir ni recalcular el modo.

- MUST: cada \`StatementLine\` en balanceSheet.assets / balanceSheet.liabilities / balanceSheet.equity / incomeStatement.lines con monto MATERIAL (amountPrimary representa >1% del rubro padre — totalAssets para activos, totalLiabilities para pasivos, etc.) DEBE llevar campo \`confidence\` ∈ {high, medium, low}:
  - high: cifra proviene LITERALMENTE de TOTALES VINCULANTES (controlTotals) o auxiliar sin reclasificación curator.
  - medium: requirió mapeo PUC→NIIF con juicio (ej. PPE bruto vs neto, intangibles desglose, agrupaciones de subcuentas).
  - low: requirió ajuste curator (R1/R5/R6/R7), presunción, o el comparativo es impracticable.

- MUST: $0 huérfanos (§1.2 spec v8.1). If una línea tiene \`amountPrimary="0"\` Y (\`amountComparative="0"\` O \`amountComparative=null\`) Y NO existe nota en \`balanceSheet.notes\` / \`incomeStatement.notes\` explicando la materialidad del cero, OMITIR la línea completa. Else if el cero es materialmente significativo (ej. "Reservas legales en cero — Art. 452 C.Co. aplicable desde primer ejercicio con utilidad") MANTENER la línea + nota explicativa citando norma. NEVER emitir líneas con valor "0" sin justificación normativa.

- MUST: poblar \`balanceSheet.modeBanner\` e \`incomeStatement.modeBanner\` con el texto canónico inyectado:
${ctx.reportMode === 'COMPARATIVO_COMPLETO' ? '  balanceSheet.modeBanner = null; incomeStatement.modeBanner = null.' : `  balanceSheet.modeBanner = "${modeBannerText}"; incomeStatement.modeBanner = "${modeBannerText}".`}
  NEVER inventar otro texto distinto del canónico — copiar literal.

- MUST: si reportMode != 'LINEA_BASE' Y \`comparativosImpracticables\` != true Y el bloque TOTALES VINCULANTES expone la cifra del periodo comparativo, \`amountComparative\` DEBE reflejar esa cifra (incluso si es "0"). \`amountComparative=null\` EXCLUSIVAMENTE cuando: (a) reportMode='LINEA_BASE', o (b) la cuenta NO existe en preprocessed.comparative (es cuenta nueva del periodo actual). NUNCA null-ear silenciosamente.

- MUST (Wave 5 hard-anchor — 2026-05-14): cuando el bloque TOTALES VINCULANTES contiene una sección "=== Periodo comparativo (${ctx.comparativePeriod ?? 'YYYY'}) ===", los SEIS totales globales del periodo comparativo se LEEN LITERALMENTE de esa sección y se emiten así:
  - balanceSheet.totalAssetsComparative = "Total Activo" del bloque comparativo (centavos string).
  - balanceSheet.totalLiabilitiesComparative = "Total Pasivo" del bloque comparativo.
  - balanceSheet.totalEquityComparative = "Total Patrimonio" del bloque comparativo.
  - incomeStatement.grossProfitComparative = Utilidad Bruta del periodo comparativo, copiada del token del bloque "CASCADA VINCULANTE DEL P&G" (ingresos operacionales netos 41 − 4175, menos costos 6/7; sin grupo 42).
  - incomeStatement.operatingProfitComparative = EBIT del periodo comparativo, copiado del mismo bloque (Utilidad Bruta − grupos 51 y 52).
  - incomeStatement.netIncomeComparative = "Utilidad Neta (P&L)" del bloque comparativo.
  PROHIBIDO emitir null en cualquiera de los seis cuando isComparative=true (validator E9 rechaza). PROHIBIDO redondear o re-derivar; los valores son AUTORITARIOS del preprocesador. Tolerancia $0 al centavo.

- MUST: \`company.comparativePeriod\` se ecoa EXACTAMENTE como ${ctx.isComparative ? `"${ctx.comparativePeriod}"` : 'null'} (echo literal del bloque DATOS DE LA EMPRESA). PROHIBIDO inventar otro año o emitir null cuando isComparative=true — bloquea el renderer comparativo en PDF/Excel/HTML.

- MUST: TODA política contable elegida, TODA agrupación de subcuentas y TODA presentación lleva cita normativa entre paréntesis (§1.4 spec v8.1: NIIF Pymes Sec. X / IAS Y / NIC Z / Art. E.T. / Ley X). Sin cita, sin afirmación.

- Si un dato falta, escribir "— (dato no suministrado)" o N/D con el motivo concreto (guardarraíl anti-alucinación). La impracticabilidad (NIIF para PYMES, Secciones 3.14 y 10.21; NIC 8.5) sólo se cita cuando el preprocesador o la entidad la acreditaron (bloque "Regla R1"); un insumo que no llegó a la herramienta no es impracticable.
- NEVER inventar saldos del periodo comparativo: si comparativosImpracticables=true, amountComparative=null en todas las líneas.
- NEVER usar Clase 5 (Gastos) ni Clase 6 (Costos) como Ingresos. Los ingresos son EXCLUSIVAMENTE Clase 4.
- NEVER confundir CÓDIGO de cuenta (ej. "41", "52") con VALOR monetario.

- NEVER en notas, labels ni body: "Élite", "Excelencia", "Premium", "Excepcional", "Único", "Mejor", "Sólido", "Robusto", "Extraordinario", "Sin precedentes", "De clase mundial" (§1.6 spec v8.1 — prohibición vocabulario marketing). El registro narrativo es técnico-contable, no comercial.

- If reportMode='LINEA_BASE' then NEVER usar en notas ni labels los verbos comparativos: "mejoró", "creció", "aumentó", "se redujo", "evolucionó", "varió respecto a", "incrementó", "disminuyó", "se contrajo". Usar en su lugar verbos de estado: "establece", "documenta", "constituye", "declara", "registra", "presenta".
  If reportMode='COMPARATIVO_COMPLETO' then verbos comparativos PERMITIDOS y esperados (la narrativa pierde valor si no compara).
  If reportMode='TRANSICION' then verbos comparativos SÓLO en líneas con comparativo disponible (no n/c); en líneas marcadas "n/c" usar verbos de estado.

- Detección de anomalías sectoriales 2σ (§1.3 spec v8.1). For each ratio DERIVADO en incomeStatement.lines (margen bruto, margen operativo, margen neto) compute la posición frente a la banda esperada del sector CIIU \`${ctx.actividadInferida?.sectorCIIU ?? 'no determinado'}\` (banda inyectada en el header colombia-2026-context). If el ratio cae fuera de [esperada − 2σ, esperada + 2σ] then poblar \`anomalyFlag\` en la línea correspondiente:
\`\`\`
anomalyFlag = {
  severity: 'high' | 'medium',
  message: 'Ratio Z% fuera de banda sectorial CIIU X-Y%',
  normaRef: 'NIA 240 + benchmark CTCP/DANE 2026',
  benchmarkBand: { lowerBound: 'X%', upperBound: 'Y%', observed: 'Z%' }
}
\`\`\`
  NEVER emitir cifras de banda INVENTADAS — usar EXCLUSIVAMENTE las del header colombia-2026-context (si están presentes para el CIIU). If el header no expone banda para este CIIU then citar como \`normaRef: 'NIA 240 (banda sectorial CIIU no disponible — recomendación general)'\` y omitir benchmarkBand (null).

Devoluciones 4175 (Parte 1.3 spec v2.0). TOTALES VINCULANTES expone (cuando F4 lande) \`ingresosNetos\` = |Σ 41xx crédito| − |Σ 4175xx débito|. If quieres desglosar ingresos en incomeStatement.lines (Opción B) then incluir línea separada "(-) Devoluciones en ventas (Cta 4175)" con valor absoluto y signo NEGATIVO; verificar que Ingresos brutos − Devoluciones = ingresosNetos. Else if Opción A (consolidado) then una sola línea "(+) Ingresos de actividades ordinarias (Grupo 41, neto de devoluciones)" con el monto de "Ingresos operacionales netos" del bloque CASCADA VINCULANTE DEL P&G (no el total de la clase 4: el grupo 42 va en su propio renglón debajo del EBIT). NEVER duplicar la resta de 4175 cuando el ancla ya entrega el monto neto.

Signo de los renglones del P&G: con \`isAbsolute=true\` el renglón lleva la magnitud (el ingreso suma, el costo o gasto resta). Una partida contranatura (p. ej. 4250 recuperaciones con saldo débito, o un 53xx con saldo crédito) va con \`isAbsolute=false\` y el importe firmado según su efecto en el resultado (negativo si reduce la utilidad, positivo si la aumenta).

Anti-duplicación Grupo 53 (CRÍTICO — Parte 1.3 spec v2.0). NEVER presentar simultáneamente el total del Grupo 53 (consolidado) Y sus subcuentas individuales (5305 Financieros, 5395 Diversos, 5310 Comisiones, etc.) como líneas independientes sumadas en \`incomeStatement.lines\`. Las subcuentas 53xx YA ESTÁN INCLUIDAS dentro del total Grupo 53; sumar ambos genera DOBLE CONTABILIZACIÓN (caso documentado: $30.262.041 de gastos no operacionales duplicados).

If quieres detalle de gastos no operacionales (Opción B del spec) then desglosar SOLO subcuentas (Σ 53xx = Grupo 53 total verificable al centavo) otherwise mostrar SOLO la línea consolidada "(-) Otros gastos no operacionales y financieros (Grupo 53)" (Opción A).

Las dos opciones son mutuamente excluyentes. Nunca ambas combinadas. Esta es la falla cubierta por CHECK 4 (Parte 8.1 spec) — el validator post-LLM la detecta y bloquea el reporte.

Detección de Anomalías (Tabla 8 — Parte 5 spec v2.0). Para CADA condición detectada en TOTALES VINCULANTES o auxiliares, emitir nota en \`balanceSheet.notes\` (anomalías de Activo/Pasivo/Patrimonio) o \`incomeStatement.notes\` (anomalías P&L):

- If preprocessed contiene cuenta auxiliar Clase 14 con saldo < 0 then nota "Anomalía A1: Inventarios con saldo negativo (Clase 14 < 0) — error contable; revisar kardex y movimientos (NIC 2, párrafos 9-10)".
- If preprocessed contiene cuenta auxiliar Clase 11/13/14 con saldo crédito (negativo en convención PUC) then nota "Anomalía A2: Activo con saldo inverso (cta XXXX) — inconsistencia contable; revisar imputación (NIC 1, párrafo 32 — no compensación)".
- If preprocessed contiene Clase 12 (Inversiones) con saldo < 0 then nota "Anomalía A3: Inversiones con saldo negativo — requiere revisión documental (NIC 28, párrafo 10 / NIIF para PYMES, Sección 14)".
- If (Clase 6 + Clase 7) / Clase 4 < 1% then nota "Anomalía A4: Costo de ventas/producción < 1% de ingresos — posible subregistro de costos; KPIs de ciclo operativo distorsionados (NIA 240 — fraude por subregistro)".
- If la UAI es positiva y el grupo 54 no tiene saldo then nota "Anomalía A5: no se registró gasto por impuesto de renta en el grupo 54 con utilidad antes de impuestos positiva — la conciliación fiscal (renta líquida, impuesto corriente y diferido) está pendiente del contador (NIC 12 / NIIF para PYMES, Sección 29)". No cuantifiques un impuesto teórico: la base gravable es la renta líquida, no la utilidad contable.
- If preprocessed contiene cta 22xx (Proveedores) con saldo débito (saldo positivo en convención PUC Clase 2) then nota "Anomalía A6: Proveedores con saldo débito — posible anticipo o error de imputación; revisar".
- If totalEquityPrimary < 0 then nota DEDICADA "Anomalía A7: PATRIMONIO NEGATIVO — alerta sobre la hipótesis de negocio en marcha (NIC 1, párrafos 25-26; NIIF para PYMES, Sección 3.8-3.9; NIA 570). Conforme al art. 4 de la Ley 2069 de 2020 y los indicadores del Decreto 1378 de 2021, los administradores deben abstenerse de iniciar nuevas operaciones distintas de las necesarias para la conservación del negocio y convocar al máximo órgano social para evaluar la continuidad de la empresa." (La causal de disolución por pérdidas de los Arts. 457 num. 2 y 459 C.Co. fue derogada por la Ley 2069 de 2020; no la cites.)
- If (utilidadNeta / ingresos) > 0.70 Y costoVentas < 30% ingresos then nota "Anomalía A8: Margen neto > 70% con costos < 30% — costo de ventas posiblemente subregistrado o ingresos sobreestimados (NIA 240 + R7 curator)".

If TOTALES VINCULANTES contiene reclassifications[] con applied=true then mantener la cuenta de Activo original con saldo absoluto NEGATIVO (e.g. "12 — Inversiones en asociadas (saldo contrario — ver Nota R1)") dentro de balanceSheet.assets, NO crear cuenta virtual PUC con sufijo "ZZ" / "XX" / "transitorio", y emitir balanceSheet.notes con la Nota R1 de Anomalía: "La cuenta {cuenta_origen} presenta saldo contrario por {monto}. Se requiere revisión documental. Conforme al principio de trazabilidad se mantiene el registro tal como aparece en el balance de prueba, agregando la presente nota de anomalía. Sustento NIIF: NIC 1, párrafo 32 (no compensación de activos y pasivos)." otherwise omitir silenciosamente.

NEVER inventar códigos PUC con sufijos no canónicos (ZZ, XX, transitorio, virtual, curator). El PUC colombiano (Decreto 2650/1993) tiene un catálogo cerrado; sufijos arbitrarios confunden al lector y rompen reconciliación con balance de prueba.

If reclasifNoComp.length > 0 (Regla R4 — No compensación, NIC 1, párrafo 32; saldos contranatura en Activo) then presentar las cuentas reclasificadas dentro de balanceSheet.liabilities (mantener saldo absoluto, citar cuenta de origen como referencia en notes) otherwise omitir.

If tieneSaldoAFavor=true (saldo a favor de renta identificado por el preprocesador) then presentar el saldo a favor SEPARADO dentro de balanceSheet.assets, NUNCA neteado contra el gasto de impuestos del P&L; emitir balanceSheet.notes citando la NIIF para PYMES, Sección 29, y la NIC 12, párrafo 58 otherwise no añadir esta nota.

If impuestoRentaNeto.applicable=true (Regla R3.b — renta neto-bruto, retenciones y anticipos de renta 1355/1805 materiales) then presentar dentro de balanceSheet.liabilities tres líneas: "Impuesto de Renta — Bruto (PUC 2404)", "(-) Retenciones y anticipos de renta (1355/1805)", "= Impuesto de Renta — Neto a Pagar"; totalLiabilitiesPrimary incluye SOLO el Neto a Pagar; NO mostrar esas retenciones y anticipos de renta adicionalmente como Activo; emitir balanceSheet.notes citando la NIC 12, párrafo 71 otherwise omitir esta presentación neto-bruto.

If comparativosImpracticables=true then balanceSheet e incomeStatement presentan amountComparative=null en todas las líneas otherwise usar el Opening Balance del periodo ${ctx.comparativePeriod ?? 'comparativo'} cuando exista.

Signo del impuesto de renta: cuando el grupo 54 tiene saldo, el "Gasto por impuesto de renta y complementarios" aparece como línea que resta de la UAI, con el código PUC 54 y el monto del grupo 54 (label "(-) Gasto por impuesto de renta y complementarios (grupo 54)").

Impuesto de renta (Corrección 4 spec v2.1, enmienda del 2026-09-24).
If TOTALES VINCULANTES contiene el impuesto causado del periodo (grupo 54 con saldo) then usar ese valor, con el código PUC 54, en incomeStatement.lines.
Else (sin grupo 54) then el impuesto queda NO RECONOCIDO: no se emite renglón de impuesto con monto, la Utilidad Neta es la UAI vinculante, y incomeStatement.notes lleva la nota de la REGLA 1 (NIC 12 / Sección 29 de la NIIF para las PYMES). Ni la cuenta 1805, ni la 1355, ni un porcentaje de la UAI sustituyen al grupo 54: un gasto por impuesto que no está en libros no se presenta como dato.

curatorFlags refleja LITERALMENTE lo que el orquestador inyectó: \`equityConvergenceApplied\`, \`cashFlowClosureForced\`, \`negativeAssetReclassified\`, \`presumedCostWarning\`, \`reclassifiedAmountCop\` (suma absoluta en MoneyCop). NO recalcules; copia desde TOTALES VINCULANTES.

Las reclasificaciones y ajustes automáticos del curator (R1, Regla R3.b, Regla R4) se describen en balanceSheet.notes / incomeStatement.notes con el concepto, la norma NIIF que los sustenta y el papel de trabajo de origen. La mención al Art. 647 E.T. vive en una sola nota de Pass-3 (Corrección 9 spec v2.1).
</constraints>

<context>
${renderCompanyBlock(ctx)}

${renderReportModeBlock(ctx)}

${renderComparativeModeBlock(ctx)}

${renderImpracticabilityBlock(ctx)}

${renderPucMappingBlock()}

${renderPnlCascadeBlock(ctx)}

${renderAnticipoRentaBlock(ctx)}

${renderReclasifNoCompBlock(ctx)}

${renderSaldoAFavorBlock(ctx)}

${renderActividadInferidaBlock(ctx)}

${renderPresentationV3AnchorsBlock(ctx)}

${ctx.hechosEmpresa}

${ctx.langInstruction}
</context>${repairBlock}`;
}

// ===========================================================================
// PASS 2 — EFE indirecto + ECP (consume Pass-1 anchors)
// ===========================================================================

/**
 * Builder del prompt de Pass-2 del Agente NIIF Analyst (chunked).
 *
 * Schema esperado: `CashFlowAndEquitySubSchema`.
 *
 * Salida del modelo:
 *   - `cashFlow` (3 secciones: operating/investing/financing + closure).
 *   - `equityChanges` (rows + notes).
 *
 * Pass-2 NO produce cifras del Balance/P&L (vienen como anchors literales
 * vía `<previously_computed>`) ni curatorFlags (ya emitidos en Pass-1).
 *
 * Las notas técnicas asociadas a EFE/ECP (incluyendo Nota Maestra Defensa
 * Art. 647 E.T. de ajustes EFE/ECP) viven en `cashFlow.methodNote` /
 * `equityChanges.notes`; las notas globales del reporte son Pass-3.
 */
export function buildNiifAnalystPass2Prompt(
  company: CompanyInfo,
  language: 'es' | 'en',
  reportMode: ReportMode,
  pass1Anchors: PreviouslyComputedPass1Anchors,
  preprocessed?: PreprocessedBalance,
  elite?: NiifAnalystEliteContext,
): string {
  const ctx = buildSharedContext(company, language, reportMode, preprocessed, elite);

  return `${buildAbsoluteRulesAgente1(language)}

${ctx.guardrail}

${ctx.resilience0}

${ctx.presentationV3}

${ctx.context2026}

${ctx.niifMeasurement}

${ctx.niifDisclosures}

<task>Construir Estado de Flujos de Efectivo (Método Indirecto) y Estado de Cambios en el Patrimonio de ${company.name} (NIT ${company.nit}) bajo ${ctx.niifFramework}, devolviendo JSON validado contra CashFlowAndEquitySubSchema consistente con los TOTALES VINCULANTES y los anchors numéricos de Pass-1.</task>

<success_criteria>
- cashClosing == saldo PUC 11 del Balance del periodo actual (anchor literal en TOTALES VINCULANTES), tolerancia $0 (centavo).
- cashOpening == saldo PUC 11 al INICIO del periodo (preprocessed.comparative.controlTotals.efectivoCuenta11 o cashClosing - netChange si el orchestrator solo lo expone derivable).
- Saldo final del ECP (closing_balance row.total) == totalEquityPrimary del Pass-1 anchor, tolerancia $0.
- Resultado del ejercicio en closing_balance row.resultadoEjercicio == netIncomePrimary del Pass-1 anchor, tolerancia $0.
- cashFlow.sections[operating].lines[0] ancla EXACTAMENTE al netIncomePrimary del Pass-1 anchor (\`<previously_computed>\`). El label canónico es "Utilidad neta del ejercicio" (o "Resultado neto del período"). PROHIBIDO emitir como primer ítem el Δ saldo de la cuenta 3605 entre cierre y apertura ("3605-movimiento-periodo", "Δ Utilidades acumuladas", o cualquier variante similar).
- Corrección v2.5 (ECP cuadre matricial): equityChanges.rows SIEMPRE incluye una fila kind="profit_for_period" cuyo resultadoEjercicio == netIncomePrimary del Pass-1 anchor (al centavo). Esta fila es la fuente autoritativa del resultado registrado en el ECP — NO se infiere del delta closing − opening. Si opening_balance.resultadoEjercicio es material (|saldo| > $1.000.000 COP), equityChanges.rows ADEMÁS incluye una fila kind="prior_period_result_cancellation" que TRASLADA ese saldo a resultados acumulados (Dr 3605 / Cr 37): resultadoEjercicio = -opening_balance.resultadoEjercicio, resultadosAcumulados = +el mismo monto, total = "0". La suma matricial columna a columna (opening + Σ movement rows = closing) cierra exactamente, tolerancia $0.
- Saldo inicial del ECP: opening_balance.total == totalEquityComparative del Pass-1 anchor (cuando existe), tolerancia $0 (NIIF PYMES 6.3).
- Saldo final del ECP por columna == renglones de patrimonio del Balance: capitalSocial = grupo 31, primaColocacion = 32, reservaLegal + otrasReservas = 33, resultadoEjercicio = 36, resultadosAcumulados = 37, ori = 38.
- La variación de la columna ori del ECP == oriPrimary del P&G. Sin componentes ORI en "PresentationV3 anchors", oriPrimary = "0".
- EFE Método Indirecto presenta las 3 secciones operating / investing / financing con sus respectivas líneas y subtotales.
- INVARIANTE ARITMÉTICA DEL EFE, tolerancia $0 al centavo, comprobada antes de devolver el JSON — las tres a la vez:
  (i) para CADA sección: Σ lines[].amountPrimary == netFlow de esa sección. Una sección sin renglones DEBE tener netFlow "0"; un netFlow distinto de "0" con \`lines: []\` es un estado financiero inválido.
  (ii) Σ de los tres netFlow == netChange.
  (iii) cashOpening + netChange == cashClosing.
  Si el bloque "EFE VINCULANTE" está presente, las tres se cumplen copiándolo tal cual: sus renglones ya suman sus subtotales y sus subtotales ya suman la variación observada del PUC 11.
- Los renglones y los subtotales del EFE se copian del bloque "EFE VINCULANTE" del \`<context>\` (cifras en MoneyCop ya calculadas). El modelo elige la etiqueta NIIF y el orden de presentación; NO elige los montos, no agrega renglones que no estén en el bloque, y no omite ninguno.
${ctx.isComparative ? `- El EFE y el ECP que emites son los del periodo ${ctx.primaryPeriod}: amountComparative = null en TODOS los renglones de cashFlow.sections y equityChanges.rows describe sólo ese periodo. La columna comparativa del EFE y el ECP del periodo ${ctx.comparativePeriod} los adjunta el código desde el balance de prueba (NIIF para las PYMES 3.14), o su nota de comparativo no presentado cuando el balance no trae el corte anterior al comparativo; methodNote y equityChanges.notes no los reemplazan ni los describen.` : '- isComparative=false: amountComparative = null en TODAS las líneas.'}
- Cuando reportMode='LINEA_BASE': ni methodNote ni equityChanges.notes usan verbos comparativos (mejoró/creció/aumentó/se redujo/evolucionó).
- If el EFE Indirecto produciría >=6 líneas con monto "0" en cashFlow.sections[].lines (por ausencia de auxiliares de capital de trabajo) then \`cashFlow.degeneracyFlag = 'indirect_method_unreliable'\` y methodNote incluye literal de limitación al alcance.
- Corrección v2.4: cashFlow.sections[].lines (en CUALQUIER sección, especialmente financing) NUNCA contiene ítems cuyo label encaje en las frases prohibidas v2.4 ("Distribución de utilidades de periodos anteriores", "Pagos a propietarios asociados con utilidades", "Cancelación resultado acumulado", "Traslado utilidad ejercicio a 3605"). El validator E10 rechaza el reporte si las detecta. El traslado del resultado anterior (3605 → 33/37/31) es un movimiento interno del patrimonio: no genera renglón en ninguna sección.
- El EFE emitido coincide al centavo con el bloque "EFE VINCULANTE": subtotal de cada actividad, cashOpening, netChange y cashClosing (el validador E18 lo contrasta; cualquier diferencia sella el informe).
</success_criteria>

<constraints>
- MUST: anclar cashClosing, totalEquity y netIncome a los valores del bloque \`<previously_computed>\` (Pass-1 anchors). NO recalcular.
- MUST: MoneyCop serializado en CENTAVOS como string entero (sin separadores, sin decimales, sin signo de pesos).
- MUST: en el EFE TODA línea conserva su signo algebraico (\`isAbsolute=false\`) — un renglón que consume caja va en negativo. La presentación absoluta NO aplica aquí: el subtotal de cada sección es la suma algebraica de sus renglones, y volver absoluto un renglón negativo rompe esa suma. La regla de valor absoluto sigue vigente en el Balance y el P&G. En el ECP, las disminuciones de patrimonio conservan signo negativo.

- MUST: ecoar el valor "${ctx.reportMode}" del bloque "MODO DEL REPORTE" para coherencia narrativa (el campo \`reportMode\` root vive en Pass-1; aquí solo se usa para gobernar verbos y disclaimers).

- MUST: cashOpening = saldo PUC 11 al INICIO del periodo. NEVER asignar cashOpening = totalAssetsPrimary, totalAssetsComparative, totalLiabilitiesPrimary o cualquier total de balance. NEVER usar el saldo de Activos como proxy de Caja. If el preprocessor no expone cashOpening directo en \`<previously_computed>\` then computar: cashOpening = cashClosing − netChange, donde netChange = Σ flujos netos de las 3 secciones (operating+investing+financing).

- MUST: $0 huérfanos en EFE/ECP (§1.2 spec v8.1). If una línea del EFE o ECP tiene \`amountPrimary="0"\` Y (\`amountComparative="0"\` O \`null\`) Y NO existe nota explicativa, OMITIR la línea. Else if el cero refleja un hecho material (ej. "Sin distribución de dividendos por decisión de asamblea") MANTENER + nota citando norma.

- NEVER escribir cifras del periodo comparativo en el EFE ni filas del ECP de ese periodo: \`amountComparative=null\` en todos los renglones de cashFlow.sections. Esas cifras son una proyección del balance de prueba que calcula el código (NIIF para las PYMES 3.14); una cifra comparativa del modelo en el EFE se descarta.

- MUST: TODA política contable elegida, TODA presentación lleva cita normativa entre paréntesis (§1.4 spec v8.1: NIC 7, párrafo X / NIIF para PYMES, Sección 7.Y / NIC 1, párrafo Z). Sin cita, sin afirmación.

- Si un dato falta, escribir "— (dato no suministrado)" o N/D con el motivo concreto en methodNote o equityChanges.notes. La impracticabilidad sólo se cita cuando está acreditada (bloque "Regla R1").
- NEVER inventar saldos del periodo comparativo: si comparativosImpracticables=true, amountComparative=null en todas las líneas.
- NEVER mezclar nombres singular/plural en Cambios en Capital de Trabajo. Singular (\`varCuentaPorCobrar\`, \`varInventario\`) es INVÁLIDO; PROHIBIDO.

- NEVER en methodNote ni equityChanges.notes: "Élite", "Excelencia", "Premium", "Excepcional", "Único", "Mejor", "Sólido", "Robusto", "Extraordinario", "Sin precedentes", "De clase mundial" (§1.6 spec v8.1).

- If reportMode='LINEA_BASE' then NEVER usar en methodNote ni equityChanges.notes verbos comparativos: "mejoró", "creció", "aumentó", "se redujo", "evolucionó", "varió respecto a", "incrementó", "disminuyó", "se contrajo". Usar en su lugar verbos de estado: "establece", "documenta", "constituye", "declara", "registra", "presenta".
  If reportMode='TRANSICION' then verbos comparativos SÓLO en líneas con comparativo disponible.

- CRÍTICO — Asiento 3605 (cierre contable) NUNCA en el Estado de Flujos de Efectivo (Corrección 2 spec v2.1 + Corrección v2.4).

  REGLA ABSOLUTA: el traslado de utilidad a la cuenta 3605 (asiento de cierre) es un movimiento PURAMENTE CONTABLE. NO representa flujo de efectivo bajo ninguna circunstancia. NEVER incluirlo en cashFlow.sections — ni en operating, ni en investing, ni en financing.

  PROHIBIDO LITERAL — frases que NUNCA pueden aparecer en cashFlow.sections[].lines[].label (en ninguna sección):
  - "Distribución de utilidades de periodos anteriores"
  - "Distribución/cancelación resultado acumulado YYYY"
  - "Pagos a propietarios asociados con utilidades"
  - "Cancelación resultado acumulado"
  - "Traslado utilidad ejercicio a 3605"
  - Cualquier otra referencia al asiento contable de cierre de Cta.3605 dentro de cashFlow.

  Estos ítems SOLO pueden ir en \`cashFlow.sections[financing].lines\` con evidencia REAL de pago en efectivo a socios (acta de distribución de dividendos + comprobante de egreso bancario). Sin esa evidencia → el ítem NO va en el EFE.

  REMEDIACIÓN — si el EFE NO cuadra (cashClosing != cashOpening + netChange):

    1. If el bloque "EFE VINCULANTE" está en el \`<context>\` then el EFE cuadra copiándolo: sus renglones ya incluyen TODA partida del periodo (utilidad neta, gasto no monetario, capital de trabajo, inversión, obligaciones financieras y el flujo con socios que deduce el patrimonio; los traslados internos del patrimonio ya están neteados). No falta nada por añadir y no sobra nada por quitar. Si al copiarlo no cuadra, el error está en la copia — revísala contra el bloque, cifra por cifra.

    2. Else (no hay bloque vinculante) emitir cashFlow.degeneracyFlag = 'indirect_method_unreliable' con methodNote literal de limitación al alcance (NIC 7, párrafo 18 + NIA 705).

  PROHIBIDO ajustar las variaciones de capital de trabajo —ni su magnitud ni su signo— para hacer cuadrar el EFE. Esas cifras salen del balance de prueba: moverlas para forzar un cuadre es fabricar un estado financiero. Un EFE que no cuadra se declara; no se acomoda.

  NEVER usar el asiento 3605 como "comodín" en financing para hacer cuadrar el EFE. NEVER crear flujos ficticios de financiación. La sección financing solo acepta lo que el balance prueba y el bloque "EFE VINCULANTE" trae: obligaciones financieras (grupos 21/29), el movimiento de la 2360 y el flujo con socios deducido del patrimonio (aportes, o distribuciones pendientes de soporte). La apropiación de reservas y la capitalización de utilidades NO son flujos (NIC 7 ¶43): se revelan en methodNote. Sin sustento en el bloque no hay línea de dividendos — ni "estimados", ni "presuntos", ni "inferidos".

- MUST: la PRIMERA línea de cashFlow.sections.find(s => s.section==='operating').lines DEBE tener amountPrimary === netIncomePrimary (anchor Pass-1) al centavo. Label aceptado: "Utilidad neta del ejercicio" / "Resultado neto del período" / "Utilidad neta del período" (anclado al P&L). PROHIBIDO usar como primer ítem cualquiera de: "Δ 3605", "Movimiento 3605", "Variación utilidades acumuladas", "3605-movimiento-periodo", "Incremento utilidades retenidas".

- CRÍTICO — ECP traslado a 3605: usar saldo REAL de la cuenta, NO utilidad P&L (Corrección 5 spec v2.1).

  REGLA: el ECP debe usar el saldo REAL de la cuenta 3605 del balance, NO la utilidad del Estado de Resultados. Pueden diferir por el tratamiento de la Cta.3710 (convergencia NIIF — naturaleza débito/crédito distinta).

  Cálculo correcto del traslado en equityChanges.rows:
    saldo3605 = totalEquityPrimary − saldoCta3710

    Donde:
    - totalEquityPrimary viene del anchor Pass-1 (\`<previously_computed>\`, vinculante).
    - saldoCta3710 viene de \`preprocessed.primary.classes['37']\` (capital convergencia NIIF) o equivalente expuesto por el orquestador.

  Para emitir el ECP:
  - INCORRECTO: equityChanges.rows[closing_balance].resultadoEjercicio = netIncomePrimary directo.
  - CORRECTO: equityChanges.rows[traslado].resultadosAcumulados = saldo3605 (calculado arriba).

  If saldo3605 == netIncomePrimary (tolerancia $0 al centavo) then proceed normal — no hay efecto Cta.3710.
  Else if saldo3605 != netIncomePrimary then la diferencia se atribuye a Cta.3710 (convergencia NIIF). Documentar en equityChanges.notes citando NIC 1, párrafo 106 + Decreto 2420/2015 (transición NIIF) y emitir el monto del saldo3605 explícitamente en la fila de traslado.

- EFE degenerado (§5 Slide 08 spec v8.1). If el EFE Indirecto produciría >=6 líneas con monto "0" en cashFlow.sections[].lines (típicamente por ausencia de auxiliares de variaciones de capital de trabajo — el balance solo expone saldos agregados sin movimientos) then poblar \`cashFlow.degeneracyFlag = 'indirect_method_unreliable'\` y emitir methodNote LITERAL: "EFE Método Indirecto no computado por ausencia de auxiliares de variaciones de capital de trabajo. Variación neta de caja como dato único defensible (cashClosing − cashOpening). NIC 7, párrafo 18 + NIA 705 — limitación al alcance." Else \`cashFlow.degeneracyFlag = 'none'\` y construir EFE Indirecto completo.

EFE Método Indirecto — FUENTE ÚNICA: el bloque "EFE VINCULANTE" del \`<context>\`, que es el mismo EFE determinista que TOTALES VINCULANTES resume en la sección "EFE DETERMINISTA" (el EFE del curator R2 ya no se publica como cifra vinculante). Ninguna otra cifra de flujo de efectivo es vinculante y no existen "dividendos estimados" (NIC 7 ¶43). Cita "NIC 7, párrafo 18(b) / NIIF para PYMES, Sección 7.7-7.8" en cashFlow.methodNote.

If la sección "EFE DETERMINISTA" de TOTALES VINCULANTES dice "no es calculable" (balance sin periodo comparativo) then NO presentes flujos por actividades, dividendos ni ajustes de cierre: la única cifra defendible es el efectivo al cierre (PUC 11) y methodNote declara que sin saldo de apertura el EFE por método indirecto no es calculable (NIC 7 ¶1).

If existe el bloque "EFE VINCULANTE" then NO agregar ninguna línea de ajuste de cierre (\`cashFlowClosureAdjustment\`, "Variaciones en Capital de Trabajo (ajuste de cierre)" o equivalente): el bloque ya se reconcilia contra el PUC 11 (o declara su brecha de reconciliación) y añadir una línea rompería la suma de la sección. Else if hay periodo comparativo Y TOTALES VINCULANTES contiene la sección "Cierre de Flujo de Efectivo aplicado (Curator R6)" con brecha ≠ 0 then incluir una línea LITERAL "Variaciones en Capital de Trabajo (ajuste de cierre)" dentro de cashFlow.sections[operating].lines con el monto y signo de esa sección (R6 sólo absorbe redondeo de hasta $1), sumarla al netFlow de la sección, y describirla en cashFlow.methodNote citando NIC 7, párrafo 45 ("Se registró un ajuste de redondeo de \$X para reconciliar el EFE con PUC 11") otherwise (sin comparativo el EFE no es calculable y R6 no registra ajuste) no hay línea de ajuste; cashClosing se copia desde controlTotals.efectivoCuenta11.

- CRÍTICO — ECP MATRICIAL v2.5 (Corrección 14 spec v2.5 — cuadre opening + Σ movement rows = closing al centavo).

  REGLA ABSOLUTA: equityChanges.rows SIEMPRE construye la matriz como una secuencia explícita de movimientos. PROHIBIDO presentar un ECP de dos filas (solo opening + closing) cuando hay utilidad del período material o cuando opening_balance arrastra resultado del periodo prior.

  Filas obligatorias (orden cronológico):

    1) kind="opening_balance" — saldo inicial. Si opening_balance.resultadoEjercicio NO es cero, ese saldo corresponde a la utilidad del periodo prior arrastrada en PUC 3605 porque el asiento de cierre Dr.3605/Cr.3705 NO se booked al cierre prior (situación común en SAS colombianas donde PUC 3605 se "sobreescribe" anualmente sin traslado).

    2) kind="prior_period_result_cancellation" (CONDICIONAL — incluir SOLO cuando |opening_balance.resultadoEjercicio| > $1.000.000 COP).
       - label: "Traslado del resultado [AÑO_PRIOR] a resultados acumulados"
       - capitalSocial, primaColocacion, reservaLegal, otrasReservas, ori = "0"
       - resultadoEjercicio = -opening_balance.resultadoEjercicio
       - resultadosAcumulados = +opening_balance.resultadoEjercicio (el mismo monto con signo contrario)
       - total = "0"
       Es un traslado interno del patrimonio (Dr 3605 / Cr 37): no cambia el patrimonio total, no es distribución y no genera flujo de efectivo. Si el patrimonio disminuyó más de lo que explica el resultado, esa disminución va en una fila kind="dividend_distribution" con la cifra del bloque "Distribución a socios" (pendiente de soporte) o, si el bloque la declara partida no conciliada, en kind="convergence_adjustment" con label "Partida patrimonial no conciliada — requiere explicación del contador". Nunca se esconde dentro del traslado.

    3) kind="profit_for_period" (OBLIGATORIA SIEMPRE — autoritativa).
       - label aceptado: "Resultado del ejercicio [AÑO_ACTUAL]" / "Utilidad neta del periodo" / "Resultado neto del período"
       - resultadoEjercicio = netIncomePrimary del Pass-1 anchor (centavos como string, al centavo)
       - total = mismo valor (signo coherente con netIncomePrimary)
       - resto de columnas = "0"

    4) Otras filas de movimiento condicionales (capital_contribution, dividend_distribution, reserve_appropriation, other_comprehensive_income, convergence_adjustment) — incluir cuando los datos las sustenten.

    5) kind="closing_balance" — saldo final. closing_balance.total == totalEquityPrimary del Pass-1 anchor; closing_balance.resultadoEjercicio == netIncomePrimary del Pass-1 anchor; demás columnas se construyen sumando opening + movement rows en cada columna.

  CHECK pre-emisión OBLIGATORIO (ejecutar ANTES de devolver el JSON, columna a columna):
    Para cada col ∈ {capitalSocial, primaColocacion, reservaLegal, otrasReservas, resultadosAcumulados, resultadoEjercicio, ori, total}:
      Σ filas_no_closing[col] ?= closing_balance[col]    (tolerancia $0)
    Y además:
      fila profit_for_period.resultadoEjercicio ?= netIncomePrimary    (tolerancia $0)
      |opening_balance.resultadoEjercicio| > $1M ⇒ fila prior_period_result_cancellation.resultadoEjercicio ?= -opening_balance.resultadoEjercicio y su total = 0    (tolerancia $0)
      opening_balance.total ?= totalEquityComparative    (tolerancia $0, cuando existe)
    Si cualquiera falla → NO emitir el ECP; ajustar montos hasta cuadrar.

  NOTA TÉCNICA OBLIGATORIA en equityChanges.notes cuando se incluye la fila prior_period_result_cancellation:
    title: "Traslado del resultado del periodo anterior a resultados acumulados"
    body (sustituir [AÑO_PRIOR] por el año real): "La fila 'Traslado del resultado [AÑO_PRIOR] a resultados acumulados' refleja el traslado del resultado del período anterior desde la cuenta PUC 3605 a resultados de ejercicios anteriores (PUC 37). Es un movimiento interno del patrimonio: no modifica el patrimonio total, no es distribución de dividendos ni devolución de aportes y no genera flujo de efectivo (NIIF para PYMES, Sección 6; Decreto 2420 de 2015, Anexo 2)."

  PROHIBIDO ABSOLUTO:
  - Emitir un ECP de 2 filas (solo opening + closing) cuando hay utilidad del período material.
  - Inferir el resultado del ECP del delta closing.resultadoEjercicio − opening.resultadoEjercicio — la fila profit_for_period es la fuente autoritativa.
  - Usar kind="dividend_distribution" para el traslado del resultado prior (el traslado no es distribución de dividendos; una distribución real sí va en dividend_distribution, con su cifra y soporte).
  - Usar kind="convergence_adjustment" para la cancelación del resultado prior (convergence_adjustment es para R5/Cta.3710 NIIF, no para 3605).

If TOTALES VINCULANTES contiene \`equityAnchorAdjustment\` ≠ 0 (curatorFlags.equityConvergenceApplied=true) then insertar una fila ECP con kind=convergence_adjustment y resultadosAcumulados=ese monto (con su signo) como ANTEÚLTIMA fila antes de closing_balance, y emitir equityChanges.notes con la sub-nota Defensa Art. 647 E.T. citando NIC 1, párrafo 106 otherwise el ECP cuadra sin línea de ajuste.

If isComparative=true Y existe \`preprocessed.comparative.equityBreakdown\` then opening_balance del ECP toma SUS cifras (capital, superávit, reservas, resultadosAcumulados) y closing_balance compone las cifras del Pass-1 anchor (totalEquityPrimary) otherwise opening_balance.total=0 con kind=opening_balance y una nota en equityChanges.notes explicando la ausencia de comparativo (cite NIIF para PYMES, Secciones 3.14 y 10.21 si comparativosImpracticables=true).

cashFlow.sections[].lines llevan amountComparative=null y equityChanges.rows describe sólo el periodo actual, haya o no comparativo: la columna comparativa del EFE y el ECP del periodo comparativo los adjunta el código (o su nota de comparativo no presentado).

Los ajustes automáticos del curator que afecten EFE o ECP (R5 convergencia patrimonial, R6 ajuste de cierre EFE) se describen en equityChanges.notes o cashFlow.methodNote con el concepto, la norma NIIF y el papel de trabajo de origen. La mención al Art. 647 E.T. vive en una sola nota de Pass-3 (Corrección 9 spec v2.1).
</constraints>

<previously_computed>
${renderPass1AnchorsBlock(pass1Anchors)}
</previously_computed>

<context>
${renderCompanyBlock(ctx)}

${renderReportModeBlock(ctx)}

${renderComparativeModeBlock(ctx)}

${renderImpracticabilityBlock(ctx)}

${renderEfeAuthoritativeBlock(ctx)}

${renderPresentationV3AnchorsBlock(ctx)}

${ctx.hechosEmpresa}

${ctx.langInstruction}
</context>`;
}

// ===========================================================================
// PASS 3 — Notas técnicas globales (consume Pass-1 y Pass-2 anchors)
// ===========================================================================

/**
 * Builder del prompt de Pass-3 del Agente NIIF Analyst (chunked).
 *
 * Schema esperado: `TechnicalNotesSubSchema`.
 *
 * Salida del modelo:
 *   - `technicalNotes` (reclasificaciones, impracticabilidades, mapping PUC,
 *     verdad financiera condicionada, IFRS 18 prep, Nota Maestra Defensa
 *     Art. 647 E.T., etc.).
 *
 * Pass-3 NO produce cifras nuevas — cita anchors literales de Pass-1 y
 * Pass-2 vía `<previously_computed>`. Los activadores Élite (R1, R5, R6,
 * R7, Regla R3.b, Regla R4) se inyectan SOLO cuando aplican, para mantener
 * el prompt mínimo.
 */
export function buildNiifAnalystPass3Prompt(
  company: CompanyInfo,
  language: 'es' | 'en',
  reportMode: ReportMode,
  pass1Anchors: PreviouslyComputedPass1Anchors,
  pass2Anchors: PreviouslyComputedPass2Anchors,
  preprocessed?: PreprocessedBalance,
  elite?: NiifAnalystEliteContext,
): string {
  const ctx = buildSharedContext(company, language, reportMode, preprocessed, elite);

  // Activadores Élite — sólo los que aplican entran al <context>.
  const eliteActivators: string[] = [];
  if (ctx.comparativosImpracticables === true) {
    eliteActivators.push(`- Regla R1 (Impracticabilidad NIC 1): comparativo del periodo ${ctx.comparativePeriod ?? '(anterior)'} declarado IMPRACTICABLE.`);
  }
  if (pass1Anchors.curatorFlags.equityConvergenceApplied) {
    eliteActivators.push('- R5: convergencia patrimonial aplicada (NIC 1, párrafo 106).');
  }
  if (pass1Anchors.curatorFlags.cashFlowClosureForced) {
    eliteActivators.push('- R6: ajuste de cierre EFE aplicado (NIC 7, párrafo 45).');
  }
  if (pass1Anchors.curatorFlags.negativeAssetReclassified) {
    eliteActivators.push('- R1: reclasificación de saldo negativo en Activo a Pasivo (NIC 1, párrafo 32 — no compensación).');
  }
  if (pass1Anchors.curatorFlags.presumedCostWarning) {
    eliteActivators.push('- R7: costo presumido — advertencia sobre métricas de rentabilidad.');
  }
  if (ctx.tieneAnticipoRentaMaterial) {
    eliteActivators.push('- Regla R3.b (renta neto-bruto): retenciones y anticipos de renta (1355/1805) materiales — presentación neto-bruto.');
  }
  if (ctx.reclasifNoComp.length > 0) {
    eliteActivators.push(`- Regla R4 (No compensación, NIC 1, párrafo 32): ${ctx.reclasifNoComp.length} reclasificación(es) detectada(s).`);
  }
  if (ctx.tieneSaldoAFavor) {
    eliteActivators.push('- Regla R3 (Saldo a favor): saldo a favor del impuesto separado en Activos.');
  }

  const eliteActivatorsBlock = eliteActivators.length > 0
    ? `## Activadores de Reglas R (sólo las reglas activas para este reporte)
${eliteActivators.join('\n')}`
    : '';

  return `${buildAbsoluteRulesAgente1(language)}

${ctx.guardrail}

${ctx.resilience0}

${ctx.presentationV3}

${ctx.context2026}

${ctx.niifMeasurement}

${ctx.niifDisclosures}

<task>Emitir las Notas Técnicas globales del reporte NIIF de ${company.name} (NIT ${company.nit}) bajo ${ctx.niifFramework}, devolviendo JSON validado contra TechnicalNotesSubSchema con notas que citen las cifras vinculantes ya computadas en Pass-1 + Pass-2.</task>

<success_criteria>
- Cuando aplique cualquier ajuste curator, UNA SOLA nota al FINAL de technicalNotes con label "Criterios contables aplicados y soporte" que describe los criterios y su soporte documental (Corrección 9 spec v2.1, enmendada). Máximo 1 nota de este tipo en todo el reporte.
${ctx.comparativosImpracticables === true ? '- Nota de impracticabilidad (NIIF para PYMES, Secciones 3.14 y 10.21) presente.' : '- Sin nota de impracticabilidad (comparativo disponible o no declarado).'}
${ctx.isGroup1 ? '- Nota de preparación voluntaria NIIF 18 sólo si es material (Grupo 1; la NIIF 18 no está incorporada en Colombia a la fecha del ejercicio).' : `- IFRS 18 NUNCA mencionada (la entidad pertenece al Grupo ${company.niifGroup ?? 2}; mencionarla activa el blocker V8 del gate auditReportEmittable).`}
${ctx.actividadInferida && ctx.actividadInferida.sectorCIIU.startsWith('G') ? '- Si margen bruto > 80% (derivable de los anchors P&L): nota "verdad financiera condicionada" citando NIIF para PYMES, Sección 13.20 + NIA 705.' : ''}
- Notas de mapeo PUC, reclasificaciones e impracticabilidades cuando apliquen.
- If alguna nota Anomalía A1..A8 fue emitida en Pass-1 then technicalNotes incluye SECCIÓN dedicada "Anomalías e Inconsistencias Detectadas" agrupando las notas (consolidación para el lector ejecutivo).
- If reportMode ∈ {'LINEA_BASE', 'TRANSICION'} then technicalNotes incluye al FINAL una nota dedicada con label LITERAL "Limitaciones de Información" agrupando los disclaimers automáticos aplicables (§8 spec v8.1). Esta sección AUMENTA credibilidad, no la disminuye — explicita el alcance de la información usada y el porqué de los n/c.
- If totalEquityPrimary (anchor Pass-1) < 0 then technicalNotes DEBE incluir nota dedicada con label "Hipótesis de Empresa en Marcha" citando la NIC 1, párrafos 25-26 (NIIF para PYMES, Sección 3.8-3.9), la NIA 570, el art. 4 de la Ley 2069 de 2020 y el Decreto 1378 de 2021, describiendo: (a) la situación de patrimonio negativo, (b) la causa probable (pérdidas acumuladas materiales), (c) el deber de los administradores de abstenerse de iniciar nuevas operaciones distintas de las necesarias para la conservación del negocio y de convocar al máximo órgano social para evaluar la continuidad de la empresa con los indicadores del Decreto 1378 de 2021. No se ordena una disolución automática: la causal de los Arts. 457 num. 2 y 459 C.Co. fue derogada por la Ley 2069 de 2020.
</success_criteria>

<constraints>
- MUST: TODAS las notas citan cifras LITERALMENTE desde el bloque \`<previously_computed>\` (Pass-1 + Pass-2 anchors). NO recalcular ni inventar números.
- MUST: los montos citados dentro de una nota van en pesos con formato es-CO ($4.196.558.242,90), copiados de la representación legible de \`<previously_computed>\`; nunca en centavos (REGLA 3).

- MUST: ecoar el valor "${ctx.reportMode}" del bloque "MODO DEL REPORTE" para coherencia narrativa (el campo \`reportMode\` root vive en Pass-1; aquí solo se usa para gobernar verbos y la sección "Limitaciones de Información").

- MUST: TODA política contable referenciada, TODA conclusión técnica, TODA cita lleva referencia normativa entre paréntesis (§1.4 spec v8.1: NIIF Pymes Sec. X / IAS Y / NIC Z / Art. E.T. / Ley X / NIA W). Sin cita, sin afirmación.

- MUST: si reportMode != 'LINEA_BASE' Y \`comparativosImpracticables\` != true Y los anchors comparativos (totalAssetsComparative, totalLiabilitiesComparative, totalEquityComparative, netIncomeComparative, oriComparative) en \`<previously_computed>\` están disponibles (no "N/A"), las notas que citen cifras DEBEN incluir el valor comparativo cuando exista. NUNCA omitir silenciosamente el periodo comparativo en notas de variación.

- Si un dato falta, escribir "— (dato no suministrado)" o N/D con el motivo concreto. La impracticabilidad (NIIF para PYMES, Secciones 3.14 y 10.21; NIC 8.5) sólo se cita cuando está acreditada (bloque "Regla R1").

- NEVER citar en una nota cifras de dividendos, distribuciones o pagos a socios que no estén en el bloque "Distribución a socios" del \`<context>\`. Si ese bloque indica que no hay evidencia contable de distribución, las notas dicen exactamente eso ("no hay evidencia contable de distribución distinta de la variación de resultados acumulados") sin afirmar ni negar pagos que el balance no muestra, y sin cifras "estimadas", "presuntas", "inferidas" o "implícitas" (NIC 7 ¶43). Si el bloque indica una distribución pendiente de soporte o una partida no conciliada, la nota la revela con esa cifra y el soporte que falta.

- NEVER en notas, labels ni body: "Élite", "Excelencia", "Premium", "Excepcional", "Único", "Mejor", "Sólido", "Robusto", "Extraordinario", "Sin precedentes", "De clase mundial" (§1.6 spec v8.1 — prohibición vocabulario marketing). El registro narrativo es technico-contable, no comercial.

- NEVER en technicalNotes (Corrección 7 spec v2.1 — eliminación de notas internas):
  - Sección "Notas internas del preparador" o cualquier variante (ej. "Notas del modelo", "Notas internas", "Apuntes del sistema").
  - Notas marcadas "(NO incluir en EEFF firmables)" o "(uso interno)".
  - Advertencias internas de valoración del modelo (auto-evaluaciones de confianza, comentarios sobre el reasoning del LLM).
  - Metadata del sistema de procesamiento interno (Pass-1, Pass-2, Pass-3, anchors, curatorFlags como nombres literales en notas, netIncomePrimary, etc. — son nombres internos, NO van al cliente).
  - Comentarios sobre el proceso de generación (ej. "Esta nota fue generada por...", "El modelo determinó...", "Se aplicó la regla R5...").

  Las limitaciones reales del informe van EXCLUSIVAMENTE en:
  - Sección "Limitaciones de Información" (al final, una sola vez si reportMode != 'COMPARATIVO_COMPLETO').
  - Notas técnicas NIIF cuando aplique (brevemente; la impracticabilidad sólo cuando está acreditada).

- If reportMode='LINEA_BASE' then NEVER usar en technicalNotes verbos comparativos: "mejoró", "creció", "aumentó", "se redujo", "evolucionó", "varió respecto a", "incrementó", "disminuyó", "se contrajo". Usar en su lugar verbos de estado: "establece", "documenta", "constituye", "declara", "registra", "presenta".
  If reportMode='COMPARATIVO_COMPLETO' then verbos comparativos PERMITIDOS y esperados.
  If reportMode='TRANSICION' then verbos comparativos SÓLO en notas que referencien líneas con comparativo disponible (no n/c).

- Limitaciones de Información (§8 spec v8.1). If reportMode='LINEA_BASE' OR reportMode='TRANSICION' then technicalNotes DEBE cerrar con una nota dedicada con label LITERAL "Limitaciones de Información" agrupando los 6 disclaimers automáticos aplicables (numerados 1..6 abajo) que se activaron por condición. Estructura sugerida: introducción explicativa ("Las siguientes limitaciones acotan el alcance de la información presentada y explicitan los criterios de prudencia aplicados, conforme NIIF for SMEs §3.14 y §10.21") + bullet list de disclaimers activos + cierre normativo (NIIF). Esta sección AUMENTA credibilidad técnica del reporte. Else (COMPARATIVO_COMPLETO) emitir SOLO los disclaimers numerados como notas separadas, sin agrupación bajo "Limitaciones de Información".

${ctx.isGroup1
  ? 'Preparación NIIF 18 (Grupo 1, voluntaria): si es material, UNA nota técnica que aclare que la NIIF 18 fue emitida por el IASB (vigencia internacional 01-01-2027) y no está incorporada al DUR 2420 a la fecha del ejercicio, con (i) mapeo preliminar del P&G a las categorías operación / inversión / financiación; (ii) medidas de rendimiento candidatas con conciliación; (iii) brechas de datos. Marcar como "preparación voluntaria, sin impacto contable en 2026"; no afirmes una fecha de obligatoriedad en Colombia.'
  : `IFRS 18 NO APLICA — PROHIBIDO MENCIONARLA. La entidad pertenece al Grupo ${company.niifGroup ?? 2}. La NIIF 18 no está incorporada en Colombia a la fecha del ejercicio y no aplica a esta entidad. Si se cita, el gate auditReportEmittable rechaza el informe (blocker V8).`}

If comparativosImpracticables=true then technicalNotes incluye la nota LITERAL de impracticabilidad: "Los estados financieros se presentan sin comparativos del periodo ${ctx.comparativePeriod ?? 'anterior'} dado que la información necesaria para reconstruirlos resultó impracticable de obtener (NIIF para PYMES, Secciones 3.14 y 10.21). La administración de la entidad efectuó esfuerzos razonables para obtener la información comparativa y documentó las gestiones realizadas." otherwise omitir.

If actividadInferida.sectorCIIU empieza con "G" (Comercio) Y margen bruto > 80% (Utilidad Bruta / ingresos operacionales netos del bloque CASCADA VINCULANTE DEL P&G; el grupo 42 no entra en el margen bruto) then emitir technicalNotes con la nota "verdad financiera condicionada" citando NIIF para PYMES, Sección 13.20 + NIA 705 otherwise omitir.

If reclasifNoComp.length > 0 (Regla R4 — No compensación, NIC 1, párrafo 32) then emitir technicalNotes con una nota DEDICADA (NIIF para PYMES, Sección 2.52 + NIC 1, párrafo 32), listando cuenta_origen, saldo_invertido, cuenta_destino_pasivo, motivo_norma por cada reclasificación otherwise omitir.

If curatorFlags.negativeAssetReclassified=true (R1) then emitir technicalNotes con Nota de Reclasificación (NIC 1, párrafo 32 — no compensación), citando reclassifiedAmountCop del Pass-1 anchor otherwise omitir.

**Nota única de criterios contables (Corrección 9 spec v2.1, enmienda del 2026-09-24).**

If CUALQUIER ajuste curator se aplicó (curatorFlags.equityConvergenceApplied OR curatorFlags.cashFlowClosureForced OR curatorFlags.negativeAssetReclassified OR curatorFlags.presumedCostWarning OR ctx.tieneAnticipoRentaMaterial OR ctx.reclasifNoComp.length > 0) then emitir UNA SOLA nota al FINAL de technicalNotes con label "Criterios contables aplicados y soporte" que describa, para cada ajuste aplicado, el criterio del marco técnico NIIF usado, la norma que lo sustenta y el soporte documental disponible (papel de trabajo o hallazgo). La nota NO afirma que la DIAN no sancionará ni que una diferencia "no es sancionable", NO cita doctrina que no esté en los datos, y menciona el Art. 647 E.T. solo respecto de declaraciones tributarias (la exclusión de inexactitud por interpretación razonable exige hechos y cifras completos y verdaderos en la declaración); las reclasificaciones de presentación NIIF no modifican ninguna declaración.

PROHIBIDO emitir más de una nota de este tipo.

If NINGÚN ajuste curator se aplicó then NO emitir esta nota.

Disclaimers Automáticos (Parte 9 spec v2.0 — 6 items condicionales).
Para CADA condición real detectada en preprocessed o anchors, technicalNotes DEBE incluir el disclaimer LITERAL correspondiente. NO inventar disclaimers que no apliquen:

1. If preprocessed.classes['25'] no tiene auxiliares O su saldo total < $100.000 then disclaimer "No se suministró detalle de obligaciones laborales; rubro excluido del análisis de pasivos."
2. If (costoVentas6 + costoProduccion7) < 0.01 × ingresos then disclaimer "Costo de ventas insuficiente para calcular días de inventario y ciclo operativo con precisión económica."
3. If Anomalía A5 (brecha impuesto) detectada then disclaimer "Impuesto de renta registrado no permite reconstruir conciliación fiscal; cifra usada es la contable."
4. If no isComparative (single period) then disclaimer "Sin datos comparativos del año anterior; análisis de tendencias y algunos KPIs no disponibles."
5. If curatorFlags.equityConvergenceApplied O cashFlowClosureForced O negativeAssetReclassified then disclaimer "Ajuste 3605 aplicado automáticamente para efectos de presentación; no ha sido validado por el contador responsable."
6. If Anomalía A3 (Clase 12 < 0) detectada then disclaimer "Inversiones en asociadas presentan saldo negativo; requiere revisión documental antes de publicar."

NOTA — reconciliación con la regla "NEVER 'no se suministró información'": la prohibición es sobre frases EVASIVAS genéricas (sin contexto / sin cita normativa). Los 6 disclaimers arriba son CALIFICADOS (atados a rubro contable concreto + condición auditable) y por lo tanto AUTORIZADOS — no son evasivos. Si la condición no aplica, OMITIR el disclaimer (no emitirlo vacío).
</constraints>

<previously_computed>
${renderPass1AnchorsBlock(pass1Anchors)}

${renderPass2AnchorsBlock(pass2Anchors)}
</previously_computed>

<context>
${renderCompanyBlock(ctx)}

${renderReportModeBlock(ctx)}

${renderComparativeModeBlock(ctx)}

${renderImpracticabilityBlock(ctx)}

${eliteActivatorsBlock}

${renderAnticipoRentaBlock(ctx)}

${renderReclasifNoCompBlock(ctx)}

${renderSaldoAFavorBlock(ctx)}

${renderActividadInferidaBlock(ctx)}

${renderDividendEvidenceBlockForNotes(ctx)}

${renderPresentationV3AnchorsBlock(ctx)}

${ctx.hechosEmpresa}

${ctx.langInstruction}
</context>`;
}

// ===========================================================================
// LEGACY WRAPPER (deprecated 2026-05-12)
// ===========================================================================

/**
 * @deprecated 2026-05-12 — usa `buildNiifAnalystPass1Prompt`,
 * `buildNiifAnalystPass2Prompt` o `buildNiifAnalystPass3Prompt` según el
 * pass del agente chunked.
 *
 * Preservado como wrapper que delega a Pass-1 para mantener retrocompat con
 * el caller único (`src/lib/agents/financial/agents/niif-analyst.ts`) hasta
 * que Worker B ejecute la Fase 3.D (orquestación chunked del agent).
 *
 * Why: default `reportMode='COMPARATIVO_COMPLETO'` preserva el comportamiento
 * legacy del wrapper (asumir comparativo completo); el chunked runner
 * (`runNiifAnalyst`) pasa el valor real derivado por `deriveReportMode`.
 */
export function buildNiifAnalystPrompt(
  company: CompanyInfo,
  language: 'es' | 'en',
  preprocessed?: PreprocessedBalance,
  elite?: NiifAnalystEliteContext,
  reportMode: ReportMode = 'COMPARATIVO_COMPLETO',
): string {
  return buildNiifAnalystPass1Prompt(company, language, reportMode, preprocessed, elite);
}
