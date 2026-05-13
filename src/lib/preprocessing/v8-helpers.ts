// ---------------------------------------------------------------------------
// Spec v8.1 helpers — derivación determinística del modo del reporte, de la
// cobertura por clase PUC y del hash de verificación del documento final.
// ---------------------------------------------------------------------------
// Estos helpers son funciones puras determinísticas (sin LLM) que extienden
// el preprocesador legacy. Viven en archivo separado para minimizar el blast
// radius sobre `trial-balance.ts`: la fase F0 del Wave 4 sólo añade
// infraestructura sin tocar la lógica histórica del parser/curator.
//
// Mapa de uso por capa Spec v8.1:
//
//   §2  Determinación del modo  → deriveReportMode()
//   §5  Slide 12 metadata        → summarizeCoverage()
//   §5  Slide 12 verificación    → computeReportHash()
//
// Why archivo separado: F4-F6 (refactor de prompts NIIF / Strategy /
// Governance) consumirán estos helpers leyéndolos directamente. Cualquier
// nueva regla v8.1 deterministic-only debería añadirse aquí para que las
// modificaciones a `trial-balance.ts` queden acotadas a las reglas v2.0
// preexistentes (PUC, devoluciones 4175, KPIs).
// ---------------------------------------------------------------------------

import { createHash } from 'crypto';
import type { PreprocessedBalance, PeriodSnapshot } from './trial-balance';

// ---------------------------------------------------------------------------
// §2 — Determinación del modo del reporte (LINEA_BASE / TRANSICION / FULL)
// ---------------------------------------------------------------------------

/**
 * Modo del reporte — primer comentario HTML del documento final (v8.1 §2).
 * Espejo del enum Zod `ReportMode` en
 * `src/lib/agents/financial/contracts/base.ts` (mantenemos el tipo aquí para
 * evitar dependencia circular preprocessing → contracts).
 */
export type ReportMode = 'LINEA_BASE' | 'TRANSICION' | 'COMPARATIVO_COMPLETO';

/**
 * Umbral de materialidad para considerar una línea de clase como "presente"
 * en el comparativo (v8.1 §2). Si una clase del periodo actual tiene
 * `auxiliaryTotal` >= 1% del activo total y la misma clase está ausente o
 * con saldo cero en el comparativo, cuenta como "línea material faltante".
 */
const MATERIAL_LINE_THRESHOLD_PCT = 0.01;

/**
 * Umbral de líneas materiales faltantes para declarar el periodo en
 * `TRANSICION` (v8.1 §2). Por debajo de este umbral, el comparativo se
 * considera robusto y se asigna `COMPARATIVO_COMPLETO`.
 */
const TRANSICION_MISSING_LINES_THRESHOLD = 3;

/** Clases PUC consideradas "materiales" para la regla §2 (Activos a Producción). */
const MATERIAL_PUC_CLASSES: readonly number[] = [1, 2, 3, 4, 5, 6, 7];

/**
 * Helper interno: lookup tolerante de `auxiliaryTotal` para una clase PUC
 * sobre un snapshot. Devuelve 0 si el snapshot es null/undefined o si la
 * clase no existe.
 */
function classAuxiliaryTotal(
  snap: PeriodSnapshot | null | undefined,
  classCode: number,
): number {
  if (!snap || !Array.isArray(snap.classes)) return 0;
  const cls = snap.classes.find((c) => c.code === classCode);
  return cls?.auxiliaryTotal ?? 0;
}

/**
 * Deriva el modo del reporte aplicando el árbol de decisión §2 de la spec
 * v8.1. Es determinístico y puro: sólo lee el `PreprocessedBalance`. NO
 * llama al LLM, NO depende del intake.
 *
 * Árbol de decisión:
 *
 *   (a) `comparative === null` (single-period import) → `LINEA_BASE`
 *
 *   (b) `comparativos_impracticables === true` (declarado por el
 *       detector NIIF para PYMES §3.14) → `LINEA_BASE`
 *
 *   (c) Contar clases PUC 1..7 en `primary` que sean materiales
 *       (|auxiliaryTotal| >= 1% del activo total) pero estén ausentes o
 *       con saldo cero en `comparative`. Si el conteo >= 3 → `TRANSICION`.
 *
 *   (d) Default: `COMPARATIVO_COMPLETO`.
 *
 * Why §2: el modo controla absolutamente toda decisión narrativa posterior
 * (verbos permitidos, layout de estados financieros, copy del resumen
 * ejecutivo). La derivación NO puede quedar en manos del LLM; el agente
 * tiene que recibirla como input vinculante.
 */
