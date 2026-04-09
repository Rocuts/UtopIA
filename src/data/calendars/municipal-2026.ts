/**
 * CALENDARIOS TRIBUTARIOS MUNICIPALES 2026
 * =========================================
 * Cubre las 6 principales ciudades de Colombia.
 *
 * OBLIGACIONES MUNICIPALES COMUNES:
 * - ICA (Industria y Comercio): Principal impuesto municipal
 * - Retención de ICA (ReteICA): Agentes de retención
 * - Predial Unificado: Impuesto sobre bienes inmuebles
 * - Sobretasa Bomberil: % adicional sobre el predial
 * - Vehículos: Impuesto sobre vehículos automotores
 * - Alumbrado Público: Contribución mensual
 *
 * ACTUALIZACIÓN ANUAL:
 * 1. Cada ciudad publica su calendario entre diciembre y febrero
 * 2. Consultar la Secretaría de Hacienda de cada ciudad
 * 3. Actualizar las fechas y cambiar lastVerified
 * 4. Para agregar una ciudad nueva, seguir el formato de las existentes
 */

import type { CityCalendar } from './types';

// ═══════════════════════════════════════════════════════
// BOGOTÁ D.C.
// ═══════════════════════════════════════════════════════
const BOGOTA: CityCalendar = {
  city: 'Bogotá',
  department: 'Cundinamarca',
  officialUrl: 'https://www.shd.gov.co/',
  lastVerified: '2026-01-15',
  deadlines: [
    // ── ICA Régimen Común (Bimestral) ──
    { obligation: 'ICA Bimestral', period: 'Bimestre 1 (Ene-Feb)', dueDate: '2026-03-18', regime: 'Común', notes: 'Último dígito NIT determina día exacto (consultar SHD)' },
    { obligation: 'ICA Bimestral', period: 'Bimestre 2 (Mar-Abr)', dueDate: '2026-05-19', regime: 'Común' },
    { obligation: 'ICA Bimestral', period: 'Bimestre 3 (May-Jun)', dueDate: '2026-07-17', regime: 'Común' },
    { obligation: 'ICA Bimestral', period: 'Bimestre 4 (Jul-Ago)', dueDate: '2026-09-18', regime: 'Común' },
    { obligation: 'ICA Bimestral', period: 'Bimestre 5 (Sep-Oct)', dueDate: '2026-11-18', regime: 'Común' },
    { obligation: 'ICA Bimestral', period: 'Bimestre 6 (Nov-Dic)', dueDate: '2027-01-19', regime: 'Común' },

    // ── ICA Régimen Simplificado (Anual) ──
    { obligation: 'ICA Anual', period: 'Año gravable 2025', dueDate: '2026-03-20', regime: 'Simplificado', notes: 'Contribuyentes con ingresos < 3,500 UVT' },

    // ── Retención de ICA (ReteICA) — Bimestral ──
    { obligation: 'Retención de ICA', period: 'Bimestre 1', dueDate: '2026-03-18', notes: 'Agentes de retención de ICA' },
    { obligation: 'Retención de ICA', period: 'Bimestre 2', dueDate: '2026-05-19' },
    { obligation: 'Retención de ICA', period: 'Bimestre 3', dueDate: '2026-07-17' },
    { obligation: 'Retención de ICA', period: 'Bimestre 4', dueDate: '2026-09-18' },
    { obligation: 'Retención de ICA', period: 'Bimestre 5', dueDate: '2026-11-18' },
    { obligation: 'Retención de ICA', period: 'Bimestre 6', dueDate: '2027-01-19' },

    // ── Predial Unificado ──
    { obligation: 'Predial Unificado', period: 'Pago con descuento', dueDate: '2026-04-17', notes: 'Descuento ~10% por pronto pago' },
    { obligation: 'Predial Unificado', period: 'Cuota 1 (sin descuento)', dueDate: '2026-06-12' },
    { obligation: 'Predial Unificado', period: 'Cuota 2', dueDate: '2026-08-14' },
    { obligation: 'Predial Unificado', period: 'Cuota 3', dueDate: '2026-10-16' },
    { obligation: 'Predial Unificado', period: 'Cuota 4', dueDate: '2026-12-11' },

    // ── Vehículos ──
    { obligation: 'Impuesto de Vehículos', period: 'Pago con descuento', dueDate: '2026-05-29', notes: 'Descuento ~10% por pronto pago' },
    { obligation: 'Impuesto de Vehículos', period: 'Plazo sin descuento', dueDate: '2026-07-24' },

    // ── Sobretasa Bomberil ──
    { obligation: 'Sobretasa Bomberil', period: 'Anual 2026', dueDate: '2026-06-30', notes: 'Se liquida como % del predial' },
  ],
};

