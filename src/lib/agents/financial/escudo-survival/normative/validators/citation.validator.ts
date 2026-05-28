// ---------------------------------------------------------------------------
// EL ESCUDO — Capa 2 Motor Normativo — Citation Validator (L1 + L2)
// ---------------------------------------------------------------------------
//
// Capa 1 (Sintaxis):
//   - Extrae citas normativas del texto con regex conservadores.
//   - Normaliza variantes ("Art 240", "Art. 240 E.T.", "Articulo 240 ET") a una
//     forma canónica única.
//   - Determinístico, sin LLM, sin red, sin filesystem.
//
// Capa 2 (Catálogo):
//   - Busca cada cita en el catálogo inyectado (dependency injection).
//   - Si está → reporta estado (VIGENTE_2026 / DEROGADO / INEXEQUIBLE / ...).
//   - Si no está → veredicto bloqueo (NO_VERIFICADO).
//   - Si matchea blacklist → reporta entrada y severidad.
//
// El catálogo NO se importa estáticamente desde catalog/** — se inyecta como
// parámetro. Los tests usan fixtures sintéticos.
//
// Forma canónica (normalized):
//   articulo_et      → "Art. 240 E.T."  |  "Art. 240 par. 2 E.T."  |  "Art. 240-1 E.T."
//   ley              → "Ley 2277 de 2022"
//   decreto          → "Decreto 1474 de 2025"
//   concepto_dian    → "Concepto Unificado DIAN 202(006038) de 2024" | "Concepto DIAN 1352 de 2018"
//   sentencia_corte  → "Sentencia C-079 de 2026"
//   niif_pymes       → "NIIF para PYMES §29"
//   nic              → "NIC 12"
//   nia              → "NIA 705"
//   resolucion_dian  → "Resolución DIAN 000238 de 2025"
// ---------------------------------------------------------------------------

import type {
  NormativeCatalogue,
  NormativeCitationKind,
  ParsedCitation,
  CitationCheckResult,
  BlacklistEntry,
} from '../types';

// ---------------------------------------------------------------------------
// Patrones regex por tipo de cita
// ---------------------------------------------------------------------------
//
// Why regex conservadores: un falso positivo (extraer "Art. 5 del contrato"
// como cita E.T.) contamina el reporte. Mejor no detectar variantes raras que
// reportar citas inexistentes.
//
// `g` siempre — necesitamos múltiples matches por texto.
// `i` siempre — variantes mayúscula/minúscula. La normalización canoniciza.
// ---------------------------------------------------------------------------

interface CitationPattern {
  readonly kind: NormativeCitationKind;
  readonly regex: RegExp;
  /** Transforma el match raw a la forma canónica. */
  readonly normalize: (match: RegExpExecArray) => string;
}

/**
 * articulo_et
 * Captura:
 *   "Art. 240 E.T.", "Art 240 ET", "Artículo 240 del Estatuto Tributario",
 *   "Art. 240-1 E.T." (separador "-" preserva el número compuesto),
 *   "Art. 240 par. 2 E.T.", "Art. 240 §2 E.T.", "Art. 240 parágrafo 2 E.T."
 *
 * Importante: "Art. 240" y "Art. 240-1" son artículos DISTINTOS. El grupo
 * (\d+(?:-\d+)?) preserva la diferencia. "Art. 240 par. 2" vs "Art. 240 §2"
 * son la misma entrada — la normalización los unifica a "Art. 240 par. 2 E.T.".
 */
const ART_ET_PATTERN: CitationPattern = {
  kind: 'articulo_et',
  // Grupos:
  //   1 = número del artículo (con sufijo "-N" opcional)
  //   2 = parágrafo (par., §, parágrafo) opcional
  regex: /\b(?:Art(?:[íi]culo|\.)?|Articulo)\s*(\d+(?:-\d+)?)(?:\s*(?:par(?:\.|[áa]grafo)?|§)\s*(\d+))?\s*(?:E\.?\s*T\.?|del?\s+Estatuto\s+Tributario)\b/gi,
  normalize: (m) => {
    const num = m[1];
    const par = m[2];
    return par ? `Art. ${num} par. ${par} E.T.` : `Art. ${num} E.T.`;
  },
};

