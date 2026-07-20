// ---------------------------------------------------------------------------
// Capa 2 — Motor Normativo — Catálogo: Tarifas de Retención en la Fuente
// ---------------------------------------------------------------------------
//
// Las tarifas específicas viven en el Decreto Único Reglamentario 1625/2016
// (DUR Tributario), NO en el E.T. La normaRef cita el decreto, no el artículo
// del E.T. (el E.T. solo establece el marco y umbrales).
//
// Umbrales mínimos vigentes desde 01-jul-2026 (Decreto 0572/2025, bases
// reducidas restablecidas por Consejo de Estado, providencia CE 30229 del
// 02-jun-2026): servicios 2 UVT, compras/otros ingresos 10 UVT. Entre el
// 08-may y el 30-jun-2026 rigieron las bases anteriores (4 / 27 UVT); el
// decreto sigue en litigio de fondo. El valor COP se calcula usando
// UVT_2026_COP importado en catalog/index.ts.
// ---------------------------------------------------------------------------

import type { RetentionTariffEntry } from '../types';

export const TARIFAS_RETENCION: readonly RetentionTariffEntry[] = [
  {
    id: 'RTF_HONORARIOS',
    concepto: 'Honorarios y comisiones — personas jurídicas declarantes',
    tarifaDeclarante: '11%',
    tarifaNoDeclarante: '11%',
    umbralUVT: null,
    // Honorarios no tienen umbral mínimo UVT — se retiene desde el primer peso.
    // Ver RTF_HONORARIOS_THRESHOLD_UVT = 0 en constants.ts.
    normaRef: 'Decreto 1625/2016, Art. 1.2.4.1.4',
    estado: 'VIGENTE_2026',
  },
  {
    id: 'RTF_HONORARIOS_PN',
    concepto: 'Honorarios y comisiones — personas naturales declarantes',
    tarifaDeclarante: '10%',
    tarifaNoDeclarante: '11%',
    umbralUVT: null,
    normaRef: 'Decreto 1625/2016, Art. 1.2.4.1.4 / Art. 392 E.T.',
    estado: 'VIGENTE_2026',
  },
  {
    id: 'RTF_SERVICIOS',
    concepto: 'Servicios generales',
    tarifaDeclarante: '4%',
    tarifaNoDeclarante: '6%',
    umbralUVT: 2,
    // Umbral 2 UVT desde 01-jul-2026 (Decreto 0572/2025, DUR 1.2.4.4.1).
    // Constante RTF_THRESHOLD_UVT en constants.ts.
    normaRef: 'Decreto 1625/2016, Art. 1.2.4.1.19 / Art. 392 E.T. / Decreto 0572/2025',
    estado: 'VIGENTE_2026',
  },
  {
    id: 'RTF_COMPRAS',
    concepto: 'Compras de bienes muebles no agrícolas',
    tarifaDeclarante: '2.5%',
    tarifaNoDeclarante: '3.5%',
    umbralUVT: 10,
    // Umbral 10 UVT desde 01-jul-2026 (Decreto 0572/2025, DUR 1.2.4.6.9 / 1.2.4.9.1).
    normaRef: 'Decreto 1625/2016, Art. 1.2.4.1.21 / Decreto 0572/2025',
    estado: 'VIGENTE_2026',
  },
  {
    id: 'RTF_ARRENDAMIENTO_MUEBLES',
    concepto: 'Arrendamiento de bienes muebles',
    tarifaDeclarante: '4%',
    tarifaNoDeclarante: '4%',
    umbralUVT: null,
    normaRef: 'Decreto 1625/2016, Art. 1.2.4.1.13 / Art. 392 E.T.',
    estado: 'VIGENTE_2026',
  },
  {
    id: 'RTF_ARRENDAMIENTO_INMUEBLES',
    concepto: 'Arrendamiento de bienes inmuebles',
    tarifaDeclarante: '3.5%',
    tarifaNoDeclarante: '3.5%',
    umbralUVT: 10,
    // Inmuebles tributa como "otros ingresos": umbral 10 UVT desde 01-jul-2026
    // (Decreto 0572/2025). Los bienes MUEBLES (4%) sí se retienen desde $1.
    normaRef: 'Decreto 1625/2016, Art. 1.2.4.1.12 / Art. 392 E.T. / Decreto 0572/2025',
    estado: 'VIGENTE_2026',
  },
  {
    id: 'RTF_RENDIMIENTOS_FINANCIEROS',
    concepto: 'Rendimientos financieros (intereses y demás)',
    tarifaDeclarante: '7%',
    tarifaNoDeclarante: '7%',
    umbralUVT: null,
    normaRef: 'Decreto 1625/2016, Art. 1.2.4.1.6 / Art. 395 E.T.',
    estado: 'VIGENTE_2026',
  },
  {
    id: 'RTF_DIVIDENDOS_PN_RESIDENTE',
    concepto: 'Dividendos y participaciones — personas naturales residentes',
    tarifaDeclarante:
      'Tabla progresiva Art. 242 E.T. — desde 0% hasta 15% sobre los no gravados; los gravados a tarifa marginal Art. 241 E.T.',
    tarifaNoDeclarante: null,
    umbralUVT: null,
    normaRef: 'Art. 242 E.T. / Decreto 1625/2016',
    estado: 'MODIFICADO',
  },
  {
    id: 'RTF_AUTORETENCIONES_ESPECIALES_CIIU',
    concepto:
      'Autorretención especial en renta por CIIU (sectores económicos)',
    tarifaDeclarante: '0.4% / 1.1% / 1.6% según CIIU',
    tarifaNoDeclarante: null,
    umbralUVT: null,
    // Las tasas 0.4%, 1.1% y 1.6% aplican según el código CIIU de la empresa.
    // Decreto 1625/2016 Arts. 1.2.6.6 a 1.2.6.11.
    normaRef: 'Decreto 1625/2016, Arts. 1.2.6.6 a 1.2.6.11',
    estado: 'VIGENTE_2026',
  },
  {
    id: 'RTF_RETEIVA_GENERAL',
    concepto: 'ReteIVA — retención del impuesto sobre las ventas (tarifa general)',
    tarifaDeclarante: '15% del IVA generado',
    tarifaNoDeclarante: null,
    umbralUVT: null,
    // Corrección crítica: el spec original citaba Art. 381 E.T. para ReteIVA.
    // Art. 381 regula certificados de retención por otros conceptos, NO ReteIVA.
    // ReteIVA general está en Art. 437-1 E.T.
    normaRef: 'Art. 437-1 E.T. / Decreto 1625/2016',
    estado: 'VIGENTE_2026',
  },
  {
    id: 'RTF_RETEIVA_ESPECIAL_100',
    concepto: 'ReteIVA — retención 100% casos especiales (Arts. 437-4 y 437-5)',
    tarifaDeclarante: '100% del IVA generado',
    tarifaNoDeclarante: null,
    umbralUVT: null,
    normaRef: 'Art. 437-4 E.T. / Art. 437-5 E.T.',
    estado: 'VIGENTE_2026',
  },
] as const;
