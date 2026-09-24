import type { FinancialReport } from '@/lib/agents/financial/types';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import { revivePreprocessedBalance } from '@/lib/preprocessing/json-safe';
import { canonicalHash, sha256Hex, toCanonicalJsonValue } from './canonical';
import { readAdjustmentsTrail, type AdjustmentsTrail } from './adjustment-ledger';
import type { ReportProvenance } from './report-ref';

// ---------------------------------------------------------------------------
// Versión persistida del informe financiero (procedencia servidor)
// ---------------------------------------------------------------------------
// Una versión es la fila `reports` (kind = 'financial_report') que escribe
// /api/financial-report/consolidate al cerrar el camino partido. Contiene el
// informe tal como el servidor lo ensambló y validó, el balance preprocesado
// que el servidor RE-DERIVÓ del `rawData` (con los ajustes confirmados) y las
// huellas que atan una cosa con la otra. /export, /html y
// /api/escudo/fiscal-anchor la cargan por referencia `{reportId, reportHash}`
// dentro del workspace de la sesión y usan ESA versión: las cifras del cuerpo
// de la petición no la sustituyen.
//
// Módulo puro salvo por `node:crypto` (vía ./canonical): sin DB ni cookies,
// para poder probar la integridad sin almacenamiento.
// ---------------------------------------------------------------------------

export const FINANCIAL_REPORT_KIND = 'financial_report';

/**
 * Formato del objeto guardado en `reports.data`.
 *
 * `v2` (re-auditoría final, procedencia-R2-05): `reportHash` es la huella del
 * SOBRE completo —informe, huella del balance preprocesado (que a su vez ata
 * el balance), huella del archivo recibido, contratos, fecha, ajustes
 * confirmados e idioma—, no sólo del informe. El cliente sólo conserva
 * `{reportId, reportHash}`: con `v1` una fila con el balance, el contrato o la
 * fecha alterados (y su `sourceHash` recalculado) seguía resolviendo la misma
 * referencia y salía "verificada". Las filas `v1` se siguen leyendo (su huella
 * cubre sólo el informe; límite documentado).
 */
export const FINANCIAL_REPORT_VERSION_FORMAT = 'utopia.financial-report-version.v2';

/** Formato anterior (huella sólo del informe); se sigue leyendo. */
export const FINANCIAL_REPORT_VERSION_FORMAT_V1 = 'utopia.financial-report-version.v1';

/**
 * Reglas con las que se validó y persistió la versión: contrato del JSON NIIF
 * y sus validadores (E1–E25), gate común de exportación
 * (`financialExportBlockers`) y gates post-render de /consolidate, según la
 * auditoría integral del 2026-09-24. Subirla cuando cambie de forma observable
 * lo que una versión persistida garantiza.
 *
 * `.2` (I3): el Markdown de las Partes I–III de la versión lo re-renderizó el
 * servidor desde el JSON de cada Parte (el del navegador se descarta), y una
 * Parte II/III sin JSON válido queda sellada.
 *
 * `.3` (I5): la identidad (nombre, NIT, periodo) de las Partes II/III se cruza
 * con la de los estados y las cifras de las notas de los estados y de las
 * notas técnicas de la Parte I con sus anclas; la Parte que no coincide queda
 * sellada. /export y /html por referencia re-renderizan una versión anterior
 * con estas reglas y el sello de procedencia nombra ambos contratos
 * ("persistida con .2, re-renderizada con .3").
 *
 * `.4` (ronda final): la huella de la versión cubre el sobre completo (formato
 * `v2`), la versión guarda los ajustes confirmados del Doctor de Datos con su
 * detalle (anexo de ajustes del PDF y del HTML) y el idioma del informe, y una
 * desviación que el código ya corrigió en el JSON NIIF no sella la Parte I.
 */
export const FINANCIAL_REPORT_CONTRACT_VERSION = 'informe-niif-2026-09-24.4';

/**
 * Contrato del preprocesador con el que se derivó el balance persistido.
 * Espejo de `PREPROCESSOR_CONTRACT_VERSION` (src/lib/api/trial-balances.ts);
 * una prueba de deriva los mantiene iguales sin arrastrar el módulo del API v1
 * a las rutas financieras.
 */
