/**
 * Validación pura del intake NIIF.
 *
 * POR QUÉ existe este módulo: la resolución de `rawData` y la lista de campos
 * requeridos vivían duplicadas dentro del componente — `handleSubmit` calculaba
 * `resolvedRawData` por un camino y el wizard decidía `isValid` por otro. Ese
 * desfase permitía terminar los 4 pasos sin ningún dato contable y reventar al
 * final con HTTP 400 (`financialReportRequestSchema.rawData` exige `min(1)`).
 * Al unificar aquí, la vista previa y el submit comparten una sola verdad y el
 * bloqueo aparece en el paso donde el usuario todavía puede corregirlo.
 */

import type { NiifReportIntake, RegimenTributarioIntake } from '@/types/platform';
import {
  escribirDirectivasIngesta,
  leerDirectivasIngesta,
  motivoCodigoVencimientoInvalido,
  type UnidadMonetaria,
  type Vencimiento,
} from '@/lib/upload/ingest-directives';

/** Etiqueta del balance en la lista de faltantes (compartida con el banner). */
export const RAW_DATA_LABEL = 'Balance de prueba / datos contables';

/**
 * Etiqueta de la unidad pendiente de confirmar (P4-a): el archivo declara "en
 * miles / millones" y sin la elección del usuario /niif respondería 422.
 */
export const UNIT_PENDING_LABEL = 'Unidad de las cifras (pesos / miles / millones)';

/**
 * Datos contables efectivos de la corrida: gana lo extraído por OCR y, si no
 * hubo extracción (ruta "Llenar manualmente"), lo que el usuario pegó a mano.
 */
export function resolveNiifRawData(
  extractedRawText: string | null | undefined,
  typedRawData: string | null | undefined,
): string {
  return (extractedRawText || typedRawData || '').trim();
}

/**
 * Texto de balance que el intake NIIF debe usar de una respuesta de
 * /api/upload.
 *
 * POR QUÉ: `extractedText` lleva el informe de validación antepuesto (lo usa
 * el chat) y no es re-parseable como CSV; enviarlo como `rawData` dejaba el
 * informe NIIF sin preprocesado, sin totales vinculantes y sin gate 422
 * (ingesta-01). `rawData` es el dato tabular limpio. Con un servidor anterior
 * que no expone `rawData` se usa `extractedText` y el servidor del informe
 * descarta el informe antepuesto.
 */
export function pickNiifRawDataFromUpload(upload: {
  rawData?: string | null;
  extractedText?: string | null;
}): string {
  if (typeof upload.rawData === 'string' && upload.rawData.trim()) return upload.rawData;
  return upload.extractedText || '';
}

type RequiredSubset = Pick<NiifReportIntake, 'company' | 'fiscalPeriod' | 'niifGroup'>;

/**
 * Campos bloqueantes del paso "Revisar". Incluye el balance porque sin él el
 * pipeline NIIF no arranca: el backend lo rechaza antes de llamar a ningún
 * agente, y hasta ahora ese rechazo llegaba después de 4 pasos de trabajo.
 */
export function collectMissingRequired(
  values: RequiredSubset,
  resolvedRawData: string,
  opts: { unitPending?: boolean } = {},
): string[] {
  const missing: string[] = [];
  if (!values.company?.name?.trim()) missing.push('Razón Social');
  if (!values.company?.nit?.trim()) missing.push('NIT');
  if (!values.fiscalPeriod) missing.push('Periodo Fiscal');
  if (!values.niifGroup) missing.push('Grupo NIIF');
  if (!resolvedRawData) missing.push(RAW_DATA_LABEL);
  if (opts.unitPending) missing.push(UNIT_PENDING_LABEL);
  return missing;
}

/** El paso "Revisar" solo deja avanzar cuando no queda ningún bloqueante. */
export function isReviewStepValid(
  values: RequiredSubset,
  resolvedRawData: string,
  opts: { unitPending?: boolean } = {},
): boolean {
  return collectMissingRequired(values, resolvedRawData, opts).length === 0;
}