/**
 * ley
 * Captura: "Ley 2277 de 2022", "Ley 2277/2022", "Ley 1819 del 2016".
 */
const LEY_PATTERN: CitationPattern = {
  kind: 'ley',
  regex: /\bLey\s+(\d+)\s*(?:de\s+|del\s+|\/)\s*(\d{4})\b/gi,
  normalize: (m) => `Ley ${m[1]} de ${m[2]}`,
};

/**
 * decreto
 * Captura: "Decreto 1474 de 2025", "Decreto 1625/2016".
 * NO captura "Decreto Legislativo 1474" (DL es otra cosa) — pero la blacklist
 * sí incluye un patrón para "DL 1474".
 */
const DECRETO_PATTERN: CitationPattern = {
  kind: 'decreto',
  regex: /\bDecreto\s+(\d+)\s*(?:de\s+|del\s+|\/)\s*(\d{4})\b/gi,
  normalize: (m) => `Decreto ${m[1]} de ${m[2]}`,
};

/**
 * concepto_dian
 * Captura:
 *   "Concepto Unificado DIAN 202(006038) de 2024"
 *   "Concepto DIAN 1352 de 2018"
 *   "Concepto General DIAN 100208221-1352 de 2018"
 *   "Concepto 906445 de 2022"
 *
 * Es uno de los patrones más sensibles porque la blacklist incluye
 * radicados específicos no verificables (1352/2018).
 */
const CONCEPTO_DIAN_PATTERN: CitationPattern = {
  kind: 'concepto_dian',
  // Grupos:
  //   1 = calificador opcional (Unificado/General)
  //   2 = radicado completo (puede tener "-", "(", ")")
  //   3 = año
  regex: /\bConcepto\s+(?:(Unificado|General)\s+)?(?:DIAN\s+)?(\d{1,12}(?:[-(]\d{3,8}\)?)?)\s+(?:de\s+|del\s+|\/)\s*(\d{4})\b/gi,
  normalize: (m) => {
    const calificador = m[1] ? `${m[1]} ` : '';
    return `Concepto ${calificador}DIAN ${m[2]} de ${m[3]}`;
  },
};

/**
 * sentencia_corte
 * Captura: "Sentencia C-079 de 2026", "Sentencia C-079/2026", "Sentencia 28920 de 2025".
 *
 * Por qué dos sub-patrones:
 *   - "C-XXX" / "T-XXX" / "SU-XXX" → Corte Constitucional (numeración con guion).
 *   - "XXXXX de YYYY" sin prefijo letra → Consejo de Estado (numero radicación).
 *
 * Para mantener el regex conservador, solo capturamos el formato "C-XXX de YYYY"
 * que es el más común. El radicado del Consejo de Estado se cubre cuando viene
 * con la palabra "Sentencia" delante y el año detrás.
 */
const SENTENCIA_PATTERN: CitationPattern = {
  kind: 'sentencia_corte',
  // Grupos:
  //   1 = prefijo letra (C, T, SU) opcional → si null, es Consejo de Estado
  //   2 = número
  //   3 = año
  regex: /\bSentencia\s+(?:(C|T|SU)-)?(\d+)\s*(?:de\s+|del\s+|\/)\s*(\d{4})\b/gi,
  normalize: (m) => {
    const prefijo = m[1] ? `${m[1]}-` : '';
    return `Sentencia ${prefijo}${m[2]} de ${m[3]}`;
  },
};

/**
 * niif_pymes
 * Captura: "NIIF para PYMES §29", "NIIF para PYMES Sección 29", "NIIF para PYMES seccion 29".
 */
const NIIF_PYMES_PATTERN: CitationPattern = {
  kind: 'niif_pymes',
  regex: /\bNIIF\s+para\s+PYMES\s+(?:§|Secci[óo]n\s+|seccion\s+)(\d+)\b/gi,
  normalize: (m) => `NIIF para PYMES §${m[1]}`,
};

/**
 * nic
 * Captura: "NIC 12", "NIC12".
 */
