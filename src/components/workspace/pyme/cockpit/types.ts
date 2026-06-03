/**
 * Tipos del módulo "Contabilidad Pyme" — panel ejecutivo del propietario (desktop).
 *
 * Versión nativa del lenguaje visual de la app (acento gold + tokens --n-*). Datos
 * MOCK por ahora; el cableado a /api/pyme/* llega en una tanda posterior. Algunos
 * campos (PymeUser.name/nit/nitLastDigit, PymeMetrics.profit) están reservados
 * para ese cableado y aún no se renderizan.
 */

/** Régimen tributario del comerciante. */
export type Regime = 'RST' | 'ORDINARIO';

/** Tono semántico (mapea a los colores success/warning/danger de la app). */
export type Tone = 'positive' | 'warning' | 'danger' | 'neutral';

export interface PymeUser {
  name: string;
  displayName: string;
  businessName: string;
  city: string;
  nit: string;
  nitLastDigit: string;
  regime: Regime;
  /** Mes contable activo, ya formateado (p.ej. "Mayo 2026"). */
  month: string;
}

export interface PymeMetrics {
  /** Ventas del mes (COP). */
  sold: number;
  /** Compras del mes (COP). */
  bought: number;
  /** Utilidad operativa del mes (COP). */
  profit: number;
  /** "Lo que le quedó" — utilidad neta del mes (COP). */
  monthlyProfit: number;
  /** Importe en palabras (confianza del propietario). */
  monthlyProfitText: string;
  /** Margen del mes (%). */
  marginPct: number;
  /** Ventas acumuladas del año (COP) — para el tope de inscripción en IVA. */
  accumulatedSales: number;
  /** Umbral de inscripción en IVA / responsabilidad (COP). */
  ivaThreshold: number;
  /** Progreso de aporte PILA del mes (0–100). */
  pilaProgress: number;
  /** Variaciones vs mes anterior (%), para los KPIs. */
  profitTrendPct: number;
  salesTrendPct: number;
  purchasesTrendPct: number;
}

/** Obligación próxima a vencer. */
export interface PymeAlert {
  id: number;
  text: string;
  /** Fecha de vencimiento ya formateada (p.ej. "17 jun"). */
  dueLabel: string;
  tone: Tone;
}

export type PymeModuleId =
  | 'dashboard'
  | 'obligaciones'
  | 'empleados'
  | 'libro'
  | 'banco'
  | 'fechas';

/** Tarjeta de acceso. El ícono (lucide) y la etiqueta (i18n) se resuelven por `id`. */
export interface PymeModule {
  id: PymeModuleId;
  /** Badge opcional (conteo o monto, p.ej. "$3.2M" o "12"). */
  badge: string | null;
  /** Tono del badge — semántico explícito, no inferido del texto. */
  badgeTone: Tone;
  /** Ruta real si está lista; `null` ⇒ se muestra como "Próximamente". */
  href: string | null;
}
