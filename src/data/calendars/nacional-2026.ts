/**
 * CALENDARIO TRIBUTARIO NACIONAL 2026
 * ====================================
 * Año gravable: 2025 | Declaración y pago: 2026
 * UVT 2026: $52.374 COP (Resolución DIAN 000238 del 15-dic-2025)
 *
 * Fuente: Comunicado DIAN 128 del 26-dic-2025
 * Decreto base: Decreto 2229 de 2023 (modifica DUR 1625 de 2016)
 *
 * REGLA UNIVERSAL DE PLAZOS POR DÍGITO NIT (excepto patrimonio cuota 2)
 * --------------------------------------------------------------------
 * Para una obligación cuyo plazo va del 7º al 16º día hábil de un mes M:
 *   - dígito NIT 1  → 7º día hábil del mes M (PRIMERA fecha)
 *   - dígito NIT 2  → 8º día hábil
 *   - …
 *   - dígito NIT 9  → 15º día hábil
 *   - dígito NIT 0  → 16º día hábil del mes M (ÚLTIMA fecha)
 *
 * Es decir: `nthBusinessDay(2026, M, d === 0 ? 16 : d + 6)`.
 *
 * ⚠ Auditoría normativa 2026-08 — este mapeo estaba INVERTIDO.
 * El código anterior (`d === 0 ? 16 : 16 - d`) asignaba al dígito 1 el 15º día
 * hábil y al dígito 9 el 7º, con lo que TODOS los vencimientos del calendario
 * salían corridos hasta ocho días hábiles. A un contribuyente con NIT
 * terminado en 1 se le anunciaba su vencimiento ocho días hábiles DESPUÉS del
 * real: sanción de extemporaneidad garantizada (Art. 641 E.T.).
 *
 * Verificado contra el texto compilado del Decreto 2229 de 2023 en el
 * normograma DIAN, arts. 1.6.1.13.2.33 (retención en la fuente) y
 * 1.6.1.13.2.12 (renta personas jurídicas): "si el último dígito es 1 …
 * séptimo día hábil"; dígito 9 → décimo quinto; dígito 0 → décimo sexto.
 * https://normograma.dian.gov.co/dian/compilacion/docs/decreto_2229_2023.htm
 *
 * El helper `nthBusinessDay` lo expone `src/lib/scrapers/dian-scraper.ts` y
 * maneja festivos colombianos 2026 + fines de semana.
 *
 * VERIFICACIÓN
 * ------------
 * Las fechas se generan deterministicamente desde `nthBusinessDay`, es decir,
 * son CALCULADAS por el modelo interno de días hábiles, no leídas de la tabla
 * oficial. Por eso todo deadline de este archivo lleva `verified: false`: ese
 * flag significa "confrontada una a una contra el decreto/PDF DIAN", y sólo un
 * operador humano (o un parser real de la tabla) puede ponerlo en `true`.
 *
 * OBLIGACIONES QUE NO SIGUEN LA REGLA DEL 7º–16º DÍA HÁBIL
 * --------------------------------------------------------
 * No todo el calendario es esa regla. La información exógena y la renta de
 * personas naturales tienen tablas propias, indexadas por los DOS últimos
 * dígitos del NIT; se importan de `@/lib/scrapers/dian-scraper` en vez de
 * generarse con `buildPerDigit`. Generarlas con la regla general fue el origen
 * del defecto que ponía la exógena en septiembre.
 */

import {
  digitToBusinessDay,
  EXOGENA_GC_2026,
  exogenaPJPNPorDosDigitos,
  fechaMasTempranaPorUltimoDigito,
  nthBusinessDay,
  rentaPNPorDosDigitos,
} from '@/lib/scrapers/dian-scraper';
import type { NationalDeadline } from './types';

/**
 * Día hábil correspondiente al último dígito NIT. Se reexporta el helper
 * canónico en vez de reimplementarlo: la copia local de esta regla estaba
 * invertida y produjo todo el calendario corrido.
 */
const businessDayForDigit = digitToBusinessDay;

/**
 * Genera las 10 entries (digit 0..9) para una obligación cuyo plazo va del
 * 7º al 16º día hábil del mes `month` del año `year`.
 */
