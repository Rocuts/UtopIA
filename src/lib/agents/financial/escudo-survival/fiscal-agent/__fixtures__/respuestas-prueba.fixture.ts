// ---------------------------------------------------------------------------
// EL ESCUDO — Capa 4 (Agente Fiscal) — Fixtures de respuestas
// ---------------------------------------------------------------------------
//
// Respuestas-prueba mínimas para tests. Cada fixture cubre un escenario
// específico (ej. balance ELITE, blacklist trap, formato malo). Documenta su
// propósito en el campo `__testCase` (ignorado por el código de validación).
//
// MoneyCop convention:
//   - Cifras en strings de centavos (e.g. "150000000" = $1.500.000,00).
//   - Negativos para saldo a favor (F04 < 0).
// ---------------------------------------------------------------------------

import type {
  FiscalResponse,
  Modulo2Conciliacion,
  Modulo3RiskScore,
  Modulo5DefensaDian,
  Modulo6Devoluciones,
  Modulo7Format,
} from '../validators/types';

// ---------------------------------------------------------------------------
// Helpers de composición
// ---------------------------------------------------------------------------

function empty(rawText = ''): FiscalResponse {
  return {
    modulos: [],
    modulo2: null,
    modulo3: null,
    modulo5: null,
    modulo6: null,
    modulo7: null,
    rawText,
  };
}

// ===========================================================================
// CASO 1 — Conciliación OK (cifras cuadran exacto)
// ===========================================================================
//
//   UAI                 = $100.000.000,00 (10_000_000_000 cts)
//   adiciones           = $20.000.000,00  (2_000_000_000 cts)
//   deducciones         = $5.000.000,00   (500_000_000 cts)
//   renta líquida       = 100M + 20M − 5M = $115.000.000,00 (11_500_000_000 cts)
//   tarifa              = 35%
//   impuesto bruto      = 11_500_000_000 × 0.35 = 4_025_000_000 cts = $40.250.000,00
//   desc258_1           = $1.000.000,00 (100_000_000 cts)
//   descOtros           = $2.000.000,00 (200_000_000 cts) ≤ tope25%(4.025M) = $10.062.500
//   impuesto neto       = 4_025_000_000 − 100_000_000 − 200_000_000 = 3_725_000_000 cts
// ===========================================================================

const MOD2_OK: Modulo2Conciliacion = {
  uaiCents: '10000000000',
  adicionesCents: '2000000000',
  deduccionesCents: '500000000',
  rentaLiquidaCents: '11500000000',
  impuestoBrutoCents: '4025000000',
  descuento258_1Cents: '100000000',
  descuentos254_256_257Cents: '200000000',
  impuestoNetoCents: '3725000000',
  tarifa: 35,
  detallesAdiciones: [
    // Citamos sólo normas del catálogo sintético para que Capa 2 valide OK.
    { concepto: 'Gastos al exterior excedidos', montoCents: '1500000000', norma: 'Art. 122 E.T.' },
    { concepto: 'Otros gastos no deducibles', montoCents: '500000000', norma: 'Art. 122 E.T.' },
  ],
  detallesDeducciones: [
    { concepto: 'Rentas exentas (sobretasa financiera ajuste)', montoCents: '500000000', norma: 'Art. 240 par. 2 E.T.' },
  ],
  closingNote:
    'La conciliación contable-fiscal aplica la tarifa del Art. 240 E.T. (35% PJ). Cualquier discrepancia interpretativa puede invocarse bajo el parágrafo del Art. 647 E.T. (diferencia de criterio).',
  rentasExentasCents: '500000000',
};

export const RESP_CONCILIACION_OK: FiscalResponse = {
  modulos: ['M2'],
  modulo2: MOD2_OK,
  modulo3: null,
  modulo5: null,
  modulo6: null,
  modulo7: null,
  rawText: MOD2_OK.closingNote,
};

// ===========================================================================
// CASO 2 — Conciliación con Art. 158-3 DEROGADO (trap Art. 647)
// ===========================================================================

