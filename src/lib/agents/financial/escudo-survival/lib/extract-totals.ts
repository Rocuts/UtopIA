// ---------------------------------------------------------------------------
// Helper deterministico — extrae totales y saldos clave del PreprocessedBalance
// ---------------------------------------------------------------------------
// Los agentes LLM reciben un bloque ANCHOR formateado por este modulo. La
// idea es que el modelo NO tenga que volver a parsear el balance — los
// numeros vienen pre-calculados aqui (deterministico, sin alucinacion). El
// agente solo razona, no extrae.
// ---------------------------------------------------------------------------
//
// PUC PYME observado: las cuentas mayor (e.g. 1355, 1105, 3305) suelen ser
// no-postables; las cifras viven en sus subcuentas postables (135515, 110505,
// 330505, etc.). Sumamos a traves de la jerarquia recursivamente.
// ---------------------------------------------------------------------------

import type {
  PreprocessedBalance,
  PeriodSnapshot,
  PUCClass,
  ValidatedAccount,
} from '@/lib/preprocessing/trial-balance';

export interface SurvivalAnchorTotals {
  /** Periodo etiquetado (ej. "2025") usado para timestamps. */
  period: string;
  // Control totals -----------------------------------------------------------
  activo: number;
  pasivo: number;
  patrimonio: number;
  ingresos: number;
  gastos: number;
  utilidadNeta: number;
  /** UAI = ingresos - (gastos sin gasto por impuesto). Aproximacion. */
  utilidadAntesImpuestos: number;
  /** Impuesto causado del periodo (clase 54 si esta presente). */
  impuestoCausado: number;
  /** Costos de venta + costos de produccion (clases 6 + 7). Para Art. 771-5 §1. */
  costosTotales: number;
  // Cuentas clave para los 5 agentes ----------------------------------------
  /** Saldo cuenta 1105 (Caja). Aproxima pagos en efectivo. */
  saldoCuenta1105: number;
  /** Saldo cuenta 1355 (Anticipos de impuestos y contribuciones). */
  saldoCuenta1355: number;
  /** Subcuentas postables de 1355 con monto > 0. */
  subcuentas1355: Array<{ code: string; name: string; balance: number }>;
  /** Saldo cuenta 3305 (Reserva legal). Opcional. */
  saldoCuenta3305: number;
  /** Saldo cuenta 3115 (Capital suscrito y pagado). Opcional. */
  saldoCuenta3115: number;
  /** Subcuentas postables de la clase 22 (Cuentas por pagar) con monto > 0. */
  cuentasPorPagarClase22: Array<{ code: string; name: string; balance: number }>;
}

/** Suma recursiva de todas las cuentas POSTABLES (level === 'Auxiliar') bajo un prefijo. */
function sumPostablesUnderPrefix(
  classes: PUCClass[],
  prefix: string,
): { total: number; rows: ValidatedAccount[] } {
  const rows: ValidatedAccount[] = [];
  for (const cls of classes) {
    if (!cls.accounts) continue;
    for (const acc of cls.accounts) {
      if (!acc || !acc.code) continue;
      if (!acc.code.startsWith(prefix)) continue;
      // Solo sumamos auxiliares para evitar doble-conteo con padres.
      if (acc.isLeaf) {
        rows.push(acc);
      }
    }
  }
  const total = rows.reduce((s, r) => s + (r.balance || 0), 0);
  return { total, rows };
}

/** Saldo de una cuenta especifica (postable o no). Si no existe retorna 0. */
function findAccountBalance(classes: PUCClass[], code: string): number {
  for (const cls of classes) {
    for (const acc of cls.accounts || []) {
      if (acc.code === code) return acc.balance || 0;
    }
  }
  // Si no encontramos exacto, sumamos los postables bajo el prefijo.
  return sumPostablesUnderPrefix(classes, code).total;
}

/** Suma TODOS los postables de una clase PUC (1 al 7). */
function sumClassPostables(classes: PUCClass[], classCode: number): number {
  const cls = classes.find((c) => c.code === classCode);
  if (!cls) return 0;
  return cls.accounts.filter((a) => a.isLeaf).reduce((s, a) => s + (a.balance || 0), 0);
}

/** Lista subcuentas postables con saldo > 0 bajo un prefijo. */
function listPostablesUnderPrefix(
  classes: PUCClass[],
  prefix: string,
): Array<{ code: string; name: string; balance: number }> {
  const out: Array<{ code: string; name: string; balance: number }> = [];
  for (const cls of classes) {
    for (const acc of cls.accounts || []) {
      if (!acc || !acc.code || !acc.isLeaf) continue;
      if (!acc.code.startsWith(prefix)) continue;
      const bal = acc.balance || 0;
      if (Math.abs(bal) > 0.5) {
        out.push({ code: acc.code, name: acc.name, balance: bal });
      }
    }
  }
  return out.sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
}

