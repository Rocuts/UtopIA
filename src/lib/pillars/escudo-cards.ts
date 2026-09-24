// ---------------------------------------------------------------------------
// Pilar ESCUDO — 4 Tarjetas Ejecutivas (vista del dueño / CFO)
// ---------------------------------------------------------------------------
// Tarjetas:
//   1. Autonomía Financiera  — azul   — Días que la empresa opera sin ventas
//                                        (misma definición que el pilar)
//   2. Prueba ácida          — naranja — (AC − Inventarios 14) / PC
//   3. Reserva Fiscal        — morada  — N/D sin base fiscal verificada
//   4. Brecha Escudo         — verde   — Caja(11) − Proveedores(2205)
//
// Fuente de la verdad:
//   - ./shared-metrics.ts (ratios-kpis-15): una sola definición de liquidez y
//     días de autonomía para pilar, tarjetas, Centro de Mando, Sentinel y PDF.
//     Antes la tarjeta usaba (11+12)/promedio mensual × 30 y
//     (11+12+13)/(21..24) con el centinela 999.
//   - snapshot.classes (granularidad por prefijo PUC para 12 y 2205).
//   - comparative snapshot opcional → deltas vs periodo anterior.
//
// TypeScript estricto — sin `any`.
// ---------------------------------------------------------------------------

import type { PUCClass } from '@/lib/preprocessing/trial-balance';

import {
  FISCAL_ND_REASON_EN,
  FISCAL_ND_REASON_ES,
  diasAutonomia,
  monthsCovered,
  pruebaAcida,
} from './shared-metrics';
import type {
  EscudoExecutiveCards,
  EscudoExecutiveCardsAudit,
  ExecutiveCard,
  PillarStatus,
  PillarsAggregateInput,
} from './types';

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

/** Prueba ácida — ratio (higher-better). ≥1,0 cubre el pasivo corriente sin
 *  vender inventario. */