const MOD2_BAD_158_3: Modulo2Conciliacion = {
  ...MOD2_OK,
  detallesDeducciones: [
    { concepto: 'Deducción inversión activos fijos productivos', montoCents: '500000000', norma: 'Art. 158-3 E.T.' },
  ],
  closingNote:
    'La deducción del 40% por inversión en activos fijos productivos se sustenta en el Art. 158-3 E.T. (parágrafo Art. 647 invocable como defensa diferencia de criterio).',
};

export const RESP_CONCILIACION_BAD_158_3: FiscalResponse = {
  modulos: ['M2'],
  modulo2: MOD2_BAD_158_3,
  modulo3: null,
  modulo5: null,
  modulo6: null,
  modulo7: null,
  rawText: MOD2_BAD_158_3.closingNote,
};

// ===========================================================================
// CASO 3 — Bloque Âncora F01-F10 OK (sólo proxy para tests de devoluciones)
// ===========================================================================
//
// Los validators no leen el Bloque Âncora directamente — es M1. Pero
// devoluciones cita |F04|. Aquí el saldo a favor es $5.000.000 = 500_000_000 cts
// y F04 (signed) = -500_000_000.
// ===========================================================================

// ===========================================================================
// CASO 4 — Risk Score BAJO (score 15)
// ===========================================================================

const MOD3_BAJO: Modulo3RiskScore = {
  score: 15,
  factor1_tetVsSector: 5,
  factor2_rentaPresuntiva: 5,
  factor3_proporcionDeducciones: 3,
  factor4_consistenciaIVA: 2,
  factor5_historicoSanciones: 0,
  interpretacion: 'BAJO',
  modoSupervivenciaActivo: false,
  tetActualPct: 28.5,
};

export const RESP_RISK_SCORE_BAJO: FiscalResponse = {
  modulos: ['M3'],
  modulo2: null,
  modulo3: MOD3_BAJO,
  modulo5: null,
  modulo6: null,
  modulo7: null,
  rawText: 'Risk Score: 15 (BAJO). TET 28.5% — dentro de norma.',
};

// ===========================================================================
// CASO 5 — Risk Score CRITICO (score 85 + Modo Supervivencia activo)
// ===========================================================================

const MOD3_CRITICO: Modulo3RiskScore = {
  score: 85,
  factor1_tetVsSector: 28,
  factor2_rentaPresuntiva: 22,
  factor3_proporcionDeducciones: 18,
  factor4_consistenciaIVA: 12,
  factor5_historicoSanciones: 5,
  interpretacion: 'CRITICO',
  modoSupervivenciaActivo: true,
  tetActualPct: 7.2,
};

export const RESP_RISK_SCORE_CRITICO: FiscalResponse = {
  modulos: ['M3'],
  modulo2: null,
  modulo3: MOD3_CRITICO,
  modulo5: null,
  modulo6: null,
  modulo7: null,
  rawText:
    'Risk Score: 85 (CRITICO). TET 7.2%. Modo Supervivencia ACTIVO — protocolo Módulo 8 desplegado.',
};

// ===========================================================================
// CASO 6 — Defensa DIAN: requerimiento ordinario Art. 752 + parágrafo Art. 647
// ===========================================================================

const CARTA_752_OK = `# Carta Borrador — Respuesta a Requerimiento DIAN

## Antecedentes
La sociedad fue notificada del requerimiento ordinario en virtud del Art. 752 E.T., con plazo de respuesta de 15 días hábiles contados desde la notificación.

## Posición Jurídica
Se invoca el parágrafo del Art. 647 E.T. (diferencia de criterio) en relación con la interpretación del Art. 122 E.T. sobre limitación de costos al exterior.

## Soporte Documental
Se adjuntan: comprobantes contables, libros oficiales, contratos de servicios exterior y certificaciones bancarias del periodo.

## Defensa Art. 647 E.T.
La discrepancia obedece a una diferencia razonable de criterio en la interpretación del derecho aplicable, lo cual está expresamente excluido como inexactitud sancionable por el parágrafo del Art. 647 E.T. Por lo tanto, no procede la sanción del 100% del mayor valor del impuesto.

## Petición
Solicitamos respetuosamente archivar el requerimiento por carecer de fundamento sancionatorio.

## Firmas
Atentamente,
Representante Legal
NIT 901714014-6

---

**Este es un borrador para revisión por contador público o abogado tributarista antes de su presentación oficial ante la DIAN.**
`;

