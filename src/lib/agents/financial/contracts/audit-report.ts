// ---------------------------------------------------------------------------
// Contratos JSON-strict de los 4 auditores especializados (post-GPT-5.4)
// ---------------------------------------------------------------------------
//
// Cada auditor (NIIF, Tributario, Legal, Revisoria Fiscal) emite un reporte
// estructurado validado por Zod strict. El runtime `callFinancialAgent` (ver
// `agents/runtime.ts`) lo enforza via `experimental_output: Output.object(...)`
// — los prompts NUNCA describen el schema en prosa.
//
// Diseno:
//
// - `AuditFindingSchema` espeja al `AuditFinding` legacy (audit/types.ts) con
//   campos opcionales convertidos a `.nullable()` (strict mode OpenAI).
// - Cada auditor agrega un schema dedicado (`NiifAuditReportSchema`, ...) con
//   campos especificos. El Fiscal Reviewer ademas devuelve `opinionType` y
//   `dictamen`.
// - Los `code` siguen un prefijo por dominio (NIIF-XXX, TRIB-XXX, LEG-XXX,
//   RF-XXX) — el Zod valida el prefijo de forma laxa via regex.
// - El `period` es nullable (los hallazgos no-periodo-especificos lo omiten).
// - El `impactCop` es opcional (`MoneyCop.nullable()`) para hallazgos
//   tributarios con exposicion calculable en pesos. El resto lo deja en null.
//
// Estos schemas viven en `contracts/audit-report.ts` y se exportan por barrel
// (`contracts/index.ts`) — el barrel lo edita Johan al final del refactor.
// ---------------------------------------------------------------------------

import { z } from 'zod';
import { MoneyCop, NormaRef } from './base';

// ---------------------------------------------------------------------------
// Enums compartidos — espejo de `audit/types.ts` (legacy TS)
// ---------------------------------------------------------------------------

export const FindingSeverityEnum = z.enum(['critico', 'alto', 'medio', 'bajo', 'informativo']);
export type FindingSeverityJson = z.infer<typeof FindingSeverityEnum>;

export const AuditDomainEnum = z.enum(['niif', 'tributario', 'legal', 'revisoria']);
export type AuditDomainJson = z.infer<typeof AuditDomainEnum>;

export const AuditOpinionTypeEnum = z.enum([
  'favorable',
  'con_salvedades',
  'desfavorable',
  'abstension',
]);
export type AuditOpinionTypeJson = z.infer<typeof AuditOpinionTypeEnum>;

// ---------------------------------------------------------------------------
// AuditFindingSchema — base compartida por los 4 auditores
// ---------------------------------------------------------------------------

export const AuditFindingSchema = z.object({
  code: z
    .string()
    .min(1)
    .describe('Codigo unico del hallazgo. Prefijo por dominio: NIIF-XXX, TRIB-XXX, LEG-XXX, RF-XXX'),
  severity: FindingSeverityEnum,
  title: z.string().min(1).describe('Titulo breve y descriptivo del hallazgo'),
  description: z.string().min(1).describe('Descripcion detallada del problema o riesgo identificado'),
  normReference: NormaRef.describe('Referencia normativa exacta — articulo, parrafo o seccion'),
  recommendation: z.string().min(1).describe('Accion correctiva especifica y accionable'),
  impact: z.string().min(1).describe('Consecuencia de no corregir: sancion, salvedad, exposicion'),
  /**
   * Periodo aplicable al hallazgo:
   * - Periodo unico: "2025"
   * - Inter-periodo: "2024 → 2025"
   * - No periodo-especifico: null (el adapter pone el primario)
   */
  period: z.string().nullable().describe('Periodo al que aplica el hallazgo o null si no aplica'),
  /**
   * Exposicion en COP (centavos) cuando el auditor pueda calcularla — usado
   * principalmente por el Auditor Tributario. Null cuando no es cuantificable.
   */
  impactCop: MoneyCop.nullable().describe('Exposicion estimada en centavos COP cuando es calculable'),
});

export type AuditFindingJson = z.infer<typeof AuditFindingSchema>;

// ---------------------------------------------------------------------------
// Score bandera estable — 0..100 entero
// ---------------------------------------------------------------------------

const ComplianceScore = z
  .number()
  .int()
  .min(0)
  .max(100)
  .describe('Score de cumplimiento del dominio. 0 = incumplimiento total, 100 = ejemplar');

// ---------------------------------------------------------------------------
// Per-auditor reports
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Spec v2.1 Dictamen 1 — sub-schemas estructurados para el Auditor NIIF
// ---------------------------------------------------------------------------
// La auditora externa exige un dictamen formal con secciones numeradas: alcance,
// hallazgos por seccion NIIF, lista minima de verificacion, opinion y acciones.
// Estos building blocks viven en `NiifAuditReportSchema` como campos nullable
// para preservar backward compatibility: cuando el agente no los emite, el
// renderer cae al formato legacy (findings sueltos).
// ---------------------------------------------------------------------------

/** Estado de cumplimiento por seccion NIIF for SMEs revisada. */
export const NiifSectionStatusEnum = z.enum([
  'conforme',
  'observacion',
  'incumplimiento',
]);
export type NiifSectionStatusJson = z.infer<typeof NiifSectionStatusEnum>;

/**
 * Check de cumplimiento por seccion NIIF for SMEs. El dictamen v2.1 exige
 * cubrir 13 secciones materiales: 3, 4, 5, 6, 7, 8, 11, 13, 17, 23, 28, 29, 32.
 */