function buildPerDigit(
  year: number,
  month: number,
  build: (digit: number, dueDate: string) => NationalDeadline,
): NationalDeadline[] {
  return Array.from({ length: 10 }, (_, digit) => {
    const businessDay = businessDayForDigit(digit);
    const dueDate = nthBusinessDay(year, month, businessDay);
    return build(digit, dueDate);
  });
}

// =====================================================
// Helpers por tipo de obligación (Decreto 2229/2023)
// =====================================================

function rentaPJ(digit: number, cuota: number, dueDate: string): NationalDeadline {
  const isFiling = cuota === 1;
  return {
    obligation: isFiling
      ? 'Declaración Renta — Personas Jurídicas (Decl + Cuota 1)'
      : `Renta Personas Jurídicas — Cuota ${cuota}`,
    period: 'Año gravable 2025',
    nitDigit: digit,
    dueDate,
    legalBasis: 'Art. 591-592 E.T., Decreto 2229 de 2023',
    notes:
      'Comunicado DIAN 128 del 26-dic-2025 — Plazo entre el 7º y 16º día hábil del mes correspondiente.',
    verified: false,
  };
}

function rentaGC(digit: number, cuota: number, dueDate: string): NationalDeadline {
  const labelByCuota: Record<number, string> = {
    1: 'Renta Grandes Contribuyentes — Cuota 1 (Anticipo)',
    2: 'Renta Grandes Contribuyentes — Decl + Cuota 2',
    3: 'Renta Grandes Contribuyentes — Cuota 3',
  };
  return {
    obligation: labelByCuota[cuota] ?? `Renta Grandes Contribuyentes — Cuota ${cuota}`,
    period: 'Año gravable 2025',
    nitDigit: digit,
    dueDate,
    legalBasis: 'Art. 591 E.T., Decreto 2229 de 2023',
    notes:
      cuota === 1
        ? 'Anticipo. Se declara en cuota 2 (abril).'
        : cuota === 2
          ? 'Declaración y pago de la segunda cuota.'
          : 'Pago de la tercera cuota.',
    verified: false,
  };
}

function retencion(digit: number, monthLabel: string, dueDate: string): NationalDeadline {
  return {
    obligation: 'Retención en la Fuente — Mensual',
    period: monthLabel,
    nitDigit: digit,
    dueDate,
    legalBasis: 'Art. 382 E.T., Decreto 2229 de 2023',
    notes: 'Plazo entre el 7º y 16º día hábil del mes siguiente al período.',
    verified: false,
  };
}

function ivaBimestral(digit: number, bimestre: number, dueDate: string): NationalDeadline {
  const periods = ['Ene-Feb', 'Mar-Abr', 'May-Jun', 'Jul-Ago', 'Sep-Oct', 'Nov-Dic'];
  // El bimestre se identifica por el período CUBIERTO, no por el mes de pago:
  // el vencimiento de enero corresponde al bimestre Nov-Dic del año anterior.
  return {
    obligation: 'IVA — Bimestral',
    period: `Bimestre ${bimestre} (${periods[bimestre - 1]}) — vence ${dueDate}`,
    nitDigit: digit,
    dueDate,
    legalBasis: 'Art. 600-601 E.T., Decreto 2229 de 2023',
    notes: 'Plazo entre el 7º y 16º día hábil del mes siguiente al cierre del bimestre.',
    verified: false,
  };
}

function ivaCuatrimestral(digit: number, cuat: number, dueDate: string): NationalDeadline {
  // Art. 600 num. 2 E.T. define TRES cuatrimestres: ene-abr, may-ago y sep-dic.
  // El tercero vence en enero del año siguiente; el repo sólo tenía dos y el
  // declarante cuatrimestral —la pyme típica— nunca veía la última declaración
  // del año (sanción Art. 641 E.T. sobre el IVA de cuatro meses).
  const periods = ['Ene-Abr 2026', 'May-Ago 2026', 'Sep-Dic 2026'];
  return {
    obligation: 'IVA — Cuatrimestral',
    period: `Cuatrimestre ${cuat} (${periods[cuat - 1]})`,
    nitDigit: digit,
    dueDate,
    legalBasis: 'Art. 600 E.T., Decreto 2229 de 2023',
    notes: 'Régimen cuatrimestral aplica a contribuyentes con ingresos < 92.000 UVT año anterior.',
    verified: false,
  };
}

