// ---------------------------------------------------------------------------
// Tipos publicos del orchestrator del modulo "Contabilidad Pyme".
// ---------------------------------------------------------------------------
// Eventos de progreso (consumidos por la API route que abre SSE), opciones
// del proceso de upload y el payload del reporte mensual que devolvemos al
// route handler para persistir en la tabla `reports`.
// ---------------------------------------------------------------------------

import type { MonthlySummary } from '@/lib/db/pyme';

/**
 * Eventos emitidos por el orchestrator cuando procesa un upload o genera un
 * reporte. La API route los serializa a SSE para que la UI muestre estado
 * en vivo (cada foto pasa por extract -> categorize -> persist).
 */
export type PymeProgressEvent =
  | {
      type: 'stage_start';
      stage: 'extract' | 'categorize' | 'persist' | 'summary';
      label: string;
    }
  | { type: 'stage_progress'; stage: string; detail: string }
  | { type: 'stage_complete'; stage: string }
  | { type: 'warning'; message: string }
  | { type: 'error'; message: string }
  | { type: 'done' };

/**
 * Opciones del `processUpload`. `onProgress` es opcional — si no se pasa,
 * el upload corre silencioso (caso `waitUntil`, donde no hay un canal SSE
 * abierto que escuche).
 *
 * `language` controla las instrucciones de los agentes (extractor + categorizer)
 * — el contenido del cuaderno sigue en espanol siempre, pero las directivas
 * y mensajes pueden ajustarse para usuarios angloparlantes. Default 'es'.
 */
export interface ProcessUploadOptions {
  onProgress?: (e: PymeProgressEvent) => void;
  language?: 'es' | 'en';
}

/**
 * Payload final del reporte mensual. La API route lo guarda completo en
 * `reports.data` (jsonb) para que la UI lo recupere sin re-generar.
 */
export interface MonthlyReportPayload {
  bookId: string;
  year: number;
  month: number;
  summary: MonthlySummary;
  narrative: string;
  alerts: Array<{
    severity: 'info' | 'warning' | 'critical';
    message: string;
  }>;
  generatedAt: string;
}
