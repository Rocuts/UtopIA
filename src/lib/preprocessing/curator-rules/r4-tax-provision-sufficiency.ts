// ---------------------------------------------------------------------------
// R4 — Causación del impuesto de renta (sólo cuentas de renta)
// ---------------------------------------------------------------------------
// Auditoría 2026-09 (niif-preproceso-17). La versión anterior comparaba TODO
// el grupo 24 (IVA, ICA, retenciones…) contra el 35 % de la utilidad NETA —
// que ya descuenta el gasto de renta— y emitía un hallazgo CRÍTICO de
// "pasivo fiscal oculto" con un monto a provisionar. Resultado: falso
// crítico con la renta correctamente causada y compensada con anticipos, y
// silencio con un IVA por pagar alto sin renta causada.
//
// Política de producto (HANDOFF): la utilidad contable / UAI NO es base
// fiscal. El impuesto de renta depende de la depuración (renta líquida,
// Art. 26 E.T.; rentas exentas, deducciones, descuentos; TTD sólo con ID/UD
// verificados). Sin esa base, el sistema no cuantifica impuesto ni brecha.
//
// Contrato vigente:
//   - Sólo se leen cuentas de RENTA según el PUC D. 2650/1993:
//       grupo 54 "Impuesto de renta y complementarios" (gasto),
//       2404 "De renta y complementarios" (pasivo),
//       1355 anticipos/retenciones de renta (135505, 135515 y 135595 sólo si
//       su nombre es de renta).
//   - Si hay UAI positiva material y NO hay gasto de renta causado (54 = 0),
//     se emite un hallazgo INFORMATIVO sin monto: requiere depuración fiscal.
//   - Nunca se calcula "renta teórica" ni "brecha" (sin `taxProvisionRisk`).
//   - La coherencia gasto 54 ↔ pasivo 24 la evalúa R10.
// ---------------------------------------------------------------------------

import type { PeriodSnapshot } from '../trial-balance';

import type { CuratorFinding, TaxProvisionRisk } from './types';

/** UAI mínima para considerar que "debería" haber revisión de la renta. */
const UAI_MATERIALITY = 1_000_000; // $1M COP

export interface R4Result {
  /**
   * Histórico: brecha cuantificada contra una tasa nominal. Ya no se emite
   * (sin base fiscal verificada no hay cifra que publicar).
   */
  taxProvisionRisk?: TaxProvisionRisk;
  findings: CuratorFinding[];
}

/** Subcuentas 1355 que son crédito de RENTA (decisión de negocio 2026-09). */
function isRentaCredit(code: string, name: string): boolean {
  if (code.startsWith('135505') || code.startsWith('135515')) return true;
  if (code.startsWith('135595')) return /renta/i.test(name);
  return false;
}

export function runR4(snapshot: PeriodSnapshot): R4Result {
  const classes = snapshot.classes ?? [];
  const accountsOf = (cls: number) => classes.find((c) => c.code === cls)?.accounts ?? [];

  const gastoRenta54 = accountsOf(5)
    .filter((a) => a.code.startsWith('54'))
    .reduce((s, a) => s + a.balance, 0);
  const pasivoRenta2404 = accountsOf(2)
    .filter((a) => a.code.startsWith('2404'))
    .reduce((s, a) => s + a.balance, 0);
  const creditosRenta1355 = accountsOf(1)
    .filter((a) => isRentaCredit(a.code, a.name))
    .reduce((s, a) => s + a.balance, 0);

  const cents = snapshot.controlTotals.cents;
  const uai = cents
    ? Number(cents.utilidadAntesImpuestos) / 100
    : snapshot.controlTotals.utilidadNeta + gastoRenta54;

  // Sin utilidad contable material no hay nada que revisar.
  if (!(uai > UAI_MATERIALITY)) return { findings: [] };
  // Hay gasto de renta causado: la coherencia con el pasivo la evalúa R10.
  if (Math.abs(gastoRenta54) > 0) return { findings: [] };

  const finding: CuratorFinding = {
    code: 'CUR-R4',
    severity: 'informativo',
    title: 'Sin gasto de renta causado en el periodo — requiere depuración fiscal',
    description:
      `El periodo tiene utilidad contable antes de impuestos de $${formatCOP(uai)} y no registra ` +
      `gasto de impuesto de renta (grupo 54). Cuentas de renta del balance: pasivo 2404 ` +
      `$${formatCOP(pasivoRenta2404)}; anticipos y retenciones de renta (1355) ` +
      `$${formatCOP(creditosRenta1355)}. La utilidad contable no es base fiscal: determinar ` +
      `si existe impuesto por pagar exige la depuración de la renta líquida. El sistema no ` +
      `estima el impuesto ni una brecha sin esa base.`,
    normReference:
      'Art. 26 E.T. (depuración de la renta) + NIC 12 / NIIF para las PYMES Sección 29',
    recommendation:
      'Verificar con el contador si la provisión de renta del periodo está pendiente de ' +
      'causar (Dr. 5405 / Cr. 2404) o si la entidad no es contribuyente / no tiene renta ' +
      'líquida gravable, y documentarlo en notas.',
    impact:
      'Informativo: el resultado neto puede cambiar cuando se cause el impuesto de renta; ' +
      'no hay cifra verificable para cuantificarlo.',
    period: snapshot.period,
  };

  return { findings: [finding] };
}

function formatCOP(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return amount < 0 ? `-${formatted}` : formatted;
}