export const NiifSectionCheckSchema = z.object({
  section: z
    .string()
    .min(1)
    .describe('Identificador de seccion. Ej: "Seccion 3", "Seccion 17", "NIC 1"'),
  sectionTitle: z
    .string()
    .min(1)
    .describe('Titulo legible de la seccion. Ej: "Presentacion de EEFF"'),
  status: NiifSectionStatusEnum,
  finding: z
    .string()
    .min(1)
    .describe('Hallazgo breve. Si status=conforme, usar "Sin observaciones".'),
  reference: NormaRef.describe('Norma citada (ej. "Seccion 3 NIIF PYMES")'),
  /** Accion correctiva. Cuando status=conforme se devuelve "—". */
  action: z
    .string()
    .min(1)
    .describe('Accion requerida o "—" si la seccion esta conforme'),
});
export type NiifSectionCheckJson = z.infer<typeof NiifSectionCheckSchema>;

/**
 * Conteo agregado de secciones revisadas. El renderer lo usa para el bloque
 * "RESUMEN ESTADISTICO" del dictamen.
 */
export const NiifSummaryStatsSchema = z.object({
  conformes: z.number().int().min(0).describe('Secciones sin observaciones'),
  observaciones: z.number().int().min(0).describe('Secciones con observaciones menores'),
  incumplimientos: z.number().int().min(0).describe('Secciones con incumplimientos graves'),
});
export type NiifSummaryStatsJson = z.infer<typeof NiifSummaryStatsSchema>;

/** Tipos de opinion NIIF conforme a NIA 700-706. */
export const NiifOpinionTypeEnum = z.enum([
  'sin_salvedades',
  'con_salvedades',
  'adversa',
  'abstension',
]);
export type NiifOpinionTypeJson = z.infer<typeof NiifOpinionTypeEnum>;

/** Bloque de opinion formal NIIF del dictamen. */
export const NiifOpinionSchema = z.object({
  type: NiifOpinionTypeEnum,
  text: z
    .string()
    .min(1)
    .describe('Parrafo completo de opinion. Solo se renderiza la opinion seleccionada.'),
});
export type NiifOpinionJson = z.infer<typeof NiifOpinionSchema>;

/** Horizonte de ejecucion de una accion correctiva. */
export const ActionHorizonEnum = z.enum([
  'inmediato',
  'corto_plazo',
  'mediano_plazo',
]);
export type ActionHorizonJson = z.infer<typeof ActionHorizonEnum>;

/** Accion requerida en el dictamen NIIF — accionable + horizonte + referencia. */
export const NiifRequiredActionSchema = z.object({
  action: z.string().min(1).describe('Accion correctiva especifica'),
  horizon: ActionHorizonEnum,
  reference: NormaRef.describe('Norma de respaldo'),
});
export type NiifRequiredActionJson = z.infer<typeof NiifRequiredActionSchema>;

export const NiifAuditReportSchema = z.object({
  complianceScore: ComplianceScore,
  executiveSummary: z
    .string()
    .min(1)
    .describe('Resumen ejecutivo de 2-3 parrafos con hallazgos principales'),
  findings: z.array(AuditFindingSchema).describe('Lista de hallazgos contables/NIIF'),
  conclusion: z
    .string()
    .min(1)
    .describe('Parrafo final sobre la calidad de los estados financieros'),
  // ---------- v2.1 Dictamen 1 (additive) ----------
  /**
   * Checks de las 13 secciones NIIF for SMEs materiales del dictamen v2.1:
   * 3 (Presentacion), 4 (Balance), 5 (Resultados), 6 (ECP), 7 (EFE),
   * 8 (Notas), 11 (Instrumentos financieros basicos), 13 (Inventarios),
   * 17 (PPE), 23 (Ingresos), 28 (Beneficios empleados), 29 (Impuestos),
   * 32 (Hechos posteriores). Cuando una seccion no aplica, emite status=
   * conforme con finding="Sin observaciones". Null si el agente cae al
   * formato legacy.
   */
  niifSectionChecks: z
    .array(NiifSectionCheckSchema)
    .nullable()
    .describe('13 checks de seccion NIIF PYMES en orden. Null para formato legacy.'),
  /** Conteo agregado de las secciones revisadas. Null si niifSectionChecks=null. */
  summaryStats: NiifSummaryStatsSchema
    .nullable()
    .describe('Conteo de conformes/observaciones/incumplimientos. Null si no aplica.'),
  /** Opinion formal NIIF (solo se renderiza la opcion seleccionada). */
  auditOpinion: NiifOpinionSchema
    .nullable()
    .describe('Bloque de opinion formal. Null cuando se omite el dictamen v2.1.'),
  /** Acciones requeridas con horizonte de ejecucion. */
  requiredActions: z
    .array(NiifRequiredActionSchema)
    .nullable()
    .describe('Acciones correctivas priorizadas. Null si no aplica formato v2.1.'),
});
export type NiifAuditReportJson = z.infer<typeof NiifAuditReportSchema>;

// ---------------------------------------------------------------------------
// Spec v2.1 Dictamen 2 — sub-schemas estructurados para el Auditor Tributario
// ---------------------------------------------------------------------------
// El dictamen v2.1 exige analisis numerados 2-9: renta (cascada), retenciones,
// IVA/ICA, TTD, riesgos, calendario, opinion, acciones. Cada bloque vive como
// schema nullable en `TaxAuditReportSchema` para preservar el formato legacy.
// ---------------------------------------------------------------------------

/** Resultado del cuadre teorico de renta vs registrado. */
export const TaxEvaluacionEnum = z.enum([
  'coherente',
  'observacion',
  'incoherente',
]);
export type TaxEvaluacionJson = z.infer<typeof TaxEvaluacionEnum>;

/**
 * Analisis 2 — Impuesto de renta (cascada 35% sobre utilidad antes de
 * impuestos vs impuesto registrado).
 */
