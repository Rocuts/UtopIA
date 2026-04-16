/**
 * CALENDARIO TRIBUTARIO NACIONAL 2026
 * ====================================
 * Año gravable: 2025 | Declaración y pago: 2026
 * UVT 2026: $52.374 COP (Res. DIAN 000238, 15-dic-2025)
 *
 * ⚠️ ADVERTENCIA CRÍTICA — FECHAS NO OFICIALES ⚠️
 * =================================================
 * Todas las fechas de este archivo son ESTIMACIONES BASADAS EN PATRONES
 * HISTÓRICOS del calendario tributario colombiano. El decreto oficial del
 * calendario 2026 aún NO ha sido cargado. NO DEBEN presentarse al usuario
 * como fechas definitivas.
 *
 * CONSECUENCIA: presentar una fecha estimada al usuario como oficial puede
 * generar multa por extemporaneidad (Art. 641 ET, 5% mensual). Toda
 * respuesta debe incluir la advertencia: "Fecha estimada — verificar contra
 * el decreto oficial de la DIAN antes de presentar la declaración".
 *
 * ACTUALIZACIÓN ANUAL (cuando el decreto se publique):
 * 1. Actualizar cada fecha con la del decreto oficial.
 * 2. Cambiar `verified` a true para cada fecha confirmada.
 * 3. Actualizar el campo `nationalDecree` en index.ts.
 * 4. Actualizar `lastUpdated`.
 */

import type { NationalDeadline } from './types';

// --- Helpers para generar fechas por dígito ---

function rentaPJ(digit: number, date: string, notes?: string): NationalDeadline {
  return {
    obligation: 'Declaración de Renta — Personas Jurídicas',
    period: 'Año gravable 2025',
    nitDigit: digit,
    dueDate: date,
    legalBasis: 'Art. 591-592 E.T., Decreto calendario tributario',
    notes,
  };
}

function rentaGC(digit: number, cuota: number, date: string): NationalDeadline {
  return {
    obligation: `Renta Grandes Contribuyentes — Cuota ${cuota}`,
    period: 'Año gravable 2025',
    nitDigit: digit,
    dueDate: date,
    legalBasis: 'Art. 591 E.T., Decreto calendario tributario',
    notes: cuota === 1 ? 'Primera cuota (anticipo)' : undefined,
  };
}

function retencion(digit: number, month: string, date: string): NationalDeadline {
  return {
    obligation: 'Retención en la Fuente',
    period: month,
    nitDigit: digit,
    dueDate: date,
    legalBasis: 'Art. 382 E.T.',
  };
}

function ivaBimestral(digit: number, bimestre: number, date: string): NationalDeadline {
  const periods = ['Ene-Feb', 'Mar-Abr', 'May-Jun', 'Jul-Ago', 'Sep-Oct', 'Nov-Dic'];
  return {
    obligation: 'IVA Bimestral',
    period: `Bimestre ${bimestre} (${periods[bimestre - 1]})`,
    nitDigit: digit,
    dueDate: date,
    legalBasis: 'Art. 600-601 E.T.',
  };
}

function ivaCuatrimestral(digit: number, cuatrimestre: number, date: string): NationalDeadline {
  const periods = ['Ene-Abr', 'May-Ago', 'Sep-Dic'];
  return {
    obligation: 'IVA Cuatrimestral',
    period: `Cuatrimestre ${cuatrimestre} (${periods[cuatrimestre - 1]})`,
    nitDigit: digit,
    dueDate: date,
    legalBasis: 'Art. 600 E.T.',
  };
}

// =====================================================
// FECHAS NACIONALES 2026
// =====================================================
// NOTA: Estas fechas son basadas en patrones históricos
// del calendario tributario colombiano. Verificar contra
// el decreto oficial cuando sea publicado.
// =====================================================

