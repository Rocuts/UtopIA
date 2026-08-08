// ---------------------------------------------------------------------------
// rag-purge-orphan-uploads — inventario (y purga opcional) de los uploads de
// cliente que quedaron en el corpus GLOBAL del RAG.
// ---------------------------------------------------------------------------
//
// El problema: en `rag_chunks`, `workspace_id IS NULL` significa "corpus
// global" y TODA query de cualquier tenant incluye esa condicion. Un chunk con
// `doc_type='user_upload'` y `workspace_id NULL` es, por definicion, un
// documento de un cliente recuperable por cualquier otro cliente via
// `search_docs`.
//
// Estado medido 2026-08 contra produccion: 1.892 chunks en esa situacion,
// repartidos en 4 documentos (tres balances de prueba y un requerimiento de
// IVA de la DIAN), entre 2026-05-05 y 2026-05-28. El leak del lado del caller
// se cerro el 2026-06-10 (commit 8ff6c0ab, `/api/upload` ya no indexa sin
// workspace) y la libreria ahora lo rechaza duro (`addDocumentsToStore`), asi
// que esto son RESIDUOS historicos, no una fuga viva.
//
// Por que un script y no una migracion: borrar datos de cliente es una
// decision del dueno del dato, no del pipeline de despliegue. Este script es
// DRY-RUN por defecto y exige dos flags para borrar.
//
// Uso:
//   # inventario (no escribe nada):
//   npx dotenv -e .env.local -- npx tsx --tsconfig tsconfig.scripts.json \
//     scripts/rag-purge-orphan-uploads.ts
//
//   # borrado real (requiere confirmar el conteo exacto que reporto el dry-run):
//   ... scripts/rag-purge-orphan-uploads.ts --borrar --confirmar 1892
//
// El `--confirmar <N>` no es ceremonia: ancla el borrado al inventario que se
// reviso. Si entre la revision y la ejecucion el conteo cambio (otro proceso
// escribiendo, o un filtro distinto del que se creia), el script aborta en vez
// de borrar de mas.
// ---------------------------------------------------------------------------

import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const quiereBorrar = args.includes('--borrar');
const idxConfirmar = args.indexOf('--confirmar');
const confirmado = idxConfirmar >= 0 ? Number(args[idxConfirmar + 1]) : NaN;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rows<T>(res: any): T[] {
  const data = res?.rows ?? res;
  return Array.isArray(data) ? (data as T[]) : [];
}

// `type` y no `interface`: `db.execute<T>` exige `T extends Record<string,
// unknown>` y solo los type alias de objeto reciben index signature implicita.
type FilaInventario = {
  source: string;
  n: string;
  primero: string;
  ultimo: string;
  bytes: string;
};

async function main() {
  const db = getDb();

  // Criterio unico y explicito, reutilizado por el inventario y el DELETE para
  // que no puedan divergir.
  const criterio = sql`doc_type = 'user_upload' AND workspace_id IS NULL`;

  const inventario = rows<FilaInventario>(
    await db.execute<FilaInventario>(sql`
      SELECT
        source,
        COUNT(*)                          AS n,
        MIN(created_at)::date             AS primero,
        MAX(created_at)::date             AS ultimo,
        SUM(length(content))              AS bytes
      FROM rag_chunks
      WHERE ${criterio}
      GROUP BY source
      ORDER BY COUNT(*) DESC
    `),
  );

  const total = inventario.reduce((a, f) => a + Number(f.n), 0);

  console.log('\n=== Uploads de cliente en el corpus GLOBAL (workspace_id NULL) ===\n');
  if (inventario.length === 0) {
    console.log('Ninguno. El corpus global no contiene documentos de cliente.\n');
    return;
  }

  for (const f of inventario) {
    console.log(
      `  ${String(f.n).padStart(6)} chunks  ${String(f.primero).slice(0, 10)} → ${String(f.ultimo).slice(0, 10)}  ` +
        `${(Number(f.bytes) / 1024).toFixed(0).padStart(6)} KB  ${f.source}`,
    );
  }
  console.log(
    `\n  TOTAL: ${total} chunks en ${inventario.length} documento(s).` +
      '\n  Cada uno es recuperable HOY por cualquier tenant via search_docs.\n',
  );

  // Contraste con el corpus normativo, para dimensionar el borrado.
  const [normativo] = rows<{ n: string }>(
    await db.execute<{ n: string }>(sql`
      SELECT COUNT(*) AS n FROM rag_chunks
      WHERE workspace_id IS NULL AND doc_type <> 'user_upload'
    `),
  );
  console.log(
    `  Corpus normativo global (NO se toca): ${normativo?.n ?? '?'} chunks.\n`,
  );

  if (!quiereBorrar) {
    console.log('MODO DRY-RUN. No se borro nada.');
    console.log(
      `Para borrar: --borrar --confirmar ${total}\n` +
        'Antes de hacerlo: estos documentos deben re-subirse por su dueno para\n' +
        'quedar indexados con workspace_id (hoy la libreria ya lo exige).\n',
    );
    return;
  }

  if (confirmado !== total) {
    console.error(
      `\nABORTADO: --confirmar ${Number.isNaN(confirmado) ? '(ausente)' : confirmado} ` +
        `no coincide con los ${total} chunks encontrados ahora.\n` +
        'Revisa el inventario de arriba y repite con el numero exacto.\n',
    );
    process.exitCode = 2;
    return;
  }

  const res = await db.execute(sql`DELETE FROM rag_chunks WHERE ${criterio}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const borrados = (res as any)?.rowCount ?? total;
  console.log(`\nBORRADOS ${borrados} chunks. El corpus normativo queda intacto.\n`);
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error('[rag-purge-orphan-uploads] fallo:', err);
    process.exit(1);
  });
