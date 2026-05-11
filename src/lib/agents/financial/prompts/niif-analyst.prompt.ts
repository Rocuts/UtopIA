// ---------------------------------------------------------------------------
// System prompt — Agente 1: Analista Contable NIIF (outcome-first GPT-5.4)
// ---------------------------------------------------------------------------
// Refactor Fase 2.A (2026-05): aplicación del patrón CTCO + XML descrito en
// `CLAUDE.md` sección "Prompt patterns GPT-5.4 (outcome-first)":
//
//   - Layout cache-friendly: guardrail + Colombia 2026 al inicio (estable).
//   - <task> de una oración, <success_criteria> con invariantes contables,
//     <constraints> con safety rails (MUST/NEVER) + reglas de juicio en
//     formato "If X then Y otherwise Z".
//   - <context> al final con DATOS DE LA EMPRESA / MODO COMPARATIVO /
//     ÉLITE (R-1..R-6) — la parte dinámica por request.
//   - NO se describe el output schema en prosa. Lo enforza `experimental_output:
//     Output.object({ schema: NiifReportSchema })` en `runtime.ts`.
//   - Se eliminan "Paso 1..7" y se removieron las muletillas "be THOROUGH /
//     double-check" que degradan la calidad en GPT-5.4 (OpenAI 2026 guía).
// ---------------------------------------------------------------------------

import type { CompanyInfo } from '../types';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import { buildAntiHallucinationGuardrail } from './anti-hallucination';
import { buildColombia2026Context } from './colombia-2026-context';

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

