// ---------------------------------------------------------------------------
// EL ESCUDO — Capa 2 Motor Normativo — Textos de prueba
// ---------------------------------------------------------------------------
//
// Constantes con respuestas representativas del Agente Fiscal, usadas por
// los tests del validator para cubrir casos:
//   - Citas correctas (todo VIGENTE_2026).
//   - Norma derogada (Art. 158-3).
//   - Norma inexequible (Decreto 1474 de 2025).
//   - Concepto DIAN no verificable (1352/2018).
//   - Periodicidad eliminada (IVA anual).
//   - Artículo confundido (ReteIVA Art. 381).
//   - Citas múltiples válidas.
//   - Cita desconocida (no en catálogo).
//   - Texto vacío.
// ---------------------------------------------------------------------------

export const TEXT_RESPUESTA_VALIDA =
  'La tarifa general aplicable es del 35% conforme al Art. 240 E.T. ' +
  'La sanción por inexactitud equivale al 100% del mayor valor del impuesto según el Art. 647 E.T.';

export const TEXT_USANDO_ART_158_3_DEROGADO =
  'Se recomienda aplicar el Art. 158-3 E.T. al 40% para la deducción de la inversión en activos fijos productivos. ' +
  'Esta deducción reduce significativamente la base gravable.';

export const TEXT_USANDO_DECRETO_1474 =
  'Conforme al Decreto 1474 de 2025, la sobretasa financiera asciende al 50%, ' +
  'aplicable a las entidades del sector financiero durante el año gravable.';

export const TEXT_USANDO_CONCEPTO_100208221 =
  'La defensa por diferencia de criterio se apoya en el Concepto DIAN 100208221-1352 de 2018, ' +
  'que reconoce la procedencia de la interpretación distinta a la administración tributaria.';

export const TEXT_PERIODO_IVA_ANUAL =
  'Para la PYME del cliente, recomendamos acoger el periodo anual de IVA durante 2026, ' +
  'con presentación de la declaración anual de IVA en enero de 2027.';

export const TEXT_RETEIVA_ART_381 =
  'La ReteIVA aplicada al proveedor se regula conforme al Art. 381 E.T., con tarifa del 15%.';

export const TEXT_DIVIDENDOS_ART_243 =
  'Los dividendos pagados a no residentes en el exterior están sujetos al 20% conforme al Art. 243 E.T.';

export const TEXT_MULTIPLES_CITAS_OK =
  'El análisis tributario integral se basa en el Art. 240 E.T. (tarifa general 35%), ' +
  'el Art. 647 par. E.T. (defensa diferencia de criterio), ' +
  'el Concepto Unificado DIAN 202(006038) de 2024 (doctrina vigente), ' +
  'la NIIF para PYMES §29 (reconocimiento impuesto a las ganancias) ' +
  'y la NIA 705 (opinión modificada del auditor independiente).';

export const TEXT_CITA_DESCONOCIDA =
  'Se invoca el Art. 9999 del Estatuto Tributario para sustentar el descuento, ' +
  'aunque dicho artículo no existe en el ordenamiento vigente.';

export const TEXT_VACIO = '';

// Textos auxiliares para tests de extracción/normalización
export const TEXT_VARIANTES_ART_240 = [
  'Art. 240 E.T.',
  'Art 240 E.T.',
  'Art.240 E.T.',
  'Articulo 240 del Estatuto Tributario',
  'Artículo 240 E.T.',
  'Art. 240 ET',
].join(' / ');

export const TEXT_ART_240_PARAGRAFO = [
  'Art. 240 par. 2 E.T.',
  'Art. 240 §2 E.T.',
  'Art. 240 parágrafo 2 E.T.',
].join(' / ');

export const TEXT_ART_DISTINTOS_240_2401 =
  'El Art. 240 E.T. fija la tarifa general; el Art. 240-1 E.T. regula la tarifa por zona franca. Son artículos distintos.';

export const TEXT_VARIANTES_LEY_2277 = [
  'Ley 2277 de 2022',
  'Ley 2277/2022',
  'Ley 2277 del 2022',
].join(' / ');

export const TEXT_SENTENCIA_C_079 = 'La Sentencia C-079 de 2026 declaró inexequible el Decreto 1474 de 2025.';

export const TEXT_NIIF_VARIANTES = [
  'NIIF para PYMES §29',
  'NIIF para PYMES Sección 29',
  'NIIF para PYMES seccion 29',
].join(' / ');

export const TEXT_NIC_NIA = 'Conforme a la NIC 12 y la NIA 705 se emite la opinión.';

export const TEXT_RESOLUCION_DIAN =
  'La UVT 2026 se fija en $52.374 conforme a la Resolución DIAN 000238 de 2025.';

// Textos para stress de blacklist
export const TEXT_SOBRETASA_50 =
  'La tarifa para el sector financiero alcanza una sobretasa financiera del 50% en 2026.';

export const TEXT_SOLO_BLACKLIST_CRITICA =
  'Aplica el Art. 158-3 al 40% como deducción especial.';

export const TEXT_MULTIPLES_BLACKLIST =
  'Se aplican el Art. 158-3 E.T. al 40%, el Decreto 1474 de 2025 con sobretasa 50% al sector financiero, ' +
  'y el Concepto DIAN 1352 de 2018 para defensa.';
