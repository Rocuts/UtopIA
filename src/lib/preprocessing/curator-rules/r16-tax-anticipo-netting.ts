// ---------------------------------------------------------------------------
// R16 — Créditos de renta (1355/1805) → Neto a Pagar contra PUC 2404
// ---------------------------------------------------------------------------
// Elite Protocol Layer 2 (Lógica de Negocio) + Layer 3 (Defensa Tributaria).
//
// Cuando la entidad tiene créditos imputables al impuesto de renta —retención
// en la fuente (135515), anticipo de renta (135505), autorretenciones y demás
// créditos de renta de 135595/1805 según la regla ÚNICA de
// `@/lib/accounting/renta-credit`— la presentación del Balance muestra
// "Impuesto Renta — Neto a Pagar = Bruto (PUC 2404) − créditos de renta"
// debajo del rubro de Impuestos Corrientes en el Pasivo. Presentar sólo el
// bruto sobre-expone la posición fiscal del usuario al órgano social.
//
// Re-auditoría 2026-09 (NM-06): antes sólo se neteaba 135515 (rotulada
// «Anticipo Renta», cuando es la retención en la fuente) e ignoraba el
// anticipo 135505: el bloque vinculante publicaba NETO A PAGAR 35 M frente a
// una posición de renta de 15 M del mismo balance. Ahora el neto usa todos
// los créditos de renta, la misma cifra que la posición del Dictamen 2
// (`audit/bindings.ts`) y el saldo a favor del preprocesador.
//
// Sustento normativo:
//   - NIC 12 §71 — compensación de activos y pasivos por impuestos corrientes
//     cuando la entidad tiene derecho legal exigible.
//   - NIIF for SMEs §29.29 — presentación de impuestos corrientes.
//   - Arts. 365, 373 y 807 E.T. — retenciones y anticipo imputables a renta.
//   - Art. 850 E.T. — devolución y aplicación de saldos a favor.
//
// La regla NO MUTA las cuentas 2404 ni 1355/1805 (siguen en el detalle del
// balance para auditoría). SÓLO expone el neto en `controlTotals.impuestoRentaNeto`
// como ancla vinculante. El campo `anticipoActivo135515` conserva su nombre por
// contrato (tipo `ImpuestoRentaNeto` en trial-balance.ts) pero contiene la suma
// de TODOS los créditos de renta. Severidad: informativo.
// ---------------------------------------------------------------------------

import { filtrarCreditoRenta } from '@/lib/accounting/renta-credit';

import type { PeriodSnapshot, PUCClass } from '../trial-balance';
import type { CuratorFinding } from './types';

/** Materialidad mínima para considerar el anticipo "material" (disparar netting). */
const ANTICIPO_MATERIALITY = 100_000; // $100k COP
/** Tolerancia para considerar un saldo ≈ 0. */
const ZERO_TOLERANCE = 1_000; // $1k COP

export interface R16AuditResult {
  brutoPasivo2404: number;
  /** Suma de TODOS los créditos de renta (1355/1805, regla única); nombre por contrato. */
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
  // 1. Créditos de renta en Activo — regla ÚNICA (1355/1805): retención en la
  //    fuente 135515, anticipo de renta 135505, autorretenciones y 1805 sólo
  //    con nombre de renta. ICA, IVA y demás tributos no netean la renta.
  // -------------------------------------------------------------------------
  const creditAccounts = filtrarCreditoRenta(class1?.accounts ?? []);
  const anticipoActivo135515 = sumCents(creditAccounts.map((a) => a.balance));

  // -------------------------------------------------------------------------
  // 2. Bruto en Pasivo — PUC 2404 (Impuesto de Renta y Complementarios).
  // -------------------------------------------------------------------------
  const brutoAccounts = (class2?.accounts ?? []).filter((a) =>
    a.code.startsWith('2404'),
  );
  const brutoPasivo2404 = sumCents(brutoAccounts.map((a) => a.balance));

  // -------------------------------------------------------------------------
  // 3. Neto = Bruto − créditos de renta. Aplicable sólo si AMBOS son materiales.
  //    Si los créditos > bruto, el neto es negativo (saldo a favor en activo,
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
    const detalle = creditAccounts
      .map((a) => `${a.code} ${a.name} $${formatCOP(a.balance)}`)
      .join('; ');
    findings.push({
      code: 'CUR-R16' as const,
      severity: 'informativo',
      title:
        'Créditos de renta (retenciones y anticipos) — presentar Neto a Pagar (NIC 12 §71 + Art. 850 E.T.)',
      description:
        `Créditos imputables al impuesto de renta (retención en la fuente, anticipo y ` +
        `autorretenciones de renta; 1355/1805) = $${formatCOP(anticipoActivo135515)} [${detalle}] ` +
        `frente a saldo en PUC 2404 (Impuesto de Renta por Pagar) = $${formatCOP(brutoPasivo2404)}. ` +
        `Práctica revisoría fiscal: presentar la línea "Impuesto Renta — Neto a Pagar" en el Balance ` +
        `por $${formatCOP(netoAPagar)} (= bruto − créditos de renta). El detalle de las cuentas se conserva ` +
        `en los auxiliares; el netting es presentacional, no contable.`,
      normReference:
        'NIC 12 §71 (compensación activos/pasivos impuesto corriente) + NIIF for SMEs §29.29 + ' +
        'Arts. 365, 373 y 807 E.T. (retenciones y anticipo imputables a renta) + Art. 850 E.T. (saldos a favor).',
      recommendation:
        'El NIIF Analyst DEBE presentar en el Estado de Situación Financiera, debajo del rubro ' +
        '"Impuestos Corrientes" (Pasivo Corriente), la línea desglosada: "Impuesto de Renta — Bruto ' +
        `(PUC 2404): $${formatCOP(brutoPasivo2404)} (-) Retenciones y anticipos de renta (1355/1805): $${formatCOP(anticipoActivo135515)} ` +
        `= Neto a Pagar: $${formatCOP(netoAPagar)}". El total Pasivo Corriente DEBE usar el NETO, no el bruto.`,
      impact:
        'Sin el neteo presentacional, el balance sobre-reporta el pasivo fiscal del periodo y ' +
        'desinforma al órgano social sobre la exposición real ante la DIAN. La presentación correcta ' +
        'también facilita el seguimiento del Art. 850 E.T. cuando procede un saldo a favor.',
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