export const RentaAnalysisSchema = z.object({
  tarifaGeneralPct: z
    .number()
    .describe('Tarifa general renta persona juridica 2026 (35)'),
  utilidadAntesImpuestosCop: MoneyCop
    .nullable()
    .describe('Utilidad contable antes de impuestos en centavos. Null si no se infiere.'),
  provisionTeoricaCop: MoneyCop
    .nullable()
    .describe('Impuesto teorico a tarifa nominal sobre la UAI (referencia de conciliacion contable NIC 12 par. 81(c) / Sec. 29; NO es renta liquida ni impuesto a pagar). El sistema lo recalcula. Null si falta la UAI.'),
  impuestoRegistradoCop: MoneyCop
    .nullable()
    .describe('Gasto por impuesto de renta CORRIENTE del periodo (PUC 5405). Excluye el impuesto diferido. Null si no se identifica.'),
  brechaCop: MoneyCop
    .nullable()
    .describe('Diferencia de conciliacion = impuesto teorico - impuesto corriente registrado (con signo). El sistema la recalcula. Null si falta cualquiera de los dos.'),
  evaluacion: TaxEvaluacionEnum,
  accion: z.string().min(1).describe('Accion recomendada concreta'),
  reference: NormaRef.describe(
    'Referencias normativas. Ej: "Art. 240 E.T.; Ley 2277 de 2022; NIIF PYMES Sec. 29"',
  ),
});
export type RentaAnalysisJson = z.infer<typeof RentaAnalysisSchema>;

/**
 * Analisis 3 — Retenciones, anticipos y posicion fiscal neta DE RENTA.
 *
 * Posicion de renta = (anticipos y retenciones de renta en la 1355 + 1805
 * sólo si su nombre es fiscal) − 2404. Positivo = saldo a favor; negativo =
 * saldo a pagar. NO incluye IVA/ICA ni el grupo 24 completo, y no suma el
 * impuesto diferido (no exigible). La 1805 en el PUC (D. 2650/1993) es
 * "Bienes de arte y cultura": sólo cuenta si el nombre de la cuenta indica
 * impuesto/anticipo/retención/saldo a favor. El adapter recalcula estas
 * cifras desde el preprocesador (auditoria-calidad-22).
 */
export const RetencionesAnalysisSchema = z.object({
  saldo1355Cop: MoneyCop.nullable().describe('Saldo de anticipos y retenciones de RENTA en la Cta.1355 (135505, 135515; 135595 solo si su nombre es de renta). Excluye IVA/ICA (135510, 135517, 135518, ...). Null si no hay detalle.'),
  saldo1805Cop: MoneyCop.nullable().describe('Saldo Cta.1805 SOLO si el nombre de la cuenta indica impuesto, anticipo, retencion o saldo a favor; en el PUC la 1805 es "Bienes de arte y cultura" y entonces va null.'),
  saldo24Cop: MoneyCop.nullable().describe('Saldo Cta.2404 (impuesto de renta y complementarios por pagar). NO el grupo 24 completo.'),
  posicionFiscalNetaCop: MoneyCop
    .nullable()
    .describe('Posicion de renta = (1355 renta + 1805 fiscal) - 2404. Positivo=saldo a favor, negativo=saldo a pagar.'),
  evaluacion: z.string().min(1).describe('Conclusion breve sobre la posicion fiscal'),
  reference: NormaRef.describe('Norma de respaldo (Art. 850 E.T.; DUR 1625/2016 Arts. 1.6.1.21.1 y ss., devoluciones y compensaciones; etc.)'),
});
export type RetencionesAnalysisJson = z.infer<typeof RetencionesAnalysisSchema>;

/** Regimen IVA aplicable al contribuyente segun el dictamen. */
export const RegimenIvaEnum = z.enum([
  'responsable',
  'no_responsable',
  'no_aplica',
]);
export type RegimenIvaJson = z.infer<typeof RegimenIvaEnum>;

/** Analisis 4 — IVA / ICA / Impuestos territoriales. */
export const IvaIcaAnalysisSchema = z.object({
  pasivoIvaNetoCop: MoneyCop
    .nullable()
    .describe('Pasivo neto de IVA al cierre (Cta.2408 - Cta.1355 IVA). Null si no se infiere.'),
  regimenIva: RegimenIvaEnum
    .nullable()
    .describe('Regimen IVA inferido. Null si no hay datos suficientes.'),
  icaComment: z.string().min(1).describe('Comentario sobre ICA (municipio, actividad gravada)'),
  reference: NormaRef.describe('Referencias (Art. 437-1 E.T., Acuerdos municipales)'),
});
export type IvaIcaAnalysisJson = z.infer<typeof IvaIcaAnalysisSchema>;

/**
 * Estado TTD (Tasa de Tributacion Depurada, paragrafo 6 Art. 240 E.T.).
 * `no_determinable`: faltan impuesto depurado (ID), utilidad depurada (UD) o
 * la verificacion del ambito — el impuesto contable / UAI NO es la TTD.
 */
export const TmtStatusEnum = z.enum(['cumple', 'no_cumple', 'no_aplica', 'no_determinable']);
export type TmtStatusJson = z.infer<typeof TmtStatusEnum>;

/**
 * Analisis 5 — Tasa de Tributación Depurada (TTD, Art. 240 par. 6 E.T.;
 * Ley 2277/2022).
 * Aplica a TODO contribuyente de renta de los Arts. 240 / 240-1 E.T. sin
 * umbral de activos o patrimonio. 'no_aplica' se reserva para:
 *   - las exclusiones del texto del paragrafo 6 (ley_2277_2022.md), listadas
 *     en EXCEPCIONES_TTD_PAR6 (tax-planning/prompts/tax-optimizer.prompt.ts):
 *     personas juridicas extranjeras sin residencia, ZESE durante la tarifa
 *     del 0%, ZOMAC, sociedades de los paragrafos 1, 5 y 7 del Art. 240 (los
 *     5 y 7 si no estan obligadas al informe pais por pais), UD <= 0 y
 *     contribuyentes del Art. 32 E.T.;
 *   - quien no liquida el Art. 240: el RTE (Art. 19) y el SIMPLE no son
 *     contribuyentes del Art. 240, asi que la TTD no les aplica; no son
 *     excepciones del paragrafo 6.
 */
