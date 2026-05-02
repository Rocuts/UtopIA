import 'server-only';
import { listAccounts } from './queries';
import type { ChartOfAccountsRow } from '@/lib/db/schema';

// ---------------------------------------------------------------------------
// Export del PUC al formato del RAG (Neon pgvector + hybrid search).
// ---------------------------------------------------------------------------
//
// Esta función es preparatoria para Ola 3 — NO ingiere todavía. Devuelve un
// array de chunks listos para `addDocumentsToStore(texts, metadata)` (ver
// `src/lib/rag/vectorstore.ts:338`). Cada cuenta = un chunk.
//
// Decisiones:
//
// 1) Granularidad por cuenta (no por subárbol). El PUC PYMES tiene <500
//    cuentas — caben holgado como chunks individuales. Esto permite hits
//    precisos del RAG ("¿qué código uso para arrendamientos pagados por
//    anticipado?" ⇒ hit en cuenta "1705"). Una granularidad por grupo
//    diluiría la señal.
//
// 2) Formato de texto inspirado en el chunking del corpus normativo (ver
//    `src/lib/rag/ingest.ts`): línea de cabecera con metadatos clave y luego
//    el contexto adicional. La cabecera sirve para BM25 (tsvector) y el
//    contexto para el embedding semántico.
//
// 3) `metadata` incluye `docType: 'puc_account'` para que el filtro del RAG
//    pueda restringir queries del módulo contable a estas filas si hace
//    falta. `entity` queda como código de la clase (1..9) para facilitar
//    drill-down.
//
// 4) Multi-tenant: scope al `workspaceId` que recibe la función. El consumer
//    (Ola 3) decidirá si insertar como global (workspace_id=null) o por
//    tenant. NO mezclar — un PUC parametrizado por el cliente NO debe
//    contaminar el corpus global.
// ---------------------------------------------------------------------------

export interface PucRagChunk {
  /** Texto a embeber. Incluye cabecera estructurada + contexto descriptivo. */
  text: string;
  /** Metadata adicional para el insert al RAG. */
  metadata: {
    source: string;
    docType: 'puc_account';
    entity: string; // primer dígito (1..9)
    /** Código completo (ej "110505"). Útil para hits exactos. */
    accountCode: string;
    /** Nivel jerárquico 1..5. */
    accountLevel: number;
    /** Tipo NIIF (ACTIVO, PASIVO, ...). */
    accountType: string;
    /** true si es cuenta hoja (admite movimientos). */
    isPostable: boolean;
    /** Workspace id del que se exporta (no se usa para `addDocumentsToStore` directamente, pero queda en metadata para auditoría). */
    workspaceId: string;
  };
}

/**
 * Construye el texto del chunk para una cuenta. Mantenemos formato consistente
 * con el resto del corpus (`Decreto 2706/2012 — Art. X — ...` style).
 */
function chunkTextFor(row: ChartOfAccountsRow): string {
  const naturalLevel = ['Clase', 'Grupo', 'Cuenta', 'Subcuenta', 'Auxiliar'][
    Math.max(0, Math.min(row.level - 1, 4))
  ];
  const postable = row.isPostable ? 'Sí (admite movimientos)' : 'No (agrupador)';
  const requirements: string[] = [];
  if (row.requiresThirdParty)
    requirements.push('requiere tercero (NIT/CC) en cada movimiento');
  if (row.requiresCostCenter)
    requirements.push('requiere centro de costo en cada movimiento');
  const reqLine =
    requirements.length > 0 ? `Requisitos: ${requirements.join('; ')}.` : '';

  return [
    `Cuenta PUC: ${row.code} ${row.name}`,
    `Clase: ${row.type}`,
    `Nivel: ${row.level} (${naturalLevel})`,
    `Auxiliar / hoja contable: ${postable}`,
    `Moneda: ${row.currency}`,
    reqLine,
    `Fuente normativa: PUC PYMES Colombia (Decreto 2706/2012, Decreto 2420/2015 Anexo 2).`,
  ]
    .filter((s) => s.length > 0)
    .join('\n');
}

/**
 * Exporta el PUC del workspace en formato consumible por
 * `addDocumentsToStore(texts, metadata)`. Solo cuentas activas — las
 * desactivadas no deberían aparecer en sugerencias del RAG.
 *
 * Devuelve `[]` si el workspace no tiene PUC sembrado todavía.
 */
export async function exportPucToRagFormat(
  workspaceId: string,
): Promise<PucRagChunk[]> {
  const accounts = await listAccounts(workspaceId, {
    activeOnly: true,
    limit: 5000,
  });
  return accounts.map((row) => ({
    text: chunkTextFor(row),
    metadata: {
      source: `PUC PYMES — ${workspaceId}`,
      docType: 'puc_account' as const,
      entity: row.code.charAt(0),
      accountCode: row.code,
      accountLevel: row.level,
      accountType: row.type,
      isPostable: row.isPostable,
      workspaceId,
    },
  }));
}
