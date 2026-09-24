// ---------------------------------------------------------------------------
// Escudo — lectura del balance con la regla común de ingesta (P4 cross-dep)
// ---------------------------------------------------------------------------
// El Modo Supervivencia y el Agente Fiscal re-derivan el balance desde el
// `rawData` que envía la UI. Antes lo parseaban con `parseTrialBalanceCSV`
// directo y por eso:
//   - ignoraban las directivas de ingesta confirmadas por el usuario
//     (`[unidad-confirmada=…]`, `[vencimientos=…]`): un balance "en miles"
//     confirmado se leía en pesos (cifras 1.000 veces menores);
//   - sumaban las hojas de un XLSX (`[period=…]`) en un único periodo
//     `current` (2025 + 2024 en el mismo saldo);
//   - seguían corriendo con una unidad declarada SIN confirmar, aunque el
//     preprocesador marca ese caso como motivo de integridad bloqueante
//     (recalculo-final-03) y /niif responde 422.
//
// Ahora se usa el MISMO helper que /upload, /niif y el Stage 0 del orquestador
// (`preprocessUploadedTrialBalanceText`) y el MISMO gate que /niif
// (`motivosBloqueoBalance`, I4-escudo 2): integridad de la lectura (unidad sin
// confirmar, importes ilegibles, columnas ambiguas, fuera de rango), bloqueos
// del curator posteriores a R8 (CUR-R8, CUR-R5, CUR-R12) y ecuación
// descuadrada que el Bridge de Cuadratura no explica detienen el módulo con el
// motivo; nunca se publica una cifra fiscal sobre ese balance. Las hojas
// incompatibles (`TrialBalanceIngestError`) y un texto tabular sin filas
// legibles también se detienen con motivo.
// ---------------------------------------------------------------------------

import { preprocessUploadedTrialBalanceText } from '@/lib/preprocessing/raw-data';
import {
  preprocessTrialBalance,
  type PreprocessedBalance,
} from '@/lib/preprocessing/trial-balance';

/** Mismo código que el 422 de /niif (`BALANCE_VALIDATION_FAILED`). */
export const ESCUDO_BALANCE_BLOQUEADO_CODE = 'BALANCE_VALIDATION_FAILED' as const;

/**
 * El balance no se puede usar como base de las cifras fiscales. `reasons` son
 * los motivos legibles del preprocesador (los mismos del 422 de /niif); el
 * llamador los muestra al usuario tal cual.
 */
export class EscudoBalanceBloqueadoError extends Error {
  readonly code = ESCUDO_BALANCE_BLOQUEADO_CODE;
  readonly reasons: string[];

  constructor(reasons: string[], language: 'es' | 'en' = 'es') {
    const encabezado =
      language === 'en'
        ? 'The trial balance cannot be used as the basis for tax figures:'
        : 'El balance de prueba no se puede usar como base de las cifras fiscales:';
    super(`${encabezado} ${reasons.join(' ')}`);
    this.name = 'EscudoBalanceBloqueadoError';
    this.reasons = reasons;
  }
}

/** Cuerpo del 422 (JSON) y del evento SSE `error` de las rutas del Escudo. */
export interface EscudoBalanceBloqueadoPayload {
  /** Encabezado legible en el idioma de la petición. */
  error: string;
  /** Encabezado + razones en viñetas (lo que muestra un consumidor que sólo lee `detail`). */
  detail: string;
  code: typeof ESCUDO_BALANCE_BLOQUEADO_CODE;
  reasons: string[];
}

/**
 * Respuesta de /api/escudo/fiscal y /api/escudo-survival ante un balance
 * bloqueado: el mismo contrato que el 422 de /niif (`code` + `reasons`), para
 * que la UI muestre por qué no hay cifras fiscales (I4-escudo 1).
 */
export function escudoBalanceBloqueadoPayload(
  error: EscudoBalanceBloqueadoError,
  language: 'es' | 'en' = 'es',
): EscudoBalanceBloqueadoPayload {
  const intro =
    language === 'en'
      ? 'The trial balance cannot be used as the basis for tax figures. Fix the file and try again.'
      : 'El balance de prueba no se puede usar como base de las cifras fiscales. Corrija el archivo y vuelva a intentarlo.';
  const reasons = [...error.reasons];
  return {
    error: intro,
    detail: `${intro}\n\n${reasons.map((r) => `• ${r}`).join('\n')}`,
    code: ESCUDO_BALANCE_BLOQUEADO_CODE,
    reasons,
  };
}

/** Motivos propios de este módulo, en el idioma del informe (los del preprocesador van tal cual). */
const MOTIVO_TABULAR_SIN_FILAS: Record<'es' | 'en', string> = {
  es:
    'No se pudieron leer las filas del balance de prueba: el archivo tiene códigos de cuenta ' +
    'pero su primera fila no es un encabezado reconocible (código, nombre, saldo / débito / ' +
    'crédito) o las cifras no se pudieron interpretar. Deje el encabezado de columnas en la ' +
    'primera fila y vuelva a cargarlo.',
  en:
    'The trial balance rows could not be read: the file has account codes but its first row ' +
    'is not a recognizable header (code, name, balance / debit / credit) or the amounts could ' +
    'not be interpreted. Keep the column header in the first row and upload it again.',
};

const MOTIVO_SIN_FILAS: Record<'es' | 'en', string> = {
  es:
    'No se pudieron leer filas contables del balance de prueba. Cargue el balance como CSV o ' +
    'Excel con encabezado de columnas (código, nombre, saldo / débito / crédito).',
  en:
    'No accounting rows could be read from the trial balance. Upload it as CSV or Excel with a ' +
    'column header (code, name, balance / debit / credit).',
};

