// ---------------------------------------------------------------------------
// EL ESCUDO — Capa 2 (Motor Normativo) — Contrato de Tipos
// ---------------------------------------------------------------------------
//
// Este archivo define el contrato TypeScript que comparten:
//
//   normative/catalog/**     (datos hardcoded del Estatuto Tributario, Conceptos
//                             DIAN whitelisted, leyes/reformas, sanciones,
//                             tarifas de retención del Decreto 1625/2016,
//                             NIIF para PYMES + NIC + NIA).
//
//   normative/prompts/**     (motor-normativo.prompt.ts — system prompt
//                             fragment que renderiza el catálogo para inyectar
//                             como contexto del Agente Fiscal de Capa 4).
//
//   normative/validators/**  (citation.validator.ts + blacklist.validator.ts —
//                             verifican que toda cita emitida por el agente
//                             coincida con el catálogo y no caiga en la
//                             blacklist de citas peligrosas).
//
// Por qué TypeScript puro (sin Zod) para el catálogo:
//   - El catálogo es data ESTÁTICA hardcoded en el repo; no proviene del LLM.
//   - Los `as const` arrays + literal types dan checking en build time sin
//     overhead de runtime parse.
//   - Zod sí se usa en otros módulos (contracts/base.ts) porque ahí los datos
//     vienen del LLM y necesitan parsing strict. Aquí no aplica.
//
// El validator SÍ produce un schema Zod del CitationCheckResult cuando viaje
// como evidence al sintetizador final (Capa 4 Módulo 8 — Modo Supervivencia).
// Esos schemas viven en validators/, no aquí.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Estados de vigencia normativa
// ---------------------------------------------------------------------------
//
// Por qué 6 estados (no solo VIGENTE/DEROGADO):
//   - INEXEQUIBLE: la norma existió pero la Corte Constitucional la tumbó
//     (ej. Decreto 1474 de 2025 por Sentencia C-079 de 2026). Citarla como
//     vigente es indefendible ante DIAN.
//   - SUSPENDIDO: el Consejo de Estado suspendió provisionalmente la norma
//     (ej. Concepto Unificado DIAN 202(006038)/2024 numeral 12, suspendido
//     dic-2024 y luego revocada la suspensión por Sentencia 28920 de jul-2025).
//   - MODIFICADO: el artículo sigue vigente pero su redacción cambió por
//     reforma posterior; el catálogo debe mostrar la versión 2026.
//   - NO_VERIFICADO: la fuente del catálogo no encuentra radicado público;
//     el validator BLOQUEA su emisión hasta verificación manual.
// ---------------------------------------------------------------------------

export const NORMATIVE_VIGENCIA = [
  'VIGENTE_2026',
  'DEROGADO',
  'INEXEQUIBLE',
  'SUSPENDIDO',
  'MODIFICADO',
  'NO_VERIFICADO',
] as const;

export type NormativeVigencia = (typeof NORMATIVE_VIGENCIA)[number];

// ---------------------------------------------------------------------------
// Severidad para entradas blacklist
// ---------------------------------------------------------------------------
//
//   CRITICA: emitir esta cita expone al cliente a sanción Art. 647 100% o a
//            pérdida directa de un beneficio fiscal real. El validator debe
//            ABORTAR la respuesta del agente, no solo advertir.
//   ALTA:    emitir esta cita induce a error material en el dictamen (mes de
//            vencimiento equivocado, tarifa equivocada). El validator debe
//            BLOQUEAR y forzar regeneración.
//   MEDIA:   emisión imprecisa que un revisor fiscal corregiría. El validator
//            ADVIERTE y deja decisión al usuario.
// ---------------------------------------------------------------------------

export const BLACKLIST_SEVERIDAD = ['CRITICA', 'ALTA', 'MEDIA'] as const;
export type BlacklistSeveridad = (typeof BLACKLIST_SEVERIDAD)[number];

// ---------------------------------------------------------------------------
// Tipo de norma citable
// ---------------------------------------------------------------------------
//
// Cada `NormativeCitationKind` tiene un patrón regex en el validator
// (citation.validator.ts) que reconoce la forma canónica. Ejemplos:
//
//   articulo_et      → /Art\. ?\d+(?:-\d+)?( par\. ?\d+| §\d+)? E\.T\./
//   ley              → /Ley ?\d+ ?(?:de|del?) ?\d{4}/
//   decreto          → /Decreto ?\d+ ?(?:de|del?) ?\d{4}/
//   concepto_dian    → /Concepto (?:Unificado |General )?(?:DIAN )?\d+/
//   sentencia_corte  → /Sentencia C-\d+(?:\/| de )\d{4}/
//   niif_pymes       → /NIIF para PYMES §\d+/
//   nic              → /NIC ?\d+/
//   nia              → /NIA ?\d+/
//   resolucion_dian  → /Resolución DIAN \d+\/?\d*/
// ---------------------------------------------------------------------------