export const TmtAnalysisSchema = z.object({
  tasaMinimaExigidaPct: z
    .number()
    .describe('Tasa minima exigida (15 conforme paragrafo 6 Art. 240 E.T.)'),
  tasaEfectivaPct: z
    .number()
    .nullable()
    .describe('TTD = ID / UD x 100 (par. 6 Art. 240 E.T.). Null sin ID y UD depurados y ambito verificado; nunca impuesto contable / UAI.'),
  status: TmtStatusEnum,
  reference: NormaRef.describe('Norma de la Tasa de Tributación Depurada (TTD, Art. 240 par. 6 E.T.). Ej: "Art. 240 par. 6 E.T.; Ley 2277/2022"'),
});
export type TmtAnalysisJson = z.infer<typeof TmtAnalysisSchema>;

/** Probabilidad de un riesgo tributario. */
export const RiesgoProbabilidadEnum = z.enum(['alta', 'media', 'baja']);
export type RiesgoProbabilidadJson = z.infer<typeof RiesgoProbabilidadEnum>;

/** Analisis 6 — Riesgo tributario priorizado con exposicion estimada. */
export const RiesgoTributarioSchema = z.object({
  descripcion: z.string().min(1).describe('Descripcion del riesgo'),
  probabilidad: RiesgoProbabilidadEnum,
  exposicionCop: MoneyCop
    .nullable()
    .describe('Exposicion estimada en centavos. Null si no es cuantificable.'),
  reference: NormaRef.describe('Norma o concepto DIAN aplicable'),
});
export type RiesgoTributarioJson = z.infer<typeof RiesgoTributarioSchema>;

/** Analisis 7 — Calendario tributario 2026. Cada obligacion + fecha + nota. */
export const CalendarioObligacionSchema = z.object({
  obligacion: z.string().min(1).describe('Obligacion. Ej: "Renta persona juridica 2025"'),
  fechaLimite: z
    .string()
    .min(1)
    .describe('Fecha limite. Texto libre. Si no se conoce: "Por confirmar".'),
  notes: z.string().nullable().describe('Notas adicionales o null'),
  reference: NormaRef.describe('Resolucion DIAN o decreto vigente'),
});
export type CalendarioObligacionJson = z.infer<typeof CalendarioObligacionSchema>;

/** Tipo de opinion tributaria del dictamen v2.1. */
export const TaxOpinionTypeEnum = z.enum([
  'sin_hallazgos',
  'con_observaciones',
  'con_hallazgos_criticos',
]);
export type TaxOpinionTypeJson = z.infer<typeof TaxOpinionTypeEnum>;

/** Analisis 8 — Opinion tributaria formal con exposicion total. */
export const TaxOpinionSchema = z.object({
  type: TaxOpinionTypeEnum,
  text: z.string().min(1).describe('Parrafo de opinion seleccionada. Solo se renderiza esta.'),
  exposicionTotalCop: MoneyCop
    .nullable()
    .describe('Exposicion fiscal total en centavos. Null si no es cuantificable.'),
});
export type TaxOpinionJson = z.infer<typeof TaxOpinionSchema>;

/** Prioridad de una accion correctiva tributaria. */
export const TaxActionPriorityEnum = z.enum(['alta', 'media', 'baja']);
export type TaxActionPriorityJson = z.infer<typeof TaxActionPriorityEnum>;

/** Analisis 9 — Acciones correctivas priorizadas. */
export const TaxRequiredActionSchema = z.object({
  action: z.string().min(1).describe('Accion correctiva concreta'),
  priority: TaxActionPriorityEnum,
  reference: NormaRef.describe('Norma de respaldo'),
});
export type TaxRequiredActionJson = z.infer<typeof TaxRequiredActionSchema>;

export const TaxAuditReportSchema = z.object({
  complianceScore: ComplianceScore,
  executiveSummary: z
    .string()
    .min(1)
    .describe('Resumen ejecutivo con hallazgos principales y exposicion fiscal estimada'),
  findings: z.array(AuditFindingSchema).describe('Lista de hallazgos tributarios (E.T. + DIAN)'),
  /**
   * Exposicion fiscal total estimada en centavos COP — suma de los impactCop
   * cuantificables. Null cuando ningun hallazgo es cuantificable.
   */
  totalFiscalExposureCop: MoneyCop
    .nullable()
    .describe('Suma de exposiciones fiscales cuantificables en centavos. Null si ninguna lo es.'),
  conclusion: z.string().min(1).describe('Parrafo final con opinion sobre el riesgo tributario global'),
  // ---------- v2.1 Dictamen 2 (additive) ----------
  /** Analisis 2 — Impuesto de renta (cascada teorica vs registrado). */
  rentaAnalysis: RentaAnalysisSchema
    .nullable()
    .describe('Analisis cascada de renta. Null si se omite formato v2.1.'),
  /** Analisis 3 — Retenciones, anticipos y posicion fiscal neta. */
  retencionesAnalysis: RetencionesAnalysisSchema
    .nullable()
    .describe('Analisis de retenciones y posicion fiscal. Null si se omite formato v2.1.'),
  /** Analisis 4 — IVA / ICA / Impuestos territoriales. */
  ivaIcaAnalysis: IvaIcaAnalysisSchema
    .nullable()
    .describe('Analisis de IVA e ICA. Null si se omite formato v2.1.'),
  /** Analisis 5 — Tasa de Tributación Depurada (TTD, Art. 240 par. 6 E.T.). */
  tmtAnalysis: TmtAnalysisSchema
    .nullable()
    .describe('Analisis de la Tasa de Tributación Depurada (TTD, Art. 240 par. 6 E.T.). Null si se omite formato v2.1.'),
  /** Analisis 6 — Riesgos tributarios priorizados. */
  riesgosTributarios: z
    .array(RiesgoTributarioSchema)
    .nullable()
    .describe('Lista de riesgos tributarios con exposicion. Null si se omite formato v2.1.'),
  /** Analisis 7 — Calendario tributario 2026 aplicable. */
  calendario2026: z
    .array(CalendarioObligacionSchema)
    .nullable()
    .describe('Calendario tributario aplicable al contribuyente. Null si se omite formato v2.1.'),
  /** Analisis 8 — Opinion tributaria formal con exposicion total. */
  auditOpinion: TaxOpinionSchema
    .nullable()
    .describe('Opinion tributaria formal. Null si se omite formato v2.1.'),
  /** Analisis 9 — Acciones correctivas priorizadas. */
  requiredActions: z
    .array(TaxRequiredActionSchema)
    .nullable()
    .describe('Acciones priorizadas. Null si se omite formato v2.1.'),
});
export type TaxAuditReportJson = z.infer<typeof TaxAuditReportSchema>;

