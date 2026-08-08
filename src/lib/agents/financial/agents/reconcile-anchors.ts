// ---------------------------------------------------------------------------
// Reconciliador determinista de anclas
// ---------------------------------------------------------------------------
// Frontera entre CÁLCULO y REDACCIÓN. El preprocesador calcula los totales de
// forma exacta en centavos; el modelo sólo tiene que copiarlos y redactar
// alrededor. Este módulo corre DESPUÉS de la respuesta del LLM y ANTES de
// validar, y hace tres cosas:
//
//   1. Sobrescribe con la cifra del preprocesador las anclas que puede
//      sobrescribir sin fabricar una incoherencia interna.
//   2. Registra CADA desviación —sobrescrita o no—. Es la única medición de la
//      obediencia real del modelo; hasta ahora era invisible.
//   3. Detecta que el desglose impreso no suma el total, que es el fallo que
//      realmente ve el cliente.
//
// Qué se sobrescribe y qué no, y por qué
// ---------------------------------------
// SE SOBRESCRIBE el tríptico patrimonial (activo, pasivo, patrimonio) de cada
// periodo, y de forma ATÓMICA. Es seguro porque el preprocesador cumple
// `A = P + K` por construcción, así que E1 se preserva. Sobrescribir uno solo
// de los tres sí rompería la identidad.
//
// NO SE SOBRESCRIBEN la utilidad neta ni el efectivo de cierre, aunque el
// preprocesador los conozca. `netIncomePrimary` cuelga de la cascada del P&L y
// del cierre del ECP (E4); `cashClosing` cuelga de `cashOpening + netChange`
// (E2). Cambiarlos en solitario dejaría el estado cuadrando contra el
// preprocesador y descuadrando contra sí mismo — cambiar una mentira por otra.
// Se REPORTAN, y el bucle de reparación los ataca reinvocando al pase que los
// produjo con la discrepancia exacta inyectada.
//
// Por qué el desglose importa más que los totales
// ------------------------------------------------
// La medición de FASE 0 (docs/FASE0_MEDICION_2026-08.md) corrió el pipeline tres
// veces sobre el mismo balance real: las 9 anclas salieron exactas las tres
// veces —el modelo SÍ copia los tokens `[MoneyCop: N]`—, pero el desglose del
// Activo se quedó corto entre $4,3M (0,1%) y $1.726M (41%) según la corrida. Es
// decir: el total es correcto y el estado que el cliente suma con la calculadora
// no. Por eso `lineGaps` es un resultado de primera clase de este módulo y no un
// efecto secundario.
// ---------------------------------------------------------------------------

import { ANCHOR_LABELS, type AnchorKey, type ReportAnchors } from '../contracts/anchors';
import { parseMoneyCop, serializeMoneyCop } from '../contracts/money';
import { sumStatementDetail } from '../contracts/statement-lines';
import type {
  NiifReportJson,
  BalanceAndPnlSubJson,
} from '../contracts/niif-report';

/**
 * Lo mínimo que necesita el reconciliador. Se define estructuralmente para que
 * sirva tanto al JSON completo como al sub-schema de Pass-1 (que aún no tiene
 * `cashFlow`): el bucle de reparación corre DENTRO del analista, justo después
 * de Pass-1, que es donde nace el desglose que no cuadra. Esperar al reensamblaje
 * obligaría a repetir los tres pases para arreglar uno.
 */
export type ReconcilableReport = Pick<NiifReportJson, 'balanceSheet' | 'incomeStatement'> &
  Partial<Pick<NiifReportJson, 'cashFlow'>>;

const ZERO = BigInt(0);

/** Una cifra que el modelo emitió distinta de la del preprocesador. */
export interface AnchorDeviation {
  period: 'primary' | 'comparative';
  /** Ruta del campo en el JSON, p. ej. `balanceSheet.totalAssetsPrimary`. */
  field: string;
  /** Etiqueta legible del ancla, tal como aparece en TOTALES VINCULANTES. */
  label: string;
  key: AnchorKey;
  emitted: string;
  expected: string;
  /** `emitted − expected`, en centavos. */
  gapCents: string;
  /** `true` si el código ya corrigió la cifra en el JSON devuelto. */
  overwritten: boolean;
}

/** Un estado cuyo desglose impreso no suma el total impreso. */
export interface LineGap {
  statement: 'Activo' | 'Pasivo' | 'Patrimonio';
  lineCount: number;
  sumCents: string;
  totalCents: string;
  /** `suma − total`, en centavos. Negativo = falta desglosar. */
  gapCents: string;
}

