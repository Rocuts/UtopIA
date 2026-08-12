// ---------------------------------------------------------------------------
// Capa 4 — Módulo 3 — Tool: Risk Score Calculator (0-100)
// ---------------------------------------------------------------------------
//
// Fórmula 5 factores → score 0-100 → nivel cualitativo.
// 100% determinístico: cero LLM, cero red.
//
// Factores (suma de puntos):
//   1. TET muy baja (F09) — SÓLO aplicable con base gravable y provisión
//      causada (ver `factorTet`, tres ramas):
//        F09 = 0%        → +30
//        F09 1-14%       → +20
//        F09 15-25%      → +5
//        F09 > 25%       → +0
//   2. Margen neto alto:
//        > 90%           → +25
//        70-90%          → +15
//        30-70%          → +5
//        < 30%           → +0
//   3. Costo de ventas bajo (Clases 6+7 / Ingresos):
//        < 1%            → +20
//        1-10%           → +10
//        > 10%           → +0
//   4. Crecimiento ingresos inusual (vs comparativo si existe):
//        > 100%          → +15
//        50-100%         → +8
//        < 50%           → +0
//   5. Saldo a favor sin solicitar:
//        > $50M y no se ha solicitado → +10
//        sino                          → +0
//
// Niveles:
//   0-20   → bajo
//   21-40  → medio
//   41-60  → alto
//   61-80  → muy_alto
//   81-100 → critico
// ---------------------------------------------------------------------------

import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import { formatCopFromCents, serializeMoneyCop } from '@/lib/agents/financial/contracts/money';
import type { FiscalAnchorBlock } from '../../fiscal-anchor/types';
import type { RiskFactorBreakdown, RiskNivel } from '../types';

const ZERO = BigInt(0);

const SALDO_FAVOR_MATERIALIDAD_COP = 50_000_000;

export interface RiskScorePrecomputedData {
  score: number;
  nivel: RiskNivel;
  factores: RiskFactorBreakdown[];
  /**
   * `false` ⇒ el score NO debe publicarse al cliente.
   *
   * Los seis factores miden razones sobre la base gravable (F01) o sobre los
   * ingresos. Con F01 = $0 —balance sin P&G, o P&G que se anula exactamente—
   * no hay ninguna magnitud fiscal que medir: el 0/100 "bajo" que sale de la
   * suma es la ausencia de datos, no un juicio de bajo riesgo. Publicarlo es
   * afirmar algo que el balance no soporta. Consumidores: mostrar "no
   * determinable" en vez de la aguja.
   */
  publicable: boolean;
  /** Motivo en español cuando `publicable === false`; `null` en otro caso. */
  noPublicableMotivo: string | null;
}

