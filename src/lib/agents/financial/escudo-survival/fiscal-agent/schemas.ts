// ---------------------------------------------------------------------------
// EL ESCUDO — Capa 4 (Agente Fiscal) — Schemas Zod (strict mode)
// ---------------------------------------------------------------------------
//
// Reglas vinculantes (CLAUDE.md + docs/spec/zod-strict-mode-2026.md):
//   - `.nullable()` siempre; NUNCA `.optional()` / `.nullish()` / `.default()`
//     / `.passthrough()` / `z.record()` / `.catchall()`.
//   - Arrays: `.min(0)` explícito cuando vacío permitido.
//   - Strings de monto: MoneyCop = string en centavos, regex `^-?\d+$`.
//   - Strings en general: `.min(1)` o nullable.
//
// El CI guard `npm run lint:strict-mode` solo escanea `contracts/`. Estos
// schemas viven fuera, pero seguimos la misma convención por consistencia y
// para que OpenAI strict mode NO rechace los JSON schemas generados.
//
// Cada schema mapea 1:1 al `data` field de su correspondiente module result en
// `types.ts`. Las narrativas (markdown / warnings) y los metadatos también se
// modelan aquí porque viajan por el mismo `experimental_output`.
// ---------------------------------------------------------------------------

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Primitivos reutilizables
// ---------------------------------------------------------------------------

/** MoneyCop — string en centavos, BigInt-safe. */
const moneyCop = z
  .string()
  .min(1)
  .regex(/^-?\d+$/, 'MoneyCop debe ser string entero de centavos (BigInt-safe)');

/** Narrativa markdown. */
const markdownString = z.string().min(1).max(40_000);

/** Warning string (cada elemento). */
const warningString = z.string().min(1).max(2_000);

/** Cita normativa (Art. X E.T., Ley N de YYYY, NIIF para PYMES §N, etc.). */
const citaNormativa = z.string().min(1).max(200);

// ---------------------------------------------------------------------------
// Módulo 1 — CCV Fiscal F01-F10
// ---------------------------------------------------------------------------

export const ccvAlertaTasaMinimaSchema = z.object({
  aplica: z.boolean(),
  f09Actual: z.number(),
  brechaPp: z.number(),
  impuestoAdicionalEstimado: moneyCop,
  norma: citaNormativa,
});

export const ccvModuleSchema = z.object({
  markdown: markdownString,
  data: z.object({
    f01: moneyCop,
    f02: moneyCop,
    f03: moneyCop,
    f04: moneyCop,
    f05: moneyCop,
    f06: moneyCop,
    f07: moneyCop,
    f08: moneyCop,
    f09Pct: z.number(),
    f10Pct: z.number(),
    alertaTasaMinima: ccvAlertaTasaMinimaSchema,
    eficienciaFiscal: z.enum(['alta', 'media', 'baja']),
  }),
  warnings: z.array(warningString).max(20),
});

export type CcvModuleSchema = z.infer<typeof ccvModuleSchema>;

// ---------------------------------------------------------------------------
// Módulo 2 — Conciliación Fiscal Borrador
// ---------------------------------------------------------------------------

export const conciliacionLineaSchema = z.object({
  concepto: z.string().min(1).max(300),
  monto: moneyCop,
  norma: citaNormativa,
  tipo: z.enum([
    'adicion',
    'deduccion',
    'renta_exenta',
    'incrgno',
    'descuento',
    'retencion',
    'anticipo',
  ]),
});

export const conciliacionModuleSchema = z.object({
  markdown: markdownString,
  data: z.object({
    uaiContable: moneyCop,
    lineas: z.array(conciliacionLineaSchema).max(40),
    rentaLiquidaGravable: moneyCop,
    tarifaPct: z.number(),
    impuestoBruto: moneyCop,
    totalDescuentos: moneyCop,
    impuestoNeto: moneyCop,
    retencionesYAnticipos: moneyCop,
    saldoFinal: moneyCop,
    disclaimer: z.string().min(1).max(2_000),
  }),
  warnings: z.array(warningString).max(20),
});

export type ConciliacionModuleSchema = z.infer<typeof conciliacionModuleSchema>;

// ---------------------------------------------------------------------------
// Módulo 3 — Score Riesgo DIAN
// ---------------------------------------------------------------------------

export const riskFactorSchema = z.object({
  factor: z.enum([
    'tet_baja',
    'margen_alto',
    'costo_bajo',
    'crecimiento_inusual',
    'saldo_favor_sin_solicitar',
  ]),
  descripcion: z.string().min(1).max(300),
  puntos: z.number(),
  detalle: z.string().min(1).max(500),
});

export const riskScoreModuleSchema = z.object({
  markdown: markdownString,
  data: z.object({
    score: z.number(),
    nivel: z.enum(['bajo', 'medio', 'alto', 'muy_alto', 'critico']),
    factores: z.array(riskFactorSchema).max(10),
    interpretacion: z.string().min(1).max(2_000),
    recomendaciones: z.array(z.string().min(1).max(500)).max(10),
  }),
  warnings: z.array(warningString).max(20),
});

export type RiskScoreModuleSchema = z.infer<typeof riskScoreModuleSchema>;

// ---------------------------------------------------------------------------
// Módulo 4 — Planeación Tributaria
// ---------------------------------------------------------------------------

