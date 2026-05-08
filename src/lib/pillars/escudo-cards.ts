// ---------------------------------------------------------------------------
// Pilar ESCUDO — 4 Tarjetas Ejecutivas (vista del dueño / CFO)
// ---------------------------------------------------------------------------
// Tarjetas:
//   1. Autonomía Financiera  — azul   — Días que la empresa opera sin ventas
//   2. Cobertura de Pasivos  — naranja — Activo Corriente / Pasivo Corriente
//   3. Reserva Fiscal        — morada  — Provisión 24 − Renta teórica 35%
//   4. Brecha Escudo         — verde   — Caja(11) − Proveedores(2205)
//
// Fuente de la verdad:
//   - snapshot.controlTotals (post-Curator garantiza totales sincronizados).
//   - snapshot.classes (granularidad por prefijo PUC para 12, 21-24, 2205).
//   - comparative snapshot opcional → deltas vs periodo anterior.
//
// TypeScript estricto — sin `any`.
// ---------------------------------------------------------------------------

import type { PUCClass } from '@/lib/preprocessing/trial-balance';

import type {
  EscudoExecutiveCards,
  EscudoExecutiveCardsAudit,
  ExecutiveCard,
  PillarStatus,
  PillarsAggregateInput,
} from './types';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Tasa de impuesto de renta — Art. 240 E.T. Colombia 2026. */
export const RENTA_RATE = 0.35;

// ---------------------------------------------------------------------------
// Helpers (puros, internos)
// ---------------------------------------------------------------------------

/** Ignora cuentas virtuales del Curator (sufijo VC, ZZ, prefijo 2810ZZ-, 3710ZZ). */
function isVirtualCuratorAccount(code: string): boolean {
  return (
    code.endsWith('VC') ||
    code.endsWith('ZZ') ||
    code.startsWith('2810ZZ-') ||
    code.startsWith('3710ZZ')
  );
}

/** Suma saldos de cuentas en una clase PUC cuyos códigos comiencen con
 *  CUALQUIERA de los prefijos dados. Ignora cuentas virtuales del Curator. */
function sumClassByPrefixes(
  cl: PUCClass | undefined,
  prefixes: string[],
): number {
  if (!cl) return 0;
  return cl.accounts
    .filter((a) => prefixes.some((p) => a.code.startsWith(p)))
    .filter((a) => !isVirtualCuratorAccount(a.code))
    .reduce((s, a) => s + a.balance, 0);
}

/** Delta null-seguro entre valor actual y anterior. */
function safeDelta(curr: number | null, prev: number | null): number | null {
  if (curr === null || prev === null) return null;
  return curr - prev;
}

// ---------------------------------------------------------------------------
// Cómputo del promedio mensual de egresos (lógica de períodos)
// ---------------------------------------------------------------------------

/**
 * Calcula el promedio mensual de egresos considerando el snapshot actual y,
 * opcionalmente, el comparativo. Pragmático:
 *   - 1 período: totalEgresos / 12.
 *   - 2 períodos (con comparative): promedio de ambos / 12.
 */
function computeAvgMonthlyEgresos(
  snapshotEgresos: number,
  comparativeEgresos?: number,
): { avg: number; periodosUsados: number } {
  if (comparativeEgresos !== undefined && comparativeEgresos > 0) {
    const avg = (snapshotEgresos + comparativeEgresos) / 2 / 12;
    return { avg, periodosUsados: 2 };
  }
  return { avg: snapshotEgresos / 12, periodosUsados: 1 };
}

// ---------------------------------------------------------------------------
// Status thresholds
// ---------------------------------------------------------------------------

/** Autonomía financiera en días (higher-better). */
function autonomiaStatus(days: number | null): PillarStatus {
  if (days === null) return 'watch';
  if (days >= 90) return 'healthy';
  if (days >= 45) return 'watch';
  if (days >= 30) return 'warning';
  return 'critical';
}

