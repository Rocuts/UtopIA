// ---------------------------------------------------------------------------
// R16 — Anticipo Renta (PUC 135515) → Neto a Pagar contra PUC 2404
// ---------------------------------------------------------------------------
// Elite Protocol Layer 2 (Lógica de Negocio) + Layer 3 (Defensa Tributaria).
//
// Cuando la entidad pagó anticipos del impuesto de renta durante el ejercicio
// (cuenta PUC 135515 — Anticipos del Impuesto de Renta y Complementarios,
// saldo deudor en Activo), la práctica revisoría fiscal colombiana exige
// presentar en el Balance la línea "Impuesto Renta — Neto a Pagar = Bruto
// (PUC 2404) − Anticipo (PUC 135515)" debajo del rubro de Impuestos
// Corrientes en el Pasivo. Presentar sólo el bruto sobre-expone la posición
// fiscal del usuario al órgano social y al órgano de control.
//
// Sustento normativo:
//   - NIC 12 §71 — compensación de activos y pasivos por impuestos corrientes
//     cuando la entidad tiene derecho legal exigible (el anticipo SI lo tiene
//     conforme Art. 855 E.T.).
//   - NIIF for SMEs §29.29 — presentación de impuestos corrientes.
//   - Art. 850 E.T. — devolución y aplicación de saldos a favor.
//   - Art. 855 E.T. — término de devolución del anticipo (50 días hábiles).
//   - Concepto DIAN 100208221-XXX — el anticipo aplica directo contra la
//     liquidación del periodo siguiente; SE NETEA al cierre.
//
// La regla NO MUTA las cuentas 2404 ni 135515 (siguen en el detalle del
// balance para auditoría). SÓLO expone el neto en `controlTotals.impuestoRentaNeto`
// como ancla vinculante para que el NIIF Analyst lo presente en el Balance
// neto y el LLM no invente otra cifra. Severidad: informativo.
// ---------------------------------------------------------------------------

import type { PeriodSnapshot, PUCClass } from '../trial-balance';
import type { CuratorFinding } from './types';

/** Materialidad mínima para considerar el anticipo "material" (disparar netting). */
const ANTICIPO_MATERIALITY = 100_000; // $100k COP
/** Tolerancia para considerar un saldo ≈ 0. */
const ZERO_TOLERANCE = 1_000; // $1k COP

export interface R16AuditResult {
  brutoPasivo2404: number;
  anticipoActivo135515: number;
  netoAPagar: number;
  applicable: boolean;
}

export interface R16Result {
  audit: R16AuditResult;
  findings: CuratorFinding[];
}

