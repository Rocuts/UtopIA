// ---------------------------------------------------------------------------
// EL ESCUDO — Capa 2 Motor Normativo — Blacklist Validator (L3)
// ---------------------------------------------------------------------------
//
// Capa 3 (Defensa tributaria — Art. 647 E.T.):
//
// Escanea el texto completo en busca de citas TÓXICAS que NUNCA deben aparecer
// en la respuesta del Agente Fiscal. La blacklist no depende del catálogo —
// es un conjunto de patrones que el validator aplica antes de cualquier
// lookup en catálogo.
//
// Severidad → semántica para el orquestador:
//   CRITICA: aborta la respuesta del agente.
//   ALTA   : bloquea y fuerza regeneración.
//   MEDIA  : advierte; el revisor humano decide.
//
// Patrones tipo: derogados, inexequibles, conceptos DIAN no verificables en
// normograma, periodicidades eliminadas, artículos confundidos con otros,
// tarifas obsoletas.
//
// Cero LLM, cero red, cero filesystem. Determinístico.
// ---------------------------------------------------------------------------

import type { BlacklistEntry } from '../types';

export interface BlacklistViolation {
  /** Entrada blacklist que disparó la violación. */
  readonly entry: BlacklistEntry;
  /** Texto exacto que coincidió. */
  readonly match: string;
  /** Posición del match en el texto fuente. */
  readonly position: { readonly start: number; readonly end: number };
  /** Patrón regex que produjo el match (útil para debugging). */
  readonly patron: string;
}

// ---------------------------------------------------------------------------
// Implementación
// ---------------------------------------------------------------------------

/**
 * Compila los patrones de una entrada blacklist en regex con flag `gi`.
 *
 * Why try/catch: el catálogo es código del repo, pero compilar tantos regex
 * justifica una defensa contra errores tipográficos del autor del catálogo.
 * Un patrón malformado salta a la siguiente entrada sin abortar el scan.
 */
function compilePatterns(entry: BlacklistEntry): { source: string; re: RegExp }[] {
  const compiled: { source: string; re: RegExp }[] = [];
  for (const source of entry.patrones) {
    try {
      // `g` para iterar todos los matches; `i` para case-insensitive.
      compiled.push({ source, re: new RegExp(source, 'gi') });
    } catch {
      // Patrón inválido — se ignora silenciosamente.
    }
  }
  return compiled;
}

/**
 * Escanea el texto contra todos los patrones de todas las entradas blacklist.
 *
 * Reporta TODAS las violaciones, no solo la primera. El orquestador decide
 * cuántas tolera (por severidad).
 *
 * @param text       Texto a auditar (típicamente la respuesta del agente).
 * @param blacklist  Lista de entradas blacklist (inyectada del catálogo).
 * @returns          Array de violaciones encontradas, ordenadas por posición.
 */
export function checkBlacklist(
  text: string,
  blacklist: readonly BlacklistEntry[],
): BlacklistViolation[] {
  if (!text || text.length === 0) return [];
  if (blacklist.length === 0) return [];

  const violations: BlacklistViolation[] = [];

  for (const entry of blacklist) {
    const compiled = compilePatterns(entry);
    for (const { source, re } of compiled) {
      // Reset lastIndex en cada loop — el regex es local pero defensivo.
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        violations.push({
          entry,
          match: m[0],
          position: { start: m.index, end: m.index + m[0].length },
          patron: source,
        });
        // Avoid infinite loop on zero-length matches (edge case con regex mal escritos).
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    }
  }

  // Ordenar por posición y dedup por (entry.id, start) — el mismo texto puede
  // matchear dos patrones de la misma entrada (ej. "Art. 158-3" y "Artículo 158-3"
  // si el autor lista ambos). Mantenemos solo el primer hit por posición.
  const sorted = violations.slice().sort((a, b) => a.position.start - b.position.start);
  const seen = new Set<string>();
  const unique: BlacklistViolation[] = [];
  for (const v of sorted) {
    const key = `${v.entry.id}|${v.position.start}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(v);
  }
  return unique;
}

/**
 * Cuenta violaciones por severidad — útil para el resumen del reporte.
 */
export function summarizeBlacklistViolations(
  violations: readonly BlacklistViolation[],
): {
  total: number;
  critica: number;
  alta: number;
  media: number;
} {
  let critica = 0;
  let alta = 0;
  let media = 0;
  for (const v of violations) {
    switch (v.entry.severidad) {
      case 'CRITICA':
        critica++;
        break;
      case 'ALTA':
        alta++;
        break;
      case 'MEDIA':
        media++;
        break;
    }
  }
  return { total: violations.length, critica, alta, media };
}
