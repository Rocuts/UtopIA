/**
 * Datos MOCK del panel Contabilidad Pyme. Sin conexión a /api/pyme/* todavía.
 * Tipados contra ./types — el cableado real llega en una tanda posterior.
 *
 * TODO(i18n): estas cadenas son ES-only (month, alert text/dueLabel,
 * monthlyProfitText, mockTip). En modo EN se renderizan verbatim. Se localizan
 * cuando se cablee /api/pyme/* (la data real vendrá del backend por idioma).
 */
import type {
  PymeUser,
  PymeMetrics,
  PymeAlert,
  PymeModule,
} from './types';

export const mockUser: PymeUser = {
  name: 'Carlos Alberto Gómez',
  displayName: 'Carlos',
  businessName: 'Tienda Don Carlos',
  city: 'Bogotá',
  nit: '900123457',
  nitLastDigit: '7',
  regime: 'RST',
  month: 'Mayo 2026',
};

export const mockMetrics: PymeMetrics = {
  sold: 487000,
  bought: 218000,
  profit: 277000,
  monthlyProfit: 435000,
  monthlyProfitText: 'Cuatrocientos treinta y cinco mil pesos',
  marginPct: 57,
  accumulatedSales: 92450000,
  ivaThreshold: 183309000,
  pilaProgress: 77,
  profitTrendPct: 12,
  salesTrendPct: 8,
  purchasesTrendPct: 3,
};

export const mockAlerts: PymeAlert[] = [
  { id: 1, text: 'Pagar PILA empleados', dueLabel: '17 jun', tone: 'warning' },
  { id: 2, text: 'Anticipo impuesto simple', dueLabel: '30 jun', tone: 'warning' },
];

export const mockModules: PymeModule[] = [
  { id: 'dashboard', badge: null, badgeTone: 'neutral', href: '/workspace/pyme' },
  { id: 'libro', badge: '12', badgeTone: 'neutral', href: '/workspace/pyme/libro' },
  { id: 'obligaciones', badge: '$3.2M', badgeTone: 'danger', href: '/workspace/pyme/pagos' },
  { id: 'fechas', badge: '2 urgentes', badgeTone: 'warning', href: '/workspace/pyme/fechas' },
  { id: 'empleados', badge: null, badgeTone: 'neutral', href: '/workspace/pyme/empleados' },
  { id: 'banco', badge: null, badgeTone: 'neutral', href: '/workspace/contabilidad/conciliacion' },
];

export const mockTip =
  '2 minutos al final del día. Así la DIAN nunca lo sorprende.';
