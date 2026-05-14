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
  fmtCop: (cents: bigint | number) => string;
  company: CompanyInfo;
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
Los datos vienen etiquetados con \`[period=YYYY]\` por bloque. Cada StatementLine debe llenar amountPrimary (${ctx.primaryPeriod}) y amountComparative (${ctx.comparativePeriod}). El ECP arranca con kind=opening_balance (cifras de \`preprocessed.comparative.equityBreakdown\`) → movimientos del periodo → kind=closing_balance (cifras de \`preprocessed.primary.equityBreakdown\`).`;
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
 * Bloque Regla R3.b (Anticipo renta neto-bruto) — anticipo de renta material.
 * Aplicable a Pass-1 (presentación neto-bruto en Balance + sub-nota Defensa
 * Art. 647 E.T.) y referenciado en Pass-3 (nota maestra).
 */
function renderAnticipoRentaBlock(ctx: SharedPromptContext): string {
  if (ctx.tieneAnticipoRentaMaterial && ctx.impuestoRentaNeto) {
    return `## Regla R3.b (Anticipo renta neto-bruto) — valores autoritativos
- PUC 2404 (Bruto Pasivo): $${ctx.fmtCop(ctx.impuestoRentaNeto.brutoPasivo2404)} COP.
- PUC 135515 (Anticipo Activo): $${ctx.fmtCop(ctx.impuestoRentaNeto.anticipoActivo135515)} COP.
- Neto a Pagar: $${ctx.fmtCop(ctx.impuestoRentaNeto.netoAPagar)} COP.
Citar LITERALMENTE en technicalNotes: "Conforme a NIC 12 §71 + NIIF for SMEs §29.29, el saldo del Impuesto de Renta corriente se presenta NETO en el Pasivo Corriente ($${ctx.fmtCop(ctx.impuestoRentaNeto.netoAPagar)}) por cuanto la entidad tiene el derecho legal exigible (Art. 855 E.T. — devolución del anticipo) y la intención de liquidar neto contra la DIAN. Bruto: $${ctx.fmtCop(ctx.impuestoRentaNeto.brutoPasivo2404)}. Anticipo: $${ctx.fmtCop(ctx.impuestoRentaNeto.anticipoActivo135515)}. Defensa Art. 647 E.T.: la presentación neto-bruto es estricta lectura técnica de la NIC 12; cualquier diferencia con liquidación DIAN configura diferencia de criterio no sancionable."`;
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
    return `## Regla R4 (No-Compensación NIC 1 §32) — reclasificaciones detectadas (${ctx.reclasifNoComp.length})
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
Saldo a favor (PUC 1355/1805): $${ctx.fmtCop(ctx.saldoAFavorCents!)} COP. Presentar SEPARADO dentro de balanceSheet.assets — NUNCA neteado contra el gasto del P&L.`;
  }
  return '';
}

/**
 * Bloque Regla R2 (EFE Indirecto) — valores autoritativos EFE indirecto
 * (curator R2). EXCLUSIVO de Pass-2 (Pass-1 no produce EFE; Pass-3 lo recibe
 * como anchor).
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
  return `## Regla R2 (EFE Indirecto) — Valores autoritativos curator R2
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
  // 2026-05-13 hotfix: emitir tambien los anchors comparativos cuando existen,
  // para que Pass-2 (EFE/ECP) y Pass-3 (notas) puedan citar las dos columnas
  // sin null-ear amountComparative. Si la cifra comparativa no existe (null),
  // emitir "N/A" explicito en lugar de omitir la linea -- evita que el modelo
  // interprete ausencia como autorizacion para null-ear todo el comparativo.
  const fmt = (v: string | null): string => (v === null ? 'N/A (sin comparativo)' : `$${v}`);
  return `## Anchors de Pass 1 (Balance + P&G - ya emitidos, no recalcular)
- totalAssetsPrimary: $${anchors.totalAssetsPrimary}
- totalLiabilitiesPrimary: $${anchors.totalLiabilitiesPrimary}
- totalEquityPrimary: $${anchors.totalEquityPrimary}
- netIncomePrimary: $${anchors.netIncomePrimary}
- oriPrimary: $${anchors.oriPrimary}

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
 * a ajustes específicos del Balance/P&L (R1, Regla R3.b) se ponen en
 * `balanceSheet.notes` / `incomeStatement.notes`.
 */
