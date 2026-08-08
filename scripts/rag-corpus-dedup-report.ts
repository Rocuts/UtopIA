// ---------------------------------------------------------------------------
// rag-corpus-dedup-report — mide la duplicacion del corpus y su coste real en
// recuperacion.
// ---------------------------------------------------------------------------
//
// Hallazgo de partida: 71.273 chunks pero solo ~34.6k contenidos distintos
// (~51% duplicado). El numero por si solo no dice nada — lo que importa es
// cuanto de la ventana que ve el especialista se desperdicia repitiendo el
// mismo parrafo. Este script mide exactamente eso:
//
//   1. Duplicacion global y su forma (mismo `source` repetido = el ingest corrio
//      varias veces; `source` distintos = cita cruzada legitima entre normas).
//   2. Coste en recuperacion: cuantos de los K chunks que se entregan al
//      especialista son contenidos DISTINTOS, sobre consultas normativas reales,
//      corriendo la MISMA query hibrida de produccion.
//
// Solo LEE. No borra nada: el corpus normativo es el activo, y la deduplicacion
// correcta se hace en el ingest y en la query, no con un DELETE masivo.
//
// Uso:
//   npx dotenv -e .env.local -- npx tsx --tsconfig tsconfig.scripts.json \
//     scripts/rag-corpus-dedup-report.ts [--k 8]
// ---------------------------------------------------------------------------

import { sql } from 'drizzle-orm';
import { embedMany } from 'ai';
import { openai } from '@ai-sdk/openai';
import { getDb } from '@/lib/db/client';
import { MODEL_IDS } from '@/lib/config/models';

const CONSULTAS: readonly string[] = [
  'tarifa general del impuesto sobre la renta para personas juridicas',
  'retencion en la fuente por servicios a favor de declarantes',
  'requisitos de la factura electronica de venta y documento soporte',
  'plazos para declarar y pagar renta de personas juridicas',
  'sancion por extemporaneidad en la presentacion de la declaracion',
  'descuento tributario por donaciones a entidades sin animo de lucro',
  'requisitos para pertenecer al regimen simple de tributacion',
  'deducibilidad de pagos laborales y aportes parafiscales',
  'termino de firmeza de las declaraciones tributarias',
  'obligados a presentar informacion exogena a la DIAN',
];

const args = process.argv.slice(2);
const idxK = args.indexOf('--k');
const K = idxK >= 0 ? Number(args[idxK + 1]) : 8;

// Mismos parametros que `src/lib/rag/vectorstore.ts`.
const PER_CHANNEL_LIMIT = 30;
const RRF_K = 60;
const MIN_COSINE_SIMILARITY = Number(process.env.RAG_MIN_COSINE_SIMILARITY ?? '0.48');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rows<T>(res: any): T[] {
  const data = res?.rows ?? res;
  return Array.isArray(data) ? (data as T[]) : [];
}

