// types.ts — Editorial Report IR (canonical intermediate representation)
// ───────────────────────────────────────────────────────────────────────────
// El composer (compose.ts, Bucket C) traduce el output de los 3 agentes
// (NIIF Analyst → Strategy Director → Governance Specialist) a este IR.
// Las páginas (Bucket B) reciben este IR y lo renderizan vía React-PDF.
// Las primitivas (Bucket A) consumen los hex/sub-shapes desde aquí.
// ───────────────────────────────────────────────────────────────────────────

export type AreaKey = 'escudo' | 'valor' | 'verdad' | 'futuro';

export type WatermarkKind = 'BORRADOR' | 'BLOQUEADO';

export interface NormCitation {
  /** Texto del chip ("NIIF Secc. 17", "Art. 240 ET", "Decreto 2420/2015"). */
  label: string;
  /** Link opcional (Suin Juriscol, IFRS.org). React-PDF rinde como Link. */
  href?: string;
}

export interface PortraitSpec {
  kind: 'initials' | 'image';
  /** "JR", "VE" — usado cuando kind === 'initials'. */
  initials?: string;
  /** URL pública o data URI — usado cuando kind === 'image'. */
  imageUrl?: string;
  /** Determina el gradient de fondo (escudo bordeaux, valor gold, etc.). */
  areaAccent: AreaKey;
}

export interface KpiCell {
  label: string;
  /** Cifra ya formateada en COP ($1.234.567,89) o ratio (12,3%). */
  value: string;
  unit?: string;
  /** Variación porcentual vs comparativo (firmada). */
  deltaPct?: number;
  status?: 'positive' | 'warning' | 'critical' | 'neutral';
}

export interface WaterfallItem {
  label: string;
  /** Importe en COP. Para 'pos': ingresos/utilidades. Para 'neg': gastos/costos/impuestos. Para 'total': cierre acumulado. */
  amount: number;
  sign: 'pos' | 'neg' | 'total';
}

export interface DialGaugeSpec {
  label: string;
  value: number;
  min: number;
  max: number;
  /** [low, mid, high] — define las 3 zonas de color del arco. */
  thresholds: [number, number, number];
  areaAccent: AreaKey;
  /** Texto opcional debajo del gauge ("Ratio óptimo ≥ 1,5"). */
  caption?: string;
}

export interface PillarSatellite {
  id: AreaKey;
  label: string;
  score: number;
  /** KPI estrella del pilar (texto corto: "Autonomía 47 días", "EBITDA $812M"). */
  topKpi: string;
  areaAccent: AreaKey;
}

export interface PillarsSpec {
  /** Score global agregado (0-100). */
  overall: number;
  satellites: [PillarSatellite, PillarSatellite, PillarSatellite, PillarSatellite];
}

export interface ParsedTableRow {
  /** Cuenta o concepto (primera columna). */
  account: string;
  /** Resto de columnas en el mismo orden del header. */
  cells: string[];
  /** Marca filas de subtotal/total para estilizar. */
  emphasis?: 'subtotal' | 'total';
}

export interface ParsedTable {
  caption?: string;
  /** Encabezados de columna (primera = "Cuenta", restantes = periodos / variaciones). */
  headers: string[];
  rows: ParsedTableRow[];
}

export interface FinancialStatementsSpec {
  balance: ParsedTable;
  income: ParsedTable;
  cashFlow: ParsedTable;
  equity: ParsedTable;
}

export interface NoteBlock {
  heading: string;
  /** Markdown ya filtrado (sin code blocks, sin HTML). */
  bodyMarkdown: string;
  citations: NormCitation[];
}

/**
 * Análisis de punto de equilibrio operativo. Markdown limpio producido por
 * el Director de Estrategia (`report.strategicAnalysis.breakEvenAnalysis`).
 * Renderizado por `BreakEvenPage`. Si vacío, la página se omite.
 */
export interface BreakEvenSpec {
  bodyMarkdown: string;
  citations: NormCitation[];
}

/**
 * Proyección de flujo de caja a 12 meses. Markdown del Director de Estrategia
 * (`report.strategicAnalysis.projectedCashFlow`). Renderizado por
 * `ProjectedCashFlowPage`. Si vacío, la página se omite.
 */
export interface ProjectedCashFlowSpec {
  bodyMarkdown: string;
  citations: NormCitation[];
}

/**
 * Borrador del acta de asamblea (aprobación de EEFF, Art. 187 Ley 222/1995).
 * Markdown del Especialista de Gobierno (`report.governance.shareholderMinutes`).
 * Renderizado por `ShareholderMinutesPage`. Si vacío, la página se omite.
 */
export interface ShareholderMinutesSpec {
  bodyMarkdown: string;
  citations: NormCitation[];
}

export interface RecommendationItem {
  title: string;
  bodyMarkdown: string;
  areaAccent: AreaKey;
}

