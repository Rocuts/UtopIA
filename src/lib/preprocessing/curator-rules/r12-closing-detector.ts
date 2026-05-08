// ---------------------------------------------------------------------------
// R12 — Detector de cierre de libros (gate previo a R8)
// ---------------------------------------------------------------------------
// Si la utilidad transitoria del P&L (clase 4 − 5 − 6 − 7) es material y los
// grupos 36 (resultados del ejercicio) + 37 (resultados ejercicios anteriores)
// no la reflejan, los libros NO están cerrados: la entidad exportó el balance
// antes de pasar el asiento de cierre y trasladar la utilidad al patrimonio.
//
// Política de gate:
//   - Cuando R12 detecta `librosNoCerrados = true`, R8 (Cierre Virtual) NO
//     se ejecuta — el orchestrator debe emitir dictamen "no emitible" sin
//     llegar al builder. Sintetizar EEFF con libros abiertos genera un
//     informe APARENTE pero contablemente inválido.
//   - R12 NO muta el snapshot. Solo escribe `snapshot.findings.librosNoCerrados`
//     y emite un finding crítico con los asientos sugeridos.
//
// La señal de orquestación se devuelve en `R12Result.abortVirtualClose`. El
// orquestrador `balance-curator.ts` lee ese flag para saltar R8.
// ---------------------------------------------------------------------------

import type { PUCClass, PeriodSnapshot } from '../trial-balance';
import type { ClosingDetectorAudit, CuratorFinding } from './types';

/** Materialidad mínima para considerar la utilidad transitoria significativa. */
const UTILIDAD_MATERIALITY = 1_000_000; // $1M COP

/**
 * Tolerancia para considerar grupos 36 + 37 ≈ 0 vs la utilidad transitoria.
 * Si |grupo36 + grupo37| < max($1M, |utilidad| × 5%), los libros están abiertos.
 */
const ACCUMULATED_TOLERANCE_PCT = 0.05;
const ACCUMULATED_TOLERANCE_FLOOR = 1_000_000; // $1M COP

export interface R12Result {
  audit: ClosingDetectorAudit;
  findings: CuratorFinding[];
  /** Si `true`, R8 (Cierre Virtual) NO debe ejecutarse — emitir "no emitible". */
  abortVirtualClose: boolean;
}

export function runR12(snapshot: PeriodSnapshot): R12Result {
  const findings: CuratorFinding[] = [];

  // -------------------------------------------------------------------------
  // 1. Utilidad transitoria del P&L = clase 4 − clase 5 − clase 6 − clase 7.
  // -------------------------------------------------------------------------
  const c4 = sumClass(snapshot, 4);
  const c5 = sumClass(snapshot, 5);
  const c6 = sumClass(snapshot, 6);
  const c7 = sumClass(snapshot, 7);
  const utilidadTransitoria = c4 - c5 - c6 - c7;

  // -------------------------------------------------------------------------
  // 2. Saldos de los grupos 36 y 37 dentro de clase 3.
  // -------------------------------------------------------------------------
  const class3 = snapshot.classes.find((c: PUCClass) => c.code === 3);
  const grupo36 = (class3?.accounts ?? [])
    .filter((a) => a.code.startsWith('36'))
    .reduce((s, a) => s + a.balance, 0);
  const grupo37 = (class3?.accounts ?? [])
    .filter((a) => a.code.startsWith('37'))
    .reduce((s, a) => s + a.balance, 0);

  // -------------------------------------------------------------------------
  // 3. Determinación: libros no cerrados.
  // -------------------------------------------------------------------------
  const accumuladoTotal = grupo36 + grupo37;
  const utilidadAbs = Math.abs(utilidadTransitoria);
  const tolerance = Math.max(
    utilidadAbs * ACCUMULATED_TOLERANCE_PCT,
    ACCUMULATED_TOLERANCE_FLOOR,
  );

  const utilidadMaterial = utilidadAbs > UTILIDAD_MATERIALITY;
  const accumuladoMuyPequeno = Math.abs(accumuladoTotal) < tolerance;
  const librosNoCerrados = utilidadMaterial && accumuladoMuyPequeno;

  // -------------------------------------------------------------------------
  // 4. Sugerencia de asientos de cierre (NO se aplican).
  // -------------------------------------------------------------------------
  const suggestedClosingEntries: string[] = [];
  if (librosNoCerrados) {
    suggestedClosingEntries.push(
      `Cierre clase 4 (Ingresos) → Cr. 5905 (Ganancias y pérdidas) por $${formatCOP(c4)}.`,
      `Cierre clases 5/6/7 (Gastos y costos) → Dr. 5905 por $${formatCOP(c5 + c6 + c7)}.`,
      `Traslado de utilidad → Cr. 3605 (Utilidad del ejercicio) por $${formatCOP(utilidadTransitoria)}.`,
    );
  }

  const audit: ClosingDetectorAudit = {
    utilidadTransitoriaCop: utilidadTransitoria,
    grupo36SaldoCop: grupo36,
    grupo37SaldoCop: grupo37,
    librosNoCerrados,
    suggestedClosingEntries,
  };

  if (!snapshot.findings) snapshot.findings = {};
  snapshot.findings.librosNoCerrados = librosNoCerrados;
  snapshot.closingDetectorAudit = audit;

  // -------------------------------------------------------------------------
  // 5. Finding crítico cuando se detecta.
  // -------------------------------------------------------------------------
  if (librosNoCerrados) {
    findings.push({
      code: 'CUR-R12',
      severity: 'critico',
      title: 'Libros NO cerrados — utilidad del ejercicio sin trasladar al patrimonio',
      description:
        `La utilidad transitoria del P&L del periodo es $${formatCOP(utilidadTransitoria)} ` +
        `(clase 4 ${formatCOP(c4)} − clase 5 ${formatCOP(c5)} − clase 6 ${formatCOP(c6)} − ` +
        `clase 7 ${formatCOP(c7)}), pero el patrimonio sólo refleja $${formatCOP(accumuladoTotal)} ` +
        `en grupos 36 (${formatCOP(grupo36)}) + 37 (${formatCOP(grupo37)}). El asiento de cierre ` +
        `del ejercicio NO ha sido pasado.`,
      normReference: 'Art. 50 C.Co. + Decreto 2649/1993 Art. 49 + NIC 1 párr. 32',
      recommendation:
        'Pasar los siguientes asientos antes de re-procesar el balance:\n' +
        suggestedClosingEntries.map((e, i) => `${i + 1}. ${e}`).join('\n'),
      impact:
        'El informe NO es emitible. Sintetizar EEFF con libros abiertos produce un ' +
        'documento APARENTE pero contablemente inválido (la ecuación A = P + PT no ' +
        'incluye la utilidad del ejercicio en el patrimonio). El sistema ' +
        'salta R8 (Cierre Virtual) y emite dictamen "no emitible".',
      period: snapshot.period,
    });
  }

  return { audit, findings, abortVirtualClose: librosNoCerrados };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sumClass(snapshot: PeriodSnapshot, classCode: number): number {
  const cl = snapshot.classes.find((c) => c.code === classCode);
  return cl?.auxiliaryTotal ?? 0;
}

function formatCOP(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return amount < 0 ? `-${formatted}` : formatted;
}