export function extractSurvivalAnchors(
  preprocessed: PreprocessedBalance,
): SurvivalAnchorTotals {
  const snap: PeriodSnapshot = preprocessed.primary;
  const classes = snap.classes || [];

  const ct = snap.controlTotals;
  const ingresos = ct?.ingresos ?? snap.summary?.totalRevenue ?? 0;
  const gastos = ct?.gastos ?? snap.summary?.totalExpenses ?? 0;
  const utilidadNeta = ct?.utilidadNeta ?? snap.summary?.netIncome ?? ingresos - gastos;
  const impuestoCausado = ct?.cents ? Number(ct.cents.impuestoCausado) / 100 : 0;
  const utilidadAntesImpuestos = ct?.cents
    ? Number(ct.cents.utilidadAntesImpuestos) / 100
    : utilidadNeta + impuestoCausado;

  const costosVenta = sumClassPostables(classes, 6);
  const costosProd = sumClassPostables(classes, 7);
  const costosTotales = gastos + costosVenta + costosProd;

  const saldoCuenta1105 = findAccountBalance(classes, '1105');
  const saldoCuenta1355 = findAccountBalance(classes, '1355');
  const subcuentas1355 = listPostablesUnderPrefix(classes, '1355');
  const saldoCuenta3305 = findAccountBalance(classes, '3305');
  const saldoCuenta3115 = findAccountBalance(classes, '3115');
  const cuentasPorPagarClase22 = listPostablesUnderPrefix(classes, '22').slice(0, 10);

  return {
    period: snap.period,
    activo: ct?.activo ?? snap.summary?.totalAssets ?? 0,
    pasivo: ct?.pasivo ?? snap.summary?.totalLiabilities ?? 0,
    patrimonio: ct?.patrimonio ?? snap.summary?.totalEquity ?? 0,
    ingresos,
    gastos,
    utilidadNeta,
    utilidadAntesImpuestos,
    impuestoCausado,
    costosTotales,
    saldoCuenta1105,
    saldoCuenta1355,
    subcuentas1355,
    saldoCuenta3305,
    saldoCuenta3115,
    cuentasPorPagarClase22,
  };
}

/** Formato es-CO para montos: $1.234.567,89. */
function fmtCOP(n: number): string {
  return (
    '$' +
    Number(n).toLocaleString('es-CO', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })
  );
}

/**
 * Bloque markdown que se inyecta en el `user content` de cada agente. Los
 * numeros aqui son la VERDAD vinculante — el agente no debe alterarlos.
 */
export function buildAnchorBlock(anchors: SurvivalAnchorTotals): string {
  const sub1355 =
    anchors.subcuentas1355.length === 0
      ? '_(sin subcuentas postables con saldo)_'
      : anchors.subcuentas1355
          .map((s) => `  - ${s.code} ${s.name}: ${fmtCOP(s.balance)}`)
          .join('\n');

  const cxp22 =
    anchors.cuentasPorPagarClase22.length === 0
      ? '_(sin cuentas por pagar clase 22 con saldo)_'
      : anchors.cuentasPorPagarClase22
          .map((s) => `  - ${s.code} ${s.name}: ${fmtCOP(s.balance)}`)
          .join('\n');

  return `### TOTALES VINCULANTES (preprocesados, NO RECALCULAR)
- Periodo: ${anchors.period}
- Activo total: ${fmtCOP(anchors.activo)}
- Pasivo total: ${fmtCOP(anchors.pasivo)}
- Patrimonio: ${fmtCOP(anchors.patrimonio)}
- Ingresos: ${fmtCOP(anchors.ingresos)}
- Gastos (clase 5): ${fmtCOP(anchors.gastos)}
- Costos totales (clases 5+6+7): ${fmtCOP(anchors.costosTotales)}
- Utilidad neta: ${fmtCOP(anchors.utilidadNeta)}
- Utilidad antes de impuestos (UAI): ${fmtCOP(anchors.utilidadAntesImpuestos)}
- Impuesto causado del periodo (clase 54): ${fmtCOP(anchors.impuestoCausado)}

### CUENTAS CLAVE
- 1105 Caja: ${fmtCOP(anchors.saldoCuenta1105)}
- 1355 Anticipos de Impuestos y Contribuciones: ${fmtCOP(anchors.saldoCuenta1355)}
${sub1355}
- 3305 Reserva legal: ${fmtCOP(anchors.saldoCuenta3305)}
- 3115 Capital suscrito y pagado: ${fmtCOP(anchors.saldoCuenta3115)}

### CUENTAS POR PAGAR (clase 22, top 10 por monto)
${cxp22}
`;
}
