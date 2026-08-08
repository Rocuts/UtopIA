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
    concepto: 'Honorarios y comisiones — personas naturales',
    // Art. 392 inciso 2 E.T. (mod. Art. 75 Ley 1819/2016): la tarifa del DIEZ
    // por ciento (10%) es la del beneficiario NO obligado a declarar renta.
    // El once por ciento (11%) es la del declarante. El catálogo las tenía
    // INVERTIDAS (10% declarante / 11% no declarante) — corregido.
    tarifaDeclarante: '11%',
    tarifaNoDeclarante:
      '10% — sube a 11% desde el pago que haga que los pagos acumulados del ' +
      'mismo agente retenedor en el año gravable superen 3.300 UVT ' +
      '($172.834.200 con UVT 2026), o cuando del contrato se desprenda que ' +
      'los superará (DUR 1625/2016 Art. 1.2.4.3.1).',
    umbralUVT: null,
    // Vigencia: la regla 10%/11% rige sin cambios desde el año gravable 2017
    // (Ley 1819/2016). El Decreto 0572/2025 NO la modificó.
    normaRef:
      'Art. 392 inc. 2 E.T. (mod. Art. 75 Ley 1819/2016) / Decreto 1625/2016, Art. 1.2.4.3.1',
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
    // Tras el Art. 3 de la Ley 2277/2022 el Art. 242 E.T. ya NO tiene tabla
    // progresiva de retención: es un único escalón (0% hasta 1.090 UVT, 15%
    // sobre el exceso). Y los dividendos GRAVADOS no van a la tarifa marginal
    // del Art. 241 — van primero a la tarifa del Art. 240 E.T. y sólo el
    // remanente, ya disminuido ese impuesto, entra al escalón del Art. 242
    // (Art. 242 inc. 2 E.T. y Decreto 1103 de 2023). El catálogo citaba
    // Art. 241 — corregido.
    tarifaDeclarante:
      'NO GRAVADOS (Art. 242 inc. 1 E.T.): escalón único — 0% hasta 1.090 UVT ' +
      'y 15% sobre el exceso; retención = (dividendos en UVT − 1.090 UVT) × 15%. ' +
      'GRAVADOS (Art. 242 inc. 2 E.T.): primero la tarifa del Art. 240 E.T. ' +
      '(35% general para el año gravable 2026) y, al pago menos esa retención, ' +
      'se le aplica después el escalón del Art. 242. NO se aplica la tarifa ' +
      'marginal del Art. 241 E.T. a los dividendos gravados.',
    tarifaNoDeclarante: null,
    umbralUVT: null,
    // Vigencia: desde el año gravable 2023 (Ley 2277/2022), sin cambios en 2026.
    normaRef:
      'Art. 242 E.T. (mod. Art. 3 Ley 2277/2022) / Art. 240 E.T. / Decreto 1103 de 2023',
    estado: 'VIGENTE_2026',
  },
  {
    id: 'RTF_AUTORETENCIONES_ESPECIALES_CIIU',
    concepto:
      'Autorretención especial en renta por CIIU (Art. 1.2.6.8 DUR, sust. Art. 8 Decreto 0572/2025)',
    // El catálogo traía "0,4% / 1,1% / 1,6%", combinación que NO corresponde a
    // ninguna versión de la norma: "0,4 / 0,8 / 1,6" fue el Decreto 2201/2016
    // (derogado) y "0,55 / 1,1 / 2,2" el de los Decretos 0261/2023 y 242/2024.
    //
    // Vigencia (tres ventanas):
    //   • hasta 07-may-2026 → escalones del Decreto 242/2024 (0,55 / 1,1 / 2,2).
    //   • 08-may-2026 a 30-jun-2026 → suspensión provisional de los arts. 2 a 8
    //     del Decreto 0572/2025 (auto del Consejo de Estado del 07-may-2026):
    //     rigieron de nuevo los escalones anteriores. Lo practicado en esa
    //     ventana NO se corrige.
    //   • desde 01-jul-2026 → escalones del Decreto 0572/2025 (auto CE 30229
    //     del 02-jun-2026, que revocó la suspensión y fijó los efectos a partir
    //     del primer día del mes siguiente a su ejecutoria).
    // El proceso de nulidad de fondo sigue abierto: revisar al fallo definitivo.
    tarifaDeclarante:
      'Escalonada por código CIIU, entre 0,55% y 4,50% sobre ingresos brutos ' +
      '(tabla del Art. 1.2.6.8 DUR 1625/2016, sustituido por el Art. 8 del ' +
      'Decreto 0572/2025), vigente desde el 01-jul-2026. Escalones: 0,55% | ' +
      '1,10% | 1,20% | 1,70% | 2,20% | 2,70% | 2,80% | 3,50% | 4,50%. La tarifa ' +
      'NO se infiere del sector: se lee del CIIU exacto en la tabla del decreto. ' +
      'Ejemplos verificados: extracción de carbón (hulla), gas natural y oro 4,50%; ' +
      'transporte de carga y construcción de edificios residenciales 3,50%; ' +
      'petróleo crudo 2,70%; telecomunicaciones y carbón lignito 2,20%; ' +
      'agricultura y ganadería 1,20%; construcción de edificios no residenciales ' +
      'y hotelería 1,10%; comercio mayorista general 0,55%. ' +
      'Entre el 08-may-2026 y el 30-jun-2026 rigieron los escalones anteriores ' +
      '(0,55% | 1,10% | 2,20%, Decretos 0261/2023 y 242/2024): no recalcular ese período.',
    tarifaNoDeclarante: null,
    umbralUVT: null,
    normaRef:
      'Decreto 1625/2016, Art. 1.2.6.8 (sust. Art. 8 Decreto 0572/2025) y Arts. 1.2.6.6 a 1.2.6.11 / ' +
      'auto Consejo de Estado 30229 del 02-jun-2026 (vigencia desde 01-jul-2026)',
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
