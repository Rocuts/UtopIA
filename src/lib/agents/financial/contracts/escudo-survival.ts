// ---------------------------------------------------------------------------
// Contratos JSON-strict — Modo Supervivencia Élite (Escudo Survival)
// ---------------------------------------------------------------------------
// Migra los schemas inline que vivían en cada `agents/*.ts` a un único módulo
// central. Los validators (`survival-validators.ts`) consumen el shape
// `{markdown, warnings, data: {...}}` y NO se modifican — los agents conservan
// ese shape literal en sus tipos legacy (`types.ts`); este contrato existe en
// paralelo con la garantía de que `z.infer<...>` produce el mismo shape.
//
// Reglas:
//   - Cifras en `number` (no centavos) por compatibilidad con `types.ts`.
//   - `warnings` y arrays anidados usan `.default([])` para conservar la
//     tolerancia previa cuando el modelo omite un campo.
//   - Las normas Art. 242 / Art. 36-3 / Art. 771-5 §2 son `z.literal` o `z.enum`
//     para forzar citación textual (defensa Art. 647 E.T.).
// ---------------------------------------------------------------------------

import { z } from 'zod';

// ---------------------------------------------------------------------------
// 1. TET Calculator
// ---------------------------------------------------------------------------

export const TetOptimizationSuggestionSchema = z.object({
  norma: z.string().min(1).describe('Cita textual del Art. E.T. soportante'),
  ahorroEstimado: z.number().describe('Ahorro proyectado en COP'),
  requisitos: z.array(z.string()),
  factibilidad: z.enum(['alta', 'media', 'baja']),
});

export const TetReportSchema = z.object({
  markdown: z.string().min(20),
  warnings: z.array(z.string()).default([]),
  data: z.object({
    tet: z.number().describe('Tasa Efectiva de Tributación como decimal [0,1+]'),
    ttd: z.number().describe('Tasa de Tributación Depurada (paragrafo 6 Art. 240 ET)'),
    nivelAlerta: z.enum(['verde', 'amarillo', 'rojo']),
    impuestoProyectado: z.number(),
    uai: z.number().describe('Utilidad Antes de Impuestos'),
    sugerenciasOptimizacion: z.array(TetOptimizationSuggestionSchema).default([]),
  }),
});

export type TetReportJson = z.infer<typeof TetReportSchema>;

// ---------------------------------------------------------------------------
// 2. Retention Shield
// ---------------------------------------------------------------------------

export const RetentionActionSchema = z.object({
  tipo: z.enum([
    'certif_no_retencion',
    'autorretenedor',
    'compensacion',
    'devolucion',
  ]),
  norma: z.string().min(1).describe('Cita exacta del Art. E.T. o Resolucion DIAN'),
  dificultad: z.enum(['baja', 'media', 'alta']),
  riesgo: z.string().min(1),
});

export const RetentionShieldReportSchema = z.object({
  markdown: z.string().min(20),
  warnings: z.array(z.string()).default([]),
  data: z.object({
    retencionesAcumuladas: z.number(),
    impuestoProyectado: z.number(),
    saldoAFavorProyectado: z.number(),
    acciones: z.array(RetentionActionSchema).default([]),
  }),
});

export type RetentionShieldReportJson = z.infer<typeof RetentionShieldReportSchema>;

// ---------------------------------------------------------------------------
// 3. Anti-DIAN Auditor
// ---------------------------------------------------------------------------

export const CashPaymentViolationSchema = z.object({
  beneficiarioNit: z.string().optional(),
  beneficiarioNombre: z.string().optional(),
  monto: z.number(),
  excesoUvt: z.number().describe('Exceso sobre 100 UVT'),
  norma: z.literal('Art. 771-5 §2 E.T.'),
});

export const ExogenaCrossSchema = z.object({
  cuenta: z.string().min(1).describe('Codigo PUC de la cuenta cruzada'),
  terceroNit: z.string().optional(),
  diferenciaEstimada: z.number(),
  norma: z.string().min(1).describe('Cita Resolucion DIAN (ej. "Resolucion DIAN 000227/2025")'),
});

export const AntiDianAuditReportSchema = z.object({
  markdown: z.string().min(20),
  warnings: z.array(z.string()).default([]),
  data: z.object({
    pagosEfectivoTotal: z.number(),
    pagosNoDeduciblesIndividuales: z.array(CashPaymentViolationSchema).default([]),
    excesoNoDeducibleGeneral: z.number(),
    crucesExogenaSospechosos: z.array(ExogenaCrossSchema).default([]),
    mayorImpuestoEstimado: z.number(),
  }),
});

export type AntiDianAuditReportJson = z.infer<typeof AntiDianAuditReportSchema>;

// ---------------------------------------------------------------------------
// 4. Contingency Reserve
// ---------------------------------------------------------------------------

export const ContingencyReserveReportSchema = z.object({
  markdown: z.string().min(20),
  warnings: z.array(z.string()).default([]),
  data: z.object({
    utilidadNeta: z.number(),
    reservaSugerida: z.number(),
    pctUtilidad: z.number().describe('Constante 0.10 (10%)'),
    cuentaSugerida: z.string().min(1),
    reservaLegalActual: z.number().optional(),
    gapReservaLegal: z.number().optional(),
  }),
});

export type ContingencyReserveReportJson = z.infer<typeof ContingencyReserveReportSchema>;

// ---------------------------------------------------------------------------
// 5. Dividend Optimizer
// ---------------------------------------------------------------------------

export const DividendScenarioSchema = z.object({
  ahorroSocio: z.number(),
  impuestoSocio: z.number(),
  netoSocio: z.number(),
  fortPatrimonio: z.number().optional(),
});

export const DividendOptimizationReportSchema = z.object({
  markdown: z.string().min(20),
  warnings: z.array(z.string()).default([]),
  data: z.object({
    utilidadDistribuible: z.number(),
    escenarios: z.object({
      distribuirTotal: DividendScenarioSchema,
      capitalizarTotal: DividendScenarioSchema,
      hibrido50_50: DividendScenarioSchema,
    }),
    recomendacion: z.string().min(1),
    norma: z.enum(['Art. 242 E.T.', 'Art. 36-3 E.T.']),
  }),
});

export type DividendOptimizationReportJson = z.infer<typeof DividendOptimizationReportSchema>;
