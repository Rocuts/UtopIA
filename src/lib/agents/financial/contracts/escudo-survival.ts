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
//   - Strict mode Zod: arrays siempre presentes. Si vacío, el LLM emite [] explícito (instruido en el prompt). NUNCA .default([]) — OpenAI strict no lo admite.
//   - Las normas Art. 242 / Art. 771-5 §2 son `z.literal` o `z.enum` para
//     forzar citación textual (defensa Art. 647 E.T.). El Art. 36-3 E.T. fue
//     derogado por la Ley 2277/2022 art. 96 y no es una norma admitida.
//   - Cifras sin base verificable → `.nullable()` (N/D ≠ 0). Los agentes
//     sobrescriben con el cálculo determinista después del LLM (auditoría
//     2026-09: tributario-modulos-06, -07, tributario-calc-01).
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
  warnings: z.array(z.string()),
  data: z.object({
    tet: z.number().nullable().describe('Tasa efectiva CONTABLE = impuesto causado (clase 54) / UAI, decimal. null si UAI ≤ 0. La fija el sistema'),
    ttd: z.number().nullable().describe('TTD (parágrafo 6 Art. 240 ET) = ID/UD. null sin ID/UD verificados'),
    nivelAlerta: z.enum(['verde', 'amarillo', 'rojo']).nullable(),
    impuestoProyectado: z.number().nullable().describe('Impuesto de renta causado en libros (clase 54), COP'),
    uai: z.number().describe('Utilidad Antes de Impuestos'),
    sugerenciasOptimizacion: z.array(TetOptimizationSuggestionSchema),
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
  warnings: z.array(z.string()),
  data: z.object({
    retencionesAcumuladas: z.number().describe('Crédito imputable a renta (135505, 135515; 135595/1805 con nombre de renta)'),
    impuestoProyectado: z.number().nullable().describe('Impuesto de renta causado en libros (clase 54)'),
    saldoAFavorProyectado: z.number().nullable().describe('null: sin declaración no hay saldo a favor determinable'),
    acciones: z.array(RetentionActionSchema),
  }),
});

export type RetentionShieldReportJson = z.infer<typeof RetentionShieldReportSchema>;

// ---------------------------------------------------------------------------
// 3. Anti-DIAN Auditor
// ---------------------------------------------------------------------------

export const CashPaymentViolationSchema = z.object({
  beneficiarioNit: z.string().nullable(),
  beneficiarioNombre: z.string().nullable(),
  monto: z.number(),
  excesoUvt: z.number().describe('Exceso sobre 100 UVT'),
  norma: z.literal('Art. 771-5 §2 E.T.'),
});

export const ExogenaCrossSchema = z.object({
  cuenta: z.string().min(1).describe('Codigo PUC de la cuenta cruzada'),
  terceroNit: z.string().nullable(),
  diferenciaEstimada: z.number(),
  norma: z.string().min(1).describe('Cita Resolucion DIAN (ej. "Resolucion DIAN 000227/2025")'),
});

export const AntiDianAuditReportSchema = z.object({
  markdown: z.string().min(20),
  warnings: z.array(z.string()),
  data: z.object({
    // Sin detalle de pagos del año (auxiliar de caja / pagos por transacción)
    // los montos de bancarización son N/D: el saldo de 1105 no es un flujo.
    pagosEfectivoTotal: z.number().nullable(),
    pagosNoDeduciblesIndividuales: z.array(CashPaymentViolationSchema),
    excesoNoDeducibleGeneral: z.number().nullable(),
    crucesExogenaSospechosos: z.array(ExogenaCrossSchema),
    mayorImpuestoEstimado: z.number().nullable(),
  }),
});

export type AntiDianAuditReportJson = z.infer<typeof AntiDianAuditReportSchema>;

// ---------------------------------------------------------------------------
// 4. Contingency Reserve
// ---------------------------------------------------------------------------

export const ContingencyReserveReportSchema = z.object({
  markdown: z.string().min(20),
  warnings: z.array(z.string()),
  data: z.object({
    utilidadNeta: z.number(),
    reservaSugerida: z.number(),
    pctUtilidad: z.number().describe('Constante 0.10 (10%)'),
    cuentaSugerida: z.string().min(1),
    reservaLegalActual: z.number().nullable(),
    gapReservaLegal: z.number().nullable(),
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
  fortPatrimonio: z.number().nullable(),
});

export const DividendOptimizationReportSchema = z.object({
  markdown: z.string().min(20),
  warnings: z.array(z.string()),
  data: z.object({
    utilidadDistribuible: z.number(),
    escenarios: z.object({
      distribuirTotal: DividendScenarioSchema,
      capitalizarTotal: DividendScenarioSchema,
      hibrido50_50: DividendScenarioSchema,
    }),
    recomendacion: z.string().min(1),
    norma: z.enum(['Art. 242 E.T.', 'Art. 242-1 E.T.']),
  }),
});

export type DividendOptimizationReportJson = z.infer<typeof DividendOptimizationReportSchema>;