export function deriveReportMode(preprocessed: PreprocessedBalance): ReportMode {
  // (a) Sin comparativo → línea base sin discusión.
  if (!preprocessed.comparative) return 'LINEA_BASE';

  // (b) Detector cross-period ya marcó "impracticable" (saldos ≈ 0 en TODO el
  // comparativo). Operativamente igual a single-period.
  if (preprocessed.comparativos_impracticables === true) return 'LINEA_BASE';

  // (c) Conteo de líneas materiales del periodo actual ausentes en el comparativo.
  const totalAssets = Math.abs(preprocessed.primary?.controlTotals?.activo ?? 0);
  if (totalAssets <= 0) {
    // Sin activo material en el periodo actual no podemos clasificar
    // materialidad → fallback conservador a LINEA_BASE (no se prometerá
    // comparabilidad que el dato no soporta).
    return 'LINEA_BASE';
  }

  let missingMaterialLines = 0;
  for (const classCode of MATERIAL_PUC_CLASSES) {
    const currentBalance = classAuxiliaryTotal(preprocessed.primary, classCode);
    const comparativeBalance = classAuxiliaryTotal(preprocessed.comparative, classCode);
    const isMaterial = Math.abs(currentBalance) / totalAssets >= MATERIAL_LINE_THRESHOLD_PCT;
    const isMissingInComparative = comparativeBalance === 0;
    if (isMaterial && isMissingInComparative) {
      missingMaterialLines += 1;
    }
  }

  if (missingMaterialLines >= TRANSICION_MISSING_LINES_THRESHOLD) {
    return 'TRANSICION';
  }

  // (d) Comparativo robusto.
  return 'COMPARATIVO_COMPLETO';
}

// ---------------------------------------------------------------------------
// §5 Slide 12 — cobertura por clase PUC para el bloque de transparencia
// ---------------------------------------------------------------------------

/**
 * Códigos de clase PUC reportables en el Slide 12. Clases 1..9 son las
 * "clases canónicas" del Plan Único de Cuentas; '25' se reporta por
 * separado porque la spec v8.1 §5 Slide 12 lo enumera explícitamente
 * como "Cobertura Clase 25 (laboral)" — depende de la presencia de
 * auxiliares de obligaciones laborales (PUC 25xx) para emitir notas
 * de pasivos laborales con confianza alta.
 */
export type CoverageClassCode = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '25';

/**
 * Resumen de cobertura para una clase PUC en el periodo actual. El renderer
 * del Slide 12 lo serializa en el bloque "Cómo se construyó este reporte"
 * (v8.1 §5 Slide 12 — "Cobertura").
 */
export interface CoverageByClass {
  classCode: CoverageClassCode;
  /** Cantidad de auxiliares (level === 'Auxiliar' o transactional) en la clase. */
  auxiliariesCount: number;
  /** Saldo total de la clase en centavos como string (MoneyCop convention). */
  totalSaldoCop: string;
  /**
   * Porcentaje del activo total del folio que esta clase representa, formateado
   * con una decimal y coma decimal (estándar Colombia). Ej: "82,5". `null`
   * cuando el activo total es 0 (no se puede calcular cobertura porcentual).
   */
  percentOfFolio: string;
}

/**
 * Formatea un número decimal con una decimal y coma como separador (es-CO).
 * Determinístico — no usa Intl para garantizar estabilidad cross-runtime.
 */
function formatPercentEsCo(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  const sign = rounded < 0 ? '-' : '';
  const abs = Math.abs(rounded).toFixed(1);
  return sign + abs.replace('.', ',');
}

/**
 * Serializa un número de pesos COP a string MoneyCop (centavos, sin separador).
 * Why string: evita drift de floating-point en sumas grandes y permite que el
 * renderer use `parseMoneyCop` directamente (contrato compartido con los
 * agentes financieros).
 */
function toMoneyCopString(pesos: number): string {
  // Centavos = round(pesos * 100) para evitar drift binario (e.g. 1.1 * 100 ≠ 110).
  const cents = Math.round(pesos * 100);
  return cents.toString();
}

/**
 * Lookup tolerante: dado un código de clase PUC (incluyendo el caso especial
 * '25' que es un GRUPO dentro de Clase 2), devuelve los auxiliares de la
 * clase 1..9 estándar o los auxiliares del grupo 25xx para el caso laboral.
 */
