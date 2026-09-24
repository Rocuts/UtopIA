// ---------------------------------------------------------------------------
// SAGRILAFT — umbral de obligatoriedad calculado en código
// ---------------------------------------------------------------------------
// El verificador de cumplimiento fijaba el umbral en "160.000 UVT"
// ($8.379.840.000), 7-8 veces por debajo del vigente, y ordenaba `no_cumple`
// cuando se superaba sin evidencia del sistema. Un balance de prueba nunca
// trae esa evidencia, así que toda empresa entre ~$8.400M y ~$70.000M salía
// incumplidora (prompts-normativa-02).
//
// Regla aplicada:
//   - Umbral general: 40.000 SMMLV de ingresos totales o activos al cierre
//     (Circular Externa 100-000016 de 2020 de la Superintendencia de
//     Sociedades — Capítulo X de la Circular Básica Jurídica).
//   - El SAGRILAFT sólo obliga a sociedades VIGILADAS por Supersociedades;
//     el intake no declara la vigilancia, así que la obligatoriedad nunca es
//     afirmable: el estado queda `no_evaluado` y nunca `no_cumple`.
//   - Supuestos sectoriales (umbrales menores por sector de riesgo) no se
//     evalúan aquí.
//
// NOTA DE VIGENCIA: la auditoría reporta que la Circular Externa 100-000020
// de 2026 (desde el 02-07-2026, con transición hasta el 31-05-2027) unificó
// SAGRILAFT y PTEE con un umbral expresado en UVB. Su texto no está en el
// corpus normativo del repositorio y no se pudo confirmar, así que se aplica
// el umbral de la CE 100-000016/2020 hasta verificar la norma vigente.
//
// Re-auditoría 2026-09 (NM-15):
//   - Ingresos = ingresos netos de devoluciones del preprocesador (clase 4
//     menos 4175, NIIF 15 §47). Antes se leía `controlTotals.ingresos`, la Σ
//     de la clase 4 que bajo la convención de magnitudes SUMA las
//     devoluciones (2.120 M en vez de 1.920 M).
//   - SMMLV del AÑO DEL CORTE, de las constantes verificadas del repo. Antes
//     se aplicaba siempre el de 2026; un año sin constante verificada deja el
//     umbral N/D con motivo.
//   - El umbral mide cifras al 31 de diciembre: un corte parcial (menos de
//     12 meses de resultados) no compara sus ingresos contra el umbral.
// ---------------------------------------------------------------------------

import { smmlvVerificado } from '@/lib/tax/taxCalculator';

export const SAGRILAFT_UMBRAL_SMMLV = 40_000;

export const SAGRILAFT_FUENTE =
  'Circular Externa 100-000016 de 2020 de la Superintendencia de Sociedades (Capítulo X de la Circular Básica Jurídica): 40.000 SMMLV de ingresos totales o activos';

export const SAGRILAFT_NOTA_VIGENCIA =
  'Vigencia por confirmar: la Circular Externa 100-000020 de 2026 (umbral en UVB, transición hasta el 31-05-2027) no está en el corpus normativo verificado; se aplica el umbral de la CE 100-000016/2020.';

/**
 * SMMLV del año, o `null` si el repo no tiene la constante verificada. Lee la
 * constante única `SMMLV_POR_ANIO` de `@/lib/tax/taxCalculator` (2026:
 * Decreto 1469/2025); un año que no esté allí no se sustituye por otro.
 */
export function smmlvDelAnio(anio: number | null | undefined): number | null {
  return smmlvVerificado(anio);
}

export interface SagrilaftInputs {
  activosCop: number | null;
  /** Ingresos totales netos de devoluciones del periodo (null si no son anuales o no hay cifra). */
  ingresosCop: number | null;
  /** Año del corte del balance; `null` si la etiqueta del periodo no lo identifica. */
  anioCorte?: number | null;
  /** Motivo cuando `ingresosCop` es null habiendo resultados (p. ej. corte parcial). */
  motivoIngresos?: string | null;
}

export interface SagrilaftEvaluation {
  /** 40.000 × SMMLV del año del corte; null si ese SMMLV no está verificado. */
  umbralCop: number | null;
  smmlv: number | null;
  /** Año del SMMLV aplicado (= año del corte). */
  anioSmmlv: number | null;
  activosCop: number | null;
  ingresosCop: number | null;
  motivoIngresos: string | null;
  /** true/false si hay cifras y umbral; null si no hay cifras suficientes o umbral. */
  superaUmbralGeneral: boolean | null;
  /** Siempre 'no_determinable' mientras no conste la vigilancia por Supersociedades. */
  obligada: 'si' | 'no' | 'no_determinable';
  motivo: string;
}