export function buildNiifAnalystPass1Prompt(
  company: CompanyInfo,
  language: 'es' | 'en',
  reportMode: ReportMode,
  preprocessed?: PreprocessedBalance,
  elite?: NiifAnalystEliteContext,
): string {
  const ctx = buildSharedContext(company, language, reportMode, preprocessed, elite);

  // Why: el modeBanner canónico se inyecta dentro del prompt como instrucción
  // literal (no como string interpolable a posteriori). El LLM lo copia tal
  // cual en balanceSheet.modeBanner / incomeStatement.modeBanner.
  const modeBannerText =
    ctx.reportMode === 'LINEA_BASE'
      ? 'Periodo actual sin comparativo histórico. La columna derecha (YYYY+1) está reservada para el primer cierre plenamente comparable bajo NIIF para Pymes. No se renderiza vacía: se renderiza como compromiso.'
      : ctx.reportMode === 'TRANSICION'
        ? 'Periodo de transición. Se compara donde la información histórica es suficiente; se marca n/c donde no.'
        : 'null';

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
- CHECK 4 (Parte 8.1 spec — no duplicación gastos): TOTAL_GASTOS_P&L = Grupo 51 + Grupo 52 + Grupo 53 (cada grupo una sola vez). Subcuentas 53xx NO se cuentan en adición al total Grupo 53. Σ líneas de gastos en incomeStatement.lines ≤ controlTotals.gastos del bloque vinculante (tolerancia $1.000).
- Cada línea material (>1% del rubro padre) en balanceSheet.assets/liabilities/equity e incomeStatement.lines lleva campo \`confidence\` ∈ {high, medium, low} asignado.
- balanceSheet.modeBanner e incomeStatement.modeBanner reflejan el texto canónico del modo del reporte (o null cuando reportMode='COMPARATIVO_COMPLETO').
- Cuando reportMode='LINEA_BASE': ninguna línea, label ni nota contiene verbos comparativos (mejoró/creció/aumentó/se redujo/evolucionó/varió).
- reportMode (campo root del schema) ecoa LITERALMENTE el valor inyectado por el orchestrator.
</success_criteria>

<constraints>
- MUST: anclar TODA cifra global (totalAssetsPrimary, totalLiabilitiesPrimary, totalEquityPrimary, netIncomePrimary) al bloque TOTALES VINCULANTES. NO re-calcular desde el balance crudo.
- MUST: cuando una cuenta auxiliar tenga saldo pero no aparezca en el resumen de Clase, integrarla de oficio y registrar la discrepancia en balanceSheet.notes o incomeStatement.notes (Defensa Art. 647 E.T.).
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

- MUST: TODA política contable elegida, TODA agrupación de subcuentas y TODA presentación lleva cita normativa entre paréntesis (§1.4 spec v8.1: NIIF Pymes Sec. X / IAS Y / NIC Z / Art. E.T. / Ley X). Sin cita, sin afirmación.

- NEVER emitir las frases "no se suministró información", "información no detallada", "datos no disponibles" en notes. Si un dato falta, citar la norma de impracticabilidad (NIIF for SMEs §3.14, §10.21, §29.27).
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
  normaRef: 'NIA 240 §A1 + benchmark CTCP/DANE 2026',
  benchmarkBand: { lowerBound: 'X%', upperBound: 'Y%', observed: 'Z%' }
}
\`\`\`
  NEVER emitir cifras de banda INVENTADAS — usar EXCLUSIVAMENTE las del header colombia-2026-context (si están presentes para el CIIU). If el header no expone banda para este CIIU then citar como \`normaRef: 'NIA 240 §A1 (banda sectorial CIIU no disponible — recomendación general)'\` y omitir benchmarkBand (null).

Devoluciones 4175 (Parte 1.3 spec v2.0). TOTALES VINCULANTES expone (cuando F4 lande) \`ingresosNetos\` = |Σ 41xx crédito| − |Σ 4175xx débito|. If quieres desglosar ingresos en incomeStatement.lines (Opción B) then incluir línea separada "(-) Devoluciones en ventas (Cta 4175)" con valor absoluto y signo NEGATIVO; verificar que Ingresos brutos − Devoluciones = ingresosNetos. Else if Opción A (consolidado) then una sola línea "(+) Ingresos de actividades ordinarias (Grupo 41, neto de devoluciones)" con el monto ingresosNetos. NEVER duplicar la resta de 4175 cuando TOTALES VINCULANTES ya entrega el monto neto.

Anti-duplicación Grupo 53 (CRÍTICO — Parte 1.3 spec v2.0). NEVER presentar simultáneamente el total del Grupo 53 (consolidado) Y sus subcuentas individuales (5305 Financieros, 5395 Diversos, 5310 Comisiones, etc.) como líneas independientes sumadas en \`incomeStatement.lines\`. Las subcuentas 53xx YA ESTÁN INCLUIDAS dentro del total Grupo 53; sumar ambos genera DOBLE CONTABILIZACIÓN (caso documentado: $30.262.041 de gastos no operacionales duplicados).

If quieres detalle de gastos no operacionales (Opción B del spec) then desglosar SOLO subcuentas (Σ 53xx = Grupo 53 total verificable al centavo) otherwise mostrar SOLO la línea consolidada "(-) Otros gastos no operacionales y financieros (Grupo 53)" (Opción A).

Las dos opciones son mutuamente excluyentes. Nunca ambas combinadas. Esta es la falla cubierta por CHECK 4 (Parte 8.1 spec) — el validator post-LLM la detecta y bloquea el reporte.

Detección de Anomalías (Tabla 8 — Parte 5 spec v2.0). Para CADA condición detectada en TOTALES VINCULANTES o auxiliares, emitir nota en \`balanceSheet.notes\` (anomalías de Activo/Pasivo/Patrimonio) o \`incomeStatement.notes\` (anomalías P&L):

- If preprocessed contiene cuenta auxiliar Clase 14 con saldo < 0 then nota "Anomalía A1: Inventarios con saldo negativo (Clase 14 < 0) — error contable; revisar kardex y movimientos (NIC 2 §9-10)".
- If preprocessed contiene cuenta auxiliar Clase 11/13/14 con saldo crédito (negativo en convención PUC) then nota "Anomalía A2: Activo con saldo inverso (cta XXXX) — inconsistencia contable; revisar imputación (NIC 1 §32 No compensación)".
- If preprocessed contiene Clase 12 (Inversiones) con saldo < 0 then nota "Anomalía A3: Inversiones con saldo negativo — requiere revisión documental (NIC 28 §10 / Sec. 14 PYMES)".
- If (Clase 6 + Clase 7) / Clase 4 < 1% then nota "Anomalía A4: Costo de ventas/producción < 1% de ingresos — posible subregistro de costos; KPIs de ciclo operativo distorsionados (NIA 240 §A1-A6 fraude por subregistro)".
- If |Clase 54 actual| << 35% × utilidad operativa (UAI > 0 Y impuesto contable < 30% de teórico) then nota "Anomalía A5: Brecha entre impuesto contable y teórico — conciliación fiscal pendiente (NIC 12 §80 + Art. 240 E.T.; Defensa Art. 647 E.T. diferencia de criterio)".
- If preprocessed contiene cta 22xx (Proveedores) con saldo débito (saldo positivo en convención PUC Clase 2) then nota "Anomalía A6: Proveedores con saldo débito — posible anticipo o error de imputación; revisar".
- If totalEquityPrimary < 0 then nota DEDICADA "Anomalía A7: PATRIMONIO NEGATIVO — alerta de continuidad de negocio (NIC 1 §25 Going Concern; C.Co. Art. 459 — disolución por pérdidas cuando patrimonio < 50% capital suscrito). El representante legal DEBE convocar disolución conforme C.Co. Art. 459.".
- If (utilidadNeta / ingresos) > 0.70 Y costoVentas < 30% ingresos then nota "Anomalía A8: Margen neto > 70% con costos < 30% — costo de ventas posiblemente subregistrado o ingresos sobreestimados (NIA 240 + R7 curator)".

If TOTALES VINCULANTES contiene reclassifications[] con applied=true then mostrar la cuenta virtual "2810ZZ — Otros pasivos transitorios (reclasificación curator)" dentro de balanceSheet.liabilities con el monto absoluto, NO mostrar la cuenta de Activo original con saldo negativo, y emitir balanceSheet.notes con la Nota de Reclasificación + sub-nota Defensa Art. 647 E.T. (NIC 1 §32 — no compensación) otherwise omitir silenciosamente.

If reclasifNoComp.length > 0 (Regla R4 — No-Compensación NIC 1 §32, saldos contranatura en Activo) then presentar las cuentas reclasificadas dentro de balanceSheet.liabilities (mantener saldo absoluto, citar cuenta de origen como referencia en notes) otherwise omitir.

If tieneSaldoAFavor=true (PUC 1355/1805 con saldo > 0) then presentar el saldo a favor SEPARADO dentro de balanceSheet.assets, NUNCA neteado contra el gasto de impuestos del P&L; emitir balanceSheet.notes citando NIIF for SMEs §29.27 + NIC 12 §58 + E.T. art. 850 otherwise no añadir esta nota.

If impuestoRentaNeto.applicable=true (Regla R3.b — Anticipo renta neto-bruto, PUC 135515 material) then presentar dentro de balanceSheet.liabilities tres líneas: "Impuesto de Renta — Bruto (PUC 2404)", "(-) Anticipo aplicable (PUC 135515)", "= Impuesto de Renta — Neto a Pagar"; totalLiabilitiesPrimary incluye SOLO el Neto a Pagar; NO mostrar PUC 135515 adicionalmente como Activo; emitir balanceSheet.notes citando NIC 12 §71 + Art. 850/855 E.T. + Defensa Art. 647 E.T. (diferencia de criterio) otherwise omitir esta presentación neto-bruto.

If comparativosImpracticables=true then balanceSheet e incomeStatement presentan amountComparative=null en todas las líneas otherwise usar el Opening Balance del periodo ${ctx.comparativePeriod ?? 'comparativo'} cuando exista.

Signo del impuesto de renta (Regla R3 — Saldo a favor): el "Gasto por impuesto de renta y complementarios" SIEMPRE aparece como línea débito en incomeStatement (resta de UAI). NUNCA presentar el impuesto causado con signo positivo. La línea label es "(-) Gasto por impuesto de renta y complementarios (Art. 240 E.T. — 35%)".

Cascada impuesto de renta (Parte 4.1 spec v2.0; Corrección 4 spec v2.1).
If TOTALES VINCULANTES contiene \`impuestoCausadoPeriodo\` (Clase 54 con saldo) then usar ese valor (caso a).
Else if TOTALES VINCULANTES contiene \`anticipoActivo\` (Cta 1805/135515 con saldo > 0) then usar el monto Cta.1805 (caso b — formato literal abajo).
Else if UAI > 0 Y no hay ni Clase 54 ni 1805/135515 then calcular impuesto teórico = UAI × 35% (Art. 240 E.T. 2026), presentar línea LITERAL "(-) Provisión teórica de impuesto de renta (Art. 240 E.T. — 35%; pendiente confirmación contador)" en incomeStatement.lines, anclar el monto como cálculo del modelo (NO como anchor de TOTALES VINCULANTES), y emitir nota en incomeStatement.notes: "El balance no registra Clase 54 ni Cta 1805/135515; se aplicó provisión teórica del 35% sobre la utilidad antes de impuestos pendiente de confirmación por el contador responsable (Art. 240 E.T.; Defensa Art. 647 E.T. — diferencia de criterio documentada)."
Else (UAI ≤ 0 sin impuesto) then no aplicar línea de impuesto; emitir nota "No se causa impuesto de renta del periodo: utilidad antes de impuestos no positiva (Art. 14 E.T.)".

**Formato literal en incomeStatement.lines cuando se usa Cta.1805 (caso b — Corrección 4 spec v2.1):**

If TOTALES VINCULANTES no contiene \`impuestoCausadoPeriodo\` (sin Clase 54) Y contiene \`anticipoActivo\` (Cta.1805) then en incomeStatement.lines emitir línea con label LITERAL:
- label: "(-) Impuesto de renta (Cta.1805 — retenciones anticipadas; sin Clase 54 en el período)"
- amountPrimary: monto Cta.1805 en centavos (MoneyCop string entero)
- isAbsolute: false (signo negativo en valor o paréntesis según renderer)

Y en incomeStatement.notes emitir nota obligatoria con texto LITERAL (sin variantes):
"El gasto de impuesto de renta del período corresponde a retenciones y anticipos registrados en Cta.1805. No se identificó gasto de impuesto Clase 54 en el balance de prueba. La provisión del impuesto corriente al 35% (Art.240 ET) requiere conciliación fiscal formal antes del cierre definitivo."

Esta nota es OBLIGATORIA cuando aplica el caso b. NO inventar otra redacción.

curatorFlags refleja LITERALMENTE lo que el orquestador inyectó: \`equityConvergenceApplied\`, \`cashFlowClosureForced\`, \`negativeAssetReclassified\`, \`presumedCostWarning\`, \`reclassifiedAmountCop\` (suma absoluta en MoneyCop). NO recalcules; copia desde TOTALES VINCULANTES.

Defensa Tributaria Art. 647 E.T. (sub-notas Pass-1): por CADA ajuste automático del Curator que afecte Balance o P&L (R1 reclasificación negativa, Regla R3.b neteo de impuesto, Regla R4 No-Compensación), agregar una sub-nota a balanceSheet.notes o incomeStatement.notes con estructura: "Concepto: [ajuste]. Sustento NIIF: [norma]. Defensa tributaria (Art. 647 E.T.): el presente ajuste corresponde a una diferencia de criterio en la aplicación del marco técnico contable y NO constituye omisión, alteración o registro deliberadamente inexacto. Conforme al inciso final del Art. 647 E.T. y la doctrina DIAN (Concepto 100208221-1352 de 2018), las diferencias de criterio sobre el tratamiento contable o tributario no configuran inexactitud sancionable cuando los hechos económicos están plenamente documentados." Origen documental: [papel de trabajo / curator finding].
</constraints>

<context>
${renderCompanyBlock(ctx)}

${renderReportModeBlock(ctx)}

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
  reportMode: ReportMode,
  pass1Anchors: PreviouslyComputedPass1Anchors,
  preprocessed?: PreprocessedBalance,
  elite?: NiifAnalystEliteContext,
): string {
  const ctx = buildSharedContext(company, language, reportMode, preprocessed, elite);

  return `${ctx.guardrail}

${ctx.context2026}

${ctx.niifMeasurement}

${ctx.niifDisclosures}

<task>Construir Estado de Flujos de Efectivo (Método Indirecto) y Estado de Cambios en el Patrimonio de ${company.name} (NIT ${company.nit}) bajo ${ctx.niifFramework}, devolviendo JSON validado contra CashFlowAndEquitySubSchema consistente con los TOTALES VINCULANTES y los anchors numéricos de Pass-1.</task>

<success_criteria>
- cashClosing == saldo PUC 11 del Balance del periodo actual (anchor literal en TOTALES VINCULANTES), tolerancia $0 (centavo).
- cashOpening == saldo PUC 11 al INICIO del periodo (preprocessed.comparative.controlTotals.efectivoCuenta11 o cashClosing - netChange si el orchestrator solo lo expone derivable).
- Saldo final del ECP (closing_balance row.total) == totalEquityPrimary del Pass-1 anchor, tolerancia $0.
- Resultado del ejercicio en closing_balance row.resultadoEjercicio == netIncomePrimary del Pass-1 anchor, tolerancia $0.
- EFE Método Indirecto presenta las 3 secciones operating / investing / financing con sus respectivas líneas y subtotales.
- Las tres líneas de Cambios en Capital de Trabajo del EFE usan los nombres PLURAL del curator R2 (\`varCuentasPorCobrar\`, \`varInventarios\`, \`varCuentasPorPagar\`) — singular es inválido.
${ctx.isComparative ? `- EFE y ECP presentan amountPrimary (${ctx.primaryPeriod}) Y amountComparative (${ctx.comparativePeriod}) donde aplique; cuando un saldo comparativo no exista, amountComparative = null.` : '- isComparative=false: amountComparative = null en TODAS las líneas.'}
- Cuando reportMode='LINEA_BASE': ni methodNote ni equityChanges.notes usan verbos comparativos (mejoró/creció/aumentó/se redujo/evolucionó).
- If el EFE Indirecto produciría >=6 líneas con monto "0" en cashFlow.sections[].lines (por ausencia de auxiliares de capital de trabajo) then \`cashFlow.degeneracyFlag = 'indirect_method_unreliable'\` y methodNote incluye literal de limitación al alcance.
</success_criteria>

<constraints>
- MUST: anclar cashClosing, totalEquity y netIncome a los valores del bloque \`<previously_computed>\` (Pass-1 anchors). NO recalcular.
- MUST: MoneyCop serializado en CENTAVOS como string entero (sin separadores, sin decimales, sin signo de pesos).
- MUST: PRESENTACIÓN VISUAL ABSOLUTA en líneas del EFE excepto cuando el flujo es naturalmente negativo (uso de caja en operaciones, inversiones netas negativas, financiamiento neto negativo) — esas líneas conservan signo. En el ECP, las disminuciones de patrimonio conservan signo negativo.

- MUST: ecoar el valor "${ctx.reportMode}" del bloque "MODO DEL REPORTE" para coherencia narrativa (el campo \`reportMode\` root vive en Pass-1; aquí solo se usa para gobernar verbos y disclaimers).

- MUST: cashOpening = saldo PUC 11 al INICIO del periodo. NEVER asignar cashOpening = totalAssetsPrimary, totalAssetsComparative, totalLiabilitiesPrimary o cualquier total de balance. NEVER usar el saldo de Activos como proxy de Caja. If el preprocessor no expone cashOpening directo en \`<previously_computed>\` then computar: cashOpening = cashClosing − netChange, donde netChange = Σ flujos netos de las 3 secciones (operating+investing+financing).

- MUST: $0 huérfanos en EFE/ECP (§1.2 spec v8.1). If una línea del EFE o ECP tiene \`amountPrimary="0"\` Y (\`amountComparative="0"\` O \`null\`) Y NO existe nota explicativa, OMITIR la línea. Else if el cero refleja un hecho material (ej. "Sin distribución de dividendos por decisión de asamblea") MANTENER + nota citando norma.

- MUST: si reportMode != 'LINEA_BASE' Y \`comparativosImpracticables\` != true Y el bloque \`<previously_computed>\` (anchors Pass-1) expone cifras comparativas para los rubros relevantes (totalAssetsComparative, totalEquityComparative, netIncomeComparative, etc.), \`amountComparative\` en líneas del EFE y filas del ECP DEBE reflejar esa cifra (incluso si es "0"). \`amountComparative=null\` EXCLUSIVAMENTE cuando reportMode='LINEA_BASE' o la cuenta no existe en preprocessed.comparative. NUNCA null-ear silenciosamente.

- MUST: TODA política contable elegida, TODA presentación lleva cita normativa entre paréntesis (§1.4 spec v8.1: NIC 7 §X / NIIF for SMEs §7.Y / NIC 1 §Z). Sin cita, sin afirmación.

- NEVER emitir las frases "no se suministró información", "información no detallada", "datos no disponibles" en methodNote ni equityChanges.notes. Si un dato falta, citar la norma de impracticabilidad (NIC 7 §50, NIIF for SMEs §7).
- NEVER inventar saldos del periodo comparativo: si comparativosImpracticables=true, amountComparative=null en todas las líneas.
- NEVER mezclar nombres singular/plural en Cambios en Capital de Trabajo. Singular (\`varCuentaPorCobrar\`, \`varInventario\`) es INVÁLIDO; PROHIBIDO.

- NEVER en methodNote ni equityChanges.notes: "Élite", "Excelencia", "Premium", "Excepcional", "Único", "Mejor", "Sólido", "Robusto", "Extraordinario", "Sin precedentes", "De clase mundial" (§1.6 spec v8.1).

- If reportMode='LINEA_BASE' then NEVER usar en methodNote ni equityChanges.notes verbos comparativos: "mejoró", "creció", "aumentó", "se redujo", "evolucionó", "varió respecto a", "incrementó", "disminuyó", "se contrajo". Usar en su lugar verbos de estado: "establece", "documenta", "constituye", "declara", "registra", "presenta".
  If reportMode='TRANSICION' then verbos comparativos SÓLO en líneas con comparativo disponible.

- CRÍTICO — Asiento 3605 (cierre contable) NUNCA en el Estado de Flujos de Efectivo (Corrección 2 spec v2.1).

  REGLA ABSOLUTA: el traslado de utilidad a la cuenta 3605 (asiento de cierre) es un movimiento PURAMENTE CONTABLE. NO representa flujo de efectivo bajo ninguna circunstancia. NEVER incluirlo en cashFlow.sections — ni en operating, ni en investing, ni en financing.

  PROHIBIDO en cashFlow.sections[financing].lines (ni en ninguna otra sección):
  - "Distribución/cancelación resultado acumulado YYYY: \$X" → falso flujo de salida.
  - "Traslado utilidad ejercicio a 3605: \$X" → asiento contable, no cash.
  - Cualquier referencia al cierre 3605 dentro de cashFlow.

  If el EFE no cuadra (cashClosing != cashOpening + netChange) then:
    1. Revisar variaciones de capital de trabajo (varCuentasPorCobrar, varInventarios, varCuentasPorPagar) y ajustar magnitudes/signos hasta que el EFE cuadre matemáticamente con tolerancia $0 al centavo.
    2. NEVER usar el asiento 3605 como "comodín" para hacer cuadrar el EFE.
    3. Si pese a los ajustes el EFE sigue sin cuadrar, emitir cashFlow.degeneracyFlag = 'indirect_method_unreliable' con methodNote literal de limitación al alcance (NIC 7 §18 + NIA 705 §7).

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
  Else if saldo3605 != netIncomePrimary then la diferencia se atribuye a Cta.3710 (convergencia NIIF). Documentar en equityChanges.notes citando NIC 1 §106 + Decreto 2420/2015 (transición NIIF) y emitir el monto del saldo3605 explícitamente en la fila de traslado.

- EFE degenerado (§5 Slide 08 spec v8.1). If el EFE Indirecto produciría >=6 líneas con monto "0" en cashFlow.sections[].lines (típicamente por ausencia de auxiliares de variaciones de capital de trabajo — el balance solo expone saldos agregados sin movimientos) then poblar \`cashFlow.degeneracyFlag = 'indirect_method_unreliable'\` y emitir methodNote LITERAL: "EFE Método Indirecto no computado por ausencia de auxiliares de variaciones de capital de trabajo. Variación neta de caja como dato único defensible (cashClosing − cashOpening). NIC 7 §18 + NIA 705 §7 limitación al alcance." Else \`cashFlow.degeneracyFlag = 'none'\` y construir EFE Indirecto completo.

EFE Método Indirecto (Regla R2 — EFE Indirecto): el campo cashFlow.sections[operating].lines DEBE incluir las tres líneas de Cambios en Capital de Trabajo usando los nombres PLURAL del curator R2: \`varCuentasPorCobrar\` (Δ CxC — aumento RESTA caja), \`varInventarios\` (Δ Inventarios — aumento RESTA caja), \`varCuentasPorPagar\` (Δ CxP — aumento SUMA caja). Cita "NIC 7 §18(b) / Sec. 7.7-7.8 PYMES" en cashFlow.methodNote.

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

${renderReportModeBlock(ctx)}

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
    eliteActivators.push('- Regla R3.b (Anticipo renta neto-bruto): anticipo de renta material (PUC 135515) — presentación neto-bruto.');
  }
  if (ctx.reclasifNoComp.length > 0) {
    eliteActivators.push(`- Regla R4 (No-Compensación NIC 1 §32): ${ctx.reclasifNoComp.length} reclasificación(es) detectada(s).`);
  }
  if (ctx.tieneSaldoAFavor) {
    eliteActivators.push('- Regla R3 (Saldo a favor): saldo a favor del impuesto separado en Activos.');
  }

  const eliteActivatorsBlock = eliteActivators.length > 0
    ? `## Activadores de Reglas R (sólo las reglas activas para este reporte)
${eliteActivators.join('\n')}`
    : '';

  return `${ctx.guardrail}

${ctx.context2026}

${ctx.niifMeasurement}

${ctx.niifDisclosures}

<task>Emitir las Notas Técnicas globales del reporte NIIF de ${company.name} (NIT ${company.nit}) bajo ${ctx.niifFramework}, devolviendo JSON validado contra TechnicalNotesSubSchema con notas que citen las cifras vinculantes ya computadas en Pass-1 + Pass-2.</task>

<success_criteria>
- Defensa Art.647 E.T. emitida como UNA SOLA nota consolidada al FINAL de technicalNotes con label LITERAL "Diferencias de criterio contable (Art.647 E.T.)" cuando aplique cualquier ajuste curator (Corrección 9 spec v2.1). Máximo 1 nota Art.647 en todo el reporte.
${ctx.comparativosImpracticables === true ? '- Nota literal de impracticabilidad NIIF for SMEs §3.14, §10.21 presente.' : '- Sin nota de impracticabilidad (comparativo disponible o no declarado).'}
${ctx.isGroup1 ? '- Nota preparatoria IFRS 18 presente (Grupo 1 — obligatoria a partir de 2027).' : `- IFRS 18 NUNCA mencionada (la entidad pertenece al Grupo ${company.niifGroup ?? 2}; mencionarla activa el blocker V8 del gate auditReportEmittable).`}
${ctx.actividadInferida && ctx.actividadInferida.sectorCIIU.startsWith('G') ? '- Si margen bruto > 80% (derivable de los anchors P&L): nota "verdad financiera condicionada" citando NIIF for SMEs §13.20 + NIA 705 §7.' : ''}
- Notas de mapeo PUC, reclasificaciones e impracticabilidades cuando apliquen.
- If alguna nota Anomalía A1..A8 fue emitida en Pass-1 then technicalNotes incluye SECCIÓN dedicada "Anomalías e Inconsistencias Detectadas" agrupando las notas (consolidación para el lector ejecutivo).
- If reportMode ∈ {'LINEA_BASE', 'TRANSICION'} then technicalNotes incluye al FINAL una nota dedicada con label LITERAL "Limitaciones de Información" agrupando los disclaimers automáticos aplicables (§8 spec v8.1). Esta sección AUMENTA credibilidad, no la disminuye — explicita el alcance de la información usada y el porqué de los n/c.
- If totalEquityPrimary (anchor Pass-1) < 0 then technicalNotes DEBE incluir nota dedicada con label "Hipótesis de Empresa en Marcha" citando NIC 1 §25-26 + NIA 570 + C.Co. Art. 459, describiendo: (a) la situación de patrimonio negativo, (b) la causa probable (pérdidas acumuladas materiales), (c) la obligación legal del representante legal de convocar asamblea para evaluar disolución cuando el patrimonio quede < 50% del capital suscrito, (d) declaración del Defensa Art. 647 E.T.: "La revelación de la situación es transparente y documentada; la sanción aplicable es de naturaleza societaria (C.Co. Art. 459), no tributaria."
</success_criteria>

<constraints>
- MUST: TODAS las notas citan cifras LITERALMENTE desde el bloque \`<previously_computed>\` (Pass-1 + Pass-2 anchors). NO recalcular ni inventar números.
- MUST: MoneyCop serializado en CENTAVOS como string entero cuando se cite un monto dentro de una nota.

- MUST: ecoar el valor "${ctx.reportMode}" del bloque "MODO DEL REPORTE" para coherencia narrativa (el campo \`reportMode\` root vive en Pass-1; aquí solo se usa para gobernar verbos y la sección "Limitaciones de Información").

- MUST: TODA política contable referenciada, TODA conclusión técnica, TODA cita lleva referencia normativa entre paréntesis (§1.4 spec v8.1: NIIF Pymes Sec. X / IAS Y / NIC Z / Art. E.T. / Ley X / NIA W). Sin cita, sin afirmación.

- MUST: si reportMode != 'LINEA_BASE' Y \`comparativosImpracticables\` != true Y los anchors comparativos (totalAssetsComparative, totalLiabilitiesComparative, totalEquityComparative, netIncomeComparative, oriComparative) en \`<previously_computed>\` están disponibles (no "N/A"), las notas que citen cifras DEBEN incluir el valor comparativo cuando exista. NUNCA omitir silenciosamente el periodo comparativo en notas de variación.

- NEVER emitir las frases "no se suministró información", "información no detallada", "datos no disponibles". Si un dato falta, citar la norma de impracticabilidad correspondiente (NIIF for SMEs §3.14, §10.21, §29.27).

- NEVER en notas, labels ni body: "Élite", "Excelencia", "Premium", "Excepcional", "Único", "Mejor", "Sólido", "Robusto", "Extraordinario", "Sin precedentes", "De clase mundial" (§1.6 spec v8.1 — prohibición vocabulario marketing). El registro narrativo es technico-contable, no comercial.

- NEVER en technicalNotes (Corrección 7 spec v2.1 — eliminación de notas internas):
  - Sección "Notas internas del preparador" o cualquier variante (ej. "Notas del modelo", "Notas internas", "Apuntes del sistema").
  - Notas marcadas "(NO incluir en EEFF firmables)" o "(uso interno)".
  - Advertencias internas de valoración del modelo (auto-evaluaciones de confianza, comentarios sobre el reasoning del LLM).
  - Metadata del sistema de procesamiento interno (Pass-1, Pass-2, Pass-3, anchors, curatorFlags como nombres literales en notas, netIncomePrimary, etc. — son nombres internos, NO van al cliente).
  - Comentarios sobre el proceso de generación (ej. "Esta nota fue generada por...", "El modelo determinó...", "Se aplicó la regla R5...").

  Las limitaciones reales del informe van EXCLUSIVAMENTE en:
  - Sección "Limitaciones de Información" (al final, una sola vez si reportMode != 'COMPARATIVO_COMPLETO').
  - Notas técnicas NIIF cuando aplique (brevemente, citando norma de impracticabilidad NIIF for SMEs §3.14, §10.21, §29.27).

- If reportMode='LINEA_BASE' then NEVER usar en technicalNotes verbos comparativos: "mejoró", "creció", "aumentó", "se redujo", "evolucionó", "varió respecto a", "incrementó", "disminuyó", "se contrajo". Usar en su lugar verbos de estado: "establece", "documenta", "constituye", "declara", "registra", "presenta".
  If reportMode='COMPARATIVO_COMPLETO' then verbos comparativos PERMITIDOS y esperados.
  If reportMode='TRANSICION' then verbos comparativos SÓLO en notas que referencien líneas con comparativo disponible (no n/c).

- Limitaciones de Información (§8 spec v8.1). If reportMode='LINEA_BASE' OR reportMode='TRANSICION' then technicalNotes DEBE cerrar con una nota dedicada con label LITERAL "Limitaciones de Información" agrupando los 6 disclaimers automáticos aplicables (numerados 1..6 abajo) que se activaron por condición. Estructura sugerida: introducción explicativa ("Las siguientes limitaciones acotan el alcance de la información presentada y explicitan los criterios de prudencia aplicados, conforme NIIF for SMEs §3.14 y §10.21") + bullet list de disclaimers activos + cierre normativo (NIIF + Art. 647 E.T. diferencia de criterio). Esta sección AUMENTA credibilidad técnica del reporte. Else (COMPARATIVO_COMPLETO) emitir SOLO los disclaimers numerados como notas separadas, sin agrupación bajo "Limitaciones de Información".

${ctx.isGroup1
  ? 'Preparación IFRS 18 (Grupo 1 — obligatoria 2027): incluir UNA nota técnica de preparación: (i) mapeo preliminar P&L → categorías Operating/Investing/Financing; (ii) MPMs candidatas (EBITDA ajustado, margen op. ajustado) con conciliación; (iii) brechas de datos y adecuaciones de sistemas. Marcar como "preparación, sin impacto contable en 2026".'
  : `IFRS 18 NO APLICA — PROHIBIDO MENCIONARLA. La entidad pertenece al Grupo ${company.niifGroup ?? 2}. IFRS 18 (NIIF 18) solo aplica al Grupo 1 a partir del 01/01/2027. Si se cita, el gate auditReportEmittable rechaza el informe (blocker V8).`}

If comparativosImpracticables=true then technicalNotes incluye la nota LITERAL de impracticabilidad: "Los estados financieros se presentan sin comparativos del periodo ${ctx.comparativePeriod ?? 'anterior'} dado que la información necesaria para reconstruirlos resultó impracticable de obtener (NIIF for SMEs §3.14, §10.21). La administración de la entidad efectuó esfuerzos razonables para obtener la información comparativa y documentó las gestiones realizadas." otherwise omitir.

If actividadInferida.sectorCIIU empieza con "G" (Comercio) Y margen bruto calculado > 80% (derivable de incomeStatement vía Pass-1 anchors: (netIncomePrimary + Clase 5 + impuesto) / Clase 4) then emitir technicalNotes con la nota "verdad financiera condicionada" citando NIIF for SMEs §13.20 + NIA 705 §7 otherwise omitir.

If reclasifNoComp.length > 0 (Regla R4 — No-Compensación NIC 1 §32) then emitir technicalNotes con una nota DEDICADA NIIF for SMEs §2.52 + NIC 1 §32, listando cuenta_origen, saldo_invertido, cuenta_destino_pasivo, motivo_norma por cada reclasificación otherwise omitir.

If curatorFlags.negativeAssetReclassified=true (R1) then emitir technicalNotes con Nota de Reclasificación + sub-nota Defensa Art. 647 E.T. (NIC 1 §32 — no compensación), citando reclassifiedAmountCop del Pass-1 anchor otherwise omitir.

**Defensa Art.647 ET — UNA SOLA nota consolidada (Corrección 9 spec v2.1; reemplaza patrón de sub-notas por curator rule).**

If CUALQUIER ajuste curator se aplicó (curatorFlags.equityConvergenceApplied OR curatorFlags.cashFlowClosureForced OR curatorFlags.negativeAssetReclassified OR curatorFlags.presumedCostWarning OR ctx.tieneAnticipoRentaMaterial OR ctx.reclasifNoComp.length > 0) then emitir UNA SOLA nota al FINAL de technicalNotes con label LITERAL "Diferencias de criterio contable (Art.647 E.T.)" y body LITERAL (sin variantes ni paráfrasis):

"NOTA GENERAL — Diferencias de criterio contable (Art.647 E.T.)
Los ajustes de presentación, reclasificaciones y criterios de aplicación del marco técnico NIIF incluidos en este informe corresponden a diferencias de criterio contable. Conforme al Art.647 E.T. y el Concepto DIAN 100208221-1352 de 2018, estas diferencias no constituyen inexactitud sancionable cuando los hechos económicos están plenamente documentados. Referencia: NIIF for SMEs §2.52; NIC 1 §32; Decreto 2420/2015."

PROHIBIDO emitir múltiples notas Defensa Art.647 (una por curator rule R1/R5/R6/R7/R3.b/R4). MÁXIMO 1 nota Defensa Art.647 en TODO technicalNotes.

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
