// ---------------------------------------------------------------------------
// R12 — Detector de cierre de libros
// ---------------------------------------------------------------------------
// Dos preguntas distintas sobre el cierre contable:
//
// (1) ¿El resultado del ejercicio de ESTE periodo está en el patrimonio?
//     "Sin traslado" = el P&G (clases 4-7) es material y el grupo 36
//     (3605 utilidad / 3610 pérdida del ejercicio) no lo contiene
//     (≈ 0 o con el resultado de otro ejercicio). El grupo 37 NO cuenta: es
//     resultado de ejercicios ANTERIORES y un 3705 grande no prueba el
//     traslado del año (auditoría 2026-09, niif-preproceso-26).
//
//     Política según `periodoTipo` (coherente con la nota de R8):
//       - 'parcial'       → práctica habitual de corte intermedio: hallazgo
//                           'medio' explicativo, SIN bandera de gate.
//       - 'cerrado'       → error de cierre: `findings.librosNoCerrados` (V12).
//       - 'indeterminado' → opción conservadora: se trata como cerrado y la
//                           recomendación explica cómo declarar un corte
//                           parcial (etiqueta AAAA-MM).
//
// (2) ¿El comparativo quedó cerrado? (auditoría 2026-09, recalculo-03)
//     Si el periodo anterior tenía resultado material y ese resultado NO
//     entró al patrimonio del periodo actual, las cuentas de resultado del
//     periodo actual son ACUMULADAS (anterior + actual). Prueba: con
//     X = Activo − Pasivo − resultado (patrimonio sin el resultado del año),
//     ΔX excluyendo capital y superávit ≈ 0 en vez de ≈ resultado anterior.
//     El sistema NO transforma cifras: publica un hallazgo con la cifra
//     alternativa (movimiento del ejercicio = saldo final − saldo anterior)
//     y bloquea para que el usuario confirme o pase el asiento de cierre.
//     Con evidencia de dividendos (2360/35) el caso es ambiguo (un resultado
//     distribuido íntegramente produce el mismo patrimonio): hallazgo 'alto'
//     sin bloqueo.
//
// R12 NO muta saldos. Escribe `snapshot.findings.librosNoCerrados`,
// `snapshot.closingDetectorAudit` y, en el caso (2), un bloqueo post-curator.
// ---------------------------------------------------------------------------

import type { PUCClass, PeriodSnapshot } from '../trial-balance';

import { addCuratorBlocker, clearCuratorBlockers } from './curator-blockers';
import { hasDividendEvidenceAccounts } from './dividend-evidence';
import { centsToCanonical, pesosToCents } from './sync-control-totals';
import type { ClosingDetectorAudit, CuratorFinding, PygAcumuladoAudit } from './types';

/** Materialidad mínima para considerar la utilidad transitoria significativa. */
const UTILIDAD_MATERIALITY = 1_000_000; // $1M COP

/**
 * Tolerancia para considerar que el grupo 36 contiene la utilidad transitoria:
 * |grupo36 − utilidad| < max($1M, |utilidad| × 5%).
 */
const ACCUMULATED_TOLERANCE_PCT = 0.05;
const ACCUMULATED_TOLERANCE_FLOOR = 1_000_000; // $1M COP

/** Grupos de patrimonio que no son resultados (aportes, superávit, valorizaciones). */
const NON_RESULT_EQUITY_GROUPS = ['31', '32', '34', '38'];

const ZERO = BigInt(0);

export interface R12Result {
  audit: ClosingDetectorAudit;
  findings: CuratorFinding[];
  /** `true` cuando `librosNoCerrados` (señal informativa para el orquestador). */
  abortVirtualClose: boolean;
}