export const REPORT_PREPROCESSOR_VERSION = 'tb-2026-09-24.4';

export interface FinancialReportVersionData {
  format: typeof FINANCIAL_REPORT_VERSION_FORMAT | typeof FINANCIAL_REPORT_VERSION_FORMAT_V1;
  contractVersion: string;
  preprocessorVersion: string;
  /**
   * `v2`: SHA-256 del sobre (`hashVersionEnvelope`: todo salvo esta huella y
   * el balance, que queda atado por `sourceHash`). `v1`: SHA-256 del JSON
   * canónico de `report`.
   */
  reportHash: string;
  /** SHA-256 del JSON canónico de `preprocessed` (null sin balance). */
  sourceHash: string | null;
  /** SHA-256 del texto del balance recibido (null si no llegó). */
  rawDataHash: string | null;
  createdAt: string;
  /** Informe en su forma JSON canónica. */
  report: FinancialReport;
  /** Balance preprocesado JSON-safe (bigint → cadena decimal) o null. */
  preprocessed: unknown;
  /**
   * Ajustes confirmados del Doctor de Datos aplicados al balance y su detalle
   * (saldo previo y nuevo por cuenta), o null sin ajustes (`v2`; ausente en
   * `v1`). Alimenta el anexo de ajustes del PDF y del HTML (procedencia-R2-02).
   */
  adjustments?: AdjustmentsTrail | null;
  /** Idioma del informe (`v2`; en `v1` se deriva del consolidado). */
  language?: 'es' | 'en';
}

/** Huella del informe (JSON canónico). */
export function hashFinancialReport(report: FinancialReport): string {
  return canonicalHash(report);
}

/**
 * Huella del sobre de una versión `v2`: todo lo que la versión afirma salvo la
 * propia huella. El balance entra por su `sourceHash` (que la verificación
 * comprueba contra el balance guardado).
 */
export function hashVersionEnvelope(data: Omit<FinancialReportVersionData, 'reportHash' | 'preprocessed'>): string {
  return canonicalHash({
    format: data.format,
    contractVersion: data.contractVersion,
    preprocessorVersion: data.preprocessorVersion,
    sourceHash: data.sourceHash,
    rawDataHash: data.rawDataHash,
    createdAt: data.createdAt,
    adjustments: data.adjustments ?? null,
    language: data.language ?? null,
    report: data.report,
  });
}

/** Idioma del informe de una versión: el declarado (`v2`) o el de su consolidado. */
export function versionLanguage(data: { language?: unknown; report?: { consolidatedReport?: unknown } }): 'es' | 'en' {
  if (data.language === 'es' || data.language === 'en') return data.language;
  const consolidated = data.report?.consolidatedReport;
  return typeof consolidated === 'string' && /^# CONSOLIDATED FINANCIAL REPORT$/m.test(consolidated) ? 'en' : 'es';
}

/** Huella del balance preprocesado (JSON canónico, bigint → decimal). */
export function hashPreprocessedBalance(preprocessed: unknown): string | null {
  return preprocessed === null || preprocessed === undefined ? null : canonicalHash(preprocessed);
}

/**
 * Construye la versión a persistir. El informe y el balance se guardan en su
 * forma canónica, de modo que lo que se lee de `jsonb` reproduce las huellas.
 */
export function buildFinancialReportVersion(input: {
  report: FinancialReport;
  preprocessed: PreprocessedBalance | null | undefined;
  rawData: string | null | undefined;
  createdAt?: string;
  /** Ajustes confirmados aplicados al balance y su detalle (null/omitido sin ajustes). */
  adjustments?: AdjustmentsTrail | null;
  language?: 'es' | 'en';
}): FinancialReportVersionData {
  const report = toCanonicalJsonValue(input.report);
  const preprocessed =
    input.preprocessed === null || input.preprocessed === undefined
      ? null
      : toCanonicalJsonValue(input.preprocessed);
  const adjustments =
    input.adjustments && input.adjustments.applied.length > 0 ? toCanonicalJsonValue(input.adjustments) : null;
  const envelope = {
    format: FINANCIAL_REPORT_VERSION_FORMAT,
    contractVersion: FINANCIAL_REPORT_CONTRACT_VERSION,
    preprocessorVersion: REPORT_PREPROCESSOR_VERSION,
    sourceHash: hashPreprocessedBalance(preprocessed),
    rawDataHash:
      typeof input.rawData === 'string' && input.rawData.length > 0 ? sha256Hex(input.rawData) : null,
    createdAt: input.createdAt ?? new Date().toISOString(),
    report,
    adjustments,
    language: input.language ?? versionLanguage({ report }),
  } satisfies Omit<FinancialReportVersionData, 'reportHash' | 'preprocessed'>;
  return { ...envelope, reportHash: hashVersionEnvelope(envelope), preprocessed };
}

