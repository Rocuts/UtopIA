import type { LegalReference } from '../types';
import { extractCitations } from '@/lib/agents/financial/escudo-survival/normative/validators/citation.validator';
import type { NormativeCitationKind } from '@/lib/agents/financial/escudo-survival/normative/types';

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

/**
 * Referencia normativa extraida del texto del asistente.
 *
 * `source` es la norma que el TEXTO declara — nunca una suposicion. `verified`
 * distingue una cita cuya familia normativa aparece explicita ("Art. 240 E.T.",
 * "Ley 2277 de 2022", "NIC 12") de una mencion suelta ("Art. 5") que podria
 * ser de un contrato, de un decreto o directamente una alucinacion del modelo.
 */
export interface ExtractedLegalReference extends LegalReference {
  /** Norma tal como el texto la declara, o la etiqueta de "no verificada". */
  source: string;
  /** true solo si la familia normativa esta explicita en el texto. */
  verified: boolean;
}

/** Etiqueta de `source` por tipo de cita reconocida por el validador normativo. */
const SOURCE_BY_KIND: Record<NormativeCitationKind, string> = {
  articulo_et: 'Estatuto Tributario',
  ley: 'Ley',
  decreto: 'Decreto',
  concepto_dian: 'Concepto DIAN',
  sentencia_corte: 'Corte Constitucional',
  niif_pymes: 'NIIF para PYMES',
  nic: 'NIIF / NIC',
  nia: 'NIA',
  resolucion_dian: 'Resolución DIAN',
};

/** Etiqueta para menciones tipo "Art. N" sin norma declarada en el texto. */
export const UNVERIFIED_SOURCE_LABEL = 'Norma no identificada — cita no verificada';

/**
 * `Art. N` suelto: SIN "E.T." / "Estatuto Tributario" y SIN una norma
 * inmediatamente despues ("de la Ley 2277", "del Decreto 1625", "del contrato").
 * Solo se usa para MARCAR la mencion como no verificada, nunca para atribuirla.
 */
const BARE_ARTICLE_RE = /\bArt(?:[íi]culo|\.)?\s*(\d+(?:-\d+)?)/gi;

/** Fragmento que sigue a la mencion y permite decidir si la norma esta declarada. */
const NORM_AFTER_ARTICLE_RE =
  /^\s*(?:par(?:\.|[áa]grafo)?\s*\d+\s*)?(?:E\.?\s*T\.?\b|del?\s+(?:Estatuto\s+Tributario|la\s+Ley|Ley|el\s+Decreto|Decreto|la\s+Resoluci[óo]n|Resoluci[óo]n))/i;

/**
 * Extrae referencias normativas del texto final del asistente.
 *
 * Why: la version previa etiquetaba como "Art. N E.T." CUALQUIER "Art. N" del
 * texto — el grupo que exigia "E.T." era opcional — y el panel de inteligencia
 * lo publicaba como cita del Estatuto Tributario. Un "Art. 33 de la Ley 2277",
 * un "Art. 5 del contrato" o un articulo alucinado aparecian certificados
 * visualmente. En un producto cuyos conceptos terminan ante la DIAN eso es
 * inaceptable: aqui solo se atribuye la norma que el propio texto declara.
 *
 * La deteccion reutiliza `extractCitations` del validador normativo del Escudo
 * (regex conservadores, ya probados) en vez de mantener un segundo parser.
 */
export function extractLegalReferences(content: string): ExtractedLegalReference[] {
  if (!content) return [];

  const refs: ExtractedLegalReference[] = [];
  const seen = new Set<string>();
  /** Rangos ya cubiertos por una cita reconocida — evita duplicar la mencion. */
  const covered: Array<{ start: number; end: number }> = [];

  for (const cite of extractCitations(content)) {
    covered.push(cite.position);
    if (seen.has(cite.normalized)) continue;
    seen.add(cite.normalized);
    refs.push({
      article: cite.normalized,
      description: describeAfter(content, cite.position.end),
      source: SOURCE_BY_KIND[cite.kind],
      verified: true,
    });
  }

  // Segunda pasada: menciones "Art. N" que NINGUN patron reconocio. No se
  // atribuyen a ninguna norma; se publican como no verificadas para que el
  // usuario sepa que nadie las comprobo.
  BARE_ARTICLE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BARE_ARTICLE_RE.exec(content)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (covered.some((c) => start >= c.start && start < c.end)) continue;
    // Si tras la mencion viene una norma declarada, la cita ya fue (o sera)
    // capturada por `extractCitations` con su familia correcta.
    if (NORM_AFTER_ARTICLE_RE.test(content.slice(end, end + 40))) continue;
    const article = `Art. ${m[1]}`;
    if (seen.has(article)) continue;
    seen.add(article);
    refs.push({
      article,
      description: describeAfter(content, end),
      source: UNVERIFIED_SOURCE_LABEL,
      verified: false,
    });
  }

  return refs;
}

