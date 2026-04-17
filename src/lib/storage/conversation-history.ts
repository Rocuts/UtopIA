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