export const planeacionEscenarioSchema = z.object({
  nombre: z.enum(['conservador', 'base', 'agresivo']),
  impuestoBase: moneyCop,
  impuestoEscenario: moneyCop,
  ahorroEstimado: moneyCop,
  ahorroPct: z.number(),
  articulosAplicables: z.array(citaNormativa).max(20),
  documentacionRequerida: z.array(z.string().min(1).max(300)).max(20),
  riesgo: z.enum(['baja', 'media', 'alta']),
  justificacion: z.string().min(1).max(1_500),
});

export const planeacionModuleSchema = z.object({
  markdown: markdownString,
  data: z.object({
    escenarios: z.object({
      conservador: planeacionEscenarioSchema,
      base: planeacionEscenarioSchema,
      agresivo: planeacionEscenarioSchema,
    }),
    recomendacion: z.enum(['conservador', 'base', 'agresivo']),
    razonRecomendacion: z.string().min(1).max(2_000),
  }),
  warnings: z.array(warningString).max(20),
});

export type PlaneacionModuleSchema = z.infer<typeof planeacionModuleSchema>;

// ---------------------------------------------------------------------------
// Módulo 5 — Defensa DIAN
// ---------------------------------------------------------------------------

export const defensaDianModuleSchema = z.object({
  markdown: markdownString,
  data: z.object({
    tipoRequerimiento: z.enum([
      'requerimiento_ordinario',
      'emplazamiento_corregir',
      'emplazamiento_no_declarar',
      'pliego_cargos',
      'liquidacion_oficial_revision',
      'desconocido',
    ]),
    plazoRespuesta: z.string().min(1).max(200),
    normaPlazo: citaNormativa,
    antecedentes: z.string().min(1).max(4_000),
    posicionJuridica: z.string().min(1).max(6_000),
    citasNormativas: z.array(citaNormativa).max(30),
    soportesDocumentales: z.array(z.string().min(1).max(300)).max(30),
    defensaArt647: z.string().min(1).max(4_000).nullable(),
    reduccionesDisponibles: z.array(z.string().min(1).max(500)).max(10),
    cartaCompleta: z.string().min(1).max(20_000),
  }),
  warnings: z.array(warningString).max(20),
});

export type DefensaDianModuleSchema = z.infer<typeof defensaDianModuleSchema>;

// ---------------------------------------------------------------------------
// Módulo 6 — Devoluciones
// ---------------------------------------------------------------------------

export const devolucionesModuleSchema = z.object({
  markdown: markdownString,
  data: z.object({
    saldoAFavor: moneyCop,
    viabilidad: z.enum(['alta', 'media', 'baja', 'no_aplica']),
    plazoDian: z.string().min(1).max(200),
    plazoConGarantia: z.string().min(1).max(200),
    documentosRequeridos: z.array(z.string().min(1).max(300)).max(20),
    pasosProcedimentales: z.array(z.string().min(1).max(500)).max(20),
    riesgosIdentificados: z.array(z.string().min(1).max(500)).max(10),
    normaRef: citaNormativa,
  }),
  warnings: z.array(warningString).max(20),
});

export type DevolucionesModuleSchema = z.infer<typeof devolucionesModuleSchema>;

// ---------------------------------------------------------------------------
// Módulo 8 — Supervivencia Élite
// ---------------------------------------------------------------------------

export const supervivenciaAccionSchema = z.object({
  prioridad: z.number(),
  accion: z.string().min(1).max(500),
  norma: citaNormativa,
  fechaLimite: z.string().min(1).max(40).nullable(),
  impactoEstimado: moneyCop,
});

export const supervivenciaModuleSchema = z.object({
  markdown: markdownString,
  data: z.object({
    activo: z.boolean(),
    razonActivacion: z.string().min(1).max(2_000),
    riesgoDetectado: z.string().min(1).max(2_000),
    accionesInmediatas: z.array(supervivenciaAccionSchema).max(10),
    exposicionFiscalEstimada: moneyCop,
    exposicionMitigada: moneyCop,
    tet: z.object({
      tetActual: z.number(),
      brecha15Pct: z.number(),
      impuestoAdicional: moneyCop,
    }),
    escudoRetenciones: z.object({
      f03: moneyCop,
      ratioF10: z.number(),
      recomendacion: z.string().min(1).max(1_500),
    }),
    antiDian: z.object({
      resumen: z.string().min(1).max(2_000),
      norma: citaNormativa,
    }),
    reservaContingencia: z.object({
      sugerida: moneyCop,
      pctUtilidad: z.number(),
    }),
    dividendos: z.object({
      recomendacion: z.enum(['capitalizar', 'distribuir', 'hibrido']),
      norma: citaNormativa,
    }),
  }),
  warnings: z.array(warningString).max(20),
});

export type SupervivenciaModuleSchema = z.infer<typeof supervivenciaModuleSchema>;

// ---------------------------------------------------------------------------
// Sintetizador (dictamen ejecutivo)
// ---------------------------------------------------------------------------

export const synthesisRecommendationSchema = z.object({
  orden: z.number(),
  titulo: z.string().min(1).max(300),
  norma: citaNormativa,
  impactoEstimado: moneyCop,
  prioridad: z.enum(['alta', 'media', 'baja']),
});

export const synthesisSchema = z.object({
  markdown: markdownString,
  topRecommendations: z.array(synthesisRecommendationSchema).max(10),
  cierre: z.string().min(1).max(2_000),
});

export type SynthesisSchema = z.infer<typeof synthesisSchema>;