/** Cobertura de pasivos — ratio (higher-better). */
function coberturaStatus(ratio: number | null): PillarStatus {
  if (ratio === null) return 'watch';
  if (ratio >= 1.5) return 'healthy';
  if (ratio >= 1.2) return 'watch';
  if (ratio >= 1.0) return 'warning';
  return 'critical';
}

/** Reserva fiscal — brecha COP (negativo = déficit). */
function reservaStatus(brecha: number | null, rentaTeorica: number): PillarStatus {
  if (brecha === null) return 'watch';
  // Sin utilidad → sin riesgo
  if (rentaTeorica <= 0) return 'healthy';
  if (brecha >= 0) return 'healthy';
  if (brecha > -rentaTeorica * 0.2) return 'watch';
  if (brecha > -rentaTeorica * 0.5) return 'warning';
  return 'critical';
}

/** Brecha escudo = caja − proveedores. */
function brechaStatus(
  brecha: number | null,
  proveedores: number,
): PillarStatus {
  if (brecha === null) return 'watch';
  if (proveedores <= 0) return 'healthy';
  if (brecha >= proveedores * 0.5) return 'healthy'; // caja cubre 1.5× (≥50% extra)
  if (brecha >= 0) return 'watch';
  return 'critical';
}

// ---------------------------------------------------------------------------
// Helper: extraer audit de un snapshot (para deltas)
// ---------------------------------------------------------------------------

function buildEscudoAudit(
  snapshot: PillarsAggregateInput['snapshot'],
  avgMonthlyEgresos: number,
  periodosUsados: number,
): EscudoExecutiveCardsAudit {
  const ct = snapshot.controlTotals;
  const classes = snapshot.classes;

  const clase1 = classes.find((c) => c.code === 1);
  const clase2 = classes.find((c) => c.code === 2);

  const efectivoCuenta11 = ct.efectivoCuenta11;
  const inversionesTemporales12 = sumClassByPrefixes(clase1, ['12']);
  const activoCorriente = sumClassByPrefixes(clase1, ['11', '12', '13']);
  const pasivoCorriente = sumClassByPrefixes(clase2, ['21', '22', '23', '24']);
  const provisionCuenta24 = ct.impuestosCuenta24;
  const rentaTeorica = Math.max(0, ct.utilidadNeta * RENTA_RATE);

  // Proveedores 2205; si balance es 0, fallback a prefijo '22'
  const proveedoresCuenta2205 = (() => {
    const v2205 = sumClassByPrefixes(clase2, ['2205']);
    return v2205 > 0 ? v2205 : sumClassByPrefixes(clase2, ['22']);
  })();

  return {
    efectivoCuenta11,
    inversionesTemporales12,
    totalEgresosPeriodo: ct.gastos,
    promedioEgresosMensuales: avgMonthlyEgresos,
    activoCorriente,
    pasivoCorriente,
    provisionCuenta24,
    rentaTeorica,
    proveedoresCuenta2205,
    tasaRenta: RENTA_RATE,
    periodosUsados,
  };
}

// ---------------------------------------------------------------------------
// Cómputo principal
// ---------------------------------------------------------------------------