async function main() {
  const db = getDb();

  // -------------------------------------------------------------------------
  // 1. Duplicacion global
  // -------------------------------------------------------------------------
  const [glob] = rows<{ total: string; unicos: string }>(
    await db.execute<{ total: string; unicos: string }>(sql`
      SELECT COUNT(*) AS total, COUNT(DISTINCT md5(content)) AS unicos
      FROM rag_chunks WHERE workspace_id IS NULL
    `),
  );
  const total = Number(glob?.total ?? 0);
  const unicos = Number(glob?.unicos ?? 0);

  console.log('\n=== Duplicacion del corpus global ==========================');
  console.log(
    `  ${total} chunks · ${unicos} contenidos distintos · ` +
      `${(((total - unicos) / total) * 100).toFixed(1)}% redundante`,
  );

  // Forma de la duplicacion: ¿el mismo documento repetido, o el mismo texto en
  // documentos distintos? Determina el arreglo (idempotencia del ingest vs.
  // deduplicacion en la query).
  const [forma] = rows<{ intra: string; inter: string }>(
    await db.execute<{ intra: string; inter: string }>(sql`
      SELECT
        SUM(CASE WHEN fuentes = 1 THEN copias - 1 ELSE 0 END) AS intra,
        SUM(CASE WHEN fuentes > 1 THEN copias - 1 ELSE 0 END) AS inter
      FROM (
        SELECT md5(content) AS h, COUNT(*) AS copias, COUNT(DISTINCT source) AS fuentes
        FROM rag_chunks WHERE workspace_id IS NULL
        GROUP BY md5(content) HAVING COUNT(*) > 1
      ) g
    `),
  );
  console.log(
    `  copias sobrantes dentro del MISMO source: ${forma?.intra ?? 0}  ` +
      `(ingest no idempotente)`,
  );
  console.log(
    `  copias sobrantes entre sources DISTINTOS: ${forma?.inter ?? 0}  ` +
      `(texto compartido entre normas)`,
  );

  const peores = rows<{ source: string; total: string; unicos: string }>(
    await db.execute<{ source: string; total: string; unicos: string }>(sql`
      SELECT source, COUNT(*) AS total, COUNT(DISTINCT md5(content)) AS unicos
      FROM rag_chunks WHERE workspace_id IS NULL
      GROUP BY source
      HAVING COUNT(*) - COUNT(DISTINCT md5(content)) > 0
      ORDER BY COUNT(*) - COUNT(DISTINCT md5(content)) DESC
      LIMIT 10
    `),
  );
  console.log('\n  Peores documentos (chunks / distintos):');
  for (const p of peores) {
    console.log(
      `    ${String(p.total).padStart(6)} / ${String(p.unicos).padStart(6)}   ${p.source}`,
    );
  }

  // -------------------------------------------------------------------------
  // 2. Coste real en recuperacion — query hibrida identica a produccion
  // -------------------------------------------------------------------------
  const { embeddings } = await embedMany({
    model: openai.embedding(MODEL_IDS.EMBEDDINGS),
    values: [...CONSULTAS],
    maxParallelCalls: 5,
  });

  console.log(`\n=== Coste en la ventana del especialista (top-${K}) ==========`);
  let sumaUnicos = 0;
  let sumaEntregados = 0;
  let sumaUnicosDedup = 0;

  for (let i = 0; i < CONSULTAS.length; i++) {
    const embLiteral = `[${embeddings[i].join(',')}]`;
    const query = CONSULTAS[i];
    const res = rows<{ huella: string; source: string }>(
      await db.execute<{ huella: string; source: string }>(sql`
        WITH vector_hits AS (
          SELECT id, dist, ROW_NUMBER() OVER (ORDER BY dist ASC) AS rnk
          FROM (
            SELECT id, embedding <=> ${embLiteral}::vector AS dist
            FROM rag_chunks WHERE workspace_id IS NULL
            ORDER BY embedding <=> ${embLiteral}::vector ASC
            LIMIT ${PER_CHANNEL_LIMIT}
          ) v WHERE v.dist <= ${1 - MIN_COSINE_SIMILARITY}
        ),
        lex_hits AS (
          SELECT id, ROW_NUMBER() OVER (ORDER BY lex_rank DESC) AS rnk
          FROM (
            SELECT id, ts_rank(tsv, plainto_tsquery('spanish', ${query})) AS lex_rank
            FROM rag_chunks
            WHERE workspace_id IS NULL AND tsv @@ plainto_tsquery('spanish', ${query})
            ORDER BY ts_rank(tsv, plainto_tsquery('spanish', ${query})) DESC
            LIMIT ${PER_CHANNEL_LIMIT}
          ) l
        ),
        fused AS (
          SELECT id, SUM(score) AS rrf_score FROM (
            SELECT id, 1.0 / (${RRF_K} + rnk) AS score FROM vector_hits
            UNION ALL
            SELECT id, 1.0 / (${RRF_K} + rnk) AS score FROM lex_hits
          ) s GROUP BY id
        )
        SELECT md5(c.content) AS huella, c.source
        FROM fused JOIN rag_chunks c ON c.id = fused.id
        ORDER BY fused.rrf_score DESC
        LIMIT ${K}
      `),
    );
    const distintos = new Set(res.map((r) => r.huella)).size;
    sumaUnicos += distintos;
    sumaEntregados += res.length;

    // Contraste con la query VIGENTE (con `DISTINCT ON (md5(content))`), para
    // que el reporte muestre el antes y el despues sobre los mismos datos.
    const dedup = rows<{ huella: string }>(
      await db.execute<{ huella: string }>(sql`
        WITH vector_hits AS (
          SELECT id, dist, ROW_NUMBER() OVER (ORDER BY dist ASC) AS rnk
          FROM (
            SELECT id, embedding <=> ${embLiteral}::vector AS dist
            FROM rag_chunks WHERE workspace_id IS NULL
            ORDER BY embedding <=> ${embLiteral}::vector ASC
            LIMIT ${PER_CHANNEL_LIMIT}
          ) v WHERE v.dist <= ${1 - MIN_COSINE_SIMILARITY}
        ),
        lex_hits AS (
          SELECT id, ROW_NUMBER() OVER (ORDER BY lex_rank DESC) AS rnk
          FROM (
            SELECT id, ts_rank(tsv, plainto_tsquery('spanish', ${query})) AS lex_rank
            FROM rag_chunks
            WHERE workspace_id IS NULL AND tsv @@ plainto_tsquery('spanish', ${query})
            ORDER BY ts_rank(tsv, plainto_tsquery('spanish', ${query})) DESC
            LIMIT ${PER_CHANNEL_LIMIT}
          ) l
        ),
        fused AS (
          SELECT id, SUM(score) AS rrf_score FROM (
            SELECT id, 1.0 / (${RRF_K} + rnk) AS score FROM vector_hits
            UNION ALL
            SELECT id, 1.0 / (${RRF_K} + rnk) AS score FROM lex_hits
          ) s GROUP BY id
        )
        SELECT * FROM (
          SELECT DISTINCT ON (md5(c.content)) md5(c.content) AS huella, fused.rrf_score
          FROM fused
          JOIN rag_chunks c ON c.id = fused.id
          LEFT JOIN vector_hits ON vector_hits.id = fused.id
          ORDER BY md5(c.content), fused.rrf_score DESC, vector_hits.dist ASC NULLS LAST
        ) d
        ORDER BY d.rrf_score DESC
        LIMIT ${K}
      `),
    );
    const distintosDedup = new Set(dedup.map((r) => r.huella)).size;
    sumaUnicosDedup += distintosDedup;

    console.log(
      `  sin dedup ${String(distintos).padStart(2)}/${String(res.length).padEnd(2)} · ` +
        `con dedup ${String(distintosDedup).padStart(2)}/${String(dedup.length).padEnd(2)}  ${query.slice(0, 46)}`,
    );
  }

  const desperdicio = sumaEntregados > 0 ? 1 - sumaUnicos / sumaEntregados : 0;
  console.log(
    `\n  SIN dedup: ${(sumaUnicos / CONSULTAS.length).toFixed(1)}/${K} contenidos distintos ` +
      `⇒ ${(desperdicio * 100).toFixed(0)}% de la ventana era texto repetido.`,
  );
  console.log(
    `  CON dedup (query vigente): ${(sumaUnicosDedup / CONSULTAS.length).toFixed(1)}/${K} contenidos distintos.`,
  );

  console.log(`
=== Arreglo propuesto (NO se aplica aqui) ====================
  1. [PENDIENTE — fuera de esta frontera] Idempotencia del ingest: indice unico sobre (source, md5(content)) —
     o UPSERT por esa clave — para que re-correr \`npm run db:ingest\` deje de
     acumular copias. Es la causa de las copias intra-source.
  2. [APLICADO] Deduplicacion en la query: \`DISTINCT ON (md5(content))\` en el
     SELECT final de \`hybridSearch\`, conservando el de mayor rrf_score.
     Arregla el sintoma sin tocar el corpus y sirve tambien para las copias
     inter-source, legitimas en la tabla pero ruido en la ventana del LLM.
  3. Recalibrar el umbral despues de (1): con menos duplicados el top-30 cubre
     mas documentos distintos y la distribucion de similaridad cambia.

  NO borrar filas del corpus normativo a mano: sin el indice unico de (1) el
  siguiente ingest las repone.
`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[rag-corpus-dedup-report] fallo:', err);
    process.exit(1);
  });