const NIC_PATTERN: CitationPattern = {
  kind: 'nic',
  regex: /\bNIC\s*(\d+)\b/gi,
  normalize: (m) => `NIC ${m[1]}`,
};

/**
 * nia
 * Captura: "NIA 705", "NIA705".
 */
const NIA_PATTERN: CitationPattern = {
  kind: 'nia',
  regex: /\bNIA\s*(\d+)\b/gi,
  normalize: (m) => `NIA ${m[1]}`,
};

/**
 * resolucion_dian
 * Captura: "Resolución DIAN 000238 de 2025", "Resolución DIAN 238/2025".
 */
const RESOLUCION_DIAN_PATTERN: CitationPattern = {
  kind: 'resolucion_dian',
  regex: /\bResoluci[óo]n\s+DIAN\s+0*(\d+)\s*(?:de\s+|del\s+|\/)\s*(\d{4})\b/gi,
  normalize: (m) => {
    // Preserva el zero-padding canónico (6 dígitos) para resoluciones DIAN.
    const num = m[1].padStart(6, '0');
    return `Resolución DIAN ${num} de ${m[2]}`;
  },
};

const ALL_PATTERNS: readonly CitationPattern[] = [
  ART_ET_PATTERN,
  LEY_PATTERN,
  DECRETO_PATTERN,
  CONCEPTO_DIAN_PATTERN,
  SENTENCIA_PATTERN,
  NIIF_PYMES_PATTERN,
  NIC_PATTERN,
  NIA_PATTERN,
  RESOLUCION_DIAN_PATTERN,
] as const;

// ---------------------------------------------------------------------------
// CAPA 1 — Extracción y normalización
// ---------------------------------------------------------------------------

/**
 * Extrae TODAS las citas reconocibles del texto.
 *
 * Why dedup por (kind, normalized, start): el regex `g` puede recorrer el mismo
 * match cuando los patrones se solapan (ej. "Sentencia C-079" matchea también
 * `\bC\b...` en otro regex hipotético). Conservamos solo la primera ocurrencia
 * por posición inicial.
 */