/**
 * Veredicto de la reconciliación sobre el reporte YA reensamblado. Es lo que
 * decide el ARTEFACTO: cuando `clean` es `false`, el informe se sella como
 * "REPORTE CON SALVEDADES" y la descarga queda bloqueada. Un banner que el
 * cliente puede ignorar no cambia nada — la auditoría integral ya documentó que
 * los eventos SSE `warning` mueren en el navegador sin handler.
 */
export interface ReconciliationOutcome {
  deviations: AnchorDeviation[];
  lineGaps: LineGap[];
  /** `true` si se gastó el único reintento permitido. */
  repairAttempted: boolean;
  /** `true` sólo si NO quedó ninguna discrepancia tras la reparación. */
  clean: boolean;
}

/**
 * Texto de las salvedades, para el sello de portada y para las notas técnicas.
 * Devuelve `[]` cuando el informe quedó limpio.
 */
export function describeQualifications(outcome: ReconciliationOutcome): string[] {
  if (outcome.clean) return [];
  const out: string[] = [];
  for (const d of outcome.deviations) {
    out.push(
      `${d.label} (${d.period === 'primary' ? 'periodo actual' : 'comparativo'}): el analista ` +
        `emitió ${fmtCop(parseMoneyCop(d.emitted))} frente a ${fmtCop(parseMoneyCop(d.expected))} ` +
        `del balance preprocesado` +
        (d.overwritten
          ? ' — corregido automáticamente en el informe.'
          : ' — NO corregido: la cifra depende de la cascada del estado y no puede sobrescribirse aisladamente.'),
    );
  }
  for (const g of outcome.lineGaps) {
    out.push(
      `${g.statement}: el desglose impreso (${g.lineCount} renglones, ` +
        `${fmtCop(parseMoneyCop(g.sumCents))}) no suma el total del estado ` +
        `(${fmtCop(parseMoneyCop(g.totalCents))}). Diferencia sin desglosar: ` +
        `${fmtCop(parseMoneyCop(g.gapCents))}.`,
    );
  }
  return out;
}

export interface ReconcileResult<T extends ReconcilableReport = NiifReportJson> {
  /** Copia del JSON con las anclas sobrescribibles ya corregidas. */
  json: T;
  deviations: AnchorDeviation[];
  lineGaps: LineGap[];
  /**
   * Discrepancias redactadas para inyectarlas al prompt del pase que falló.
   * Vacío cuando no hay nada que reparar.
   */
  repairInstructions: string[];
}

