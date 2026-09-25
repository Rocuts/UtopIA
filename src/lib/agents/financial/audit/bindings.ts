// ---------------------------------------------------------------------------
// Cifras deterministas para los Dictámenes 2 y 4 (Parte IV)
// ---------------------------------------------------------------------------
// Los dictámenes tributario y fiscal hacían la aritmética fiscal en el LLM
// (posición de renta, indicadores de riesgo DIAN) y mezclaban cuentas de
// naturaleza distinta. Aquí se calcula en código, desde el preprocesador,
// y sin inventar: una cifra que no se puede soportar sale `null` con motivo.
//
//   - Posición de renta (auditoria-calidad-22): créditos de renta de 1355/1805
//     − 2404, con la regla ÚNICA de `@/lib/accounting/renta-credit` (la misma
//     del preprocesador, el curator R4/R10/R16 y el Âncora Fiscal F03;
//     re-auditoría 2026-09, NM-06). No suma IVA/ICA ni el grupo 24 completo
//     ni impuesto diferido. En el PUC (D. 2650/1993) la 1805 es "Bienes de
//     arte y cultura": sólo cuenta con nombre de renta; 135510/135517/135518/
//     135520... son ICA/IVA/otros.
//   - Indicadores de riesgo DIAN (auditoria-calidad-23): los 6 del spec v2.1
//     Parte IV Dictamen 4 §4, con UNA regla de agregación.
// ---------------------------------------------------------------------------

import type {
  PeriodSnapshot,
  PreprocessedBalance,
  ValidatedAccount,
} from '@/lib/preprocessing/trial-balance';
import { filtrarCreditoRenta } from '@/lib/accounting/renta-credit';
import type { DianRiskLevelJson, FiscalAuditOpinionTypeJson } from '../contracts/audit-report';
import { serializeMoneyCop } from '../contracts/money';

const ZERO = BigInt(0);

function pesosToCents(pesos: number): bigint {
  return BigInt(Math.round(pesos * 100));
}

function leafAccounts(snap: PeriodSnapshot, classCode: number): ValidatedAccount[] {
  const cls = snap.classes?.find((c) => c.code === classCode);
  return (cls?.accounts ?? []).filter((a) => a.isLeaf);
}

function sumCents(accounts: ValidatedAccount[]): bigint {
  return accounts.reduce((acc, a) => acc + pesosToCents(a.balance), ZERO);
}

// ---------------------------------------------------------------------------
// Posición de renta
// ---------------------------------------------------------------------------

export interface RentaPositionBinding {
  saldo1355RentaCop: string | null;
  /** null cuando ninguna 1805 es crédito de renta (nombre de renta) — no suma. */
  saldo1805FiscalCop: string | null;
  saldo2404Cop: string | null;
  /** (1355 renta + 1805 renta) − 2404. + = saldo a favor; − = saldo a pagar. */
  posicionFiscalNetaCop: string | null;
  /** Motivo cuando la posición no es determinable. */
  motivo: string | null;
}

export const RENTA_POSITION_ND_REASON =
  'N/D — la posición de renta requiere el detalle auxiliar del preprocesador (1355 de renta, 1805 fiscal y 2404); sin él no se calcula.';

