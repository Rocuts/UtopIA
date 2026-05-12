// ---------------------------------------------------------------------------
// System prompt — Agente 1: Analista Contable NIIF (outcome-first GPT-5.4)
// ---------------------------------------------------------------------------
// Refactor Fase 3.C (2026-05): split del prompt monolítico en TRES builders,
// uno por pass del agente chunked. Cada builder mantiene los 4 headers
// cache-friendly (anti-hallucination + colombia-2026 + niif-measurement +
// niif-disclosures) para maximizar el prompt-cache hit rate de GPT-5.4.
//
// Justificación (CLAUDE.md "Pending: Fase 3 — Chunked Schema (NIIF Report)"):
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
import { buildAntiHallucinationGuardrail } from './anti-hallucination';
import { buildColombia2026Context } from './colombia-2026-context';
import {
  buildNiifMeasurementKnowledge,
  buildNiifDisclosureKnowledge,
} from './niif-colombia-knowledge';

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
  context2026: string;
  niifMeasurement: string;
  niifDisclosures: string;
  primaryPeriod: string;
  comparativePeriod: string | null;
  isComparative: boolean;
  periodsListed: string;
  periodsCount: number;
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
  fmtCop: (cents: bigint | number) => string;
  company: CompanyInfo;
}

function buildSharedContext(
  company: CompanyInfo,
  language: 'es' | 'en',
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
  const context2026 = buildColombia2026Context(language);
  const niifMeasurement = buildNiifMeasurementKnowledge(language);
  const niifDisclosures = buildNiifDisclosureKnowledge(language);

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
  const comparativePeriod = preprocessed?.comparative?.period ?? null;
  const isComparative = periods.length >= 2 && !!primaryPeriod && !!comparativePeriod;
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

  const fmtCop = (cents: bigint | number): string => {
    const n = typeof cents === 'bigint' ? Number(cents) / 100 : cents;
    return n.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return {
    langInstruction,
    niifFramework,
    isGroup1,
    guardrail,
    context2026,
    niifMeasurement,
    niifDisclosures,
    primaryPeriod,
    comparativePeriod,
    isComparative,
    periodsListed,
    periodsCount: periods.length,
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
    fmtCop,
    company,
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
 * Bloque "MODO COMPARATIVO" — idéntico en los 3 pases.
 */
function renderComparativeModeBlock(ctx: SharedPromptContext): string {
  if (ctx.isComparative) {
    return `## MODO COMPARATIVO (${ctx.periodsCount} periodos detectados: ${ctx.periodsListed})
Los datos vienen etiquetados con \`[period=YYYY]\` por bloque. Cada StatementLine debe llenar amountPrimary (${ctx.primaryPeriod}) y amountComparative (${ctx.comparativePeriod}). El ECP arranca con kind=opening_balance (cifras de \`preprocessed.comparative.equityBreakdown\`) → movimientos del periodo → kind=closing_balance (cifras de \`preprocessed.primary.equityBreakdown\`).`;
  }
  if (ctx.periodsCount === 1) {
    return `## MODO SINGLE-PERIOD (${ctx.primaryPeriod})
Sin periodo comparativo: amountComparative=null en TODAS las líneas. NO inventar cifras.`;
  }
  return '';
}

/**
 * Bloque R-Élite 1 (impracticabilidad del comparativo) — aplicable a los 3
 * pases. En Pass-1 afecta amountComparative del Balance/P&L. En Pass-2,
 * mismo efecto en EFE/ECP. En Pass-3 dispara la nota literal.
 */
function renderImpracticabilityBlock(ctx: SharedPromptContext): string {
  if (ctx.comparativosImpracticables === true) {
    return `## R-Élite 1 — Impracticabilidad declarada del comparativo
El preprocesador determinó que el comparativo del periodo ${ctx.comparativePeriod ?? '(anterior)'} es IMPRACTICABLE de reconstruir. amountComparative=null en TODAS las líneas. technicalNotes DEBE incluir la nota literal: "Los estados financieros se presentan sin comparativos del periodo ${ctx.comparativePeriod ?? 'anterior'} dado que la información necesaria para reconstruirlos resultó impracticable de obtener (NIIF for SMEs §3.14, §10.21). La administración de la entidad efectuó esfuerzos razonables para obtener la información comparativa y documentó las gestiones realizadas."`;
  }
  if (ctx.comparativosImpracticables === false) {
    return `## Comparativo disponible
El Opening Balance del periodo ${ctx.comparativePeriod ?? '(anterior)'} está disponible — usar como columna comparativa en TODOS los estados.`;
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
| 4 — Ingresos | 41xx Operacionales, 42xx No operacionales | Ingresos |
| 5 — Gastos | 51xx Admin., 52xx Ventas | Gastos Operacionales |
| 6 — Costos | 61xx Costo de ventas, 62xx Compras, 63xx Producción | Costo de Ventas |
| 7 — Costos producción | 71xx-74xx MP, MOD, CIF | Costo de Producción |

Identidad de P&G: Utilidad Neta = Clase 4 (total) − Clase 6 (total) − Clase 5 (total) − Impuesto Renta.`;
}

/**
 * Bloque R-Élite 3.b — anticipo de renta material. Aplicable a Pass-1
 * (presentación neto-bruto en Balance + sub-nota Defensa Art. 647 E.T.)
 * y referenciado en Pass-3 (nota maestra).
 */
function renderAnticipoRentaBlock(ctx: SharedPromptContext): string {
  if (ctx.tieneAnticipoRentaMaterial && ctx.impuestoRentaNeto) {
    return `## R-Élite 3.b — Anticipo de renta material (valores autoritativos)
- PUC 2404 (Bruto Pasivo): $${ctx.fmtCop(ctx.impuestoRentaNeto.brutoPasivo2404)} COP.
- PUC 135515 (Anticipo Activo): $${ctx.fmtCop(ctx.impuestoRentaNeto.anticipoActivo135515)} COP.
- Neto a Pagar: $${ctx.fmtCop(ctx.impuestoRentaNeto.netoAPagar)} COP.
Citar LITERALMENTE en technicalNotes: "Conforme a NIC 12 §71 + NIIF for SMEs §29.29, el saldo del Impuesto de Renta corriente se presenta NETO en el Pasivo Corriente ($${ctx.fmtCop(ctx.impuestoRentaNeto.netoAPagar)}) por cuanto la entidad tiene el derecho legal exigible (Art. 855 E.T. — devolución del anticipo) y la intención de liquidar neto contra la DIAN. Bruto: $${ctx.fmtCop(ctx.impuestoRentaNeto.brutoPasivo2404)}. Anticipo: $${ctx.fmtCop(ctx.impuestoRentaNeto.anticipoActivo135515)}. Defensa Art. 647 E.T.: la presentación neto-bruto es estricta lectura técnica de la NIC 12; cualquier diferencia con liquidación DIAN configura diferencia de criterio no sancionable."`;
  }
  return '';
}

/**
 * Bloque R-Élite 4 — reclasificaciones No Compensación (Activo contranatura
 * que migra al Pasivo). Aplicable a Pass-1 (presentación) y referenciado en
 * Pass-3 (nota dedicada NIIF for SMEs §2.52 + NIC 1 §32).
 */
function renderReclasifNoCompBlock(ctx: SharedPromptContext): string {
  if (ctx.reclasifNoComp.length > 0) {
    return `## R-Élite 4 — Reclasificaciones No Compensación detectadas (${ctx.reclasifNoComp.length})
${ctx.reclasifNoComp.map((r) => `- ${r.cuenta_origen} → ${r.cuenta_destino_pasivo} | saldo invertido: $${ctx.fmtCop(r.saldo_invertido_centavos)} | norma: ${r.motivo_norma}`).join('\n')}`;
  }
  return '';
}

/**
 * Bloque R-Élite 3 — saldo a favor del impuesto separado en Activos.
 * Aplicable a Pass-1 y referenciado en Pass-3.
 */
function renderSaldoAFavorBlock(ctx: SharedPromptContext): string {
  if (ctx.tieneSaldoAFavor) {
    return `## R-Élite 3 — Saldo a favor del impuesto detectado
Saldo a favor (PUC 1355/1805): $${ctx.fmtCop(ctx.saldoAFavorCents!)} COP. Presentar SEPARADO dentro de balanceSheet.assets — NUNCA neteado contra el gasto del P&L.`;
  }
  return '';
}

/**
 * Bloque R-Élite 2 — valores autoritativos EFE indirecto (curator R2).
 * EXCLUSIVO de Pass-2 (Pass-1 no produce EFE; Pass-3 lo recibe como anchor).
 */
function renderEfeAuthoritativeBlock(ctx: SharedPromptContext): string {
  const hasAny =
    typeof ctx.efeVarCxC === 'number' ||
    typeof ctx.efeVarInv === 'number' ||
    typeof ctx.efeVarCxP === 'number';
  if (!hasAny) return '';
  const lines: string[] = [];
  if (typeof ctx.efeVarCxC === 'number') {
    lines.push(`- ΔCxC = ${ctx.efeVarCxC.toLocaleString('es-CO', { maximumFractionDigits: 2 })} (signo aplicado).`);
  }
  if (typeof ctx.efeVarInv === 'number') {
    lines.push(`- ΔInventarios = ${ctx.efeVarInv.toLocaleString('es-CO', { maximumFractionDigits: 2 })} (signo aplicado).`);
  }
  if (typeof ctx.efeVarCxP === 'number') {
    lines.push(`- ΔCxP = ${ctx.efeVarCxP.toLocaleString('es-CO', { maximumFractionDigits: 2 })} (signo aplicado).`);
  }
  return `## R-Élite 2 — Valores autoritativos de EFE indirecto (curator R2)
${lines.join('\n')}`;
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
 * Bloque `<previously_computed>` con anchors de Pass-1 (utilizado por Pass-2
 * y Pass-3). Se cita LITERALMENTE: el modelo no debe recalcular.
 */
function renderPass1AnchorsBlock(anchors: PreviouslyComputedPass1Anchors): string {
  return `## Anchors de Pass 1 (Balance + P&G — ya emitidos, no recalcular)
- totalAssetsPrimary: $${anchors.totalAssetsPrimary}
- totalLiabilitiesPrimary: $${anchors.totalLiabilitiesPrimary}
- totalEquityPrimary: $${anchors.totalEquityPrimary}
- netIncomePrimary: $${anchors.netIncomePrimary}
- oriPrimary: $${anchors.oriPrimary}

## curatorFlags (literal del orchestrator)
- equityConvergenceApplied: ${anchors.curatorFlags.equityConvergenceApplied}
- cashFlowClosureForced: ${anchors.curatorFlags.cashFlowClosureForced}
- negativeAssetReclassified: ${anchors.curatorFlags.negativeAssetReclassified}
- presumedCostWarning: ${anchors.curatorFlags.presumedCostWarning}
- reclassifiedAmountCop: $${anchors.curatorFlags.reclassifiedAmountCop}`;
}

/**
 * Bloque `<previously_computed>` con anchors de Pass-2 (utilizado por
 * Pass-3 únicamente). Cifras EFE/ECP autoritativas para componer notas.
 */
function renderPass2AnchorsBlock(anchors: PreviouslyComputedPass2Anchors): string {
  return `## Anchors de Pass 2 (EFE + ECP — ya emitidos, no recalcular)
- cashOpening: $${anchors.cashOpening}
- cashClosing: $${anchors.cashClosing}
- netChange: $${anchors.netChange}
- ecpClosingTotal: $${anchors.ecpClosingTotal}`;
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
 * a ajustes específicos del Balance/P&L (R1, R-Élite 3.b) se ponen en
 * `balanceSheet.notes` / `incomeStatement.notes`.
 */
export function buildNiifAnalystPass1Prompt(
  company: CompanyInfo,
  language: 'es' | 'en',
  preprocessed?: PreprocessedBalance,
  elite?: NiifAnalystEliteContext,
): string {
  const ctx = buildSharedContext(company, language, preprocessed, elite);

  return `${ctx.guardrail}

${ctx.context2026}

${ctx.niifMeasurement}

${ctx.niifDisclosures}

<task>Construir Balance General y Estado de Resultados de ${company.name} (NIT ${company.nit}) bajo ${ctx.niifFramework}, devolviendo JSON validado contra BalanceAndPnlSubSchema con cifras citadas LITERALMENTE de los TOTALES VINCULANTES y curatorFlags literal del orchestrator.</task>

<success_criteria>
- Activo = Pasivo + Patrimonio, tolerancia $0 (centavo).
- Ingresos operacionales del P&L = SUMA COMPLETA de Clase 4 (41xx + 42xx), no un solo grupo.
- Utilidad Neta del P&L coincide al centavo con TOTALES VINCULANTES (será el anchor para el closing_balance del ECP en Pass-2).
- Toda cifra global (totalAssetsPrimary, totalLiabilitiesPrimary, totalEquityPrimary, netIncomePrimary) coincide al centavo con TOTALES VINCULANTES.
- curatorFlags refleja LITERALMENTE el bloque vinculante (sin re-cálculo).
${ctx.isComparative ? `- Balance y P&L presentan amountPrimary (${ctx.primaryPeriod}) Y amountComparative (${ctx.comparativePeriod}); cuando un saldo comparativo no exista, amountComparative = null y se documenta en balanceSheet.notes / incomeStatement.notes.` : '- isComparative=false: amountComparative = null en TODAS las líneas; totalAssetsComparative et al = null.'}
</success_criteria>

<constraints>
- MUST: anclar TODA cifra global (totalAssetsPrimary, totalLiabilitiesPrimary, totalEquityPrimary, netIncomePrimary) al bloque TOTALES VINCULANTES. NO re-calcular desde el balance crudo.
- MUST: cuando una cuenta auxiliar tenga saldo pero no aparezca en el resumen de Clase, integrarla de oficio y registrar la discrepancia en balanceSheet.notes o incomeStatement.notes (Defensa Art. 647 E.T.).
- MUST: PRESENTACIÓN VISUAL ABSOLUTA en Balance y P&L — todas las líneas con \`isAbsolute=true\`. Excepción única: pérdida del ejercicio o resultados acumulados negativos (\`isAbsolute=false\`, valor con signo).
- MUST: MoneyCop serializado en CENTAVOS como string entero (ej. "150000000" = $1.500.000,00). Sin separadores, sin decimales, sin signo de pesos.
- NEVER emitir las frases "no se suministró información", "información no detallada", "datos no disponibles" en notes. Si un dato falta, citar la norma de impracticabilidad (NIIF for SMEs §3.14, §10.21, §29.27).
- NEVER inventar saldos del periodo comparativo: si comparativosImpracticables=true, amountComparative=null en todas las líneas.
- NEVER usar Clase 5 (Gastos) ni Clase 6 (Costos) como Ingresos. Los ingresos son EXCLUSIVAMENTE Clase 4.
- NEVER confundir CÓDIGO de cuenta (ej. "41", "52") con VALOR monetario.

If TOTALES VINCULANTES contiene reclassifications[] con applied=true then mostrar la cuenta virtual "2810ZZ — Otros pasivos transitorios (reclasificación curator)" dentro de balanceSheet.liabilities con el monto absoluto, NO mostrar la cuenta de Activo original con saldo negativo, y emitir balanceSheet.notes con la Nota de Reclasificación + sub-nota Defensa Art. 647 E.T. (NIC 1 §32 — no compensación) otherwise omitir silenciosamente.

If reclasifNoComp.length > 0 (R-Élite 4 — saldos contranatura en Activo) then presentar las cuentas reclasificadas dentro de balanceSheet.liabilities (mantener saldo absoluto, citar cuenta de origen como referencia en notes) otherwise omitir.

If tieneSaldoAFavor=true (PUC 1355/1805 con saldo > 0) then presentar el saldo a favor SEPARADO dentro de balanceSheet.assets, NUNCA neteado contra el gasto de impuestos del P&L; emitir balanceSheet.notes citando NIIF for SMEs §29.27 + NIC 12 §58 + E.T. art. 850 otherwise no añadir esta nota.

If impuestoRentaNeto.applicable=true (R-Élite 3.b — anticipo material PUC 135515) then presentar dentro de balanceSheet.liabilities tres líneas: "Impuesto de Renta — Bruto (PUC 2404)", "(-) Anticipo aplicable (PUC 135515)", "= Impuesto de Renta — Neto a Pagar"; totalLiabilitiesPrimary incluye SOLO el Neto a Pagar; NO mostrar PUC 135515 adicionalmente como Activo; emitir balanceSheet.notes citando NIC 12 §71 + Art. 850/855 E.T. + Defensa Art. 647 E.T. (diferencia de criterio) otherwise omitir esta presentación neto-bruto.

If comparativosImpracticables=true then balanceSheet e incomeStatement presentan amountComparative=null en todas las líneas otherwise usar el Opening Balance del periodo ${ctx.comparativePeriod ?? 'comparativo'} cuando exista.

Signo del impuesto de renta (R-Élite 3): el "Gasto por impuesto de renta y complementarios" SIEMPRE aparece como línea débito en incomeStatement (resta de UAI). NUNCA presentar el impuesto causado con signo positivo. La línea label es "(-) Gasto por impuesto de renta y complementarios (Art. 240 E.T. — 35%)".

curatorFlags refleja LITERALMENTE lo que el orquestador inyectó: \`equityConvergenceApplied\`, \`cashFlowClosureForced\`, \`negativeAssetReclassified\`, \`presumedCostWarning\`, \`reclassifiedAmountCop\` (suma absoluta en MoneyCop). NO recalcules; copia desde TOTALES VINCULANTES.

Defensa Tributaria Art. 647 E.T. (sub-notas Pass-1): por CADA ajuste automático del Curator que afecte Balance o P&L (R1 reclasificación negativa, R-Élite 3.b neteo de impuesto, R-Élite 4 No Compensación), agregar una sub-nota a balanceSheet.notes o incomeStatement.notes con estructura: "Concepto: [ajuste]. Sustento NIIF: [norma]. Defensa tributaria (Art. 647 E.T.): el presente ajuste corresponde a una diferencia de criterio en la aplicación del marco técnico contable y NO constituye omisión, alteración o registro deliberadamente inexacto. Conforme al inciso final del Art. 647 E.T. y la doctrina DIAN (Concepto 100208221-1352 de 2018), las diferencias de criterio sobre el tratamiento contable o tributario no configuran inexactitud sancionable cuando los hechos económicos están plenamente documentados." Origen documental: [papel de trabajo / curator finding].
</constraints>

<context>
${renderCompanyBlock(ctx)}

${renderComparativeModeBlock(ctx)}

${renderImpracticabilityBlock(ctx)}

${renderPucMappingBlock()}

${renderAnticipoRentaBlock(ctx)}

${renderReclasifNoCompBlock(ctx)}

${renderSaldoAFavorBlock(ctx)}

${renderActividadInferidaBlock(ctx)}

${ctx.langInstruction}
</context>`;
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
  pass1Anchors: PreviouslyComputedPass1Anchors,
  preprocessed?: PreprocessedBalance,
  elite?: NiifAnalystEliteContext,
): string {
  const ctx = buildSharedContext(company, language, preprocessed, elite);

  return `${ctx.guardrail}

${ctx.context2026}

${ctx.niifMeasurement}

${ctx.niifDisclosures}

<task>Construir Estado de Flujos de Efectivo (Método Indirecto) y Estado de Cambios en el Patrimonio de ${company.name} (NIT ${company.nit}) bajo ${ctx.niifFramework}, devolviendo JSON validado contra CashFlowAndEquitySubSchema consistente con los TOTALES VINCULANTES y los anchors numéricos de Pass-1.</task>

<success_criteria>
- cashClosing == saldo PUC 11 del Balance del periodo actual (anchor literal en TOTALES VINCULANTES), tolerancia $0 (centavo).
- Saldo final del ECP (closing_balance row.total) == totalEquityPrimary del Pass-1 anchor, tolerancia $0.
- Resultado del ejercicio en closing_balance row.resultadoEjercicio == netIncomePrimary del Pass-1 anchor, tolerancia $0.
- EFE Método Indirecto presenta las 3 secciones operating / investing / financing con sus respectivas líneas y subtotales.
- Las tres líneas de Cambios en Capital de Trabajo del EFE usan los nombres PLURAL del curator R2 (\`varCuentasPorCobrar\`, \`varInventarios\`, \`varCuentasPorPagar\`) — singular es inválido.
${ctx.isComparative ? `- EFE y ECP presentan amountPrimary (${ctx.primaryPeriod}) Y amountComparative (${ctx.comparativePeriod}) donde aplique; cuando un saldo comparativo no exista, amountComparative = null.` : '- isComparative=false: amountComparative = null en TODAS las líneas.'}
</success_criteria>

<constraints>
- MUST: anclar cashClosing, totalEquity y netIncome a los valores del bloque \`<previously_computed>\` (Pass-1 anchors). NO recalcular.
- MUST: MoneyCop serializado en CENTAVOS como string entero (sin separadores, sin decimales, sin signo de pesos).
- MUST: PRESENTACIÓN VISUAL ABSOLUTA en líneas del EFE excepto cuando el flujo es naturalmente negativo (uso de caja en operaciones, inversiones netas negativas, financiamiento neto negativo) — esas líneas conservan signo. En el ECP, las disminuciones de patrimonio conservan signo negativo.
- NEVER emitir las frases "no se suministró información", "información no detallada", "datos no disponibles" en methodNote ni equityChanges.notes. Si un dato falta, citar la norma de impracticabilidad (NIC 7 §50, NIIF for SMEs §7).
- NEVER inventar saldos del periodo comparativo: si comparativosImpracticables=true, amountComparative=null en todas las líneas.
- NEVER mezclar nombres singular/plural en Cambios en Capital de Trabajo. Singular (\`varCuentaPorCobrar\`, \`varInventario\`) es INVÁLIDO; PROHIBIDO.

EFE Método Indirecto (R-Élite 2): el campo cashFlow.sections[operating].lines DEBE incluir las tres líneas de Cambios en Capital de Trabajo usando los nombres PLURAL del curator R2: \`varCuentasPorCobrar\` (Δ CxC — aumento RESTA caja), \`varInventarios\` (Δ Inventarios — aumento RESTA caja), \`varCuentasPorPagar\` (Δ CxP — aumento SUMA caja). Cita "NIC 7 §18(b) / Sec. 7.7-7.8 PYMES" en cashFlow.methodNote.

If TOTALES VINCULANTES contiene \`cashFlowClosureAdjustment\` ≠ 0 then incluir una línea LITERAL "Variaciones en Capital de Trabajo (ajuste de cierre)" dentro de cashFlow.sections[operating].lines con el monto y signo del bloque vinculante, y emitir cashFlow.methodNote o equityChanges.notes con la Nota Maestra Defensa Art. 647 E.T. citando NIC 7 §45 ("Se aplicó un ajuste de cierre de \$X para reconciliar el EFE con PUC 11") otherwise el EFE debe cerrar naturalmente; cashClosing se copia desde controlTotals.efectivoCuenta11.

If TOTALES VINCULANTES contiene \`equityAnchorAdjustment\` ≠ 0 (curatorFlags.equityConvergenceApplied=true) then insertar una fila ECP con kind=convergence_adjustment y resultadosAcumulados=ese monto (con su signo) como ANTEÚLTIMA fila antes de closing_balance, y emitir equityChanges.notes con la sub-nota Defensa Art. 647 E.T. citando NIC 1 §106 otherwise el ECP cuadra sin línea de ajuste.

If isComparative=true Y existe \`preprocessed.comparative.equityBreakdown\` then opening_balance del ECP toma SUS cifras (capital, superávit, reservas, resultadosAcumulados) y closing_balance compone las cifras del Pass-1 anchor (totalEquityPrimary) otherwise opening_balance.total=0 con kind=opening_balance y una nota en equityChanges.notes explicando la ausencia de comparativo (cite NIIF for SMEs §3.14, §10.21 si comparativosImpracticables=true).

If comparativosImpracticables=true then cashFlow y equityChanges presentan amountComparative=null en todas las líneas otherwise usar valores del periodo comparativo cuando existan.

Defensa Tributaria Art. 647 E.T. (sub-notas Pass-2): por CADA ajuste automático del Curator que afecte EFE o ECP (R5 convergencia patrimonial, R6 ajuste de cierre EFE), agregar una sub-nota a equityChanges.notes o cashFlow.methodNote con estructura: "Concepto: [ajuste]. Sustento NIIF: [norma]. Defensa tributaria (Art. 647 E.T.): el presente ajuste corresponde a una diferencia de criterio en la aplicación del marco técnico contable y NO constituye omisión, alteración o registro deliberadamente inexacto. Conforme al inciso final del Art. 647 E.T. y la doctrina DIAN (Concepto 100208221-1352 de 2018), las diferencias de criterio sobre el tratamiento contable o tributario no configuran inexactitud sancionable cuando los hechos económicos están plenamente documentados." Origen documental: [papel de trabajo / curator finding].
</constraints>

<previously_computed>
${renderPass1AnchorsBlock(pass1Anchors)}
</previously_computed>

<context>
${renderCompanyBlock(ctx)}

${renderComparativeModeBlock(ctx)}

${renderImpracticabilityBlock(ctx)}

${renderEfeAuthoritativeBlock(ctx)}

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
 * R7, R-Élite 3.b, R-Élite 4) se inyectan SOLO cuando aplican, para mantener
 * el prompt mínimo.
 */
export function buildNiifAnalystPass3Prompt(
  company: CompanyInfo,
  language: 'es' | 'en',
  pass1Anchors: PreviouslyComputedPass1Anchors,
  pass2Anchors: PreviouslyComputedPass2Anchors,
  preprocessed?: PreprocessedBalance,
  elite?: NiifAnalystEliteContext,
): string {
  const ctx = buildSharedContext(company, language, preprocessed, elite);

  // Activadores Élite — sólo los que aplican entran al <context>.
  const eliteActivators: string[] = [];
  if (ctx.comparativosImpracticables === true) {
    eliteActivators.push(`- R-Élite 1: comparativo del periodo ${ctx.comparativePeriod ?? '(anterior)'} declarado IMPRACTICABLE.`);
  }
  if (pass1Anchors.curatorFlags.equityConvergenceApplied) {
    eliteActivators.push('- R5: convergencia patrimonial aplicada (NIC 1 §106).');
  }
  if (pass1Anchors.curatorFlags.cashFlowClosureForced) {
    eliteActivators.push('- R6: ajuste de cierre EFE aplicado (NIC 7 §45).');
  }
  if (pass1Anchors.curatorFlags.negativeAssetReclassified) {
    eliteActivators.push('- R1: reclasificación de saldo negativo en Activo a Pasivo (NIC 1 §32 — no compensación).');
  }
  if (pass1Anchors.curatorFlags.presumedCostWarning) {
    eliteActivators.push('- R7: costo presumido — advertencia sobre métricas de rentabilidad.');
  }
  if (ctx.tieneAnticipoRentaMaterial) {
    eliteActivators.push('- R-Élite 3.b: anticipo de renta material (PUC 135515) — presentación neto-bruto.');
  }
  if (ctx.reclasifNoComp.length > 0) {
    eliteActivators.push(`- R-Élite 4: ${ctx.reclasifNoComp.length} reclasificación(es) No Compensación detectada(s).`);
  }
  if (ctx.tieneSaldoAFavor) {
    eliteActivators.push('- R-Élite 3: saldo a favor del impuesto separado en Activos.');
  }

  const eliteActivatorsBlock = eliteActivators.length > 0
    ? `## Activadores Élite (sólo los activos para este reporte)
${eliteActivators.join('\n')}`
    : '';

  return `${ctx.guardrail}

${ctx.context2026}

${ctx.niifMeasurement}

${ctx.niifDisclosures}

<task>Emitir las Notas Técnicas globales del reporte NIIF de ${company.name} (NIT ${company.nit}) bajo ${ctx.niifFramework}, devolviendo JSON validado contra TechnicalNotesSubSchema con notas que citen las cifras vinculantes ya computadas en Pass-1 + Pass-2.</task>

<success_criteria>
- Cada Nota Maestra Defensa Art. 647 E.T. requerida (R1, R5, R6, R7, R-Élite 3.b, R-Élite 4) está emitida con estructura: "Concepto / Sustento NIIF / Defensa tributaria / Origen documental".
${ctx.comparativosImpracticables === true ? '- Nota literal de impracticabilidad NIIF for SMEs §3.14, §10.21 presente.' : '- Sin nota de impracticabilidad (comparativo disponible o no declarado).'}
${ctx.isGroup1 ? '- Nota preparatoria IFRS 18 presente (Grupo 1 — obligatoria a partir de 2027).' : `- IFRS 18 NUNCA mencionada (la entidad pertenece al Grupo ${company.niifGroup ?? 2}; mencionarla activa el blocker V8 del gate auditReportEmittable).`}
${ctx.actividadInferida && ctx.actividadInferida.sectorCIIU.startsWith('G') ? '- Si margen bruto > 80% (derivable de los anchors P&L): nota "verdad financiera condicionada" citando NIIF for SMEs §13.20 + NIA 705 §7.' : ''}
- Notas de mapeo PUC, reclasificaciones e impracticabilidades cuando apliquen.
</success_criteria>

<constraints>
- MUST: TODAS las notas citan cifras LITERALMENTE desde el bloque \`<previously_computed>\` (Pass-1 + Pass-2 anchors). NO recalcular ni inventar números.
- MUST: MoneyCop serializado en CENTAVOS como string entero cuando se cite un monto dentro de una nota.
- NEVER emitir las frases "no se suministró información", "información no detallada", "datos no disponibles". Si un dato falta, citar la norma de impracticabilidad correspondiente (NIIF for SMEs §3.14, §10.21, §29.27).

${ctx.isGroup1
  ? 'Preparación IFRS 18 (Grupo 1 — obligatoria 2027): incluir UNA nota técnica de preparación: (i) mapeo preliminar P&L → categorías Operating/Investing/Financing; (ii) MPMs candidatas (EBITDA ajustado, margen op. ajustado) con conciliación; (iii) brechas de datos y adecuaciones de sistemas. Marcar como "preparación, sin impacto contable en 2026".'
  : `IFRS 18 NO APLICA — PROHIBIDO MENCIONARLA. La entidad pertenece al Grupo ${company.niifGroup ?? 2}. IFRS 18 (NIIF 18) solo aplica al Grupo 1 a partir del 01/01/2027. Si se cita, el gate auditReportEmittable rechaza el informe (blocker V8).`}

If comparativosImpracticables=true then technicalNotes incluye la nota LITERAL de impracticabilidad: "Los estados financieros se presentan sin comparativos del periodo ${ctx.comparativePeriod ?? 'anterior'} dado que la información necesaria para reconstruirlos resultó impracticable de obtener (NIIF for SMEs §3.14, §10.21). La administración de la entidad efectuó esfuerzos razonables para obtener la información comparativa y documentó las gestiones realizadas." otherwise omitir.

If actividadInferida.sectorCIIU empieza con "G" (Comercio) Y margen bruto calculado > 80% (derivable de incomeStatement vía Pass-1 anchors: (netIncomePrimary + Clase 5 + impuesto) / Clase 4) then emitir technicalNotes con la nota "verdad financiera condicionada" citando NIIF for SMEs §13.20 + NIA 705 §7 otherwise omitir.

If reclasifNoComp.length > 0 (R-Élite 4) then emitir technicalNotes con una nota DEDICADA NIIF for SMEs §2.52 + NIC 1 §32, listando cuenta_origen, saldo_invertido, cuenta_destino_pasivo, motivo_norma por cada reclasificación otherwise omitir.

If curatorFlags.negativeAssetReclassified=true (R1) then emitir technicalNotes con Nota de Reclasificación + sub-nota Defensa Art. 647 E.T. (NIC 1 §32 — no compensación), citando reclassifiedAmountCop del Pass-1 anchor otherwise omitir.

Nota Maestra — Defensa Tributaria Art. 647 E.T.: por CADA ajuste automático del Curator activo en el reporte (R1, R5, R6, R7, R-Élite 3.b, R-Élite 4), agregar una nota a technicalNotes con esta estructura: "Concepto: [ajuste]. Sustento NIIF: [norma]. Defensa tributaria (Art. 647 E.T.): el presente ajuste corresponde a una diferencia de criterio en la aplicación del marco técnico contable y NO constituye omisión, alteración o registro deliberadamente inexacto. Conforme al inciso final del Art. 647 E.T. y la doctrina DIAN (Concepto 100208221-1352 de 2018), las diferencias de criterio sobre el tratamiento contable o tributario no configuran inexactitud sancionable cuando los hechos económicos están plenamente documentados. Origen documental: [papel de trabajo / curator finding]."
</constraints>

<previously_computed>
${renderPass1AnchorsBlock(pass1Anchors)}

${renderPass2AnchorsBlock(pass2Anchors)}
</previously_computed>

<context>
${renderCompanyBlock(ctx)}

${renderComparativeModeBlock(ctx)}

${renderImpracticabilityBlock(ctx)}

${eliteActivatorsBlock}

${renderAnticipoRentaBlock(ctx)}

${renderReclasifNoCompBlock(ctx)}

${renderSaldoAFavorBlock(ctx)}

${renderActividadInferidaBlock(ctx)}

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
 */
export function buildNiifAnalystPrompt(
  company: CompanyInfo,
  language: 'es' | 'en',
  preprocessed?: PreprocessedBalance,
  elite?: NiifAnalystEliteContext,
): string {
  return buildNiifAnalystPass1Prompt(company, language, preprocessed, elite);
}