export function runR12(snapshot: PeriodSnapshot, prev: PeriodSnapshot | null = null): R12Result {
  const findings: CuratorFinding[] = [];
  clearCuratorBlockers(snapshot, 'CUR-R12');

  // -------------------------------------------------------------------------
  // 1. Resultado del ejercicio. Se usa `controlTotals.utilidadNeta` (neta de
  //    devoluciones 4175), el mismo valor que R8 traslada a 3605VC.
  // -------------------------------------------------------------------------
  const c4 = sumClass(snapshot, 4);
  const c5 = sumClass(snapshot, 5);
  const c6 = sumClass(snapshot, 6);
  const c7 = sumClass(snapshot, 7);
  const utilidadTransitoria = snapshot.controlTotals.utilidadNeta;

  // -------------------------------------------------------------------------
  // 2. Saldos REALES de los grupos 36 y 37 (sin cuentas virtuales).
  // -------------------------------------------------------------------------
  const class3 = snapshot.classes.find((c: PUCClass) => c.code === 3);
  const realAccounts = (class3?.accounts ?? []).filter((a) => !/VC|ZZ/i.test(a.code));
  const grupo36 = realAccounts
    .filter((a) => a.code.startsWith('36'))
    .reduce((s, a) => s + a.balance, 0);
  const grupo37 = realAccounts
    .filter((a) => a.code.startsWith('37'))
    .reduce((s, a) => s + a.balance, 0);

  // -------------------------------------------------------------------------
  // 3. Sin traslado del resultado del periodo.
  // -------------------------------------------------------------------------
  const utilidadAbs = Math.abs(utilidadTransitoria);
  const tolerance = Math.max(
    utilidadAbs * ACCUMULATED_TOLERANCE_PCT,
    ACCUMULATED_TOLERANCE_FLOOR,
  );
  const utilidadMaterial = utilidadAbs > UTILIDAD_MATERIALITY;
  const sinTraslado = utilidadMaterial && Math.abs(grupo36 - utilidadTransitoria) >= tolerance;
  const periodoTipo = snapshot.periodoTipo ?? 'indeterminado';
  const esCorteParcial = periodoTipo === 'parcial';

  // -------------------------------------------------------------------------
  // 4. Comparativo no cerrado → P&G posiblemente acumulado.
  // -------------------------------------------------------------------------
  const pygAcumulado = detectPygAcumulado(snapshot, prev);
  const conDividendos = pygAcumulado ? hasDividendEvidenceAccounts(snapshot) : false;
  const pygAcumuladoBloqueante = pygAcumulado !== undefined && !conDividendos;

  const librosNoCerrados = (sinTraslado && !esCorteParcial) || pygAcumuladoBloqueante;

  // -------------------------------------------------------------------------
  // 5. Asientos sugeridos (NO se aplican).
  // -------------------------------------------------------------------------
  const suggestedClosingEntries: string[] = [];
  if (pygAcumuladoBloqueante && pygAcumulado) {
    suggestedClosingEntries.push(
      `Cierre del periodo ${pygAcumulado.comparativePeriod}: cancelar las clases 4-7 contra 5905 ` +
        `(Ganancias y pérdidas) y trasladar $${formatCOP(pygAcumulado.utilidadComparativo)} a ` +
        `3605/3610; luego volver a exportar el balance de ${snapshot.period}.`,
    );
  }
  if (sinTraslado && !esCorteParcial) {
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
    ...(pygAcumulado ? { pygAcumulado } : {}),
  };

  if (!snapshot.findings) snapshot.findings = {};
  snapshot.findings.librosNoCerrados = librosNoCerrados;
  snapshot.closingDetectorAudit = audit;

  // -------------------------------------------------------------------------
  // 6. Findings.
  // -------------------------------------------------------------------------
  if (sinTraslado && esCorteParcial) {
    findings.push({
      code: 'CUR-R12',
      severity: 'medio',
      title: 'Corte parcial: resultado del periodo aún no trasladado al patrimonio',
      description:
        `El balance es un corte parcial (${snapshot.period}). El resultado acumulado del periodo ` +
        `($${formatCOP(utilidadTransitoria)}) sigue en las clases 4-7 y el grupo 36 registra ` +
        `$${formatCOP(grupo36)}. En un corte intermedio es práctica habitual que el traslado se ` +
        `haga al cierre del ejercicio; el cierre virtual (R8) lo presenta en el patrimonio.`,
      normReference: 'NIC 34 (información intermedia) + NIC 1 párr. 106',
      recommendation:
        'Revelar en notas que las cifras corresponden a un corte intermedio sin asiento de cierre.',
      impact: 'Informativo: no impide la emisión de un informe de corte intermedio.',
      period: snapshot.period,
    });
  } else if (sinTraslado) {
    findings.push({
      code: 'CUR-R12',
      severity: 'critico',
      title: 'Libros NO cerrados — utilidad del ejercicio sin trasladar al patrimonio',
      description:
        `La utilidad transitoria del P&L del periodo es $${formatCOP(utilidadTransitoria)} ` +
        `(clase 4 ${formatCOP(c4)} − clase 5 ${formatCOP(c5)} − clase 6 ${formatCOP(c6)} − ` +
        `clase 7 ${formatCOP(c7)}), pero el grupo 36 (Resultados del ejercicio) registra ` +
        `$${formatCOP(grupo36)}. El grupo 37 ($${formatCOP(grupo37)}) corresponde a ejercicios ` +
        `anteriores. El asiento de cierre del ejercicio NO ha sido pasado.`,
      normReference: 'Art. 50 C.Co. + Decreto 2649/1993 Art. 49 + NIC 1 párr. 32',
      recommendation:
        'Pasar los siguientes asientos antes de re-procesar el balance:\n' +
        suggestedClosingEntries
          .filter((e) => !e.startsWith('Cierre del periodo'))
          .map((e, i) => `${i + 1}. ${e}`)
          .join('\n') +
        (periodoTipo === 'indeterminado'
          ? '\nSi el archivo es un corte intermedio, identifique el periodo con el mes ' +
            '(p. ej. "2025-06") para que se trate como corte parcial.'
          : ''),
      impact:
        'El informe NO es emitible como estados de cierre del ejercicio: la utilidad del periodo ' +
        'no está trasladada al patrimonio en los libros.',
      period: snapshot.period,
    });
  }

  if (pygAcumulado) {
    const movimiento = formatCents(BigInt(pygAcumulado.utilidadMovimientoRaw.replace('.', '')));
    const ingresosMov = formatCents(
      BigInt(pygAcumulado.ingresosNetosMovimientoRaw.replace('.', '')),
    );
    const description =
      `[${snapshot.period}] El periodo comparativo ${pygAcumulado.comparativePeriod} tiene ` +
      `resultado de $${formatCOPExact(pygAcumulado.utilidadComparativo)} que no ingresó al ` +
      `patrimonio de ${snapshot.period}: las cuentas de resultado de ${snapshot.period} pueden ` +
      `estar ACUMULADAS (${pygAcumulado.comparativePeriod} + ${snapshot.period}). Resultado ` +
      `publicado (saldo final de clases 4-7): $${formatCOPExact(pygAcumulado.utilidadPublicada)}. ` +
      `Si el P&G es acumulado, el resultado del ejercicio ${snapshot.period} sería ` +
      `$${movimiento} (saldo final − saldo ${pygAcumulado.comparativePeriod}) y los ingresos ` +
      `netos del ejercicio $${ingresosMov}. El sistema no transforma las cifras: confirme el ` +
      `cierre del periodo ${pygAcumulado.comparativePeriod} o cargue el balance con el P&G del ejercicio.`;

    if (pygAcumuladoBloqueante) {
      addCuratorBlocker(snapshot, 'CUR-R12', description);
    }
    findings.push({
      code: 'CUR-R12',
      severity: pygAcumuladoBloqueante ? 'critico' : 'alto',
      title: `P&G de ${snapshot.period} posiblemente ACUMULADO: el periodo ${pygAcumulado.comparativePeriod} no se cerró`,
      description: pygAcumuladoBloqueante
        ? description
        : `${description} El balance trae cuentas de dividendos (2360/35): si el resultado de ` +
          `${pygAcumulado.comparativePeriod} se distribuyó íntegramente, el P&G publicado es correcto.`,
      normReference: 'Decreto 2650/1993 (cierre de clases 4-7 contra 5905 y 36) + NIC 1 párr. 38 (comparativos)',
      recommendation: pygAcumuladoBloqueante
        ? `Pasar el asiento de cierre del periodo ${pygAcumulado.comparativePeriod} y volver a ` +
          `exportar, o confirmar que las cuentas de resultado de ${snapshot.period} son sólo del ejercicio.`
        : 'Confirmar con el contador si el resultado del periodo anterior se distribuyó o si el ' +
          'comparativo quedó sin cerrar.',
      impact: pygAcumuladoBloqueante
        ? 'El informe no es emitible: el resultado, los márgenes y la rentabilidad del ejercicio ' +
          'podrían incluir el resultado del periodo anterior.'
        : 'Riesgo de presentar como resultado del ejercicio un P&G acumulado.',
      period: snapshot.period,
    });
  }

  return { audit, findings, abortVirtualClose: librosNoCerrados };
}

