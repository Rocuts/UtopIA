/**
 * Resiliencia del pipeline NIIF — lógica pura + persistencia.
 * ---------------------------------------------------------------------------
 * Auditoría 2026-08 (grupo "resiliencia-pipeline"). Una corrida del pipeline
 * cuesta 3-5 minutos de reloj y varios dólares de LLM. Hasta esta versión toda
 * la orquestación vivía dentro de un `useEffect` del componente, así que el
 * trabajo dependía de que un componente React siguiera montado y de que ninguna
 * dependencia del efecto cambiara. Este módulo saca del componente todo lo que
 * NO necesita React para poder:
 *
 *   1. Detectar que un reporte persistido está INCOMPLETO (Partes II/III vacías)
 *      antes de presentárselo al cliente como terminado. El dato ya estaba en el
 *      reporte — nadie lo miraba.
 *   2. Persistir el intake de la corrida en curso para que un F5 no obligue a
 *      rehacer el wizard entero.
 *   3. Persistir el mínimo necesario (`bindingTotals`) para reanudar en la
 *      sub-fase que falló en vez de re-ejecutar el NIIF, que es la fase cara.
 *
 * Vive fuera del componente a propósito: así es testeable sin DOM (el repo no
 * tiene @testing-library) y no se re-crea en cada render.
 */

import type { NiifReportIntake } from '@/types/platform';

// ─── Model id del deliverable ────────────────────────────────────────────────

/**
 * Model id que el cliente declara en la ficha técnica del reporte HTML v10.1.
 *
 * DEBE coincidir con el default de `MODEL_IDS.FINANCIAL_PIPELINE`
 * (`src/lib/config/models.ts`). No se puede importar `models.ts` desde un client
 * component: ese módulo importa `@ai-sdk/openai` y lee `process.env.OPENAI_MODEL_*`,
 * variables que no existen en el bundle del navegador — la importación
 * arrastraría el SDK al cliente y aun así devolvería siempre el default.
 *
 * Por eso este literal es un ESPEJO, no la fuente de verdad, y hay un test que
 * falla si `models.ts` cambia el default sin actualizar esto
 * (`pipeline-resilience.test.ts` → "modelId espejo").
 *
 * PENDIENTE (fuera de frontera): que `/api/financial-report/html` sobrescriba
 * `metadata.modelId` server-side con `MODEL_IDS.FINANCIAL_PIPELINE` ya resuelto.
 * Mientras eso no exista, un override de `OPENAI_MODEL_FINANCIAL` vuelve a
 * desincronizar la ficha técnica del documento que firma el cliente.
 */
export const CLIENT_REPORT_MODEL_ID = 'gpt-5.6-sol';

// ─── Detección de reporte parcial ────────────────────────────────────────────

export type PipelinePhaseId = 'strategy' | 'governance';

/** Shape mínimo que necesitamos de `BackendFinancialReport` para juzgar completitud. */
interface PartialCheckShape {
  strategicAnalysis?: { fullContent?: unknown } | null;
  governance?: { fullContent?: unknown } | null;
}

function isEmptyPhase(phase: { fullContent?: unknown } | null | undefined): boolean {
  if (!phase) return true;
  const content = phase.fullContent;
  return typeof content !== 'string' || content.trim().length === 0;
}

/**
 * Devuelve qué partes del reporte son stubs vacíos (`emptyStrategy()` /
 * `emptyGovernance()` del checkpoint parcial).
 *
 * POR QUÉ existe: el checkpoint que se persiste tras la sub-fase NIIF rellena
 * Estrategia y Gobierno con stubs para no romper el contrato de tipos. Tras un
 * refresh ese registro se rehidrataba como `mode: 'complete'` y el cliente veía
 * "PARTE II: ANÁLISIS ESTRATÉGICO" seguida de nada, con botón de exportar a PDF.
 * La completitud NO necesita un flag nuevo: el propio reporte ya la delata.
 * Derivarla (en vez de persistir un booleano) evita que un registro viejo o
 * escrito por otra versión mienta sobre sí mismo.
 */
export function detectMissingPhases(report: unknown): PipelinePhaseId[] {
  if (!report || typeof report !== 'object') return [];
  const r = report as PartialCheckShape;
  const missing: PipelinePhaseId[] = [];
  if (isEmptyPhase(r.strategicAnalysis)) missing.push('strategy');
  if (isEmptyPhase(r.governance)) missing.push('governance');
  return missing;
}

/** Azúcar sobre `detectMissingPhases`. */
export function isPartialReport(report: unknown): boolean {
  return detectMissingPhases(report).length > 0;
}

/**
 * Punto desde el cual se puede reanudar una corrida.
 *
 * - `'strategy'` / `'governance'`: hay checkpoint NIIF utilizable → se reanuda
 *   la sub-fase faltante sin volver a pagar el Analista NIIF.
 * - `'full'`: falta contenido pero no hay checkpoint → la única salida es
 *   re-ejecutar todo (requiere el intake original).
 * - `null`: no falta nada.
 */