export const NORMATIVE_CITATION_KINDS = [
  'articulo_et',
  'ley',
  'decreto',
  'concepto_dian',
  'sentencia_corte',
  'niif_pymes',
  'nic',
  'nia',
  'resolucion_dian',
] as const;

export type NormativeCitationKind = (typeof NORMATIVE_CITATION_KINDS)[number];

// ---------------------------------------------------------------------------
// Modificación de una norma (historia)
// ---------------------------------------------------------------------------

export interface NormativeAmendment {
  /** Norma que modificó. Ej: "Ley 2277 de 2022, Art. 32" */
  readonly norma: string;
  /** Fecha ISO. Ej: "2022-12-13" */
  readonly fecha: string;
  /** Breve descripción del cambio. */
  readonly cambio: string;
}

// ---------------------------------------------------------------------------
// Artículo del Estatuto Tributario
// ---------------------------------------------------------------------------

export interface NormativeArticleEntry {
  /** ID canónico para lookup. Ej: "ART_240_ET", "ART_240_PAR2_ET", "ART_647_PAR_ET". */
  readonly id: string;
  /** Forma citada por el agente. DEBE coincidir con el patrón citation.validator. */
  readonly cita: string;
  /** Título oficial del artículo. */
  readonly titulo: string;
  /** Resumen ejecutivo (1-3 líneas) — la versión que va al system prompt. */
  readonly resumen: string;
  /**
   * Texto literal del parágrafo o inciso clave. SOLO se llena cuando el
   * agente lo necesita citar verbatim (ej. parágrafo Art. 647 para defensa
   * diferencia de criterio).
   */
  readonly textoLiteral: string | null;
  /** Estado actual de vigencia. */
  readonly estado: NormativeVigencia;
  /** Modificaciones acumuladas (Ley 1819/2016, Ley 2010/2019, Ley 2277/2022, etc.). */
  readonly modificaciones: readonly NormativeAmendment[];
  /** URL oficial citable. Preferir estatuto.co, normograma.dian o secretariasenado. */
  readonly urlOficial: string | null;
  /** Tags semánticos para filtro y agrupación (ej. ["renta", "tarifa", "PJ"]). */
  readonly tags: readonly string[];
}

// ---------------------------------------------------------------------------
// Concepto / Oficio DIAN whitelisted
// ---------------------------------------------------------------------------
//
// SOLO entran al catálogo conceptos cuya radicación es VERIFICABLE en
// normograma.dian.gov.co. El validator rechaza cualquier Concepto que no
// esté en este whitelist (ver dictamen tributario: los radicados
// "100208221-1352/2018", "481/2018 capitalización", "906445/2022 TTD",
// "100208192-1631/2019" del spec original NO son verificables y deben
// quedar fuera del catálogo).
// ---------------------------------------------------------------------------

export interface DianConceptEntry {
  /** ID canónico. Ej: "CONCEPTO_UNIFICADO_202_006038_2024". */
  readonly id: string;
  /** Cita en formato citable. Ej: "Concepto Unificado DIAN 202(006038) de 2024". */
  readonly cita: string;
  /** Radicado oficial (con dígitos completos). */
  readonly radicado: string;
  /** Fecha de expedición ISO. */
  readonly fecha: string;
  /** Título oficial. */
  readonly titulo: string;
  /** Tesis central (1-3 líneas para el prompt). */
  readonly tesis: string;
  /** Artículos del E.T. que interpreta. */
  readonly articulosAplicables: readonly string[];
  /** Estado de vigencia. */
  readonly estado: NormativeVigencia;
  /** URL en normograma.dian.gov.co o equivalente oficial. */
  readonly urlOficial: string | null;
  /**
   * Flag CRÍTICA: este concepto fue verificado manualmente en normograma.
   * Si false, NO debe codificarse en el catálogo (el validator lo bloquea).
   */
  readonly verificadoEnNormograma: boolean;
}

// ---------------------------------------------------------------------------
// Ley / Reforma estructural
// ---------------------------------------------------------------------------

