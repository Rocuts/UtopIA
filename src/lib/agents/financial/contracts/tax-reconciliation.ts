// ---------------------------------------------------------------------------
// Contrato JSON-strict del pipeline Tax Reconciliation (Fase 2.C — GPT-5.4)
// ---------------------------------------------------------------------------
// Dos agentes secuenciales:
//   1. Difference Identifier  -> TaxDifferenceReportSchema
//   2. Deferred Tax Calculator -> DeferredTaxReportSchema
//
// Marco normativo de referencia:
//   - Art. 772-1 E.T. (conciliación fiscal obligatoria)
//   - Decreto 2235/2017 (reglamentación del Art. 772-1)
//   - Formato 2516 DIAN (PJ — Formulario 110) / Formato 2517 (PN — Formulario 210)
//   - NIC 12 (impuesto a las ganancias)
//   - Art. 240 E.T. (tarifa 35%) — invariante 2026
//   - UVT 2026 = $52.374 COP
// ---------------------------------------------------------------------------

import { z } from 'zod';
import { CompanyInfoSchema, MoneyCop, NormaRef } from './base';

// ---------------------------------------------------------------------------
// Stage 1 — Difference Identifier (Art. 772-1 E.T. + Formato 2516)
// ---------------------------------------------------------------------------
// El agente recorre las 5 categorías (Ingresos, Costos/Deducciones, Activos,
// Pasivos, Patrimonio) y emite diferencias clasificadas como permanentes o
// temporarias. La cédula puente reconcilia Patrimonio NIIF → Patrimonio
// Fiscal (Art. 282 E.T.).
// ---------------------------------------------------------------------------

/**
 * Categoría fiscal de la diferencia. Mapea uno-a-uno a las 5 secciones del
 * Formato 2516 (Ingresos / Costos / Activos / Pasivos / Patrimonio).
 */
export const DifferenceCategorySchema = z.enum([
  'ingresos',
  'costos_deducciones',
  'activos',
  'pasivos',
  'patrimonio',
]);

/**
 * Clasificación NIC 12: permanente NO genera impuesto diferido; temporaria
 * deducible genera DTA; temporaria imponible genera DTL.
 */
export const DifferenceClassificationSchema = z.enum([
  'permanente',
  'temporaria_deducible',
  'temporaria_imponible',
]);

/**
 * Una diferencia individual. Estructura granular para que el agente downstream
 * (Deferred Tax Calculator) pueda calcular DTA/DTL × 35% sin re-parsear texto.
 */
export const TaxDifferenceItemSchema = z.object({
  id: z.string().min(1).describe('ID corto para referencia cruzada con Agente 2'),
  category: DifferenceCategorySchema,
  concept: z.string().min(1).describe('Concepto contable (e.g. "Depreciación de PPE", "Inventarios a valor neto realizable")'),
  accountingBaseCents: MoneyCop.describe('Base contable NIIF (importe en libros)'),
  fiscalBaseCents: MoneyCop.describe('Base fiscal según E.T. (puede ser 0 si no hay base fiscal)'),
  differenceCents: MoneyCop.describe('accountingBaseCents − fiscalBaseCents (signo conserva el sentido)'),
  classification: DifferenceClassificationSchema,
  niifReference: NormaRef.describe('Norma NIIF aplicable (NIC/NIIF + párrafo, e.g. "NIC 16 §50")'),
  fiscalReference: NormaRef.describe('Artículo E.T. aplicable (e.g. "Art. 137 E.T.", "Art. 105 E.T.")'),
  /**
   * Si la diferencia es temporaria, el impuesto diferido asociado (× 35%).
   * Si es permanente, ambos son "0". El Agente 2 valida este cálculo.
   */
  deferredTaxAssetCents: MoneyCop.describe('DTA generado (temporaria deducible × 35%); 0 si no aplica'),
  deferredTaxLiabilityCents: MoneyCop.describe('DTL generado (temporaria imponible × 35%); 0 si no aplica'),
  notes: z.string().nullable().describe('Observaciones adicionales (impracticabilidad, supuesto aplicado, etc.)'),
});