export function resolveResumePoint(args: {
  missing: PipelinePhaseId[];
  hasNiifResult: boolean;
  hasBindingTotals: boolean;
}): PipelinePhaseId | 'full' | null {
  if (args.missing.length === 0) return null;
  const canResume = args.hasNiifResult && args.hasBindingTotals;
  if (!canResume) return 'full';
  // `bindingTotals` es obligatorio en los schemas de /strategy y /governance;
  // sin él la reanudación devolvería 400 y el usuario vería un error peor que
  // el problema original.
  return args.missing.includes('strategy') ? 'strategy' : 'governance';
}

// ─── Advertencias de validación contable ─────────────────────────────────────

/**
 * Une advertencias nuevas a las ya vistas preservando el orden y sin duplicar.
 * Las tres sub-fases pueden reportar el mismo invariante roto (p. ej. la
 * ecuación patrimonial se revalida en cada una); duplicar la salvedad en el
 * banner haría parecer que hay más descuadres de los que hay.
 *
 * Devuelve el array previo POR IDENTIDAD cuando no hay nada nuevo, para que el
 * `setState` del componente no dispare un render inútil.
 */
export function mergeWarnings(prev: string[], incoming: string[]): string[] {
  const seen = new Set(prev);
  const fresh = incoming.filter((w) => typeof w === 'string' && w.trim().length > 0 && !seen.has(w));
  return fresh.length > 0 ? [...prev, ...fresh] : prev;
}

// ─── Persistencia de la corrida ──────────────────────────────────────────────

export const PENDING_RUN_KEY = 'utopia_pipeline_pending_run';
export const NIIF_CHECKPOINT_KEY = 'utopia_pipeline_niif_checkpoint';

export interface PendingRunRecord {
  /** Intake exacto con el que se disparó la corrida. NUNCA se trunca (ver abajo). */
  input: NiifReportIntake;
  /** ISO del momento en que se disparó. Solo informativo para la UI de reanudación. */
  startedAt: string;
}

export interface NiifCheckpointRecord {
  reportVersionId?: string;
  /** Ata el checkpoint al reporte persistido; si no coincide, se descarta. */
  conversationId: string;
  /**
   * Totales vinculantes calculados por el preprocesador en la sub-fase NIIF.
   * Son obligatorios (`min(1)`) en los schemas de /strategy y /governance.
   * NO persistimos `preprocessed`: es opcional en ambos schemas y puede pesar
   * megabytes, lo que reventaría la cuota de localStorage y se llevaría por
   * delante al propio reporte.
   */
  bindingTotals: string;
  savedAt: string;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function getStore(): StorageLike | null {
  try {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    return ls ?? null;
  } catch {
    // Safari en modo privado puede lanzar al leer `localStorage`.
    return null;
  }
}

function writeJson(key: string, value: unknown): boolean {
  const store = getStore();
  if (!store) return false;
  try {
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // Cuota excedida. Deliberadamente NO recortamos el payload: un `rawData`
    // truncado reanudaría el pipeline sobre un balance mutilado y produciría
    // cifras incorrectas con apariencia normal. Preferimos no ofrecer
    // reanudación a ofrecer una reanudación que miente.
    try {
      store.removeItem(key);
    } catch {
      /* noop */
    }
    return false;
  }
}

function readJson<T>(key: string): T | null {
  const store = getStore();
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function removeKey(key: string): void {
  const store = getStore();
  if (!store) return;
  try {
    store.removeItem(key);
  } catch {
    /* noop */
  }
}

/** Persiste el intake de la corrida en curso. `false` si no cupo en el storage. */
export function savePendingRun(input: NiifReportIntake): boolean {
  const record: PendingRunRecord = { input, startedAt: new Date().toISOString() };
  return writeJson(PENDING_RUN_KEY, record);
}

/** Lee la corrida pendiente. Valida lo mínimo para no rehidratar basura. */
export function loadPendingRun(): PendingRunRecord | null {
  const record = readJson<PendingRunRecord>(PENDING_RUN_KEY);
  if (!record || typeof record !== 'object') return null;
  const input = record.input as NiifReportIntake | undefined;
  if (!input || typeof input.rawData !== 'string' || input.rawData.length === 0) return null;
  if (!input.company || typeof input.company.name !== 'string') return null;
  return { input, startedAt: typeof record.startedAt === 'string' ? record.startedAt : '' };
}

export function clearPendingRun(): void {
  removeKey(PENDING_RUN_KEY);
}

export function saveNiifCheckpoint(record: NiifCheckpointRecord): boolean {
  if (!record.conversationId || !record.bindingTotals) return false;
  return writeJson(NIIF_CHECKPOINT_KEY, record);
}

/**
 * Lee el checkpoint NIIF. Si se le pasa `conversationId`, exige que coincida:
 * un checkpoint de otra corrida aplicado al reporte equivocado mezclaría los
 * totales vinculantes de una empresa con los estados financieros de otra.
 */
export function loadNiifCheckpoint(conversationId?: string): NiifCheckpointRecord | null {
  const record = readJson<NiifCheckpointRecord>(NIIF_CHECKPOINT_KEY);
  if (!record || typeof record.bindingTotals !== 'string' || record.bindingTotals.length === 0) {
    return null;
  }
  if (conversationId && record.conversationId !== conversationId) return null;
  return record;
}

export function clearNiifCheckpoint(): void {
  removeKey(NIIF_CHECKPOINT_KEY);
}