export const NACIONAL_2026: NationalDeadline[] = [

  // ─── RENTA PERSONAS JURÍDICAS ────────────────────
  // Plazo único. Abril 2026 (AG 2025)
  rentaPJ(1, '2026-04-10'),
  rentaPJ(2, '2026-04-13'),
  rentaPJ(3, '2026-04-14'),
  rentaPJ(4, '2026-04-15'),
  rentaPJ(5, '2026-04-16'),
  rentaPJ(6, '2026-04-17'),
  rentaPJ(7, '2026-04-21'),
  rentaPJ(8, '2026-04-22'),
  rentaPJ(9, '2026-04-23'),
  rentaPJ(0, '2026-04-24'),

  // ─── RENTA GRANDES CONTRIBUYENTES ────────────────
  // Tres cuotas: Feb, Abr, Jun 2026
  ...[1,2,3,4,5,6,7,8,9,0].flatMap(d => [
    rentaGC(d, 1, `2026-02-${String(10 + d).padStart(2, '0')}`),
    rentaGC(d, 2, `2026-04-${String(10 + d).padStart(2, '0')}`),
    rentaGC(d, 3, `2026-06-${String(10 + d).padStart(2, '0')}`),
  ]),

  // ─── RETENCIÓN EN LA FUENTE (Mensual) ────────────
  // Patrón: 10-22 del mes siguiente, por último dígito
  // Solo se incluyen los primeros 6 meses como ejemplo.
  // Se repite el mismo patrón cada mes.
  ...[
    { month: 'Enero 2026', baseDate: '2026-02' },
    { month: 'Febrero 2026', baseDate: '2026-03' },
    { month: 'Marzo 2026', baseDate: '2026-04' },
    { month: 'Abril 2026', baseDate: '2026-05' },
    { month: 'Mayo 2026', baseDate: '2026-06' },
    { month: 'Junio 2026', baseDate: '2026-07' },
    { month: 'Julio 2026', baseDate: '2026-08' },
    { month: 'Agosto 2026', baseDate: '2026-09' },
    { month: 'Septiembre 2026', baseDate: '2026-10' },
    { month: 'Octubre 2026', baseDate: '2026-11' },
    { month: 'Noviembre 2026', baseDate: '2026-12' },
    { month: 'Diciembre 2026', baseDate: '2027-01' },
  ].flatMap(({ month, baseDate }) =>
    [1,2,3,4,5,6,7,8,9,0].map(d =>
      retencion(d, month, `${baseDate}-${String(10 + d).padStart(2, '0')}`)
    )
  ),

  // ─── IVA BIMESTRAL ──────────────────────────────
  ...[1,2,3,4,5,6].flatMap(bim => {
    const baseMonth = bim * 2 + 1; // mes siguiente al cierre del bimestre
    const baseDate = baseMonth <= 12
      ? `2026-${String(baseMonth).padStart(2, '0')}`
      : `2027-01`;
    return [1,2,3,4,5,6,7,8,9,0].map(d =>
      ivaBimestral(d, bim, `${baseDate}-${String(10 + d).padStart(2, '0')}`)
    );
  }),

  // ─── IVA CUATRIMESTRAL ──────────────────────────
  ...[1,2,3].flatMap(cuat => {
    const months = ['05', '09', '01'];
    const year = cuat === 3 ? '2027' : '2026';
    const baseDate = `${year}-${months[cuat - 1]}`;
    return [1,2,3,4,5,6,7,8,9,0].map(d =>
      ivaCuatrimestral(d, cuat, `${baseDate}-${String(10 + d).padStart(2, '0')}`)
    );
  }),

  // ─── INFORMACIÓN EXÓGENA (Medios Magnéticos) ────
  ...[1,2,3,4,5,6,7,8,9,0].map(d => ({
    obligation: 'Información Exógena (Medios Magnéticos)',
    period: 'Año gravable 2025',
    nitDigit: d,
    dueDate: `2026-05-${String(19 + d).padStart(2, '0')}`,
    legalBasis: 'Art. 623-631 E.T., Resolución DIAN anual',
    notes: 'Grandes contribuyentes y personas jurídicas. Verificar resolución específica.',
  } as NationalDeadline)),

  // ─── ACTIVOS EN EL EXTERIOR ─────────────────────
  ...[1,2,3,4,5,6,7,8,9,0].map(d => ({
    obligation: 'Declaración Anual de Activos en el Exterior',
    period: 'Año gravable 2025',
    nitDigit: d,
    dueDate: `2026-04-${String(10 + d).padStart(2, '0')}`,
    legalBasis: 'Art. 607 E.T.',
    notes: 'Mismo plazo que la declaración de renta.',
  } as NationalDeadline)),

  // ─── IMPUESTO AL PATRIMONIO ─────────────────────
  ...[1,2,3,4,5,6,7,8,9,0].flatMap(d => [
    {
      obligation: 'Impuesto al Patrimonio — Cuota 1',
      period: '2026',
      nitDigit: d,
      dueDate: `2026-05-${String(11 + d).padStart(2, '0')}`,
      legalBasis: 'Art. 292-298 E.T., Ley 2277 de 2022',
      notes: 'Aplica si patrimonio líquido >= 72,000 UVT ($3,770,928,000 COP en 2026).',
    } as NationalDeadline,
    {
      obligation: 'Impuesto al Patrimonio — Cuota 2',
      period: '2026',
      nitDigit: d,
      dueDate: `2026-09-${String(11 + d).padStart(2, '0')}`,
      legalBasis: 'Art. 292-298 E.T., Ley 2277 de 2022',
    } as NationalDeadline,
  ]),
];
