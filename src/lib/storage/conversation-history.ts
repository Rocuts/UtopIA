export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  webSearchUsed?: boolean;
}

export type RiskLevel = 'bajo' | 'medio' | 'alto' | 'critico';

export interface Conversation {
  id: string;
  title: string;
  useCase: string;
  messages: ConversationMessage[];
  createdAt: string;
  updatedAt: string;
  riskLevel: RiskLevel;
}

/**
 * Documento persistido por conversación. Espejo estructural de `UploadedDocument`
 * (`src/components/workspace/types.ts`), duplicado aquí para no arrastrar imports
 * del layer de UI en este módulo de almacenamiento.
 */
export interface StoredDocument {
  filename: string;
  size: number;
  chunks: number;
  uploadedAt: string;
  textPreview?: string;
  extractedText?: string;
}

const STORAGE_KEY = 'utopia_conversations';
const DOCS_STORAGE_KEY = 'utopia_conversation_docs';

/** Tope total de caracteres de `extractedText` a guardar por conversación. */
const MAX_DOCS_CHARS_PER_CONVERSATION = 200_000;

function getAll(): Conversation[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persist(conversations: Conversation[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  } catch (err) {
    console.error('Failed to persist conversations:', err);
  }
}

export function saveConversation(conversation: Conversation): void {
  const all = getAll();
  const index = all.findIndex((c) => c.id === conversation.id);
  const updated = { ...conversation, updatedAt: new Date().toISOString() };

  if (index >= 0) {
    all[index] = updated;
  } else {
    all.unshift(updated);
  }

  persist(all);
}

export function loadConversation(id: string): Conversation | null {
  const all = getAll();
  return all.find((c) => c.id === id) ?? null;
}

export function listConversations(): Conversation[] {
  return getAll().sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export function deleteConversation(id: string): void {
  const all = getAll().filter((c) => c.id !== id);
  persist(all);
  deleteConversationDocs(id);
}

// ─── Documentos por conversación ───────────────────────────────────────────

function getAllDocs(): Record<string, StoredDocument[]> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(DOCS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, StoredDocument[]>) : {};
  } catch {
    return {};
  }
}

function persistDocs(all: Record<string, StoredDocument[]>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(DOCS_STORAGE_KEY, JSON.stringify(all));
  } catch (err) {
    // Quota exceeded u otro fallo: no rompemos el flujo de UI.
    console.error('Failed to persist conversation docs:', err);
  }
}

/**
 * Reduce la lista para que la suma de `extractedText` no exceda el tope.
 * Conserva los documentos más recientes (por `uploadedAt`) y descarta los más
 * viejos cuyo texto ya no cabe. Los metadatos del doc se conservan siempre;
 * solo se recorta `extractedText` en los documentos desbordados.
 */
function capDocsBySize(docs: StoredDocument[]): StoredDocument[] {
  if (docs.length === 0) return docs;
  const sorted = [...docs].sort(
    (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
  );
  let remaining = MAX_DOCS_CHARS_PER_CONVERSATION;
  const capped: StoredDocument[] = [];
  for (const doc of sorted) {
    const textLen = doc.extractedText?.length ?? 0;
    if (textLen === 0) {
      capped.push(doc);
      continue;
    }
    if (textLen <= remaining) {
      capped.push(doc);
      remaining -= textLen;
    } else {
      // Sin espacio: guardamos el doc sin su texto completo para preservar el chip.
      capped.push({ ...doc, extractedText: undefined });
    }
  }
  // Restauramos el orden original (por `uploadedAt` ascendente) para no
  // alterar el orden en el que aparecen los chips en la UI.
  return capped.sort(
    (a, b) => new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime()
  );
}

export function loadConversationDocs(conversationId: string): StoredDocument[] {
  if (!conversationId) return [];
  const all = getAllDocs();
  const docs = all[conversationId];
  return Array.isArray(docs) ? docs : [];
}

export function saveConversationDocs(
  conversationId: string,
  docs: StoredDocument[]
): void {
  if (!conversationId) return;
  const all = getAllDocs();
  if (docs.length === 0) {
    delete all[conversationId];
  } else {
    all[conversationId] = capDocsBySize(docs);
  }
  persistDocs(all);
}

export function deleteConversationDocs(conversationId: string): void {
  if (!conversationId) return;
  const all = getAllDocs();
  if (conversationId in all) {
    delete all[conversationId];
    persistDocs(all);
  }
}

export function generateConversationId(): string {
  return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function inferTitle(messages: ConversationMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user');
  if (!firstUser) return 'Nueva consulta';
  const text = firstUser.content.slice(0, 60);
  return text.length < firstUser.content.length ? `${text}...` : text;
}

export function getConversationStats() {
  const all = getAll();
  const total = all.length;
  const riskCounts: Record<RiskLevel, number> = {
    bajo: 0,
    medio: 0,
    alto: 0,
    critico: 0,
  };
  const useCaseCounts: Record<string, number> = {};

  for (const c of all) {
    riskCounts[c.riskLevel] = (riskCounts[c.riskLevel] || 0) + 1;
    useCaseCounts[c.useCase] = (useCaseCounts[c.useCase] || 0) + 1;
  }

  return { total, riskCounts, useCaseCounts };
}

// ─── Reportes financieros persistidos ──────────────────────────────────────
//
// Clave paralela a `utopia_conversations` / `utopia_conversation_docs`. Aqui
// almacenamos el reporte completo, su data cruda (XLSX/CSV extraido) y los
// turnos del chat de seguimiento (`ReportFollowUpChat`).
//
// Limites por reporte:
// - `rawData`: recortado a 100 KB.
// - `consolidatedReport`: recortado a 200 KB.
// - `turns`: sin tope (los mensajes suelen ser chicos vs. rawData).
// - FIFO de maximo `MAX_STORED_REPORTS` registros en total.
// ---------------------------------------------------------------------------

export const STORED_REPORTS_KEY = 'utopia_reports_v1';

const MAX_RAW_DATA_CHARS = 100_000;
const MAX_CONSOLIDATED_CHARS = 200_000;
const MAX_STORED_REPORTS = 3;

/**
 * Forma de un registro de reporte. Mantenemos el shape plano para permitir
 * migraciones futuras sin depender del tipo backend `FinancialReport`.
 *
 * `report` es `unknown` porque el layer de storage no debe arrastrar imports
 * de `@/lib/agents/financial/types` (mismo patron que `StoredDocument`).
 */
export interface StoredReportRecord {
  conversationId: string;
  createdAt: string;
  updatedAt: string;
  companyName: string;
  companyNit: string;
  fiscalPeriod: string;
  /** Reporte completo del pipeline. `unknown` para no filtrar tipos backend aqui. */
  report: unknown;
  rawData: string;
  turns: unknown[];
}

function getAllReports(): StoredReportRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORED_REPORTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoredReportRecord[]) : [];
  } catch {
    return [];
  }
}

