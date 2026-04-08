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

const STORAGE_KEY = 'utopia_conversations';

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