/** Toma el texto que sigue a la cita hasta el primer separador, como glosa corta. */
function describeAfter(content: string, from: number): string {
  const tail = content.slice(from, from + 160);
  const dash = tail.match(/^\s*[-–—]\s*([^.,;\n]+)/);
  return dash ? dash[1].trim() : '';
}

// ─── Etiquetas de agentes del pipeline ──────────────────────────────────────

/**
 * Etiqueta corta por dominio. El servidor emite `displayName` en el evento
 * `routing` (orchestrator.ts: `domains.map(d => SPECIALISTS[d].displayName)`),
 * asi que el mapa acepta AMBAS formas: la clave de dominio y el displayName.
 *
 * Why: el mapa previo comparaba contra 'tax'/'accounting'/'documents' — valores
 * que el servidor nunca envia — y su `else` final rotulaba TODO como
 * "Ag. Estrategia". El banner afirmaba falsamente quien produjo la respuesta.
 */
const AGENT_LABEL_BY_KEY: Record<string, { label: string; branch: 'tax' | 'accounting' | 'parallel' }> = {
  tax: { label: 'Ag. Tributario', branch: 'tax' },
  'agente tributario': { label: 'Ag. Tributario', branch: 'tax' },
  accounting: { label: 'Ag. Contable', branch: 'accounting' },
  'agente contable': { label: 'Ag. Contable', branch: 'accounting' },
  documents: { label: 'Ag. Documentos', branch: 'parallel' },
  'agente documental': { label: 'Ag. Documentos', branch: 'parallel' },
  strategy: { label: 'Ag. Estrategia', branch: 'parallel' },
  'agente de estrategia': { label: 'Ag. Estrategia', branch: 'parallel' },
  litigation: { label: 'Ag. Litigante', branch: 'parallel' },
  'agente litigante': { label: 'Ag. Litigante', branch: 'parallel' },
};

/**
 * Resuelve etiqueta y rama de un agente a partir de lo que envie el servidor.
 * Ante un nombre desconocido devuelve el nombre crudo: es preferible mostrar
 * un rotulo raro que atribuir la respuesta al agente equivocado.
 */
export function resolveAgentPresentation(raw: string): {
  label: string;
  branch: 'tax' | 'accounting' | 'parallel';
} {
  return AGENT_LABEL_BY_KEY[raw.trim().toLowerCase()] ?? { label: raw, branch: 'parallel' };
}

// ─── Cierre honesto del stream ──────────────────────────────────────────────

/**
 * Marca que se INCRUSTA en el contenido cuando el stream se cierra sin evento
 * `result`. Va dentro del markdown persistido a proposito: si solo viviera en
 * el estado de React, al recargar el historial la respuesta amputada volveria
 * a leerse como completa.
 */
export const TRUNCATION_NOTICE: Record<'es' | 'en', string> = {
  es: '---\n\n> ⚠️ **Respuesta incompleta.** La conexión con el servidor se cerró antes de que el análisis terminara, por lo que el texto anterior está cortado y puede omitir cálculos, plazos o conclusiones. No lo use como concepto definitivo: reintente la consulta.',
  en: '---\n\n> ⚠️ **Incomplete answer.** The connection closed before the analysis finished, so the text above is truncated and may omit calculations, deadlines or conclusions. Do not treat it as final: please retry the query.',
};

/**
 * Decide el contenido final de un turno a partir del evento `result` y de lo
 * que se alcanzo a streamear.
 *
 * Why: `/api/chat` solo emite `result` cuando `orchestrate` termina. Si la
 * funcion muere antes (techo de `maxDuration = 300`, corte del proveedor) el
 * stream se cierra SIN `result` y sin evento `error`. Ambos chats trataban ese
 * caso como "la respuesta final es lo que se streameo": una respuesta cortada a
 * mitad de un calculo de sancion se mostraba, se persistia y quedaba
 * exportable sin marca alguna de truncamiento.
 *
 * Devuelve `null` cuando no hay nada que mostrar (el caller debe tratarlo como
 * error).
 */
export function resolveFinalAnswer(opts: {
  result: { content?: string } | null | undefined;
  streamed: string;
  language: 'es' | 'en';
}): { content: string; truncated: boolean } | null {
  const serverContent =
    opts.result && typeof opts.result.content === 'string' ? opts.result.content : '';
  if (opts.result && (serverContent || opts.streamed)) {
    return { content: serverContent || opts.streamed, truncated: false };
  }
  if (opts.streamed) {
    return { content: `${opts.streamed}\n\n${TRUNCATION_NOTICE[opts.language]}`, truncated: true };
  }
  return null;
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
