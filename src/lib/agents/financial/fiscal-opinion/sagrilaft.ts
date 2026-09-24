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
// ---------------------------------------------------------------------------

import { SMMLV_2026 } from '@/lib/tax/taxCalculator';

export const SAGRILAFT_UMBRAL_SMMLV = 40_000;

export const SAGRILAFT_FUENTE =
  'Circular Externa 100-000016 de 2020 de la Superintendencia de Sociedades (Capítulo X de la Circular Básica Jurídica): 40.000 SMMLV de ingresos totales o activos';

export const SAGRILAFT_NOTA_VIGENCIA =
  'Vigencia por confirmar: la Circular Externa 100-000020 de 2026 (umbral en UVB, transición hasta el 31-05-2027) no está en el corpus normativo verificado; se aplica el umbral de la CE 100-000016/2020.';

export interface SagrilaftEvaluation {
  umbralCop: number;
  smmlv: number;
  activosCop: number | null;
  ingresosCop: number | null;
  /** true/false si hay cifras; null si no hay cifras suficientes. */
  superaUmbralGeneral: boolean | null;
  /** Siempre 'no_determinable' mientras no conste la vigilancia por Supersociedades. */
  obligada: 'si' | 'no' | 'no_determinable';
  motivo: string;
}

function finiteOrNull(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** Lee activos e ingresos del snapshot primario del preprocesador (forma `unknown`). */
export function readSagrilaftInputs(preprocessed: unknown): { activosCop: number | null; ingresosCop: number | null } {
  if (!preprocessed || typeof preprocessed !== 'object') return { activosCop: null, ingresosCop: null };
  const primary = (preprocessed as { primary?: { controlTotals?: { activo?: unknown; ingresos?: unknown } } }).primary;
  const ct = primary?.controlTotals;
  const activo = finiteOrNull(ct?.activo);
  const ingresos = finiteOrNull(ct?.ingresos);
  return {
    activosCop: activo === null ? null : Math.abs(activo),
    ingresosCop: ingresos === null ? null : Math.abs(ingresos),
  };
}

export function evaluateSagrilaft(
  inputs: { activosCop: number | null; ingresosCop: number | null },
  smmlv: number = SMMLV_2026,
): SagrilaftEvaluation {
  const umbralCop = SAGRILAFT_UMBRAL_SMMLV * smmlv;
  const { activosCop, ingresosCop } = inputs;
  let superaUmbralGeneral: boolean | null = null;
  if (activosCop !== null || ingresosCop !== null) {
    superaUmbralGeneral = (activosCop ?? 0) >= umbralCop || (ingresosCop ?? 0) >= umbralCop;
  }
  const motivo =
    superaUmbralGeneral === null
      ? 'Sin cifras estructuradas de activos e ingresos: el umbral no se evalúa.'
      : superaUmbralGeneral
        ? 'Supera el umbral general de ingresos o activos; la obligatoriedad depende además de la vigilancia por la Superintendencia de Sociedades, que no consta.'
        : 'No supera el umbral general de ingresos ni de activos; los supuestos sectoriales y la vigilancia por la Superintendencia de Sociedades no constan.';
  return {
    umbralCop,
    smmlv,
    activosCop,
    ingresosCop,
    superaUmbralGeneral,
    obligada: 'no_determinable',
    motivo,
  };
}

const fmtCop = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`;

/** Bloque de datos para el prompt del verificador (el LLM copia, no calcula). */
export function renderSagrilaftBlock(ev: SagrilaftEvaluation): string {
  return [
    '<sagrilaft_determinista>',
    `- Norma y umbral: ${SAGRILAFT_FUENTE}. SMMLV 2026 = ${fmtCop(ev.smmlv)} ⇒ umbral = ${fmtCop(ev.umbralCop)}.`,
    `- Activos al cierre: ${ev.activosCop === null ? 'N/D' : fmtCop(ev.activosCop)}; ingresos: ${ev.ingresosCop === null ? 'N/D' : fmtCop(ev.ingresosCop)}.`,
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