/** Formato COP legible desde centavos. Local para no arrastrar el validador. */
function fmtCop(cents: bigint): string {
  const neg = cents < ZERO;
  const abs = neg ? -cents : cents;
  const s = abs.toString().padStart(3, '0');
  const whole = (s.slice(0, -2) || '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '-' : ''}$${whole},${s.slice(-2)}`;
}

/** Descriptor de un ancla: dónde vive en el JSON y si es sobrescribible. */
interface AnchorBinding {
  key: AnchorKey;
  field: string;
  read: (json: ReconcilableReport) => string | null;
  write: ((json: ReconcilableReport, value: string) => void) | null;
}

const PRIMARY_BINDINGS: AnchorBinding[] = [
  {
    key: 'activo',
    field: 'balanceSheet.totalAssetsPrimary',
    read: (j) => j.balanceSheet.totalAssetsPrimary,
    write: (j, v) => {
      j.balanceSheet.totalAssetsPrimary = v;
    },
  },
  {
    key: 'pasivo',
    field: 'balanceSheet.totalLiabilitiesPrimary',
    read: (j) => j.balanceSheet.totalLiabilitiesPrimary,
    write: (j, v) => {
      j.balanceSheet.totalLiabilitiesPrimary = v;
    },
  },
  {
    key: 'patrimonio',
    field: 'balanceSheet.totalEquityPrimary',
    read: (j) => j.balanceSheet.totalEquityPrimary,
    write: (j, v) => {
      j.balanceSheet.totalEquityPrimary = v;
    },
  },
  // Sin `write`: ver la nota de cabecera — su sobrescritura aislada rompería
  // E4 (cierre del ECP) y la cascada del P&L.
  {
    key: 'utilidadNeta',
    field: 'incomeStatement.netIncomePrimary',
    read: (j) => j.incomeStatement.netIncomePrimary,
    write: null,
  },
  // Sin `write`: amarrado por E2 (`cashOpening + netChange`).
  {
    key: 'efectivoCuenta11',
    field: 'cashFlow.cashClosing',
    // `cashFlow` no existe todavía en Pass-1: se omite el cruce en esa fase y
    // se hace sobre el reporte reensamblado.
    read: (j) => j.cashFlow?.cashClosing ?? null,
    write: null,
  },
];

const COMPARATIVE_BINDINGS: AnchorBinding[] = [
  {
    key: 'activo',
    field: 'balanceSheet.totalAssetsComparative',
    read: (j) => j.balanceSheet.totalAssetsComparative,
    write: (j, v) => {
      j.balanceSheet.totalAssetsComparative = v;
    },
  },
  {
    key: 'pasivo',
    field: 'balanceSheet.totalLiabilitiesComparative',
    read: (j) => j.balanceSheet.totalLiabilitiesComparative,
    write: (j, v) => {
      j.balanceSheet.totalLiabilitiesComparative = v;
    },
  },
  {
    key: 'patrimonio',
    field: 'balanceSheet.totalEquityComparative',
    read: (j) => j.balanceSheet.totalEquityComparative,
    write: (j, v) => {
      j.balanceSheet.totalEquityComparative = v;
    },
  },
  {
    key: 'utilidadNeta',
    field: 'incomeStatement.netIncomeComparative',
    read: (j) => j.incomeStatement.netIncomeComparative,
    write: null,
  },
];

/**
 * Cruza el JSON del analista contra las anclas del preprocesador, corrige lo
 * que es seguro corregir y devuelve todo lo que quedó desalineado.
 *
 * @param json     Output del NIIF Analyst, ya validado por Zod.
 * @param anchors  `buildReportAnchors(primary, comparative)`.
 */
export function reconcileAnchors<T extends ReconcilableReport>(
  json: T,
  anchors: ReportAnchors,
): ReconcileResult<T> {
  // Copia superficial por rama: sólo tocamos los objetos que mutamos.
  const out: T = {
    ...json,
    balanceSheet: { ...json.balanceSheet },
    incomeStatement: { ...json.incomeStatement },
    ...(json.cashFlow ? { cashFlow: { ...json.cashFlow } } : {}),
  };

  const deviations: AnchorDeviation[] = [];

  const reconcilePeriod = (
    period: 'primary' | 'comparative',
    bindings: AnchorBinding[],
  ) => {
    const periodAnchors = anchors[period];
    if (!periodAnchors) return;

    for (const binding of bindings) {
      const expected = periodAnchors.cents[binding.key];
      if (typeof expected !== 'bigint') continue;

      const emitted = binding.read(out);
      // `null` es legítimo: en modo LÍNEA BASE el comparativo no viaja.
      if (emitted === null || emitted === undefined) continue;

      let emittedCents: bigint;
      try {
        emittedCents = parseMoneyCop(emitted);
      } catch {
        // Un MoneyCop malformado ya lo rechazó Zod; si llegara aquí, lo
        // tratamos como desviación total en vez de reventar.
        deviations.push({
          period,
          field: binding.field,
          label: ANCHOR_LABELS[binding.key],
          key: binding.key,
          emitted,
          expected: serializeMoneyCop(expected),
          gapCents: 'NaN',
          overwritten: false,
        });
        continue;
      }

      if (emittedCents === expected) continue;

      const canWrite = binding.write !== null;
      if (canWrite) binding.write!(out, serializeMoneyCop(expected));

      deviations.push({
        period,
        field: binding.field,
        label: ANCHOR_LABELS[binding.key],
        key: binding.key,
        emitted: serializeMoneyCop(emittedCents),
        expected: serializeMoneyCop(expected),
        gapCents: serializeMoneyCop(emittedCents - expected),
        overwritten: canWrite,
      });
    }
  };

  reconcilePeriod('primary', PRIMARY_BINDINGS);
  reconcilePeriod('comparative', COMPARATIVE_BINDINGS);

  // -------------------------------------------------------------------------
  // Desglose vs total. Se mide contra el total YA reconciliado a propósito: un
  // modelo que inventa un total coherente con sus propios renglones pasaría
  // limpio si midiéramos contra lo que él mismo emitió.
  // -------------------------------------------------------------------------
  const lineGaps: LineGap[] = [];
  const statements: Array<[LineGap['statement'], typeof out.balanceSheet.assets, string]> = [
    ['Activo', out.balanceSheet.assets, out.balanceSheet.totalAssetsPrimary],
    ['Pasivo', out.balanceSheet.liabilities, out.balanceSheet.totalLiabilitiesPrimary],
    ['Patrimonio', out.balanceSheet.equity, out.balanceSheet.totalEquityPrimary],
  ];

  for (const [statement, lines, declaredTotal] of statements) {
    const { sum, count } = sumStatementDetail(lines);
    if (count === 0) continue; // sin desglose no hay nada que cuadrar
    const total = parseMoneyCop(declaredTotal);
    if (sum === total) continue;
    lineGaps.push({
      statement,
      lineCount: count,
      sumCents: serializeMoneyCop(sum),
      totalCents: serializeMoneyCop(total),
      gapCents: serializeMoneyCop(sum - total),
    });
  }

  return {
    json: out,
    deviations,
    lineGaps,
    repairInstructions: buildRepairInstructions(deviations, lineGaps),
  };
}

/**
 * Redacta las discrepancias como instrucciones accionables para reinyectar al
 * pase que las produjo. Cada línea nombra la cifra vinculante literal, porque
 * es lo único que el modelo tiene que copiar.
 */
export function buildRepairInstructions(
  deviations: AnchorDeviation[],
  lineGaps: LineGap[],
): string[] {
  const out: string[] = [];

  for (const d of deviations.filter((x) => !x.overwritten)) {
    out.push(
      `${d.label} del periodo ${d.period === 'primary' ? 'actual' : 'comparativo'}: emitiste ` +
        `${fmtCop(parseMoneyCop(d.emitted))} y la cifra vinculante del preprocesador es ` +
        `${fmtCop(parseMoneyCop(d.expected))} (brecha ${fmtCop(parseMoneyCop(d.gapCents))}). ` +
        `Copia literalmente el token [MoneyCop: ${d.expected}] en \`${d.field}\` y recalcula ` +
        `hacia atrás los renglones que lo componen — no ajustes una cuenta suelta para cuadrar.`,
    );
  }

  for (const g of lineGaps) {
    const missing = parseMoneyCop(g.gapCents);
    out.push(
      `${g.statement}: los ${g.lineCount} renglones de detalle suman ` +
        `${fmtCop(parseMoneyCop(g.sumCents))} y el total es ` +
        `${fmtCop(parseMoneyCop(g.totalCents))}. ` +
        (missing < ZERO
          ? `Faltan ${fmtCop(-missing)} por desglosar: añade los rubros del balance ` +
            `preprocesado que no listaste. El lector suma la columna y no le da.`
          : `Sobran ${fmtCop(missing)}: hay doble conteo o una correctora presentada en ` +
            `valor absoluto sin identificar.`),
    );
  }

  return out;
}

/**
 * Sello de portada. Se antepone al Markdown del informe cuando la
 * reconciliación no quedó limpia.
 *
 * Va en el CUERPO del entregable a propósito, no en un evento SSE ni en un
 * banner de la UI: la auditoría integral verificó que el cliente no registra
 * handler para `warning`, así que cualquier señal por ese canal muere en el
 * navegador. Un sello dentro del Markdown viaja a todo lo que se derive de él
 * —informe consolidado, HTML, PDF— sin que ninguna superficie tenga que
 * acordarse de mirarlo.
 */
export function buildQualificationSeal(
  outcome: ReconciliationOutcome,
  language: 'es' | 'en' = 'es',
): string {
  const qualifications = describeQualifications(outcome);
  if (qualifications.length === 0) return '';

  if (language === 'en') {
    return [
      '> ## REPORT WITH QUALIFICATIONS',
      '>',
      '> Deterministic reconciliation against the preprocessed trial balance did not close.',
      '> This report is NOT signable as issued. Qualifications:',
      '>',
      ...qualifications.map((q) => `> - ${q}`),
      '>',
      outcome.repairAttempted
        ? '> A bounded repair pass was attempted and did not resolve the discrepancies.'
        : '> No repair pass was attempted.',
      '',
    ].join('\n');
  }

  return [
    '> ## REPORTE CON SALVEDADES',
    '>',
    '> La reconciliación determinista contra el balance preprocesado no cerró.',
    '> Este informe NO es firmable tal como está. Salvedades:',
    '>',
    ...qualifications.map((q) => `> - ${q}`),
    '>',
    outcome.repairAttempted
      ? '> Se intentó una reparación acotada y no resolvió las discrepancias.'
      : '> No se intentó reparación.',
    '',
  ].join('\n');
}