export function extractCitations(text: string): ParsedCitation[] {
  if (!text || text.length === 0) return [];

  const found: ParsedCitation[] = [];

  for (const pattern of ALL_PATTERNS) {
    // Reset lastIndex porque el regex es shared (declarado const arriba).
    pattern.regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.regex.exec(text)) !== null) {
      const raw = m[0];
      const normalized = pattern.normalize(m);
      found.push({
        kind: pattern.kind,
        normalized,
        raw,
        position: { start: m.index, end: m.index + raw.length },
      });
    }
  }

  // Ordenar por posición (orden de aparición) y dedup por (kind, normalized, start).
  const sorted = found.slice().sort((a, b) => a.position.start - b.position.start);
  const seen = new Set<string>();
  const unique: ParsedCitation[] = [];
  for (const c of sorted) {
    const key = `${c.kind}|${c.normalized}|${c.position.start}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(c);
  }
  return unique;
}

// ---------------------------------------------------------------------------
// CAPA 2 — Lookup en catálogo
// ---------------------------------------------------------------------------
//
// El catálogo se inyecta como parámetro. La función NO importa nada del módulo
// catalog/**. Los tests pasan un fixture sintético.
// ---------------------------------------------------------------------------

interface CatalogueLookup {
  readonly cita: string;
  readonly estado: import('../types').NormativeVigencia;
}

/**
 * Indiza el catálogo en un Map para lookup O(1) por forma canónica.
 *
 * Why Map: el catálogo puede crecer a 50-200 entradas. La búsqueda lineal
 * funciona pero hacemos esto explícito para sostener catálogos más grandes
 * cuando se construya el catálogo real.
 */
function buildLookupIndex(catalogue: NormativeCatalogue): Map<string, CatalogueLookup> {
  const idx = new Map<string, CatalogueLookup>();

  for (const a of catalogue.articulosET) {
    idx.set(a.cita, { cita: a.cita, estado: a.estado });
  }
  for (const c of catalogue.conceptosDian) {
    idx.set(c.cita, { cita: c.cita, estado: c.estado });
  }
  for (const l of catalogue.leyesReformas) {
    idx.set(l.cita, { cita: l.cita, estado: l.estado });
  }
  for (const j of catalogue.jurisprudencia) {
    // jurisprudencia no tiene `estado` propio en el contrato — siempre se considera VIGENTE_2026
    // si está en catálogo (citarla nunca induce error). Se etiqueta como VIGENTE_2026.
    idx.set(j.cita, { cita: j.cita, estado: 'VIGENTE_2026' });
  }
  for (const s of catalogue.sanciones) {
    idx.set(s.normaRef, { cita: s.normaRef, estado: s.estado });
  }
  for (const t of catalogue.tarifasRetencion) {
    idx.set(t.normaRef, { cita: t.normaRef, estado: t.estado });
  }
  for (const n of catalogue.normasAuditoria) {
    idx.set(n.cita, { cita: n.cita, estado: n.estado });
  }

  return idx;
}

// ---------------------------------------------------------------------------
// CAPA 3 — Blacklist scan (utilizado por citation y también desde blacklist.validator.ts)
// ---------------------------------------------------------------------------

/**
 * Verifica si una cita raw cae en alguna entrada blacklist.
 * Retorna la primera entrada que matchea, o null.
 */
function findBlacklistMatch(
  raw: string,
  blacklist: readonly BlacklistEntry[],
): BlacklistEntry | null {
  for (const entry of blacklist) {
    for (const pat of entry.patrones) {
      // Compilar con flag `i` (case-insensitive). Si el patrón tiene errores
      // de sintaxis lo saltamos (defensivo — el catálogo es código del repo).
      let re: RegExp;
      try {
        re = new RegExp(pat, 'i');
      } catch {
        continue;
      }
      if (re.test(raw)) return entry;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Veredicto por estado + blacklist
// ---------------------------------------------------------------------------

/**
 * Determina el veredicto y el mensaje a partir del lookup y el match blacklist.
 *
 * Tabla de decisión:
 *   - blacklist CRITICA/ALTA               → bloqueo
 *   - blacklist MEDIA                      → advertencia
 *   - en catálogo + VIGENTE_2026           → valida
 *   - en catálogo + MODIFICADO/SUSPENDIDO  → advertencia
 *   - en catálogo + DEROGADO/INEXEQUIBLE/NO_VERIFICADO → bloqueo
 *   - no en catálogo                       → bloqueo (NO_VERIFICADO implícito)
 */
function decideVeredicto(
  citation: ParsedCitation,
  lookup: CatalogueLookup | undefined,
  blacklistHit: BlacklistEntry | null,
): { veredicto: 'valida' | 'advertencia' | 'bloqueo'; mensaje: string; alternativa: string | null } {
  // 1) Blacklist tiene prioridad sobre todo.
  if (blacklistHit) {
    const sev = blacklistHit.severidad;
    if (sev === 'CRITICA' || sev === 'ALTA') {
      return {
        veredicto: 'bloqueo',
        mensaje:
          `Cita "${citation.normalized}" matchea blacklist ${blacklistHit.id} ` +
          `(severidad ${sev}): ${blacklistHit.razon}`,
        alternativa: blacklistHit.alternativaCorrecta,
      };
    }
    // MEDIA
    return {
      veredicto: 'advertencia',
      mensaje:
        `Cita "${citation.normalized}" matchea blacklist ${blacklistHit.id} ` +
        `(severidad MEDIA): ${blacklistHit.razon}`,
      alternativa: blacklistHit.alternativaCorrecta,
    };
  }

  // 2) Sin blacklist — depende del catálogo.
  if (!lookup) {
    return {
      veredicto: 'bloqueo',
      mensaje:
        `Cita "${citation.normalized}" NO está en el catálogo verificado. ` +
        `El Agente Fiscal solo puede citar normas con respaldo en el catálogo (defensa Art. 647 E.T.).`,
      alternativa: null,
    };
  }

  switch (lookup.estado) {
    case 'VIGENTE_2026':
      return {
        veredicto: 'valida',
        mensaje: `Cita "${citation.normalized}" verificada como VIGENTE_2026 en el catálogo.`,
        alternativa: null,
      };
    case 'MODIFICADO':
      return {
        veredicto: 'advertencia',
        mensaje:
          `Cita "${citation.normalized}" está MODIFICADA. ` +
          `El artículo sigue vigente pero su redacción cambió por reforma posterior. ` +
          `Verificar que el agente use la versión 2026.`,
        alternativa: null,
      };
    case 'SUSPENDIDO':
      return {
        veredicto: 'advertencia',
        mensaje:
          `Cita "${citation.normalized}" está SUSPENDIDA por el Consejo de Estado. ` +
          `Su aplicación es objeto de controversia jurisprudencial.`,
        alternativa: null,
      };
    case 'DEROGADO':
      return {
        veredicto: 'bloqueo',
        mensaje:
          `Cita "${citation.normalized}" está DEROGADA. ` +
          `Citarla como vigente es indefendible ante DIAN (sanción Art. 647 E.T.).`,
        alternativa: null,
      };
    case 'INEXEQUIBLE':
      return {
        veredicto: 'bloqueo',
        mensaje:
          `Cita "${citation.normalized}" fue declarada INEXEQUIBLE por la Corte Constitucional. ` +
          `Citarla como vigente es indefendible ante DIAN (sanción Art. 647 E.T.).`,
        alternativa: null,
      };
    case 'NO_VERIFICADO':
      return {
        veredicto: 'bloqueo',
        mensaje:
          `Cita "${citation.normalized}" está marcada como NO_VERIFICADO. ` +
          `El radicado no fue confirmado en fuente oficial. Bloqueada por el validator.`,
        alternativa: null,
      };
    default: {
      // Exhaustive guard — TypeScript debería marcar esto como never.
      const _exhaustive: never = lookup.estado;
      void _exhaustive;
      return {
        veredicto: 'bloqueo',
        mensaje: `Cita "${citation.normalized}" tiene estado desconocido.`,
        alternativa: null,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Entrada pública
// ---------------------------------------------------------------------------

/**
 * Valida todas las citas presentes en `text` contra el catálogo inyectado.
 *
 * Capa 1: extrae citas con regex conservadores y las normaliza.
 * Capa 2: busca cada cita en el catálogo y aplica blacklist.
 * Retorna un `CitationCheckResult` por cada cita extraída.
 *
 * Si el texto no tiene citas reconocibles, retorna []. El consumidor
 * (normative.validator) decide qué hacer con el vacío.
 */
export function validateCitations(
  text: string,
  catalogue: NormativeCatalogue,
): CitationCheckResult[] {
  const citations = extractCitations(text);
  if (citations.length === 0) return [];

  const index = buildLookupIndex(catalogue);
  const results: CitationCheckResult[] = [];

  for (const cit of citations) {
    const lookup = index.get(cit.normalized);
    const blacklistHit = findBlacklistMatch(cit.raw, catalogue.blacklist);
    const { veredicto, mensaje, alternativa } = decideVeredicto(cit, lookup, blacklistHit);

    results.push({
      citation: cit,
      enCatalogo: lookup !== undefined,
      estado: lookup?.estado ?? null,
      blacklistHit,
      veredicto,
      mensaje,
      alternativa,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Helpers públicos (para uso desde normative.validator y tests)
// ---------------------------------------------------------------------------

/**
 * Normaliza un fragmento de cita conocido (ej. el `cita` field de una entrada
 * del catálogo) reusando los mismos patrones del extractor.
 *
 * Útil para los tests y para el constructor del catálogo: garantiza que las
 * entradas del catálogo respetan la forma canónica que el validator busca.
 *
 * Si el fragmento no matchea ningún patrón, retorna null.
 */
export function normalizeCitation(fragment: string): { kind: NormativeCitationKind; normalized: string } | null {
  for (const pattern of ALL_PATTERNS) {
    pattern.regex.lastIndex = 0;
    const m = pattern.regex.exec(fragment);
    if (m) {
      return { kind: pattern.kind, normalized: pattern.normalize(m) };
    }
  }
  return null;
}