/**
 * Motivos por los que el balance NO sirve de base para cifras fiscales, con la
 * MISMA política que el gate de /niif (Stage 0.5 de `prepareFinancialContext`,
 * `deriveValidation` en orchestrator.ts), periodo por periodo (I4-escudo 2):
 *
 *   - motivos persistentes, que ningún cierre virtual levanta: integridad de
 *     la lectura (`integrityReasons`: unidad sin confirmar, importes
 *     ilegibles, columnas ambiguas, fuera de rango) y bloqueos del curator
 *     posteriores a R8 (`curatorBlockingReasons`: CUR-R8 residual no
 *     explicado, CUR-R5 desglose ≠ clase 3, CUR-R12 P&G posiblemente
 *     acumulado);
 *   - el bloqueo pre-R8 del snapshot (ecuación descuadrada), salvo cuando el
 *     Bridge de Cuadratura aplica: la ecuación post-R8 cuadra, R8 actuó y su
 *     ajuste es inmaterial (≤ 1 % del activo, mínimo $1.000.000). Entonces
 *     las razones pre-R8 son informativas y sólo bloquean las persistentes.
 *
 * Cada motivo lleva el prefijo del periodo, como el 422 de /niif. Lista vacía
 * ⇒ /niif aceptaría el balance. El Escudo no aplica ajustes del Doctor de
 * Datos (no recibe `adjustmentLedger`), así que no hay re-validación
 * post-ajustes que replicar. La prueba `politica-bloqueo-niif.test.ts` compara
 * esta función con el gate real de /niif sobre balances honestos y bloqueados.
 */
export function motivosBloqueoBalance(preprocessed: PreprocessedBalance): string[] {
  const textos = (arr: unknown): string[] =>
    Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  let bloquea = false;
  const motivos: string[] = [];
  for (const snap of preprocessed.periods ?? []) {
    const v = snap.validation;
    if (!v) continue;
    const tag = `[${snap.period}] `;
    const persistentes = [
      ...new Set([...textos(v.integrityReasons), ...textos(v.curatorBlockingReasons)]),
    ];
    const razones = textos(v.reasons);
    const todas = [...razones, ...persistentes.filter((r) => !razones.includes(r))];

    const vca = snap.virtualCloseAdjustment;
    const umbralMaterial = Math.max(Math.abs(snap.controlTotals?.activo ?? 0) * 0.01, 1_000_000);
    const bridge =
      snap.summary?.equationBalanced === true &&
      vca !== undefined &&
      Math.abs(vca.centsAdjustment ?? 0) <= umbralMaterial;

    if ((v.blocking && !bridge) || persistentes.length > 0) bloquea = true;
    if (bridge && v.blocking) {
      for (const r of todas) if (persistentes.includes(r)) motivos.push(`${tag}${r}`);
    } else {
      for (const r of todas) motivos.push(`${tag}${r}`);
    }
  }
  return bloquea ? motivos : [];
}

/**
 * Lanza `EscudoBalanceBloqueadoError` si /niif rechazaría el balance
 * (`motivosBloqueoBalance`): el Escudo no publica cifras fiscales sobre él.
 */
export function exigirBalanceUtilizable(
  preprocessed: PreprocessedBalance,
  language: 'es' | 'en' = 'es',
): void {
  const motivos = motivosBloqueoBalance(preprocessed);
  if (motivos.length > 0) throw new EscudoBalanceBloqueadoError(motivos, language);
}

export interface LeerBalanceEscudoOptions {
  language?: 'es' | 'en';
  /**
   * Qué hacer con un texto SIN forma de balance tabular (p. ej. OCR de un
   * PDF): `'bloquear'` (Agente Fiscal, que exige filas) o `'vacio'` (Modo
   * Supervivencia, que conserva su contrato de aceptar texto libre y trabaja
   * con un balance vacío). Un texto tabular sin filas siempre se bloquea,
   * igual que el Stage 0 de /niif.
   */
  sinFilas?: 'bloquear' | 'vacio';
}

/**
 * Lee y preprocesa el `rawData` del Escudo con la regla común de ingesta.
 * Devuelve el balance preprocesado o lanza `EscudoBalanceBloqueadoError` con
 * los motivos (hojas incompatibles, confirmaciones inválidas, texto tabular
 * sin filas y los mismos motivos del gate de /niif: integridad de la lectura,
 * CUR-R8/R5/R12 y ecuación descuadrada que el Bridge no explica).
 */
export function leerBalanceEscudo(
  rawData: string,
  options: LeerBalanceEscudoOptions = {},
): PreprocessedBalance {
  const language = options.language ?? 'es';
  const leido = preprocessUploadedTrialBalanceText(rawData ?? '');
  if (leido.kind === 'rejected') throw new EscudoBalanceBloqueadoError(leido.reasons, language);
  if (leido.kind === 'empty') {
    if (leido.tabular) {
      throw new EscudoBalanceBloqueadoError([MOTIVO_TABULAR_SIN_FILAS[language]], language);
    }
    if ((options.sinFilas ?? 'bloquear') === 'bloquear') {
      throw new EscudoBalanceBloqueadoError([MOTIVO_SIN_FILAS[language]], language);
    }
    return preprocessTrialBalance([]);
  }
  exigirBalanceUtilizable(leido.preprocessed, language);
  return leido.preprocessed;
}