export interface LawReformEntry {
  /** ID canónico. Ej: "LEY_2277_2022", "LEY_1819_2016". */
  readonly id: string;
  /** Cita formal. Ej: "Ley 2277 de 2022". */
  readonly cita: string;
  /** Título oficial. */
  readonly titulo: string;
  /** Resumen ejecutivo (qué reformó). */
  readonly resumen: string;
  /** Artículos clave del E.T. modificados o introducidos. */
  readonly articulosClave: readonly string[];
  /** Estado de vigencia (declarable INEXEQUIBLE total/parcial por la Corte). */
  readonly estado: NormativeVigencia;
  /** Sentencia constitucional asociada (si declarada exequible/inexequible). */
  readonly sentenciaCorte: string | null;
  /** URL oficial. */
  readonly urlOficial: string | null;
}

// ---------------------------------------------------------------------------
// Sentencia Corte Constitucional / Consejo de Estado
// ---------------------------------------------------------------------------

export interface JurisprudenceEntry {
  /** ID canónico. Ej: "SENTENCIA_C_079_2026". */
  readonly id: string;
  /** Cita formal. Ej: "Sentencia C-079 de 2026". */
  readonly cita: string;
  /** Tribunal emisor. */
  readonly tribunal: 'Corte Constitucional' | 'Consejo de Estado';
  /** Fecha ISO. */
  readonly fecha: string;
  /** Tema/expediente. */
  readonly tema: string;
  /** Tesis central (1-3 líneas). */
  readonly tesis: string;
  /** Normas afectadas. */
  readonly normasAfectadas: readonly string[];
  /** URL oficial. */
  readonly urlOficial: string | null;
}

// ---------------------------------------------------------------------------
// Sanción tributaria — entrada de la matriz régimen sancionatorio
// ---------------------------------------------------------------------------

export interface SanctionEntry {
  /** ID canónico. Ej: "SANCION_INEXACTITUD_ART647". */
  readonly id: string;
  /** Cita normativa que soporta la sanción. */
  readonly normaRef: string;
  /** Nombre legible. Ej: "Sanción por inexactitud". */
  readonly nombre: string;
  /** Resumen del supuesto que la activa. */
  readonly supuesto: string;
  /** Tarifa como string interpretable. Ej: "100% del mayor valor del impuesto". */
  readonly tarifa: string;
  /** Tope si aplica (porcentaje, UVT o COP). */
  readonly tope: string | null;
  /**
   * Reducciones disponibles ordenadas por momento procesal.
   * Ej: [{ momento: 'aceptación pliego de cargos', reduccion: '50%', norma: 'Art. 713 E.T.' }]
   */
  readonly reducciones: readonly {
    readonly momento: string;
    readonly reduccion: string;
    readonly norma: string;
  }[];
  /** Vigente / Derogada / Modificada. */
  readonly estado: NormativeVigencia;
}

// ---------------------------------------------------------------------------
// Tarifa de retención en la fuente — Decreto 1625/2016 (DUR Tributario)
// ---------------------------------------------------------------------------
//
// Importante: las tarifas NO viven en el E.T. — viven en el Decreto Único
// Reglamentario 1625 de 2016, libro 1 parte 2 título 4. El catálogo cita
// el decreto, NO el E.T. (el dictamen tributario corrige este punto).
// ---------------------------------------------------------------------------

export interface RetentionTariffEntry {
  /** ID canónico. Ej: "RTF_HONORARIOS". */
  readonly id: string;
  /** Concepto. Ej: "Honorarios", "Servicios", "Compras". */
  readonly concepto: string;
  /** Tarifa para declarantes (porcentaje). */
  readonly tarifaDeclarante: string;
  /** Tarifa para no declarantes (si aplica). */
  readonly tarifaNoDeclarante: string | null;
  /** Umbral mínimo en UVT (si aplica). */
  readonly umbralUVT: number | null;
  /** Norma reglamentaria que la fija. */
  readonly normaRef: string;
  /** Vigente 2026 / modificada. */
  readonly estado: NormativeVigencia;
}

// ---------------------------------------------------------------------------
// Norma de auditoría (NIIF / NIIF para PYMES / NIC / NIA)
// ---------------------------------------------------------------------------

export interface AuditStandardEntry {
  /** ID canónico. Ej: "NIIF_PYMES_S29", "NIC_12", "NIA_705". */
  readonly id: string;
  /** Cita formal. Ej: "NIIF para PYMES §29". */
  readonly cita: string;
  /** Familia. */
  readonly familia: 'NIIF_PLENAS' | 'NIIF_PYMES' | 'NIC' | 'NIA';
  /** Número/sección. */
  readonly numero: string;
  /** Título. */
  readonly titulo: string;
  /** Resumen ejecutivo. */
  readonly resumen: string;
  /** Decreto colombiano que la incorpora (Decreto 2420/2015 + modificatorios). */
  readonly decretoAdopcion: string | null;
  /** Estado de vigencia. */
  readonly estado: NormativeVigencia;
}

