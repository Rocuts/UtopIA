// ---------------------------------------------------------------------------
// Bloque Âncora — productor determinístico (TS puro, sin LLM)
// ---------------------------------------------------------------------------
// Calcula A01..A19, X01..X04, F01..F10, checks y nitDigito desde el
// `PreprocessedBalance`. Diseñado para no fallar — cuando un campo opcional
// del preprocesador no está poblado (e.g. snapshot comparativo ausente),
// emite "0" como sentinel y nunca lanza. Sin preprocesado (o con un cálculo
// que no supera la validación Zod) el Âncora completo es un sentinela de
// ceros MARCADO (`isSentinelAncora`): los productores lo emiten como `null`
// (`ancoraOrNull`) para que ninguna superficie lo lea como un balance de $0.
// ---------------------------------------------------------------------------

import type { PreprocessedBalance, PeriodSnapshot, PUCClass } from '@/lib/preprocessing/trial-balance';
import type { CompanyInfo } from '../types';
import { componerActivosImpuesto } from '../escudo-survival/fiscal-anchor/credito-renta';
import {
  type NiifAncora,
  type CcvNiif,
  type CcvFiscal,
  type AncoraChecks,
  NiifAncoraSchema,
} from './types';

// ---------------------------------------------------------------------------
// Conversión a centavos string (MoneyCop)
// ---------------------------------------------------------------------------
// ControlTotals expone pesos como `number` (con float drift potencial) y
// también `cents` como BigInt al centavo (cuando el preprocesador lo populó).
// Preferir `cents` siempre que exista; fallback a Math.round del number.
// ---------------------------------------------------------------------------
function toCentsString(pesos: number | null | undefined): string {
  if (typeof pesos !== 'number' || !Number.isFinite(pesos)) return '0';
  // Math.round evita "1234.999999" → "123499" cuando el float está cerca pero
  // no exacto. Tolerancia centavo: aceptable porque controlTotals.cents es la
  // fuente real cuando precisión absoluta importa.
  return String(Math.round(pesos * 100));
}

/**
 * Suma valor absoluto de cuentas leaf cuyo código comienza con prefijo.
 * Para los F-series fiscales que se presentan en magnitud (|Cta. 2408|).
 */
function sumAbsAccountsByPrefix(klass: PUCClass | undefined, prefix: string): number {
  if (!klass) return 0;
  return klass.accounts
    .filter((a) => a.isLeaf && a.code.startsWith(prefix))
    .reduce((sum, a) => sum + Math.abs(a.balance), 0);
}

/**
 * Total absoluto de un PUCClass — útil para F08 (|Cta. 24 total|).
 */
function totalAbsClass(snapshot: PeriodSnapshot, classCode: number): number {
  const klass = snapshot.classes.find((c) => c.code === classCode);
  if (!klass) return 0;
  return Math.abs(klass.auxiliaryTotal);
}

// ---------------------------------------------------------------------------
// Extracción del dígito de NIT (antes del DV)
// ---------------------------------------------------------------------------
// Convención DIAN: el calendario tributario se rutea por el ÚLTIMO dígito del
// cuerpo del NIT, NO el dígito de verificación. Ej. "860001317-4" → 7.
// Acepta los formatos canónico ("NNN.NNN.NNN-D"), plano ("NNNNNNNNN-D") y
// sin DV ("NNNNNNNNN"). Si no se puede extraer un dígito válido devuelve '0'
// como sentinel — el Âncora se sigue emitiendo y el agente Escudo decide.
// ---------------------------------------------------------------------------
function extractNitDigit(rawNit: string | undefined): string {
  if (!rawNit) return '0';
  // Strip DV (todo después del último '-'). Si no hay guion, todo el string
  // es cuerpo.
  const dashIdx = rawNit.lastIndexOf('-');
  const body = dashIdx >= 0 ? rawNit.slice(0, dashIdx) : rawNit;
  // Solo dígitos del cuerpo.
  const digits = body.replace(/\D/g, '');
  if (digits.length === 0) return '0';
  return digits[digits.length - 1];
}