export function computeEscudoExecutiveCards(
  input: PillarsAggregateInput,
): EscudoExecutiveCards {
  const { snapshot, comparative } = input;
  const ct = snapshot.controlTotals;
  const classes = snapshot.classes;

  const clase1 = classes.find((c) => c.code === 1);
  const clase2 = classes.find((c) => c.code === 2);

  // ── Egresos promedio ─────────────────────────────────────────────────────
  const comparativeEgresos = comparative ? comparative.controlTotals.gastos : undefined;
  const { avg: avgMonthlyEgresos, periodosUsados } = computeAvgMonthlyEgresos(
    ct.gastos,
    comparativeEgresos,
  );

  // ── Audit del snapshot actual ────────────────────────────────────────────
  const audit = buildEscudoAudit(snapshot, avgMonthlyEgresos, periodosUsados);

  // ─── 1. Autonomía Financiera (días) ─────────────────────────────────────
  const liquidezTotal = audit.efectivoCuenta11 + audit.inversionesTemporales12;
  let autonomiaValue: number | null;
  if (avgMonthlyEgresos <= 0) {
    autonomiaValue = liquidezTotal > 0 ? 365 : null;
  } else {
    autonomiaValue = (liquidezTotal / avgMonthlyEgresos) * 30;
  }

  // ─── 2. Cobertura de Pasivos ─────────────────────────────────────────────
  const activoCorriente = sumClassByPrefixes(clase1, ['11', '12', '13']);
  const pasivoCorriente = sumClassByPrefixes(clase2, ['21', '22', '23', '24']);
  let coberturaValue: number | null;
  if (pasivoCorriente <= 0 && activoCorriente > 0) {
    coberturaValue = 999;
  } else if (pasivoCorriente <= 0 && activoCorriente <= 0) {
    coberturaValue = null;
  } else {
    coberturaValue = activoCorriente / pasivoCorriente;
  }

  // ─── 3. Reserva Fiscal ───────────────────────────────────────────────────
  const rentaTeorica = Math.max(0, ct.utilidadNeta * RENTA_RATE);
  const provisionCuenta24 = ct.impuestosCuenta24;
  const reservaValue = provisionCuenta24 - rentaTeorica;

  // ─── 4. Brecha Escudo ────────────────────────────────────────────────────
  const caja = ct.efectivoCuenta11;
  const proveedoresCuenta2205 = (() => {
    const v2205 = sumClassByPrefixes(clase2, ['2205']);
    return v2205 > 0 ? v2205 : sumClassByPrefixes(clase2, ['22']);
  })();
  const brechaValue = caja - proveedoresCuenta2205;

  // ── Deltas vs comparativo ────────────────────────────────────────────────
  let prevAutonomia: number | null = null;
  let prevCobertura: number | null = null;
  let prevReserva: number | null = null;
  let prevBrecha: number | null = null;

  if (comparative) {
    const comparativeAvgMonthly = comparative.controlTotals.gastos / 12;
    const prevAudit = buildEscudoAudit(comparative, comparativeAvgMonthly, 1);

    const prevClase1 = comparative.classes.find((c) => c.code === 1);
    const prevClase2 = comparative.classes.find((c) => c.code === 2);

    // Autonomía previa
    const prevLiquidezTotal =
      prevAudit.efectivoCuenta11 + prevAudit.inversionesTemporales12;
    prevAutonomia =
      comparativeAvgMonthly > 0
        ? (prevLiquidezTotal / comparativeAvgMonthly) * 30
        : prevLiquidezTotal > 0
          ? 365
          : null;

    // Cobertura previa
    const prevAC = sumClassByPrefixes(prevClase1, ['11', '12', '13']);
    const prevPC = sumClassByPrefixes(prevClase2, ['21', '22', '23', '24']);
    if (prevPC <= 0 && prevAC > 0) prevCobertura = 999;
    else if (prevPC <= 0) prevCobertura = null;
    else prevCobertura = prevAC / prevPC;

    // Reserva previa
    const prevRentaTeorica = Math.max(
      0,
      comparative.controlTotals.utilidadNeta * RENTA_RATE,
    );
    prevReserva = prevAudit.provisionCuenta24 - prevRentaTeorica;

    // Brecha previa
    const prevCaja = comparative.controlTotals.efectivoCuenta11;
    const prevProv2205 = (() => {
      const v = sumClassByPrefixes(prevClase2, ['2205']);
      return v > 0 ? v : sumClassByPrefixes(prevClase2, ['22']);
    })();
    prevBrecha = prevCaja - prevProv2205;
  }

  // ── Construir tarjetas ───────────────────────────────────────────────────
  const autonomia: ExecutiveCard = {
    key: 'autonomia',
    labelEs: 'Autonomía Financiera',
    labelEn: 'Financial Autonomy',
    value: autonomiaValue,
    unit: 'ratio', // días expresados como ratio (no hay unit 'days' en ExecutiveCard)
    color: 'blue',
    status: autonomiaStatus(autonomiaValue),
    deltaVsComparative: safeDelta(autonomiaValue, prevAutonomia),
    descriptionEs:
      'Cuántos días puede operar la empresa sin un peso de venta. Combina caja + inversiones temporales contra egresos promedio.',
    descriptionEn:
      'How many days the company can operate without any sales. Combines cash + short-term investments against average monthly outflows.',
    formulaEs:
      '(Efectivo PUC 11 + Inversiones Temporales PUC 12) / Egresos promedio mensuales × 30 días',
    formulaEn:
      '(Cash PUC 11 + Short-term Investments PUC 12) / Average monthly outflows × 30 days',
  };

  const cobertura_pasivos: ExecutiveCard = {
    key: 'cobertura_pasivos',
    labelEs: 'Cobertura de Pasivos',
    labelEn: 'Liability Coverage',
    value: coberturaValue,
    unit: 'ratio',
    color: 'orange',
    status: coberturaStatus(coberturaValue),
    deltaVsComparative: safeDelta(coberturaValue, prevCobertura),
    descriptionEs:
      'Cuántos pesos líquidos hay por cada peso adeudado a corto plazo. Mínimo aceptable 1.0; ideal 1.5+.',
    descriptionEn:
      'Liquid assets per peso owed short-term. Minimum acceptable 1.0; ideal 1.5+.',
    formulaEs: 'Activo Corriente (PUC 11+12+13) / Pasivo Corriente (PUC 21+22+23+24)',
    formulaEn: 'Current Assets (PUC 11+12+13) / Current Liabilities (PUC 21+22+23+24)',
  };

  const reserva_fiscal: ExecutiveCard = {
    key: 'reserva_fiscal',
    labelEs: 'Reserva Fiscal',
    labelEn: 'Tax Reserve',
    value: reservaValue,
    unit: 'cop',
    color: 'purple',
    status: reservaStatus(reservaValue, rentaTeorica),
    deltaVsComparative: safeDelta(reservaValue, prevReserva),
    descriptionEs:
      'Diferencia entre la provisión registrada (PUC 24) y la renta teórica al 35%. Negativo significa que estás gastando dinero que es de la DIAN.',
    descriptionEn:
      'Gap between recorded provision (PUC 24) and theoretical income tax at 35%. Negative = spending money that belongs to DIAN.',
    formulaEs: 'PUC 24 (Impuestos) − Utilidad Neta × 35% (Art. 240 E.T.)',
    formulaEn: 'PUC 24 (Taxes Payable) − Net Income × 35% (Art. 240 Tax Code)',
  };

  const brecha_escudo: ExecutiveCard = {
    key: 'brecha_escudo',
    labelEs: 'Brecha Escudo',
    labelEn: 'Shield Gap',
    value: brechaValue,
    unit: 'cop',
    color: 'green',
    status: brechaStatus(brechaValue, proveedoresCuenta2205),
    deltaVsComparative: safeDelta(brechaValue, prevBrecha),
    descriptionEs:
      'Caja disponible menos saldo de Proveedores Nacionales (PUC 2205). Negativo = no hay efectivo para cubrir las obligaciones inmediatas.',
    descriptionEn:
      'Available cash minus Domestic Suppliers balance (PUC 2205). Negative = insufficient cash to meet immediate obligations.',
    formulaEs: 'Efectivo (PUC 11) − Proveedores Nacionales (PUC 2205)',
    formulaEn: 'Cash (PUC 11) − Domestic Suppliers (PUC 2205)',
  };

  return {
    autonomia,
    cobertura_pasivos,
    reserva_fiscal,
    brecha_escudo,
    audit,
    generatedAt: new Date().toISOString(),
  };
}

export type { ExecutiveCard };