const MOD5_752_OK: Modulo5DefensaDian = {
  tipoRequerimiento: 'requerimiento_ordinario_752',
  cartaTexto: CARTA_752_OK,
  invocaDiferenciaCriterio: true,
  mencionaReduccion: false,
};

export const RESP_DEFENSA_DIAN_REQUERIMIENTO: FiscalResponse = {
  modulos: ['M5'],
  modulo2: null,
  modulo3: null,
  modulo5: MOD5_752_OK,
  modulo6: null,
  modulo7: null,
  rawText: CARTA_752_OK,
};

// ===========================================================================
// CASO 7 — Defensa DIAN: usa Concepto 1352/2018 (blacklist CRITICA)
// ===========================================================================

const CARTA_1352_BAD = `# Carta Borrador

## Antecedentes
Notificado requerimiento ordinario Art. 752 E.T. (15 días hábiles).

## Posición Jurídica
La defensa diferencia de criterio se sustenta en el Concepto DIAN 100208221-1352 de 2018.

## Soporte Documental
Se adjuntan documentos contables.

## Defensa Art. 647 E.T.
Conforme al parágrafo Art. 647 E.T. y al Concepto 1352 de 2018.

## Petición
Archivar el requerimiento.

## Firmas
Representante legal — borrador sujeto a revisión por contador público.
`;

const MOD5_1352_BAD: Modulo5DefensaDian = {
  tipoRequerimiento: 'requerimiento_ordinario_752',
  cartaTexto: CARTA_1352_BAD,
  invocaDiferenciaCriterio: true,
  mencionaReduccion: false,
};

export const RESP_DEFENSA_DIAN_USA_1352: FiscalResponse = {
  modulos: ['M5'],
  modulo2: null,
  modulo3: null,
  modulo5: MOD5_1352_BAD,
  modulo6: null,
  modulo7: null,
  rawText: CARTA_1352_BAD,
};

// ===========================================================================
// CASO 8 — Devolución por retenciones (saldo a favor F04 < 0)
// ===========================================================================

const TEXTO_DEVOLUCION_OK = `Análisis de saldo a favor

Según el Bloque Âncora F04, el saldo a favor proyectado es de $5.000.000,00, originado en retenciones en la fuente acumuladas durante el período.

Conforme al Art. 850 E.T., el contribuyente tiene derecho a solicitar la devolución del saldo. El plazo de la DIAN para resolver es de 50 días hábiles contados desde la radicación completa de la solicitud, según Art. 855 E.T.

Importante: el término para solicitar la devolución es de 2 años contados a partir del vencimiento de la declaración, conforme al Art. 854 E.T. Si no se solicita dentro de este plazo, opera la prescripción y se pierde el derecho.

Recomendamos validar previamente con el revisor fiscal antes de radicar.
`;

const MOD6_RETENCIONES_OK: Modulo6Devoluciones = {
  origen: 'retenciones_fuente',
  saldoFavorCents: '500000000',
  f04CitadoCents: '-500000000',
  textoAnalisis: TEXTO_DEVOLUCION_OK,
  listaRequisitos: [
    'Solicitud presentada por MUISCA con firma electrónica',
    'Certificación del contador público que ratifica el saldo a favor',
    'Relación de retenedores con NIT, razón social y monto retenido',
    'Copia de la declaración tributaria del periodo objeto de devolución',
  ],
};

export const RESP_DEVOLUCION_RETENCIONES: FiscalResponse = {
  modulos: ['M6'],
  modulo2: null,
  modulo3: null,
  modulo5: null,
  modulo6: MOD6_RETENCIONES_OK,
  modulo7: null,
  rawText: TEXTO_DEVOLUCION_OK,
};

