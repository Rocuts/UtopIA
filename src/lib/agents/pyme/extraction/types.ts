// ---------------------------------------------------------------------------
// Tipos publicos del extractor Vision (modulo Pyme).
// ---------------------------------------------------------------------------
// Re-export de tipos derivados de los schemas Zod + interfaz de contexto que
// el orchestrator pasa al extractor. Mantenemos esto separado de `schemas.ts`
// para que consumers que solo necesitan tipos no tengan que importar zod.
// ---------------------------------------------------------------------------

export type { ExtractedEntry, ExtractionResult } from './schemas';

export interface ExtractionContext {
  language: 'es' | 'en';
  bookCurrency: string;
  knownCategories?: string[];
}