function persistReports(records: StoredReportRecord[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORED_REPORTS_KEY, JSON.stringify(records));
  } catch (err) {
    // Quota exceeded u otro fallo: no rompemos el flujo de UI.
    console.error('Failed to persist reports:', err);
  }
}

/**
 * Recorta los campos grandes del registro para respetar los topes.
 * No toca `turns` (se asume que son mensajes de texto cortos).
 */
function capRecord(record: StoredReportRecord): StoredReportRecord {
  let rawData = record.rawData ?? '';
  if (rawData.length > MAX_RAW_DATA_CHARS) {
    rawData = rawData.slice(0, MAX_RAW_DATA_CHARS);
  }
  let report = record.report;
  if (report && typeof report === 'object' && 'consolidatedReport' in report) {
    const consolidated = (report as { consolidatedReport?: unknown }).consolidatedReport;
    if (typeof consolidated === 'string' && consolidated.length > MAX_CONSOLIDATED_CHARS) {
      report = {
        ...(report as Record<string, unknown>),
        consolidatedReport: consolidated.slice(0, MAX_CONSOLIDATED_CHARS),
      };
    }
  }
  return { ...record, rawData, report };
}

/**
 * Persiste un reporte (nuevo o actualizado por `conversationId`). Aplica
 * capping de tamanos y luego FIFO: conserva solo los ultimos N ordenados
 * por `updatedAt` descendente.
 */
export function saveReport(record: StoredReportRecord): void {
  if (!record.conversationId) return;
  const all = getAllReports();
  const idx = all.findIndex((r) => r.conversationId === record.conversationId);
  const updated: StoredReportRecord = capRecord({
    ...record,
    updatedAt: new Date().toISOString(),
  });
  if (idx >= 0) {
    all[idx] = updated;
  } else {
    all.unshift(updated);
  }
  all.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const pruned = all.slice(0, MAX_STORED_REPORTS);
  persistReports(pruned);
}

export function loadReport(conversationId: string): StoredReportRecord | null {
  if (!conversationId) return null;
  const all = getAllReports();
  return all.find((r) => r.conversationId === conversationId) ?? null;
}

export function listReports(): StoredReportRecord[] {
  return getAllReports().sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

/**
 * Recorta la lista a los `maxCount` reportes mas recientes. Util si el
 * consumer cambia el tope en runtime. Si no se pasa `maxCount` usa el
 * default interno (`MAX_STORED_REPORTS`).
 */
export function pruneReports(maxCount?: number): void {
  const limit = typeof maxCount === 'number' && maxCount > 0 ? maxCount : MAX_STORED_REPORTS;
  const all = getAllReports().sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  persistReports(all.slice(0, limit));
}

export function deleteReport(conversationId: string): void {
  if (!conversationId) return;
  const all = getAllReports().filter((r) => r.conversationId !== conversationId);
  persistReports(all);
}
