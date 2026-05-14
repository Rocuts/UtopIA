// ---------------------------------------------------------------------------
// Contrato del Agente Editor Jefe HTML (cap-stone visual del pipeline 1+1)
// ---------------------------------------------------------------------------
//
// Último agente del pipeline 1+1 v10.1. Recibe los 3 JSONs consolidados de los
// agentes anteriores (NIIF Analyst chunked → Strategy Director → Governance
// Specialist) más un bloque de metadata pre-cocinada (hash determinístico,
// cobertura por clase PUC, niveles de confianza global, conteos de alertas,
// datos editoriales de la entidad) y produce un HTML autocontenido de 15
// páginas A4 portrait siguiendo `docs/spec/financial-report-v10.1.md` verbatim
// como instrucción de sistema.
//
// Diferencia respecto a los 3 agentes anteriores: NO usa `experimental_output:
// Output.object({ schema })` porque el output es HTML, no JSON. Por eso este
// contrato sólo valida el INPUT con Zod; el OUTPUT (`HtmlEditorOutput.html`) es
// un string libre que el agente acompaña con `checklistFailures[]` derivado
// del linter post-emisión.
//
// Refs:
//   - docs/spec/financial-report-v10.1.md §10 (comentarios HTML obligatorios)
//   - docs/spec/financial-report-v10.1.md §11 (checklist de emisión completo)
//   - docs/spec/financial-report-v10.1.md §13 (plantilla maestra verbatim)
//   - docs/spec/financial-report-v10.1.md §5 Página 14 (hash + cobertura)
// ---------------------------------------------------------------------------

import { z } from 'zod';
import {
  CompanyInfoSchema,
  ConfidenceLevelSchema,
  ReportModeSchema,
} from './base';
import { NiifReportSchema } from './niif-report';
import { StrategyReportSchema } from './strategy-report';
import { GovernanceReportSchema } from './governance-report';

// ---------------------------------------------------------------------------
// Confidence bucket — desglose porcentual high/medium/low (v10.1 Página 14)
// ---------------------------------------------------------------------------
//
// El bloque "Confianza global" del Slide 12 (v8.1) / Página 14 (v10.1) reporta
// "Alta: X% · Media: Y% · Baja: Z%" derivado del agregado de niveles de
// confianza por línea/cifra emitidos por los 3 agentes anteriores. El cálculo
// es determinístico (`computeConfidenceBucket` en `src/lib/preprocessing/
// v8-helpers.ts`) y se pasa al Editor Jefe como entrada vinculante.

export const ConfidenceBucketSchema = z.object({
  highPct: z.number().min(0).max(100),
  mediumPct: z.number().min(0).max(100),
  lowPct: z.number().min(0).max(100),
});
export type ConfidenceBucket = z.infer<typeof ConfidenceBucketSchema>;

// ---------------------------------------------------------------------------
// Cobertura por clase PUC (v10.1 Página 14)
// ---------------------------------------------------------------------------
//
// Espejo Zod del `CoverageByClass` que ya emite `summarizeCoverage()` en
// `src/lib/preprocessing/v8-helpers.ts`. Lo replicamos aquí como schema Zod
// para que el input al endpoint `/api/financial-report/html` se pueda validar
// end-to-end y no aceptar payloads malformados — el helper determinístico
// produce el tipo, este schema lo valida estructuralmente.
//
// `classCode` enumera las clases reportables en la tabla de trazabilidad de la
// Página 14 (PUC 1..9 + el caso especial '25' para pasivos laborales). El
// renderer del Editor Jefe HTML itera sobre esta lista y emite la línea
// "Cobertura Clase X: Y%".

export const CoverageByClassSchema = z.object({
  classCode: z.enum(['1', '2', '3', '4', '5', '6', '7', '8', '9', '25']),
  auxiliariesCount: z.number().int().min(0),
  totalSaldoCop: z.string(),
  percentOfFolio: z.string(),
});
export type CoverageByClass = z.infer<typeof CoverageByClassSchema>;

// ---------------------------------------------------------------------------
// Metadata pre-cocinada (entrada al Editor Jefe)
// ---------------------------------------------------------------------------
//
// El Editor Jefe HTML NO recalcula ningún metadato — los recibe vinculantes
// del orchestrator. Hash, cobertura y confianza global son outputs de helpers
// determinísticos (`computeReportHash`, `summarizeCoverage`,
// `computeConfidenceBucket`) que se ejecutan ANTES de invocar al LLM.
//
// Why: la "Transparencia sobre la generación" (§1.8 spec) exige que el hash
// del documento sea verificable e idéntico entre runs con el mismo input. Si
// el LLM lo recalculara, divergiría — por eso se inyecta como input fijo.
//
// `agentVersion: z.literal('1+1 v10.1')` — la spec v10.1 declara textualmente
// el comentario HTML `<!-- AGENT_VERSION: 1+1 v10.1 -->`. Cualquier futuro
// bump de versión debe tocar este literal + la spec en simultáneo.
//
// Campos editoriales (entityCity / entityType / entityLaw / entityGroup):
// la portada y el TOC de v10.1 emiten líneas tabulares "Domicilio: Cali ·
// SAS Ley 1258/2008" y "Marco técnico: NIIF para Pymes · Decreto 2420/2015 ·
// Grupo 2". El orchestrator los inyecta desde `CompanyInfo` (no del LLM).