export function provenanceOf(reportId: string, data: FinancialReportVersionData): ReportProvenance {
  return {
    reportId,
    reportHash: data.reportHash,
    sourceHash: data.sourceHash,
    rawDataHash: data.rawDataHash,
    contractVersion: data.contractVersion,
    preprocessorVersion: data.preprocessorVersion,
    createdAt: data.createdAt,
  };
}

export type VerifiedVersion =
  | {
      ok: true;
      data: FinancialReportVersionData;
      report: FinancialReport;
      preprocessed: PreprocessedBalance | undefined;
      /** Ajustes confirmados de la versión (null sin ajustes o en `v1`). */
      adjustments: AdjustmentsTrail | null;
      language: 'es' | 'en';
    }
  | { ok: false; reason: string };

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Comprueba la integridad de una versión leída de `reports.data`: formato,
 * huella del informe, huella del balance y que el balance reviva como
 * `PreprocessedBalance`. No compara contra la referencia del cliente (eso lo
 * hace quien carga, para distinguir 409 de un fallo de almacenamiento).
 */
export function verifyFinancialReportVersion(raw: unknown): VerifiedVersion {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'formato de versión no reconocido' };
  }
  const data = raw as Partial<FinancialReportVersionData>;
  const v2 = data.format === FINANCIAL_REPORT_VERSION_FORMAT;
  if (!v2 && data.format !== FINANCIAL_REPORT_VERSION_FORMAT_V1) {
    return { ok: false, reason: 'formato de versión no reconocido' };
  }
  if (typeof data.reportHash !== 'string' || !HEX64.test(data.reportHash)) {
    return { ok: false, reason: 'la versión no trae la huella del informe' };
  }
  if (!data.report || typeof data.report !== 'object') {
    return { ok: false, reason: 'la versión no trae el informe' };
  }
  if (v2) {
    const envelope = data as FinancialReportVersionData;
    if (hashVersionEnvelope(envelope) !== data.reportHash) {
      return { ok: false, reason: 'la versión persistida no coincide con su huella' };
    }
  } else if (hashFinancialReport(data.report as FinancialReport) !== data.reportHash) {
    return { ok: false, reason: 'el informe persistido no coincide con su huella' };
  }
  const adjustments = v2 ? readAdjustmentsTrail(data.adjustments) : null;
  if (adjustments === undefined) {
    return { ok: false, reason: 'los ajustes de la versión no tienen una forma válida' };
  }
  const hasSource = data.preprocessed !== null && data.preprocessed !== undefined;
  if (hashPreprocessedBalance(hasSource ? data.preprocessed : null) !== (data.sourceHash ?? null)) {
    return { ok: false, reason: 'el balance persistido no coincide con su huella' };
  }
  let preprocessed: PreprocessedBalance | undefined;
  if (hasSource) {
    // `revivePreprocessedBalance` muta en sitio: se revive una copia para no
    // alterar el objeto cuya huella se acaba de comprobar.
    const revived = revivePreprocessedBalance(structuredClone(data.preprocessed));
    if (!revived) return { ok: false, reason: 'el balance persistido no es un balance preprocesado válido' };
    preprocessed = revived;
  }
  return {
    ok: true,
    data: data as FinancialReportVersionData,
    report: structuredClone(data.report) as FinancialReport,
    preprocessed,
    adjustments: adjustments ? structuredClone(adjustments) : null,
    language: versionLanguage(data),
  };
}