/**
 * Información Exógena AG 2025 — Res. Única DIAN 000227 del 23-sep-2025,
 * Título 3, modificada por la Res. 000233 de 2025.
 *
 * ⚠ Auditoría normativa 2026-08. El repo la generaba con `buildPerDigit(2026, 9, …)`,
 * es decir en SEPTIEMBRE de 2026 y con la regla del 7º–16º día hábil. Las dos
 * cosas eran falsas: la exógena tiene tabla propia y los plazos terminan el
 * 12-jun-2026. Anunciar septiembre expone a la sanción del Art. 651 E.T.
 * (hasta 15.000 UVT) más el desconocimiento de costos y deducciones.
 * El comentario "FIX: antes estaba en mayo; lo oficial es septiembre" revertía
 * un valor que estaba bien.
 *
 * Fuente: https://actualicese.com/plazos-para-reportar-informacion-exogena-en-2026/
 */
const EXOGENA_LEGAL_BASIS =
  'Arts. 623-631 E.T.; Res. Única DIAN 000227 de 2025 (Título 3), modif. Res. 000233 de 2025';

function exogenaGrandesContribuyentes(digit: number): NationalDeadline {
  return {
    obligation: 'Información Exógena (Medios Magnéticos) — Grandes Contribuyentes',
    period: 'Año gravable 2025',
    nitDigit: digit,
    dueDate: EXOGENA_GC_2026[digit]!,
    legalBasis: EXOGENA_LEGAL_BASIS,
    notes:
      'Por ÚLTIMO dígito del NIT sin DV, del 28-abr al 13-may-2026. La Res. DIAN ' +
      '000012 del 29-abr-2026 prorrogó los dígitos 1, 2 y 3 al 14, 15 y 19 de mayo.',
    verified: false,
  };
}

function exogenaPersonasJuridicasYNaturales(digit: number): NationalDeadline {
  return {
    obligation: 'Información Exógena (Medios Magnéticos) — Personas Jurídicas y Naturales',
    period: 'Año gravable 2025',
    nitDigit: digit,
    dueDate: fechaMasTempranaPorUltimoDigito(digit, exogenaPJPNPorDosDigitos),
    legalBasis: EXOGENA_LEGAL_BASIS,
    notes:
      'El plazo lo fijan los DOS últimos dígitos del NIT (sin DV), del 14-may-2026 ' +
      '(01-05) al 12-jun-2026 (96-00). Se publica la fecha más temprana compatible ' +
      'con este último dígito; confirme la suya en la tabla de la resolución.',
    verified: false,
  };
}

function activosExterior(digit: number, dueDate: string): NationalDeadline {
  return {
    obligation: 'Declaración Anual de Activos en el Exterior',
    period: 'Año gravable 2025',
    nitDigit: digit,
    dueDate,
    legalBasis: 'Art. 607 E.T., Decreto 2229 de 2023',
    notes: 'Mismo plazo que la declaración de renta (PJ) — mayo 2026.',
    verified: false,
  };
}

function patrimonioCuota1(digit: number, dueDate: string): NationalDeadline {
  return {
    obligation: 'Impuesto al Patrimonio — Decl + Cuota 1',
    period: '2026',
    nitDigit: digit,
    dueDate,
    legalBasis: 'Art. 292-298 E.T., Ley 2277 de 2022, Decreto 2229 de 2023',
    notes:
      'Aplica si patrimonio líquido al 1-ene-2026 ≥ 72.000 UVT (≈$3.770.928.000 COP). Plazo entre el 7º y 16º día hábil de mayo 2026.',
    verified: false,
  };
}

function patrimonioCuota2(digit: number, dueDate: string): NationalDeadline {
  return {
    obligation: 'Impuesto al Patrimonio — Cuota 2',
    period: '2026',
    nitDigit: digit,
    dueDate,
    legalBasis: 'Art. 292-298 E.T., Ley 2277 de 2022, Decreto 2229 de 2023',
    notes:
      'Plazo único — 10º día hábil de septiembre 2026 (14-sep-2026) para todos los dígitos NIT.',
    verified: false,
  };
}