// ---------------------------------------------------------------------------
// CCV NIIF (A01..A19, X01..X04)
// ---------------------------------------------------------------------------
function buildCcvNiif(actual: PeriodSnapshot, comparativo: PeriodSnapshot | null): CcvNiif {
  const ctA = actual.controlTotals;
  const ctC = comparativo?.controlTotals;

  // Ingresos: preferir ingresos netos de devoluciones (NIIF 15 §47) cuando
  // está poblado; fallback al bruto.
  const ingresosA = typeof ctA.ingresosNetos === 'number' ? ctA.ingresosNetos : ctA.ingresos;
  const ingresosC =
    ctC && typeof ctC.ingresosNetos === 'number'
      ? ctC.ingresosNetos
      : ctC?.ingresos ?? 0;

  // Ganancia operacional (EBIT) — preferir ebit cuando el preprocesador lo
  // populó; fallback a derivación manual A07 − Clase7 − Grupo51 − Grupo52.
  // Spec del Âncora pide A09 = A07 − Clase7 − G51 − G52 estricto; usar ebit
  // (que sigue exactamente esa fórmula en buildSnapshotForPeriod).
  const ebitA = typeof ctA.ebit === 'number' ? ctA.ebit : 0;
  const ebitC = typeof ctC?.ebit === 'number' ? ctC.ebit : 0;

  // Ganancia Bruta = ancla UB del preprocesador: ingresos OPERACIONALES netos
  // (41 − 4175) − costos 6 + 7. El grupo 42 no entra (decisión §7, NM-12 /
  // recalculo-final-06: antes se partía de los ingresos netos con el 42).
  const gananciaBruta = (ct: typeof ctA | undefined): number => {
    if (!ct) return 0;
    if (typeof ct.utilidadBruta === 'number' && Number.isFinite(ct.utilidadBruta)) {
      return ct.utilidadBruta;
    }
    const ingresosOp =
      typeof ct.ingresosOperacionalesNetos === 'number'
        ? ct.ingresosOperacionalesNetos
        : typeof ct.ingresosNetos === 'number'
          ? ct.ingresosNetos
          : ct.ingresos;
    return ingresosOp - ((ct.costoVentas6 ?? 0) + (ct.costoProduccion7 ?? 0));
  };
  const gananciaBrutaA = gananciaBruta(ctA);
  const gananciaBrutaC = gananciaBruta(ctC);

  // Ingresos operacionales netos (base del margen operacional). `null` sin el
  // ancla del preprocesador: el margen queda N/D, nunca sobre ingresos con 42.
  const ingresosOperacionalesA =
    typeof ctA.ingresosOperacionalesNetos === 'number' &&
    Number.isFinite(ctA.ingresosOperacionalesNetos)
      ? toCentsString(ctA.ingresosOperacionalesNetos)
      : null;

  // Cartera comercial neta (1305 + 1310 − |1399|), no el grupo 13 completo.
  const carteraA =
    typeof ctA.clientesNetos === 'number' && Number.isFinite(ctA.clientesNetos)
      ? toCentsString(ctA.clientesNetos)
      : null;

  return {
    A01: toCentsString(ctA.activo),
    A02: toCentsString(ctC?.activo),
    A03: toCentsString(ctA.pasivo),
    A04: toCentsString(ctC?.pasivo),
    A05: toCentsString(ctA.activo - ctA.pasivo),
    A06: toCentsString(ctC ? ctC.activo - ctC.pasivo : 0),
    A07: toCentsString(ingresosA),
    A08: toCentsString(ingresosC),
    A09: toCentsString(ebitA),
    A10: toCentsString(ebitC),
    A11: toCentsString(ctA.utilidadNeta),
    A12: toCentsString(ctC?.utilidadNeta),
    A13: toCentsString(ctA.efectivoCuenta11),
    A14: toCentsString(ctC?.efectivoCuenta11),
    A15: toCentsString(ctA.pasivoCorriente),
    A16: toCentsString(ctA.inventarios14 ?? 0),
    A17: carteraA,
    A18: toCentsString(ctA.proveedores22 ?? 0),
    A19: toCentsString(ctA.efectivoCuenta11 - (ctC?.efectivoCuenta11 ?? 0)),
    X01: toCentsString(gananciaBrutaA),
    X02: toCentsString(gananciaBrutaC),
    X03: toCentsString(ctA.activoCorriente),
    X04: toCentsString(ctA.activoNoCorriente),
    X05: ingresosOperacionalesA,
  };
}

