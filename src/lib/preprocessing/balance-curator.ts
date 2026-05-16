// ---------------------------------------------------------------------------
// Balance Curator — orquestador de las 13 reglas NIIF activas en runtime
// ---------------------------------------------------------------------------
// (Pulido NIIF PYME Grupo 2: R1–R8 originales + R9, R10, R12, R14, R15.
// R11 y R13 viven exclusivamente en `auditReportEmittable` — son validators
// post-build sobre el output del LLM, no rules sobre el snapshot.)
//
// Se llama al final de `buildSnapshotForPeriod` (después de todas las
// validaciones existentes) para producir un `CuratorResult` que el snapshot
// expone en `snapshot.curator`. Cada regla corre dentro de un try/catch
// individual: una regla que falle NO interrumpe a las otras — el error
// queda en `result.errors[ruleCode]` para diagnóstico.
//
// Orden de ejecución (Pulido Grupo 2):
//   R1 → R12 → R8 → R5 → R3 → R2 → R6 → R4 → R7 → R9 → R10 → R14 → R15
//
// Justificación del orden:
//   1. R1 sanea Activos/Pasivos negativos (mutación de control totals).
//   2. R12 detecta libros NO cerrados (utilidad transitoria sin trasladar).
//      Si dispara `abortVirtualClose=true`, R8 NO ejecuta y el orquestador
//      del pipeline financiero debe emitir dictamen "no emitible".
//   3. R8 aplica Cierre Virtual SÓLO si R12 no abortó: traslada utilidad
//      del ejercicio (Clase 4-5-6-7) a Patrimonio (cuenta virtual 3605VC)
//      y reclasifica saldo histórico de 3605 a 3710VC.
//   4. R5 ancla el patrimonio al ECP (sólo absorbe gaps reales de transición
//      NIIF / redondeos; los gaps por utilidad transitoria ya fueron
//      eliminados por R8).
//   5. R3 atribuye el descuadre residual (lectura sobre control totals
//      saneados).
//   6. R2 construye el EFE indirecto (sobre control totals saneados).
//   7. R6 cierra el EFE contra el saldo PUC 11 (depende de R2).
//   8. R4 valida la provisión de renta (independiente).
//   9. R7 emite advertencia de costo presunto (independiente, no muta).
//  10. R9 audita el contrato raw + cents BigInt (precisión preservada).
//  11. R10 detecta clase 18 acreedor + causación impuesto faltante.
//  12. R14 advierte PPE bruto sin depreciación correspondiente.
//  13. R15 advierte costeo incompleto en comercializadoras.
//
// La función NO ES PURA en sentido estricto: las reglas R1, R5, R6, R7 y R8
// mutan el snapshot recibido (ver contratos en `curator-rules/types.ts`).
// Sigue siendo determinística: mismo input → mismo output (snapshot mutado
// idénticamente, R8 idempotente sobre cuentas virtuales 3605VC/3710VC).
// ---------------------------------------------------------------------------

import type { PeriodSnapshot } from './trial-balance';

import { runR1 } from './curator-rules/r1-negative-assets';
import { runR2 } from './curator-rules/r2-indirect-cashflow';
import { runR3 } from './curator-rules/r3-balance-gap-attribution';
import { runR4 } from './curator-rules/r4-tax-provision-sufficiency';
import { runR5 } from './curator-rules/r5-equity-anchor';
import { runR6 } from './curator-rules/r6-cashflow-closure';
import { runR7 } from './curator-rules/r7-presumed-cost';
import { runR8 } from './curator-rules/r8-virtual-close';
import { runR9 } from './curator-rules/r9-precision-cents';
import { runR10 } from './curator-rules/r10-class-18-classification';
import { runR12 } from './curator-rules/r12-closing-detector';
import { runR14 } from './curator-rules/r14-ppe-depreciation-sync';
import { runR15 } from './curator-rules/r15-cost-classification';
import { runR16 } from './curator-rules/r16-tax-anticipo-netting';
import { runR17 } from './curator-rules/r17-supplier-debit-balance';
import { runR18 } from './curator-rules/r18-equity-negative';
import { runR19 } from './curator-rules/r19-net-margin-over-70';
import type { CuratorFinding, CuratorResult } from './curator-rules/types';
import { buildPresentationV3Data } from '@/lib/agents/financial/prompts/presentation-v3';