/**
 * Renta Personas Naturales — el calendario oficial usa los DOS ÚLTIMOS dígitos
 * del NIT (sin DV) entre el 12-ago-2026 (grupo 01-02) y el 26-oct-2026
 * (grupo 99-00), en orden ASCENDENTE.
 *
 * ⚠ Auditoría normativa 2026-08 — la compresión anterior estaba INVERTIDA y,
 * además, elegía el último día del rango "por ser más conservador". Las dos
 * decisiones iban en la dirección peligrosa: a una cédula terminada en 01-09
 * se le anunciaba el 26-oct-2026 cuando su plazo real vencía en agosto (más de
 * dos meses de extemporaneidad, sanción Art. 641 E.T.). Conservador es la
 * fecha MÁS TEMPRANA, no la más tardía: declarar antes nunca sanciona.
 *
 * Norma: art. 1.6.1.13.2.15 del DUR 1625 de 2016, modificado por el Decreto
 * 2229 de 2023; art. 592 E.T. Tabla en `@/lib/scrapers/dian-scraper`.
 */
function rentaPN(digit: number): NationalDeadline {
  return {
    obligation: 'Declaración Renta — Personas Naturales',
    period: 'Año gravable 2025',
    nitDigit: digit,
    dueDate: fechaMasTempranaPorUltimoDigito(digit, rentaPNPorDosDigitos),
    legalBasis: 'Art. 592 E.T., Decreto 2229 de 2023 (art. 1.6.1.13.2.15 DUR 1625/2016)',
    notes:
      'El plazo lo fijan los DOS últimos dígitos del NIT/cédula (sin DV), del ' +
      '12-ago-2026 (01-02) al 26-oct-2026 (99-00). Se publica la fecha más ' +
      'temprana compatible con este último dígito; confirme la suya en la tabla oficial.',
    verified: false,
  };
}

// =====================================================
// CALENDARIO COMPLETO 2026 (declaración AG 2025)
// =====================================================