// ---------------------------------------------------------------------------
// Legal Auditor — v2.1 Dictamen 3 (Wave 7.B1)
// ---------------------------------------------------------------------------
// La especificación v2.1 "Dictamen 3 — Auditor Legal" exige un dictamen
// estructurado con secciones formales: (i) tabla de 14 obligaciones
// societarias, (ii) análisis de distribución del patrimonio, (iii) análisis
// de capitalización (reforma estatutaria: Art. 29 Ley 1258/2008 en SAS;
// Art. 158 C.Co. en sociedades del C.Co.), (iv) riesgos legales, (v)
// opinión del auditor legal y (vi) acciones requeridas.
//
// Todas las sub-secciones son `.nullable()` (no `.optional()`) para
// compatibilidad estricta con `experimental_output: Output.object(...)` del
// AI SDK v6 + OpenAI strict json_schema. El renderer fallback gracefully a
// texto legacy cuando los campos son null.
//
// Las 14 obligaciones societarias canónicas (orden fijo, ver
// `legal-auditor.prompt.ts` y `legal-auditor.ts:renderMarkdown`):
//   1.  Convocatoria (SAS: Art. 20 Ley 1258; S.A.: Art. 424 C.Co.; Ltda.: Arts. 181-186 C.Co.)
//   2.  Quórum (Art. 427 / 359 / Ley 1258 Art. 22)
//   3.  Orden del día (Art. 425 C.Co.)
//   4.  EEFF aprobados (Art. 446 C.Co.)
//   5.  Informe de gestión (Art. 47 Ley 222/1995)
//   6.  Destinación utilidades (Art. 155 / 451 C.Co.)
//   7.  Reserva legal 10% (Art. 452 C.Co.)
//   8.  Libro de actas (Art. 189 C.Co.)
//   9.  Libro de accionistas (Art. 195 C.Co. / Art. 12 Ley 1258)
//   10. Matrícula mercantil (Art. 19 C.Co.)
//   11. Revisor Fiscal (Art. 203 C.Co. / Ley 43/1990)
//   12. RL en Cámara (Art. 442 C.Co.)
//   13. Registro Único de Beneficiarios Finales — RUB DIAN (Resolución 000164/2021)
//   14. RUT/CIIU (Art. 555-2 E.T. / Res. DIAN 000114/2020)
// ---------------------------------------------------------------------------

export const SocietaryObligationStatusEnum = z.enum([
  'cumplido',
  'parcial',
  'incumplido',
  'no_aplica',
]);
export type SocietaryObligationStatusJson = z.infer<typeof SocietaryObligationStatusEnum>;

export const SocietaryObligationSchema = z.object({
  obligation: z
    .string()
    .min(1)
    .describe('Nombre de la obligación societaria. Ej: "Convocatoria Asamblea"'),
  status: SocietaryObligationStatusEnum.describe('Estado de cumplimiento'),
  reference: z
    .string()
    .min(1)
    .describe('Referencia normativa exacta. Ej: "Art. 424 C.Co."'),
  comment: z
    .string()
    .nullable()
    .describe('Comentario breve cuando aplique. Null si no hay observación.'),
});
export type SocietaryObligationJson = z.infer<typeof SocietaryObligationSchema>;

export const PatrimonyDistributionSchema = z.object({
  utilidadNetaCop: MoneyCop
    .nullable()
    .describe('Utilidad neta del ejercicio en centavos COP. Null si no se identifica.'),
  reservaLegalObligatoria: z
    .boolean()
    .nullable()
    .describe('Copia del regimen de reserva legal indicado en el prompt: true (obligatoria), false (SAS cuyos estatutos no la exigen), null (estatutos no suministrados: no determinable).'),
  montoReserva10pctCop: MoneyCop
    .nullable()
    .describe('Reserva legal del ejercicio COPIADA de las cifras vinculantes del acta (no calcular). Null si no aplica o no hay cifra vinculante.'),
  utilidadDisponibleCop: MoneyCop
    .nullable()
    .describe('Utilidad disponible tras reserva legal COPIADA de las cifras vinculantes del acta (no calcular). Null si no hay cifra vinculante.'),
  tipoDividendoPosible: z
    .enum(['ordinario', 'preferencial', 'no_aplica'])
    .nullable()
    .describe('Tipo de dividendo distribuible bajo Art. 155 / 451 C.Co.'),
  impuestoDividendosComment: z
    .string()
    .min(1)
    .describe('Comentario sobre la retención del 10% (Art. 242 E.T.) o aplicabilidad.'),
});
export type PatrimonyDistributionJson = z.infer<typeof PatrimonyDistributionSchema>;

