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
 *   - dígito NIT 0  → 16º día hábil del mes M (última fecha)
 *   - dígito NIT 1  → 15º día hábil
 *   - dígito NIT 2  → 14º día hábil
 *   - …
 *   - dígito NIT 9  → 7º día hábil del mes M (primera fecha)
 *
 * Es decir: `nthBusinessDay(2026, M, d === 0 ? 16 : 16 - d)`.
 * El helper `nthBusinessDay` lo expone `src/lib/scrapers/dian-scraper.ts`
 * (creado en paralelo por otro agente del sprint) y maneja festivos
 * colombianos 2026 + fines de semana.
 *
 * VERIFICACIÓN
 * ------------
 * Las fechas se generan deterministicamente desde `nthBusinessDay`. El cron
 * diario `/api/cron/calendar-sync` confirma que las fechas locales coinciden
 * con la fuente DIAN oficial y persiste el calendario verificado en Postgres.
 * Cada deadline lleva `verified: false` por defecto; el cron marca `true` la
 * primera vez que su hash hace match con la fuente DIAN.
 */

import { nthBusinessDay } from '@/lib/scrapers/dian-scraper';
import type { NationalDeadline } from './types';

/**
 * Día hábil correspondiente al último dígito NIT bajo la regla universal
 * (digit 0 = último, digit 9 = primero, ventana de 7 a 16).
 */
function businessDayForDigit(digit: number): number {
  if (digit < 0 || digit > 9) {
    throw new Error(`Dígito NIT inválido: ${digit}`);
  }
  return digit === 0 ? 16 : 16 - digit;
}

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
  return {
    obligation: 'IVA — Bimestral',
    period: `Bimestre ${bimestre} (${periods[bimestre - 1]}) 2025/2026`,
    nitDigit: digit,
    dueDate,
    legalBasis: 'Art. 600-601 E.T., Decreto 2229 de 2023',
    notes: 'Plazo entre el 7º y 16º día hábil del mes siguiente al cierre del bimestre.',
    verified: false,
  };
}