// ---------------------------------------------------------------------------
// Entrada blacklist — cita prohibida
// ---------------------------------------------------------------------------
//
// El validator escanea TODA respuesta del agente. Si una entrada matchea, la
// respuesta es rechazada (severidad CRITICA / ALTA) o advertida (MEDIA).
//
// La blacklist NO depende del catálogo — es un conjunto de patrones tóxicos
// que el agente NUNCA debe emitir, aunque el catálogo no los contenga.
// ---------------------------------------------------------------------------

export interface BlacklistEntry {
  /** ID canónico. Ej: "BL_ART_158_3_DEROGADO". */
  readonly id: string;
  /**
   * Patrones regex (case-insensitive) que detectan la cita prohibida.
   * Cualquier match en la respuesta del agente bloquea su emisión.
   */
  readonly patrones: readonly string[];
  /** Razón humana. Ej: "Art. 158-3 fue derogado por Ley 1819/2016 Art. 376". */
  readonly razon: string;
  /** Qué debe citar el agente en su lugar (alternativa correcta). */
  readonly alternativaCorrecta: string | null;
  /** Severidad → controla si el validator aborta, bloquea o advierte. */
  readonly severidad: BlacklistSeveridad;
  /** Categoría para reportes. */
  readonly categoria:
    | 'norma_derogada'
    | 'norma_inexequible'
    | 'concepto_dian_no_verificable'
    | 'periodicidad_eliminada'
    | 'articulo_confundido'
    | 'tarifa_incorrecta';
}

// ---------------------------------------------------------------------------
// Resultado de un check de cita (consumido por Capa 4 y la UI)
// ---------------------------------------------------------------------------

export interface ParsedCitation {
  readonly kind: NormativeCitationKind;
  /** Forma normalizada. Ej: "Art. 240 E.T." */
  readonly normalized: string;
  /** Cómo apareció en el texto. */
  readonly raw: string;
  /** Posición (offsets en el texto fuente). */
  readonly position: { readonly start: number; readonly end: number };
}

export interface CitationCheckResult {
  /** Cita extraída. */
  readonly citation: ParsedCitation;
  /** ¿Está reconocida en el catálogo? */
  readonly enCatalogo: boolean;
  /** ¿Cuál es su estado actual? */
  readonly estado: NormativeVigencia | null;
  /** Si está en blacklist, qué entrada matcheó. */
  readonly blacklistHit: BlacklistEntry | null;
  /** Veredicto final: válida (✅), advertencia (⚠), bloqueo (❌). */
  readonly veredicto: 'valida' | 'advertencia' | 'bloqueo';
  /** Mensaje legible para el usuario. */
  readonly mensaje: string;
  /** Recomendación de corrección si no es válida. */
  readonly alternativa: string | null;
}

// ---------------------------------------------------------------------------
// Opciones del prompt builder
// ---------------------------------------------------------------------------

export interface MotorNormativoPromptOptions {
  /** Idioma del framing (es-CO por defecto). El catálogo siempre va en español. */
  readonly language: 'es' | 'en';
  /** Caso de uso del agente que consumirá el prompt — afecta filtros. */
  readonly useCase?:
    | 'analisis_completo'
    | 'planeacion_tributaria'
    | 'defensa_dian'
    | 'devolucion_saldos'
    | 'modo_supervivencia';
  /**
   * NIT del cliente, para personalizar el calendario DIAN inyectado.
   * Si se provee, el prompt incluye los plazos relevantes por último dígito.
   */
  readonly nitContext?: string;
  /**
   * Si true, el prompt incluye el resumen completo de la blacklist
   * (recomendado SIEMPRE — sin esto el agente puede emitir Art. 158-3 o
   * Decreto 1474 sin saber que están prohibidos).
   */
  readonly includeBlacklist?: boolean;
}

// ---------------------------------------------------------------------------
// Agregación del catálogo (lookup unificado para validator y prompt builder)
// ---------------------------------------------------------------------------
//
// El catálogo se materializa en `normative/catalog/index.ts` (que el backend
// agent construye). El validator lo consume con esta firma.
// ---------------------------------------------------------------------------

export interface NormativeCatalogue {
  readonly articulosET: readonly NormativeArticleEntry[];
  readonly conceptosDian: readonly DianConceptEntry[];
  readonly leyesReformas: readonly LawReformEntry[];
  readonly jurisprudencia: readonly JurisprudenceEntry[];
  readonly sanciones: readonly SanctionEntry[];
  readonly tarifasRetencion: readonly RetentionTariffEntry[];
  readonly normasAuditoria: readonly AuditStandardEntry[];
  readonly blacklist: readonly BlacklistEntry[];
}