export const CapitalizacionAnalysisSchema = z.object({
  proposed: z
    .boolean()
    .describe('True si la asamblea aprobó capitalización de utilidades.'),
  baseLegal: z
    .string()
    .min(1)
    .describe('Base legal de la capitalización (reforma estatutaria). Ej: "Art. 29 Ley 1258/2008" (SAS) o "Art. 158 C.Co." (sociedades del C.Co.)'),
  documentoRequerido: z
    .string()
    .min(1)
    .describe('Documento societario requerido. Ej: "Acta de Asamblea + Escritura pública"'),
  beneficioFiscal: z
    .string()
    .min(1)
    .describe('Tratamiento fiscal: dividendo en especie (Art. 30 E.T.), depuración Arts. 48-49 E.T. y retención Arts. 242/242-1/245 E.T. El Art. 36-3 E.T. está derogado (Ley 2277/2022 art. 96).'),
  procedimiento: z
    .array(z.string().min(1))
    .describe('Pasos del procedimiento de capitalización en orden cronológico.'),
});
export type CapitalizacionAnalysisJson = z.infer<typeof CapitalizacionAnalysisSchema>;

export const RiesgoLegalSchema = z.object({
  descripcion: z
    .string()
    .min(1)
    .describe('Descripción concisa del riesgo legal identificado.'),
  normaAplicable: NormaRef.describe('Norma aplicable que rige el riesgo.'),
  consecuenciaPotencial: z
    .string()
    .min(1)
    .describe('Consecuencia potencial: sanción, nulidad, multa, etc.'),
  probabilidad: z
    .enum(['alta', 'media', 'baja'])
    .describe('Probabilidad de materialización del riesgo.'),
});
export type RiesgoLegalJson = z.infer<typeof RiesgoLegalSchema>;

export const LegalAuditOpinionTypeEnum = z.enum([
  'sin_observaciones',
  'con_observaciones_subsanables',
  'con_hallazgos_inmediatos',
]);
export type LegalAuditOpinionTypeJson = z.infer<typeof LegalAuditOpinionTypeEnum>;

export const LegalAuditOpinionSchema = z.object({
  type: LegalAuditOpinionTypeEnum.describe(
    'Tipo de opinión legal: sin_observaciones / con_observaciones_subsanables / con_hallazgos_inmediatos',
  ),
  text: z
    .string()
    .min(1)
    .describe('Texto de la opinión legal redactada con tono formal.'),
});
export type LegalAuditOpinionJson = z.infer<typeof LegalAuditOpinionSchema>;

export const LegalRequiredActionSchema = z.object({
  action: z
    .string()
    .min(1)
    .describe('Acción correctiva específica a ejecutar.'),
  priority: z
    .enum(['alta', 'media', 'baja'])
    .describe('Prioridad de la acción.'),
  reference: NormaRef.describe('Referencia normativa que motiva la acción.'),
  plazo: z
    .string()
    .nullable()
    .describe('Plazo aplicable según norma. Null si no hay plazo legal explícito.'),
});
export type LegalRequiredActionJson = z.infer<typeof LegalRequiredActionSchema>;

export const LegalAuditReportSchema = z.object({
  complianceScore: ComplianceScore,
  executiveSummary: z
    .string()
    .min(1)
    .describe('Resumen ejecutivo con hallazgos legales principales'),
  findings: z.array(AuditFindingSchema).describe('Lista de hallazgos legales/societarios'),
  /**
   * v2.1 Dictamen 3 — Lista canónica de 14 obligaciones societarias en orden
   * fijo (ver header del archivo). Cuando se emite DEBE incluir las 14;
   * status='no_aplica' si la obligación no aplica al tipo societario.
   * Null para fallback al formato legacy.
   */
  societaryObligations: z
    .array(SocietaryObligationSchema)
    .nullable()
    .describe('Tabla canónica de 14 obligaciones societarias (orden fijo del spec v2.1).'),
  patrimonyDistribution: PatrimonyDistributionSchema
    .nullable()
    .describe('Análisis de distribución del patrimonio (Art. 155-156 / 451-452 C.Co.).'),
  capitalizacionAnalysis: CapitalizacionAnalysisSchema
    .nullable()
    .describe('Análisis de capitalización de utilidades. Null si no se propone.'),
  riesgosLegales: z
    .array(RiesgoLegalSchema)
    .nullable()
    .describe('Lista de riesgos legales identificados. Null si no aplica.'),
  auditOpinion: LegalAuditOpinionSchema
    .nullable()
    .describe('Opinión formal del Auditor Legal (Dictamen 3 v2.1).'),
  requiredActions: z
    .array(LegalRequiredActionSchema)
    .nullable()
    .describe('Acciones requeridas con prioridad y plazo. Null si no hay acciones pendientes.'),
  conclusion: z
    .string()
    .min(1)
    .describe('Parrafo final sobre la solidez juridica de los documentos'),
});
export type LegalAuditReportJson = z.infer<typeof LegalAuditReportSchema>;

// ---------------------------------------------------------------------------
// Fiscal Reviewer — agrega opinionType + materialidad + going concern
// ---------------------------------------------------------------------------

export const FiscalReviewMaterialitySchema = z.object({
  benchmarkLabel: z
    .string()
    .min(1)
    .describe('Etiqueta del benchmark usado. Ej: "5% utilidad antes de impuestos", "1% ingresos"'),
  materialityAmountCop: MoneyCop.describe('Materialidad calculada en centavos COP'),
  performanceMateriality: MoneyCop.describe('Materialidad de ejecucion (50-75% de la materialidad)'),
  comment: z
    .string()
    .min(1)
    .describe('Comentario de 1-2 frases sobre la suficiencia de la materialidad establecida'),
});
export type FiscalReviewMaterialityJson = z.infer<typeof FiscalReviewMaterialitySchema>;

export const FiscalReviewGoingConcernSchema = z.object({
  hasMaterialUncertainty: z
    .boolean()
    .describe('True solo si subsiste incertidumbre material tras evaluar los planes de la administracion (NIA 570 par. 16-18); los indicadores por si solos no la constituyen'),
  indicatorsFound: z
    .array(z.string())
    .describe('Indicadores observados (financieros, operacionales, legales). Vacio si no hay duda.'),
  conclusion: z
    .string()
    .min(1)
    .describe('Conclusion clara sobre el supuesto de empresa en funcionamiento (NIA 570)'),
});
export type FiscalReviewGoingConcernJson = z.infer<typeof FiscalReviewGoingConcernSchema>;