/**
 * Datos contables que viajan al pipeline con las confirmaciones del intake
 * (P4) escritas como directivas al inicio: `rawData` es la fuente que
 * re-leen /niif, Stage 0 y /export, así que la confirmación no depende de que
 * cada llamada reenvíe un campo aparte.
 *
 *  - `vencimientos`: excepciones de vencimiento declaradas en el intake; se
 *    suman a las que ya traiga el texto (las del intake prevalecen).
 *  - `unidadConfirmada`: unidad elegida para un balance PEGADO a mano (en un
 *    archivo la confirma /api/upload y ya viene en el texto). `undefined`
 *    conserva la del texto.
 *
 * Sin confirmaciones devuelve el texto intacto.
 */
export function applyIntakeDirectives(
  rawData: string,
  opts: {
    vencimientos?: Readonly<Record<string, Vencimiento>> | null;
    unidadConfirmada?: UnidadMonetaria | null;
  },
): string {
  const venc = Object.entries(opts.vencimientos ?? {});
  const unidad = opts.unidadConfirmada ?? undefined;
  if (!rawData || (venc.length === 0 && unidad === undefined)) return rawData;
  const actual = leerDirectivasIngesta(rawData);
  const vencimientos =
    venc.length > 0 ? { ...(actual.vencimientos ?? {}), ...Object.fromEntries(venc) } : undefined;
  return escribirDirectivasIngesta(rawData, {
    ...(unidad !== undefined ? { unidadConfirmada: unidad } : {}),
    ...(vencimientos ? { vencimientos } : {}),
  });
}

/**
 * Normaliza y valida un código de excepción de vencimiento escrito en el
 * intake (`12.05` → `1205`). Devuelve el código o el motivo del rechazo.
 */
export function parseMaturityOverrideCode(
  input: string,
):
  | { ok: true; code: string }
  | { ok: false; kind: 'format' | 'class'; reason: string } {
  const code = input.replace(/[.\-\s]/g, '');
  const reason = motivoCodigoVencimientoInvalido(code);
  if (!reason) return { ok: true, code };
  // `kind` elige el texto del diccionario (es/en) que ve el usuario; `reason`
  // es el motivo del servidor, en español.
  return { ok: false, kind: /^\d{2,20}$/.test(code) ? 'class' : 'format', reason };
}

/**
 * Año fiscal del balance subido (`preprocessed.primary.period` de /api/upload):
 * `2024`, `2025-06` o `Saldo Dic 2023` → el año de 4 dígitos. `undefined` si el
 * rótulo no trae un año reconocible (nunca se inventa).
 */
export function fiscalPeriodFromPreprocessed(preprocessed: unknown): string | undefined {
  if (!preprocessed || typeof preprocessed !== 'object') return undefined;
  const primary = (preprocessed as { primary?: { period?: unknown } | null }).primary;
  const period = primary?.period;
  if (typeof period !== 'string') return undefined;
  return /(?:^|\D)(\d{4})(?:\D|$)/.exec(period)?.[1];
}

/**
 * Periodo fiscal del intake tras la extracción (pipeline-flujo-17).
 *
 * POR QUÉ: el valor por defecto (año actual − 1) ocupaba el campo y el prefill
 * sólo rellenaba campos vacíos, de modo que el periodo del balance nunca lo
 * corregía y el servidor sellaba el informe por periodo incoherente. Gana el
 * periodo extraído del balance salvo que el usuario haya editado el campo; un
 * campo vacío siempre se rellena.
 */
export function resolveExtractedFiscalPeriod(args: {
  current: string | null | undefined;
  extracted: string | null | undefined;
  userEdited: boolean;
}): string {
  const current = args.current ?? '';
  if (!args.extracted) return current;
  if (!current.trim()) return args.extracted;
  return args.userEdited ? current : args.extracted;
}

/**
 * Régimen de renta del intake (auditoria-calidad-31, I3-2) normalizado para
 * /niif: sólo `'ordinario'` o `'simple'`; cualquier otro valor (borrador viejo
 * de localStorage, campo ausente) → `null` = sin dato, que el gate evalúa como
 * régimen ordinario (V10 exigido). Nunca se infiere el régimen.
 */
export function normalizeRegimenTributario(value: unknown): RegimenTributarioIntake | null {
  return value === 'ordinario' || value === 'simple' ? value : null;
}