// ═══════════════════════════════════════════════════════
// MEDELLÍN
// ═══════════════════════════════════════════════════════
const MEDELLIN: CityCalendar = {
  city: 'Medellín',
  department: 'Antioquia',
  officialUrl: 'https://www.medellin.gov.co/hacienda',
  lastVerified: '2026-01-15',
  deadlines: [
    // ── ICA ──
    { obligation: 'ICA Bimestral', period: 'Bimestre 1 (Ene-Feb)', dueDate: '2026-03-13', regime: 'Común' },
    { obligation: 'ICA Bimestral', period: 'Bimestre 2 (Mar-Abr)', dueDate: '2026-05-15', regime: 'Común' },
    { obligation: 'ICA Bimestral', period: 'Bimestre 3 (May-Jun)', dueDate: '2026-07-15', regime: 'Común' },
    { obligation: 'ICA Bimestral', period: 'Bimestre 4 (Jul-Ago)', dueDate: '2026-09-15', regime: 'Común' },
    { obligation: 'ICA Bimestral', period: 'Bimestre 5 (Sep-Oct)', dueDate: '2026-11-13', regime: 'Común' },
    { obligation: 'ICA Bimestral', period: 'Bimestre 6 (Nov-Dic)', dueDate: '2027-01-15', regime: 'Común' },

    { obligation: 'ICA Anual', period: 'Año gravable 2025', dueDate: '2026-04-30', regime: 'Simplificado' },

    // ── Retención de ICA ──
    { obligation: 'Retención de ICA', period: 'Mensual (cada mes)', dueDate: 'pendiente', notes: 'Generalmente antes del 15 del mes siguiente. Verificar decreto municipal.' },

    // ── Predial ──
    { obligation: 'Predial Unificado', period: 'Pago total con descuento', dueDate: '2026-03-31', notes: 'Descuento por pronto pago ~10%' },
    { obligation: 'Predial Unificado', period: 'Cuota 1', dueDate: '2026-03-31' },
    { obligation: 'Predial Unificado', period: 'Cuota 2', dueDate: '2026-06-30' },
    { obligation: 'Predial Unificado', period: 'Cuota 3', dueDate: '2026-09-30' },
    { obligation: 'Predial Unificado', period: 'Cuota 4', dueDate: '2026-12-15' },

    // ── Vehículos ──
    { obligation: 'Impuesto de Vehículos', period: 'Plazo máximo', dueDate: '2026-06-30' },
  ],
};

// ═══════════════════════════════════════════════════════
// CALI
// ═══════════════════════════════════════════════════════
const CALI: CityCalendar = {
  city: 'Cali',
  department: 'Valle del Cauca',
  officialUrl: 'https://www.cali.gov.co/hacienda',
  lastVerified: '2026-01-15',
  deadlines: [
    { obligation: 'ICA Bimestral', period: 'Bimestre 1 (Ene-Feb)', dueDate: '2026-03-16', regime: 'Común' },
    { obligation: 'ICA Bimestral', period: 'Bimestre 2 (Mar-Abr)', dueDate: '2026-05-15', regime: 'Común' },
    { obligation: 'ICA Bimestral', period: 'Bimestre 3 (May-Jun)', dueDate: '2026-07-15', regime: 'Común' },
    { obligation: 'ICA Bimestral', period: 'Bimestre 4 (Jul-Ago)', dueDate: '2026-09-15', regime: 'Común' },
    { obligation: 'ICA Bimestral', period: 'Bimestre 5 (Sep-Oct)', dueDate: '2026-11-16', regime: 'Común' },
    { obligation: 'ICA Bimestral', period: 'Bimestre 6 (Nov-Dic)', dueDate: '2027-01-15', regime: 'Común' },

    { obligation: 'ICA Anual', period: 'Año gravable 2025', dueDate: '2026-04-30', regime: 'Simplificado' },

    { obligation: 'Retención de ICA', period: 'Mensual', dueDate: 'pendiente', notes: 'Antes del 15 del mes siguiente. Verificar Secretaría de Hacienda.' },

    { obligation: 'Predial Unificado', period: 'Pago con descuento', dueDate: '2026-04-30', notes: 'Descuento por pronto pago' },
    { obligation: 'Predial Unificado', period: 'Cuota 1', dueDate: '2026-04-30' },
    { obligation: 'Predial Unificado', period: 'Cuota 2', dueDate: '2026-06-30' },
    { obligation: 'Predial Unificado', period: 'Cuota 3', dueDate: '2026-09-30' },
    { obligation: 'Predial Unificado', period: 'Cuota 4', dueDate: '2026-12-15' },
  ],
};