export type TaxDifferenceItemJson = z.infer<typeof TaxDifferenceItemSchema>;

/**
 * Una fila de la cédula puente Patrimonio NIIF → Patrimonio Fiscal.
 * Convención de signo: positivo = suma al patrimonio fiscal; negativo = resta.
 */
export const BridgeScheduleRowSchema = z.object({
  label: z.string().min(1).describe('Etiqueta (e.g. "Patrimonio contable NIIF", "(+) Ajuste por revaluación PPE")'),
  amountCents: MoneyCop.describe('Importe del ajuste o saldo'),
  classification: z
    .enum(['patrimonio_niif', 'ajuste_activo', 'ajuste_pasivo', 'ajuste_ori', 'patrimonio_fiscal'])
    .describe('Tipo de fila para validación determinística del cuadre'),
  reference: NormaRef.nullable().describe('Norma E.T. relevante (e.g. "Art. 282 E.T.")'),
});

export type BridgeScheduleRowJson = z.infer<typeof BridgeScheduleRowSchema>;

/**
 * Mapeo a las 4 secciones del Formato 2516 DIAN. Si la entidad no está
 * obligada a transmitir el formato (ingresos brutos < 45.000 UVT), el agente
 * lo declara en `preparerNotes` pero igual produce el mapeo como insumo
 * gerencial.
 */
export const Formato2516SectionSchema = z.object({
  section: z.enum(['I_ingresos', 'II_costos_deducciones', 'III_patrimonio', 'IV_temporarias_permanentes']),
  rowReferences: z
    .array(
      z.object({
        differenceItemId: z.string().min(1),
        formRowLabel: z.string().min(1).describe('Etiqueta del renglón en el Formato 2516'),
      }),
    )
    .describe('Diferencias mapeadas a renglones del formato'),
});

export type Formato2516SectionJson = z.infer<typeof Formato2516SectionSchema>;

export const TaxDifferenceReportSchema = z.object({
  company: CompanyInfoSchema,
  /**
   * Todas las diferencias identificadas. El agente DEBE producir al menos una
   * por categoría siempre que la categoría tenga datos contables observables.
   */
  differences: z.array(TaxDifferenceItemSchema),
  /**
   * Resúmenes agregados por categoría (Σ |differenceCents|, Σ DTA, Σ DTL).
   * Validables: la suma de ítems por categoría debe coincidir con estos
   * totales (el orchestrator chequea post-LLM).
   */
  categorySummaries: z.array(
    z.object({
      category: DifferenceCategorySchema,
      totalAbsoluteDifferenceCents: MoneyCop,
      totalDtaCents: MoneyCop,
      totalDtlCents: MoneyCop,
      itemCount: z.number().int().nonnegative(),
    }),
  ),
  bridgeSchedule: z
    .array(BridgeScheduleRowSchema)
    .describe('Cédula puente Patrimonio NIIF → Patrimonio Fiscal — DEBE cuadrar'),
  patrimonioNiifCents: MoneyCop.describe('Patrimonio contable NIIF (cifra de origen — invariante)'),
  patrimonioFiscalCents: MoneyCop.describe('Patrimonio fiscal Art. 282 E.T. (cifra de cierre — invariante)'),
  formato2516Mapping: z.array(Formato2516SectionSchema),
  preparerNotes: z.array(z.string().min(1)),
});

export type TaxDifferenceReportJson = z.infer<typeof TaxDifferenceReportSchema>;

// ---------------------------------------------------------------------------
// Stage 2 — Deferred Tax Calculator (NIC 12)
// ---------------------------------------------------------------------------
// A partir de las diferencias temporarias del Agente 1, calcula impuesto
// diferido, concilia la tasa efectiva, mapea al Formato 2516 y produce los
// asientos contables. Excluye diferencias permanentes (no generan diferido).
// ---------------------------------------------------------------------------

