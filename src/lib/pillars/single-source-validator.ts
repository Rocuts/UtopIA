// ---------------------------------------------------------------------------
// Single Source of Truth Validator — Coherencia Inter-Pilar
// ---------------------------------------------------------------------------
// Verifica que los 4 pilares (Valor / Escudo / Verdad / Futuro) consumen el
// MISMO objeto JSON canónico generado por el Curator. A diferencia del
// `sync-validator.ts` (drift INTRA-card por cálculo), este módulo valida que
// la `utilidadNeta` raíz, los ingresos canónicos, la caja y el patrimonio
// sean CONSISTENTES entre los 4 pilares simultáneamente.
//
// Principios:
//   - DETERMINÍSTICO: mismo input → mismo output. Sin LLM, sin Math.random.
//   - NO DESTRUCTIVO: sólo lectura.
//   - TOLERANCIA: $1.000 COP (redondeo aceptable en balances PUC).
//   - HASH CANÓNICO: md5 del string "utilidadNeta|ingresos|activo|pasivo|patrimonio"
//     sirve como session-id del balance procesado para audit log.
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';

import type { PeriodSnapshot } from '@/lib/preprocessing/trial-balance';

import type { PillarsResult } from './types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type CoherenceSeverity = 'ok' | 'warning' | 'critical';

export interface CoherenceFinding {
  /** Identificador estable. Ej: 'UTILIDAD_NETA_INCOHERENT'. */
  code: string;
  severity: CoherenceSeverity;
  /** Campo afectado (e.g. "utilidadNeta"). */
  field: string;
  /** Valor que cada pilar tiene para el field, más el canonical del snapshot. */
  values: Record<'valor' | 'escudo' | 'verdad' | 'futuro' | 'snapshot', number | null>;
  /** Diferencia max − min entre los valores (null-safe). */
  spread: number;
  messageEs: string;
  messageEn: string;
}

