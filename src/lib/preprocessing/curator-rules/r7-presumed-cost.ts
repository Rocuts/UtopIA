// ---------------------------------------------------------------------------
// R7 — Advertencia de Costo Presunto (NIC 2 párr. 25 / Sección 13 PYMES)
// ---------------------------------------------------------------------------
// Detecta el escenario clásico "se vendió pero no se descargó el inventario":
// un margen bruto observado anormalmente alto (> 85%) combinado con un saldo
// material de inventario (> 50% de los ingresos del periodo) sugiere que el
// Costo de Mercancía Vendida está SUBESTIMADO. Causas típicas: kárdex no
// procesado al cierre, errores PUC entre 14xx (inventario) y 6xxx (costos),
// o reclasificación NIC 2 párr. 25 pendiente.
//
// La regla NO MUTA cifras del balance — solo emite un callout cualitativo
// que el Validator del pipeline financiero usa para bloquear la firma del
// Contador hasta que el preparador valide el descargue contra kárdex físico.
// ---------------------------------------------------------------------------

import type { PUCClass, PeriodSnapshot } from '../trial-balance';

import type { CuratorFinding, PresumedCostWarning } from './types';

const GROSS_MARGIN_THRESHOLD = 0.85; // 85%
const INVENTORY_TO_REVENUE_THRESHOLD = 0.5; // 50%
const BENCHMARK_GROSS_MARGIN = 0.4; // 40% — margen razonable PYME comercio

const CALLOUT_TITLE =
  'Advertencia de Valoración — Costo de Mercancía Vendida';

export interface R7Result {
  presumedCostWarning?: PresumedCostWarning;
  findings: CuratorFinding[];
}

export function runR7(snapshot: PeriodSnapshot): R7Result {
  const revenue = snapshot.controlTotals.ingresos;
  if (revenue <= 0) return { findings: [] };

  // COGS: Clase 6 + Clase 7 (costo ventas + costo producción).
  const cogs =
    classTotal(snapshot.classes, 6) + classTotal(snapshot.classes, 7);

  // Inventario: hojas Clase 1 con código que empiece con '14'.
  const inventory = sumInventoryLeaves(snapshot.classes);

  const observedGrossMargin = (revenue - cogs) / revenue;

  // Threshold doble: margen anómalo Y saldo de inventario material.
  const inventoryRatio = inventory / revenue;
  const triggers =
    observedGrossMargin > GROSS_MARGIN_THRESHOLD &&
    inventoryRatio > INVENTORY_TO_REVENUE_THRESHOLD;

  if (!triggers) return { findings: [] };

  // COGS presunto bajo rotación normal (margen bruto referencial 40%).
  const presumedCogsCop = revenue * (1 - BENCHMARK_GROSS_MARGIN);

  const calloutBody =
    `El margen bruto observado es ${(observedGrossMargin * 100).toFixed(1)}% ` +
    `(Costo de Ventas $${formatCop(cogs)} vs Ingresos $${formatCop(revenue)}), ` +
    `muy por encima del rango razonable para el sector (40-50%). El saldo de Inventario ` +
    `al cierre es $${formatCop(inventory)}, lo cual sugiere que el Costo de Mercancía ` +
    `Vendida puede estar SUBESTIMADO. Posibles causas: inventario no descargado al cierre, ` +
    `errores PUC entre 14xx (inventario) y 6xxx (costos), o reclasificación NIC 2 párr. 25 ` +
    `pendiente. Acción sugerida: validar descargue de inventario contra kárdex físico antes ` +
    `de firmar EEFF. COGS presunto bajo rotación normal: $${formatCop(presumedCogsCop)}.`;

  const warning: PresumedCostWarning = {
    observedGrossMargin,
    thresholdGrossMargin: GROSS_MARGIN_THRESHOLD,
    reportedCogsCop: cogs,
    inventoryCop: inventory,
    presumedCogsCop,
    severidad: 'alto',
    calloutTitle: CALLOUT_TITLE,
    calloutBody,
  };

  // Setear en el snapshot (no muta cifras, solo añade el warning).
  snapshot.presumedCostWarning = warning;

  const finding: CuratorFinding = {
    code: 'CUR-R7',
    severity: 'alto',
    title: CALLOUT_TITLE,
    description: calloutBody,
    normReference: 'NIC 2 párr. 25 + Sección 13 PYMES',
    recommendation:
      `Reconciliar el saldo de Inventario contra el kárdex físico al cierre. Si el COGS ` +
      `está realmente subestimado, contabilizar el descargue antes de cerrar EEFF. Si el ` +
      `margen es genuinamente alto (servicios, software, márgenes regulatorios), documentar ` +
      `en notas la naturaleza de la operación.`,
    impact:
      `Subestimación de COGS infla la utilidad y la base gravable, generando provisión de renta ` +
      `excesiva y distorsionando ratios de rentabilidad. Materialidad típica: ` +
      `$${formatCop(Math.max(0, presumedCogsCop - cogs))} de costo no reconocido.`,
    period: snapshot.period,
  };

  return { presumedCostWarning: warning, findings: [finding] };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function classTotal(classes: PUCClass[], code: number): number {
  const cl = classes.find((c) => c.code === code);
  if (!cl) return 0;
  return cl.accounts.reduce((s, a) => s + a.balance, 0);
}

function sumInventoryLeaves(classes: PUCClass[]): number {
  const cl = classes.find((c) => c.code === 1);
  if (!cl) return 0;
  let total = 0;
  for (const acc of cl.accounts) {
    if (acc.code.startsWith('14')) total += acc.balance;
  }
  return total;
}

function formatCop(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return amount < 0 ? `-${formatted}` : formatted;
}