export function runCurator(
  snapshot: PeriodSnapshot,
  prev: PeriodSnapshot | null = null,
): CuratorResult {
  const findings: CuratorFinding[] = [];
  const errors: Record<string, string> = {};

  // R1 — saneo de saldos negativos en Activos (muta).
  let r1Out: ReturnType<typeof runR1> = { reclassifications: [], findings: [] };
  try {
    r1Out = runR1(snapshot);
    findings.push(...r1Out.findings);
  } catch (err) {
    errors['CUR-R1'] = err instanceof Error ? err.message : String(err);
    console.warn('[curator] R1 failed:', err);
  }

  // R12 — detector de cierre de libros (gate previo a R8). Si dispara
  // `abortVirtualClose`, R8 NO ejecuta: el orquestador del pipeline
  // financiero debe emitir dictamen "no emitible" (V-blocker R12 en gate).
  let r12Out: ReturnType<typeof runR12> = {
    audit: {
      utilidadTransitoriaCop: 0,
      grupo36SaldoCop: 0,
      grupo37SaldoCop: 0,
      librosNoCerrados: false,
      suggestedClosingEntries: [],
    },
    findings: [],
    abortVirtualClose: false,
  };
  try {
    r12Out = runR12(snapshot);
    findings.push(...r12Out.findings);
  } catch (err) {
    errors['CUR-R12'] = err instanceof Error ? err.message : String(err);
    console.warn('[curator] R12 failed:', err);
  }

  // R8 — Cierre Virtual: traslado automático de utilidad transitoria a
  // patrimonio (3605VC) + reclasificación de saldo histórico 3605 → 3710VC
  // (muta). Corre antes de R5 para que R5 sólo vea gaps reales de NIIF.
  //
  // Política Pulido NIIF PYME Grupo 2: R8 SIEMPRE ejecuta (preserva
  // contrato del Bridge de Cuadratura). Cuando R12 detecta libros no
  // cerrados, R8 absorbe la utilidad transitoria virtualmente para que
  // el snapshot sea matemáticamente coherente, pero el gate
  // `auditReportEmittable` (V12) bloquea la emisión del informe al
  // detectar `findings.librosNoCerrados=true`. Así el dictamen "no
  // emitible" se decide a nivel de gate, no de curator, y el snapshot
  // sigue siendo consumible por renderers de diagnóstico.
  let r8Out: ReturnType<typeof runR8> | null = null;
  try {
    r8Out = runR8(snapshot);
    findings.push(...r8Out.findings);
  } catch (err) {
    errors['CUR-R8'] = err instanceof Error ? err.message : String(err);
    console.warn('[curator] R8 failed:', err);
  }
  // El campo `r12Out.abortVirtualClose` se preserva como señal informativa
  // para callers (orchestrator) que quieran razonar sobre libros abiertos
  // sin re-leer el snapshot.findings.
  void r12Out.abortVirtualClose;

  // R5 — anclaje patrimonial Balance ↔ ECP (muta).
  let r5Out: ReturnType<typeof runR5> = { findings: [] };
  try {
    r5Out = runR5(snapshot, prev);
    findings.push(...r5Out.findings);
  } catch (err) {
    errors['CUR-R5'] = err instanceof Error ? err.message : String(err);
    console.warn('[curator] R5 failed:', err);
  }

  // R3 — atribución de brecha de cuadratura (lectura).
  let r3Out: ReturnType<typeof runR3> = { findings: [] };
  try {
    r3Out = runR3(snapshot, prev);
    findings.push(...r3Out.findings);
  } catch (err) {
    errors['CUR-R3'] = err instanceof Error ? err.message : String(err);
    console.warn('[curator] R3 failed:', err);
  }

  // R2 — construcción del EFE método indirecto (lectura, popula
  // `cashFlowIndirecto` que luego R6 cierra).
  let r2Out: ReturnType<typeof runR2> = { findings: [] };
  try {
    r2Out = runR2(snapshot, prev);
    findings.push(...r2Out.findings);
    // Persistir el EFE en el snapshot para que R6 lo encuentre.
    if (r2Out.cashFlowIndirecto) {
      snapshot.cashFlowIndirecto = r2Out.cashFlowIndirecto;
    }
  } catch (err) {
    errors['CUR-R2'] = err instanceof Error ? err.message : String(err);
    console.warn('[curator] R2 failed:', err);
  }

  // R6 — cierre EFE ↔ caja PUC 11 (muta `snapshot.cashFlowIndirecto`).
  let r6Out: ReturnType<typeof runR6> = { findings: [] };
  try {
    r6Out = runR6(snapshot, prev);
    findings.push(...r6Out.findings);
  } catch (err) {
    errors['CUR-R6'] = err instanceof Error ? err.message : String(err);
    console.warn('[curator] R6 failed:', err);
  }

  // R4 — provisión de renta (lectura, independiente).
  let r4Out: ReturnType<typeof runR4> = { findings: [] };
  try {
    r4Out = runR4(snapshot);
    findings.push(...r4Out.findings);
  } catch (err) {
    errors['CUR-R4'] = err instanceof Error ? err.message : String(err);
    console.warn('[curator] R4 failed:', err);
  }

  // R7 — advertencia de costo presunto (lectura, independiente, no muta cifras).
  let r7Out: ReturnType<typeof runR7> = { findings: [] };
  try {
    r7Out = runR7(snapshot);
    findings.push(...r7Out.findings);
  } catch (err) {
    errors['CUR-R7'] = err instanceof Error ? err.message : String(err);
    console.warn('[curator] R7 failed:', err);
  }

  // R9 — auditoría del contrato raw + cents BigInt (precisión preservada).
  let r9Out: ReturnType<typeof runR9> = {
    precisionCentsAudit: { fieldsChecked: 0, driftCount: 0, driftedFields: [], preserved: true },
    findings: [],
  };
  try {
    r9Out = runR9(snapshot);
    findings.push(...r9Out.findings);
  } catch (err) {
    errors['CUR-R9'] = err instanceof Error ? err.message : String(err);
    console.warn('[curator] R9 failed:', err);
  }

  // R10 — clasificación cuenta 18 + detección causación impuesto.
  let r10Out: ReturnType<typeof runR10> = {
    audit: {
      class18BalanceCop: 0,
      taxExpenseCop: 0,
      taxPayableCop: 0,
      missingTaxCausation: false,
      cuenta18UsadaComoGasto: false,
    },
    findings: [],
  };
  try {
    r10Out = runR10(snapshot);
    findings.push(...r10Out.findings);
  } catch (err) {
    errors['CUR-R10'] = err instanceof Error ? err.message : String(err);
    console.warn('[curator] R10 failed:', err);
  }

  // R14 — PPE sin depreciación sincronizada.
  let r14Out: ReturnType<typeof runR14> = {
    audit: {
      ppeBrutoCop: 0,
      depreciacionAcumuladaCop: 0,
      gastoDepreciacionCop: 0,
      ppeWithoutDepreciation: false,
    },
    findings: [],
  };
  try {
    r14Out = runR14(snapshot);
    findings.push(...r14Out.findings);
  } catch (err) {
    errors['CUR-R14'] = err instanceof Error ? err.message : String(err);
    console.warn('[curator] R14 failed:', err);
  }

  // R15 — costeo incompleto en clase 7.
  let r15Out: ReturnType<typeof runR15> = {
    audit: {
      ingresosComercializacionCop: 0,
      costo6135Cop: 0,
      costoClase7Cop: 0,
      costeoIncompleto: false,
    },
    findings: [],
  };
  try {
    r15Out = runR15(snapshot);
    findings.push(...r15Out.findings);
  } catch (err) {
    errors['CUR-R15'] = err instanceof Error ? err.message : String(err);
    console.warn('[curator] R15 failed:', err);
  }

  // R16 — anticipo de renta (PUC 135515) → neto contra pasivo PUC 2404.
  // Why: ITEM 2 ORDEN DE CIERRE — presentar "Neto a Pagar" en Balance
  // conforme práctica revisoría fiscal Ley 43/1990 + NIC 12 §71 + Art. 850 E.T.
  // No muta saldos individuales; expone `controlTotals.impuestoRentaNeto`.
  try {
    const r16Out = runR16(snapshot);
    findings.push(...r16Out.findings);
  } catch (err) {
    errors['CUR-R16'] = err instanceof Error ? err.message : String(err);
    console.warn('[curator] R16 failed:', err);
  }

  // -------------------------------------------------------------------------
  // Wave 2.F4 — Anomalías Parte 5 spec v2.0 (R17, R18, R19).
  // Las tres corren AL FINAL del Curator porque:
  //  - R17 (proveedores Cta 22 saldo débito) sólo lee snapshot.classes.
  //  - R18 (patrimonio negativo) lee controlTotals.patrimonio post-R8/R5
  //    (autoritativo).
  //  - R19 (margen neto > 70%) lee utilidadNeta + ingresosNetos post-R8
  //    (utilidad dinámica autoritativa).
  // Ninguna MUTA el snapshot — sólo emiten findings. Errores aislados en
  // try/catch siguiendo la convención del orquestador.
  // -------------------------------------------------------------------------
  try {
    const r17Out = runR17(snapshot);
    findings.push(...r17Out.findings);
  } catch (err) {
    errors['CUR-R17'] = err instanceof Error ? err.message : String(err);
    console.warn('[curator] R17 failed:', err);
  }

  try {
    const r18Out = runR18(snapshot);
    findings.push(...r18Out.findings);
  } catch (err) {
    errors['CUR-R18'] = err instanceof Error ? err.message : String(err);
    console.warn('[curator] R18 failed:', err);
  }

  try {
    const r19Out = runR19(snapshot);
    findings.push(...r19Out.findings);
  } catch (err) {
    errors['CUR-R19'] = err instanceof Error ? err.message : String(err);
    console.warn('[curator] R19 failed:', err);
  }

  // Presentation v3.0 — D&A explícita + ORI condicional + ECP inteligente.
  // El curator siempre lo computa; el niif-analyst prompt lo consume como
  // anchors en el bloque TOTALES VINCULANTES (PresentationV3 anchors).
  let presentationV3: CuratorResult['presentationV3'];
  try {
    presentationV3 = buildPresentationV3Data(snapshot, prev ?? null);
  } catch (err) {
    errors['CUR-PV3'] = err instanceof Error ? err.message : String(err);
    console.warn('[curator] buildPresentationV3Data failed:', err);
  }

  return {
    period: snapshot.period,
    comparativePeriod: prev?.period ?? null,
    reclassifications: r1Out.reclassifications,
    cashFlowIndirecto: snapshot.cashFlowIndirecto, // post-R6 si R6 mutó
    balanceGapAttribution: r3Out.balanceGapAttribution,
    taxProvisionRisk: r4Out.taxProvisionRisk,
    convergenceAdjustment: r5Out.convergenceAdjustment,
    cashFlowClosureAdjustment: r6Out.cashFlowClosureAdjustment,
    presumedCostWarning: r7Out.presumedCostWarning,
    virtualCloseAdjustment: r8Out?.virtualCloseAdjustment,
    precisionCentsAudit: r9Out.precisionCentsAudit,
    class18ClassificationAudit: r10Out.audit,
    closingDetectorAudit: r12Out.audit,
    ppeDepreciationAudit: r14Out.audit,
    costClassificationAudit: r15Out.audit,
    presentationV3,
    findings,
    errors,
    generatedAt: new Date().toISOString(),
  };
}

export type { CuratorResult, CuratorFinding } from './curator-rules/types';