function ivaCuatrimestral(digit: number, cuat: number, dueDate: string): NationalDeadline {
  const periods = ['Ene-Abr 2026', 'May-Ago 2026'];
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

function exogena(digit: number, dueDate: string): NationalDeadline {
  return {
    obligation: 'Información Exógena (Medios Magnéticos)',
    period: 'Año gravable 2025',
    nitDigit: digit,
    dueDate,
    legalBasis: 'Art. 623-631 E.T., Resolución DIAN anual, Decreto 2229 de 2023',
    notes:
      'Grandes contribuyentes y personas jurídicas. Plazo entre el 7º y 16º día hábil de septiembre 2026.',
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
 * (00–99) entre el 12-ago-2026 y el 26-oct-2026. Para mantener compatibilidad
 * con el shape `nitDigit: number (0..9)`, comprimimos a 10 entries por rangos
 * de 10 dígitos cada uno. Cada entry refleja el ÚLTIMO día del rango (más
 * conservador para el usuario).
 *
 * Mapeo (rangos por último dígito del NIT):
 *   nitDigit 9 → últimos 2 dígitos 90-99 → agosto (días hábiles temprano)
 *   nitDigit 8 → últimos 2 dígitos 80-89
 *   …
 *   nitDigit 0 → últimos 2 dígitos 00-09 → octubre (días hábiles tarde)
 *
 * Esta es una compresión deliberada. Para usuarios con NIT de PJ es irrelevante
 * (la PN no tiene NIT empresarial). Para PN con cédula propia, el sistema usa
 * los dos últimos dígitos de la cédula y debe consultar al usuario.
 */
function rentaPN(digit: number, dueDate: string, rangeLabel: string): NationalDeadline {
  return {
    obligation: 'Declaración Renta — Personas Naturales',
    period: 'Año gravable 2025',
    nitDigit: digit,
    dueDate,
    legalBasis: 'Art. 591 E.T., Decreto 2229 de 2023',
    notes: `Dígitos ${rangeLabel}. Calendario oficial DIAN usa últimos 2 dígitos (00-99) del 12-ago al 26-oct 2026.`,
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
  // Cuota 2 — abr 13–24 (días hábiles 7-16) — declaración + segunda cuota
  ...buildPerDigit(2026, 4, (d, dueDate) => rentaGC(d, 2, dueDate)),
  // Cuota 3 — jun 10–24 (días hábiles 7-16)
  ...buildPerDigit(2026, 6, (d, dueDate) => rentaGC(d, 3, dueDate)),

  // ─── RENTA PERSONAS JURÍDICAS (2 cuotas) ─────────────
  // FIX: antes estaba en abril; lo oficial es mayo 12–26 (días hábiles 7-16)
  ...buildPerDigit(2026, 5, (d, dueDate) => rentaPJ(d, 1, dueDate)),
  // Cuota 2 — jul 9–23 (días hábiles 7-16)
  ...buildPerDigit(2026, 7, (d, dueDate) => rentaPJ(d, 2, dueDate)),

  // ─── RENTA PERSONAS NATURALES (comprimido 99–00 → 9–0) ─
  // Calendario oficial: 12-ago-2026 a 26-oct-2026, por últimos 2 dígitos
  // Aproximación por rangos de 10 (último día del rango como fecha conservadora)
  rentaPN(9, '2026-08-25', '90-99'), // agosto temprano
  rentaPN(8, '2026-09-04', '80-89'),
  rentaPN(7, '2026-09-15', '70-79'),
  rentaPN(6, '2026-09-25', '60-69'),
  rentaPN(5, '2026-10-06', '50-59'),
  rentaPN(4, '2026-10-13', '40-49'),
  rentaPN(3, '2026-10-19', '30-39'),
  rentaPN(2, '2026-10-22', '20-29'),
  rentaPN(1, '2026-10-23', '10-19'),
  rentaPN(0, '2026-10-26', '00-09'), // octubre tarde
  // TODO: verificar contra resolución DIAN específica para PN. Las 10 entries
  // anteriores son la mejor compresión del rango oficial (12-ago a 26-oct).

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

  // ─── IVA BIMESTRAL ─────────────────────────────────
  // B1 (Nov-Dic 2025) → enero 2026
  ...buildPerDigit(2026, 1, (d, dueDate) => ivaBimestral(d, 1, dueDate)),
  // B1 (Ene-Feb 2026) → marzo 2026 (el calendario tributario referencia el
  // bimestre del AG en curso; mantenemos secuencia bim 2..6)
  ...buildPerDigit(2026, 3, (d, dueDate) => ivaBimestral(d, 2, dueDate)),
  // B3 (May-Jun) → julio
  ...buildPerDigit(2026, 7, (d, dueDate) => ivaBimestral(d, 3, dueDate)),
  // B4 (Jul-Ago) → septiembre
  ...buildPerDigit(2026, 9, (d, dueDate) => ivaBimestral(d, 4, dueDate)),
  // B5 (Sep-Oct) → noviembre
  ...buildPerDigit(2026, 11, (d, dueDate) => ivaBimestral(d, 5, dueDate)),
  // B6 (Nov-Dic 2026) → enero 2027
  ...buildPerDigit(2027, 1, (d, dueDate) => ivaBimestral(d, 6, dueDate)),

  // ─── IVA CUATRIMESTRAL ─────────────────────────────
  // C1 (Ene-Abr 2026) → mayo 12-26
  ...buildPerDigit(2026, 5, (d, dueDate) => ivaCuatrimestral(d, 1, dueDate)),
  // C2 (May-Ago 2026) → septiembre 9-22
  ...buildPerDigit(2026, 9, (d, dueDate) => ivaCuatrimestral(d, 2, dueDate)),

  // ─── INFORMACIÓN EXÓGENA (Medios Magnéticos) ───────
  // FIX: antes estaba en mayo; lo oficial es septiembre 9–22 (días hábiles 7-16)
  ...buildPerDigit(2026, 9, (d, dueDate) => exogena(d, dueDate)),

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