/**
 * Fila de la hoja de cálculo. Es una rehidratación del `TaxDifferenceItem`
 * temporario del Agente 1 con la tasa aplicada (35% por defecto en 2026).
 */
export const DeferredTaxWorksheetRowSchema = z.object({
  differenceItemId: z.string().min(1),
  concept: z.string().min(1),
  temporaryDifferenceCents: MoneyCop.describe('Diferencia temporaria absoluta'),
  type: z.enum(['deducible', 'imponible']),
  taxRatePct: z.number().describe('Tarifa aplicada (35 por defecto; otra si zonas especiales)'),
  dtaCents: MoneyCop.describe('DTA = diferencia deducible × tarifa; 0 si imponible'),
  dtlCents: MoneyCop.describe('DTL = diferencia imponible × tarifa; 0 si deducible'),
  /**
   * Reconocimiento DTA: NIC 12 §24 requiere probabilidad de ganancias fiscales
   * futuras. Si no hay evidencia, el DTA NO se reconoce y este flag queda en
   * false (cifra dta se preserva como referencia, pero `recognizedDtaCents` será 0).
   */
  dtaRecognized: z.boolean().describe('false si NIC 12 §24 no permite reconocer el DTA'),
  recognizedDtaCents: MoneyCop.describe('DTA efectivamente reconocido en balance (= dtaCents si dtaRecognized; 0 si no)'),
  recognitionEvidence: z
    .string()
    .nullable()
    .describe('Sustento de la probabilidad de ganancias fiscales futuras. Null si dtaRecognized=false'),
});

export type DeferredTaxWorksheetRowJson = z.infer<typeof DeferredTaxWorksheetRowSchema>;

/**
 * Movimiento del ejercicio (NIC 12 §81(g)). Solo poblar si hay periodo
 * comparativo; en single-period los movimientos son null y `preparerNotes`
 * declara la limitación.
 */
export const DtaDtlMovementSchema = z.object({
  openingBalanceDtaCents: MoneyCop.nullable().describe('Saldo inicial DTA — null si no hay comparativo'),
  openingBalanceDtlCents: MoneyCop.nullable().describe('Saldo inicial DTL — null si no hay comparativo'),
  pnlChargeDtaCents: MoneyCop.nullable().describe('Cargo/abono a resultados — null en single-period'),
  pnlChargeDtlCents: MoneyCop.nullable(),
  oriChargeDtaCents: MoneyCop.nullable().describe('Cargo/abono a ORI — null en single-period'),
  oriChargeDtlCents: MoneyCop.nullable(),
  closingBalanceDtaCents: MoneyCop.describe('Saldo final DTA del periodo'),
  closingBalanceDtlCents: MoneyCop.describe('Saldo final DTL del periodo'),
  netPositionCents: MoneyCop.describe('Posición neta consolidada (DTA − DTL)'),
});

export type DtaDtlMovementJson = z.infer<typeof DtaDtlMovementSchema>;

/**
 * Desglose del gasto por impuesto del periodo: utilidad contable → renta
 * líquida fiscal → impuesto corriente → impuesto diferido → gasto total.
 */
export const TaxExpenseBreakdownSchema = z.object({
  accountingProfitBeforeTaxCents: MoneyCop.describe('UAI contable NIIF'),
  permanentIncreaseCents: MoneyCop.describe('(+) Diferencias permanentes que incrementan la renta'),
  permanentDecreaseCents: MoneyCop.describe('(−) Diferencias permanentes que disminuyen la renta'),
  temporaryNetCents: MoneyCop.describe('(+/−) Diferencias temporarias netas del periodo'),
  taxableIncomeCents: MoneyCop.describe('= Renta líquida fiscal'),
  taxRatePct: z.number().describe('Tarifa nominal aplicada (35 por defecto Art. 240 E.T.)'),
  currentTaxCents: MoneyCop.describe('= Renta líquida × tarifa = Impuesto corriente'),
  deferredTaxExpenseCents: MoneyCop.describe('(+/−) Gasto por impuesto diferido del periodo'),
  totalTaxExpenseCents: MoneyCop.describe('= Gasto total por impuesto NIC 12'),
});

