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
  const items = narratives.map((n) => `- ${n.title}: ${n.body}`).join('\n');
  return `<hechos_empresa>
${header}
${items}
</hechos_empresa>`;
}
