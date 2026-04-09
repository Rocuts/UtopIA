/**
 * Tipos compartidos para el sistema de calendarios tributarios.
 *
 * GUÍA DE ACTUALIZACIÓN ANUAL:
 * Estos tipos rara vez cambian. Solo modifícalos si el gobierno
 * introduce un nuevo tipo de obligación o cambia la estructura.
 */

// --- Nacional ---

export interface NationalDeadline {
  /** Nombre de la obligación ("Declaración de Renta PJ", "IVA Bimestral B1") */
  obligation: string;
  /** Período al que aplica ("Año gravable 2025", "Enero 2026", "Bimestre 1") */
  period: string;
  /** Último dígito del NIT (0-9) */
  nitDigit: number;
  /** Fecha de vencimiento ISO "2026-04-10" o "pendiente" si no se ha publicado */
  dueDate: string;
  /** Artículo del E.T. o decreto que lo respalda */
  legalBasis: string;
  /** Notas adicionales */
  notes?: string;
}

// --- Municipal ---

export interface MunicipalDeadline {
  /** Nombre de la obligación ("ICA Bimestral", "Predial", "Retención de ICA") */
  obligation: string;
  /** Período ("Bimestre 1", "Cuota 1", "Anual") */
  period: string;
  /** Fecha de vencimiento ISO o "pendiente" */
  dueDate: string;
  /** Régimen ("Común", "Simplificado", "Preferencial") */
  regime?: string;
  /** Notas ("Con descuento del 10%", "Último dígito NIT 1-5") */
  notes?: string;
}

export interface CityCalendar {
  city: string;
  department: string;
  /** URL de la Secretaría de Hacienda para verificar */
  officialUrl: string;
  /** Fecha de última verificación ISO */
  lastVerified: string;
  deadlines: MunicipalDeadline[];
}

// --- Configuración del año ---

export interface YearCalendar {
  year: number;
  /** Decreto que establece el calendario nacional */
  nationalDecree: string;
  /** Valor de la UVT para el año */
  uvt: number;
  /** Resolución que fija la UVT */
  uvtResolution: string;
  /** Fecha de última actualización de este archivo */
  lastUpdated: string;
  /** Obligaciones nacionales indexadas por último dígito del NIT */
  national: NationalDeadline[];
  /** Calendarios municipales por ciudad */
  municipal: CityCalendar[];
}