function pruebaAcidaStatus(ratio: number | null): PillarStatus {
  if (ratio === null) return 'watch';
  if (ratio >= 1.0) return 'healthy';
  if (ratio >= 0.8) return 'watch';
  if (ratio >= 0.5) return 'warning';
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
): EscudoExecutiveCardsAudit {
  const ct = snapshot.controlTotals;
  const clase1 = snapshot.classes.find((c) => c.code === 1);
  const clase2 = snapshot.classes.find((c) => c.code === 2);

  // Proveedores 2205; si balance es 0, fallback a prefijo '22'
  const proveedoresCuenta2205 = (() => {
    const v2205 = sumClassByPrefixes(clase2, ['2205']);
    return v2205 > 0 ? v2205 : sumClassByPrefixes(clase2, ['22']);
  })();

  return {
    efectivoCuenta11: ct.efectivoCuenta11,
    inversionesTemporales12: sumClassByPrefixes(clase1, ['12']),
    totalEgresosPeriodo: ct.gastos,
    promedioEgresosMensuales: ct.gastos / monthsCovered(snapshot),
    activoCorriente: ct.activoCorriente,
    pasivoCorriente: ct.pasivoCorriente,
    inventarios14: ct.inventarios14 ?? 0,
    provisionCuenta24: ct.impuestosCuenta24,
    // Utilidad neta leída tal cual (ratios-kpis-10): single-source-validator la
    // compara sin reconstruirla desde una "renta teórica" de UN × 35 %.
    utilidadNeta: ct.utilidadNeta,
    proveedoresCuenta2205,
    periodosUsados: 1,
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
  const audit = buildEscudoAudit(snapshot);

  // ── CapEx próximos 6 meses (eventos declarados por el usuario) ──────────
  const capexProximos = (input.capexEvents ?? []).filter((ev) => ev.monthOffset <= 6);
  const proyectosFuturoCop = capexProximos.reduce((s, ev) => s + ev.amountCop, 0);
  audit.proyectosFuturoCop = proyectosFuturoCop;
  audit.cantidadEventosProximos = capexProximos.length;

  // ─── 1. Autonomía Financiera (misma función que el pilar) ───────────────
  // Con CapEx comprometido en ≤ 6 meses, la caja disponible se reduce.
  const dias = diasAutonomia(snapshot, proyectosFuturoCop);
  const autonomiaValue = dias.value;

  // ─── 2. Prueba ácida (controlTotals, sin centinela 999) ────────────────
  const coberturaValue = pruebaAcida(ct);

  // ─── 3. Reserva Fiscal: N/D (ratios-kpis-10) ───────────────────────────
  const reservaValue: number | null = null;

  // ─── 4. Brecha Escudo ────────────────────────────────────────────────────
  const brechaValue = ct.efectivoCuenta11 - audit.proveedoresCuenta2205;
  const brechaValueAjustada = brechaValue - proyectosFuturoCop;
  const proveedoresCuenta2205 = audit.proveedoresCuenta2205;

  // ── Deltas vs comparativo (mismas funciones) ─────────────────────────────
  let prevAutonomia: number | null = null;
  let prevCobertura: number | null = null;
  let prevBrecha: number | null = null;
  if (comparative) {
    const prevAudit = buildEscudoAudit(comparative);
    prevAutonomia = diasAutonomia(comparative).value;
    prevCobertura = pruebaAcida(comparative.controlTotals);
    prevBrecha = comparative.controlTotals.efectivoCuenta11 - prevAudit.proveedoresCuenta2205;
  }

  // ── Construir tarjetas ───────────────────────────────────────────────────
  const autonomia: ExecutiveCard = {
    key: 'autonomia',
    labelEs: 'Autonomía Financiera',
    labelEn: 'Financial Autonomy',
    value: autonomiaValue,
    unit: 'ratio', // días expresados como ratio (no hay unit 'days' en ExecutiveCard)
    color: 'blue',
    status: autonomiaValue !== null && autonomiaValue < 0 ? 'critical' : autonomiaStatus(autonomiaValue),
    deltaVsComparative: safeDelta(autonomiaValue, prevAutonomia),
    descriptionEs:
      dias.reasonEs ??
      'Cuántos días puede operar la empresa sin un peso de venta: efectivo contra egresos diarios del periodo (menos CapEx comprometido a 6 meses).',
    descriptionEn:
      dias.reasonEn ??
      'How many days the company can operate without any sales: cash against the period daily outflows (less CapEx committed within 6 months).',
    formulaEs:
      '(Efectivo PUC 11 − CapEx ≤ 6 meses) / (Egresos clases 5+6+7 del periodo / días del periodo, base 365)',
    formulaEn:
      '(Cash PUC 11 − CapEx ≤ 6 months) / (Period outflows classes 5+6+7 / period days, 365 basis)',
  };

  const cobertura_pasivos: ExecutiveCard = {
    key: 'cobertura_pasivos',
    labelEs: 'Prueba ácida',
    labelEn: 'Acid-test ratio',
    value: coberturaValue,
    unit: 'ratio',
    color: 'orange',
    status: pruebaAcidaStatus(coberturaValue),
    deltaVsComparative: safeDelta(coberturaValue, prevCobertura),
    descriptionEs:
      coberturaValue === null
        ? 'N/D — sin pasivo corriente registrado.'
        : 'Pesos líquidos (sin inventarios) por cada peso adeudado a corto plazo. ≥1,0 cubre el pasivo corriente sin vender inventario.',
    descriptionEn:
      coberturaValue === null
        ? 'N/A — no current liabilities recorded.'
        : 'Liquid assets (excluding inventory) per peso owed short-term. ≥1.0 covers current liabilities without selling inventory.',
    formulaEs: '(Activo corriente − Inventarios PUC 14) / Pasivo corriente',
    formulaEn: '(Current assets − Inventories PUC 14) / Current liabilities',
  };

  const reserva_fiscal: ExecutiveCard = {
    key: 'reserva_fiscal',
    labelEs: 'Reserva Fiscal',
    labelEn: 'Tax Reserve',
    value: reservaValue,
    unit: 'cop',
    color: 'purple',
    status: 'watch',
    deltaVsComparative: null,
    descriptionEs: FISCAL_ND_REASON_ES,
    descriptionEn: FISCAL_ND_REASON_EN,
    formulaEs:
      'Impuesto de renta por pagar verificado − impuesto de renta causado sobre renta líquida (sin base verificada: N/D)',
    formulaEn:
      'Verified income tax payable − income tax accrued on taxable income (no verified base: N/A)',
  };

  const brecha_escudo: ExecutiveCard = {
    key: 'brecha_escudo',
    labelEs: 'Brecha Escudo',
    labelEn: 'Shield Gap',
    value: brechaValueAjustada,
    unit: 'cop',
    color: 'green',
    status: brechaStatus(brechaValueAjustada, proveedoresCuenta2205),
    deltaVsComparative: safeDelta(brechaValueAjustada, prevBrecha),
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