// ---------------------------------------------------------------------------
// CCV Fiscal (F01..F10)
// ---------------------------------------------------------------------------
// F01 = UAI: cuando existe Clase 54, UAI = utilidad antes de impuesto (=
// ingresos − gastos sin impuesto, expuesto como cents.utilidadAntesImpuestos).
// Cuando NO existe Clase 54 (impuesto contable = 0), UAI ≡ utilidad neta.
// La fórmula con `cents` (BigInt) es la fuente preferida; fallback al number.
// ---------------------------------------------------------------------------
function buildCcvFiscal(actual: PeriodSnapshot): {
  fiscal: CcvFiscal;
  hasClase54: boolean;
} {
  const ct = actual.controlTotals;
  const cls1 = actual.classes.find((c) => c.code === 1);
  const cls2 = actual.classes.find((c) => c.code === 2);
  const cls5 = actual.classes.find((c) => c.code === 5);

  // ¿Existe Clase 54 (grupo 54 dentro de la Clase 5)? El grupo 54 son
  // impuestos sobre la renta (PUC 5405 ≡ Impuesto de renta y complementarios).
  const hasClase54 =
    !!cls5 &&
    cls5.accounts.some(
      (a) => a.isLeaf && a.code.startsWith('54') && Math.abs(a.balance) > 0,
    );

  // F01 — UAI. Preferir cents.utilidadAntesImpuestos cuando exista (Wave 2.F4).
  const uai =
    typeof ct.cents?.utilidadAntesImpuestos === 'bigint'
      ? Number(ct.cents.utilidadAntesImpuestos) / 100
      : ct.utilidadNeta;

  // F02 — impuesto referencial 35% (Art. 240 E.T. 2026).
  const f02 = uai * 0.35;

  // F03 — sólo crédito imputable al impuesto de RENTA (Art. 373 E.T.). Misma
  // lista blanca que el Âncora Fiscal (fiscal-anchor/credito-renta.ts):
  // 135505, 135515 y 135595/1805 sólo si el nombre lo indica. ReteIVA,
  // ReteICA/anticipo ICA, 135520/135525/135530 y 1805 «Bienes de arte y
  // cultura» no netean F02 (auditoría 2026-09, tributario-modulos-01).
  const f03 = Number(componerActivosImpuesto(cls1?.accounts ?? []).creditoRentaCents) / 100;

  // F04 — saldo neto a pagar = F02 − F03. Puede ser negativo (saldo a favor).
  const f04 = f02 - f03;

  // F05-F07 — IVA, retención por declarar, ICA (magnitud absoluta).
  const f05 = sumAbsAccountsByPrefix(cls2, '2408');
  const f06 = sumAbsAccountsByPrefix(cls2, '2365');
  const f07 = sumAbsAccountsByPrefix(cls2, '2368');

  // F08 — |Cta. 24 total| total pasivos fiscales (impuestos por pagar).
  const f08 = totalAbsClass(actual, 2) > 0 ? Math.abs(ct.impuestosCuenta24) : 0;

  // F09 — tasa efectiva. 0% si no hay Clase 54; else impuesto causado / UAI.
  const impuestoCausado =
    typeof ct.cents?.impuestoCausado === 'bigint'
      ? Number(ct.cents.impuestoCausado) / 100
      : 0;
  const tasaEfectiva = hasClase54 && uai > 0 ? (impuestoCausado / uai) * 100 : 0;

  // F10 — eficiencia fiscal = F03 / F02 × 100. 0 si F02 ≤ 0.
  const eficiencia = f02 > 0 ? (f03 / f02) * 100 : 0;

  return {
    fiscal: {
      F01: toCentsString(uai),
      F02: toCentsString(f02),
      F03: toCentsString(f03),
      F04: toCentsString(f04),
      F05: toCentsString(f05),
      F06: toCentsString(f06),
      F07: toCentsString(f07),
      F08: toCentsString(f08),
      F09: tasaEfectiva.toFixed(2),
      F10: eficiencia.toFixed(2),
    },
    hasClase54,
  };
}

