// ---------------------------------------------------------------------------
// R5 — Coherencia patrimonial (Balance ↔ desglose del ECP)
// ---------------------------------------------------------------------------
// El Balance presenta un Total Patrimonio = Σ de las cuentas de la clase 3. El
// Estado de Cambios en el Patrimonio (ECP) se arma con los componentes de
// `equityBreakdown` (capital, superávit, reservas, revalorización, resultados,
// valorizaciones…). NIC 1 párr. 106: el saldo final de cada componente del
// ECP debe coincidir con el Balance.
//
// Auditoría 2026-09 (recalculo-08): la versión anterior ANCLABA
// `controlTotals.patrimonio` a la suma del desglose. Como el desglose sólo
// mapeaba 3105/3115/3120/3305/33/3605/3610/3705/3710, en balances sin P&G
// (R8 no actúa) los grupos 32, 34, 35, 38 y otras 37xx desaparecían del
// patrimonio publicado: un balance cuadrado de $250M salía con $150M.
//
// Contrato vigente:
//   - R5 NO muta el balance. El patrimonio publicado es SIEMPRE Σ clase 3.
//   - El desglose cubre todos los grupos de la clase 3 (ver
//     `extractEquityBreakdownForView`), así que en un balance sano la suma de
//     componentes coincide al centavo con el total.
//   - Si no coincide (p. ej. cuentas agregadas que no suman a sus auxiliares
//     o una mutación posterior no reflejada en el desglose), la brecha se
//     revela con su monto y BLOQUEA la emisión: un ECP que no concilia con el
//     Balance no se puede firmar.
// ---------------------------------------------------------------------------

import type { EquityBreakdown, PeriodSnapshot } from '../trial-balance';

import { addCuratorBlocker, clearCuratorBlockers } from './curator-blockers';
import { centsToCanonical, pesosToCents } from './sync-control-totals';
import type { ConvergenceAdjustment, CuratorFinding } from './types';

export interface R5Result {
  /**
   * Histórico: ajuste absorbido por R5. Desde la auditoría 2026-09 R5 no
   * absorbe brechas, así que queda siempre `undefined`.
   */
  convergenceAdjustment?: ConvergenceAdjustment;
  findings: CuratorFinding[];
}

/**
 * Componentes del desglose que SUMAN al patrimonio. `capitalAutorizado` es
 * informativo (3105 ya es neto de lo no suscrito) y `convergenceAdjustment`
 * es un histórico de R5.
 */
const EQUITY_COMPONENTS: ReadonlyArray<keyof EquityBreakdown> = [
  'capitalSuscritoPagado',
  'superavitCapital',
  'reservaLegal',
  'otrasReservas',
  'revalorizacionPatrimonio',
  'dividendosDecretadosEnAcciones',
  'utilidadEjercicio',
  'utilidadesAcumuladas',
  'superavitValorizaciones',
  'otrasCuentasPatrimonio',
];

const ZERO = BigInt(0);

export function runR5(
  snapshot: PeriodSnapshot,
  _prev: PeriodSnapshot | null,
): R5Result {
  void _prev;
  clearCuratorBlockers(snapshot, 'CUR-R5');

  const eb = snapshot.equityBreakdown;
  let componentsFound = false;
  let ecpCents = ZERO;
  for (const key of EQUITY_COMPONENTS) {
    const value = eb[key];
    if (typeof value !== 'number') continue;
    componentsFound = true;
    ecpCents += pesosToCents(value);
  }

  // Sin componentes detectados, el ECP no es construible — no aplicamos.
  if (!componentsFound) return { findings: [] };

  const patrimonioCents =
    snapshot.controlTotals.cents?.patrimonio ?? pesosToCents(snapshot.controlTotals.patrimonio);
  const gapCents = ecpCents - patrimonioCents;
  if (gapCents === ZERO) return { findings: [] };

  const ecp = formatCents(ecpCents);
  const balance = formatCents(patrimonioCents);
  const gap = formatCents(gapCents);
  const message =
    `[${snapshot.period}] El desglose del patrimonio para el Estado de Cambios en el ` +
    `Patrimonio suma $${ecp} y el total de la clase 3 del balance es $${balance}: ` +
    `diferencia $${gap}. El sistema no ajusta el patrimonio para forzar la ` +
    `conciliación. Revise cuentas agregadas de la clase 3 que no suman a sus auxiliares.`;
  addCuratorBlocker(snapshot, 'CUR-R5', message);

  const finding: CuratorFinding = {
    code: 'CUR-R5',
    severity: 'critico',
    title: 'El desglose del patrimonio (ECP) no concilia con el Balance',
    description: message,
    normReference: 'NIC 1 párr. 106 (conciliación de cada componente del patrimonio)',
    recommendation:
      'Corregir el archivo de origen para que cada cuenta del patrimonio coincida con la ' +
      'suma de sus auxiliares y volver a procesar.',
    impact:
      `El informe no es emitible: el ECP y el Balance presentarían patrimonios distintos ` +
      `(diferencia $${gap}).`,
    period: snapshot.period,
  };

  return { findings: [finding] };
}

/** Centavos exactos → "$1.234.567,89" sin pasar por float. */
function formatCents(cents: bigint): string {
  const canonical = centsToCanonical(cents); // "-1234567.89"
  const negative = canonical.startsWith('-');
  const [intPart, frac] = (negative ? canonical.slice(1) : canonical).split('.');
  const withDots = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}${withDots},${frac}`;
}