export interface CoherenceReport {
  /** True si TODOS los chequeos cuadran dentro de tolerancia. */
  consistent: boolean;
  /** Severidad agregada del peor finding. */
  severity: CoherenceSeverity;
  /** Findings inter-pilar detectados. Vacío si consistent=true. */
  findings: CoherenceFinding[];
  /** Hash md5 determinístico de los 5 totales canónicos del snapshot. */
  canonicalHash: string;
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Tolerancia (calibrada a CFO colombiano 2026)
// ---------------------------------------------------------------------------

const COP_TOLERANCE = 1_000;

// ---------------------------------------------------------------------------
// API principal
// ---------------------------------------------------------------------------

/**
 * Valida que los 4 pilares consuman el mismo objeto JSON canónico.
 *
 * @param metrics  Resultado consolidado de los 4 pilares.
 * @param snapshot PeriodSnapshot post-Curator (fuente canónica).
 */
export function validateCrossPillarCoherence(
  metrics: PillarsResult,
  snapshot: PeriodSnapshot,
): CoherenceReport {
  const findings: CoherenceFinding[] = [];
  const ct = snapshot.controlTotals;

  // Shorthand a los audits de tarjetas ejecutivas
  const valorAudit = metrics.valor.executiveCards?.audit ?? null;
  const escudoAudit = metrics.escudo.escudoCards?.audit ?? null;
  const verdadAudit = metrics.verdad.verdadCards?.audit ?? null;
  const futuroAudit = metrics.futuro.futuroCards?.audit ?? null;

  // ── 1. Utilidad Neta inter-pilar ─────────────────────────────────────────
  // VALOR: utilidadOperacional = utilidadNeta + impuestosCuenta24
  //        → utNeta ≈ valorAudit.utilidadOperacional − ct.impuestosCuenta24
  const utNetaValor =
    valorAudit !== null
      ? valorAudit.utilidadOperacional - ct.impuestosCuenta24
      : null;

  // ESCUDO: rentaTeorica = utilidadNeta × 0.35
  //         → utNeta ≈ rentaTeorica / 0.35
  const utNetaEscudo =
    escudoAudit !== null
      ? escudoAudit.rentaTeorica / 0.35
      : null;

  // VERDAD: no expone utilidadNeta directamente; usamos el snapshot.
  const utNetaVerdad = ct.utilidadNeta; // mismo canal que snapshot

  // FUTURO: utilidadProyectadaAnual = max(0, utilidadNeta) × (1 + CAGR ?? 0.05)
  //         → si utilidadNeta > 0: utNeta ≈ utilidadProyectadaAnual / (1 + cagr)
  let utNetaFuturo: number | null = null;
  if (futuroAudit !== null) {
    const cagr = futuroAudit.cagrIngresos ?? 0.05;
    const divisor = 1 + cagr;
    // utilidadProyectadaAnual usa max(0, utilidadNeta), así que sólo es
    // reversible cuando utilidadNeta ≥ 0.
    if (divisor !== 0) {
      utNetaFuturo = futuroAudit.utilidadProyectadaAnual / divisor;
    }
  }

  const utNetaSnapshot = ct.utilidadNeta;

  const utNetaFinding = checkNumericField({
    code: 'UTILIDAD_NETA_INCOHERENT',
    field: 'utilidadNeta',
    snapshot: utNetaSnapshot,
    valor: utNetaValor,
    escudo: utNetaEscudo,
    // VERDAD coincide con snapshot por definición (misma fuente) — incluimos
    // para completitud del audit trail.
    verdad: utNetaVerdad,
    futuro: utNetaFuturo,
    tolerance: COP_TOLERANCE,
    severity: 'critical',
    messageEs: (spread) =>
      `Utilidad neta inconsistente entre pilares: diferencia $${formatCop(spread)}. Bus de datos roto — los pilares no leen el mismo snapshot.`,
    messageEn: (spread) =>
      `Net income inconsistent across pillars: spread $${formatCop(spread)}. Data bus broken — pillars are not reading the same snapshot.`,
  });
  if (utNetaFinding) findings.push(utNetaFinding);

  // ── 2. Ingresos inter-pilar ──────────────────────────────────────────────
  // VALOR: totalIngresos
  const ingresosValor = valorAudit?.totalIngresos ?? null;
  // FUTURO: ingresosActuales
  const ingresosFuturo = futuroAudit?.ingresosActuales ?? null;
  // ESCUDO/VERDAD: no exponen ingresos directamente — omitimos (null).
  const ingresosSnapshot = ct.ingresos;

  const ingresosFinding = checkNumericField({
    code: 'INGRESOS_INCOHERENT',
    field: 'ingresos',
    snapshot: ingresosSnapshot,
    valor: ingresosValor,
    escudo: null,
    verdad: null,
    futuro: ingresosFuturo,
    tolerance: COP_TOLERANCE,
    severity: 'warning',
    messageEs: (spread) =>
      `Ingresos inconsistentes entre pilares Valor/Futuro: diferencia $${formatCop(spread)}.`,
    messageEn: (spread) =>
      `Revenue inconsistent between Valor/Futuro pillars: spread $${formatCop(spread)}.`,
  });
  if (ingresosFinding) findings.push(ingresosFinding);

  // ── 3. Caja inter-pilar ──────────────────────────────────────────────────
  // ESCUDO: efectivoCuenta11
  const cajaEscudo = escudoAudit?.efectivoCuenta11 ?? null;
  const cajaSnapshot = ct.efectivoCuenta11;

  const cajaFinding = checkNumericField({
    code: 'CAJA_INCOHERENT',
    field: 'efectivoCuenta11',
    snapshot: cajaSnapshot,
    valor: null,
    escudo: cajaEscudo,
    verdad: null,
    futuro: null,
    tolerance: COP_TOLERANCE,
    severity: 'warning',
    messageEs: (spread) =>
      `Caja (PUC 11) inconsistente en pilar Escudo vs snapshot: diferencia $${formatCop(spread)}.`,
    messageEn: (spread) =>
      `Cash (PUC 11) inconsistent in Escudo pillar vs snapshot: spread $${formatCop(spread)}.`,
  });
  if (cajaFinding) findings.push(cajaFinding);

  // ── 4. Patrimonio post-R8 ────────────────────────────────────────────────
  // controlTotals.patrimonio === summary.totalEquity
  // VERDAD: equationGap === activo − pasivo − patrimonio del snapshot
  const patrimonioSnapshot = ct.patrimonio;
  const patrimonioSummary = snapshot.summary.totalEquity;
  const spreadPatrimonio = Math.abs(patrimonioSnapshot - patrimonioSummary);

  if (spreadPatrimonio > COP_TOLERANCE) {
    findings.push({
      code: 'PATRIMONIO_DESYNC',
      severity: 'warning',
      field: 'patrimonio',
      values: {
        valor: null,
        escudo: null,
        verdad: verdadAudit !== null
          ? ct.activo - ct.pasivo - verdadAudit.equationGap
          : null,
        futuro: null,
        snapshot: patrimonioSnapshot,
      },
      spread: spreadPatrimonio,
      messageEs: `Patrimonio de controlTotals ($${formatCop(patrimonioSnapshot)}) difiere de summary.totalEquity ($${formatCop(patrimonioSummary)}).`,
      messageEn: `controlTotals.patrimonio ($${formatCop(patrimonioSnapshot)}) differs from summary.totalEquity ($${formatCop(patrimonioSummary)}).`,
    });
  }

  // Adicionalmente: equationGap de VERDAD debe coincidir con snapshot
  if (verdadAudit !== null) {
    const expectedGap = ct.activo - ct.pasivo - ct.patrimonio;
    const gapDrift = Math.abs(verdadAudit.equationGap - expectedGap);
    if (gapDrift > COP_TOLERANCE) {
      findings.push({
        code: 'EQUATION_GAP_INCOHERENT',
        severity: 'warning',
        field: 'equationGap (verdad)',
        values: {
          valor: null,
          escudo: null,
          verdad: verdadAudit.equationGap,
          futuro: null,
          snapshot: expectedGap,
        },
        spread: gapDrift,
        messageEs: `equationGap del pilar Verdad (${formatCop(verdadAudit.equationGap)}) difiere del recalculado (${formatCop(expectedGap)}).`,
        messageEn: `Verdad pillar equationGap (${formatCop(verdadAudit.equationGap)}) differs from snapshot recomputed (${formatCop(expectedGap)}).`,
      });
    }
  }

  // ── Hash canónico ────────────────────────────────────────────────────────
  const canonicalHash = computeCanonicalHash(
    ct.utilidadNeta,
    ct.ingresos,
    ct.activo,
    ct.pasivo,
    ct.patrimonio,
  );

  const severity = aggregateSeverity(findings);

  return {
    consistent: findings.length === 0,
    severity,
    findings,
    canonicalHash,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

interface NumericCheckArgs {
  code: string;
  field: string;
  snapshot: number;
  valor: number | null;
  escudo: number | null;
  verdad: number | null;
  futuro: number | null;
  tolerance: number;
  severity: CoherenceSeverity;
  messageEs: (spread: number) => string;
  messageEn: (spread: number) => string;
}

/**
 * Compara los valores que cada pilar expone para `field` contra el `snapshot`
 * canónico. Emite un finding sólo si alguna diferencia material supera la
 * tolerancia.
 */
function checkNumericField(args: NumericCheckArgs): CoherenceFinding | null {
  const {
    code, field, snapshot, valor, escudo, verdad, futuro,
    tolerance, severity, messageEs, messageEn,
  } = args;

  // Sólo comparamos los valores no-null contra snapshot.
  const availables: number[] = [snapshot];
  if (valor !== null) availables.push(valor);
  if (escudo !== null) availables.push(escudo);
  if (verdad !== null) availables.push(verdad);
  if (futuro !== null) availables.push(futuro);

  const max = Math.max(...availables);
  const min = Math.min(...availables);
  const spread = max - min;

  if (spread <= tolerance) return null;

  return {
    code,
    severity,
    field,
    values: { valor, escudo, verdad, futuro, snapshot },
    spread,
    messageEs: messageEs(spread),
    messageEn: messageEn(spread),
  };
}

function aggregateSeverity(findings: CoherenceFinding[]): CoherenceSeverity {
  if (findings.some((f) => f.severity === 'critical')) return 'critical';
  if (findings.some((f) => f.severity === 'warning')) return 'warning';
  return 'ok';
}

/**
 * Hash md5 determinístico sobre los 5 totales canónicos del snapshot.
 * Sirve como session-id del balance procesado para audit log.
 */
function computeCanonicalHash(
  utilidadNeta: number,
  ingresos: number,
  activo: number,
  pasivo: number,
  patrimonio: number,
): string {
  const input = `${utilidadNeta}|${ingresos}|${activo}|${pasivo}|${patrimonio}`;
  return createHash('md5').update(input).digest('hex');
}

function formatCop(amount: number): string {
  return Math.abs(amount).toLocaleString('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}