function collectClassAccounts(
  snap: PeriodSnapshot | null | undefined,
  classCode: CoverageClassCode,
): { auxiliariesCount: number; total: number } {
  if (!snap || !Array.isArray(snap.classes)) {
    return { auxiliariesCount: 0, total: 0 };
  }

  // Caso especial '25' — grupo dentro de Clase 2 (Pasivos laborales).
  if (classCode === '25') {
    const class2 = snap.classes.find((c) => c.code === 2);
    if (!class2) return { auxiliariesCount: 0, total: 0 };
    const accounts25 = class2.accounts.filter((acc) => acc.code.startsWith('25'));
    const auxiliariesCount = accounts25.filter(
      (acc) => acc.isLeaf || acc.level === 'Auxiliar',
    ).length;
    const total = accounts25.reduce((sum, acc) => sum + (acc.isLeaf ? acc.balance : 0), 0);
    return { auxiliariesCount, total };
  }

  // Caso estándar 1..9: lookup directo por `code === parseInt(classCode)`.
  const cls = snap.classes.find((c) => c.code === parseInt(classCode, 10));
  if (!cls) return { auxiliariesCount: 0, total: 0 };
  const auxiliariesCount = cls.accounts.filter(
    (acc) => acc.isLeaf || acc.level === 'Auxiliar',
  ).length;
  // `auxiliaryTotal` ya está pre-computado para clases 1..7; para 8/9 lo
  // derivamos sumando las hojas. Hacemos el cálculo manual de hojas para
  // garantizar coherencia con el conteo de auxiliares.
  const total = cls.accounts.reduce((sum, acc) => sum + (acc.isLeaf ? acc.balance : 0), 0);
  return { auxiliariesCount, total };
}

/**
 * Resume cobertura por clase PUC para el bloque de transparencia del Slide 12
 * (v8.1 §5). El resultado es determinístico y se cita literalmente en el
 * documento final — el LLM NO debe re-derivarlo.
 *
 * Why: el reporte declara "Auxiliares procesados: [N] · Cobertura Clases 1-6:
 * [%] · Cobertura Clase 25 (laboral): [% o 'No disponible']". Sin un helper
 * canónico, cada renderer (HTML Editor Jefe, PDF Élite, Excel) calcularía
 * los porcentajes con criterios distintos y divergerían.
 */
export function summarizeCoverage(preprocessed: PreprocessedBalance): CoverageByClass[] {
  const primary = preprocessed.primary;
  const totalAssets = Math.abs(primary?.controlTotals?.activo ?? 0);

  const codes: readonly CoverageClassCode[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '25'];
  return codes.map((classCode) => {
    const { auxiliariesCount, total } = collectClassAccounts(primary, classCode);
    const percent =
      totalAssets > 0 ? (Math.abs(total) / totalAssets) * 100 : 0;
    return {
      classCode,
      auxiliariesCount,
      totalSaldoCop: toMoneyCopString(total),
      percentOfFolio: formatPercentEsCo(percent),
    };
  });
}

// ---------------------------------------------------------------------------
// §5 Slide 12 — hash de verificación SHA-256 del payload consolidado
// ---------------------------------------------------------------------------

/**
 * Payload a hashear para el bloque "Verificación" del Slide 12 (v8.1 §5).
 * Cualquier shape JSON-serializable sirve; el hash es estable frente a
 * reordenamiento de claves de objetos top-level (las claves se ordenan
 * lexicográficamente antes de stringify). Las claves anidadas también se
 * estabilizan vía `replacer` recursivo.
 */
export interface ReportHashPayload {
  niif: unknown;
  strategy: unknown;
  governance: unknown;
}

/**
 * Serializador determinístico: ordena las claves de cualquier objeto plano
 * lexicográficamente antes de stringify. Arrays se preservan en su orden
 * original (semánticamente relevante en los EEFF — el orden de las líneas
 * importa).
 *
 * Why custom: `JSON.stringify(obj, Object.keys(obj).sort())` sólo ordena
 * las claves del nivel TOP. Si el payload tiene objetos anidados con orden
 * de inserción distinto entre runs, el hash cambia. El replacer recursivo
 * garantiza estabilidad total del hash.
 */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      const ordered: Record<string, unknown> = {};
      for (const k of Object.keys(val).sort()) {
        ordered[k] = (val as Record<string, unknown>)[k];
      }
      return ordered;
    }
    if (typeof val === 'bigint') {
      // BigInt no es JSON-serializable nativo; lo serializamos como string
      // decimal para preservar precisión (mismo enfoque que MoneyCop).
      return val.toString();
    }
    return val;
  });
}

/**
 * Hash SHA-256 determinístico del payload consolidado (v8.1 §5 Slide 12 —
 * "Verificación"). El hash hexadecimal se imprime en el bloque de
 * transparencia y se usa como identificador único del documento para QR /
 * verificación digital firmada.
 *
 * Determinismo: garantizado por `stableStringify` (ordena las claves de los
 * objetos recursivamente). Dos llamadas con el mismo payload — aunque las
 * keys lleguen en orden distinto — producen el mismo hash.
 *
 * Why SHA-256: estándar criptográfico, soportado nativamente por Node.js
 * `crypto`, suficientemente fuerte para integridad documental sin overhead.
 */
export function computeReportHash(payload: ReportHashPayload): string {
  const serialized = stableStringify(payload);
  return createHash('sha256').update(serialized).digest('hex');
}

