// ---------------------------------------------------------------------------
// Reglas de presentación compartidas por el PDF Élite y el Excel
// ---------------------------------------------------------------------------
// Un solo sitio para las decisiones de presentación que, duplicadas, hicieron
// que el mismo informe dijera cosas distintas en cada entregable (auditoría de
// exportes 2026-09): signo de las correctoras, rótulo de pérdida, fecha de
// corte, moneda, citas normativas y leyenda de comparativo no presentado.
// ---------------------------------------------------------------------------

import { isContraAsset } from '@/lib/preprocessing/curator-rules/contra-asset-registry';

const ZERO = BigInt(0);

/**
 * Importe con el signo con que debe IMPRIMIRSE un renglón de estado.
 *
 * Las cuentas correctoras (1592 depreciación acumulada, 1399 deterioro, …)
 * viajan en valor absoluto (`isAbsolute = true`) aunque RESTEN; E15 las resta
 * por código PUC. Imprimirlas en positivo hace que la columna no sume el total
 * impreso (reportes-export-17): se presentan como negativo para que el lector
 * reconstruya el total. El resto de renglones conserva su signo tal cual.
 */
export function presentedLineCents(
  account: string | null,
  amount: bigint,
  isAbsolute: boolean,
): bigint {
  if (account && isAbsolute && isContraAsset(account)) {
    return amount > ZERO ? -amount : amount;
  }
  return amount;
}

export type IncomeTotalKind = 'gross' | 'operating' | 'net';

const INCOME_TOTAL_LABELS: Record<IncomeTotalKind, { profit: string; loss: string }> = {
  gross: { profit: 'UTILIDAD BRUTA', loss: 'PÉRDIDA BRUTA' },
  operating: { profit: 'UTILIDAD OPERATIVA (EBIT)', loss: 'PÉRDIDA OPERATIVA (EBIT)' },
  net: { profit: 'UTILIDAD NETA DEL PERÍODO', loss: 'PÉRDIDA NETA DEL PERÍODO' },
};

/** Rótulo de un total del ERI según el signo del periodo actual. */
export function incomeTotalLabel(kind: IncomeTotalKind, primaryCents: bigint): string {
  const l = INCOME_TOTAL_LABELS[kind];
  return primaryCents < ZERO ? l.loss : l.profit;
}

/** Ambos rótulos posibles (para no duplicar un total que el analista ya emitió). */
export function incomeTotalLabelVariants(kind: IncomeTotalKind): string[] {
  const l = INCOME_TOTAL_LABELS[kind];
  return [l.profit, l.loss];
}

export type PeriodoTipo = 'cerrado' | 'parcial' | 'indeterminado';

export interface StatementDateContext {
  fiscalPeriod: string;
  comparativePeriod: string | null;
  /** Tipo de periodo inferido del archivo (preprocesador). Sin dato → no se supone el 31-dic. */
  primaryPeriodoTipo?: PeriodoTipo | null;
  comparativePeriodoTipo?: PeriodoTipo | null;
}

export const CURRENCY_NOTE = 'Cifras expresadas en pesos colombianos (COP), con centavos';

interface SnapshotPeriodLike {
  period?: unknown;
  periodoTipo?: PeriodoTipo | null;
}

/**
 * Tipo de periodo (año completo / corte parcial) que el preprocesador infirió
 * del archivo, SÓLO cuando el snapshot corresponde al mismo año que declara el
 * informe. Sin esa coincidencia no se afirma una fecha de corte.
 */
export function resolvePeriodoTipos(
  fiscalPeriod: string,
  comparativePeriod: string | null,
  primary: SnapshotPeriodLike | null | undefined,
  comparative: SnapshotPeriodLike | null | undefined,
): { primaryPeriodoTipo: PeriodoTipo | null; comparativePeriodoTipo: PeriodoTipo | null } {
  const tipoFor = (snap: SnapshotPeriodLike | null | undefined, year: string | null) =>
    snap && year && typeof snap.period === 'string' && snap.period.includes(year)
      ? snap.periodoTipo ?? null
      : null;
  return {
    primaryPeriodoTipo: tipoFor(primary, fiscalPeriod),
    comparativePeriodoTipo: tipoFor(comparative, comparativePeriod),
  };
}