interface RiskInput {
  anchor: FiscalAnchorBlock;
  preprocessed: PreprocessedBalance;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pctRatioCents(num: bigint, denom: bigint): number {
  if (denom <= ZERO) return 0;
  const scaled = (num * BigInt(10000)) / denom;
  return Number(scaled) / 100;
}

/**
 * Ingresos del periodo anterior (comparativo) en BigInt cents, si están
 * disponibles. Retorna `null` cuando no hay periodo comparativo materializado
 * en `controlTotals.cents` (single-period balance).
 */
function ingresosComparativoCents(
  pp: PreprocessedBalance,
): bigint | null {
  const comp = pp.comparative;
  if (!comp) return null;
  const cents = comp.controlTotals.cents;
  if (!cents) return null;
  return cents.ingresos;
}

// ---------------------------------------------------------------------------
// Factor 1 — TET baja (F09)
// ---------------------------------------------------------------------------
// F09 = Clase 54 / F01 × 100. Es un COCIENTE, y como todo cociente sólo
// significa algo cuando el numerador y el denominador existen. Hasta la
// auditoría 2026-08 el factor colapsaba tres situaciones contablemente
// distintas en un único `F09 = 0 → +30 puntos`:
//
//   · UAI ≤ 0 (pérdida del ejercicio) — no hay renta líquida sobre la cual
//     medir tasa alguna. Art. 240 E.T. grava la renta líquida gravable y el
//     Art. 147 E.T. permite compensar la pérdida fiscal en los 12 periodos
//     siguientes: no causar impuesto sobre una pérdida es lo CORRECTO, no una
//     señal de elusión. Medido sobre `perdida-y-patrimonio-negativo.csv`
//     (UAI −$460.000.000): el factor publicaba 30/100 "medio" con el texto
//     "tasa efectiva nula sobre utilidad" para una empresa sin utilidad.
//
//   · UAI > 0 pero SIN grupo 54 en el balance — el impuesto no está causado.
//     Es un defecto de CIERRE contable (NIC 12 §46 exige reconocer el gasto
//     por impuesto corriente), no evidencia de que la empresa tribute poco:
//     no se puede afirmar cuánto tributa quien todavía no registró la
//     provisión. El motor YA denuncia este hecho por su propio canal —
//     `A5_SIN_PROVISION`, severidad `error`, en `alerts.ts` — así que sumarle
//     además 30 puntos de riesgo cuenta el mismo hecho dos veces y, sobre el
//     balance del cliente real, era el 43% de un score de 70/100 que enciende
//     Modo Supervivencia (`score > 60`).
//
//   · UAI > 0 y grupo 54 poblado — aquí sí el cociente mide lo que dice medir
//     y se aplica la escala del par. 6 del Art. 240 E.T. (TTD 15%).
//
// El discriminante de la rama 2 es el propio hecho contable (Clase 54 = $0),
// corroborado con la alerta que el anchor ya trae.

function factorTet(
  anchor: FiscalAnchorBlock,
  impuestoCausadoCents: bigint,
): RiskFactorBreakdown {
  const descripcion = 'Tasa efectiva de tributación (F09)';
  const f01Cents = BigInt(anchor.f01);

  // Rama 1 — sin base gravable positiva el cociente no es medible.
  if (f01Cents <= ZERO) {
    return {
      factor: 'tet_baja',
      descripcion,
      puntos: 0,
      detalle:
        `Utilidad antes de impuestos ≤ $0 (F01 = ${formatCopFromCents(f01Cents)}) — no hay renta ` +
        'líquida sobre la cual medir tasa efectiva; factor NO APLICABLE. La ausencia de impuesto ' +
        'causado sobre una pérdida es el tratamiento correcto (Art. 147 E.T.: pérdida fiscal ' +
        'compensable en los 12 periodos gravables siguientes).',
    };
  }

  // Rama 2 — hay base gravable pero el impuesto no está causado: es un
  // hallazgo de cierre contable, no de tasa efectiva. Cero puntos de riesgo;
  // el hecho viaja por `A5_SIN_PROVISION` (severidad `error`).
  const sinProvision =
    impuestoCausadoCents === ZERO ||
    anchor.alertas.some((a) => a.codigo === 'A5_SIN_PROVISION');
  if (sinProvision) {
    return {
      factor: 'tet_baja',
      descripcion,
      puntos: 0,
      detalle:
        `Utilidad antes de impuestos de ${formatCopFromCents(f01Cents)} SIN provisión de renta ` +
        'registrada (Clase 54 = $0): los libros no están cerrados y la tasa efectiva todavía no ' +
        'es medible. AVISO — se reporta por la alerta A5_SIN_PROVISION (Art. 240 E.T. + NIC 12 ' +
        '§46), no como puntaje de riesgo: causar el impuesto es un ajuste de cierre, no un ' +
        'indicio de elusión.',
    };
  }

  // Rama 3 — F01 > 0 y Clase 54 poblada: la escala mide lo que dice medir.
  const f09 = anchor.f09;
  let puntos: number;
  let detalle: string;
  if (f09 <= 0.01) {
    puntos = 30;
    detalle =
      `F09 = ${f09}% con provisión causada de ${formatCopFromCents(impuestoCausadoCents)} sobre ` +
      `una UAI de ${formatCopFromCents(f01Cents)} — tasa efectiva prácticamente nula. Activa Modo Supervivencia.`;
  } else if (f09 < 15) {
    puntos = 20;
    detalle = `F09 = ${f09}% — debajo del umbral 15% de TTD (Art. 240 par. 6 E.T.).`;
  } else if (f09 <= 25) {
    puntos = 5;
    detalle = `F09 = ${f09}% — por encima del umbral pero todavía revisable.`;
  } else {
    puntos = 0;
    detalle = `F09 = ${f09}% — tasa efectiva consistente con tarifa general.`;
  }
  return { factor: 'tet_baja', descripcion, puntos, detalle };
}

// ---------------------------------------------------------------------------
// Factor 1-bis — Utilidad positiva SIN provisión de renta causada
// ---------------------------------------------------------------------------
// Nace de separar en dos lo que `factorTet` mezclaba. Antes, la rama "F09 = 0"
// puntuaba 30 tanto a una empresa con provisión ínfima (elusión posible) como a
// una con los libros sin cerrar (hallazgo de cierre) como a una EN PÉRDIDA
// (donde no causar impuesto es lo correcto — Art. 147 E.T.).
//
// `factorTet` ya no puntúa los dos últimos casos. Pero una utilidad material sin
// impuesto causado SÍ es riesgo frente a la DIAN, sólo que por otro motivo: el
// Art. 240 E.T. y la NIC 12 §46 exigen reconocer el gasto por impuesto en el
// periodo, y una declaración presentada sobre libros así expone al Art. 647 E.T.
// Por eso conserva puntaje, con el texto correcto y su propio código.
function factorSinProvisionRenta(
  anchor: FiscalAnchorBlock,
  impuestoCausadoCents: bigint,
): RiskFactorBreakdown {
  const descripcion = 'Utilidad sin provisión de renta causada';
  const f01Cents = BigInt(anchor.f01);

  // Sin utilidad no hay nada que provisionar: es el tratamiento correcto.
  if (f01Cents <= ZERO) {
    return {
      factor: 'sin_provision_renta',
      descripcion,
      puntos: 0,
      detalle:
        `Utilidad antes de impuestos ≤ $0 (F01 = ${formatCopFromCents(f01Cents)}) — no procede ` +
        'provisión de renta; factor NO APLICABLE (Art. 147 E.T.).',
    };
  }

  const sinProvision =
    impuestoCausadoCents === ZERO ||
    anchor.alertas.some((a) => a.codigo === 'A5_SIN_PROVISION');
  if (!sinProvision) {
    return {
      factor: 'sin_provision_renta',
      descripcion,
      puntos: 0,
      detalle:
        `Provisión de renta causada por ${formatCopFromCents(impuestoCausadoCents)} sobre una UAI ` +
        `de ${formatCopFromCents(f01Cents)} — el gasto por impuesto está reconocido (NIC 12 §46).`,
    };
  }

  return {
    factor: 'sin_provision_renta',
    descripcion,
    puntos: 30,
    detalle:
      `Utilidad antes de impuestos de ${formatCopFromCents(f01Cents)} SIN provisión de renta ` +
      'registrada (Clase 54 = $0). El Art. 240 E.T. y la NIC 12 §46 exigen reconocer el gasto por ' +
      'impuesto en el periodo; declarar sobre libros sin causar expone a la sanción por inexactitud ' +
      'del Art. 647 E.T. Causar el impuesto antes de presentar corrige el hallazgo y baja el score.',
  };
}

// ---------------------------------------------------------------------------
// Factor 2 — Margen neto alto (utilidadNeta / ingresos)
// ---------------------------------------------------------------------------

function factorMargenNeto(pp: PreprocessedBalance): RiskFactorBreakdown {
  const cents = pp.primary.controlTotals.cents;
  if (!cents || cents.ingresos <= ZERO) {
    return {
      factor: 'margen_alto',
      descripcion: 'Margen neto sobre ingresos',
      puntos: 0,
      detalle: 'No hay ingresos materializados — factor no aplicable.',
    };
  }
  const margenPct = pctRatioCents(cents.utilidadNeta, cents.ingresos);
  let puntos: number;
  let detalle: string;
  if (margenPct > 90) {
    puntos = 25;
    detalle = `Margen neto ${margenPct.toFixed(1)}% — atípicamente alto, perfil de actividad de bajo costo dudoso.`;
  } else if (margenPct >= 70) {
    puntos = 15;
    detalle = `Margen neto ${margenPct.toFixed(1)}% — alto, susceptible de revisión por la DIAN.`;
  } else if (margenPct >= 30) {
    puntos = 5;
    detalle = `Margen neto ${margenPct.toFixed(1)}% — dentro de banda razonable según sector.`;
  } else {
    puntos = 0;
    detalle = `Margen neto ${margenPct.toFixed(1)}% — consistente con operación regular.`;
  }
  return { factor: 'margen_alto', descripcion: 'Margen neto sobre ingresos', puntos, detalle };
}

// ---------------------------------------------------------------------------
// Factor 3 — Costo de ventas bajo
// ---------------------------------------------------------------------------

function factorCostoBajo(pp: PreprocessedBalance): RiskFactorBreakdown {
  // gastos incluye clases 5+6+7. Asumimos como proxy razonable de costos
  // operativos totales — el cálculo refinado por clase requiere acceso al
  // árbol de cuentas que no exponemos a este tool.
  const cents = pp.primary.controlTotals.cents;
  if (!cents || cents.ingresos <= ZERO) {
    return {
      factor: 'costo_bajo',
      descripcion: 'Relación costo-ingreso',
      puntos: 0,
      detalle: 'No hay ingresos materializados — factor no aplicable.',
    };
  }
  // gastos = clase 5+6+7 (incluye impuesto causado). Para costo "operativo",
  // restamos impuesto causado.
  const costoOperativo = cents.gastos - cents.impuestoCausado;
  const ratioPct = pctRatioCents(costoOperativo, cents.ingresos);
  let puntos: number;
  let detalle: string;
  if (ratioPct < 1) {
    puntos = 20;
    detalle = `Costos/Ingresos = ${ratioPct.toFixed(2)}% — patrón atípico, posible falta de soportes.`;
  } else if (ratioPct < 10) {
    puntos = 10;
    detalle = `Costos/Ingresos = ${ratioPct.toFixed(2)}% — bajo, revisar materialidad de soportes.`;
  } else {
    puntos = 0;
    detalle = `Costos/Ingresos = ${ratioPct.toFixed(2)}% — dentro de rango razonable.`;
  }
  return { factor: 'costo_bajo', descripcion: 'Relación costo-ingreso', puntos, detalle };
}

// ---------------------------------------------------------------------------
// Factor 4 — Crecimiento inusual de ingresos
// ---------------------------------------------------------------------------

function factorCrecimiento(pp: PreprocessedBalance): RiskFactorBreakdown {
  const cents = pp.primary.controlTotals.cents;
  const prev = ingresosComparativoCents(pp);
  if (!cents || prev === null || prev <= ZERO) {
    return {
      factor: 'crecimiento_inusual',
      descripcion: 'Crecimiento de ingresos vs periodo anterior',
      puntos: 0,
      detalle: 'No hay periodo comparativo materializado — factor no aplicable.',
    };
  }
  const crecimientoPct = pctRatioCents(cents.ingresos - prev, prev);
  let puntos: number;
  let detalle: string;
  if (crecimientoPct > 100) {
    puntos = 15;
    detalle = `Crecimiento ${crecimientoPct.toFixed(1)}% — duplicación del top-line, atrae atención DIAN.`;
  } else if (crecimientoPct >= 50) {
    puntos = 8;
    detalle = `Crecimiento ${crecimientoPct.toFixed(1)}% — notable, revisar consistencia con sector.`;
  } else {
    puntos = 0;
    detalle = `Crecimiento ${crecimientoPct.toFixed(1)}% — variación regular.`;
  }
  return { factor: 'crecimiento_inusual', descripcion: 'Crecimiento de ingresos vs periodo anterior', puntos, detalle };
}

// ---------------------------------------------------------------------------
// Factor 5 — Saldo a favor sin solicitar
// ---------------------------------------------------------------------------

function factorSaldoFavor(anchor: FiscalAnchorBlock): RiskFactorBreakdown {
  const f04Cents = BigInt(anchor.f04);
  // F04 < 0 → saldo a favor (F02 < F03).
  if (f04Cents >= ZERO) {
    return {
      factor: 'saldo_favor_sin_solicitar',
      descripcion: 'Saldo a favor sin solicitud activa',
      puntos: 0,
      detalle: 'No se identifica saldo a favor del periodo según F04.',
    };
  }
  const saldoFavorCop = Number((-f04Cents) / BigInt(100));
  if (saldoFavorCop > SALDO_FAVOR_MATERIALIDAD_COP) {
    return {
      factor: 'saldo_favor_sin_solicitar',
      descripcion: 'Saldo a favor sin solicitud activa',
      puntos: 10,
      detalle: `Saldo a favor estimado supera $50.000.000 (Art. 850 E.T.). Si no se solicita devolución / compensación, prescribe en 2 años (Art. 854 E.T.).`,
    };
  }
  return {
    factor: 'saldo_favor_sin_solicitar',
    descripcion: 'Saldo a favor sin solicitud activa',
    puntos: 0,
    detalle: `Saldo a favor identificado pero por debajo del umbral de materialidad ($50.000.000).`,
  };
}

// ---------------------------------------------------------------------------
// Factor 6 — Cobertura de retenciones baja (F10 = F03/F02)
// ---------------------------------------------------------------------------
// F10 = % del impuesto referencial (F02) ya anticipado vía retenciones /
// autorretenciones (Art. 365 E.T. — retención como mecanismo de recaudo
// anticipado). Cobertura baja ⇒ el grueso del impuesto está sin anticipar ⇒
// mayor exposición a un saldo a pagar material al cierre + atención DIAN.
// Guarda: si F02 ≤ 0 (sin impuesto referencial, p.ej. sin utilidad) el factor
// NO aplica — evita falsos positivos cuando no hay impuesto que cubrir.

function factorCoberturaRetenciones(anchor: FiscalAnchorBlock): RiskFactorBreakdown {
  const descripcion = 'Cobertura de retenciones (F10)';
  if (BigInt(anchor.f02) <= ZERO) {
    return {
      factor: 'cobertura_retenciones_baja',
      descripcion,
      puntos: 0,
      detalle: 'Sin impuesto referencial (F02 ≤ 0) — factor no aplicable.',
    };
  }
  const f10 = anchor.f10;
  let puntos: number;
  let detalle: string;
  if (f10 < 5) {
    puntos = 5;
    detalle = `Cobertura ${f10.toFixed(1)}% — casi nula; el impuesto referencial está sin anticipar (Art. 365 E.T.).`;
  } else if (f10 < 15) {
    puntos = 3;
    detalle = `Cobertura ${f10.toFixed(1)}% — muy baja; expone a un saldo a pagar material al cierre (Art. 365 E.T.).`;
  } else if (f10 < 40) {
    puntos = 1;
    detalle = `Cobertura ${f10.toFixed(1)}% — parcial; revisar suficiencia de anticipos.`;
  } else {
    puntos = 0;
    detalle = `Cobertura ${f10.toFixed(1)}% — impuesto referencial mayormente anticipado.`;
  }
  return { factor: 'cobertura_retenciones_baja', descripcion, puntos, detalle };
}

// ---------------------------------------------------------------------------
// Calculadora principal
// ---------------------------------------------------------------------------

function classifyNivel(score: number): RiskNivel {
  if (score <= 20) return 'bajo';
  if (score <= 40) return 'medio';
  if (score <= 60) return 'alto';
  if (score <= 80) return 'muy_alto';
  return 'critico';
}

export function computeRiskScore(input: RiskInput): RiskScorePrecomputedData {
  // Impuesto de renta causado del periodo (Clase 54) en centavos. Misma fuente
  // que usa `buildFiscalAnchor` para F09 y que dispara `A5_SIN_PROVISION`;
  // cuando el balance no trae `cents` el anchor asume $0, así que el default
  // coincide con lo que el anchor ya publicó.
  const impuestoCausadoCents =
    input.preprocessed.primary.controlTotals.cents?.impuestoCausado ?? ZERO;

  const factores: RiskFactorBreakdown[] = [
    factorTet(input.anchor, impuestoCausadoCents),
    factorSinProvisionRenta(input.anchor, impuestoCausadoCents),
    factorMargenNeto(input.preprocessed),
    factorCostoBajo(input.preprocessed),
    factorCrecimiento(input.preprocessed),
    factorSaldoFavor(input.anchor),
    factorCoberturaRetenciones(input.anchor),
  ];
  const score = Math.min(100, factores.reduce((acc, f) => acc + f.puntos, 0));

  // Sin base gravable (F01 = $0) el score no describe nada: los seis factores
  // son razones sobre F01 o sobre ingresos. Se calcula igual —para no romper
  // consumidores— pero se marca como no publicable.
  const publicable = BigInt(input.anchor.f01) !== ZERO;

  return {
    score,
    nivel: classifyNivel(score),
    factores,
    publicable,
    noPublicableMotivo: publicable
      ? null
      : 'Score no determinable: la utilidad antes de impuestos del periodo es $0 ' +
        '(balance sin estado de resultados o P&G que se anula). Los seis factores del ' +
        'modelo son razones sobre la base gravable o sobre los ingresos, de modo que un ' +
        'score bajo aquí significa ausencia de datos, no bajo riesgo.',
  };
}

/**
 * El saldo a favor en MoneyCop (para devoluciones / supervivencia).
 * Solo positivo si F04 < 0; cero en otro caso.
 */
export function saldoAFavorCents(anchor: FiscalAnchorBlock): string {
  const f04 = BigInt(anchor.f04);
  return f04 < ZERO ? serializeMoneyCop(-f04) : '0';
}