// ---------------------------------------------------------------------------
// §1.5 — Confianza global agregada (Slide 12 "CONFIDENCE_GLOBAL")
// ---------------------------------------------------------------------------

/**
 * Bucket de confianza global v8.1 §5 Slide 12. Espejo del `ConfidenceBucket`
 * Zod que vive en `src/lib/agents/financial/contracts/html-editor.ts`. Lo
 * replicamos como interface TS aquí para que `aggregateConfidence` pueda
 * tipar su retorno sin crear un import circular con contratos del agente.
 */
export interface ConfidenceBucket {
  highPct: number;
  mediumPct: number;
  lowPct: number;
}

/**
 * Niveles de confianza canónicos (espejo de `ConfidenceLevelSchema`). Mantener
 * en sync con `src/lib/agents/financial/contracts/base.ts`.
 */
type ConfLevel = 'high' | 'medium' | 'low';

/**
 * Recorre recursivamente el payload de un agente (NIIF / Strategy / Governance)
 * acumulando los valores literales del campo `confidence`. La spec v8.1 §1.5
 * declara: `null | undefined` → confianza implícita `high` (sin dot visual);
 * `'medium'`/`'low'` activan el dot del renderer. Para el bucket global
 * tratamos `null/undefined` como `high` para coincidir con el contrato.
 *
 * Why recursivo: los 3 agentes emiten `confidence` en MUCHOS lugares:
 *   - NIIF: cada `StatementLineV8Schema.confidence` (balance, P&L, etc).
 *   - Strategy: `KpiSchema.confidence`, root `confidence`, `executiveDashboardRow`.
 *   - Governance: cada nota `NotaSchema.confidence`.
 * No vale la pena enumerar las rutas — un walk genérico es estable frente a
 * extensiones del schema sin tocar este helper.
 */
function collectConfidences(value: unknown, sink: { high: number; medium: number; low: number }): void {
  if (value == null) return;
  if (typeof value !== 'object') return;

  if (Array.isArray(value)) {
    for (const item of value) collectConfidences(item, sink);
    return;
  }

  const obj = value as Record<string, unknown>;
  // Captura el campo `confidence` cuando es un literal canónico. Si es null/
  // undefined, NO sumamos — el contrato §1.5 lo trata como `high` implícito;
  // sumarlo distorsionaría el bucket (los campos sin confianza explícita
  // dominarían el conteo).
  if ('confidence' in obj) {
    const c = obj.confidence;
    if (c === 'high' || c === 'medium' || c === 'low') {
      sink[c as ConfLevel] += 1;
    }
  }

  // Walk recursivo de TODOS los valores del objeto (incluido `confidence` —
  // es un string, el branch arriba ya lo capturó). Costo O(n) sobre los nodos
  // del JSON. Profundidades típicas <10, tamaño total <500 nodos por reporte.
  for (const key of Object.keys(obj)) {
    if (key === 'confidence') continue;
    collectConfidences(obj[key], sink);
  }
}

/**
 * Calcula el bucket de confianza global recorriendo los 3 JSONs de los
 * agentes secuenciales (NIIF Analyst, Strategy Director, Governance
 * Specialist). El renderer del Slide 12 consume `highPct` como el indicador
 * "CONFIDENCE_GLOBAL" del bloque de transparencia.
 *
 * Determinismo: dos llamadas con el mismo payload producen el mismo bucket
 * byte-a-byte (no se itera por orden de inserción, sólo se cuentan literales).
 *
 * Edge case: si NO hay un sólo `confidence: 'high'|'medium'|'low'` en los 3
 * JSONs, el bucket queda en `{100, 0, 0}` por convención (no podemos dividir
 * por cero; spec §1.5 dice "null equivale a high implícito" → ausencia de
 * disenso = full high).
 */
export function aggregateConfidence(payload: {
  niif: unknown;
  strategy: unknown;
  governance: unknown;
}): ConfidenceBucket {
  const sink = { high: 0, medium: 0, low: 0 };
  collectConfidences(payload.niif, sink);
  collectConfidences(payload.strategy, sink);
  collectConfidences(payload.governance, sink);

  const total = sink.high + sink.medium + sink.low;
  if (total === 0) {
    // Sin ningún confidence explícito — todo se interpreta como `high` implícito.
    return { highPct: 100, mediumPct: 0, lowPct: 0 };
  }

  // Round a 1 decimal para consistencia con el formato del Slide 12. Garantizamos
  // que la suma sea ~100 ± epsilon de redondeo (no normalizamos al 100 exacto
  // porque distorsionaría el indicador y el renderer tolera la holgura).
  const round1 = (v: number) => Math.round((v / total) * 1000) / 10;
  return {
    highPct: round1(sink.high),
    mediumPct: round1(sink.medium),
    lowPct: round1(sink.low),
  };
}
