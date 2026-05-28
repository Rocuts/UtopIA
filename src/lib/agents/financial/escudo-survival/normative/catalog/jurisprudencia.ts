// ---------------------------------------------------------------------------
// Capa 2 — Motor Normativo — Catálogo: Jurisprudencia
// ---------------------------------------------------------------------------
//
// Capa de defensa: sentencias que afectan la vigencia de normas o sustentan
// interpretaciones razonables (defensa Art. 647 par. E.T.).
// ---------------------------------------------------------------------------

import type { JurisprudenceEntry } from '../types';

export const JURISPRUDENCIA: readonly JurisprudenceEntry[] = [
  {
    id: 'SENTENCIA_C_079_2026',
    cita: 'Sentencia C-079 de 2026',
    tribunal: 'Corte Constitucional',
    fecha: '2026-01-01',
    tema: 'Decreto 1474 de 2025 — Emergencia Económica',
    tesis:
      'Declara INEXEQUIBLE el Decreto 1474 de 2025 que declaró emergencia económica y estableció medidas tributarias temporales (sobretasa del 50%, restricción de regalías). Las medidas tributarias del Decreto 1474 NO están vigentes y NO deben citarse como fundamento de obligaciones fiscales 2026.',
    normasAfectadas: ['Decreto 1474 de 2025'],
    urlOficial:
      'https://www.perezllorca.com/es-co/actualidad/boletin/corte-constitucional-tumba-el-decreto-1474-se-caen-las-medidas-tributarias-de-la-emergencia-economica/',
  },
  {
    id: 'SENTENCIA_C_219_2024',
    cita: 'Sentencia C-219 de 2024',
    tribunal: 'Corte Constitucional',
    fecha: '2024-06-05',
    tema: 'Art. 10 Ley 2277/2022 — Tasa de Tributación Depurada (TTD)',
    tesis:
      'Declara EXEQUIBLE el Art. 10 de la Ley 2277 de 2022 que introdujo la Tasa de Tributación Depurada (TTD) como parágrafo 6 del Art. 240 E.T. La TTD ≥ 15% (TTD = ID/UD) es constitucional y de obligatorio cumplimiento para personas jurídicas desde el año gravable 2023.',
    normasAfectadas: ['Art. 240 par. 6 E.T.', 'Ley 2277 de 2022, Art. 10'],
    urlOficial: null,
  },
  {
    id: 'SENTENCIA_28920_2025_CE',
    cita: 'Sentencia 28920 de 3-julio-2025',
    tribunal: 'Consejo de Estado',
    fecha: '2025-07-03',
    tema: 'Revocación suspensión provisional numeral 12 Concepto DIAN 202(006038)/2024',
    tesis:
      'La Sección Cuarta del Consejo de Estado revocó la suspensión provisional del numeral 12 del Concepto Unificado DIAN 202(006038) de 2024 (sobre metodología TTD). El concepto está plenamente vigente a partir de esta sentencia.',
    normasAfectadas: ['Concepto Unificado DIAN 202(006038) de 2024'],
    urlOficial: null,
  },
  {
    id: 'SENTENCIA_C_481_2019',
    cita: 'Sentencia C-481 de 2019',
    tribunal: 'Corte Constitucional',
    fecha: '2019-10-16',
    tema: 'Ley 1943 de 2018 — Ley de financiamiento',
    tesis:
      'Declaró INEXEQUIBLE la Ley 1943 de 2018 por vicios de procedimiento en su formación, con efecto diferido hasta el 31 de diciembre de 2019. Las disposiciones fueron reproducidas por la Ley 2010/2019.',
    normasAfectadas: ['Ley 1943 de 2018'],
    urlOficial: null,
  },
] as const;