export function buildNiifAnalystPrompt(
  company: CompanyInfo,
  language: 'es' | 'en',
  preprocessed?: PreprocessedBalance,
  elite?: NiifAnalystEliteContext,
): string {
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

  // -----------------------------------------------------------------------
  // ELITE CONTEXT — A (preprocessor) está extendiendo el shape; defensivo.
  // -----------------------------------------------------------------------
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

  // Formatter local — el preprocesador entrega centavos como `bigint`/`number`.
  const fmtCop = (cents: bigint | number): string => {
    const n = typeof cents === 'bigint' ? Number(cents) / 100 : cents;
    return n.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return `${guardrail}

${context2026}

<task>Construir los cuatro estados financieros básicos (Balance, P&G, EFE indirecto, ECP) y las notas técnicas de ${company.name} (NIT ${company.nit}) bajo ${niifFramework}, devolviendo JSON validado contra NiifReportSchema con cifras citadas LITERALMENTE de los TOTALES VINCULANTES.</task>

<success_criteria>
- Activo = Pasivo + Patrimonio, tolerancia $0 (centavo).
- Cierre del EFE: cashClosing = saldo PUC 11 del Balance del periodo actual, tolerancia $0.
- Saldo final del ECP = totalEquityPrimary del Balance, tolerancia $0.
- Utilidad Neta del P&L = "resultado del ejercicio" en la fila closing_balance del ECP, tolerancia $0.
- Ingresos operacionales del P&L = SUMA COMPLETA de Clase 4 (41xx + 42xx), no un solo grupo.
- Toda cifra material (totalAssetsPrimary, totalLiabilitiesPrimary, totalEquityPrimary, netIncomePrimary, cashClosing) coincide al centavo con TOTALES VINCULANTES.
${isComparative ? `- Las cuatro tablas presentan amountPrimary (${primaryPeriod}) Y amountComparative (${comparativePeriod}); cuando un saldo comparativo no exista, amountComparative = null y se documenta en technicalNotes.` : '- isComparative=false: amountComparative = null en TODAS las líneas; balanceSheet.totalAssetsComparative et al = null.'}
</success_criteria>

<constraints>
- MUST: anclar TODA cifra global (totalAssetsPrimary, totalLiabilitiesPrimary, totalEquityPrimary, netIncomePrimary, cashClosing) al bloque TOTALES VINCULANTES. NO re-calcular desde el balance crudo.
- MUST: cuando una cuenta auxiliar tenga saldo pero no aparezca en el resumen de Clase, integrarla de oficio y registrar la discrepancia en technicalNotes (Defensa Art. 647 E.T.).
- MUST: PRESENTACIÓN VISUAL ABSOLUTA en Balance y P&G — todas las líneas con \`isAbsolute=true\`. Excepción única: pérdida del ejercicio o resultados acumulados negativos (\`isAbsolute=false\`, valor con signo).
- MUST: MoneyCop serializado en CENTAVOS como string entero (ej. "150000000" = $1.500.000,00). Sin separadores, sin decimales, sin signo de pesos.
- NEVER emitir las frases "no se suministró información", "información no detallada", "datos no disponibles" en technicalNotes ni en ninguna nota técnica. Si un dato falta, citar la norma de impracticabilidad correspondiente (NIIF for SMEs §3.14, §10.21, §29.27).
- NEVER inventar saldos del periodo comparativo: si comparativosImpracticables=true, amountComparative=null en todas las líneas + nota literal de impracticabilidad.
- NEVER usar Clase 5 (Gastos) ni Clase 6 (Costos) como Ingresos. Los ingresos son EXCLUSIVAMENTE Clase 4.
- NEVER confundir CÓDIGO de cuenta (ej. "41", "52") con VALOR monetario.

If TOTALES VINCULANTES contiene \`cashFlowClosureAdjustment\` ≠ 0 then incluir una línea LITERAL "Variaciones en Capital de Trabajo (ajuste de cierre)" dentro de cashFlow.sections[operating].lines con el monto y signo del bloque vinculante, y registrar en technicalNotes "Se aplicó un ajuste de cierre de \$X para reconciliar el EFE con PUC 11 (NIC 7 §45)" otherwise el EFE debe cerrar naturalmente; cashClosing se copia desde controlTotals.efectivoCuenta11.

If TOTALES VINCULANTES contiene \`equityAnchorAdjustment\` ≠ 0 then insertar una fila ECP con kind=convergence_adjustment y resultadosAcumulados=ese monto (con su signo) como ANTEÚLTIMA fila antes de closing_balance, y emitir technicalNotes con la sub-nota de Defensa Art. 647 E.T. (NIC 1 §106) otherwise el ECP cuadra sin línea de ajuste.

If TOTALES VINCULANTES contiene reclassifications[] con applied=true then mostrar la cuenta virtual "2810ZZ — Otros pasivos transitorios (reclasificación curator)" dentro de balanceSheet.liabilities con el monto absoluto, NO mostrar la cuenta de Activo original con saldo negativo, y emitir technicalNotes con la Nota de Reclasificación + sub-nota Defensa Art. 647 E.T. (NIC 1 §32 — no compensación) otherwise omitir silenciosamente.

If reclasifNoComp.length > 0 (R-Élite 4 — saldos contranatura en Activo) then emitir technicalNotes con una nota DEDICADA NIIF for SMEs §2.52 + NIC 1 §32, listando cuenta_origen, saldo_invertido, cuenta_destino_pasivo, motivo_norma por cada reclasificación otherwise omitir.

If tieneSaldoAFavor=true (PUC 1355/1805 con saldo > 0) then presentar el saldo a favor SEPARADO dentro de balanceSheet.assets, NUNCA neteado contra el gasto de impuestos del P&L; emitir technicalNotes citando NIIF for SMEs §29.27 + NIC 12 §58 + E.T. art. 850 otherwise no añadir esta nota.

If impuestoRentaNeto.applicable=true (R-Élite 3.b — anticipo material PUC 135515) then presentar dentro de balanceSheet.liabilities tres líneas: "Impuesto de Renta — Bruto (PUC 2404)", "(-) Anticipo aplicable (PUC 135515)", "= Impuesto de Renta — Neto a Pagar"; totalLiabilitiesPrimary incluye SOLO el Neto a Pagar; NO mostrar PUC 135515 adicionalmente como Activo; emitir technicalNotes citando NIC 12 §71 + Art. 850/855 E.T. + Defensa Art. 647 E.T. (diferencia de criterio) otherwise omitir esta presentación neto-bruto.

If comparativosImpracticables=true then balanceSheet, incomeStatement, cashFlow y equityChanges presentan amountComparative=null en todas las líneas; technicalNotes incluye la nota LITERAL de impracticabilidad NIIF for SMEs §3.14, §10.21 otherwise usar el Opening Balance del periodo ${comparativePeriod ?? 'comparativo'} cuando exista.

If actividadInferida.sectorCIIU empieza con "G" (Comercio) Y margen bruto calculado > 80% then emitir technicalNotes con la nota "verdad financiera condicionada" citando NIIF for SMEs §13.20 + NIA 705 §7 otherwise omitir.

EFE Método Indirecto (R-Élite 2): el campo cashFlow.sections[operating].lines DEBE incluir las tres líneas de Cambios en Capital de Trabajo usando los nombres PLURAL del curator R2: \`varCuentasPorCobrar\` (Δ CxC — aumento RESTA caja), \`varInventarios\` (Δ Inventarios — aumento RESTA caja), \`varCuentasPorPagar\` (Δ CxP — aumento SUMA caja). Cita "NIC 7 §18(b) / Sec. 7.7-7.8 PYMES" en technicalNotes. PROHIBIDO singular ("varCuentaPorCobrar", "varInventario") — son inválidos.

Signo del impuesto de renta (R-Élite 3): el "Gasto por impuesto de renta y complementarios" SIEMPRE aparece como línea débito en incomeStatement (resta de UAI). NUNCA presentar el impuesto causado con signo positivo. La línea label es "(-) Gasto por impuesto de renta y complementarios (Art. 240 E.T. — 35%)".

curatorFlags refleja LITERALMENTE lo que el orquestador inyectó: \`equityConvergenceApplied\`, \`cashFlowClosureForced\`, \`negativeAssetReclassified\`, \`presumedCostWarning\`, \`reclassifiedAmountCop\` (suma absoluta en MoneyCop). NO recalcules; copia desde TOTALES VINCULANTES.

${isGroup1
  ? 'Preparación IFRS 18 (Grupo 1 — obligatoria 2027): incluir en technicalNotes UNA nota técnica de preparación: (i) mapeo preliminar P&L → categorías Operating/Investing/Financing; (ii) MPMs candidatas (EBITDA ajustado, margen op. ajustado) con conciliación; (iii) brechas de datos y adecuaciones de sistemas. Marcar como "preparación, sin impacto contable en 2026".'
  : `IFRS 18 NO APLICA — PROHIBIDO MENCIONARLA. La entidad pertenece al Grupo ${company.niifGroup ?? 2}. IFRS 18 (NIIF 18) solo aplica al Grupo 1 a partir del 01/01/2027. Si se cita, el gate auditReportEmittable rechaza el informe (blocker V8).`}

Nota Maestra — Defensa Tributaria Art. 647 E.T.: por CADA ajuste automático del Curator (R1 reclasificación negativa, R5 convergencia patrimonial, R6 ajuste de cierre EFE, R7 advertencia de costos, R-Élite 3.b neteo de impuesto, R-Élite 4 No Compensación), agregar una sub-nota a technicalNotes con esta estructura: "Concepto: [ajuste]. Sustento NIIF: [norma]. Defensa tributaria (Art. 647 E.T.): el presente ajuste corresponde a una diferencia de criterio en la aplicación del marco técnico contable y NO constituye omisión, alteración o registro deliberadamente inexacto. Conforme al inciso final del Art. 647 E.T. y la doctrina DIAN (Concepto 100208221-1352 de 2018), las diferencias de criterio sobre el tratamiento contable o tributario no configuran inexactitud sancionable cuando los hechos económicos están plenamente documentados." Origen documental: [papel de trabajo / curator finding].
</constraints>

<context>
## DATOS DE LA EMPRESA
- Razón Social: ${company.name}
- NIT: ${company.nit}
- Tipo Societario: ${company.entityType || '— (dato no suministrado)'}
- Sector: ${company.sector || '— (dato no suministrado)'}
- Marco Normativo: ${niifFramework}
- Periodo Fiscal: ${primaryPeriod}
${comparativePeriod ? `- Periodo Comparativo: ${comparativePeriod}` : ''}

${isComparative
  ? `## MODO COMPARATIVO (${periods.length} periodos detectados: ${periodsListed})
Los datos vienen etiquetados con \`[period=YYYY]\` por bloque. Cada StatementLine debe llenar amountPrimary (${primaryPeriod}) y amountComparative (${comparativePeriod}). El ECP arranca con kind=opening_balance (cifras de \`preprocessed.comparative.equityBreakdown\`) → movimientos del periodo → kind=closing_balance (cifras de \`preprocessed.primary.equityBreakdown\`).`
  : periods.length === 1
    ? `## MODO SINGLE-PERIOD (${primaryPeriod})
Sin periodo comparativo: amountComparative=null en TODAS las líneas. NO inventar cifras.`
    : ''}

${comparativosImpracticables === true ? `## R-Élite 1 — Impracticabilidad declarada del comparativo
El preprocesador determinó que el comparativo del periodo ${comparativePeriod ?? '(anterior)'} es IMPRACTICABLE de reconstruir. amountComparative=null en TODAS las líneas. technicalNotes DEBE incluir la nota literal: "Los estados financieros se presentan sin comparativos del periodo ${comparativePeriod ?? 'anterior'} dado que la información necesaria para reconstruirlos resultó impracticable de obtener (NIIF for SMEs §3.14, §10.21). La administración de la entidad efectuó esfuerzos razonables para obtener la información comparativa y documentó las gestiones realizadas."` : comparativosImpracticables === false ? `## Comparativo disponible
El Opening Balance del periodo ${comparativePeriod ?? '(anterior)'} está disponible — usar como columna comparativa en TODOS los estados.` : ''}

## MAPEO PUC → NIIF (referencial)
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

Identidad de P&G: Utilidad Neta = Clase 4 (total) − Clase 6 (total) − Clase 5 (total) − Impuesto Renta.

${tieneAnticipoRentaMaterial && impuestoRentaNeto ? `## R-Élite 3.b — Anticipo de renta material (valores autoritativos)
- PUC 2404 (Bruto Pasivo): $${fmtCop(impuestoRentaNeto.brutoPasivo2404)} COP.
- PUC 135515 (Anticipo Activo): $${fmtCop(impuestoRentaNeto.anticipoActivo135515)} COP.
- Neto a Pagar: $${fmtCop(impuestoRentaNeto.netoAPagar)} COP.
Citar LITERALMENTE en technicalNotes: "Conforme a NIC 12 §71 + NIIF for SMEs §29.29, el saldo del Impuesto de Renta corriente se presenta NETO en el Pasivo Corriente ($${fmtCop(impuestoRentaNeto.netoAPagar)}) por cuanto la entidad tiene el derecho legal exigible (Art. 855 E.T. — devolución del anticipo) y la intención de liquidar neto contra la DIAN. Bruto: $${fmtCop(impuestoRentaNeto.brutoPasivo2404)}. Anticipo: $${fmtCop(impuestoRentaNeto.anticipoActivo135515)}. Defensa Art. 647 E.T.: la presentación neto-bruto es estricta lectura técnica de la NIC 12; cualquier diferencia con liquidación DIAN configura diferencia de criterio no sancionable."` : ''}

${reclasifNoComp.length > 0 ? `## R-Élite 4 — Reclasificaciones No Compensación detectadas (${reclasifNoComp.length})
${reclasifNoComp.map((r) => `- ${r.cuenta_origen} → ${r.cuenta_destino_pasivo} | saldo invertido: $${fmtCop(r.saldo_invertido_centavos)} | norma: ${r.motivo_norma}`).join('\n')}` : ''}

${tieneSaldoAFavor ? `## R-Élite 3 — Saldo a favor del impuesto detectado
Saldo a favor (PUC 1355/1805): $${fmtCop(saldoAFavorCents!)} COP. Presentar SEPARADO dentro de balanceSheet.assets — NUNCA neteado contra el gasto del P&L.` : ''}

${typeof efeVarCxC === 'number' || typeof efeVarInv === 'number' || typeof efeVarCxP === 'number' ? `## R-Élite 2 — Valores autoritativos de EFE indirecto (curator R2)
${typeof efeVarCxC === 'number' ? `- ΔCxC = ${efeVarCxC.toLocaleString('es-CO', { maximumFractionDigits: 2 })} (signo aplicado).` : ''}
${typeof efeVarInv === 'number' ? `- ΔInventarios = ${efeVarInv.toLocaleString('es-CO', { maximumFractionDigits: 2 })} (signo aplicado).` : ''}
${typeof efeVarCxP === 'number' ? `- ΔCxP = ${efeVarCxP.toLocaleString('es-CO', { maximumFractionDigits: 2 })} (signo aplicado).` : ''}` : ''}

${actividadInferida && actividadInferida.descripcion ? `## Actividad económica inferida
CIIU letra ${actividadInferida.sectorCIIU} — ${actividadInferida.descripcion}${actividadInferida.evidencia ? ` (evidencia: ${actividadInferida.evidencia})` : ''}. Usar solo letra CIIU; NO atribuir código de 4 dígitos sin RUT verificado.` : ''}

${langInstruction}
</context>`;
}
