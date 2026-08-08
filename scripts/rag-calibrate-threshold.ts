// ---------------------------------------------------------------------------
// rag-calibrate-threshold — calibra MIN_COSINE_SIMILARITY contra el corpus real
// ---------------------------------------------------------------------------
//
// Por que existe: `MIN_COSINE_SIMILARITY` en `src/lib/rag/vectorstore.ts` nacio
// como 0.30 "conservador" SIN medicion. El modo de fallo de un umbral mal
// puesto no es un error visible sino silencioso:
//
//   - demasiado bajo  ⇒ el canal vectorial devuelve SIEMPRE sus 30 vecinos mas
//     cercanos, `NO_RESULTS` es inalcanzable y el especialista recibe ruido
//     rotulado "Fuente:" (alucinacion con apariencia de cita).
//   - demasiado alto  ⇒ consultas normativas legitimas caen a `search_web` y
//     perdemos el corpus curado.
//
// Metodo: dos conjuntos de consultas etiquetados a mano — normativa colombiana
// real vs. consultas-ruido de control (cocina, mecanica, musica...) que el
// corpus NO puede responder. Para cada una se mide la distribucion de
// similaridad coseno del canal vectorial SIN umbral, y se busca el corte que
// separa ambas poblaciones (estadistico de Youden sobre la similaridad top-1).
//
// Uso:
//   npx dotenv -e .env.local -- npx tsx --tsconfig tsconfig.scripts.json \
//     scripts/rag-calibrate-threshold.ts [--k 30] [--json]
//
// Solo LEE. No escribe una sola fila.
// ---------------------------------------------------------------------------

import { sql } from 'drizzle-orm';
import { embedMany } from 'ai';
import { openai } from '@ai-sdk/openai';
import { getDb } from '@/lib/db/client';
import { MODEL_IDS } from '@/lib/config/models';

// ---------------------------------------------------------------------------
// Conjuntos de evaluacion
// ---------------------------------------------------------------------------

/**
 * Consultas que el corpus SI debe poder responder (E.T., decretos, NIIF,
 * resoluciones DIAN). Redactadas como las escribe un agente especialista, no
 * como keywords sueltas: el umbral se calibra sobre el trafico real.
 */
const CONSULTAS_NORMATIVAS: readonly string[] = [
  'tarifa general del impuesto sobre la renta para personas juridicas',
  'retencion en la fuente por servicios a favor de declarantes',
  'requisitos de la factura electronica de venta y documento soporte',
  'reconocimiento del impuesto diferido bajo NIIF para Pymes',
  'plazos para declarar y pagar renta de personas juridicas',
  'sancion por extemporaneidad en la presentacion de la declaracion',
  'base gravable del impuesto de industria y comercio',
  'descuento tributario por donaciones a entidades sin animo de lucro',
  'requisitos para pertenecer al regimen simple de tributacion',
  'deducibilidad de pagos laborales y aportes parafiscales',
  'IVA en la venta de bienes inmuebles y bienes excluidos',
  'documentacion comprobatoria de precios de transferencia',
  'termino de firmeza de las declaraciones tributarias',
  'medicion posterior de propiedad planta y equipo bajo NIIF',
  'obligados a presentar informacion exogena a la DIAN',
  // Consultas CORTAS estilo tool-call: los especialistas mandan a menudo la
  // cita pelada. Son el extremo bajo de la distribucion normativa y por tanto
  // las que fijan el techo del umbral; sin ellas la calibracion es optimista.
  'Art. 240 E.T. tarifa',
  'Art. 647 E.T. sancion por inexactitud',
  'articulo 771-5 bancarizacion',
  'retencion ICA Bogota',
  'NIIF 16 arrendamientos',
];

/**
 * Consultas-ruido de control. Ninguna tiene respuesta en un corpus tributario
 * colombiano; TODO chunk que el canal vectorial devuelva para estas es un falso
 * positivo. Son el piso empirico del umbral.
 */