// ---------------------------------------------------------------------------
// Fiscal Reviewer — v2.1 Dictamen 4 (Wave 7.B2)
// ---------------------------------------------------------------------------
// El cuarto auditor del topology 1+1 cumple DOS roles complementarios:
//
//   1) Revisor Fiscal NIA-700/706 (Ley 43/1990) — emite materiality,
//      goingConcern, opinionType y dictamen formal con bloque de firma. Esto
//      EXISTIA antes de Wave 7 y se MANTIENE intacto.
//
//   2) Auditor Fiscal DIAN (v2.1 Dictamen 4 — Wave 7.B2) — emite las 10
//      obligaciones formales, saldos criticos, 6 indicadores de riesgo DIAN,
//      riesgo global de fiscalizacion, obligaciones 2026 (anticipo renta /
//      ICA) y un opinion DIAN-specific (riesgo bajo/medio/alto) +
//      fiscalRequiredActions.
//
// Los dos roles COEXISTEN en el mismo schema porque el spec v2.1 mantiene la
// topologia de 4 auditores. El render produce primero el bloque "Dictamen 4
// — Auditor Fiscal" v2.1 (cuando los campos estan poblados) y al final el
// dictamen NIA-700 con bloque de firma literal (legacy preservado).
//
// Las 10 obligaciones formales canonicas (orden fijo):
//   1.  Declaracion renta y complementarios
//   2.  Declaracion IVA
//   3.  Declaracion ICA (segun municipio)
//   4.  Retencion en la fuente — renta
//   5.  Retencion en la fuente — IVA (ReteIVA)
//   6.  Retencion en la fuente — ICA (ReteICA)
//   7.  Informacion exogena
//   8.  Aportes a parafiscales y seguridad social
//   9.  Formato 2516 (Conciliacion contable-fiscal)
//   10. Formato 1125 / Precios de transferencia (si aplica)
//
// Los 6 indicadores de riesgo DIAN canonicos (orden fijo):
//   1.  Margen neto vs sector CIIU (2σ banda sectorial)
//   2.  Crecimiento ingresos vs sector
//   3.  Variacion de proveedores anormal
//   4.  Saldo retenciones a favor (Cta. 1355) creciente
//   5.  Cumplimiento Formato 2516 / Conciliacion fiscal
//   6.  Cumplimiento Beneficiario Final — RUB DIAN (Art. 631-6 E.T., mod. Ley
//       2155/2021; el registro lo administra la DIAN, no la UIAF)
//
// Auditoría 2026-09 (auditoria-calidad-23): esos 6 indicadores no eran los
// del spec v2.1 Parte IV Dictamen 4 §4 y exigían bandas sectoriales no
// disponibles. El adapter reemplaza el arreglo por los 6 del spec calculados
// en código desde el preprocesador (margen neto vs sector CIIU, costo de
// ventas < 1% de ingresos, brecha impuesto contable vs tasa nominal,
// variación de ingresos > 40%, proveedores > 90% del pasivo, efectivo > 50%
// del activo) y deriva nivel global y opinión con UNA regla determinista.
// ---------------------------------------------------------------------------

export const FormalObligationStatusEnum = z.enum([
  'al_dia',
  'verificar',
  'posible_mora',
  'no_aplica',
]);
export type FormalObligationStatusJson = z.infer<typeof FormalObligationStatusEnum>;

export const FormalObligationPeriodicidadEnum = z.enum([
  'mensual',
  'bimestral',
  'cuatrimestral',
  'anual',
  'eventual',
]);
export type FormalObligationPeriodicidadJson = z.infer<typeof FormalObligationPeriodicidadEnum>;

export const FormalObligationSchema = z.object({
  obligation: z
    .string()
    .min(1)
    .describe('Nombre de la obligacion DIAN. Ej: "Declaracion renta y complementarios"'),
  periodicidad: FormalObligationPeriodicidadEnum.describe('Periodicidad de la obligacion'),
  vencimientoProximo: z
    .string()
    .nullable()
    .describe('Fecha del proximo vencimiento o "Calendario DIAN NIT [X]" si no se puede precisar.'),
  status: FormalObligationStatusEnum.describe('Estado de la obligacion'),
  reference: NormaRef.describe('Referencia normativa exacta. Ej: "Art. 7 E.T."'),
});
export type FormalObligationJson = z.infer<typeof FormalObligationSchema>;

export const CriticalSaldosSchema = z.object({
  retenciones2365Cop: MoneyCop
    .nullable()
    .describe('Saldo retenciones a favor de terceros (Cta. 2365) en centavos COP.'),
  retenciones1355Cop: MoneyCop
    .nullable()
    .describe('Saldo retenciones y anticipos (Cta. 1355) en centavos COP.'),
  ivaPorPagarNetoCop: MoneyCop
    .nullable()
    .describe('IVA por pagar neto (Cta. 2408 - Cta. 1355 IVA) en centavos COP.'),
  anticipoRentaSiguienteCop: MoneyCop
    .nullable()
    .describe('Anticipo renta del siguiente periodo (Art. 807 E.T.). Null salvo impuesto neto de renta, retenciones del ano y anos declarando verificados.'),
  sancionPotencialMoraCop: MoneyCop
    .nullable()
    .describe('Sancion potencial por EXTEMPORANEIDAD (Art. 641 E.T.) en centavos COP; null sin evidencia de presentacion extemporanea. La mora en el pago genera intereses (Arts. 634-635 E.T.), no esta sancion.'),
});
export type CriticalSaldosJson = z.infer<typeof CriticalSaldosSchema>;

export const DianRiskLevelEnum = z.enum(['bajo', 'medio', 'alto', 'no_determinable']);
export type DianRiskLevelJson = z.infer<typeof DianRiskLevelEnum>;