export function runR16(snapshot: PeriodSnapshot): R16Result {
  const findings: CuratorFinding[] = [];

  const class1 = snapshot.classes.find((c: PUCClass) => c.code === 1);
  const class2 = snapshot.classes.find((c: PUCClass) => c.code === 2);

  // -------------------------------------------------------------------------
  // 1. Anticipo en Activo — PUC 135515 (Anticipos del Impuesto de Renta).
  //    Aceptamos cualquier subcuenta que empiece con '135515' (auxiliares).
  // -------------------------------------------------------------------------
  const anticipoAccounts = (class1?.accounts ?? []).filter((a) =>
    a.code.startsWith('135515'),
  );
  const anticipoActivo135515 = sumCents(anticipoAccounts.map((a) => a.balance));

  // -------------------------------------------------------------------------
  // 2. Bruto en Pasivo — PUC 2404 (Impuesto de Renta y Complementarios).
  // -------------------------------------------------------------------------
  const brutoAccounts = (class2?.accounts ?? []).filter((a) =>
    a.code.startsWith('2404'),
  );
  const brutoPasivo2404 = sumCents(brutoAccounts.map((a) => a.balance));

  // -------------------------------------------------------------------------
  // 3. Neto = Bruto − Anticipo. Aplicable sólo si AMBOS son materiales.
  //    Si el anticipo > bruto, el neto es negativo (saldo a favor en activo,
  //    ya capturado por el detector existente `saldoAFavorImpuesto`).
  //    En ese caso R16 NO emite finding (la presentación correcta es vía
  //    `saldoAFavorImpuesto` y NO via netting del pasivo).
  // -------------------------------------------------------------------------
  const anticipoMaterial = anticipoActivo135515 > ANTICIPO_MATERIALITY;
  const brutoMaterial = Math.abs(brutoPasivo2404) > ZERO_TOLERANCE;
  const applicable = anticipoMaterial && brutoMaterial && brutoPasivo2404 > anticipoActivo135515;

  const netoAPagar = applicable
    ? brutoPasivo2404 - anticipoActivo135515
    : brutoPasivo2404;

  const audit: R16AuditResult = {
    brutoPasivo2404,
    anticipoActivo135515,
    netoAPagar,
    applicable,
  };

  // -------------------------------------------------------------------------
  // 4. Exponer al snapshot — `controlTotals.impuestoRentaNeto` (campo nuevo
  //    para que el NIIF Analyst lo cite literalmente) y bandera en
  //    `snapshot.findings`.
  // -------------------------------------------------------------------------
  snapshot.controlTotals.impuestoRentaNeto = {
    brutoPasivo2404,
    anticipoActivo135515,
    netoAPagar,
    applicable,
  };

  if (!snapshot.findings) snapshot.findings = {};
  snapshot.findings.anticipoRentaMaterial = anticipoMaterial;

  // -------------------------------------------------------------------------
  // 5. Finding informativo (no bloquea emisión).
  // -------------------------------------------------------------------------
  if (applicable) {
    findings.push({
      code: 'CUR-R16' as const,
      severity: 'informativo',
      title: 'Anticipo de Renta detectado — presentar Neto a Pagar (NIC 12 §71 + Art. 850 E.T.)',
      description:
        `Saldo material en PUC 135515 (Anticipo Impuesto de Renta) = $${formatCOP(anticipoActivo135515)} ` +
        `frente a saldo en PUC 2404 (Impuesto de Renta por Pagar) = $${formatCOP(brutoPasivo2404)}. ` +
        `Práctica revisoría fiscal: presentar la línea "Impuesto Renta — Neto a Pagar" en el Balance ` +
        `por $${formatCOP(netoAPagar)} (= bruto − anticipo). El detalle de ambas cuentas se conserva ` +
        `en los auxiliares; el netting es presentacional, no contable.`,
      normReference:
        'NIC 12 §71 (compensación activos/pasivos impuesto corriente) + NIIF for SMEs §29.29 + ' +
        'Art. 850 E.T. (saldos a favor) + Art. 855 E.T. (devolución anticipo).',
      recommendation:
        'El NIIF Analyst DEBE presentar en el Estado de Situación Financiera, debajo del rubro ' +
        '"Impuestos Corrientes" (Pasivo Corriente), la línea desglosada: "Impuesto de Renta — Bruto ' +
        `(PUC 2404): $${formatCOP(brutoPasivo2404)} (-) Anticipo Aplicable (PUC 135515): $${formatCOP(anticipoActivo135515)} ` +
        `= Neto a Pagar: $${formatCOP(netoAPagar)}". El total Pasivo Corriente DEBE usar el NETO, no el bruto.`,
      impact:
        'Sin el neteo presentacional, el balance sobre-reporta el pasivo fiscal del periodo y ' +
        'desinforma al órgano social sobre la exposición real ante la DIAN. La presentación correcta ' +
        'también facilita el seguimiento del Art. 855 E.T. cuando aplica devolución del anticipo.',
      period: snapshot.period,
    });
  }

  return { audit, findings };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Suma con precisión BigInt centavos (ITEM 1 Elite Protocol Layer 1).
 * Evita drift floating-point en saldos con 2 decimales.
 */
function sumCents(values: number[]): number {
  let acc = BigInt(0);
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    acc += BigInt(Math.round(v * 100));
  }
  return Number(acc) / 100;
}

function formatCOP(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return amount < 0 ? `-${formatted}` : formatted;
}