// ---------------------------------------------------------------------------
// Verificaciones determinísticas
// ---------------------------------------------------------------------------
function buildChecks(args: {
  actual: PeriodSnapshot;
  comparativo: PeriodSnapshot | null;
  ccv: CcvNiif;
  fiscal: CcvFiscal;
  hasClase54: boolean;
}): AncoraChecks {
  const { actual, comparativo, ccv, fiscal, hasClase54 } = args;
  // Δ patrimonial = A01 − A03 − A05 (en cents).
  const deltaA = BigInt(ccv.A01) - BigInt(ccv.A03) - BigInt(ccv.A05);
  const deltaC = BigInt(ccv.A02) - BigInt(ccv.A04) - BigInt(ccv.A06);

  // EFE reconciliation: A14 + A19 == A13. Tolerancia $0 al centavo.
  const reconcilia = BigInt(ccv.A14) + BigInt(ccv.A19) === BigInt(ccv.A13) ? 'ok' : 'error';

  // Alerta A5 — brecha impuesto contable vs teórico. Activa si F02 > 0 y no
  // hay Clase 54 (impuesto teórico existe pero no se registró contablemente).
  const alertaA5 = BigInt(fiscal.F02) > BigInt(0) && !hasClase54 ? 'activa' : 'inactiva';

  // Alerta DEV — devoluciones materiales (>1% ingresos).
  const ct = actual.controlTotals;
  const devTotal = ct.totalDevoluciones ?? 0;
  const ingresos = ct.ingresos > 0 ? ct.ingresos : 1;
  const devRatio = devTotal / ingresos;
  const alertaDev: AncoraChecks['alertaDev'] = devRatio > 0.01 ? 'activa' : 'inactiva';

  // Suprimir lint sobre `comparativo` (lo recibimos por contrato pero los
  // checks comparativos ya están encapsulados en deltaC).
  void comparativo;

  return {
    patrimonioDelta2025: deltaA.toString(),
    patrimonioDelta2024: deltaC.toString(),
    efeReconcilia: reconcilia,
    alertaA5,
    alertaDev,
  };
}

// ---------------------------------------------------------------------------
// API pública — buildNiifAncora
// ---------------------------------------------------------------------------
/**
 * Calcula el Bloque Âncora del período actual + comparativo desde el
 * `PreprocessedBalance`. Determinístico: misma entrada → mismo output. No
 * lanza — campos faltantes se rellenan con "0" sentinel.
 *
 * @param preprocessed PreprocessedBalance pre-curado (con controlTotals y
 *                     classes poblados por buildSnapshotForPeriod).
 * @param company      CompanyInfo del intake — usado SOLO para extractar
 *                     `nitDigito`. Si está ausente, nitDigito = '0'.
 */