export function computeRentaPosition(snap: PeriodSnapshot | null | undefined): RentaPositionBinding {
  const nd: RentaPositionBinding = {
    saldo1355RentaCop: null,
    saldo1805FiscalCop: null,
    saldo2404Cop: null,
    posicionFiscalNetaCop: null,
    motivo: RENTA_POSITION_ND_REASON,
  };
  if (!snap) return nd;
  const class1 = leafAccounts(snap, 1);
  const class2 = leafAccounts(snap, 2);
  if (class1.length === 0 || class2.length === 0) return nd;

  // Regla única sobre la lista completa (nombres de cuentas padre incluidos).
  const creditos = filtrarCreditoRenta(class1);
  const renta1355 = sumCents(creditos.filter((a) => a.code.startsWith('1355')));
  const fiscal1805Accounts = creditos.filter((a) => a.code.startsWith('1805'));
  const fiscal1805 = fiscal1805Accounts.length > 0 ? sumCents(fiscal1805Accounts) : null;
  // Pasivos con naturaleza crédito se reportan en positivo (mismo convenio que R16).
  const renta2404 = sumCents(class2.filter((a) => a.code.startsWith('2404')));
  const posicion = renta1355 + (fiscal1805 ?? ZERO) - renta2404;

  return {
    saldo1355RentaCop: serializeMoneyCop(renta1355),
    saldo1805FiscalCop: fiscal1805 === null ? null : serializeMoneyCop(fiscal1805),
    saldo2404Cop: serializeMoneyCop(renta2404),
    posicionFiscalNetaCop: serializeMoneyCop(posicion),
    motivo: null,
  };
}

// ---------------------------------------------------------------------------
// Indicadores de riesgo DIAN — spec v2.1 Parte IV Dictamen 4 §4
// ---------------------------------------------------------------------------

export interface DianIndicatorBinding {
  indicator: string;
  level: DianRiskLevelJson;
  observation: string;
}

export const DIAN_SPEC_INDICATORS = [
  'Margen neto > 70% del sector CIIU',
  'Costo de ventas < 1% de ingresos',
  'Brecha impuesto contable vs tasa nominal',
  'Variacion ingresos > 40% interanual',
  'Proveedores > 90% del pasivo total',
  'Efectivo > 50% del activo total',
] as const;

const NO_PREPROCESSED =
  'N/D — sin cifras vinculantes del preprocesador; el indicador no se estima.';

function pct(n: number): string {
  return `${(Math.round(n * 1000) / 10).toLocaleString('es-CO')}%`;
}

function ingresosNetos(snap: PeriodSnapshot): number {
  const cents = snap.controlTotals?.cents?.ingresosNetos;
  if (typeof cents === 'bigint') return Number(cents) / 100;
  return Math.abs(snap.controlTotals?.ingresos ?? 0);
}

