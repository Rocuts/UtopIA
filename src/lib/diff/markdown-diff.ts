// ---------------------------------------------------------------------------
// Markdown line-level diff (Phase 3 hook 3 — Doctor de Datos)
// ---------------------------------------------------------------------------
// Util pura, cero dependencias. Algoritmo LCS clasico O(n*m) en espacio y
// tiempo, suficiente para reportes de hasta ~5K lineas (que es el orden de
// magnitud que produce el financial pipeline). Si en el futuro se proyectan
// reportes >10K lineas, considerar Hunt-Szymanski o Myers diff.
//
// Estrategia:
//   1. Split de ambos documentos por '\n'.
//   2. DP table tabla[i][j] = LCS de before[..i] y after[..j], en Uint32Array
//      lineal indexado como [i*(M+1)+j] para minimizar GC.
//   3. Backtrace desde (N,M) emitiendo segmentos:
//        - match  -> 'unchanged'
//        - skip i -> 'removed'
//        - skip j -> 'added'
//   4. Reverse al final para devolverlos en orden secuencial.
//
// NO mergea segmentos adyacentes — el componente los pinta linea por linea.
// ---------------------------------------------------------------------------

export interface DiffSegment {
  type: 'unchanged' | 'added' | 'removed';
  /** Texto sin newline final. */
  content: string;
  /** Linea en el documento BEFORE (1-indexed). undefined si type === 'added'. */
  beforeLine?: number;
  /** Linea en el documento AFTER (1-indexed). undefined si type === 'removed'. */
  afterLine?: number;
}

export interface DiffResult {
  segments: DiffSegment[];
  stats: {
    /** # de lineas added. */
    added: number;
    /** # de lineas removed. */
    removed: number;
    /** # de lineas unchanged. */
    unchanged: number;
  };
}

/**
 * Compara dos documentos Markdown linea por linea y devuelve los segmentos
 * en orden secuencial (mezcla de unchanged / added / removed).
 *
 * Casos limite:
 *   - before === after  -> todos unchanged.
 *   - before === ''     -> todos added.
 *   - after === ''      -> todos removed.
 *   - ambos vacios      -> stats en cero, segments en cero.
 */
export function diffMarkdown(before: string, after: string): DiffResult {
  // Documentos identicos: shortcut O(n) sin DP.
  if (before === after) {
    if (before.length === 0) {
      return { segments: [], stats: { added: 0, removed: 0, unchanged: 0 } };
    }
    const lines = before.split('\n');
    return {
      segments: lines.map((content, i) => ({
        type: 'unchanged' as const,
        content,
        beforeLine: i + 1,
        afterLine: i + 1,
      })),
      stats: { added: 0, removed: 0, unchanged: lines.length },
    };
  }

  const beforeLines = before === '' ? [] : before.split('\n');
  const afterLines = after === '' ? [] : after.split('\n');
  const N = beforeLines.length;
  const M = afterLines.length;

  // Edge case: uno de los dos vacio -> trivial.
  if (N === 0) {
    return {
      segments: afterLines.map((content, i) => ({
        type: 'added' as const,
        content,
        afterLine: i + 1,
      })),
      stats: { added: M, removed: 0, unchanged: 0 },
    };
  }
  if (M === 0) {
    return {
      segments: beforeLines.map((content, i) => ({
        type: 'removed' as const,
        content,
        beforeLine: i + 1,
      })),
      stats: { added: 0, removed: N, unchanged: 0 },
    };
  }

  // ---------------------------------------------------------------------
  // LCS DP. Indexamos lineal: dp[i*(M+1)+j].
  // ---------------------------------------------------------------------
  const stride = M + 1;
  const dp = new Uint32Array((N + 1) * stride);

  for (let i = 1; i <= N; i++) {
    const bi = beforeLines[i - 1];
    const rowBase = i * stride;
    const prevRowBase = (i - 1) * stride;
    for (let j = 1; j <= M; j++) {
      if (bi === afterLines[j - 1]) {
        dp[rowBase + j] = dp[prevRowBase + (j - 1)] + 1;
      } else {
        const up = dp[prevRowBase + j];
        const left = dp[rowBase + (j - 1)];
        dp[rowBase + j] = up >= left ? up : left;
      }
    }
  }

  // ---------------------------------------------------------------------
  // Backtrace. Empieza en (N,M), emite segmentos, reverse al final.
  // ---------------------------------------------------------------------
  const reversed: DiffSegment[] = [];
  let added = 0;
  let removed = 0;
  let unchanged = 0;
  let i = N;
  let j = M;

  while (i > 0 && j > 0) {
    if (beforeLines[i - 1] === afterLines[j - 1]) {
      reversed.push({
        type: 'unchanged',
        content: beforeLines[i - 1],
        beforeLine: i,
        afterLine: j,
      });
      unchanged++;
      i--;
      j--;
    } else {
      const up = dp[(i - 1) * stride + j];
      const left = dp[i * stride + (j - 1)];
      if (up >= left) {
        reversed.push({
          type: 'removed',
          content: beforeLines[i - 1],
          beforeLine: i,
        });
        removed++;
        i--;
      } else {
        reversed.push({
          type: 'added',
          content: afterLines[j - 1],
          afterLine: j,
        });
        added++;
        j--;
      }
    }
  }

  while (i > 0) {
    reversed.push({
      type: 'removed',
      content: beforeLines[i - 1],
      beforeLine: i,
    });
    removed++;
    i--;
  }
  while (j > 0) {
    reversed.push({
      type: 'added',
      content: afterLines[j - 1],
      afterLine: j,
    });
    added++;
    j--;
  }

  reversed.reverse();
  return {
    segments: reversed,
    stats: { added, removed, unchanged },
  };
}