/**
 * Advertencia que acompaña la narrativa redactada por el LLM (resumen, KPIs
 * narrativos, notas en prosa). Sus cifras no se reconcilian automáticamente con
 * los estados validados (reportes-export-11): se exportan rotuladas, no como
 * cifras certificadas.
 */
export const NARRATIVE_DISCLAIMER =
  'Narrativa generada por IA — no auditada: sus cifras no se contrastan automáticamente con los ' +
  'estados financieros validados. Las cifras vinculantes son las de los estados.';

/**
 * Fecha de corte (ESF) o periodo cubierto (ERI/EFE/ECP), derivada de los datos.
 * NIIF para las PYMES 3.23 exige mostrar de forma destacada la fecha de cierre y
 * el periodo cubierto. El año solo no lo identifica y `fiscalPeriod` puede ser
 * un corte parcial: sólo se afirma el 31 de diciembre cuando el preprocesador
 * clasificó el periodo como año completo ('cerrado').
 */
export function statementDateLabel(kind: 'position' | 'period', ctx: StatementDateContext): string {
  const { fiscalPeriod: fp, comparativePeriod: cp } = ctx;
  const closed = ctx.primaryPeriodoTipo === 'cerrado';
  const compClosed = ctx.comparativePeriodoTipo === 'cerrado';
  if (!closed) {
    return `Periodo ${fp}${cp ? ` y ${cp}` : ''} — fecha de corte no identificada en el archivo fuente`;
  }
  const compSuffix = cp
    ? compClosed
      ? ` y ${cp}`
      : ` (comparativo ${cp}: fecha de corte no identificada)`
    : '';
  return kind === 'position'
    ? `Al 31 de diciembre de ${fp}${compSuffix}`
    : `Por el año terminado el 31 de diciembre de ${fp}${compSuffix}`;
}

/**
 * Leyenda cuando el informe declara comparativo pero el estado sólo trae el
 * periodo actual (el contrato NIIF no tiene columnas comparativas para EFE ni
 * filas del ECP del año anterior). NIIF para las PYMES 3.14 exige comparativos
 * para todos los importes; no se presenta en silencio (reportes-export-13).
 */
export function comparativeNotPresentedLegend(comparativePeriod: string | null): string | null {
  if (!comparativePeriod) return null;
  return (
    `Información comparativa ${comparativePeriod} no presentada en este estado: el informe ` +
    `no contiene las cifras del periodo anterior para este estado (NIIF para las PYMES 3.14). ` +
    `No debe leerse como un conjunto comparativo completo.`
  );
}

export type StatementKind = 'balance' | 'income' | 'cashFlow' | 'equity';

/**
 * Citas normativas por estado según el grupo NIIF de la empresa.
 *
 * Corrige reportes-export-16: el PDF citaba "NIIF 1.10" (adopción por primera
 * vez), "NIIF 5.36" (activos mantenidos para la venta), "NIIF 7" (revelaciones
 * de instrumentos financieros) y "NIIF 6.20" (recursos minerales) como base de
 * los estados. La base es:
 *   - Grupo 2 (NIIF para las PYMES): Secciones 4, 5, 7 y 6.
 *   - Grupo 1 (NIIF plenas): NIC 1 (párr. 54, 81A, 106) y NIC 7.
 *   - Grupo 3 (microempresas): marco técnico del Anexo 3 del DUR 2420/2015.
 * Sin grupo declarado se muestran las dos referencias que prescribe la spec
 * v10.1 (sección PYMES + NIC). NIIF 18 no se cita: no está incorporada al
 * marco técnico colombiano vigente.
 */
export function statementCitations(kind: StatementKind, niifGroup: 1 | 2 | 3 | null | undefined): string[] {
  const pymes: Record<StatementKind, string> = {
    balance: 'NIIF PYMES Secc. 4',
    income: 'NIIF PYMES Secc. 5',
    cashFlow: 'NIIF PYMES Secc. 7',
    equity: 'NIIF PYMES Secc. 6',
  };
  const plenas: Record<StatementKind, string> = {
    balance: 'NIC 1.54',
    income: 'NIC 1.81A',
    cashFlow: 'NIC 7',
    equity: 'NIC 1.106',
  };
  if (niifGroup === 1) return [plenas[kind]];
  if (niifGroup === 2) return [pymes[kind]];
  if (niifGroup === 3) return ['DUR 2420/2015 Anexo 3'];
  return [pymes[kind], plenas[kind]];
}