// ---------------------------------------------------------------------------
// Comparativo no cerrado
// ---------------------------------------------------------------------------

function detectPygAcumulado(
  snapshot: PeriodSnapshot,
  prev: PeriodSnapshot | null,
): PygAcumuladoAudit | undefined {
  if (!prev) return undefined;
  const prevUtilidadCents = centsOf(prev, 'utilidadNeta');
  const prevUtilidad = Number(prevUtilidadCents) / 100;
  if (Math.abs(prevUtilidad) <= UTILIDAD_MATERIALITY) return undefined;

  // X = Activo − Pasivo − resultado del año (el patrimonio sin el resultado
  // propio). Invariante frente a R1 (mueve lo mismo a ambos lados) y R8 (no
  // toca activo, pasivo ni utilidad).
  const xNow =
    centsOf(snapshot, 'activo') - centsOf(snapshot, 'pasivo') - centsOf(snapshot, 'utilidadNeta');
  const xPrev = centsOf(prev, 'activo') - centsOf(prev, 'pasivo') - prevUtilidadCents;
  // Aportes, superávit y valorizaciones no son resultados: se descuentan.
  const deltaNoResultados =
    nonResultEquityCents(snapshot) - nonResultEquityCents(prev);
  const deltaResultadosAnteriores = xNow - xPrev - deltaNoResultados;

  const tolerance = pesosToCents(
    Math.max(Math.abs(prevUtilidad) * ACCUMULATED_TOLERANCE_PCT, ACCUMULATED_TOLERANCE_FLOOR),
  );
  const abs = deltaResultadosAnteriores < ZERO ? -deltaResultadosAnteriores : deltaResultadosAnteriores;
  if (abs >= tolerance) return undefined;

  const utilidadPublicadaCents = centsOf(snapshot, 'utilidadNeta');
  const ingresosNetosNow = centsOf(snapshot, 'ingresosNetos');
  const ingresosNetosPrev = centsOf(prev, 'ingresosNetos');
  return {
    comparativePeriod: prev.period,
    utilidadComparativo: prevUtilidad,
    utilidadPublicada: Number(utilidadPublicadaCents) / 100,
    utilidadMovimientoRaw: centsToCanonical(utilidadPublicadaCents - prevUtilidadCents),
    ingresosNetosMovimientoRaw: centsToCanonical(ingresosNetosNow - ingresosNetosPrev),
    variacionResultadosAnterioresRaw: centsToCanonical(deltaResultadosAnteriores),
  };
}

