// src/lib/facts/hechos-empresa.ts
// Renderer + selector PUROS del bloque <hechos_empresa> que inyecta los hechos
// NARRATIVOS del negocio como PROSA en el <context> dinámico de los prompts de
// reporte. Sin DB, sin import del árbol financiero → testeable en aislamiento.
// Los números NUNCA salen de aquí: el header del bloque lleva su propio guardrail
// anti-cifras (Protocolo Élite — todo número vinculante viene del path determinista).

import type { WorkspaceFact } from '@/lib/db/schema';

export interface NarrativeContent {
  title: string;
  body: string;
}

/**
 * Selecciona los hechos NARRATIVOS que deben entrar al reporte, excluyendo los
 * ids que el usuario desmarcó en la confirmación pre-reporte (exclusión efímera,
 * NO muta la DB). PURA: el caller pasa los facts ya leídos por getActiveFacts
 * (que ya devuelve sólo `status='active'`). El filtro `kind==='narrative'` deja
 * los estructurados (donation) fuera del bloque de prosa — sus cifras van por el
 * path determinista, nunca por aquí (Art. 647, anti doble conteo).
 */
export function selectNarrativeContents(
  facts: Array<Pick<WorkspaceFact, 'id' | 'kind' | 'title' | 'body'>>,
  excludedFactIds?: readonly string[] | null,
): NarrativeContent[] {
  const excluded = new Set(excludedFactIds ?? []);
  return facts
    .filter((f) => f.kind === 'narrative' && !excluded.has(f.id))
    .map((f) => ({ title: f.title, body: f.body }));
}

// Techos defensivos. El contrato (contracts.ts) y las columnas `text` de la DB no
// acotan title/body, así que las filas ya persistidas pueden ser arbitrariamente
// largas: un solo hecho no puede desplazar el resto del <context> del reporte.
const FACT_TITLE_MAX = 200;
const FACT_BODY_MAX = 2000;

/**
 * Escapa `<` y `>` del texto del hecho.
 *
 * El sanitizador anterior sólo borraba `<hechos_empresa>` / `</hechos_empresa>`, y
 * el bloque se interpola DENTRO del `<context>` de cinco prompts financieros: bastaba
 * con que el body trajera un `</context>` para cerrar el bloque envolvente y colar un
 * `<constraints>` falso con la misma jerarquía que los reales, en TODA corrida futura
 * del workspace. Una lista negra de delimitadores envejece mal (ni siquiera cubría
 * `</ hechos_empresa >`), así que escapamos los caracteres: los hechos son PROSA
 * escrita por el usuario —o extraída por el modelo de un documento de tercero—, nunca
 * llevan markup legítimo, de modo que escapar no pierde información y cierra cualquier
 * delimitador, presente o futuro.
 *
 * El recorte va ANTES del escape para no partir una entidad por la mitad.
 */
function sanitizeFactText(s: string, max: number): string {
  const clipped = s.length > max ? `${s.slice(0, max)} [...]` : s;
  return clipped.replace(/[<>]/g, (c) => (c === '<' ? '&lt;' : '&gt;'));
}

/**
 * Renderiza el bloque <hechos_empresa>. Devuelve '' cuando no hay narrativos (no
 * se inyecta un tag vacío — cache-friendly). El header lleva el guardrail
 * anti-cifras CO-LOCADO con los hechos, para que el modelo nunca derive un número
 * de este contexto.
 */
export function renderHechosEmpresaBlock(
  narratives: NarrativeContent[],
  language: 'es' | 'en',
): string {
  if (narratives.length === 0) return '';
  const header =
    language === 'es'
      ? 'Hechos duraderos del negocio confirmados por el usuario. Son CONTEXTO para la redacción (notas, análisis, narrativa); NUNCA una fuente de cifras. Todo número vinculante proviene de los TOTALES VINCULANTES / bloques deterministas, jamás de estos hechos.'
      : 'Durable business facts confirmed by the user. They are CONTEXT for the narrative (notes, analysis, prose); NEVER a source of figures. Every binding number comes from the BINDING TOTALS / deterministic blocks, never from these facts.';
  const items = narratives
    .map((n) => `- ${sanitizeFactText(n.title, FACT_TITLE_MAX)}: ${sanitizeFactText(n.body, FACT_BODY_MAX)}`)
    .join('\n');
  return `<hechos_empresa>
${header}
${items}
</hechos_empresa>`;
}
