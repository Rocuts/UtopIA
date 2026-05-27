// ---------------------------------------------------------------------------
// Fiscal Anchor — Entry point del módulo
// ---------------------------------------------------------------------------
// `buildFiscalAnchor` orquesta extractor → calculator → calendar → alerts →
// shell y devuelve el `FiscalAnchorBlock` listo para serializar al stream
// Escudo. Es una computación pura — cero LLM, cero red, totalmente
// determinística sobre el balance preprocesado.
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import type { CompanyContext } from '../types';
import type { FiscalAnchorBlock } from './types';
import { extractFiscalBaseFromTrialBalance } from './extractor';
import { deriveFiscalAnchorMetrics } from './calculator';
import type { FiscalDerivedMetrics } from './internal-types';
import { buildCalendarioDian } from './dian-calendar';
import { evaluateFiscalAlerts } from './alerts';
import { buildFiscalAnchorBlockShell } from './block-builder';

const ZERO = BigInt(0);

export interface BuildFiscalAnchorInput {
  preprocessed: PreprocessedBalance;
  company: CompanyContext;
  /** Fecha de cálculo. El orchestrator pasa `new Date()`. */
  hoy: Date;
  /**
   * NIT extraído del archivo (`ExtractedCompanyMetadata.nitFromFile`). Si el
   * intake provee uno distinto en `company.nit`, el del intake gana porque es
   * el contrato del usuario; el del archivo es fallback.
   */
  nitFromFile?: string | null;
}

/**
 * Compone el bloque Âncora Fiscal F01..F10 + Calendario DIAN + Alertas.
 */
export function buildFiscalAnchor(input: BuildFiscalAnchorInput): FiscalAnchorBlock {
  const { preprocessed, company, hoy, nitFromFile } = input;
  const primary = preprocessed.primary;
  const totals = primary.controlTotals;

  // --- F01 (UAI) e impuestoCausado desde controlTotals.cents (BigInt). ----
  // El preprocesador SIEMPRE popula `cents` desde `buildSnapshotForPeriod`;
  // sólo tests legacy construyen `ControlTotals` sin él. Caemos al campo
  // `utilidadNeta` (number) sólo si `cents` no estuviera presente.
  let uaiCents = ZERO;
  let impuestoCausadoCents = ZERO;
  if (totals.cents) {
    uaiCents = totals.cents.utilidadAntesImpuestos;
    impuestoCausadoCents = totals.cents.impuestoCausado;
  } else {
    uaiCents = BigInt(Math.round(totals.utilidadNeta * 100));
    impuestoCausadoCents = ZERO;
  }

  // --- Extractor + calculator (cifras crudas + derivadas en BigInt). ------
  const raw = extractFiscalBaseFromTrialBalance(primary);
  const metrics = deriveFiscalAnchorMetrics({
    uaiCents,
    impuestoCausadoCents,
    raw,
  });

  // --- Calendario DIAN. ---------------------------------------------------
  // Prioridad NIT: company.nit (intake usuario) > nitFromFile (archivo) > null.
  const effectiveNit = company.nit ?? nitFromFile ?? null;
  const calendarioDian = buildCalendarioDian({
    nit: effectiveNit,
    hoy,
    metrics,
    periodo: extractYearFromPeriod(primary.period) ?? String(hoy.getUTCFullYear()),
  });
  // --- Alertas. -----------------------------------------------------------
  const alertas = evaluateFiscalAlerts({
    metrics,
    impuestoCausadoCents,
    calendario: calendarioDian,
  });

  // --- Procedencia. -------------------------------------------------------
  const balanceHash = hashFiscalSnapshot(metrics, primary.period);

  return buildFiscalAnchorBlockShell({
    metrics,
    calendarioDian,
    alertas,
    fuente: { periodo: primary.period, balanceHash },
  });
}

/**
 * Intenta interpretar el `period` del snapshot como un año (4 dígitos). Devuelve
 * `null` si la etiqueta es 'current' u otra cadena no-numérica — el caller
 * cae al año de `hoy`.
 */
function extractYearFromPeriod(period: string): string | null {
  return /^20\d{2}$/.test(period) ? period : null;
}

/**
 * Hash determinístico (sha256-12) sobre las 10 cifras y el periodo para
 * trazabilidad del bloque. Permite diff entre corridas sobre el mismo balance.
 */
function hashFiscalSnapshot(
  metrics: FiscalDerivedMetrics,
  periodo: string,
): string {
  const payload = [
    periodo,
    metrics.f01Cents.toString(),
    metrics.f02Cents.toString(),
    metrics.f03Cents.toString(),
    metrics.f04Cents.toString(),
    metrics.f05Cents.toString(),
    metrics.f06Cents.toString(),
    metrics.f07Cents.toString(),
    metrics.f08Cents.toString(),
    String(metrics.f09Pct),
    String(metrics.f10Pct),
  ].join('|');
  return createHash('sha256').update(payload).digest('hex').slice(0, 12);
}

// ---------------------------------------------------------------------------
// Re-exports — single import surface para los consumers (orchestrator, tests).
// ---------------------------------------------------------------------------
export * from './types';
export { buildFiscalAnchorBlockMarkdown } from './block-builder';
export { extractLastDigit } from './dian-calendar';