export type TaxExpenseBreakdownJson = z.infer<typeof TaxExpenseBreakdownSchema>;

/**
 * Conciliación de tasa nominal (35%) a tasa efectiva. Cada partida debe
 * explicar puntos porcentuales del gap. La suma debe cuadrar contra la tasa
 * efectiva calculada.
 */
export const EffectiveRateReconciliationItemSchema = z.object({
  concept: z.string().min(1).describe('Concepto (e.g. "Ingresos no constitutivos de renta", "Beneficios tributarios")'),
  effectPctPoints: z
    .number()
    .describe('Efecto en la tasa, en puntos porcentuales. Signo positivo si suma, negativo si resta.'),
  norma: NormaRef.nullable(),
});

export type EffectiveRateReconciliationItemJson = z.infer<typeof EffectiveRateReconciliationItemSchema>;

export const EffectiveRateReconciliationSchema = z.object({
  nominalRatePct: z.number().describe('Tarifa nominal Art. 240 E.T. (35 por defecto 2026)'),
  reconcilingItems: z.array(EffectiveRateReconciliationItemSchema),
  effectiveRatePct: z.number().describe('Tasa efectiva = Gasto total / UAI × 100'),
});

export type EffectiveRateReconciliationJson = z.infer<typeof EffectiveRateReconciliationSchema>;

/**
 * Asiento contable recomendado. Las cuentas DEBEN ser PUC válidas (27xx para
 * impuesto diferido, 54xx para gasto, 37xx para ORI).
 */
export const JournalEntrySchema = z.object({
  description: z.string().min(1).describe('Descripción del asiento (e.g. "Reconocimiento DTA depreciación NIIF")'),
  date: z.string().describe('Fecha del asiento (formato DD/MM/AAAA o periodo fiscal)'),
  lines: z
    .array(
      z.object({
        pucAccount: z.string().regex(/^\d{4,6}$/, 'Cuenta PUC 4-6 dígitos'),
        accountName: z.string().min(1),
        debitCents: MoneyCop,
        creditCents: MoneyCop,
      }),
    )
    .min(2)
    .describe('Mínimo 2 líneas — partida doble OBLIGATORIA: Σ débitos = Σ créditos'),
});

export type JournalEntryJson = z.infer<typeof JournalEntrySchema>;

export const DeferredTaxReportSchema = z.object({
  company: CompanyInfoSchema,
  worksheet: z
    .array(DeferredTaxWorksheetRowSchema)
    .describe('Hoja de cálculo — solo diferencias temporarias (las permanentes no entran)'),
  dtaDtlSummary: z.object({
    totalDtaCents: MoneyCop.describe('Σ DTA calculado bruto'),
    totalRecognizedDtaCents: MoneyCop.describe('Σ DTA reconocido en balance (después de NIC 12 §24)'),
    totalDtlCents: MoneyCop.describe('Σ DTL calculado'),
    netPositionCents: MoneyCop.describe('Posición neta = DTA reconocido − DTL'),
  }),
  movement: DtaDtlMovementSchema,
  expenseBreakdown: TaxExpenseBreakdownSchema,
  effectiveRateReconciliation: EffectiveRateReconciliationSchema,
  formato2516Mapping: z
    .array(
      z.object({
        section: z.enum(['I_ingresos', 'II_costos_deducciones', 'III_patrimonio', 'IV_temporarias_permanentes']),
        rowReferences: z
          .array(
            z.object({
              differenceItemId: z.string().min(1),
              formRowLabel: z.string().min(1),
            }),
          ),
      }),
    )
    .describe('Mapeo de cada partida temporaria a renglones del Formato 2516'),
  journalEntries: z
    .array(JournalEntrySchema)
    .describe('Asientos contables — partida doble obligatoria'),
  preparerNotes: z.array(z.string().min(1)),
});

export type DeferredTaxReportJson = z.infer<typeof DeferredTaxReportSchema>;