const CONSULTAS_RUIDO: readonly string[] = [
  'receta de arepas de choclo con queso',
  'como entrenar a un cachorro golden retriever',
  'temperatura y tiempo de coccion del salmon al horno',
  'mejores playas de tailandia en temporada seca',
  'como cambiar la correa de distribucion de un renault clio',
  'letra de la cancion bohemian rhapsody',
  'alineacion titular de la seleccion en el ultimo mundial',
  'instrucciones para armar un mueble de melamina',
  'historia de la dinastia ming en china',
  'como configurar un router wifi de doble banda en casa',
  // Ruido ADVERSARIAL: temas administrativos/sanitarios colombianos que rozan
  // el vocabulario del corpus (que incluye Codigo Penal, Codigo de Minas, ley
  // del deporte, resoluciones de MinSalud y MinMinas). Son el peor caso
  // realista y fijan el piso del umbral.
  'sintomas del dengue y cuando acudir al medico',
  'como sacar cita para renovar el pasaporte',
  'que ejercicios fortalecen la espalda baja',
  'cual es la mejor epoca para vacacionar en cartagena',
  'como preparar cafe filtrado en casa',
  'reglas basicas del poker texas holdem',
];

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const kArgIdx = args.indexOf('--k');
const TOP_K = kArgIdx >= 0 ? Number(args[kArgIdx + 1]) : 30;

// ---------------------------------------------------------------------------
// Medicion
// ---------------------------------------------------------------------------

interface MedicionConsulta {
  query: string;
  etiqueta: 'normativa' | 'ruido';
  /** Similaridades coseno del canal vectorial, orden descendente. */
  sims: number[];
  /** Similaridad coseno de los hits que SOLO entran por el canal lexico. */
  simsLexicos: number[];
  /** Chunks distintos por contenido dentro del top-K (impacto de duplicados). */
  contenidosUnicos: number;
}