// ═══════════════════════════════════════════════════════
// BARRANQUILLA
// ═══════════════════════════════════════════════════════
const BARRANQUILLA: CityCalendar = {
  city: 'Barranquilla',
  department: 'Atlántico',
  officialUrl: 'https://www.barranquilla.gov.co/hacienda',
  lastVerified: '2026-01-15',
  deadlines: [
    { obligation: 'ICA Bimestral', period: 'Bimestre 1 (Ene-Feb)', dueDate: '2026-03-20', regime: 'Común' },
    { obligation: 'ICA Bimestral', period: 'Bimestre 2 (Mar-Abr)', dueDate: '2026-05-20', regime: 'Común' },
    { obligation: 'ICA Bimestral', period: 'Bimestre 3 (May-Jun)', dueDate: '2026-07-20', regime: 'Común' },
    { obligation: 'ICA Bimestral', period: 'Bimestre 4 (Jul-Ago)', dueDate: '2026-09-18', regime: 'Común' },
    { obligation: 'ICA Bimestral', period: 'Bimestre 5 (Sep-Oct)', dueDate: '2026-11-20', regime: 'Común' },
    { obligation: 'ICA Bimestral', period: 'Bimestre 6 (Nov-Dic)', dueDate: '2027-01-20', regime: 'Común' },

    { obligation: 'ICA Anual', period: 'Año gravable 2025', dueDate: '2026-04-30', regime: 'Simplificado' },

    { obligation: 'Predial Unificado', period: 'Pago con descuento', dueDate: '2026-03-31', notes: 'Descuento por pronto pago' },
    { obligation: 'Predial Unificado', period: 'Cuota 1', dueDate: '2026-03-31' },
    { obligation: 'Predial Unificado', period: 'Cuota 2', dueDate: '2026-06-30' },
    { obligation: 'Predial Unificado', period: 'Cuota 3', dueDate: '2026-09-30' },
    { obligation: 'Predial Unificado', period: 'Cuota 4', dueDate: '2026-12-11' },
  ],
};

// ═══════════════════════════════════════════════════════
// CARTAGENA
// ═══════════════════════════════════════════════════════
const CARTAGENA: CityCalendar = {
  city: 'Cartagena',
  department: 'Bolívar',
  officialUrl: 'https://hacienda.cartagena.gov.co/',
  lastVerified: '2026-01-15',
  deadlines: [
    { obligation: 'ICA Bimestral', period: 'Bimestre 1 (Ene-Feb)', dueDate: '2026-03-20', regime: 'Común' },
    { obligation: 'ICA Bimestral', period: 'Bimestre 2 (Mar-Abr)', dueDate: '2026-05-20', regime: 'Común' },
    { obligation: 'ICA Bimestral', period: 'Bimestre 3 (May-Jun)', dueDate: '2026-07-20', regime: 'Común' },
    { obligation: 'ICA Bimestral', period: 'Bimestre 4 (Jul-Ago)', dueDate: '2026-09-18', regime: 'Común' },
    { obligation: 'ICA Bimestral', period: 'Bimestre 5 (Sep-Oct)', dueDate: '2026-11-20', regime: 'Común' },
    { obligation: 'ICA Bimestral', period: 'Bimestre 6 (Nov-Dic)', dueDate: '2027-01-20', regime: 'Común' },

    { obligation: 'ICA Anual', period: 'Año gravable 2025', dueDate: '2026-05-15', regime: 'Simplificado' },

    { obligation: 'Predial Unificado', period: 'Pago con descuento', dueDate: '2026-03-31', notes: 'Descuento por pronto pago' },
    { obligation: 'Predial Unificado', period: 'Cuota 1', dueDate: '2026-06-30' },
    { obligation: 'Predial Unificado', period: 'Cuota 2', dueDate: '2026-09-30' },
  ],
};

// ═══════════════════════════════════════════════════════
// BUCARAMANGA
// ═══════════════════════════════════════════════════════
const BUCARAMANGA: CityCalendar = {
  city: 'Bucaramanga',
  department: 'Santander',
  officialUrl: 'https://www.bucaramanga.gov.co/hacienda',
  lastVerified: '2026-01-15',
  deadlines: [
    { obligation: 'ICA Bimestral', period: 'Bimestre 1 (Ene-Feb)', dueDate: '2026-03-17', regime: 'Común' },
    { obligation: 'ICA Bimestral', period: 'Bimestre 2 (Mar-Abr)', dueDate: '2026-05-18', regime: 'Común' },
    { obligation: 'ICA Bimestral', period: 'Bimestre 3 (May-Jun)', dueDate: '2026-07-17', regime: 'Común' },
    { obligation: 'ICA Bimestral', period: 'Bimestre 4 (Jul-Ago)', dueDate: '2026-09-17', regime: 'Común' },
    { obligation: 'ICA Bimestral', period: 'Bimestre 5 (Sep-Oct)', dueDate: '2026-11-17', regime: 'Común' },
    { obligation: 'ICA Bimestral', period: 'Bimestre 6 (Nov-Dic)', dueDate: '2027-01-18', regime: 'Común' },

    { obligation: 'ICA Anual', period: 'Año gravable 2025', dueDate: '2026-04-30', regime: 'Simplificado' },

    { obligation: 'Predial Unificado', period: 'Pago con descuento', dueDate: '2026-03-31', notes: 'Descuento por pronto pago ~10%' },
    { obligation: 'Predial Unificado', period: 'Cuota 1', dueDate: '2026-06-30' },
    { obligation: 'Predial Unificado', period: 'Cuota 2', dueDate: '2026-09-30' },
    { obligation: 'Predial Unificado', period: 'Cuota 3', dueDate: '2026-12-15' },
  ],
};

// ═══════════════════════════════════════════════════════
// EXPORTACIÓN
// ═══════════════════════════════════════════════════════

export const MUNICIPAL_2026: CityCalendar[] = [
  BOGOTA,
  MEDELLIN,
  CALI,
  BARRANQUILLA,
  CARTAGENA,
  BUCARAMANGA,
];