function finiteOrNull(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** Último año (20AA) que aparece en la etiqueta del periodo: "2025", "2025-06", "2025-01-01..2025-12-31". */
function anioDelPeriodo(periodo: unknown): number | null {
  if (typeof periodo !== 'string') return null;
  const anios = periodo.match(/20\d{2}/g);
  return anios ? Number(anios[anios.length - 1]) : null;
}

interface SnapshotSagrilaft {
  period?: unknown;
  controlTotals?: {
    activo?: unknown;
    ingresosNetos?: unknown;
    mesesPeriodo?: unknown;
    cents?: { ingresosNetos?: unknown } | null;
  };
}

/** Lee activos, ingresos netos y año del corte del snapshot primario (forma `unknown`). */
export function readSagrilaftInputs(preprocessed: unknown): SagrilaftInputs {
  if (!preprocessed || typeof preprocessed !== 'object') {
    return { activosCop: null, ingresosCop: null, anioCorte: null, motivoIngresos: null };
  }
  const primary = (preprocessed as { primary?: SnapshotSagrilaft }).primary;
  const ct = primary?.controlTotals;
  const activo = finiteOrNull(ct?.activo);
  const centsNetos = ct?.cents?.ingresosNetos;
  const ingresosNetos =
    typeof centsNetos === 'bigint' ? Number(centsNetos) / 100 : finiteOrNull(ct?.ingresosNetos);
  const meses = finiteOrNull(ct?.mesesPeriodo);
  const parcial = meses !== null && meses < 12;
  return {
    activosCop: activo === null ? null : Math.abs(activo),
    ingresosCop: ingresosNetos === null || parcial ? null : Math.abs(ingresosNetos),
    anioCorte: anioDelPeriodo(primary?.period),
    motivoIngresos: parcial
      ? `corte parcial (${meses} meses de resultados): el umbral mide los ingresos del año completo al 31 de diciembre`
      : null,
  };
}

export function evaluateSagrilaft(
  inputs: SagrilaftInputs,
  smmlvOverride?: number,
): SagrilaftEvaluation {
  const anio = inputs.anioCorte ?? null;
  const smmlv = smmlvOverride ?? smmlvDelAnio(anio);
  const umbralCop = smmlv === null ? null : SAGRILAFT_UMBRAL_SMMLV * smmlv;
  const { activosCop, ingresosCop } = inputs;
  const motivoIngresos = inputs.motivoIngresos ?? null;
  let superaUmbralGeneral: boolean | null = null;
  if (umbralCop !== null && (activosCop !== null || ingresosCop !== null)) {
    superaUmbralGeneral = (activosCop ?? 0) >= umbralCop || (ingresosCop ?? 0) >= umbralCop;
  }
  const motivo =
    umbralCop === null
      ? anio === null
        ? 'Sin año de corte identificable: el SMMLV aplicable y el umbral no se determinan.'
        : `El SMMLV del año ${anio} no está en las constantes verificadas del repositorio (sólo 2026, Decreto 1469/2025): el umbral no se evalúa.`
      : superaUmbralGeneral === null
        ? 'Sin cifras estructuradas de activos e ingresos: el umbral no se evalúa.'
        : superaUmbralGeneral
          ? 'Supera el umbral general de ingresos o activos; la obligatoriedad depende además de la vigilancia por la Superintendencia de Sociedades, que no consta.'
          : 'No supera el umbral general de ingresos ni de activos; los supuestos sectoriales y la vigilancia por la Superintendencia de Sociedades no constan.';
  return {
    umbralCop,
    smmlv,
    anioSmmlv: smmlv === null ? null : anio,
    activosCop,
    ingresosCop,
    motivoIngresos,
    superaUmbralGeneral,
    obligada: 'no_determinable',
    motivo,
  };
}

const fmtCop = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`;

/** Bloque de datos para el prompt del verificador (el LLM copia, no calcula). */
export function renderSagrilaftBlock(ev: SagrilaftEvaluation): string {
  const umbral =
    ev.umbralCop === null || ev.smmlv === null
      ? `N/D — ${ev.motivo}`
      : `SMMLV ${ev.anioSmmlv ?? ''} = ${fmtCop(ev.smmlv)} ⇒ umbral = ${fmtCop(ev.umbralCop)}.`;
  const ingresos =
    ev.ingresosCop !== null
      ? `${fmtCop(ev.ingresosCop)} (ingresos totales netos de devoluciones)`
      : ev.motivoIngresos
        ? `N/D — ${ev.motivoIngresos}`
        : 'N/D';
  return [
    '<sagrilaft_determinista>',
    `- Norma y umbral: ${SAGRILAFT_FUENTE}. ${umbral}`,
    `- Activos al cierre: ${ev.activosCop === null ? 'N/D' : fmtCop(ev.activosCop)}; ingresos: ${ingresos}.`,
    `- Supera el umbral general: ${ev.superaUmbralGeneral === null ? 'no determinable' : ev.superaUmbralGeneral ? 'sí' : 'no'}.`,
    `- Obligada a SAGRILAFT: no determinable — ${ev.motivo}`,
    `- ${SAGRILAFT_NOTA_VIGENCIA}`,
    '</sagrilaft_determinista>',
  ].join('\n');
}

/** Un ítem de cumplimiento es de SAGRILAFT/PTEE por su área, requisito o norma. */
export function isSagrilaftItem(item: { area: string; requirement: string; normReference: string }): boolean {
  return /sagrilaft|ptee|lavado de activos|laft/i.test(`${item.area} ${item.requirement} ${item.normReference}`);
}