export const NACIONAL_2026: NationalDeadline[] = [
  // ─── RENTA GRANDES CONTRIBUYENTES (3 cuotas) ─────────
  // Cuota 1 — feb 10–23 (días hábiles 7-16)
  ...buildPerDigit(2026, 2, (d, dueDate) => rentaGC(d, 1, dueDate)),
  // Cuota 2 — abr 13–27 (días hábiles 7-16) — declaración + segunda cuota.
  // El rango termina el 27 y no el 24 porque el 17-abr-2026 es día NO hábil
  // (Decreto 500 de 2024, confirmado por la DIAN el 4-mar-2026).
  ...buildPerDigit(2026, 4, (d, dueDate) => rentaGC(d, 2, dueDate)),
  // Cuota 3 — jun 10–24 (días hábiles 7-16)
  ...buildPerDigit(2026, 6, (d, dueDate) => rentaGC(d, 3, dueDate)),

  // ─── RENTA PERSONAS JURÍDICAS (2 cuotas) ─────────────
  // FIX: antes estaba en abril; lo oficial es mayo 12–26 (días hábiles 7-16)
  ...buildPerDigit(2026, 5, (d, dueDate) => rentaPJ(d, 1, dueDate)),
  // Cuota 2 — jul 9–23 (días hábiles 7-16)
  ...buildPerDigit(2026, 7, (d, dueDate) => rentaPJ(d, 2, dueDate)),

  // ─── RENTA PERSONAS NATURALES ──────────────────────
  // Tabla oficial por los DOS últimos dígitos (12-ago a 26-oct 2026),
  // comprimida al último dígito con la fecha MÁS TEMPRANA de cada banda.
  ...Array.from({ length: 10 }, (_, d) => rentaPN(d)),

  // ─── RETENCIÓN EN LA FUENTE (mensual feb–dic 2026) ───
  ...(
    [
      { month: 'Enero 2026', payMonth: 2 },
      { month: 'Febrero 2026', payMonth: 3 },
      { month: 'Marzo 2026', payMonth: 4 },
      { month: 'Abril 2026', payMonth: 5 },
      { month: 'Mayo 2026', payMonth: 6 },
      { month: 'Junio 2026', payMonth: 7 },
      { month: 'Julio 2026', payMonth: 8 },
      { month: 'Agosto 2026', payMonth: 9 },
      { month: 'Septiembre 2026', payMonth: 10 },
      { month: 'Octubre 2026', payMonth: 11 },
      { month: 'Noviembre 2026', payMonth: 12 },
    ] as const
  ).flatMap(({ month, payMonth }) =>
    buildPerDigit(2026, payMonth, (d, dueDate) => retencion(d, month, dueDate)),
  ),
  // Diciembre 2026 → enero 2027 (días hábiles 7-16)
  ...buildPerDigit(2027, 1, (d, dueDate) => retencion(d, 'Diciembre 2026', dueDate)),

  // ─── IVA BIMESTRAL (Art. 600 num. 1 E.T. — seis bimestres) ─
  // ⚠ Auditoría 2026-08: faltaba el vencimiento de MAYO y las etiquetas de
  // período estaban corridas — el bimestre "Mar-Abr" se emitía con fecha de
  // marzo, que es el vencimiento del bimestre Ene-Feb.
  // B6 2025 (Nov-Dic 2025) → enero 2026
  ...buildPerDigit(2026, 1, (d, dueDate) => ivaBimestral(d, 6, dueDate)),
  // B1 (Ene-Feb 2026) → marzo 2026
  ...buildPerDigit(2026, 3, (d, dueDate) => ivaBimestral(d, 1, dueDate)),
  // B2 (Mar-Abr 2026) → mayo 2026
  ...buildPerDigit(2026, 5, (d, dueDate) => ivaBimestral(d, 2, dueDate)),
  // B3 (May-Jun) → julio
  ...buildPerDigit(2026, 7, (d, dueDate) => ivaBimestral(d, 3, dueDate)),
  // B4 (Jul-Ago) → septiembre
  ...buildPerDigit(2026, 9, (d, dueDate) => ivaBimestral(d, 4, dueDate)),
  // B5 (Sep-Oct) → noviembre
  ...buildPerDigit(2026, 11, (d, dueDate) => ivaBimestral(d, 5, dueDate)),
  // B6 (Nov-Dic 2026) → enero 2027
  ...buildPerDigit(2027, 1, (d, dueDate) => ivaBimestral(d, 6, dueDate)),

  // ─── IVA CUATRIMESTRAL (Art. 600 num. 2 E.T. — tres cuatrimestres) ─
  // C1 (Ene-Abr 2026) → mayo 12-26
  ...buildPerDigit(2026, 5, (d, dueDate) => ivaCuatrimestral(d, 1, dueDate)),
  // C2 (May-Ago 2026) → septiembre 9-22
  ...buildPerDigit(2026, 9, (d, dueDate) => ivaCuatrimestral(d, 2, dueDate)),
  // C3 (Sep-Dic 2026) → enero 2027 13-26 — faltaba por completo.
  ...buildPerDigit(2027, 1, (d, dueDate) => ivaCuatrimestral(d, 3, dueDate)),

  // ─── INFORMACIÓN EXÓGENA (Medios Magnéticos) ───────
  // NO sigue la regla del 7º–16º día hábil: tabla propia de la Res. 000227/2025.
  ...Array.from({ length: 10 }, (_, d) => exogenaGrandesContribuyentes(d)),
  ...Array.from({ length: 10 }, (_, d) => exogenaPersonasJuridicasYNaturales(d)),

  // ─── ACTIVOS EN EL EXTERIOR ────────────────────────
  // Mismo plazo que renta PJ → mayo 12–26
  ...buildPerDigit(2026, 5, (d, dueDate) => activosExterior(d, dueDate)),

  // ─── IMPUESTO AL PATRIMONIO ────────────────────────
  // Cuota 1 (Decl + Pago) → mayo 12–26 (días hábiles 7-16)
  ...buildPerDigit(2026, 5, (d, dueDate) => patrimonioCuota1(d, dueDate)),
  // Cuota 2 → 14 sep 2026 (10º día hábil único, mismo día para todos los NIT)
  ...Array.from({ length: 10 }, (_, d) =>
    patrimonioCuota2(d, nthBusinessDay(2026, 9, 10)),
  ),
];
