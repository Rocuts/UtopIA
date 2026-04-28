// ---------------------------------------------------------------------------
// Orchestrator del modulo "Contabilidad Pyme".
// ---------------------------------------------------------------------------
// Dos entry points:
//   - processUpload(uploadId) -> corre OCR Vision + categorizer + persiste
//     entries draft. Idempotente: si el upload ya no esta en `pending` retorna
//     sin error (otro `waitUntil` lo proceso).
//   - generateMonthlyReport(...) -> agrega via SQL + summarizer LLM ->
//     payload listo para que el route handler lo guarde en `reports.data`.
//
// La persistencia a la tabla `reports` la hace el route handler, NO este
// modulo: el orchestrator devuelve el payload puro.
// ---------------------------------------------------------------------------

import 'server-only';
import * as repo from '@/lib/db/pyme';
import { extractEntriesFromImage } from '@/lib/agents/pyme/extraction/vision-extractor';
import type {
  ExtractedEntry,
  ExtractionResult,
} from '@/lib/agents/pyme/extraction/schemas';
import { categorizeEntriesBatch, type CategorizedEntry } from './agents/categorizer';
import { summarizeMonth } from './agents/summarizer';
import type {
  MonthlyReportPayload,
  ProcessUploadOptions,
  PymeProgressEvent,
} from './types';
import type { NewPymeEntry } from '@/lib/db/schema';

// ---------------------------------------------------------------------------
// processUpload
// ---------------------------------------------------------------------------

/**
 * Procesa un upload pendiente: corre OCR Vision sobre la imagen, categoriza
 * los entries extraidos y los persiste como drafts. El usuario los confirma
 * despues desde la UI (EntryReview).
 *
 * Idempotencia: si el upload no esta en `pending` (ej. otro waitUntil lo
 * ya tomo), retorna `{ entryIds: [] }` sin lanzar ni cambiar estado.
 *
 * Detecta el caso `no_ledger_detected` que el extractor emite cuando la
 * imagen no parece un cuaderno contable (selfie, paisaje, etc.) — en ese
 * caso marca el upload como `done` con `errorMessage` informativo.
 */
