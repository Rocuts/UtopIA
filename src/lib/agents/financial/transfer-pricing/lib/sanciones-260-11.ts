// ---------------------------------------------------------------------------
// Art. 260-11 E.T. — Sanciones de precios de transferencia (tabla literal)
// ---------------------------------------------------------------------------
// Fuente: texto del Art. 260-11 E.T. corregido por el art. 3 del Decreto 939 de
// 2017 (modificación Ley 1819 de 2016), compilado en
// `src/data/tax_docs/estatuto_tributario_completo.md`. Vigencia: años
// gravables 2017 en adelante. Ámbito: documentación comprobatoria (literal A) y
// declaración informativa (literal B).
//
// Auditoría 2026-09 (tributario-modulos-17): los prompts decían «hasta 20.000
// UVT» por no presentar documentación, «10.000 UVT» por errores y «1% por mes»
// por extemporaneidad; el LLM llenaba maximumUvt/maximumCop con esas cifras.
// Los topes en COP se calculan aquí con la UVT del año indicado.
// ---------------------------------------------------------------------------

import { uvtToCopByYear } from '@/lib/accounting/tax-engine/constants';
import type { TpDocumentationReportJson } from '../../contracts/transfer-pricing';

export interface Sancion26011 {
  /** Literal y numeral del Art. 260-11 E.T. */
  literal: string;
  descripcion: string;
  /** Tarifa sobre la base, en texto literal (p. ej. "4% del valor total de las operaciones sin documentación"). */
  tarifa: string;
  /** Tope en UVT; `null` si la consecuencia no es pecuniaria. */
  topeUvt: number | null;
}

export const ART_260_11_FUENTE = 'Art. 260-11 E.T. (texto corregido por el Decreto 939 de 2017)';

export const ART_260_11_SANCIONES: Record<TpDocumentationReportJson['potentialSanctions'][number]['scenario'], Sancion26011[]> = {
  no_documentacion: [
    { literal: 'A.3.a', descripcion: 'No presentar documentación comprobatoria', tarifa: '4% del valor total de las operaciones con vinculados sin documentación', topeUvt: 25_000 },
    { literal: 'A.3.b', descripcion: 'No presentar documentación — operaciones con paraísos fiscales', tarifa: '6% del valor total de esas operaciones', topeUvt: 30_000 },
  ],
  documentacion_con_errores: [
    { literal: 'A.2', descripcion: 'Inconsistencias en la documentación comprobatoria', tarifa: '1% del valor de la operación con información inconsistente', topeUvt: 5_000 },
    { literal: 'A.4', descripcion: 'Omisión de información en la documentación comprobatoria', tarifa: '2% de la suma omitida (tope 1.400 UVT si las operaciones son < 80.000 UVT)', topeUvt: 5_000 },
  ],
  no_declaracion_informativa: [
    { literal: 'B.5', descripcion: 'No presentar la declaración informativa tras el emplazamiento', tarifa: '4% del valor total de las operaciones sometidas al régimen', topeUvt: 20_000 },
  ],
  declaracion_con_inconsistencias: [
    { literal: 'B.2', descripcion: 'Inconsistencias en la declaración informativa', tarifa: '0,6% del valor de la operación inconsistente', topeUvt: 2_280 },
    { literal: 'B.3', descripcion: 'Omisión de información en la declaración informativa', tarifa: '1,3% de la suma omitida (tope 1.000 UVT si las operaciones son < 80.000 UVT)', topeUvt: 3_000 },
  ],
  presentacion_extemporanea: [
    { literal: 'A.1.a', descripcion: 'Documentación extemporánea dentro de los 5 días hábiles', tarifa: '0,05% del valor total de las operaciones sujetas a documentar', topeUvt: 417 },
    { literal: 'A.1.b', descripcion: 'Documentación extemporánea después de 5 días hábiles', tarifa: '0,2% por mes o fracción (tope 1.667 UVT por mes)', topeUvt: 20_000 },
    { literal: 'B.1.a', descripcion: 'Declaración informativa extemporánea dentro de los 5 días hábiles', tarifa: '0,02% del valor total de las operaciones', topeUvt: 313 },
    { literal: 'B.1.b', descripcion: 'Declaración informativa extemporánea después de 5 días hábiles', tarifa: '0,1% por mes o fracción (tope 1.250 UVT por mes)', topeUvt: 15_000 },
  ],
  desconocimiento_costos: [
    { literal: 'A.3 / A.4 / B.3', descripcion: 'Desconocimiento de costos y deducciones de las operaciones sin documentación o con omisiones', tarifa: 'No pecuniaria: se desconocen los costos y deducciones', topeUvt: null },
  ],
};

/** Tope en centavos (string) con la UVT del año; `null` si el año no está registrado o no hay tope. */
export function topeCentavos(topeUvt: number | null, year: number): string | null {
  if (topeUvt === null) return null;
  try {
    return (BigInt(uvtToCopByYear(topeUvt, year)) * BigInt(100)).toString();
  } catch {
    return null;
  }
}

/**
 * Sobrescribe `potentialSanctions` del LLM con el tope literal del Art. 260-11
 * (literal principal de cada escenario) y su valor en COP con la UVT del año
 * de referencia. Si la UVT de ese año no está registrada, `maximumCop` queda
 * "0" y el render lo muestra como N/D con motivo.
 */
export function enforceTpSanctions(
  json: TpDocumentationReportJson,
  year: number,
): TpDocumentationReportJson {
  return {
    ...json,
    potentialSanctions: json.potentialSanctions.map((s) => {
      const principal = ART_260_11_SANCIONES[s.scenario][0];
      return {
        ...s,
        maximumUvt: principal.topeUvt ?? 0,
        maximumCop: topeCentavos(principal.topeUvt, year) ?? '0',
        description: `${principal.descripcion} — ${principal.tarifa} (Art. 260-11 lit. ${principal.literal} E.T.).`,
      };
    }),
  };
}
