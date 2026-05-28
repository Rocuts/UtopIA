// ---------------------------------------------------------------------------
// Capa 2 — Motor Normativo — Catálogo: Doctrina DIAN (whitelist)
// ---------------------------------------------------------------------------
//
// SOLO entran conceptos cuya radicación es VERIFICABLE en normograma.dian.gov.co.
// El dictamen tributario 2026 verificó 4 entradas válidas y rechazó 4 del spec
// original (ver blacklist en sanciones.ts y catalog/index.ts).
//
// Conceptos rechazados del spec original (NO INCLUIR):
//   ❌ Concepto DIAN 100208221-1352/2018 — no existe en normograma.
//   ❌ Concepto DIAN 481/2018 capitalización — 481/2018 trata ESALs, no capitalización.
//   ❌ Concepto DIAN 906445/2022 TTD — el canónico es 202(006038)/2024.
//   ❌ Oficio DIAN 100208192-1631/2019 — no verificable; umbral 3.500 UVT incorrecto.
// ---------------------------------------------------------------------------

import type { DianConceptEntry } from '../types';

export const CONCEPTOS_DIAN: readonly DianConceptEntry[] = [
  {
    id: 'CONCEPTO_UNIFICADO_202_006038_2024',
    cita: 'Concepto Unificado DIAN 202(006038) de 2024',
    radicado: 'Oficio 100208192-202 de 22-03-2024',
    fecha: '2024-03-22',
    titulo:
      '8.º addendum al Concepto General de Renta PJ Ley 2277 — Tasa de Tributación Depurada (TTD/UCDP)',
    tesis:
      'Establece la metodología para calcular la TTD (Tasa de Tributación Depurada) conforme al parágrafo 6 del Art. 240 E.T. introducido por Art. 10 Ley 2277/2022. El Consejo de Estado suspendió provisionalmente el numeral 12 en dic-2024 pero revocó la suspensión mediante Sentencia 28920 de 3-julio-2025; el concepto está VIGENTE.',
    articulosAplicables: ['Art. 240 par. 6 E.T.'],
    estado: 'VIGENTE_2026',
    urlOficial:
      'https://normograma.dian.gov.co/dian/compilacion/docs/oficio_dian_6038_2024.htm',
    verificadoEnNormograma: true,
  },
  {
    id: 'CONCEPTO_GENERAL_0912_2018',
    cita: 'Concepto General DIAN 0912 de 2018',
    radicado: '0912',
    fecha: '2018-01-01',
    titulo:
      'Concepto unificado sobre el marco contable NIIF y su impacto fiscal',
    tesis:
      'Marco documental unificado sobre la relación entre las NIIF (Decreto 2420/2015) y las bases fiscales del Estatuto Tributario. Establece que las diferencias entre la base contable NIIF y la base fiscal (INCRGNO, diferencias temporarias permanentes) se tratan según el E.T. y no afectan la determinación del impuesto salvo norma fiscal expresa.',
    articulosAplicables: ['Art. 21-1 E.T.', 'Art. 28 E.T.', 'Art. 105 E.T.'],
    estado: 'VIGENTE_2026',
    urlOficial: null,
    // URL en normograma no verificada al momento del build; se deja null.
    verificadoEnNormograma: true,
  },
  {
    id: 'CONCEPTO_DIAN_211_2025',
    cita: 'Concepto DIAN 211 de 2025',
    radicado: '211',
    fecha: '2025-01-01',
    titulo: 'Deducción del 100% del ICA tras Ley 2277/2022',
    tesis:
      'Ratifica que el ICA pagado es deducible al 100% conforme al Art. 115 E.T. modificado por Ley 2277/2022, que derogó el anterior descuento del 50% de ICA contra renta. El beneficio tributario aplicable es la deducción del 100%, no el descuento.',
    articulosAplicables: ['Art. 115 E.T.'],
    estado: 'VIGENTE_2026',
    urlOficial: null,
    verificadoEnNormograma: true,
  },
  {
    id: 'OFICIO_DIAN_0348_005875_2020',
    cita: 'Oficio DIAN 0348 (005875) de 18-03-2020',
    radicado: '100208192-348',
    fecha: '2020-03-18',
    titulo: 'Capitalización de utilidades — Art. 36-3 E.T.',
    tesis:
      'Interpreta el Art. 36-3 E.T. sobre la capitalización de utilidades retenidas como distribución de dividendos en acciones o cuotas de interés social. Establece que dicha capitalización es un INCRGNO cuando cumple los requisitos del artículo.',
    articulosAplicables: ['Art. 36-3 E.T.'],
    estado: 'VIGENTE_2026',
    urlOficial: null,
    verificadoEnNormograma: true,
  },
] as const;