export async function processUpload(
  uploadId: string,
  options: ProcessUploadOptions = {},
): Promise<{ entryIds: string[] }> {
  const { onProgress, language = 'es' } = options;
  const emit = (e: PymeProgressEvent) => {
    if (onProgress) {
      try {
        onProgress(e);
      } catch {
        // Nunca dejamos que un onProgress mal escrito tumbe el pipeline.
      }
    }
  };

  // 1. Atomic claim: marca el upload como `processing` SOLO si esta en
  //    `pending`. Si dos waitUntil corren concurrente, solo uno gana el row;
  //    el otro recibe `null` y retorna idempotente sin error. Reemplaza el
  //    patron previo `getUpload + updateUploadStatus('processing')` que tenia
  //    una ventana TOCTOU entre lectura y escritura.
  const upload = await repo.claimUploadForProcessing(uploadId);
  if (!upload) {
    // O bien no existe, o ya fue tomado por otro runner. En ambos casos el
    // contrato pide silencio: no throw, sin entries.
    return { entryIds: [] };
  }

  try {
    // -----------------------------------------------------------------------
    // 2. Carga contexto del libro: moneda + categorias previas. Esto le da
    //    al extractor reglas de parseo de monto correctas (COP vs USD vs EUR
    //    usan separadores opuestos) y al categorizer el catalogo conocido
    //    para que prefiera reusar nombres en vez de inventar variantes.
    // -----------------------------------------------------------------------
    const [book, knownCategories] = await Promise.all([
      repo.getBookById(upload.bookId),
      repo.listKnownCategories(upload.bookId, 50),
    ]);
    const bookCurrency = book?.currency ?? 'COP';

    emit({
      type: 'stage_start',
      stage: 'extract',
      label: 'Extrayendo renglones de la foto con OCR Vision...',
    });

    // -----------------------------------------------------------------------
    // 3. OCR Vision. La URL puede ser https (Blob) o data:; ambas las acepta
    //    el extractor (gpt-4o vision soporta ambas).
    // -----------------------------------------------------------------------
    const extraction: ExtractionResult = await extractEntriesFromImage(
      upload.imageUrl,
      {
        language,
        bookCurrency,
        knownCategories,
      },
    );

    emit({ type: 'stage_complete', stage: 'extract' });

    // -----------------------------------------------------------------------
    // 5. Caso "no es un cuaderno contable": el extractor devuelve
    //    entries:[] + notes:'no_ledger_detected'. Lo manejamos como exito
    //    de procesamiento (el upload paso por OCR y se diagnostico) en vez
    //    de fallo, pero dejamos un errorMessage para que la UI pueda
    //    mostrarle al usuario por que no hay entries.
    // -----------------------------------------------------------------------
    if (extraction.entries.length === 0) {
      const notes = extraction.notes ?? '';
      if (notes.startsWith('no_ledger_detected')) {
        emit({
          type: 'warning',
          message: 'No se detecto un cuaderno contable en la foto.',
        });
        await repo.updateUploadStatus(uploadId, 'done', 'no_ledger_detected');
        emit({ type: 'done' });
        return { entryIds: [] };
      }
      // Si entries=[] pero las notas indican un error real, propagamos para
      // que el catch lo registre como `failed`.
      if (notes && notes.length > 0) {
        throw new Error(`extraction_returned_empty: ${notes}`);
      }
      // Sin notas y sin entries: tratamos como done sin entries (foto muy
      // borrosa, por ejemplo).
      await repo.updateUploadStatus(uploadId, 'done', 'empty_extraction');
      emit({ type: 'done' });
      return { entryIds: [] };
    }

    // -----------------------------------------------------------------------
    // 6. Categorizar (refina category + asigna pucHint).
    // -----------------------------------------------------------------------
    emit({
      type: 'stage_start',
      stage: 'categorize',
      label: `Categorizando ${extraction.entries.length} renglon(es)...`,
    });

    const categorized = await categorizeEntriesBatch(extraction.entries, {
      language,
      knownCategories,
    });

    emit({ type: 'stage_complete', stage: 'categorize' });

    // -----------------------------------------------------------------------
    // 7. Persistir entries. Mapeo:
    //    - entryDate: usa entry.date -> extraction.pageDate -> hoy (fallback).
    //    - amount: drizzle numeric espera string.
    //    - status: 'draft' (el usuario confirma despues).
    //    - sourceImageUrl / sourcePage / rawOcrText: trazabilidad.
    //
    // Guard anti-prompt-injection sobre amount: si el LLM logra emitir un
    // monto sospechosamente alto (>100M COP), forzamos confidence < 0.5 para
    // que la UI marque el row como "revisa esto" y nunca quede auto-confirmado.
    // El cap duro (1 billon) ya esta en el zod schema; este es el cap "soft"
    // de UX para que un solo renglon no contamine totales sin revision.
    // -----------------------------------------------------------------------
    const SUSPICIOUS_AMOUNT = 100_000_000;
    const guardedEntries = extraction.entries.map((e) => ({
      ...e,
      confidence:
        typeof e.amount === 'number' && e.amount > SUSPICIOUS_AMOUNT
          ? Math.min(e.confidence, 0.49)
          : e.confidence,
    }));

    emit({
      type: 'stage_start',
      stage: 'persist',
      label: 'Guardando renglones como borrador...',
    });

    const rows: NewPymeEntry[] = guardedEntries.map((entry, idx) =>
      buildNewEntry(entry, categorized[idx], extraction, upload.id, upload.bookId, upload.imageUrl),
    );

    const inserted = await repo.insertEntries(rows);

    emit({ type: 'stage_complete', stage: 'persist' });

    // -----------------------------------------------------------------------
    // 8. Done.
    // -----------------------------------------------------------------------
    await repo.updateUploadStatus(uploadId, 'done');
    emit({ type: 'done' });

    return { entryIds: inserted.map((r) => r.id) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ type: 'error', message });
    // Marca el upload como failed para que la UI lo refleje en el polling.
    try {
      await repo.updateUploadStatus(uploadId, 'failed', message.slice(0, 500));
    } catch {
      // Si falla incluso la escritura del estado, no podemos hacer mas;
      // el caller (waitUntil) capturara el throw original.
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// buildNewEntry helper
// ---------------------------------------------------------------------------

/**
 * Convierte un entry extraido + su categoria refinada en un row listo para
 * `insertEntries`. Maneja:
 *  - fallback de fecha: entry.date -> extraction.pageDate -> hoy.
 *  - amount como string (drizzle numeric).
 *  - confidence como string (drizzle numeric con 3 decimales).
 *  - rawOcrText que puede venir null.
 */
function buildNewEntry(
  entry: ExtractedEntry,
  cat: CategorizedEntry | undefined,
  extraction: ExtractionResult,
  uploadId: string,
  bookId: string,
  sourceImageUrl: string,
): NewPymeEntry {
  // ----- Fecha -----
  const isoDate = entry.date ?? extraction.pageDate ?? null;
  const entryDate = isoDate ? parseIsoDate(isoDate) : new Date();

  // ----- Monto (drizzle numeric espera string) -----
  // El extractor permite amount=null; si llega null, lo guardamos como 0
  // para no violar `notNull` del schema. El usuario lo edita en revision.
  const amountNumber = typeof entry.amount === 'number' && Number.isFinite(entry.amount)
    ? entry.amount
    : 0;
  const amount = amountNumber.toFixed(2);

  // ----- Categoria + pucHint -----
  const category = cat?.category ?? entry.category ?? null;
  const pucHint = cat?.pucHint ?? null;

  // ----- Confidence (drizzle numeric scale 3) -----
  const confidence = clamp01(entry.confidence).toFixed(3);

  return {
    bookId,
    uploadId,
    entryDate,
    description: entry.description.slice(0, 500),
    kind: entry.kind,
    amount,
    category,
    pucHint,
    sourceImageUrl,
    sourcePage: 1,
    rawOcrText: entry.rawText ?? null,
    confidence,
    status: 'draft',
  };
}

/** Parsea un string ISO `YYYY-MM-DD` a Date en UTC del mediodia (evita TZ shift). */
function parseIsoDate(iso: string): Date {
  // Fuerza interpretacion UTC para que `entry_date` (timestamptz) no se
  // adelante/atrase un dia por timezone del runtime.
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return new Date();
  const [, y, m, d] = match;
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 12, 0, 0));
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// ---------------------------------------------------------------------------
// generateMonthlyReport
// ---------------------------------------------------------------------------

/**
 * Genera el reporte mensual: agrega via SQL (`monthlySummary`) y le pide al
 * summarizer un narrative en markdown + alertas deterministicas. Devuelve el
 * payload puro — la persistencia a `reports` la hace el route handler.
 *
 * @param workspaceId  Se acepta para que el route lo pase, pero la verificacion
 *                     de ownership la hace el route handler con `getBook`.
 *                     Lo mantenemos en la firma para no romper el contrato del spec.
 */
export async function generateMonthlyReport(
  bookId: string,
  workspaceId: string,
  year: number,
  month: number,
  language: 'es' | 'en',
): Promise<MonthlyReportPayload> {
  // Marcador para no tener `workspaceId` como parametro no usado (el route
  // handler ya valido ownership; lo aceptamos por contrato).
  void workspaceId;

  const summary = await repo.monthlySummary(bookId, year, month);

  const { narrative, alerts } = await summarizeMonth(summary, { language });

  return {
    bookId,
    year,
    month,
    summary,
    narrative,
    alerts,
    generatedAt: new Date().toISOString(),
  };
}