// ===========================================================================
// CASO 9 — Formato: contiene símbolo § (PROHIBIDO)
// ===========================================================================

const MOD7_BAD_SIMBOLO: Modulo7Format = {
  textoSalida: `Análisis tributario

El descuento aplicable se rige por el Art. 258 §1 E.T. del Estatuto Tributario, en concordancia con el Art. 647 §parágrafo.

Las cifras de impuesto son: $40.250.000,00 (impuesto bruto), $37.250.000,00 (neto).

Este análisis fue generado por El Escudo (1+1 IA). Las cifras y posiciones deben ser validadas por un contador público o asesor tributario antes de su uso oficial o presentación ante la DIAN.
`,
  modo: 'full',
};

export const RESP_FORMAT_CON_SIMBOLO_PARRAFO: FiscalResponse = {
  modulos: ['M7'],
  modulo2: null,
  modulo3: null,
  modulo5: null,
  modulo6: null,
  modulo7: MOD7_BAD_SIMBOLO,
  rawText: MOD7_BAD_SIMBOLO.textoSalida,
};

// ===========================================================================
// CASO 10 — Formato: usa palabra "centavos" visible
// ===========================================================================

const MOD7_BAD_CENTAVOS: Modulo7Format = {
  textoSalida: `Análisis

El impuesto a pagar es de 1.500.000 centavos COP (equivalente a $15.000,00).

Este análisis fue generado por El Escudo (1+1 IA). Las cifras y posiciones deben ser validadas por un contador público o asesor tributario antes de su uso oficial o presentación ante la DIAN.
`,
  modo: 'quick',
};

export const RESP_FORMAT_CON_CENTAVOS: FiscalResponse = {
  modulos: ['M7'],
  modulo2: null,
  modulo3: null,
  modulo5: null,
  modulo6: null,
  modulo7: MOD7_BAD_CENTAVOS,
  rawText: MOD7_BAD_CENTAVOS.textoSalida,
};

// ===========================================================================
// CASO 11 — Formato: cierre obligatorio FALTANTE
// ===========================================================================

const MOD7_BAD_SIN_CIERRE: Modulo7Format = {
  textoSalida: `Análisis tributario

El impuesto a pagar es de $40.250.000,00 conforme al Art. 240 E.T. (tarifa 35%).

La conciliación incluye adiciones por $20.000.000,00 y deducciones por $5.000.000,00.

Atentamente, El Escudo.
`,
  modo: 'full',
};

export const RESP_FORMAT_CIERRE_FALTANTE: FiscalResponse = {
  modulos: ['M7'],
  modulo2: null,
  modulo3: null,
  modulo5: null,
  modulo6: null,
  modulo7: MOD7_BAD_SIN_CIERRE,
  rawText: MOD7_BAD_SIN_CIERRE.textoSalida,
};

// ===========================================================================
// CASO 12 — Conciliación con cifras OK pero usado para tests de Capa 2 normativa
// ===========================================================================
//
// Alias para que tests de integración inyecten un fixture estándar.
// ===========================================================================

export const RESP_CCV_OK = RESP_CONCILIACION_OK;

// ===========================================================================
// Catálogo agregado para iteración en tests de integración
// ===========================================================================

export const ALL_FIXTURES = {
  RESP_CCV_OK,
  RESP_CONCILIACION_OK,
  RESP_CONCILIACION_BAD_158_3,
  RESP_RISK_SCORE_BAJO,
  RESP_RISK_SCORE_CRITICO,
  RESP_DEFENSA_DIAN_REQUERIMIENTO,
  RESP_DEFENSA_DIAN_USA_1352,
  RESP_DEVOLUCION_RETENCIONES,
  RESP_FORMAT_CON_SIMBOLO_PARRAFO,
  RESP_FORMAT_CON_CENTAVOS,
  RESP_FORMAT_CIERRE_FALTANTE,
} as const;

// ===========================================================================
// Helper: estructura empty para tests que solo necesitan un módulo
// ===========================================================================

export { empty as buildEmptyResponse };