async function medirConsulta(
  query: string,
  embedding: number[],
  etiqueta: 'normativa' | 'ruido',
): Promise<MedicionConsulta> {
  const db = getDb();
  const embLiteral = `[${embedding.join(',')}]`;

  // Canal vectorial SIN umbral: queremos ver la distribucion completa, que es
  // exactamente lo que el codigo de produccion oculta al filtrar.
  const vecRes = await db.execute<{ sim: number; huella: string }>(sql`
    SELECT 1 - (embedding <=> ${embLiteral}::vector) AS sim, md5(content) AS huella
    FROM rag_chunks
    WHERE workspace_id IS NULL
    ORDER BY embedding <=> ${embLiteral}::vector ASC
    LIMIT ${TOP_K}
  `);
  const vecRows = normalizeRows<{ sim: number; huella: string }>(vecRes);

  // Canal lexico: los chunks que entran por BM25 pueden llegar al especialista
  // sin ninguna prueba semantica. Medimos su coseno para saber si un gate
  // post-fusion los mataria injustamente.
  const lexRes = await db.execute<{ sim: number }>(sql`
    SELECT 1 - (embedding <=> ${embLiteral}::vector) AS sim
    FROM rag_chunks
    WHERE workspace_id IS NULL
      AND tsv @@ plainto_tsquery('spanish', ${query})
    ORDER BY ts_rank(tsv, plainto_tsquery('spanish', ${query})) DESC
    LIMIT ${TOP_K}
  `);
  const lexRows = normalizeRows<{ sim: number }>(lexRes);

  return {
    query,
    etiqueta,
    sims: vecRows.map((r) => Number(r.sim)),
    simsLexicos: lexRows.map((r) => Number(r.sim)),
    contenidosUnicos: new Set(vecRows.map((r) => r.huella)).size,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeRows<T>(res: any): T[] {
  const data = res?.rows ?? res;
  return Array.isArray(data) ? (data as T[]) : [];
}

function percentil(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(3) : 'n/a');

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const todas = [
    ...CONSULTAS_NORMATIVAS.map((q) => ({ q, etiqueta: 'normativa' as const })),
    ...CONSULTAS_RUIDO.map((q) => ({ q, etiqueta: 'ruido' as const })),
  ];

  const { embeddings } = await embedMany({
    model: openai.embedding(MODEL_IDS.EMBEDDINGS),
    values: todas.map((t) => t.q),
    maxParallelCalls: 5,
  });

  const mediciones: MedicionConsulta[] = [];
  for (let i = 0; i < todas.length; i++) {
    mediciones.push(await medirConsulta(todas[i].q, embeddings[i], todas[i].etiqueta));
  }

  const norm = mediciones.filter((m) => m.etiqueta === 'normativa');
  const ruido = mediciones.filter((m) => m.etiqueta === 'ruido');

  const top1Norm = norm.map((m) => m.sims[0] ?? 0);
  const top1Ruido = ruido.map((m) => m.sims[0] ?? 0);
  const todosNorm = norm.flatMap((m) => m.sims);
  const todosRuido = ruido.flatMap((m) => m.sims);

  // -------------------------------------------------------------------------
  // Barrido de umbrales: para cada candidato medimos
  //   - cobertura   : % de consultas normativas que conservan >=1 chunk
  //   - fuga        : % de consultas-ruido que conservan >=1 chunk
  //   - chunks/query: cuantos sobreviven en promedio (recall util)
  // El corte optimo maximiza Youden J = cobertura - fuga.
  // -------------------------------------------------------------------------
  const candidatos: number[] = [];
  for (let t = 0.20; t <= 0.70001; t += 0.01) candidatos.push(Number(t.toFixed(2)));

  const barrido = candidatos.map((t) => {
    const cobertura = norm.filter((m) => m.sims.some((s) => s >= t)).length / norm.length;
    const fuga = ruido.filter((m) => m.sims.some((s) => s >= t)).length / ruido.length;
    const chunksNorm =
      norm.reduce((acc, m) => acc + m.sims.filter((s) => s >= t).length, 0) / norm.length;
    const chunksRuido =
      ruido.reduce((acc, m) => acc + m.sims.filter((s) => s >= t).length, 0) / ruido.length;
    return { t, cobertura, fuga, chunksNorm, chunksRuido, j: cobertura - fuga };
  });

  const mejorJ = Math.max(...barrido.map((b) => b.j));
  // Entre los empatados en J, el MENOR umbral: preferimos recall cuando la
  // separacion ya es perfecta (un chunk de mas lo filtra el rerank/LLM; un
  // chunk de menos es normativa que el agente nunca ve).
  const optimo = barrido.find((b) => b.j === mejorJ)!;
  // Umbral que ademas mantiene cobertura total, si existe.
  const conservador = barrido
    .filter((b) => b.cobertura === 1)
    .reduce((best, b) => (b.fuga < best.fuga || (b.fuga === best.fuga && b.t > best.t) ? b : best), {
      t: 0,
      cobertura: 1,
      fuga: 1,
      chunksNorm: 0,
      chunksRuido: 0,
      j: 0,
    });

  const resumen = {
    corpusTopK: TOP_K,
    normativas: norm.length,
    ruido: ruido.length,
    top1: {
      normativa: {
        min: Math.min(...top1Norm),
        p05: percentil(top1Norm, 5),
        mediana: percentil(top1Norm, 50),
        max: Math.max(...top1Norm),
      },
      ruido: {
        min: Math.min(...top1Ruido),
        mediana: percentil(top1Ruido, 50),
        p95: percentil(top1Ruido, 95),
        max: Math.max(...top1Ruido),
      },
    },
    todosLosHits: {
      normativa: { mediana: percentil(todosNorm, 50), p95: percentil(todosNorm, 95) },
      ruido: { mediana: percentil(todosRuido, 50), p95: percentil(todosRuido, 95) },
    },
    canalLexico: {
      // Cuantas consultas producen AL MENOS un hit lexico. Si el ruido produce
      // cero, `plainto_tsquery` (semantica AND entre lexemas) ya es un gate
      // fuerte y no hace falta castigar a los hits solo-lexicos con el umbral
      // coseno — que les costaria recall real (ver p05 abajo).
      normativaConHits: norm.filter((m) => m.simsLexicos.length > 0).length,
      ruidoConHits: ruido.filter((m) => m.simsLexicos.length > 0).length,
      hitsPromedioNormativa: norm.reduce((a, m) => a + m.simsLexicos.length, 0) / norm.length,
      hitsPromedioRuido: ruido.reduce((a, m) => a + m.simsLexicos.length, 0) / ruido.length,
      cosenoNormativa: {
        p05: percentil(norm.flatMap((m) => m.simsLexicos), 5),
        mediana: percentil(norm.flatMap((m) => m.simsLexicos), 50),
      },
      cosenoRuidoMax: Math.max(0, ...ruido.flatMap((m) => m.simsLexicos)),
    },
    duplicacion: {
      chunksUnicosPromedioEnTopK:
        mediciones.reduce((a, m) => a + m.contenidosUnicos, 0) / mediciones.length,
      topK: TOP_K,
    },
    umbralOptimoYouden: optimo,
    umbralCoberturaTotal: conservador,
  };

  if (asJson) {
    console.log(JSON.stringify({ resumen, mediciones }, null, 2));
    return;
  }

  console.log('\n=== Similaridad top-1 por consulta =========================');
  for (const m of mediciones) {
    console.log(
      `${m.etiqueta === 'ruido' ? '[RUIDO] ' : '[NORMA] '}` +
        `top1=${fmt(m.sims[0] ?? NaN)} top5=${fmt(m.sims[4] ?? NaN)} ` +
        `top${TOP_K}=${fmt(m.sims[m.sims.length - 1] ?? NaN)} ` +
        `unicos=${m.contenidosUnicos}/${m.sims.length}  ${m.query.slice(0, 62)}`,
    );
  }

  console.log('\n=== Distribuciones =========================================');
  console.log(
    `normativa top1: min=${fmt(resumen.top1.normativa.min)} p05=${fmt(resumen.top1.normativa.p05)} ` +
      `mediana=${fmt(resumen.top1.normativa.mediana)} max=${fmt(resumen.top1.normativa.max)}`,
  );
  console.log(
    `ruido     top1: min=${fmt(resumen.top1.ruido.min)} mediana=${fmt(resumen.top1.ruido.mediana)} ` +
      `p95=${fmt(resumen.top1.ruido.p95)} max=${fmt(resumen.top1.ruido.max)}`,
  );
  console.log(
    `canal lexico: consultas con >=1 hit ⇒ normativa ${resumen.canalLexico.normativaConHits}/${norm.length} ` +
      `(${resumen.canalLexico.hitsPromedioNormativa.toFixed(1)} hits/consulta) | ` +
      `ruido ${resumen.canalLexico.ruidoConHits}/${ruido.length} ` +
      `(${resumen.canalLexico.hitsPromedioRuido.toFixed(1)} hits/consulta)`,
  );
  console.log(
    `coseno de hits lexicos: normativa p05=${fmt(resumen.canalLexico.cosenoNormativa.p05)} ` +
      `mediana=${fmt(resumen.canalLexico.cosenoNormativa.mediana)} | ruido max=${fmt(resumen.canalLexico.cosenoRuidoMax)}`,
  );

  console.log('\n=== Barrido de umbral ======================================');
  console.log('  τ     cobertura(normativa)  fuga(ruido)  chunks/norm  chunks/ruido');
  for (const b of barrido) {
    if (Math.round(b.t * 100) % 2 !== 0) continue; // imprime cada 0.02 para no inundar
    console.log(
      `  ${b.t.toFixed(2)}      ${(b.cobertura * 100).toFixed(0).padStart(3)}%              ` +
        `${(b.fuga * 100).toFixed(0).padStart(3)}%        ${b.chunksNorm.toFixed(1).padStart(5)}       ${b.chunksRuido.toFixed(1)}`,
    );
  }

  console.log('\n=== Propuesta ==============================================');
  console.log(
    `Youden optimo: τ=${optimo.t.toFixed(2)} (cobertura ${(optimo.cobertura * 100).toFixed(0)}%, ` +
      `fuga ${(optimo.fuga * 100).toFixed(0)}%, ${optimo.chunksNorm.toFixed(1)} chunks/consulta normativa)`,
  );
  console.log(
    `Cobertura total: τ=${conservador.t.toFixed(2)} (fuga ${(conservador.fuga * 100).toFixed(0)}%)`,
  );
  console.log(
    `Duplicados: en el top-${TOP_K} solo ${resumen.duplicacion.chunksUnicosPromedioEnTopK.toFixed(1)} ` +
      `contenidos son distintos en promedio.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[rag-calibrate-threshold] fallo:', err);
    process.exit(1);
  });