type CentsKey = 'activo' | 'pasivo' | 'utilidadNeta' | 'ingresosNetos';

function centsOf(snap: PeriodSnapshot, key: CentsKey): bigint {
  const cents = snap.controlTotals.cents;
  if (cents) return cents[key];
  const ct = snap.controlTotals;
  const value =
    key === 'ingresosNetos' ? (ct.ingresosNetos ?? Math.abs(ct.ingresos)) : ct[key];
  return pesosToCents(value);
}

function nonResultEquityCents(snap: PeriodSnapshot): bigint {
  const class3 = snap.classes.find((c) => c.code === 3);
  let acc = ZERO;
  for (const a of class3?.accounts ?? []) {
    if (NON_RESULT_EQUITY_GROUPS.some((g) => a.code.startsWith(g))) acc += pesosToCents(a.balance);
  }
  return acc;
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

function formatCOPExact(amount: number): string {
  return formatCents(pesosToCents(amount));
}

/** Centavos exactos → "1.234.567,89" sin pasar por float. */
function formatCents(cents: bigint): string {
  const canonical = centsToCanonical(cents);
  const negative = canonical.startsWith('-');
  const [intPart, frac] = (negative ? canonical.slice(1) : canonical).split('.');
  const withDots = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}${withDots},${frac}`;
}
