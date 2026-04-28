/**
 * Tipos UI-locales del modulo Contabilidad Pyme.
 *
 * Estos tipos espejan el shape JSON que devuelven las rutas `/api/pyme/*`
 * (ver spec PYME_MODULE_SPEC.md §2 AGENT-DB y AGENT-ORCHESTRATOR). NO
 * importan nada de `@/lib/db/*` ni `@/lib/agents/pyme/*` para preservar
 * el aislamiento del bundle cliente.
 *
 * Convencion: las fechas y timestamps llegan serializados como strings
 * ISO-8601 desde la API (Drizzle.serialize). Los numericos llegan como
 * `number` (Postgres `numeric` viene como string en la wire pero las
 * rutas API ya hacen `Number(...)` antes de devolver).
 */

export type PymeEntryKind = 'ingreso' | 'egreso';
export type PymeEntryStatus = 'draft' | 'confirmed';
export type PymeOcrStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface PymeBook {
  id: string;
  workspaceId: string;
  name: string;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

export interface PymeEntry {
  id: string;
  bookId: string;
  uploadId: string | null;
  entryDate: string;
  description: string;
  kind: PymeEntryKind;
  amount: number;
  category: string | null;
  pucHint: string | null;
  sourceImageUrl: string | null;
  sourcePage: number | null;
  rawOcrText: string | null;
  confidence: number | null;
  status: PymeEntryStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PymeUpload {
  id: string;
  bookId: string;
  imageUrl: string;
  mimeType: string;
  pageCount: number;
  ocrStatus: PymeOcrStatus;
  errorMessage: string | null;
  createdAt: string;
}

export interface MonthlySummaryTotals {
  ingresos: number;
  egresos: number;
  margen: number;
  margenPct: number;
}

export interface MonthlyCategoryBreakdown {
  category: string;
  amount: number;
}

export interface MonthlyPreviousTotals {
  ingresos: number;
  egresos: number;
  margen: number;
}

export interface MonthlySummary {
  bookId: string;
  year: number;
  month: number;
  totals: MonthlySummaryTotals;
  topIngresoCategories: MonthlyCategoryBreakdown[];
  topEgresoCategories: MonthlyCategoryBreakdown[];
  previous: MonthlyPreviousTotals | null;
  entryCount: number;
}

export interface MonthlyAlert {
  severity: 'info' | 'warning' | 'critical';
  message: string;
}

export interface MonthlyReportPayload {
  bookId: string;
  year: number;
  month: number;
  summary: MonthlySummary;
  narrative: string;
  alerts: MonthlyAlert[];
  generatedAt: string;
}

/** Persisted report row returned by /api/pyme/reports/monthly POST. */
export interface PymePersistedReport {
  id: string;
  workspaceId: string;
  kind: string;
  title: string;
  data: MonthlyReportPayload;
  createdAt: string;
}

// ─── API response envelopes ─────────────────────────────────────────────────

export interface ApiOk<T> {
  ok: true;
  data?: T;
}
export interface ApiErr {
  ok: false;
  error: string;
  details?: unknown;
}