export interface AdjustmentRow {
  cuenta: string;
  descripcion: string;
  /** En COP. Positivo = cargo, negativo = abono. */
  ajuste: number;
  norma?: string;
}

export interface ReportMeta {
  companyName: string;
  nit: string;
  entityType?: string;
  fiscalPeriod: string;
  comparativePeriod?: string;
  generatedAt: string;
  language: 'es' | 'en';
  /** Si presente, modifica el CoverPage (BORRADOR amarillo, BLOQUEADO bordeaux). */
  watermark?: WatermarkKind;
  /**
   * Subtitulo del watermark — se renderiza debajo del titulo en CoverPage cuando
   * existe. Casos canonicos:
   *  - 'COMPARATIVOS IMPRACTICABLES' (NIC 1 par. 38): los datos no permiten
   *    presentar info comparativa fiable; el dictamen se emite con borrador.
   *  - 'PROVISIONAL' / 'DRAFT': borrador a la espera de validacion humana.
   * El compose.ts lo emite junto con `watermark` segun los disparadores.
   */
  watermarkSubtitle?: string;
}

export interface CoverSpec {
  title: string;
  subtitle: string;
  accentArea: AreaKey;
}

export interface TocEntry {
  label: string;
  page: number;
  /** TEMA N: ... va uppercase, secciones de front-matter no. */
  uppercase: boolean;
}

export interface TocSpec {
  entries: TocEntry[];
}

export interface DirectorLetterSpec {
  portrait: PortraitSpec;
  /** Markdown ya filtrado. */
  bodyMarkdown: string;
  citations: NormCitation[];
  /** Nombre del firmante ("Vanessa Espinal", "Equipo UtopIA"). */
  signerName: string;
  signerRole: string;
}

export interface KpiGridSpec {
  /** Máx 12 KPIs (4×3). */
  kpis: KpiCell[];
}

export interface AppendixSpec {
  adjustmentsTable?: AdjustmentRow[];
  validationWarnings?: string[];
  /** Bloque mono completo de control totals (transparency artifact). */
  bindingTotalsBlock?: string;
}

/**
 * Bloque de firma renderizado por `renderSignatureBlock()` en formato
 * Ley 43/1990. Se inyecta en el PDF al cierre del dictamen y de la
 * certificacion del contador. Si null → placeholders con lineas
 * "__________________________________".
 */
export interface SignatureBlockSpec {
  /** Texto pre-renderizado por renderSignatureBlock — multilinea. */
  rendered: string;
}

/**
 * Parrafo de Enfasis NIA 706 §A1 — encabezado bold + cuerpo + cierre literal
 * "Nuestra opinion no se modifica respecto a esta cuestion". Se posiciona
 * post-opinion y antes de "Otras responsabilidades / Cuestiones".
 */
export interface EmphasisParagraphSpec {
  /** Titulo en negrita ("Parrafo de Enfasis", "Parrafo de Otras Cuestiones"). */
  heading: string;
  /** Cuerpo (Markdown limpio, sin tablas ni HTML). */
  bodyMarkdown: string;
}

// ───────────────────────────────────────────────────────────────────────────
// EditorialReport — IR canónico que recibe EditorialReportDoc.
// ───────────────────────────────────────────────────────────────────────────
export interface EditorialReport {
  meta: ReportMeta;
  cover: CoverSpec;
  toc: TocSpec;
  directorLetter: DirectorLetterSpec;
  kpiGrid: KpiGridSpec;
  waterfall: { items: WaterfallItem[] };
  dialGauges: { gauges: DialGaugeSpec[] };
  /** Opcional — si pillars del orchestrator no se calculan, OrbitalPillarsPage se omite. */
  pillars?: PillarsSpec;
  statements: FinancialStatementsSpec;
  /** Punto de equilibrio (opcional — página se omite si bodyMarkdown vacío). */
  breakEven?: BreakEvenSpec;
  /** Flujo de caja proyectado 12m (opcional — página se omite si vacío). */
  projectedCashFlow?: ProjectedCashFlowSpec;
  notes: { blocks: NoteBlock[] };
  recommendations: { items: RecommendationItem[] };
  /** Acta de asamblea / minutas (opcional — página se omite si vacía). */
  shareholderMinutes?: ShareholderMinutesSpec;
  appendix: AppendixSpec;
  /**
   * Firmas dinamicas (Representante Legal, Revisor Fiscal, Contador Publico).
   * Si null/undefined → ClosingPage / DirectorLetter usan placeholders.
   */
  signatureBlock?: SignatureBlockSpec;
  /**
   * Parrafos de Enfasis NIA 706 §A1 / Otras Cuestiones NIA 706 §8-9.
   * Se renderizan post-opinion en la pagina del dictamen / closing.
   */
  emphasisParagraphs?: EmphasisParagraphSpec[];
}

/** Estado del gate "informe no emitible" (extensible cuando audit-report-emittable aterrice). */
export interface EmittableGate {
  ok: boolean;
  blockers: string[];
}
