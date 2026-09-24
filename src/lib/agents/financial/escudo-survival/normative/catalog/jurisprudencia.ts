// ---------------------------------------------------------------------------
// Capa 2 — Motor Normativo — Catálogo: Jurisprudencia
// ---------------------------------------------------------------------------
//
// Capa de defensa: sentencias que afectan la vigencia de normas o sustentan
// interpretaciones razonables (defensa Art. 647 par. E.T.).
// ---------------------------------------------------------------------------

import type { JurisprudenceEntry } from '../types';

export const JURISPRUDENCIA: readonly JurisprudenceEntry[] = [
  // Re-auditoría 2026-09-24 (NT-12): se retiró la entrada «Sentencia C-079 de
  // 2026». El corpus (decreto_1474_2025_emergencia.md) registra la
  // inexequibilidad del Decreto 1474 de 2025 el 15-abr-2026 como «Sentencia
  // Corte Constitucional C-XXX de 2026»: el número no tiene fuente en
  // src/data/tax_docs, así que no se cataloga (la Capa 2 lo trata como no
  // verificado). El estado del decreto vive en la blacklist BL_DECRETO_1474_2025.
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
    // Fase 2 (I2 6b): citada en el encabezado de los módulos del Agente Fiscal
    // (tope individual del Art. 771-5 par. 2). Fuente del corpus:
    // estatuto_tributario_completo.md (jurisprudencia concordante del Art.
    // 771-5: Exp. 11001-03-27-000-2022-00041-00(26676) de 19 de julio de 2023)
    // y escudo_normativa_supervivencia_co_2026.md (tesis).
    id: 'SENTENCIA_26676_2023_CE',
    cita: 'Sentencia 26676 de 2023',
    tribunal: 'Consejo de Estado',
    fecha: '2023-07-19',
    tema: 'Art. 771-5 E.T. — tope de 100 UVT de los pagos en efectivo (Exp. 11001-03-27-000-2022-00041-00(26676))',
    tesis:
      'El tope de 100 UVT del parágrafo 2 del Art. 771-5 E.T. se mide por pago individual (cada transacción), no acumulado por beneficiario en el año.',
    normasAfectadas: ['Art. 771-5 par. 2 E.T.'],
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
  {
    // I4-escudo 3: el resumen del Art. 240 par. 4 que va al prompt la cita.
    // Fuente: ley_2277_2022.md y estatuto_tributario_completo.md
    // (jurisprudencia de vigencia del par. 4 del Art. 240).
    id: 'SENTENCIA_C_389_2023',
    cita: 'Sentencia C-389 de 2023',
    tribunal: 'Corte Constitucional',
    fecha: '2023-10-04',
    tema: 'Art. 240 par. 4 E.T. (Ley 2277/2022 art. 10) — sobretasa a la generación hidroeléctrica',
    tesis:
      'Parágrafo 4 CONDICIONALMENTE exequible: la sobretasa sólo grava la actividad de generación de energía eléctrica a través de recursos hídricos siempre que, en el año gravable, esa actividad tenga una renta gravable igual o superior a 30.000 UVT. Exequible por los cargos de legalidad y equidad tributaria.',
    normasAfectadas: ['Art. 240 par. 4 E.T.', 'Ley 2277 de 2022, Art. 10'],
    urlOficial: null,
  },
  {
    // I4-escudo 3: misma fuente; el corpus la registra según el comunicado de
    // prensa del 13-mar-2026.
    id: 'SENTENCIA_C_050_2026',
    cita: 'Sentencia C-050 de 2026',
    tribunal: 'Corte Constitucional',
    fecha: '2026-03-13',
    tema: 'Art. 240 par. 4 E.T. (Ley 2277/2022 art. 10) — sobretasa a la generación hidroeléctrica',
    tesis:
      'Declaró EXEQUIBLE el parágrafo 4 frente a los cargos de libre competencia económica y justicia tributaria, estándose a lo resuelto en la C-389 de 2023, y se inhibió frente al cargo ambiental.',
    normasAfectadas: ['Art. 240 par. 4 E.T.'],
    urlOficial: null,
  },
] as const;