export function computeDianRiskIndicators(
  preprocessed: PreprocessedBalance | null | undefined,
): DianIndicatorBinding[] {
  const [iMargen, iCosto, iBrecha, iVariacion, iProveedores, iEfectivo] = DIAN_SPEC_INDICATORS;
  const snap = preprocessed?.primary;
  if (!snap) {
    return DIAN_SPEC_INDICATORS.map((indicator) => ({
      indicator,
      level: 'no_determinable' as const,
      observation: NO_PREPROCESSED,
    }));
  }
  const ct = snap.controlTotals;
  const ingresos = ingresosNetos(snap);
  const out: DianIndicatorBinding[] = [];

  // 1. Margen neto vs sector — no hay benchmark sectorial verificado.
  out.push({
    indicator: iMargen,
    level: 'no_determinable',
    observation: 'N/D — no se dispone de un benchmark sectorial CIIU verificado; no se fabrica la banda sectorial.',
  });

  // 2. Costo de ventas < 1% de ingresos.
  if (ingresos > 0) {
    const costo = Math.abs(snap.summary?.totalCosts ?? 0);
    const ratio = costo / ingresos;
    out.push({
      indicator: iCosto,
      level: ratio < 0.01 ? 'alto' : 'bajo',
      observation: `Costo de ventas (Clase 6) = ${pct(ratio)} de los ingresos netos.`,
    });
  } else {
    out.push({ indicator: iCosto, level: 'no_determinable', observation: 'N/D — ingresos netos no positivos.' });
  }

  // 3. Brecha impuesto contable vs tasa nominal — el spec no fija umbral.
  const uai = ct?.cents?.utilidadAntesImpuestos;
  const imp = ct?.cents?.impuestoCausado;
  if (typeof uai === 'bigint' && typeof imp === 'bigint' && uai > ZERO) {
    const tasa = Number(imp) / Number(uai);
    out.push({
      indicator: iBrecha,
      level: 'no_determinable',
      observation:
        `Tasa contable (impuesto del periodo / UAI) = ${pct(tasa)} frente a la tarifa nominal del 35% (Art. 240 E.T.). ` +
        'El spec no fija umbral de riesgo para esta brecha: nivel N/D. No es la TTD del par. 6 Art. 240 E.T.',
    });
  } else {
    out.push({ indicator: iBrecha, level: 'no_determinable', observation: 'N/D — UAI no positiva o impuesto del periodo no identificado.' });
  }

  // 4. Variación de ingresos > 40% interanual.
  const comp = preprocessed?.comparative;
  if (comp) {
    const prev = ingresosNetos(comp);
    if (prev > 0) {
      const variacion = (ingresos - prev) / prev;
      out.push({
        indicator: iVariacion,
        level: Math.abs(variacion) > 0.4 ? 'alto' : 'bajo',
        observation: `Variación de ingresos netos ${comp.period} → ${snap.period}: ${pct(variacion)}.`,
      });
    } else {
      out.push({ indicator: iVariacion, level: 'no_determinable', observation: 'N/D — ingresos del comparativo no positivos.' });
    }
  } else {
    out.push({ indicator: iVariacion, level: 'no_determinable', observation: 'N/D — sin periodo comparativo.' });
  }

  // 5. Proveedores (PUC 22) > 90% del pasivo total.
  const class2 = leafAccounts(snap, 2);
  const pasivo = Math.abs(ct?.pasivo ?? 0);
  if (class2.length > 0 && pasivo > 0) {
    const proveedores = Math.abs(
      class2.filter((a) => a.code.startsWith('22')).reduce((acc, a) => acc + a.balance, 0),
    );
    const ratio = proveedores / pasivo;
    out.push({
      indicator: iProveedores,
      level: ratio > 0.9 ? 'alto' : 'bajo',
      observation: `Proveedores (PUC 22) = ${pct(ratio)} del pasivo total.`,
    });
  } else {
    out.push({ indicator: iProveedores, level: 'no_determinable', observation: 'N/D — sin detalle de la Clase 2 o pasivo total nulo.' });
  }

  // 6. Efectivo (PUC 11) > 50% del activo total.
  const activo = Math.abs(ct?.activo ?? 0);
  if (activo > 0) {
    const ratio = Math.abs(ct?.efectivoCuenta11 ?? 0) / activo;
    out.push({
      indicator: iEfectivo,
      level: ratio > 0.5 ? 'alto' : 'bajo',
      observation: `Efectivo (PUC 11) = ${pct(ratio)} del activo total.`,
    });
  } else {
    out.push({ indicator: iEfectivo, level: 'no_determinable', observation: 'N/D — activo total nulo.' });
  }

  return out;
}

/**
 * Regla ÚNICA de agregación (nivel global y tipo de opinión fiscal):
 *   - algún hallazgo crítico del auditor fiscal → alto;
 *   - sin indicadores determinables → no_determinable;
 *   - ≥3 indicadores en alto → alto; 1-2 → medio; 0 → bajo.
 */
export function aggregateDianRisk(
  indicators: ReadonlyArray<{ level: DianRiskLevelJson }>,
  hasCriticalFinding: boolean,
): { global: DianRiskLevelJson; opinionType: FiscalAuditOpinionTypeJson } {
  let global: DianRiskLevelJson;
  const determinable = indicators.filter((i) => i.level !== 'no_determinable');
  const altos = determinable.filter((i) => i.level === 'alto').length;
  if (hasCriticalFinding) global = 'alto';
  else if (determinable.length === 0) global = 'no_determinable';
  else if (altos >= 3) global = 'alto';
  else if (altos >= 1) global = 'medio';
  else global = 'bajo';
  const opinionType: FiscalAuditOpinionTypeJson =
    global === 'alto'
      ? 'riesgo_alto'
      : global === 'medio'
        ? 'riesgo_medio'
        : global === 'bajo'
          ? 'riesgo_bajo'
          : 'riesgo_no_determinable';
  return { global, opinionType };
}
