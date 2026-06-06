import type { LegalReference } from '../types';

export function generateId(): string {
  try {
    if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
      return window.crypto.randomUUID();
    }
  } catch { /* fallback */ }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

export function extractLegalReferences(content: string): LegalReference[] {
  const refs: LegalReference[] = [];
  const seen = new Set<string>();
  const regex = /(?:Art(?:\.|iculo)\s+(\d+(?:\s*[-–]\d+)?))\s*(?:(?:del\s+)?(?:E\.?\s*T\.?|Estatuto\s+Tributario))?(?:\s*[-–—]\s*(.+?))?(?:\.|,|;|\n|$)/gi;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const article = `Art. ${match[1].trim()} E.T.`;
    if (seen.has(article)) continue;
    seen.add(article);
    refs.push({ article, description: match[2]?.trim() || '' });
  }
  return refs;
}

export type ChatErrorKind = 'network' | 'timeout' | 'rate_limit' | 'server' | 'unknown';

export function classifyError(err: unknown, userAborted: boolean): ChatErrorKind | 'user_abort' {
  if (userAborted) return 'user_abort';
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    const name = err.name;
    if (name === 'AbortError' && !userAborted) return 'timeout';
    if (msg.includes('failed to fetch') || msg.includes('network') || msg.includes('offline')) return 'network';
    if (msg.includes('429') || msg.includes('rate limit')) return 'rate_limit';
    if (/\b5\d{2}\b/.test(msg) || msg.includes('server error') || msg.includes('internal error')) return 'server';
  }
  return 'unknown';
}

export function errorMessageText(kind: ChatErrorKind, language: 'es' | 'en'): string {
  const copy: Record<ChatErrorKind, Record<'es' | 'en', string>> = {
    network: {
      es: 'No pude conectarme al servidor. Verifique su conexión a internet e intente de nuevo.',
      en: 'Could not reach the server. Check your internet connection and try again.',
    },
    timeout: {
      es: 'La consulta tomó demasiado tiempo. Intente reformular su pregunta o dividirla en partes más cortas.',
      en: 'The query took too long. Try rephrasing your question or breaking it into shorter parts.',
    },
    rate_limit: {
      es: 'Hemos alcanzado el límite de consultas por minuto. Espere unos segundos e intente de nuevo.',
      en: 'Rate limit reached. Please wait a few seconds and try again.',
    },
    server: {
      es: 'El servidor tuvo un problema técnico. Intente de nuevo en unos segundos.',
      en: 'The server encountered a technical issue. Please try again in a few seconds.',
    },
    unknown: {
      es: 'Hubo un error al procesar su consulta. Por favor intente nuevamente.',
      en: 'There was an error processing your query. Please try again.',
    },
  };
  return copy[kind][language];
}

export type FeedbackValue = 'up' | 'down' | null;

export function loadFeedback(messageId: string): FeedbackValue {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('utopia_msg_feedback');
    if (!raw) return null;
    const log = JSON.parse(raw) as Record<string, FeedbackValue>;
    return log[messageId] ?? null;
  } catch {
    return null;
  }
}

export function saveFeedback(messageId: string, value: FeedbackValue): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem('utopia_msg_feedback');
    const log = raw ? (JSON.parse(raw) as Record<string, FeedbackValue>) : {};
    if (value === null) delete log[messageId];
    else log[messageId] = value;
    localStorage.setItem('utopia_msg_feedback', JSON.stringify(log));
  } catch { /* ignore */ }
}