export const DianRiskIndicatorSchema = z.object({
  indicator: z
    .string()
    .min(1)
    .describe('Nombre del indicador. Ej: "Margen neto > 70% del sector CIIU"'),
  level: DianRiskLevelEnum.describe('Nivel de riesgo del indicador.'),
  observation: z
    .string()
    .nullable()
    .describe('Observacion contextual del indicador. Null si no aplica.'),
});
export type DianRiskIndicatorJson = z.infer<typeof DianRiskIndicatorSchema>;

export const Obligations2026Schema = z.object({
  anticipoRenta2026Cop: MoneyCop
    .nullable()
    .describe('Anticipo de renta (Art. 807 E.T.) = max(0, porcentaje x impuesto neto de renta (o promedio de los dos ultimos anos) - retenciones del ano); porcentaje 25/50/75 segun anos declarando. Null si falta cualquier insumo verificado.'),
  baseAnticipo: z
    .string()
    .min(1)
    .describe('Base y motivo del anticipo. Si es null, explicar que insumo del Art. 807 E.T. falta.'),
  icaEstimado2026Cop: MoneyCop
    .nullable()
    .describe('ICA estimado 2026 en centavos COP. Null si no aplica.'),
  baseIca: z
    .string()
    .nullable()
    .describe('Base de calculo del ICA. Ej: "ingresos brutos por actividad, [X] por mil"'),
});
export type Obligations2026Json = z.infer<typeof Obligations2026Schema>;

export const FiscalAuditOpinionTypeEnum = z.enum([
  'riesgo_bajo',
  'riesgo_medio',
  'riesgo_alto',
  'riesgo_no_determinable',
]);
export type FiscalAuditOpinionTypeJson = z.infer<typeof FiscalAuditOpinionTypeEnum>;

export const FiscalAuditOpinionSchema = z.object({
  type: FiscalAuditOpinionTypeEnum.describe('Nivel de riesgo de fiscalizacion DIAN.'),
  text: z
    .string()
    .min(1)
    .describe('Texto formal de la opinion del Auditor Fiscal (riesgo DIAN).'),
});
export type FiscalAuditOpinionJson = z.infer<typeof FiscalAuditOpinionSchema>;

export const FiscalRequiredActionSchema = z.object({
  action: z
    .string()
    .min(1)
    .describe('Accion correctiva especifica.'),
  reference: NormaRef.describe('Referencia normativa. Ej: "Art. 641 E.T."'),
  fechaLimite: z
    .string()
    .nullable()
    .describe('Fecha limite o "Calendario DIAN" placeholder. Null si no hay plazo legal.'),
  consecuenciaIncumplimiento: z
    .string()
    .min(1)
    .describe('Consecuencia DIAN si no se ejecuta: sancion, intereses, etc.'),
});
export type FiscalRequiredActionJson = z.infer<typeof FiscalRequiredActionSchema>;

/**
 * Hallazgo del Revisor Fiscal con las marcas que exige la NIA 705 para
 * modificar la opinión: una opinión desfavorable (adversa) requiere
 * incorrecciones materiales Y generalizadas; la abstención, una limitación
 * al alcance con efectos posibles generalizados (auditoria-calidad-12).
 */
export const FiscalReviewFindingSchema = AuditFindingSchema.extend({
  pervasive: z
    .boolean()
    .nullable()
    .describe('True si los efectos del hallazgo son materiales Y generalizados (NIA 705 par. 5). Null si no aplica.'),
  scopeLimitation: z
    .boolean()
    .nullable()
    .describe('True si el hallazgo es una imposibilidad de obtener evidencia suficiente (limitacion al alcance, NIA 705 par. 9). Null si no aplica.'),
});
export type FiscalReviewFindingJson = z.infer<typeof FiscalReviewFindingSchema>;

export const FiscalReviewReportSchema = z.object({
  complianceScore: ComplianceScore,
  executiveSummary: z
    .string()
    .min(1)
    .describe('Evaluacion general de razonabilidad de los EEFF (2-3 parrafos)'),
  materiality: FiscalReviewMaterialitySchema,
  goingConcern: FiscalReviewGoingConcernSchema,
  findings: z.array(FiscalReviewFindingSchema).describe('Hallazgos de aseguramiento (NIA/ISA + Ley 43/1990)'),
  opinionType: AuditOpinionTypeEnum.describe('Tipo de opinion conforme a NIA 700-706'),
  dictamen: z
    .string()
    .min(1)
    .describe('Dictamen formal del Revisor Fiscal con bloque de firma literal al cierre'),
  /**
   * v2.1 Dictamen 4 — Auditor Fiscal DIAN. Las 10 obligaciones formales en
   * orden fijo (ver header del archivo). Null para fallback legacy.
   */
  formalObligations: z
    .array(FormalObligationSchema)
    .nullable()
    .describe('Tabla canonica de 10 obligaciones formales DIAN (orden fijo del spec v2.1).'),
  criticalSaldos: CriticalSaldosSchema
    .nullable()
    .describe('Saldos criticos relacionados con obligaciones DIAN.'),
  dianRiskIndicators: z
    .array(DianRiskIndicatorSchema)
    .nullable()
    .describe('6 indicadores canonicos de riesgo DIAN (orden fijo del spec v2.1).'),
  riesgoFiscalizacionGlobal: DianRiskLevelEnum
    .nullable()
    .describe('Nivel global de riesgo de fiscalizacion DIAN.'),
  obligations2026: Obligations2026Schema
    .nullable()
    .describe('Obligaciones del siguiente periodo (anticipo renta, ICA).'),
  fiscalAuditOpinion: FiscalAuditOpinionSchema
    .nullable()
    .describe('Opinion formal del Auditor Fiscal (v2.1 Dictamen 4 — riesgo DIAN).'),
  fiscalRequiredActions: z
    .array(FiscalRequiredActionSchema)
    .nullable()
    .describe('Acciones requeridas DIAN con plazo y consecuencia.'),
});
export type FiscalReviewReportJson = z.infer<typeof FiscalReviewReportSchema>;