export function buildNiifAncora(
  preprocessed: PreprocessedBalance | undefined,
  company: CompanyInfo | undefined,
): NiifAncora {
  if (!preprocessed) {
    // Sin preprocessed no podemos calcular nada determinístico. El objeto
    // "mínimo" que se devuelve (todas las cifras en "0") existe sólo para no
    // romper el tipo de retorno de los llamadores internos: queda MARCADO
    // como sentinela y NUNCA debe presentarse como dato (ver
    // `isSentinelAncora` / `ancoraOrNull`). "0" no es "no hay dato".
    return makeEmptyAncora(company);
  }

  const actual = preprocessed.primary;
  const comparativo = preprocessed.comparative;

  const ccvNiif = buildCcvNiif(actual, comparativo);
  const { fiscal: ccvFiscal, hasClase54 } = buildCcvFiscal(actual);
  const checks = buildChecks({ actual, comparativo, ccv: ccvNiif, fiscal: ccvFiscal, hasClase54 });

  const ancora: NiifAncora = {
    periodos: {
      actual: actual.period,
      comparativo: comparativo?.period ?? null,
    },
    nitDigito: extractNitDigit(company?.nit),
    ccvNiif,
    ccvFiscal,
    checks,
    version: '1.0',
    computedAt: new Date().toISOString(),
  };

  // Red de seguridad: si por una razón inesperada los regex de MoneyCop /
  // Percent rechazan algún campo, fallback a empty + log. NO lanzamos para
  // que el pipeline downstream nunca se rompa por el Âncora.
  const parsed = NiifAncoraSchema.safeParse(ancora);
  if (!parsed.success) {
    console.warn(
      '[buildNiifAncora] Âncora calculado falla validación Zod — devolviendo empty:',
      parsed.error.message,
    );
    return makeEmptyAncora(company);
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Âncora sentinela — "no hay dato" nunca viaja como $0
// ---------------------------------------------------------------------------
// El Âncora vacío (sin preprocesado, o cuyo cálculo no superó la validación
// Zod) lleva "0" en TODAS las cifras y checks que, leídos como datos, suman
// puntos de calidad (Δ patrimonial "0" = "cuadra al centavo"). La vista de las
// cuatro áreas lo trataba como un balance real: activos $0, utilidad $0 y un
// Score NIIF de 80/100 que ningún cálculo respalda. El contrato del producto es
// que `null`/N/D no es cero, así que el sentinela queda registrado aquí y los
// productores lo convierten en `null` antes de emitirlo.
//
// WeakSet y no un campo del schema: `NiifAncoraSchema` es contrato compartido
// con la UI y la persistencia; la marca vive sólo en proceso, que es donde se
// decide si el Âncora se emite o no.
// ---------------------------------------------------------------------------
const SENTINEL_ANCORAS = new WeakSet<NiifAncora>();

/**
 * `true` cuando el Âncora es el sentinela vacío de `buildNiifAncora` (sin
 * preprocesado o con cálculo inválido): sus "0" no son cifras del cliente.
 */
export function isSentinelAncora(ancora: NiifAncora | null | undefined): boolean {
  return !!ancora && SENTINEL_ANCORAS.has(ancora);
}

/**
 * El Âncora listo para emitir: `null` cuando no hay cifras deterministas que
 * lo respalden. Es la forma que deben usar las superficies (SSE `niif_ancora`,
 * payload `niif_phase`, persistencia): un Âncora ausente se muestra como N/D.
 */
export function ancoraOrNull(ancora: NiifAncora | null | undefined): NiifAncora | null {
  if (!ancora || isSentinelAncora(ancora)) return null;
  return ancora;
}

function makeEmptyAncora(company: CompanyInfo | undefined): NiifAncora {
  const zero: string = '0';
  const sentinel: NiifAncora = {
    periodos: { actual: company?.fiscalPeriod ?? '', comparativo: null },
    nitDigito: extractNitDigit(company?.nit),
    ccvNiif: {
      A01: zero, A02: zero, A03: zero, A04: zero, A05: zero, A06: zero,
      A07: zero, A08: zero, A09: zero, A10: zero, A11: zero, A12: zero,
      A13: zero, A14: zero, A15: zero, A16: zero, A17: zero, A18: zero,
      A19: zero, X01: zero, X02: zero, X03: zero, X04: zero, X05: zero,
    },
    ccvFiscal: {
      F01: zero, F02: zero, F03: zero, F04: zero, F05: zero,
      F06: zero, F07: zero, F08: zero, F09: '0.00', F10: '0.00',
    },
    checks: {
      patrimonioDelta2025: zero,
      patrimonioDelta2024: zero,
      efeReconcilia: 'error',
      alertaA5: 'inactiva',
      alertaDev: 'inactiva',
    },
    version: '1.0',
    computedAt: new Date().toISOString(),
  };
  SENTINEL_ANCORAS.add(sentinel);
  return sentinel;
}