export const HtmlEditorMetadataSchema = z.object({
  reportMode: ReportModeSchema,
  entityNit: z.string().min(1),
  entityName: z.string().min(1),
  /** Ciudad de domicilio — ej. "Cali". Renderiza en portada + Página 02 footer. */
  entityCity: z.string().min(1),
  /** Tipo societario — ej. "SAS", "SA", "Ltda". Renderiza en portada. */
  entityType: z.string().min(1),
  /** Ley constitutiva — ej. "Ley 1258/2008" (SAS). Renderiza en portada + cierre. */
  entityLaw: z.string().min(1),
  /** Grupo NIIF — ej. "Grupo 2" (NIIF para Pymes) / "Grupo 1" (NIIF plenas). */
  entityGroup: z.string().min(1),
  /** YYYY-MM-DD del inicio del período cubierto. */
  periodStart: z.string().min(1),
  /** YYYY-MM-DD del cierre del período. */
  periodEnd: z.string().min(1),
  /**
   * Año del período (4 dígitos) — héroe tipográfico de la portada a 80pt.
   * Derivable de periodEnd pero pre-cocinado para evitar parseo en el LLM.
   */
  periodYear: z.string().regex(/^\d{4}$/),
  /** ISO 8601 del momento exacto de generación del reporte. */
  generatedAt: z.string().min(1),
  /** ISO 8601 del momento de extracción del balance del ERP/CSV. */
  extractedAt: z.string().min(1),
  /**
   * Fecha de emisión human-readable — ej. "13 de mayo de 2026". Renderiza
   * en la tabla de metadatos de portada y en el bloque de firma del cierre.
   */
  issuedAtHuman: z.string().min(1),
  /** Model ID en uso (MODEL_IDS.FINANCIAL_PIPELINE). Va al bloque "Generación". */
  modelId: z.string().min(1),
  agentVersion: z.literal('1+1 v10.1'),
  /** Confianza global (echo de spec §1.5). Renderer toma highPct para CONFIDENCE_GLOBAL. */
  globalConfidence: ConfidenceBucketSchema,
  /** Conteo agregado de alertas técnicas por severidad — emitidas en HTML comments §10. */
  alertsCounts: z.object({
    high: z.number().int().min(0),
    medium: z.number().int().min(0),
    low: z.number().int().min(0),
  }),
  /** Total de auxiliares procesados en el periodo primario. */
  auxiliariesProcessed: z.number().int().min(0),
  /** Lista de cobertura por clase PUC (output de `summarizeCoverage()`). */
  coverageByClass: z.array(CoverageByClassSchema),
  /** Código CIIU principal — usado para anclar bandas sectoriales en Slide 03. */
  sectorCIIU: z.string().nullable(),
  /** Hash SHA-256 hex (64 chars) — output de `computeReportHash()`. */
  reportHashSha256: z.string().length(64),
});
export type HtmlEditorMetadata = z.infer<typeof HtmlEditorMetadataSchema>;

// ---------------------------------------------------------------------------
// Input al endpoint /api/financial-report/html
// ---------------------------------------------------------------------------
//
// El cliente envía:
//   - `niifReport`     : JSON estructurado del NIIF Analyst (chunked assembled)
//   - `strategyReport` : JSON estructurado del Strategy Director
//   - `governanceReport`: JSON estructurado del Governance Specialist
//   - `company`        : echo de CompanyInfo (lo replica el endpoint padre)
//   - `metadata`       : bloque pre-cocinado de hash/cobertura/confianza/etc.
//   - `language`       : 'es' (default) | 'en' — el prompt soporta ambos.
//
// La validación Zod garantiza que ningún campo crítico viaja como `undefined`
// hacia el prompt — el modelo no puede inventar lo que no recibe.

export const HtmlEditorInputSchema = z.object({
  niifReport: NiifReportSchema,
  strategyReport: StrategyReportSchema,
  governanceReport: GovernanceReportSchema,
  company: CompanyInfoSchema,
  metadata: HtmlEditorMetadataSchema,
  language: z.enum(['es', 'en']).default('es'),
});
export type HtmlEditorInput = z.infer<typeof HtmlEditorInputSchema>;

// ---------------------------------------------------------------------------
// Output runtime — HTML string + checklist failures (linter post-emisión)
// ---------------------------------------------------------------------------
//
// Why NO valida con Zod: el output es HTML5 (~32-48K tokens en v10.1 — 15
// páginas A4 vs 12 slides 16:9 en v8.1) y validarlo con Zod no aporta — el
// contrato es estructural (DOCTYPE, comentarios, hash) y se verifica con el
// linter en `agents/html-editor.ts:lightweightChecklist` + el validador
// profundo en `agents/html-editor-validator.ts` (parser DOM con linkedom).
//
// `checklistFailures.severity`:
//   - `'block'` : el HTML NO debe servirse como-es. F8 puede mostrar un toast
//                 de error en la UI y ofrecer "Regenerar".
//   - `'warn'`  : el HTML es servible pero tiene un issue cosmético/menor.
//                 F8 puede mostrarlo como advertencia inline.

export interface HtmlEditorOutput {
  /** HTML5 auto-contenido emitido por el agente (~32-48K tokens en v10.1). */
  html: string;
  /** Echo de la metadata recibida — útil para el caller que persiste reportes. */
  metadata: HtmlEditorMetadata;
  /** Fallos del linter §10 + §1.6 + §11. Vacío si el HTML pasa todos los checks. */
  checklistFailures: Array<{
    rule: string;
    detail: string;
    severity: 'block' | 'warn';
  }>;
}
