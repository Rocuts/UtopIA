'use client';

import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  Download,
  FileText,
  Copy,
  RotateCcw,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Clock,
  CheckCircle,
  Loader2,
  AlertTriangle,
  Check,
  Stethoscope,
  GitCompare,
  Globe,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { MARKDOWN_SANITIZE_SCHEMA } from '@/lib/security/markdown-sanitize-schema';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useLanguage } from '@/context/LanguageContext';
import { StreamingText } from '@/design-system/components/StreamingText';
import { DSBadge } from '@/design-system/components/Badge';
import { ProgressRing } from '@/design-system/components/ProgressRing';
import { ReportFollowUpChat } from './ReportFollowUpChat';
import { RepairChat } from './repair/RepairChat';
import { ReportDiff } from './ReportDiff';
import { HtmlReportViewer } from './HtmlReportViewer';
import type {
  ProvisionalFlag,
  Adjustment,
  AdjustmentLedger,
} from '@/lib/agents/repair/types';
import type {
  PipelineState,
  FinancialReport,
  ReportSection,
  QualityGrade,
  NiifReportIntake,
} from '@/types/platform';
import type {
  FinancialReport as BackendFinancialReport,
  FinancialProgressEvent,
  CompanyInfo,
  NiifAnalysisResult,
  StrategicAnalysisResult,
  GovernanceResult,
  FiscalSnapshot,
} from '@/lib/agents/financial/types';
import type { NiifAncora } from '@/lib/agents/financial/ancora/types';
import { formatCopFromCents } from '@/lib/agents/financial/contracts/money';
import type {
  AuditReport as BackendAuditReport,
  AuditProgressEvent,
  AuditDomain,
} from '@/lib/agents/financial/audit/types';
import type { QualityAssessment as BackendQualityAssessment } from '@/lib/agents/financial/quality/types';
import type { ReportIterationTurn } from './types';
import { consumeSSE, fetchSSEWithRetry } from '@/lib/sse/consume';
import {
  CLIENT_REPORT_MODEL_ID,
  detectMissingPhases,
  mergeWarnings,
  saveNiifCheckpoint,
  loadNiifCheckpoint,
  clearNiifCheckpoint,
  type PipelinePhaseId,
} from './pipeline-resilience';

// ─── Capa 5 — Helpers contexto fiscal ────────────────────────────────────────

/**
 * Construye el bloque de texto que se inyecta al asistente como contexto fiscal
 * automático. Formateado en texto plano para máxima compatibilidad con el seed bus.
 *
 * Formato: "CONTEXTO FISCAL AUTOMÁTICO — {empresa} · {periodo}\nF01-F10 + score + alertas"
 */
function buildFiscalContextBlock(
  snap: FiscalSnapshot,
  company: CompanyInfo,
  language: 'es' | 'en',
): string {
  const { anchor, riskScore, period } = snap;
  const label = language === 'es'
    ? `CONTEXTO FISCAL AUTOMÁTICO — ${company.name} · ${period}`
    : `AUTOMATIC TAX CONTEXT — ${company.name} · ${period}`;

  const fmtPct = (n: number) => `${n.toFixed(1)}%`;

  const lines: string[] = [
    label,
    '─'.repeat(60),
    `F01 UAI Contable: ${formatCopFromCents(BigInt(anchor.f01))}`,
    `F02 Impuesto Referencia (35%): ${formatCopFromCents(BigInt(anchor.f02))}`,
    `F03 Retenciones Acumuladas: ${formatCopFromCents(BigInt(anchor.f03))}`,
    `F04 Neto a Pagar/Saldo a Favor: ${formatCopFromCents(BigInt(anchor.f04))}`,
    `F05 Provisión IVA: ${formatCopFromCents(BigInt(anchor.f05))}`,
    `F06 Retefuente por Declarar: ${formatCopFromCents(BigInt(anchor.f06))}`,
    `F07 ICA Retenido: ${formatCopFromCents(BigInt(anchor.f07))}`,
    `F08 Total Pasivos Fiscales: ${formatCopFromCents(BigInt(anchor.f08))}`,
    `F09 Carga sobre Utilidad Neta: ${fmtPct(anchor.f09)}`,
    `F10 Cobertura de Retenciones: ${fmtPct(anchor.f10)}`,
    '─'.repeat(60),
  ];

  // El Score DIAN sólo significa algo con base gravable: sus seis factores son
  // razones sobre F01 o sobre los ingresos. Con F01 = $0 el cálculo devuelve
  // `publicable: false` y aquí NO se publica la cifra — un "0/100 bajo" que en
  // realidad es ausencia de datos sería una afirmación de bajo riesgo que el
  // balance no soporta (auditoría 2026-08, superficie 6). El campo llega por
  // JSON desde `computeRiskScore`; el `FiscalRiskScore` público aún no lo
  // declara, de ahí el ensanche estructural local.
  const scoreMeta = riskScore as { publicable?: boolean; noPublicableMotivo?: string | null };
  if (scoreMeta.publicable === false) {
    lines.push(
      language === 'es'
        ? `Score DIAN: NO DETERMINABLE — ${scoreMeta.noPublicableMotivo ?? 'sin base gravable (F01 = $0).'}`
        : `DIAN risk score: NOT DETERMINABLE — no taxable base for the period (F01 = $0); the score model has nothing to measure.`,
    );
  } else {
    lines.push(`Score DIAN: ${riskScore.score}/100 — ${riskScore.nivel.toUpperCase()}`);
  }

  if (anchor.alertas.length > 0) {
    lines.push(language === 'es' ? 'Alertas:' : 'Alerts:');
    for (const alerta of anchor.alertas) {
      lines.push(`  · [${alerta.severidad.toUpperCase()}] ${alerta.codigo}: ${alerta.mensaje}`);
    }
  }

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────

const SPRING = { stiffness: 400, damping: 25 };

// ─── i18n de la superficie del pipeline ─────────────────────────────────────
// El monitor del pipeline y los mensajes de fase estaban hardcodeados en
// español mientras el resto del producto respetaba el toggle ES/EN. Un usuario
// en inglés veía el flujo estrella a medio traducir.
const STAGE_LABELS_BY_LANG = {
  es: [
    { label: 'Analista NIIF', sublabel: 'Estados financieros y notas' },
    { label: 'Director de Estrategia', sublabel: 'KPIs y proyecciones' },
    { label: 'Gobierno Corporativo', sublabel: 'Acta y cumplimiento' },
  ],
  en: [
    { label: 'IFRS Analyst', sublabel: 'Financial statements and notes' },
    { label: 'Strategy Director', sublabel: 'KPIs and projections' },
    { label: 'Corporate Governance', sublabel: 'Minutes and compliance' },
  ],
} as const;

/** Etiqueta de sub-fase usada en los mensajes de error de `runSSEPhase`. */
const PHASE_LABELS: Record<'niif' | 'strategy' | 'governance', { es: string; en: string }> = {
  niif: { es: 'Analista NIIF', en: 'IFRS Analyst' },
  strategy: { es: 'Director de Estrategia', en: 'Strategy Director' },
  governance: { es: 'Gobierno Corporativo', en: 'Corporate Governance' },
};

const AUDITOR_LABELS_BY_LANG = {
  es: {
    niif: 'NIIF/Contable',
    tributario: 'Tributario',
    legal: 'Legal/Societario',
    revisoria: 'Rev. Fiscal',
  },
  en: {
    niif: 'IFRS/Accounting',
    tributario: 'Tax',
    legal: 'Legal/Corporate',
    revisoria: 'Statutory Audit',
  },
} as const;

// ─── Registro de la corrida a nivel de MÓDULO ───────────────────────────────
// Auditoría 2026-08. La corrida vivía atada al ciclo de vida del componente:
// el cleanup del efecto hacía `controller.abort()`, así que cambiar el idioma,
// navegar a otra área o cualquier re-render que tocara las dependencias mataba
// un trabajo de 3-5 minutos ya pagado — a veces sin siquiera mostrar un error
// (el `AbortError` se traga y el spinner giraba para siempre).
//
// Al mover el registro al módulo:
//   · el desmontaje del componente YA NO aborta el fetch. Los checkpoints se
//     escriben vía `setLastCompletedReport`, que vive en WorkspaceContext (en
//     el layout, no se desmonta), así que la corrida termina y persiste aunque
//     el usuario se vaya a otra pantalla.
//   · un remount no re-dispara la misma corrida (`dispatchedInput` compara
//     identidad del intake), que sería cobrar dos veces el mismo reporte.
// Sigue siendo una mitigación: la arquitectura definitiva es el `runId`
// server-side del POST-MVP NOTE de arriba.
const runtimeRun: {
  /** Identidad del intake ya despachado. Evita re-disparos en remount. */
  dispatchedInput: unknown;
  /**
   * Intake de la corrida anterior. Distingue "primera corrida" de
   * "regeneración" (ajustes del Doctor, provisional, reintento), que exige
   * limpiar auditoría y calidad de la corrida previa.
   */
  startedInput: unknown;
  controller: AbortController | null;
  inFlight: boolean;
} = { dispatchedInput: null, startedInput: null, controller: null, inFlight: false };

// ─── POST-MVP NOTE ──────────────────────────────────────────────────────────
// La orquestacion del pipeline de 3 fases esta en el cliente (este useEffect).
// Es fragil: `ERR_NETWORK_CHANGED`, cambios de red, VPN, o cierre del tab
// pueden perder trabajo ya completado por el servidor. Para la version
// production-grade (post-MVP) hay que migrar a Vercel Workflow DevKit:
// cada fase se convierte en `step.do(...)` con checkpoints automaticos en
// Blob/KV, retries built-in y resume crash-safe. El cliente solo guarda un
// `runId` y se conecta para leer progreso. Ver `docs/POST_MVP_WORKFLOW_MIGRATION.md`.
// Los parches defensivos que siguen (checkpoint local tras Fase 1, fases 2/3
// no-bloqueantes, retry en Fase 3) son mitigaciones MVP, no la arquitectura
// final.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Fetch con reintentos ante errores de red transitorios (`TypeError: Failed to
 * fetch`, p.ej. `ERR_NETWORK_CHANGED`). Solo reintenta errores de RED — los
 * HTTP no-ok y los errores de parseo NO se reintentan (probablemente son
 * deterministas). Respeta `AbortSignal` durante el backoff para no bloquear
 * unmounts del componente.
 */
async function fetchJSONWithRetry<T>(
  url: string,
  init: RequestInit,
  opts: { retries?: number; backoffMs?: number[] } = {},
): Promise<T> {
  const retries = opts.retries ?? 2;
  const backoff = opts.backoffMs ?? [1000, 3000];
  const signal = init.signal ?? undefined;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      const res = await fetch(url, init);
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${errBody.slice(0, 300)}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      const e = err as Error;
      if (e.name === 'AbortError') throw err;
      const isNetwork = err instanceof TypeError;
      if (!isNetwork || attempt === retries) throw err;
      lastErr = err;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, backoff[attempt] ?? 3000);
        const onAbort = () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    }
  }
  throw lastErr;
}

// ─── Wave 3.F2 — orquestación cliente de los 3 endpoints split ────────────
// `runSSEPhase` envuelve `fetchSSEWithRetry + consumeSSE` para los 3 endpoints
// nuevos (`/niif`, `/strategy`, `/governance`). Cada endpoint emite el mismo
// canal `progress` (FinancialProgressEvent passthrough) y un evento nombrado
// específico cuyo payload acarrea el resultado. El helper centraliza el
// patrón: una sola caja `{ value }` se llena desde el handler del evento
// específico, los progress events se propagan al UI, y los errores se
// re-lanzan con un mensaje contextualizado por sub-fase (Capa 3 — diagnóstico
// por fase concreta, no genérico "Phase 1 falló").
//
// `phaseLabel` se inyecta en el wrapper de error → el usuario ve "Strategy
// Director falló: <detail backend>" en vez del legacy "Phase 1 falló".
// ────────────────────────────────────────────────────────────────────────────

interface SubPhaseHandlers {
  /** Callback para FinancialProgressEvent (stage_start, stage_progress, stage_complete). */
  onProgress?: (evt: FinancialProgressEvent) => void;
  /**
   * Advertencias de validación emitidas por el backend como `event: warning`.
   *
   * Auditoría 2026-08 (P0 `sse-warnings-descartados-cliente`): el backend
   * emitía por este canal los errores del validador de identidades contables
   * (ecuación patrimonial rota, EFE que no cierra, ECP que no cuadra contra el
   * patrimonio del balance, totales que no coinciden con el preprocesador) y
   * el cliente NO registraba handler, así que `consumeSSE` los descartaba en
   * silencio. El sistema detectaba que las cifras estaban mal y el usuario
   * recibía un reporte de apariencia impecable.
   */
  onWarning?: (warnings: string[]) => void;
  /** Manejadores adicionales para eventos sidecar (ej. fiscal_snapshot). */
  onExtra?: Record<string, (raw: unknown) => void>;
}

async function runSSEPhase<T>(
  url: string,
  body: unknown,
  eventName: string,
  signal: AbortSignal,
  phaseLabel: string,
  handlers: SubPhaseHandlers = {},
): Promise<T> {
  const res = await fetchSSEWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Stream': 'true' },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(
      `${phaseLabel} falló (HTTP ${res.status}): ${errBody.slice(0, 300)}`,
    );
  }

  const box: { value: T | null } = { value: null };

  const extraHandlers: Record<string, (raw: unknown) => void> = handlers.onExtra ?? {};

  await consumeSSE(res, signal, {
    progress: (raw) => {
      handlers.onProgress?.(raw as FinancialProgressEvent);
    },
    warning: (raw) => {
      const { warnings } = (raw ?? {}) as { warnings?: unknown };
      if (!Array.isArray(warnings)) return;
      const texts = warnings.filter((w): w is string => typeof w === 'string');
      if (texts.length > 0) handlers.onWarning?.(texts);
    },
    [eventName]: (raw) => {
      box.value = raw as T;
    },
    ...extraHandlers,
    error: (raw) => {
      const { detail } = raw as { detail?: string };
      // Contextualizamos el error con el nombre de la sub-fase. El backend ya
      // tradujo el error técnico (`toFriendlyError`); aquí solo prepondemos
      // qué fase fue la que falló para que la UI sepa qué reintentar.
      throw new Error(`${phaseLabel} falló: ${detail || 'error desconocido del backend'}`);
    },
  });

  if (box.value === null) {
    throw new Error(
      `${phaseLabel} cerró el stream sin enviar '${eventName}'. ` +
        `Probable causa: alguno de los pases internos agotó su presupuesto de tiempo. ` +
        `Reintenta — el siguiente intento aprovecha el caché de prompt y suele cerrar en la mitad del tiempo.`,
    );
  }

  return box.value;
}

// ─── Wave 4.F8 — helpers cliente para metadata determinístico HTML v8.1 ────
// El endpoint `/api/financial-report/html` exige un bloque `metadata`
// pre-cocinado por el caller (hash SHA-256, cobertura por clase PUC,
// confianza global). Los helpers de `src/lib/preprocessing/v8-helpers.ts`
// son server-side (importan `node:crypto`) — bundlearlos en un client
// component rompe el build, así que reimplementamos los 3 cómputos aquí con
// Web Crypto API + walk genérico del JSON. Misma semántica determinística.
// ────────────────────────────────────────────────────────────────────────────

/** Espejo del `CoverageByClass` Zod en `contracts/html-editor.ts`. */
interface ClientCoverageRow {
  classCode: '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '25';
  auxiliariesCount: number;
  totalSaldoCop: string;
  percentOfFolio: string;
}

/** Espejo del `ConfidenceBucket` Zod. */
interface ClientConfidenceBucket {
  highPct: number;
  mediumPct: number;
  lowPct: number;
}

/** Formatea decimal a `es-CO` con coma y 1 decimal — determinístico (sin Intl). */
function formatPercentEsCoClient(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  const sign = rounded < 0 ? '-' : '';
  const abs = Math.abs(rounded).toFixed(1);
  return sign + abs.replace('.', ',');
}

/** MoneyCop: pesos → centavos como string. Mismo helper que server. */
function toMoneyCopStringClient(pesos: number): string {
  return Math.round(pesos * 100).toString();
}

/**
 * Cobertura por clase PUC para el Slide 12 — re-implementación cliente del
 * `summarizeCoverage()` server. El `preprocessed` viaja como `unknown` por
 * SSE; aquí lo navegamos defensivamente. Si la shape no matchea (snapshot
 * de versión vieja, p.ej.), retornamos array vacío para no romper el HTML.
 */
function clientSummarizeCoverage(preprocessed: unknown): ClientCoverageRow[] {
  if (!preprocessed || typeof preprocessed !== 'object') return [];
  const root = preprocessed as Record<string, unknown>;
  const primary = root.primary as Record<string, unknown> | undefined;
  if (!primary) return [];

  // Control totals → activo total (denominador del % cobertura).
  const ct = primary.controlTotals as Record<string, unknown> | undefined;
  const totalAssetsRaw = ct && typeof ct.activo === 'number' ? (ct.activo as number) : 0;
  const totalAssets = Math.abs(totalAssetsRaw);

  // `classes: PUCClass[]` — cada clase tiene `accounts[]` con `code, balance, isLeaf, level`.
  const classes = Array.isArray(primary.classes) ? (primary.classes as Array<Record<string, unknown>>) : [];

  const codes: ClientCoverageRow['classCode'][] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '25'];

  return codes.map((classCode) => {
    let auxiliariesCount = 0;
    let total = 0;

    if (classCode === '25') {
      const class2 = classes.find((c) => c.code === 2);
      if (class2 && Array.isArray(class2.accounts)) {
        const accounts25 = (class2.accounts as Array<Record<string, unknown>>).filter(
          (acc) => typeof acc.code === 'string' && (acc.code as string).startsWith('25'),
        );
        auxiliariesCount = accounts25.filter(
          (acc) => acc.isLeaf === true || acc.level === 'Auxiliar',
        ).length;
        total = accounts25.reduce(
          (sum, acc) => sum + (acc.isLeaf === true && typeof acc.balance === 'number' ? (acc.balance as number) : 0),
          0,
        );
      }
    } else {
      const cls = classes.find((c) => c.code === parseInt(classCode, 10));
      if (cls && Array.isArray(cls.accounts)) {
        const accounts = cls.accounts as Array<Record<string, unknown>>;
        auxiliariesCount = accounts.filter(
          (acc) => acc.isLeaf === true || acc.level === 'Auxiliar',
        ).length;
        total = accounts.reduce(
          (sum, acc) => sum + (acc.isLeaf === true && typeof acc.balance === 'number' ? (acc.balance as number) : 0),
          0,
        );
      }
    }

    const percent = totalAssets > 0 ? (Math.abs(total) / totalAssets) * 100 : 0;
    return {
      classCode,
      auxiliariesCount,
      totalSaldoCop: toMoneyCopStringClient(total),
      percentOfFolio: formatPercentEsCoClient(percent),
    };
  });
}

/**
 * Walk recursivo del JSON contando literales `confidence`. Espejo cliente del
 * `aggregateConfidence` server. Spec §1.5: null/undefined → high implícito
 * (NO se cuenta), 'medium'/'low' activan el dot visual.
 */
function clientAggregateConfidence(payload: {
  niif: unknown;
  strategy: unknown;
  governance: unknown;
}): ClientConfidenceBucket {
  const sink = { high: 0, medium: 0, low: 0 };
  const visit = (val: unknown) => {
    if (val == null || typeof val !== 'object') return;
    if (Array.isArray(val)) {
      for (const item of val) visit(item);
      return;
    }
    const obj = val as Record<string, unknown>;
    if ('confidence' in obj) {
      const c = obj.confidence;
      if (c === 'high' || c === 'medium' || c === 'low') sink[c as 'high' | 'medium' | 'low'] += 1;
    }
    for (const key of Object.keys(obj)) {
      if (key === 'confidence') continue;
      visit(obj[key]);
    }
  };
  visit(payload.niif);
  visit(payload.strategy);
  visit(payload.governance);

  const total = sink.high + sink.medium + sink.low;
  if (total === 0) return { highPct: 100, mediumPct: 0, lowPct: 0 };
  const round1 = (v: number) => Math.round((v / total) * 1000) / 10;
  return {
    highPct: round1(sink.high),
    mediumPct: round1(sink.medium),
    lowPct: round1(sink.low),
  };
}

/**
 * Stable stringify: ordena claves de objetos recursivamente para que el hash
 * sea estable frente a re-ordenamientos. Mismo enfoque que el server.
 * BigInt → string decimal (preserva precisión).
 */
function stableStringifyClient(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      const ordered: Record<string, unknown> = {};
      for (const k of Object.keys(val).sort()) ordered[k] = (val as Record<string, unknown>)[k];
      return ordered;
    }
    if (typeof val === 'bigint') return (val as bigint).toString();
    return val;
  });
}

/**
 * Hash SHA-256 hex del payload consolidado vía Web Crypto. Equivalente al
 * `computeReportHash` server pero sin `node:crypto`. Async porque `crypto
 * .subtle.digest` lo es.
 */
async function clientComputeReportHash(payload: {
  niif: unknown;
  strategy: unknown;
  governance: unknown;
}): Promise<string> {
  const serialized = stableStringifyClient(payload);
  const buf = new TextEncoder().encode(serialized);
  const hashBuf = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Cuenta alertas técnicas del Strategy Director por severidad y findings de
 * auditoría por severidad. Compatible con campos legacy (severity literal
 * de cualquier shape). Devuelve {high, medium, low} para Slide 12.
 */
function countAlertsBySeverity(
  strategyJson: unknown,
  auditReport: { auditorResults?: Array<{ findings?: Array<{ severity?: string }> }> } | null,
): { high: number; medium: number; low: number } {
  const counts = { high: 0, medium: 0, low: 0 };

  // technicalAlerts del Strategy: severity 'red' | 'amber' | 'green'.
  const strat = strategyJson as Record<string, unknown> | null;
  const alerts = strat && Array.isArray(strat.technicalAlerts)
    ? (strat.technicalAlerts as Array<{ severity?: string }>)
    : [];
  for (const a of alerts) {
    if (a.severity === 'red') counts.high += 1;
    else if (a.severity === 'amber') counts.medium += 1;
    else if (a.severity === 'green') counts.low += 1;
  }

  // Findings de auditoría (severity 'high' | 'medium' | 'low' del schema legacy).
  if (auditReport && Array.isArray(auditReport.auditorResults)) {
    for (const r of auditReport.auditorResults) {
      if (!Array.isArray(r.findings)) continue;
      for (const f of r.findings) {
        if (f.severity === 'high') counts.high += 1;
        else if (f.severity === 'medium') counts.medium += 1;
        else if (f.severity === 'low') counts.low += 1;
      }
    }
  }
  return counts;
}

/**
 * Cuenta de auxiliares procesados — lee del campo top-level `auxiliaryCount`
 * del `PreprocessedBalance` (definido en v8-helpers.ts como número entero).
 */
function readAuxiliariesProcessed(preprocessed: unknown): number {
  if (!preprocessed || typeof preprocessed !== 'object') return 0;
  const ac = (preprocessed as Record<string, unknown>).auxiliaryCount;
  return typeof ac === 'number' ? ac : 0;
}

/**
 * Extrae el sector CIIU inferido del balance (`actividadInferida.sectorCIIU`).
 * Null si no hay inferencia o si el preprocessed es de versión previa.
 */
function readSectorCIIU(preprocessed: unknown): string | null {
  if (!preprocessed || typeof preprocessed !== 'object') return null;
  const ai = (preprocessed as Record<string, unknown>).actividadInferida;
  if (!ai || typeof ai !== 'object') return null;
  const sector = (ai as Record<string, unknown>).sectorCIIU;
  return typeof sector === 'string' ? sector : null;
}

/**
 * Extrae el reportMode del NIIF JSON (echo del orchestrator). Default
 * 'LINEA_BASE' si el JSON no lo expone (fixtures pre-F4).
 */
function readReportMode(niifJson: unknown): 'LINEA_BASE' | 'TRANSICION' | 'COMPARATIVO_COMPLETO' {
  if (!niifJson || typeof niifJson !== 'object') return 'LINEA_BASE';
  const mode = (niifJson as Record<string, unknown>).reportMode;
  if (mode === 'LINEA_BASE' || mode === 'TRANSICION' || mode === 'COMPARATIVO_COMPLETO') {
    return mode;
  }
  return 'LINEA_BASE';
}

// Reproduce el `buildConsolidatedReport` del orchestrator backend para que el
// cliente pueda ensamblar el Markdown final tras correr las 3 sub-fases. No es
// 100% idéntico al server-side: este cliente NO ejecuta `validateConsolidatedReport`,
// `provisionalWatermark`, ni `buildAdjustmentsAuditSection`. Esos validators viven
// solo en el endpoint legacy `/api/financial-report` (mantenido por compat con
// `/export`). Wave 4 los moverá a un endpoint `/consolidate` dedicado si el
// audit team detecta regresiones medibles.
function buildClientConsolidatedReport(
  company: CompanyInfo,
  niifContent: string,
  strategyContent: string,
  governanceContent: string,
  language: 'es' | 'en',
): string {
  const title =
    language === 'en'
      ? 'CONSOLIDATED FINANCIAL REPORT'
      : 'REPORTE FINANCIERO CONSOLIDADO';
  const subtitle =
    language === 'en'
      ? 'NIIF Elite Corporate Analysis'
      : 'Analisis Corporativo Elite NIIF';
  const date = new Date().toLocaleDateString(
    language === 'es' ? 'es-CO' : 'en-US',
    { year: 'numeric', month: 'long', day: 'numeric' },
  );

  return `# ${title}
## ${subtitle}

---

| Campo | Detalle |
|-------|---------|
| **Empresa** | ${company.name} |
| **NIT** | ${company.nit} |
| **Tipo Societario** | ${company.entityType || 'N/A'} |
| **Periodo Fiscal** | ${company.fiscalPeriod} |
| **Fecha de Generacion** | ${date} |
| **Generado por** | 1+1 — Financial Orchestrator (3 Agentes Especializados) |

---

# PARTE I: ESTADOS FINANCIEROS NIIF
*Preparado por: Agente Analista Contable NIIF*

${niifContent}

---

# PARTE II: ANALISIS ESTRATEGICO Y PROYECCIONES
*Preparado por: Agente Director de Estrategia Financiera*

${strategyContent}

---

# PARTE III: GOBIERNO CORPORATIVO Y DOCUMENTOS LEGALES
*Preparado por: Agente Especialista en Gobierno Corporativo*

${governanceContent}

---

> **Nota Legal:** Este reporte fue generado por 1+1, un sistema de inteligencia artificial. Las cifras, analisis y documentos legales deben ser validados por un Contador Publico certificado y un abogado antes de su uso oficial. 1+1 no reemplaza la asesoria profesional.
`;
}

// Stubs vacíos para `strategicAnalysis` y `governance` cuando se construye el
// checkpoint parcial post-NIIF. El tipo `BackendFinancialReport` exige ambos
// campos; los stubs permiten que el localStorage roundtrip funcione sin
// cambiar el contrato. La UI sabe que el reporte está incompleto vía
// `pipelineState.phase2Error` / banner explícito.
function emptyStrategy(): StrategicAnalysisResult {
  return {
    kpiDashboard: '',
    breakEvenAnalysis: '',
    projectedCashFlow: '',
    strategicRecommendations: '',
    fullContent: '',
  };
}
function emptyGovernance(): GovernanceResult {
  return {
    financialNotes: '',
    shareholderMinutes: '',
    fullContent: '',
  };
}

// ---------------------------------------------------------------------------
// Audit en paralelo — helper de fire-and-await
// ---------------------------------------------------------------------------
// Mayo 2026: optimización del pipeline. Antes el audit corría DESPUÉS de
// Governance, sumando ~45s al critical path. Ahora se dispara en paralelo
// con la cadena Strategy→Governance: el audit recibe `consolidatedReport`
// con el contenido del Pass NIIF y placeholders vacíos para strategic /
// governance. Los 4 auditores (que ya corren con Promise.allSettled) tienen
// suficiente contexto para los hallazgos NIIF/contables y tributarios; los
// hallazgos legales/de revisoría tendrán menos material pero el reporte se
// entrega más rápido.
//
// La función devuelve `{ ok, value, error }` para que el caller la
// pueda awaitear sin try/catch envolvente — el flujo del pipeline ya
// maneja `phase2Error` como warning no-bloqueante.
//
// El contenido auditado ya no viaja en el cuerpo: el servidor lo reconstruye
// desde la versión guardada y devuelve `auditVersionId`, `auditComplete` y
// `examinedStage` junto al resultado.
// ---------------------------------------------------------------------------
interface ParallelAuditCallbacks {
  onAuditorStarted: (domain: string) => void;
  onAuditorComplete: (domain: AuditDomain) => void;
  onAllAuditorsComplete: () => void;
  onFindings: (counts: Record<string, number>) => void;
}

type ParallelAuditOutcome =
  | { ok: true; value: BackendAuditReport | null }
  | { ok: false; error: string };

async function runAuditInBackground(args: {
  reportVersionId: string;
  language: 'es' | 'en';
  signal: AbortSignal;
  callbacks: ParallelAuditCallbacks;
}): Promise<ParallelAuditOutcome> {
  // El navegador ya no envía el contenido auditado: nombra la versión guardada
  // y el servidor reconstruye desde ella lo que los auditores examinan. En este
  // punto del pipeline esa versión es la de la fase NIIF, y el resultado queda
  // asociado exactamente a ella.
  let res: Response;
  try {
    res = await fetchSSEWithRetry('/api/financial-audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Stream': 'true' },
      body: JSON.stringify({ reportVersionId: args.reportVersionId, language: args.language }),
      signal: args.signal,
    });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') return { ok: true, value: null };
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      ok: false,
      error: `Auditoría falló (HTTP ${res.status}): ${body.slice(0, 300)}`,
    };
  }

  const box: { value: BackendAuditReport | null } = { value: null };
  try {
    await consumeSSE(res, args.signal, {
      progress: (raw) => {
        const evt = raw as AuditProgressEvent;
        if (evt.type === 'auditor_start') {
          args.callbacks.onAuditorStarted(evt.domain);
        } else if (evt.type === 'auditor_complete' || evt.type === 'auditor_failed') {
          args.callbacks.onAuditorComplete(evt.domain as AuditDomain);
        }
      },
      result: (raw) => {
        box.value = raw as BackendAuditReport;
      },
      error: (raw) => {
        const { detail } = raw as { detail?: string };
        throw new Error(detail || 'Error en auditoría');
      },
    });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') return { ok: true, value: null };
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' };
  }

  if (box.value) {
    const findingCounts: Record<string, number> = {};
    for (const r of box.value.auditorResults) {
      findingCounts[r.domain] = r.findings.length;
    }
    args.callbacks.onFindings(findingCounts);
    args.callbacks.onAllAuditorsComplete();
  }
  return { ok: true, value: box.value };
}

function splitReportIntoSections(markdown: string): ReportSection[] {
  if (!markdown) return [];
  const lines = markdown.split('\n');
  const sections: ReportSection[] = [];
  let currentTitle: string | null = null;
  let currentLines: string[] = [];
  let order = 0;

  const pushCurrent = () => {
    if (currentTitle !== null) {
      sections.push({
        id: `sec-${order}`,
        title: currentTitle || `Sección ${order + 1}`,
        content: currentLines.join('\n').trim(),
        order,
      });
      order += 1;
    }
  };

  for (const line of lines) {
    const h1 = line.match(/^#\s+(.+)$/);
    const h2 = line.match(/^##\s+(.+)$/);
    const heading = h1?.[1] ?? h2?.[1];
    if (heading) {
      pushCurrent();
      currentTitle = heading.trim();
      currentLines = [line];
    } else {
      if (currentTitle === null) {
        currentTitle = '';
        currentLines = [];
      }
      currentLines.push(line);
    }
  }
  pushCurrent();
  return sections.filter((s) => s.content.length > 0);
}

function StageNode({ index, state, label, sublabel, language }: {
  index: number;
  state: PipelineState;
  label: string;
  sublabel: string;
  language: 'es' | 'en';
}) {
  const prefersReduced = useReducedMotion();
  const stageNum = (index + 1) as 1 | 2 | 3;
  const isComplete = state.completedStages.includes(stageNum);
  const isActive = state.currentStage === stageNum && state.mode === 'running';
  const isPending = !isComplete && !isActive;

  return (
    <div className={cn(
      'rounded-xl border-2 px-5 py-4 min-w-[150px] text-center transition-colors',
      isComplete && 'bg-success/10 border-success',
      isActive && 'bg-gold-300/10 border-gold-500',
      isPending && 'bg-n-50 border-n-200',
    )}>
      <div className="flex items-center justify-center gap-1.5 mb-1">
        {isComplete && <CheckCircle className="w-3.5 h-3.5 text-success" />}
        {isActive && (
          <motion.div
            animate={prefersReduced ? {} : { rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          >
            <Loader2 className="w-3.5 h-3.5 text-gold-500" />
          </motion.div>
        )}
        {isPending && <div className="w-3.5 h-3.5 rounded-full border border-n-300" />}
        <span className={cn(
          'text-2xs font-bold font-mono uppercase',
          isComplete && 'text-success',
          isActive && 'text-gold-500',
          isPending && 'text-n-600',
        )}>
          {language === 'es' ? `Agente ${stageNum}` : `Agent ${stageNum}`}
        </span>
      </div>
      <p className={cn(
        'text-xs font-semibold',
        isComplete && 'text-success',
        isActive && 'text-gold-700',
        isPending && 'text-n-700',
      )}>
        {label}
      </p>
      <p className="text-2xs text-n-600 mt-0.5">{sublabel}</p>
    </div>
  );
}

function PipelineMonitor({ state, language }: { state: PipelineState; language: 'es' | 'en' }) {
  /* eslint-disable react-hooks/purity */
  const elapsed = state.startedAt
    ? Math.round((Date.now() - new Date(state.startedAt).getTime()) / 1000)
    : 0;
  /* eslint-enable react-hooks/purity */
  const [elapsedDisplay, setElapsedDisplay] = useState(elapsed);

  useEffect(() => {
    if (state.mode === 'complete') return;
    const interval = setInterval(() => {
      if (state.startedAt) {
        setElapsedDisplay(Math.round((Date.now() - new Date(state.startedAt).getTime()) / 1000));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [state.mode, state.startedAt]);

  const minutes = Math.floor(elapsedDisplay / 60);
  const seconds = elapsedDisplay % 60;
  const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  const overallProgress = (() => {
    const stageProgress = state.completedStages.length * 20;
    const auditProgress = state.auditorsComplete.length * 7.5;
    const qualityProgress = state.qualityGrade ? 10 : 0;
    return Math.min(stageProgress + auditProgress + qualityProgress, 100);
  })();

  const stages = STAGE_LABELS_BY_LANG[language];
  const auditorLabels = AUDITOR_LABELS_BY_LANG[language];
  // Texto que anuncia el avance a lectores de pantalla. El pipeline tarda
  // minutos; sin esto la corrida entera transcurre en silencio para quien no
  // ve la pantalla (auditoría 2026-08 `pipeline-errors-not-announced`).
  const activeStageLabel = stages[Math.max(0, state.currentStage - 1)]?.label ?? '';
  const liveStatus =
    state.mode === 'complete'
      ? language === 'es'
        ? 'Reporte completo.'
        : 'Report complete.'
      : language === 'es'
        ? `Fase ${state.currentStage} de 3 en curso: ${activeStageLabel}. Tiempo transcurrido ${timeStr}.`
        : `Phase ${state.currentStage} of 3 in progress: ${activeStageLabel}. Elapsed ${timeStr}.`;

  return (
    <div className="w-full">
      {/*
        Región viva: `aria-live="polite"` anuncia los cambios de fase sin
        interrumpir al usuario. Se mantiene fuera del árbol visual (sr-only)
        porque los nodos de fase ya comunican lo mismo visualmente.
      */}
      <p role="status" aria-live="polite" className="sr-only">
        {liveStatus}
      </p>

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-n-200">
        <div>
          <h2 className="text-sm font-bold text-n-900 flex items-center gap-2">
            <Loader2
              className={cn('w-4 h-4', state.mode !== 'complete' && 'animate-spin')}
              aria-hidden="true"
            />
            {state.mode === 'complete'
              ? language === 'es' ? 'REPORTE COMPLETO' : 'REPORT COMPLETE'
              : language === 'es' ? 'GENERANDO REPORTE NIIF ELITE' : 'GENERATING ELITE IFRS REPORT'}
          </h2>
          <p className="text-xs text-n-600 mt-0.5 font-mono">
            <Clock className="w-3 h-3 inline mr-1" aria-hidden="true" />
            {timeStr}
            {language === 'es' ? ' · Tiempo estimado: 3-5 min' : ' · Estimated time: 3-5 min'}
          </p>
        </div>
        <ProgressRing progress={overallProgress} size={48} strokeWidth={4} />
      </div>

      {/* Phase 1: Agents */}
      <div className="px-6 py-4">
        <h3 className="text-2xs font-bold text-n-700 uppercase tracking-wider mb-3 font-mono">
          {language === 'es' ? 'Fase 1 — Generacion de Reporte' : 'Phase 1 — Report Generation'}
        </h3>
        <div className="flex items-center gap-2 overflow-x-auto styled-scrollbar pb-2">
          {stages.map((s, i) => (
            <div key={i} className="flex items-center">
              <StageNode
                index={i}
                state={state}
                label={s.label}
                sublabel={s.sublabel}
                language={language}
              />
              {i < stages.length - 1 && (
                <ChevronRight className="w-5 h-5 text-n-500 mx-1 shrink-0" aria-hidden="true" />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Phase 2: Auditors */}
      <div className="px-6 py-4 border-t border-n-100">
        <h3 className="text-2xs font-bold text-n-700 uppercase tracking-wider mb-3 font-mono">
          {language === 'es'
            ? 'Fase 2 — Auditoria (4 en paralelo)'
            : 'Phase 2 — Audit (4 in parallel)'}
        </h3>
        <div className="flex items-center gap-3 flex-wrap">
          {Object.entries(auditorLabels).map(([key, label]) => {
            const started = state.auditorsStarted.includes(key);
            const complete = state.auditorsComplete.includes(key);
            const findingCount = state.auditFindings[key];
            return (
              <div
                key={key}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs font-medium transition-colors',
                  complete && 'bg-success/10 border-success/30 text-success',
                  started && !complete && 'bg-gold-300/10 border-warning/30 text-warning',
                  !started && 'bg-n-50 border-n-200 text-n-600',
                )}
              >
                {complete ? <CheckCircle className="w-3 h-3" /> : started ? <Loader2 className="w-3 h-3 animate-spin" /> : <div className="w-3 h-3 rounded-full border border-current" />}
                {label}
                {findingCount !== undefined && (
                  <span className="text-2xs font-mono">
                    ({findingCount})
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Phase 3: Quality */}
      <div className="px-6 py-4 border-t border-n-100">
        <h3 className="text-2xs font-bold text-n-700 uppercase tracking-wider mb-2 font-mono">
          {language === 'es'
            ? 'Fase 3 — Meta-Auditoria de Calidad'
            : 'Phase 3 — Quality Meta-Audit'}
        </h3>
        {state.qualityGrade ? (
          <div className="flex items-center gap-2">
            <DSBadge variant="grade" grade={state.qualityGrade} label={state.qualityGrade} size="md" />
            <span className="text-xs text-n-600 font-mono">
              {state.qualityScore}/100
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-xs text-n-600">
            <div className="w-3 h-3 rounded-full border border-n-400" aria-hidden="true" />
            {state.mode === 'quality'
              ? language === 'es' ? 'Evaluando calidad...' : 'Assessing quality...'
              : language === 'es' ? 'Esperando auditoria completa' : 'Waiting for audit to finish'}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ReportViewer ───────────────────────────────────────────────────────────
// Props:
// - content / sections: prosa renderizable (existente).
// - report / rawData / company: reporte backend + data cruda para Excel
//   export y chat de seguimiento.
// - conversationId: id estable del reporte (persistencia).
// - onReset: resetea el estado del pipeline al padre (Nuevo Reporte).
// - onPatchReport: mutador del markdown consolidado + sections viewer.
// - initialTurns / onTurnsChange: persistencia del chat de seguimiento.

interface ReportViewerProps {
  content: string;
  sections: ReportSection[];
  report?: BackendFinancialReport;
  rawData?: string;
  company?: CompanyInfo;
  language: 'es' | 'en';
  conversationId?: string;
  initialTurns?: ReportIterationTurn[];
  /**
   * Reporte completo de auditoría (4 auditores) si el usuario activó la
   * Fase 2. Lleva `auditVersionId` cuando el servidor lo guardó; sin esa
   * referencia se consulta en pantalla y no entra en la descarga.
   */
  auditReport?: BackendAuditReport | null;
  /**
   * Reporte completo de meta-auditoría de calidad si el usuario activó la
   * Fase 3. Lleva `qualityVersionId` cuando el servidor lo guardó.
   */
  qualityReport?: BackendQualityAssessment | null;
  /**
   * Toggle del intake. La versión servidor guarda las opciones de generación.
   */
  outputOptions?: NiifReportIntake['outputOptions'] | null;
  onReset?: () => void;
  onPatchReport?: (newConsolidatedMarkdown: string) => void;
  onTurnsChange?: (turns: ReportIterationTurn[]) => void;
  /**
   * Markdown del reporte ORIGINAL — capturado por el host antes de regenerar
   * con adjustments. Si esta presente, el viewer muestra un toggle "Ver
   * cambios" que abre `<ReportDiff>` comparando original vs `content`.
   */
  originalContent?: string | null;
  /**
   * Codigos PUC afectados por adjustments (vienen del adjustment ledger).
   * Se pasan al `<ReportDiff>` para subrayar las lineas que los mencionan.
   */
  affectedAccounts?: string[];
  // ─── Wave 4.F8 — Editor Jefe HTML (cap-stone visual) ────────────────────
  /** Disparador del agente HTML 1+1 v8.1. Undefined si el host no lo quiere ofrecer. */
  onGenerateHtml?: () => void;
  /** True mientras corre la generación — el botón se muestra disabled + spinner. */
  isGeneratingHtml?: boolean;
  /** True cuando ya existe un HTML generado — el botón cambia a "Ver HTML". */
  htmlReady?: boolean;
  /** Abre el viewer del HTML existente sin re-generar. */
  onShowHtml?: () => void;
  /** Error de la última corrida de HTML — se muestra como banner inline. */
  htmlError?: string | null;
}

function ReportViewer({
  content,
  sections,
  report,
  rawData,
  company,
  language,
  conversationId,
  initialTurns,
  auditReport,
  qualityReport,
  onReset,
  onPatchReport,
  onTurnsChange,
  originalContent,
  affectedAccounts,
  onGenerateHtml,
  isGeneratingHtml,
  htmlReady,
  onShowHtml,
  htmlError,
}: ReportViewerProps) {
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'done' | 'error'>('idle');
  const [showDiff, setShowDiff] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  // Solo se ofrece el diff si el host capturo un reporte original distinto
  // del actual. Trim guard cubre el caso de tabs en blanco / saltos triviales.
  const hasDiff =
    typeof originalContent === 'string' &&
    originalContent.trim().length > 0 &&
    originalContent !== content;

  const scrollToSection = useCallback((sectionId: string) => {
    setActiveSection(sectionId);
    const el = document.getElementById(`report-section-${sectionId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // ─── Descargar Excel ─────────────────────────────────────────────────────
  // POST /api/financial-report/export con { reportVersionId } — el endpoint
  // responde con un .xlsx binario (Content-Disposition: attachment).
  /**
   * Salvedades del reconciliador determinista de anclas (2026-08).
   *
   * Cuando la reconciliación no cierra, el informe lleva el sello "REPORTE CON
   * SALVEDADES" en el cuerpo y NO se ofrece como descargable. El motivo de que
   * el bloqueo viva aquí y no en un banner: la auditoría integral verificó que
   * los eventos SSE `warning` mueren en el navegador sin handler, así que la
   * única señal que el usuario no puede pasar por alto es que el botón no esté.
   */
  const reportQualifications = report?.niifAnalysis?.reconciliation;
  const reportHasQualifications =
    reportQualifications?.clean === false || report?.governance?.actaQualifications?.clean === false;

  // Sólo se envían referencias a resultados guardados y completos. Una auditoría
  // que vive únicamente en pantalla no tiene `auditVersionId`, y una parcial no
  // es exportable: en ambos casos queda fuera del archivo en vez de hacer
  // fracasar la descarga. El servidor vuelve a comprobar cada referencia contra
  // la versión exportada.
  const auditVersionId = auditReport?.auditComplete ? auditReport.auditVersionId ?? null : null;
  const qualityVersionId = qualityReport?.qualityComplete ? qualityReport.qualityVersionId ?? null : null;
  const exportRefs = useMemo(
    () => ({ auditVersionId, qualityVersionId }),
    [auditVersionId, qualityVersionId],
  );

  const handleDownloadExcel = useCallback(async () => {
    if (!report?.reportVersionId || isExportingExcel || reportHasQualifications) return;
    setIsExportingExcel(true);
    setExportError(null);
    try {
      const res = await fetch('/api/financial-report/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportVersionId: report.reportVersionId, format: 'excel', ...exportRefs }),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}${errBody ? ' — ' + errBody.slice(0, 200) : ''}`);
      }

      // Extraer nombre sugerido del header (si existe).
      const disposition = res.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="?([^"]+)"?/);
      const filename = match?.[1] || `Reporte_Financiero_1mas1_${Date.now()}.xlsx`;

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      setExportError(
        language === 'es'
          ? `No se pudo generar el Excel: ${msg}`
          : `Could not generate Excel: ${msg}`,
      );
    } finally {
      setIsExportingExcel(false);
    }
  }, [report, isExportingExcel, language, reportHasQualifications, exportRefs]);

  // Download the selected immutable server version as an editorial PDF.
  const handleExportPdf = useCallback(async () => {
    // Mismo gate que el Excel. El sello "REPORTE CON SALVEDADES" declara que la
    // reconciliación contra el balance preprocesado NO cerró: el informe no es
    // firmable tal como está, y el formato de salida no cambia ese hecho.
    // Auditoría 2026-08 (item 9): el PDF editorial se descargaba igual, de modo
    // que el mismo entregable quedaba bloqueado en .xlsx y disponible en .pdf.
    if (!report?.reportVersionId || isExportingPdf || reportHasQualifications) return;
    setIsExportingPdf(true);
    setExportError(null);
    try {
      const res = await fetch('/api/financial-report/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportVersionId: report.reportVersionId, format: 'pdf-elite', ...exportRefs }),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}${errBody ? ' — ' + errBody.slice(0, 200) : ''}`);
      }

      const disposition = res.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="?([^"]+)"?/);
      const filename = match?.[1] || `Reporte_Editorial_${Date.now()}.pdf`;

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      setExportError(
        language === 'es'
          ? `No se pudo generar el PDF: ${msg}`
          : `Could not generate PDF: ${msg}`,
      );
    } finally {
      setIsExportingPdf(false);
    }
  }, [report, language, isExportingPdf, reportHasQualifications, exportRefs]);

  // ─── Copiar Markdown ─────────────────────────────────────────────────────
  // Preferimos navigator.clipboard; fallback a textarea + execCommand.
  const handleCopy = useCallback(async () => {
    const markdown =
      report?.consolidatedReport ||
      (sections.length > 0 ? sections.map((s) => s.content).join('\n\n') : content);
    if (!markdown) return;

    const showDone = () => {
      setCopyState('done');
      window.setTimeout(() => setCopyState('idle'), 1500);
    };

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(markdown);
        showDone();
        return;
      }
    } catch {
      // fallback abajo
    }

    try {
      const ta = document.createElement('textarea');
      ta.value = markdown;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      ta.remove();
      showDone();
    } catch {
      setCopyState('error');
      window.setTimeout(() => setCopyState('idle'), 1500);
    }
  }, [report, sections, content]);

  // ─── Nuevo reporte ────────────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    onReset?.();
  }, [onReset]);

  const copyLabel =
    copyState === 'done'
      ? language === 'es' ? 'Copiado' : 'Copied'
      : copyState === 'error'
        ? language === 'es' ? 'No se pudo copiar' : 'Copy failed'
        : language === 'es' ? 'Copiar' : 'Copy';

  return (
    <div className="flex h-full report-viewer-root">
      {/* Print stylesheet — oculta cromos (sidebar, statusbar, nav, action bar,
          follow-up panel) y deja solo la prosa del reporte al imprimir/PDF. */}
      <style jsx global>{`
        @media print {
          @page {
            size: A4;
            margin: 1.5cm;
          }
          html,
          body {
            background: #ffffff !important;
          }
          #chat-sidebar,
          header[role='banner'],
          .report-action-bar,
          .report-toc,
          .report-followup,
          .no-print {
            display: none !important;
          }
          .report-viewer-root {
            height: auto !important;
            display: block !important;
          }
          .report-prose-root {
            max-width: 100% !important;
            padding: 0 !important;
            margin: 0 !important;
            overflow: visible !important;
          }
          .report-prose-root .prose {
            color: #000 !important;
            font-size: 11pt !important;
          }
        }
      `}</style>

      {/* Document navigation */}
      {sections.length > 0 && (
        <nav className="report-toc w-[200px] shrink-0 border-r border-n-200 overflow-y-auto styled-scrollbar py-4 hidden lg:block">
          <h3 className="px-4 text-2xs font-bold text-n-700 uppercase tracking-wider mb-2 font-mono">
            {language === 'es' ? 'Contenido' : 'Contents'}
          </h3>
          <ul className="space-y-0.5">
            {sections.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => scrollToSection(s.id)}
                  className={cn(
                    'w-full text-left px-4 py-1.5 text-xs transition-colors',
                    activeSection === s.id
                      ? 'text-gold-500 bg-gold-300/10 font-medium border-l-2 border-gold-500'
                      : 'text-n-600 hover:bg-n-50',
                  )}
                >
                  {s.title}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {/* Document content */}
      <div ref={contentRef} className="flex-1 overflow-y-auto styled-scrollbar">
        {/* Action bar */}
        <div className="report-action-bar sticky top-0 z-10 bg-n-0 border-b border-n-200 px-6 py-3 flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleDownloadExcel}
            disabled={isExportingExcel || !report?.reportVersionId || reportHasQualifications}
            aria-label={
              reportHasQualifications
                ? language === 'es'
                  ? 'Descarga bloqueada: el informe tiene salvedades de reconciliación'
                  : 'Download blocked: the report has reconciliation qualifications'
                : language === 'es'
                  ? 'Descargar Excel'
                  : 'Download Excel'
            }
            title={
              reportHasQualifications
                ? language === 'es'
                  ? 'La reconciliación contra el balance preprocesado no cerró. El informe no es firmable tal como está; revise las salvedades de la portada.'
                  : 'Reconciliation against the preprocessed trial balance did not close. This report is not signable as issued; see the qualifications on the cover.'
                : undefined
            }
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors',
              // `text-n-600` es el mínimo WCAG AA para estado deshabilitado
              // (3:1). `text-n-400` colapsa por debajo de 2:1 en modo claro.
              isExportingExcel || !report?.reportVersionId || reportHasQualifications
                ? 'bg-n-100 text-n-600 cursor-not-allowed'
                : 'bg-gold-500 text-n-0 hover:bg-gold-700',
            )}
          >
            {isExportingExcel ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            {isExportingExcel
              ? language === 'es' ? 'Generando...' : 'Generating...'
              : language === 'es' ? 'Descargar Excel .xlsx' : 'Download Excel .xlsx'}
          </button>
          <button
            type="button"
            onClick={handleExportPdf}
            disabled={isExportingPdf || !report?.reportVersionId || reportHasQualifications}
            aria-label={
              reportHasQualifications
                ? language === 'es'
                  ? 'Descarga bloqueada: el informe tiene salvedades de reconciliación'
                  : 'Download blocked: the report has reconciliation qualifications'
                : language === 'es'
                  ? 'Exportar a PDF editorial'
                  : 'Export to editorial PDF'
            }
            title={
              reportHasQualifications
                ? language === 'es'
                  ? 'La reconciliación contra el balance preprocesado no cerró. El informe no es firmable tal como está; revise las salvedades de la portada.'
                  : 'Reconciliation against the preprocessed trial balance did not close. This report is not signable as issued; see the qualifications on the cover.'
                : undefined
            }
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs font-medium transition-colors',
              // `text-n-600` es el mínimo WCAG AA para estado deshabilitado
              // (3:1); `text-n-400` es nivel superficie y colapsa bajo 2:1.
              isExportingPdf || !report?.reportVersionId || reportHasQualifications
                ? 'border-n-200 text-n-600 cursor-not-allowed'
                : 'border-n-200 text-n-700 hover:bg-n-50 hover:text-n-1000',
            )}
          >
            {isExportingPdf ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FileText className="w-3.5 h-3.5" />
            )}
            {isExportingPdf
              ? language === 'es' ? 'Generando PDF...' : 'Generating PDF...'
              : language === 'es' ? 'Exportar PDF' : 'Export PDF'}
          </button>
          <button
            type="button"
            onClick={handleCopy}
            aria-label={language === 'es' ? 'Copiar reporte como Markdown' : 'Copy report as Markdown'}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs font-medium transition-colors',
              copyState === 'done'
                ? 'border-success/30 bg-success/10 text-success'
                : copyState === 'error'
                  ? 'border-danger/30 bg-danger/10 text-danger'
                  : 'border-n-200 text-n-600 hover:bg-n-50',
            )}
          >
            {copyState === 'done' ? (
              <Check className="w-3.5 h-3.5" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            {copyLabel}
          </button>
          {/* Wave 4.F8 — Editor Jefe HTML (cap-stone visual). El botón aparece
              sólo si el host expone el handler `onGenerateHtml` (= reporte
              completado). Cambia su label cuando el HTML ya existe — el
              usuario puede ver el HTML pre-generado sin re-disparar el agente. */}
          {onGenerateHtml && (
            <button
              type="button"
              onClick={htmlReady && onShowHtml ? onShowHtml : onGenerateHtml}
              // El HTML editorial es un entregable como el .xlsx y el .pdf:
              // reproduce las mismas cifras que la reconciliación no cuadró.
              // Un informe CON SALVEDADES no se emite en ningún formato.
              disabled={isGeneratingHtml || !report || reportHasQualifications}
              aria-label={
                reportHasQualifications
                  ? language === 'es'
                    ? 'Generación bloqueada: el informe tiene salvedades de reconciliación'
                    : 'Generation blocked: the report has reconciliation qualifications'
                  : htmlReady
                    ? language === 'es' ? 'Ver reporte HTML' : 'View HTML report'
                    : language === 'es' ? 'Generar reporte HTML' : 'Generate HTML report'
              }
              title={
                reportHasQualifications
                  ? language === 'es'
                    ? 'La reconciliación contra el balance preprocesado no cerró. El informe no es firmable tal como está; revise las salvedades de la portada.'
                    : 'Reconciliation against the preprocessed trial balance did not close. This report is not signable as issued; see the qualifications on the cover.'
                  : undefined
              }
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs font-medium transition-colors',
                isGeneratingHtml || !report || reportHasQualifications
                  ? 'border-n-200 text-n-600 cursor-not-allowed'
                  : htmlReady
                    ? 'border-success/30 bg-success/10 text-success hover:bg-success/20'
                    : 'border-n-200 text-n-700 hover:bg-n-50 hover:text-n-1000',
              )}
            >
              {isGeneratingHtml ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Globe className="w-3.5 h-3.5" />
              )}
              {isGeneratingHtml
                ? language === 'es' ? 'Generando HTML...' : 'Generating HTML...'
                : htmlReady
                  ? language === 'es' ? 'Ver HTML' : 'View HTML'
                  : language === 'es' ? 'Generar HTML' : 'Generate HTML'}
            </button>
          )}
          {hasDiff && (
            <button
              type="button"
              onClick={() => setShowDiff((s) => !s)}
              aria-expanded={showDiff}
              aria-controls="report-diff-panel"
              aria-label={
                language === 'es'
                  ? 'Ver cambios respecto al reporte original'
                  : 'View changes from original report'
              }
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs font-medium transition-colors',
                showDiff
                  ? 'border-gold-500 bg-gold-300/10 text-gold-700'
                  : 'border-n-200 text-n-600 hover:bg-n-50',
              )}
            >
              <GitCompare className="w-3.5 h-3.5" />
              {showDiff
                ? language === 'es' ? 'Ocultar cambios' : 'Hide changes'
                : language === 'es' ? 'Ver cambios' : 'View changes'}
            </button>
          )}
          <button
            type="button"
            onClick={handleReset}
            disabled={!onReset}
            aria-label={language === 'es' ? 'Crear un nuevo reporte' : 'Create a new report'}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-n-200 text-n-600 text-xs font-medium hover:bg-n-50 transition-colors ml-auto disabled:text-n-400 disabled:cursor-not-allowed"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {language === 'es' ? 'Nuevo Reporte' : 'New Report'}
          </button>
        </div>

        {/* Diff panel — visible solo cuando el host capturo un reporte
            original (regen post-adjustments) y el usuario abre el toggle.
            Va inmediatamente debajo del action bar para que el contraste
            antes/cambios/despues sea inmediato visualmente. */}
        {hasDiff && showDiff && (
          <div id="report-diff-panel" className="mx-6 mt-3 mb-2 no-print">
            <ReportDiff
              before={originalContent ?? ''}
              after={content}
              affectedAccounts={affectedAccounts}
              language={language}
            />
          </div>
        )}

        {report && !report.reportVersionId && (
          <p className="px-6 py-3 text-sm text-n-800" role="status">
            {language === 'es'
              ? 'Regenera el informe para descargar una versión guardada y autorizada. Los cambios locales y los informes históricos no tienen una versión exportable.'
              : 'Regenerate the report to download a saved, authorized version. Local edits and historical reports do not have an exportable version.'}
          </p>
        )}
        {report?.reportVersionId && (
          <p className="px-6 py-3 text-sm text-n-800">
            {language === 'es' ? 'La descarga incluye el informe financiero guardado' : 'The download includes the saved financial report'}
            {auditVersionId ? (language === 'es' ? ', la auditoría especializada' : ', the specialised audit') : ''}
            {qualityVersionId ? (language === 'es' ? ' y la meta-auditoría de calidad' : ' and the quality meta-audit') : ''}
            {'. '}
            {(auditReport && !auditVersionId) || (qualityReport && !qualityVersionId)
              ? (language === 'es'
                ? 'Los resultados que no quedaron guardados como versión completa se consultan en pantalla y no forman parte del archivo; vuelve a ejecutarlos para incluirlos.'
                : 'Results that were not saved as a complete version stay on screen and are not part of the file; run them again to include them.')
              : (language === 'es'
                ? 'Cada resultado incluido examinó esta misma versión del informe.'
                : 'Every included result examined this same report version.')}
          </p>
        )}
        {exportError && (
          <div className="mx-6 my-3 rounded border border-danger bg-danger/10 px-3 py-2 flex items-start gap-2 text-xs text-danger">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="whitespace-pre-wrap break-words">{exportError}</span>
          </div>
        )}

        {/* Wave 4.F8 — error de generación HTML. Banner inline (no destruye el
            reporte Markdown) para que el usuario reintente con un click. */}
        {htmlError && (
          <div className="mx-6 my-3 rounded border border-danger bg-danger/10 px-3 py-2 flex items-start gap-2 text-xs text-danger">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="whitespace-pre-wrap break-words">{htmlError}</span>
          </div>
        )}

        {/* Report content */}
        <div className="report-prose-root px-8 py-6 max-w-4xl mx-auto">
          <div className="prose prose-sm max-w-none text-n-900 prose-headings:text-n-900 prose-headings:font-semibold prose-p:leading-relaxed prose-a:text-gold-500 prose-strong:text-n-900 prose-table:border prose-table:border-n-200 prose-th:bg-n-50 prose-th:px-3 prose-th:py-2 prose-th:text-xs prose-th:font-medium prose-td:px-3 prose-td:py-2 prose-td:text-sm prose-td:border-t prose-td:border-n-100">
            {sections.length > 0 ? (
              sections.map((s) => (
                <div key={s.id} id={`report-section-${s.id}`} className="mb-8">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeSanitize, MARKDOWN_SANITIZE_SCHEMA]]}>
                    {s.content}
                  </ReactMarkdown>
                </div>
              ))
            ) : (
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeSanitize, MARKDOWN_SANITIZE_SCHEMA]]}>
                {content}
              </ReactMarkdown>
            )}
          </div>
        </div>

        {/* Chat de seguimiento — solo si tenemos el reporte backend + data cruda + empresa. */}
        {report && rawData !== undefined && company && (
          <div className="report-followup">
            <ReportFollowUpChat
              report={report}
              rawData={rawData}
              company={company}
              language={language}
              conversationId={conversationId}
              initialTurns={initialTurns}
              onTurnsChange={onTurnsChange}
              onPatchReport={onPatchReport}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export function PipelineWorkspace() {
  const {
    pipelineState,
    setPipelineState,
    pipelineInput,
    setPipelineInput,
    pendingRun,
    resumePendingRun,
    clearPendingRun,
    lastCompletedReport,
    setLastCompletedReport,
    updateReportTurns,
    setPendingChatContext,
  } = useWorkspace();
  const [streamedContent, setStreamedContent] = useState('');
  const [report, setReport] = useState<FinancialReport | null>(null);
  // Backend report + data cruda + info empresa: necesario para Excel export
  // y para el chat de seguimiento. Se hidrata desde `lastCompletedReport`
  // al montar para preservar el viewer tras refresh.
  const [backendReport, setBackendReport] = useState<BackendFinancialReport | null>(
    lastCompletedReport?.report ?? null,
  );
  const [rawData, setRawData] = useState<string>(lastCompletedReport?.rawData ?? '');
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo | null>(
    lastCompletedReport?.company ?? null,
  );
  const [conversationId, setConversationId] = useState<string>(
    lastCompletedReport?.conversationId ?? '',
  );
  const [initialTurns, setInitialTurns] = useState<ReportIterationTurn[]>(
    lastCompletedReport?.turns ?? [],
  );
  // Fase 2/3 — reportes completos del audit y meta-auditor. Se llenan tras
  // las fases 2 y 3 si el usuario los activó. Antes solo guardábamos resumen
  // (findingCounts, grade, score), perdiendo el detalle que el PDF editorial
  // necesita para AuditFindingsPage + QualityMetaAuditPage.
  // Se hidratan del reporte persistido: antes vivían solo en memoria y tras un
  // refresh el PDF exportado omitía sus páginas sin avisar.
  const [auditReport, setAuditReport] = useState<BackendAuditReport | null>(
    lastCompletedReport?.auditReport ?? null,
  );
  const [qualityReport, setQualityReport] = useState<BackendQualityAssessment | null>(
    lastCompletedReport?.qualityReport ?? null,
  );
  // Espejo en ref para leer el valor vigente desde la corrida asíncrona sin
  // recrear el closure (evita re-disparar el efecto de arranque).
  const auditReportRef = useRef<BackendAuditReport | null>(auditReport);
  // ─── Wave 4.F8 — HTML Editor Jefe (cap-stone visual) ─────────────────────
  // Estado del 4° entregable opcional. Se llena cuando el usuario clic
  // "Generar HTML" post-Phase 3. NO se persiste en localStorage para mantener
  // el blast radius pequeño — el HTML es regenerable desde el reporte vivo.
  // `htmlChecklistFailures` se popula con el linter §11 del agente y se muestra
  // como banner dentro de `<HtmlReportViewer>` si el agente detectó issues.
  const [htmlReport, setHtmlReport] = useState<string | null>(null);
  // `false` cuando el gate del Editor Jefe encontró un fallo bloqueante: el
  // HTML se entrega estampado como BORRADOR y el visor no debe ofrecerlo como
  // informe firmable. Auditoría 2026-08.
  const [htmlEmittable, setHtmlEmittable] = useState(true);
  const [htmlChecklistFailures, setHtmlChecklistFailures] = useState<
    Array<{ rule: string; detail: string; severity: 'block' | 'warn' }>
  >([]);
  const [isGeneratingHtml, setIsGeneratingHtml] = useState(false);
  const [htmlError, setHtmlError] = useState<string | null>(null);
  const [showHtmlViewer, setShowHtmlViewer] = useState(false);
  // Cache local de `niifContext.preprocessed` capturado durante Phase 1 — necesario
  // para que `clientSummarizeCoverage` corra al solicitar el HTML. Se llena en el
  // checkpoint NIIF.
  const [cachedPreprocessed, setCachedPreprocessed] = useState<unknown>(null);
  // Capa 5 — FiscalSnapshot capturado durante Phase 1 SSE (evento fiscal_snapshot
  // o campo fiscalSnapshot en niif_phase). Se asigna a report.fiscalSnapshot en
  // los 3 checkpoints setLastCompletedReport y se envía a El Escudo vía POST.
  const fiscalSnapshotRef = useRef<FiscalSnapshot | null>(null);
  // Bloque Âncora NIIF (A01..A19/X01..X04/F01..F10) capturado durante Phase 1 SSE
  // (evento `niif_ancora` o campo `ancora` en niif_phase). Se asigna a
  // report.ancora en los checkpoints setLastCompletedReport y se envía a El
  // Escudo vía POST. Consumido por las 4 áreas vía `useAncoraView`.
  const ancoraRef = useRef<NiifAncora | null>(null);
  const [error, setError] = useState<string | null>(null);
  // ─── Advertencias de validación contable ──────────────────────────────────
  // Auditoría 2026-08: el backend emitía por `event: warning` los errores del
  // validador de identidades (ecuación patrimonial, EFE contra PUC 11, ECP
  // contra patrimonio, totales contra el preprocesador) y aquí no había ni
  // handler ni estado, así que se descartaban en silencio. El reporte salía
  // con apariencia impecable y el descuadre no se le comunicaba a nadie.
  const [validationWarnings, setValidationWarnings] = useState<string[]>([]);
  const collectWarnings = useCallback((incoming: string[]) => {
    // `mergeWarnings` vive en `pipeline-resilience.ts` para poder testear la
    // deduplicación sin montar el componente.
    setValidationWarnings((prev) => mergeWarnings(prev, incoming));
  }, []);
  const [showRepair, setShowRepair] = useState(false);
  const [repairSeed, setRepairSeed] = useState<string | null>(null);
  // ─── Phase 3 (hook 3): diff visual antes/despues ──────────────────────────
  // Cuando el usuario regenera con adjustments via el Doctor, capturamos el
  // markdown del reporte ANTES del regen aqui. El ReportViewer expone un
  // toggle "Ver cambios" si este state esta poblado y difiere del actual.
  // Reseteado en handleReset.
  const [originalReport, setOriginalReport] = useState<string | null>(null);
  // Cuentas afectadas por los adjustments aplicados — pasadas al diff para
  // resaltar las lineas del reporte que las mencionan.
  const [diffAffectedAccounts, setDiffAffectedAccounts] = useState<string[]>([]);
  // Stable id for the repair chat session — regenerated each time a new error
  // surfaces so server-side telemetry can group attempts by error occurrence.
  const [repairConvId, setRepairConvId] = useState<string>('');
  const { language } = useLanguage();
  /**
   * Idioma vigente leído por la corrida asíncrona.
   *
   * POR QUÉ un ref y no la variable del render: `language` estaba en las
   * dependencias del efecto que orquestaba el pipeline. Cambiar el idioma a
   * mitad de una corrida disparaba el cleanup (`controller.abort()`), el
   * re-run del efecto se cortaba por el guard de "mismo input" y el AbortError
   * se tragaba sin `setError` — el usuario se quedaba mirando el spinner para
   * siempre. Cada corrida fija el idioma con el que arrancó.
   */
  const languageRef = useRef(language);
  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  /**
   * Partes del reporte vigente que son stubs vacíos. Se calcula al rehidratar
   * desde localStorage y tras cada corrida; alimenta el banner de "reporte
   * incompleto" y el CTA de reanudación por sub-fase.
   */
  const [missingPhases, setMissingPhases] = useState<PipelinePhaseId[]>([]);

  /**
   * Checkpoint de la sub-fase NIIF (la cara). Permite reintentar SOLO
   * Estrategia/Gobierno sin volver a pagar el Analista NIIF y sin arriesgar
   * que el LLM devuelva cifras distintas a las que el usuario ya vio.
   */
  interface NiifRunCheckpoint {
    reportVersionId?: string;
    niifResult: NiifAnalysisResult;
    bindingTotals: string;
    preprocessed: unknown;
    company: CompanyInfo;
    rawData: string;
    conversationId: string;
    strategyResult: StrategicAnalysisResult | null;
  }
  const checkpointRef = useRef<NiifRunCheckpoint | null>(null);
  // Espejo en estado del ref anterior: la UI necesita saber si hay checkpoint
  // reanudable, y leer un ref durante el render no dispara re-render.
  const [hasCheckpoint, setHasCheckpoint] = useState(false);

  // Repair chat lifecycle: tied to the presence of an error in the UI.
  // - new error  -> mint conv id, ensure chat starts collapsed
  // - error gone -> clear conv id and collapse chat
  useEffect(() => {
    if (error) {
      setRepairConvId((prev) =>
        prev || `repair-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      );
    } else {
      setRepairConvId('');
      setShowRepair(false);
    }
  }, [error]);

  // Al montar rehidratamos el reporte persistido.
  //
  // Auditoría 2026-08 (`checkpoint-parcial-se-muestra-completo`): antes esto
  // hacía `mode: 'complete'` incondicional. Un checkpoint escrito tras el NIIF
  // (con Estrategia y Gobierno como stubs vacíos) se rehidrataba como reporte
  // TERMINADO: el cliente veía "PARTE II: ANALISIS ESTRATEGICO" seguida de
  // nada, con el botón de exportar a PDF habilitado y sin una sola advertencia.
  // Es el peor de los casos posibles — creer que se tiene un informe.
  const hydratedPipelineRef = useRef(false);
  useEffect(() => {
    if (hydratedPipelineRef.current) return;
    hydratedPipelineRef.current = true;
    // Si la corrida sigue viva (el componente se desmontó al navegar y volvió),
    // no la pisamos: `pipelineState` vive en el contexto y sigue avanzando.
    if (runtimeRun.inFlight) return;
    if (lastCompletedReport && !report) {
      const consolidated = lastCompletedReport.report.consolidatedReport;
      const missing = detectMissingPhases(lastCompletedReport.report);
      setReport({
        content: consolidated,
        sections: splitReportIntoSections(consolidated),
      });
      setMissingPhases(missing);
      setPipelineState((prev) => ({
        ...prev,
        mode: 'complete',
        completedStages: missing.length === 0 ? [1, 2, 3] : [1],
      }));
      // Reconstruimos el checkpoint NIIF para poder reanudar la sub-fase
      // faltante. `bindingTotals` es obligatorio en /strategy y /governance y
      // es lo único que persistimos aparte del reporte (`preprocessed` es
      // opcional en ambos schemas y pesa demasiado para localStorage).
      const stored = loadNiifCheckpoint(lastCompletedReport.conversationId);
      if (missing.length > 0 && stored) {
        checkpointRef.current = {
          reportVersionId: stored.reportVersionId,
          niifResult: lastCompletedReport.report.niifAnalysis,
          bindingTotals: stored.bindingTotals,
          preprocessed: null,
          company: lastCompletedReport.company,
          rawData: lastCompletedReport.rawData,
          conversationId: lastCompletedReport.conversationId,
          strategyResult: missing.includes('strategy')
            ? null
            : lastCompletedReport.report.strategicAnalysis,
        };
        setHasCheckpoint(true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Orquesta la corrida. `start` indica desde qué sub-fase arranca:
   *
   *  - `'niif'`: corrida completa (requiere intake).
   *  - `'strategy'` / `'governance'`: reanudación con el checkpoint NIIF ya
   *    pagado. Auditoría 2026-08 (`sin-reanudacion-por-fase`): un transient en
   *    la fase 2 o 3 obligaba a re-ejecutar TODO desde el Analista NIIF, lo que
   *    además puede devolver cifras distintas a las que el usuario ya vio.
   *
   * Vive fuera del `useEffect` para que el mismo camino de código sirva al
   * arranque y al reintento — dos rutas separadas divergirían.
   */
  const runPipeline = useCallback(
    async (start: 'niif' | 'strategy' | 'governance' = 'niif') => {
    const intake = pipelineInput ?? pendingRun?.input ?? null;
    const resumeCheckpoint = checkpointRef.current;
    if (start === 'niif' && !intake) return;
    if (start !== 'niif' && !resumeCheckpoint) return;
    // Idioma congelado al arrancar: cambiarlo a mitad de corrida ya no la mata,
    // y tampoco produce un reporte mitad español mitad inglés.
    const runLanguage = languageRef.current;

    // Una corrida nueva cancela la anterior (reintento manual, regeneración con
    // ajustes). El DESMONTAJE del componente ya no aborta nada.
    runtimeRun.controller?.abort();
    const controller = new AbortController();
    runtimeRun.controller = controller;
    runtimeRun.inFlight = true;

    const isRerun = start === 'niif' && runtimeRun.startedInput !== null;
    if (start === 'niif') runtimeRun.startedInput = pipelineInput;
    setError(null);
    setMissingPhases([]);
    if (start === 'niif') {
      setReport(null);
      setStreamedContent('');
    }
    // ITEM 4 ORDEN DE CIERRE — Reparación Fase 3 reconnection.
    // En re-runs (regenerateWithAdjustments / markProvisional / reintento), las
    // Fases 2 y 3 vuelven a correr — pero las fases anteriores dejaban estado
    // residual: `auditFindings`, `qualityGrade`, `qualityScore`, `auditReport`,
    // `qualityReport` seguían apuntando a la corrida ANTERIOR. El usuario veía
    // el "Score 95/100" estancado hasta que la nueva corrida terminaba 3 min
    // después. Aquí limpiamos TODO el estado audit + quality al inicio del
    // re-run para que la UI refleje el progreso correctamente.
    // Un informe nuevo nunca hereda la auditoría de otro. Antes esto sólo
    // ocurría en un re-run, así que tras recargar la página el primer informe
    // de la sesión conservaba la auditoría del informe anterior restaurada de
    // `lastCompletedReport`: si la nueva corrida no pedía auditoría, el
    // resultado viejo quedaba emparejado con el informe nuevo y la descarga
    // enviaba una referencia que el servidor rechaza. En una reanudación
    // (`start !== 'niif'`) el resultado sí pertenece a esta corrida y se conserva.
    if (start === 'niif') {
      setAuditReport(null);
      auditReportRef.current = null;
      setQualityReport(null);
    }
    if (isRerun) {
      setPipelineState((prev) => ({
        ...prev,
        mode: 'running',
        currentStage: 1,
        completedStages: [],
        auditorsStarted: [],
        auditorsComplete: [],
        auditFindings: {},
        qualityGrade: undefined,
        qualityScore: undefined,
        phase2Error: undefined,
        phase3Error: undefined,
      }));
    } else {
      // Arranque normal o reanudación: dejamos el monitor en marcha desde ya.
      // En la reanudación el NIIF ya está pagado, así que la fase 1 se muestra
      // completa y el indicador salta directo a la sub-fase que falta.
      setPipelineState((prev) => ({
        ...prev,
        mode: 'running',
        currentStage: start === 'governance' ? 3 : start === 'strategy' ? 2 : 1,
        completedStages:
          start === 'governance' ? [1, 2] : start === 'strategy' ? [1] : prev.completedStages,
        startedAt: prev.startedAt ?? new Date(),
        phase2Error: undefined,
        phase3Error: undefined,
      }));
    }

    try {
      // ─── Phase 1: Financial Report (CRÍTICA, ahora 3 sub-fases) ───────
      // Wave 3.F2: en lugar de UNA llamada monolítica a /api/financial-report
      // (que acumulaba 5-15 min y disparaba "network error" mid-stream en
      // producción), orquestamos 3 sub-fases secuenciales contra los endpoints
      // split por F1. Cada endpoint tiene su propio maxDuration=800s — los
      // timeouts ya no se suman.
      //
      // Checkpoint progresivo: tras NIIF persistimos un reporte parcial en
      // localStorage. Si /strategy o /governance fallan, el NIIF NO se pierde
      // y el usuario puede ver/exportar lo que tiene + reintentar la sub-fase
      // fallida. Diagnóstico por sub-fase: el mensaje de error indica
      // exactamente qué agente reventó (no genérico "Phase 1 falló").
      let phase1Report: BackendFinancialReport | null = null;
      let serverReport: BackendFinancialReport | undefined;
      let reportVersionId = resumeCheckpoint?.reportVersionId;
      let niifResult: NiifAnalysisResult | null = null;
      let strategyResult: StrategicAnalysisResult | null = null;
      let niifContext: {
        bindingTotals: string;
        preprocessed: unknown;
        company: CompanyInfo;
      } | null = null;
      // Conv id estable para todo el ciclo: minted antes de la primera sub-fase
      // para que el checkpoint progresivo no rote ids entre updates. En una
      // reanudación se conserva el id del checkpoint para no duplicar el
      // registro persistido ni huerfanar el chat de seguimiento.
      const nextConvId =
        start === 'niif'
          ? `report-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
          : (resumeCheckpoint as NiifRunCheckpoint).conversationId;

      // The provisional flag may have been attached locally by the repair chat
      // (handleMarkProvisional) — it is not on the NiifReportIntake type yet
      // so we read it via a narrow lookup. The Backend agent extends the
      // /api/financial-report/niif request schema to accept it.
      // Phase 2: same pattern for `adjustmentLedger`, attached locally by
      // handleRegenerateWithAdjustments. Backend route accepts it as
      // optional and applies adjustments post-preprocessing.
      const intakeWithExtras = (intake ?? null) as
        | (NiifReportIntake & {
            provisional?: ProvisionalFlag;
            adjustmentLedger?: AdjustmentLedger;
          })
        | null;
      const provisional = intakeWithExtras?.provisional;
      const adjustmentLedger = intakeWithExtras?.adjustmentLedger;
      // Ola 2 — hechos del negocio excluidos en la confirmación del intake
      // (Task 8). Se propaga a las 4 rutas del pipeline SOLO cuando hay
      // exclusiones, para que cada ruta netee la misma lista que confirmó el
      // usuario. Las rutas (Tasks 3–6) side-parsean `excludedFactIds` del body.
      const excludedFactIds = intake?.excludedFactIds ?? [];
      const instructions = intake?.specialInstructions;

      // ITEM 5 ORDEN DE CIERRE — propagar T.P. + C.C. al backend si están
      // presentes en el intake. `companyExt` lookup defensivo: el shape del
      // intake del workspace todavía puede no declararlos (campos nuevos).
      const companyExt = intake?.company as
        | (NiifReportIntake['company'] & {
            legalRepresentativeId?: string;
            fiscalAuditorTp?: string;
            accountantTp?: string;
          })
        | undefined;
      const companyBody = intake
        ? {
            name: intake.company.name,
            nit: intake.company.nit,
            entityType: intake.company.entityType,
            sector: intake.company.sector,
            city: intake.company.city,
            legalRepresentative: intake.company.legalRepresentative,
            legalRepresentativeId: companyExt?.legalRepresentativeId,
            fiscalAuditor: intake.company.fiscalAuditor,
            fiscalAuditorTp: companyExt?.fiscalAuditorTp,
            accountant: intake.company.accountant,
            accountantTp: companyExt?.accountantTp,
            niifGroup: intake.niifGroup,
            fiscalPeriod: intake.fiscalPeriod,
            comparativePeriod: intake.comparativePeriod,
          }
        : null;

      // Handler común de progress events para las 3 sub-fases — mantiene la
      // misma semántica que el legacy: stage_start/complete actualizan el
      // indicador del PipelineMonitor (1=NIIF, 2=Strategy, 3=Governance),
      // stage_progress alimenta la vista en vivo de streamedContent.
      const onSubPhaseProgress = (evt: FinancialProgressEvent) => {
        if (evt.type === 'stage_start' && evt.stage <= 3) {
          setPipelineState((prev) => ({
            ...prev,
            mode: 'running',
            currentStage: evt.stage as 1 | 2 | 3,
          }));
        } else if (evt.type === 'stage_complete' && evt.stage <= 3) {
          const stageNum = evt.stage;
          setPipelineState((prev) => ({
            ...prev,
            completedStages: prev.completedStages.includes(stageNum)
              ? prev.completedStages
              : [...prev.completedStages, stageNum],
          }));
        } else if (evt.type === 'stage_progress') {
          setStreamedContent((prev) => prev + (prev ? '\n\n' : '') + `**${evt.detail}**`);
        }
      };

      // ─── Sub-fase 1.1: Analista NIIF ───────────────────────────────────
      // Si esta falla, no hay reporte que mostrar — abortamos y mostramos
      // error fatal. Las sub-fases 1.2/1.3 son recuperables vía checkpoint;
      // 1.1 no.
      //
      // En una reanudación NO se re-ejecuta: es la fase más cara y volver a
      // correrla podría devolver cifras distintas a las que el usuario ya vio.
      if (start !== 'niif') {
        const cp = resumeCheckpoint as NiifRunCheckpoint;
        niifResult = cp.niifResult;
        niifContext = {
          bindingTotals: cp.bindingTotals,
          preprocessed: cp.preprocessed,
          company: cp.company,
        };
        strategyResult = cp.strategyResult;
      } else
      // Corrida completa: aquí sí se ejecuta el Analista NIIF. El `else` cuelga
      // de este `try/catch` — no hay más ramas.
      try {
        const niifBody: Record<string, unknown> = {
          persist: true,
          outputOptions: intake?.outputOptions,
          rawData: intake!.rawData,
          company: companyBody,
          language: runLanguage,
          instructions,
          ...(provisional ? { provisional } : {}),
        };
        if (adjustmentLedger?.adjustments?.length) {
          niifBody.adjustmentLedger = adjustmentLedger;
        }
        if (excludedFactIds.length) {
          niifBody.excludedFactIds = excludedFactIds;
        }

        // Reiniciamos el snapshot de la fase anterior (si hay un retry).
        fiscalSnapshotRef.current = null;
        ancoraRef.current = null;

        const niifPayload = await runSSEPhase<{
          reportVersionId: string;
          niif: NiifAnalysisResult;
          context: { bindingTotals: string; preprocessed: unknown; company: CompanyInfo };
          fiscalSnapshot?: FiscalSnapshot;
          ancora?: NiifAncora;
        }>(
          '/api/financial-report/niif',
          niifBody,
          'niif_phase',
          controller.signal,
          PHASE_LABELS.niif[runLanguage],
          {
            onProgress: onSubPhaseProgress,
            onWarning: collectWarnings,
            // Captura los eventos sidecar que el backend emite ANTES de niif_phase
            // (contrato §4.2). Camino rápido: llegan antes del payload principal.
            onExtra: {
              fiscal_snapshot: (raw) => {
                const { fiscalSnapshot } = raw as { fiscalSnapshot?: FiscalSnapshot };
                if (fiscalSnapshot) fiscalSnapshotRef.current = fiscalSnapshot;
              },
              niif_ancora: (raw) => {
                const { ancora } = raw as { ancora?: NiifAncora };
                if (ancora) ancoraRef.current = ancora;
              },
            },
          },
        );

        reportVersionId = niifPayload.reportVersionId;
        niifResult = niifPayload.niif;
        niifContext = niifPayload.context;
        // Fallback: si fiscal_snapshot llegó embebido en niif_phase (contrato §4.2 —
        // "añadir fiscalSnapshot al payload de niif_phase"), lo capturamos aquí.
        if (!fiscalSnapshotRef.current && niifPayload.fiscalSnapshot) {
          fiscalSnapshotRef.current = niifPayload.fiscalSnapshot;
        }
        // Fallback: Âncora embebido en niif_phase para callers legacy.
        if (!ancoraRef.current && niifPayload.ancora) {
          ancoraRef.current = niifPayload.ancora;
        }
        // Capturamos el `preprocessed` para que el handler "Generar HTML"
        // pueda calcular `summarizeCoverage` / `auxiliariesProcessed` /
        // `sectorCIIU` sin necesidad de re-disparar Phase 1.
        setCachedPreprocessed(niifContext.preprocessed);
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        const msg = err instanceof Error ? err.message : 'Error desconocido';
        setError(msg);
        setPipelineState((prev) => ({ ...prev, mode: 'idle' }));
        return;
      }

      // ─── CHECKPOINT 1: persistir NIIF parcial ANTES de strategy/governance ─
      // A partir de aquí, aunque la red se caiga y el usuario recargue, el
      // reporte NIIF vive en localStorage. Los stubs vacíos para
      // strategicAnalysis/governance permiten que el contrato BackendFinancialReport
      // se mantenga sin opcional-explosion; `detectMissingPhases` los reconoce
      // al rehidratar y la UI muestra el reporte como INCOMPLETO en vez de
      // presentarlo como terminado.
      const runRawData = intake?.rawData ?? (resumeCheckpoint as NiifRunCheckpoint | null)?.rawData ?? '';
      // Guardamos el checkpoint reanudable ANTES de tocar Estrategia: si
      // /strategy revienta, el usuario puede reintentar SOLO esa sub-fase sin
      // volver a pagar el Analista NIIF.
      checkpointRef.current = {
        reportVersionId,
        niifResult,
        bindingTotals: niifContext.bindingTotals,
        preprocessed: niifContext.preprocessed,
        company: niifContext.company,
        rawData: runRawData,
        conversationId: nextConvId,
        strategyResult,
      };
      setHasCheckpoint(true);
      if (start === 'niif') {
        saveNiifCheckpoint({
          conversationId: nextConvId,
          reportVersionId,
          bindingTotals: niifContext.bindingTotals,
          savedAt: new Date().toISOString(),
        });
      }

      if (start === 'niif') {
        const partialConsolidated = buildClientConsolidatedReport(
          niifContext.company,
          niifResult.fullContent,
          '',
          '',
          runLanguage,
        );
        const partialReport: BackendFinancialReport = {
          company: niifContext.company,
          niifAnalysis: niifResult,
          strategicAnalysis: emptyStrategy(),
          governance: emptyGovernance(),
          consolidatedReport: partialConsolidated,
          generatedAt: new Date().toISOString(),
          ...(fiscalSnapshotRef.current ? { fiscalSnapshot: fiscalSnapshotRef.current } : {}),
          ...(ancoraRef.current ? { ancora: ancoraRef.current } : {}),
        };
        setBackendReport(partialReport);
        setRawData(runRawData);
        setCompanyInfo(niifContext.company);
        setConversationId(nextConvId);
        setInitialTurns([]);
        setLastCompletedReport({
          report: partialReport,
          rawData: runRawData,
          company: niifContext.company,
          conversationId: nextConvId,
          turns: [],
          auditReport: null,
          qualityReport: null,
        });
      }
      // Capa 5 — Persistencia DB del snapshot fiscal (best-effort, no bloquea UI).
      // El backend creará/actualizará la fila en reports + upsertará alertas.
      if (fiscalSnapshotRef.current) {
        const _snap = fiscalSnapshotRef.current;
        const _company = niifContext.company;
        void (async () => {
          try {
            await fetch('/api/escudo/fiscal-anchor', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                fiscalSnapshot: _snap,
                company: _company,
                ...(ancoraRef.current ? { ancora: ancoraRef.current } : {}),
              }),
            });
          } catch {
            // Silencioso: la capa DB es best-effort. El snapshot ya está en localStorage.
          }
        })();
        // Inyectar contexto fiscal al asistente (best-effort — canal pendingChatContext).
        setPendingChatContext(buildFiscalContextBlock(_snap, _company, runLanguage));
      }

      // ─── Audit en paralelo (DISPARADO ahora, AWAITEADO tras Governance) ─
      // Wave Mayo 2026 — optimización critical path. El audit usa el endpoint
      // /api/financial-audit que ya corre los 4 auditores en Promise.allSettled
      // internamente; lo único que cambia aquí es CUÁNDO se dispara: antes era
      // post-Governance secuencial (~45s al critical path), ahora arranca en
      // paralelo con Strategy→Governance y se awaitea justo antes de Quality.
      // Trade-off: el audit recibe sólo el contenido NIIF; los hallazgos
      // legales/governance tendrán menos material. Si la calidad no alcanza
      // se puede mover este disparo a post-Strategy (mediano), o post-Governance
      // (status quo).
      // En una reanudación sólo re-corremos la auditoría si el intake la pedía
      // y no tenemos ya un resultado: repetirla gratis quemaría LLM de más.
      // Sin versión guardada no hay nada que auditar de forma verificable: la
      // auditoría se omite en vez de correr sobre contenido del navegador.
      const auditEnabled =
        (intake?.outputOptions.auditPipeline ?? false) &&
        !!reportVersionId &&
        (start === 'niif' || auditReportRef.current === null);
      let auditPromise: Promise<ParallelAuditOutcome> = Promise.resolve({
        ok: true,
        value: null,
      });
      if (auditEnabled) {
        setPipelineState((prev) => ({ ...prev, mode: 'auditing' }));
        auditPromise = runAuditInBackground({
          reportVersionId: reportVersionId!,
          language: runLanguage,
          signal: controller.signal,
          callbacks: {
            onAuditorStarted: (domain) => {
              setPipelineState((prev) => ({
                ...prev,
                auditorsStarted: prev.auditorsStarted.includes(domain)
                  ? prev.auditorsStarted
                  : [...prev.auditorsStarted, domain],
              }));
            },
            onAuditorComplete: (domain) => {
              setPipelineState((prev) => ({
                ...prev,
                auditorsComplete: prev.auditorsComplete.includes(domain)
                  ? prev.auditorsComplete
                  : [...prev.auditorsComplete, domain],
              }));
            },
            onAllAuditorsComplete: () => {
              setPipelineState((prev) => ({
                ...prev,
                auditorsComplete: ['niif', 'tributario', 'legal', 'revisoria'],
              }));
            },
            onFindings: (counts) => {
              setPipelineState((prev) => ({ ...prev, auditFindings: counts }));
            },
          },
        });
        // Suprime unhandled-rejection si Strategy/Governance abortan el pipeline
        // antes de que awaitemos abajo. `runAuditInBackground` ya transforma
        // errores en `{ ok: false, error }`, así que .catch() es defensa en
        // profundidad sobre AbortError.
        auditPromise.catch(() => undefined);
      }

      // ─── Sub-fase 1.2: Director de Estrategia ──────────────────────────
      // Si esta falla, persiste el checkpoint NIIF y el pipeline continúa
      // hasta que el usuario decida reintentar. Marcamos `phase2Error` con
      // el mensaje específico de la sub-fase para que el banner lo muestre.
      if (start !== 'governance' || strategyResult === null) {
        try {
          if (!reportVersionId) throw new Error(runLanguage === 'es' ? 'Regenera el informe histórico para continuar con una versión guardada.' : 'Regenerate the historical report to continue with a saved version.');
          const strategyBody = { reportVersionId };

          const strategyPayload = await runSSEPhase<{ strategy: StrategicAnalysisResult; reportVersionId: string }>(
            '/api/financial-report/strategy',
            strategyBody,
            'strategy_phase',
            controller.signal,
            PHASE_LABELS.strategy[runLanguage],
            { onProgress: onSubPhaseProgress, onWarning: collectWarnings },
          );

          reportVersionId = strategyPayload.reportVersionId;
          strategyResult = strategyPayload.strategy;
          checkpointRef.current = { ...checkpointRef.current!, strategyResult, reportVersionId };
        } catch (err) {
          if ((err as Error)?.name === 'AbortError') return;
          const msg = err instanceof Error ? err.message : 'Error desconocido';
          // Sub-fase 1.2 falló — el NIIF parcial sigue persistido y el
          // checkpoint reanudable vive en `checkpointRef`. `missingPhases`
          // habilita el CTA "Reintentar Estrategia", que NO vuelve a pagar el
          // Analista NIIF.
          setError(msg);
          setMissingPhases(['strategy', 'governance']);
          setPipelineState((prev) => ({ ...prev, mode: 'idle' }));
          return;
        }
      }

      // ─── Sub-fase 1.3: Gobierno Corporativo ────────────────────────────
      try {
        const governanceBody = { reportVersionId };

        const governancePayload = await runSSEPhase<{ governance: GovernanceResult; report: BackendFinancialReport; reportVersionId: string }>(
          '/api/financial-report/governance',
          governanceBody,
          'governance_phase',
          controller.signal,
          PHASE_LABELS.governance[runLanguage],
          { onProgress: onSubPhaseProgress, onWarning: collectWarnings },
        );

        serverReport = governancePayload.report;
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        const msg = err instanceof Error ? err.message : 'Error desconocido';
        setError(msg);
        // Estrategia ya está pagada: el reintento arranca en Gobierno.
        setMissingPhases(['governance']);
        setPipelineState((prev) => ({ ...prev, mode: 'idle' }));
        return;
      }

      // The final report is assembled and saved by the server.
      if (!serverReport?.reportVersionId) throw new Error('The completed report was not saved.');
      phase1Report = serverReport;

      // ─── CHECKPOINT 2: actualizar reporte completo en localStorage ──────
      setBackendReport(phase1Report);
      setRawData(runRawData);
      setCompanyInfo(phase1Report.company);
      setConversationId(nextConvId);
      setMissingPhases([]);
      setLastCompletedReport({
        report: phase1Report,
        rawData: runRawData,
        company: phase1Report.company,
        conversationId: nextConvId,
        turns: [],
        // Se re-escriben abajo con el resultado real de las fases 2/3; aquí
        // preservamos lo que ya teníamos para no borrar una auditoría previa
        // durante una reanudación.
        auditReport: auditReportRef.current,
        qualityReport: null,
      });

      setPipelineState((prev) => ({
        ...prev,
        completedStages: [1, 2, 3],
        currentStage: 3,
        phase2Error: undefined,
        phase3Error: undefined,
      }));

      // ─── Phase 2: Audit (DISPARADO antes — solo awaiteamos el resultado) ──
      // Wave Mayo 2026 — el audit ya está corriendo en paralelo desde antes
      // de Strategy (kickoff arriba). Aquí sólo cosechamos el resultado.
      // Fallos NO destruyen el reporte: se registran como `phase2Error`.
      let phase2Report: BackendAuditReport | null = null;
      if (auditEnabled) {
        const outcome = await auditPromise;
        if (outcome.ok) {
          phase2Report = outcome.value;
          if (phase2Report) {
            // Conservar el reporte completo para que el botón Exportar PDF
            // pueda incluir AuditFindingsPage con los 4 auditores + hallazgos.
            setAuditReport(phase2Report);
            auditReportRef.current = phase2Report;
          }
        } else {
          setPipelineState((prev) => ({ ...prev, phase2Error: outcome.error }));
        }
      }

      // ─── Phase 3: Quality Meta-Audit (OPCIONAL, no-bloqueante, retry) ──
      // Esta es la fase mas fragil: NO hay streaming, todo llega en un unico
      // `await .json()` que puede tardar 60-180s. Es la que disparo el bug
      // original `net::ERR_NETWORK_CHANGED`. Mitigacion: retry con backoff
      // ante errores de red + aislamiento del catch.
      let phase3Report: BackendQualityAssessment | null = null;
      if (intake?.outputOptions.metaAudit) {
        setPipelineState((prev) => ({ ...prev, mode: 'quality' }));
        try {
          // Tipamos como QualityAssessment completo — antes solo extraíamos
          // {grade, score}, descartando dimensiones / IFRS18 / ISO 25012 /
          // ISO 42001. Ese detalle es necesario para QualityMetaAuditPage.
          const quality = await fetchJSONWithRetry<BackendQualityAssessment>(
            '/api/financial-quality',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              // Igual que la auditoría: referencias, no contenido. El servidor
              // evalúa la versión completa guardada y registra qué auditoría leyó.
              body: JSON.stringify({
                reportVersionId: phase1Report.reportVersionId,
                auditVersionId: phase2Report?.auditVersionId ?? null,
                language: runLanguage,
              }),
              signal: controller.signal,
            },
            { retries: 2, backoffMs: [1000, 3000] },
          );
          setPipelineState((prev) => ({
            ...prev,
            qualityGrade: quality.grade as QualityGrade,
            qualityScore: quality.overallScore,
          }));
          setQualityReport(quality);
          phase3Report = quality;
        } catch (err) {
          if ((err as Error)?.name === 'AbortError') return;
          const msg = err instanceof Error ? err.message : 'Error desconocido';
          setPipelineState((prev) => ({ ...prev, phase3Error: msg }));
        }
      }

      // ─── CHECKPOINT 3: reporte completo + auditorías persistidas ────────
      // Auditoría 2026-08 (`audit-quality-no-persisten`): `auditReport` y
      // `qualityReport` solo vivían en memoria, así que tras un refresh el PDF
      // salía sin las páginas de auditoría y meta-auditoría, sin avisar.
      setLastCompletedReport({
        report: phase1Report,
        rawData: runRawData,
        company: phase1Report.company,
        conversationId: nextConvId,
        turns: [],
        auditReport: phase2Report ?? auditReportRef.current,
        qualityReport: phase3Report,
      });
      // La corrida terminó: ya no hay nada que reanudar.
      clearPendingRun();
      clearNiifCheckpoint();

      // ─── Finalize ────────────────────────────────────────────────────
      // Independientemente de si Fase 2/3 fallaron, el reporte NIIF se
      // muestra. Los warnings se surfacean via `phase2Error` / `phase3Error`.
      const consolidated = phase1Report.consolidatedReport;
      setReport({
        content: consolidated,
        sections: splitReportIntoSections(consolidated),
      });

      setPipelineState((prev) => ({
        ...prev,
        mode: 'complete',
        completedAt: new Date(),
      }));
    } finally {
      // Solo la corrida vigente puede liberar el registro: una corrida vieja
      // que termina tarde (abortada por un reintento) no debe marcar como
      // "libre" al pipeline que acaba de arrancar.
      if (runtimeRun.controller === controller) {
        runtimeRun.inFlight = false;
        runtimeRun.controller = null;
      }
    }
    },
    // OJO: `language` NO va aquí (se congela por corrida vía `languageRef`).
    // Ponerlo re-creaba el callback y el efecto de arranque, y el cleanup
    // abortaba la corrida en curso al cambiar de idioma.
    [
      pipelineInput,
      pendingRun,
      collectWarnings,
      clearPendingRun,
      setPipelineState,
      setLastCompletedReport,
      setPendingChatContext,
    ],
  );

  // Arranque: un intake nuevo (identidad distinta) dispara la corrida.
  // El guard vive en el registro de MÓDULO, no en un ref del componente: si el
  // usuario navega y vuelve, el remount no debe cobrar el reporte dos veces.
  useEffect(() => {
    if (!pipelineInput) return;
    if (runtimeRun.dispatchedInput === pipelineInput) return;
    runtimeRun.dispatchedInput = pipelineInput;
    void runPipeline('niif');
    // Sin cleanup que aborte: desmontar el componente ya no cancela una corrida
    // de 3-5 minutos ya pagada. Los checkpoints se escriben en el contexto
    // (que no se desmonta) y el usuario reencuentra el reporte al volver.
  }, [pipelineInput, runPipeline]);

  // Aviso del navegador si el usuario refresca o cierra el tab durante la
  // corrida. Es la única barrera posible a nivel de documento: una recarga sí
  // mata el fetch (a diferencia de navegar dentro de la SPA).
  useEffect(() => {
    const running =
      pipelineState.mode === 'running' ||
      pipelineState.mode === 'auditing' ||
      pipelineState.mode === 'quality';
    if (!running) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Los navegadores modernos ignoran el texto y muestran su propio copy.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [pipelineState.mode]);

  const isRunning = pipelineState.mode !== 'idle' && pipelineState.mode !== 'complete';
  const isComplete = pipelineState.mode === 'complete';

  // ─── Handlers para acciones del ReportViewer ────────────────────────────
  // "Nuevo Reporte": limpia el reporte en memoria y reabre el form.
  const handleReset = useCallback(() => {
    // "Nuevo Reporte" es la ÚNICA acción del usuario que cancela explícitamente
    // una corrida viva. El desmontaje ya no lo hace.
    runtimeRun.controller?.abort();
    runtimeRun.controller = null;
    runtimeRun.inFlight = false;
    runtimeRun.dispatchedInput = null;
    checkpointRef.current = null;
    setHasCheckpoint(false);
    clearNiifCheckpoint();
    setMissingPhases([]);
    setAuditReport(null);
    auditReportRef.current = null;
    setQualityReport(null);
    setValidationWarnings([]);
    setReport(null);
    setBackendReport(null);
    setRawData('');
    setCompanyInfo(null);
    setConversationId('');
    setInitialTurns([]);
    setStreamedContent('');
    setError(null);
    setShowRepair(false);
    setRepairConvId('');
    setOriginalReport(null);
    setDiffAffectedAccounts([]);
    // Wave 4.F8 — limpieza del 4° entregable opcional.
    setHtmlReport(null);
    setHtmlEmittable(true);
    setHtmlChecklistFailures([]);
    setHtmlError(null);
    setShowHtmlViewer(false);
    setIsGeneratingHtml(false);
    setCachedPreprocessed(null);
    runtimeRun.startedInput = null;
    setPipelineInput(null);
    setPipelineState((prev) => ({
      ...prev,
      mode: 'idle',
      currentStage: 0,
      completedStages: [],
      auditorsStarted: [],
      auditorsComplete: [],
      auditFindings: {},
      qualityGrade: undefined,
      qualityScore: undefined,
      startedAt: undefined,
      completedAt: undefined,
      phase2Error: undefined,
      phase3Error: undefined,
    }));
  }, [setPipelineInput, setPipelineState]);

  /**
   * Reintento por sub-fase. Reutiliza `runPipeline` (mismo camino de código que
   * el arranque) para no tener dos ensamblajes del reporte que puedan divergir.
   */
  const handleResumePhase = useCallback(
    (phase: PipelinePhaseId) => {
      if (!checkpointRef.current) return;
      void runPipeline(phase);
    },
    [runPipeline],
  );

  /** ¿Se puede reanudar sin volver a pagar el Analista NIIF? */
  const canResumePhase = missingPhases.length > 0 && hasCheckpoint;

  // "Aplicar al reporte": muta consolidatedReport + re-splits sections + persiste.
  const handlePatchReport = useCallback(
    (newMd: string) => {
      setReport({
        content: newMd,
        sections: splitReportIntoSections(newMd),
      });
      setBackendReport((prev) => {
        if (!prev) return prev;
        const next: BackendFinancialReport = { ...prev, reportVersionId: undefined, consolidatedReport: newMd };
        // Persistir el nuevo estado completo.
        if (companyInfo && conversationId) {
          setLastCompletedReport({
            report: next,
            rawData,
            company: companyInfo,
            conversationId,
            turns: initialTurns,
          });
        }
        return next;
      });
    },
    [companyInfo, conversationId, rawData, initialTurns, setLastCompletedReport],
  );

  // Persistencia de turnos del chat de seguimiento.
  const handleTurnsChange = useCallback(
    (turns: ReportIterationTurn[]) => {
      if (!conversationId) return;
      updateReportTurns(conversationId, turns);
    },
    [conversationId, updateReportTurns],
  );

  // ─── Repair chat: mark provisional ───────────────────────────────────────
  // Triggered by RepairChat when the agent decides (via `mark_provisional`
  // tool) that the user wants to bypass the validator hard-fail. We reset
  // error state and re-trigger the pipeline by minting a NEW input object
  // (carries the override flag). The effect on `pipelineInput` re-fires
  // because `lastProcessedInputRef` no longer matches the new reference.
  const handleMarkProvisional = useCallback(
    (reason: string) => {
      setShowRepair(false);
      setError(null);
      if (!pipelineInput) return;
      const provisional: ProvisionalFlag = { active: true, reason };
      // The shared NiifReportIntake type does not yet declare `provisional` —
      // we attach it locally and the api/financial-report route reads it via
      // its own (Backend-agent-extended) request schema. Cast at the boundary
      // to avoid mutating the global type from this file.
      const next = { ...pipelineInput, provisional } as NiifReportIntake;
      setPipelineInput(next);
    },
    [pipelineInput, setPipelineInput],
  );

  // ─── Repair chat: regenerate with applied adjustments (Phase 2) ──────────
  // Triggered by RepairChat when the user has confirmed at least one
  // adjustment via the inline propose/apply UI. The component already
  // filters to `status === 'applied'` before invoking this callback.
  //
  // Mutual exclusion with `provisional`: applying real adjustments supersedes
  // the provisional override — there is no need to mark a report as
  // provisional if the user has actually repaired the data. We therefore
  // CLEAR `provisional` when re-running with adjustments. (If the user later
  // wants to bypass validation again, the repair chat can re-emit it.)
  const handleRegenerateWithAdjustments = useCallback(
    (applied: Adjustment[]) => {
      if (!pipelineInput) return;
      setShowRepair(false);
      setRepairSeed(null);
      setError(null);
      // ─── Phase 3 hook 3: capturar reporte original ANTES del regen ─────
      // El reporte vivo puede venir de dos lugares dependiendo de si hubo
      // un patch del chat de seguimiento: prefer backend.consolidatedReport
      // (autoritativo, es lo que el backend ya emitio) y caer a report.content.
      // Si ninguno existe (caso raro: regenerando sin reporte previo), no
      // capturamos — el toggle de diff simplemente no aparecera.
      const previousMarkdown =
        backendReport?.consolidatedReport ?? report?.content ?? null;
      if (previousMarkdown && previousMarkdown.trim().length > 0) {
        setOriginalReport(previousMarkdown);
      }
      // Cuentas afectadas — codigos PUC unicos del set aplicado, para que
      // el diff las pueda resaltar.
      setDiffAffectedAccounts(
        Array.from(new Set(applied.map((a) => a.accountCode).filter(Boolean))),
      );
      // Mint a NEW reference so the pipeline effect re-fires (it compares
      // identity against `lastProcessedInputRef.current`).
      const next = {
        ...pipelineInput,
        adjustmentLedger: { adjustments: applied },
        provisional: undefined,
      } as NiifReportIntake & {
        adjustmentLedger: AdjustmentLedger;
        provisional?: ProvisionalFlag;
      };
      setPipelineInput(next);
    },
    [pipelineInput, setPipelineInput, backendReport, report],
  );

  // ─── Wave 4.F8 — Generar reporte HTML 1+1 v8.1 (cap-stone visual) ───────
  // Post-Phase 3. Compone el payload exigido por `/api/financial-report/html`:
  //   - 3 JSONs estructurados (NIIF + Strategy + Governance).
  //   - Echo de `company`.
  //   - `metadata` pre-cocinada determinísticamente en cliente: hash SHA-256
  //     vía Web Crypto, cobertura por clase PUC, confianza global agregada,
  //     conteos de alertas/findings por severidad.
  //
  // Diseño no-bloqueante: si el endpoint falla, NO destruye el reporte
  // existente — sólo se muestra `htmlError` y el viewer Markdown queda
  // intacto. Permite reintentar haciendo click otra vez.
  const handleGenerateHtml = useCallback(async () => {
    if (!backendReport || !companyInfo || !cachedPreprocessed || isGeneratingHtml) return;
    // Mismo gate que Excel y PDF: el HTML editorial de 15 páginas es el
    // entregable que más lee el cliente, y reproduce las mismas cifras que la
    // reconciliación no logró cuadrar. Un informe sellado CON SALVEDADES no se
    // emite en NINGÚN formato — el visor Markdown sigue disponible con el sello
    // en portada, que es donde el usuario debe leer las salvedades.
    if (backendReport.niifAnalysis.reconciliation?.clean === false) {
      setHtmlError(
        language === 'es'
          ? 'La reconciliación contra el balance preprocesado no cerró: el informe está sellado CON SALVEDADES y no es firmable tal como está. Revise las salvedades de la portada antes de emitirlo.'
          : 'Reconciliation against the preprocessed trial balance did not close: the report is sealed WITH QUALIFICATIONS and is not signable as issued. Review the qualifications on the cover before issuing it.',
      );
      return;
    }

    setHtmlError(null);
    setIsGeneratingHtml(true);

    try {
      // Extraer los 3 JSONs estructurados del reporte backend. Pre-Fase-2 los
      // agentes legacy no emitían `.json`; en producción 2026-05-13 todos
      // emiten — pero hacemos lookup defensivo.
      const niifJson = backendReport.niifAnalysis.json;
      const strategyJson = backendReport.strategicAnalysis.json;
      const governanceJson = backendReport.governance.json;

      if (!niifJson || !strategyJson || !governanceJson) {
        throw new Error(
          language === 'es'
            ? 'El reporte no contiene los JSONs estructurados requeridos por el Editor Jefe HTML. Regenera el reporte para habilitar esta opción.'
            : 'The report is missing the structured JSON outputs required by the HTML Editor. Regenerate the report to enable this option.',
        );
      }

      // Pre-cocinado de metadata determinístico.
      const reportMode = readReportMode(niifJson);
      const coverage = clientSummarizeCoverage(cachedPreprocessed);
      const globalConfidence = clientAggregateConfidence({
        niif: niifJson,
        strategy: strategyJson,
        governance: governanceJson,
      });
      const hash = await clientComputeReportHash({
        niif: niifJson,
        strategy: strategyJson,
        governance: governanceJson,
      });
      const alertsCounts = countAlertsBySeverity(strategyJson, auditReport);
      const auxiliariesProcessed = readAuxiliariesProcessed(cachedPreprocessed);
      const sectorCIIU = readSectorCIIU(cachedPreprocessed);
      const fiscalPeriod = backendReport.company.fiscalPeriod || pipelineInput?.fiscalPeriod || '';
      // Fiscal period es YYYY (validado por `FiscalYear` Zod). Derivamos los
      // límites canónicos del año fiscal — si en el futuro el intake exige
      // cortes parciales, esto pasaría a leer `preprocessed.primary.periodoTipo`.
      const periodStart = `${fiscalPeriod}-01-01`;
      const periodEnd = `${fiscalPeriod}-12-31`;
      const generatedAt = new Date().toISOString();
      // `extractedAt` ideal = momento de upload del balance. No lo tenemos en
      // el estado actual del workspace; usamos `generatedAt` como fallback.
      // El renderer Slide 12 los diferencia visualmente — sin breakage si
      // coinciden.
      const extractedAt = backendReport.generatedAt ?? generatedAt;

      // Datos editoriales v10.1 — la portada + cierre (Página 14) los emiten
      // literalmente. Si el `companyInfo` del intake no los trae, derivamos
      // defaults defensivos: SAS Ley 1258/2008 es el caso más común en MIPYMEs
      // colombianas; Grupo 2 es el grupo NIIF para Pymes (Decreto 2420/2015).
      // Estos defaults son visibles en el output — el usuario puede corregirlos
      // editando el intake antes de regenerar.
      //
      // entityLaw se infiere del entityType: SAS → Ley 1258/2008, SA → Cód. Co.
      // Art. 110 ss., LTDA → Cód. Co. Art. 353 ss. Si en el futuro el intake
      // expone un campo `constitutiveLaw` explícito, esto deja de ser inferencia.
      const entityCity = companyInfo?.city?.trim() || 'Colombia';
      const entityType = companyInfo?.entityType?.trim() || 'SAS';
      const entityLawByType: Record<string, string> = {
        SAS: 'Ley 1258/2008',
        SA: 'C. Co. Art. 110',
        LTDA: 'C. Co. Art. 353',
      };
      const entityLaw = entityLawByType[entityType.toUpperCase()] ?? 'Ley 1258/2008';
      // niifGroup viene como número 1|2|3 — lo formateamos como "Grupo N" texto.
      const niifGroupNum = companyInfo?.niifGroup ?? 2;
      const entityGroup = `Grupo ${niifGroupNum}`;

      // Fecha de emisión human-readable en español: "13 de mayo de 2026"
      const issuedDate = new Date(generatedAt);
      const issuedAtHuman = issuedDate.toLocaleDateString(
        language === 'es' ? 'es-CO' : 'en-US',
        { year: 'numeric', month: 'long', day: 'numeric' },
      );

      const metadata = {
        reportMode,
        entityNit: backendReport.company.nit,
        entityName: backendReport.company.name,
        entityCity,
        entityType,
        entityLaw,
        entityGroup,
        periodStart,
        periodEnd,
        periodYear: fiscalPeriod,
        generatedAt,
        extractedAt,
        issuedAtHuman,
        // La ficha técnica del reporte declaraba `gpt-5.5` hardcodeado mientras
        // el pipeline corría otro modelo: un dato de trazabilidad FALSO impreso
        // junto al hash SHA-256 de integridad, en un documento que el cliente
        // firma. `CLIENT_REPORT_MODEL_ID` es el espejo del default de
        // `MODEL_IDS.FINANCIAL_PIPELINE` (hay test de deriva). El cierre
        // definitivo es que /api/financial-report/html lo sobrescriba
        // server-side con el id ya resuelto — fuera de esta frontera.
        modelId: CLIENT_REPORT_MODEL_ID,
        agentVersion: '1+1 v10.1' as const,
        globalConfidence,
        alertsCounts,
        auxiliariesProcessed,
        coverageByClass: coverage,
        sectorCIIU,
        reportHashSha256: hash,
      };

      // Ola 2 — misma lista de hechos excluidos que confirmó el intake
      // (Task 8). `pipelineInput` es opcional en este callback, de ahí el
      // acceso defensivo. Solo se envía cuando hay exclusiones.
      const excludedFactIds = pipelineInput?.excludedFactIds ?? [];
      const body = {
        niifReport: niifJson,
        strategyReport: strategyJson,
        governanceReport: governanceJson,
        company: backendReport.company,
        metadata,
        language,
        ...(excludedFactIds.length ? { excludedFactIds } : {}),
      };

      const controller = new AbortController();
      const result = await runSSEPhase<{
        html: string;
        metadata: typeof metadata;
        checklistFailures: Array<{ rule: string; detail: string; severity: 'block' | 'warn' }>;
        /**
         * `false` cuando algún check BLOQUEANTE del linter §11 o de la
         * reconciliación HTML↔JSON no pasó — típicamente una cifra vinculante
         * que no aparece literal en el HTML, o un desliz de escala ×100. El
         * HTML ya viene estampado como BORRADOR, pero el visor necesita el
         * flag para no ofrecer la descarga como si fuera un informe firmable.
         */
        emittable?: boolean;
      }>(
        '/api/financial-report/html',
        body,
        'html_phase',
        controller.signal,
        language === 'es' ? 'Editor Jefe HTML' : 'HTML Editor',
      );

      setHtmlReport(result.html);
      setHtmlChecklistFailures(result.checklistFailures ?? []);
      // `!== false` y no `!result.emittable`: un payload legacy sin el campo se
      // trata como emitible, para no romper reportes ya persistidos.
      setHtmlEmittable(result.emittable !== false);
      setShowHtmlViewer(true);
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      setHtmlError(
        language === 'es'
          ? `No se pudo generar el HTML: ${msg}`
          : `Could not generate HTML: ${msg}`,
      );
    } finally {
      setIsGeneratingHtml(false);
    }
  }, [
    backendReport,
    companyInfo,
    cachedPreprocessed,
    isGeneratingHtml,
    auditReport,
    language,
    pipelineInput,
  ]);

  // ─── "Continuar de todas formas" shortcut ────────────────────────────────
  const handleContinueAnyway = useCallback(() => {
    setRepairSeed(
      language === 'es'
        ? 'Quiero generar el reporte como borrador a pesar del error de validación. Confirma el override y procede.'
        : 'I want to generate the report as a draft despite the validation error. Confirm the override and proceed.',
    );
    setShowRepair(true);
  }, [language]);

  const handleToggleRepair = useCallback(() => {
    setShowRepair((s) => {
      // Si abrimos el chat manualmente (no via "Continuar de todas formas"),
      // limpiamos el seed para no auto-enviar mensaje no deseado.
      if (!s) setRepairSeed(null);
      return !s;
    });
  }, []);

  // Tras un refresh `pipelineInput` es null; caemos al intake persistido para
  // no exportar un PDF con páginas que el usuario había destildado.
  const effectiveOutputOptions =
    pipelineInput?.outputOptions ?? pendingRun?.input.outputOptions ?? null;

  if (isComplete && report) {
    const hasWarnings = Boolean(pipelineState.phase2Error || pipelineState.phase3Error);
    // Wave 4.F8 — el HtmlReportViewer toma el área completa cuando el usuario
    // clic "Generar HTML" y el agente respondió OK. El botón "Cerrar" vuelve
    // al ReportViewer Markdown. NO desmontamos `<ReportViewer>` (queda en
    // memoria para preservar scroll position + turns del chat de seguimiento)
    // — sólo lo ocultamos vía conditional rendering.
    if (showHtmlViewer && htmlReport) {
      return (
        <div className="h-full flex flex-col">
          <HtmlReportViewer
            html={htmlReport}
            nit={backendReport?.company.nit ?? companyInfo?.nit ?? ''}
            fiscalPeriod={
              backendReport?.company.fiscalPeriod ?? pipelineInput?.fiscalPeriod ?? ''
            }
            checklistFailures={htmlChecklistFailures}
            emittable={htmlEmittable}
            language={language}
            onClose={() => setShowHtmlViewer(false)}
          />
        </div>
      );
    }
    return (
      <div className="h-full flex flex-col">
        {/*
          Reporte INCOMPLETO. Auditoría 2026-08: este es el caso peligroso —
          Partes II/III vacías presentadas como documento terminado y
          exportable. El banner es de nivel error (no "advertencia") porque el
          entregable no está en condiciones de firmarse.
        */}
        {missingPhases.length > 0 && (
          <div
            role="alert"
            className="shrink-0 border-b border-danger/40 bg-danger/10 px-6 py-3 flex items-start gap-2"
          >
            <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" aria-hidden="true" />
            <div className="flex-1 min-w-0 text-xs">
              <div className="font-medium mb-0.5 text-danger">
                {language === 'es'
                  ? 'Reporte INCOMPLETO — no apto para firma'
                  : 'INCOMPLETE report — not fit for signature'}
              </div>
              <p className="text-n-800">
                {language === 'es'
                  ? `Faltan por generar: ${missingPhases
                      .map((p) =>
                        p === 'strategy'
                          ? 'Parte II (Análisis Estratégico)'
                          : 'Parte III (Gobierno Corporativo)',
                      )
                      .join(' y ')}. El contenido de esas secciones aparece vacío.`
                  : `Still missing: ${missingPhases
                      .map((p) =>
                        p === 'strategy'
                          ? 'Part II (Strategic Analysis)'
                          : 'Part III (Corporate Governance)',
                      )
                      .join(' and ')}. Those sections render empty.`}
              </p>
              {canResumePhase && (
                <button
                  type="button"
                  onClick={() => handleResumePhase(missingPhases[0])}
                  className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-gold-500 text-n-0 hover:bg-gold-700 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  {language === 'es'
                    ? missingPhases[0] === 'strategy'
                      ? 'Completar reporte (reintentar Estrategia)'
                      : 'Completar reporte (reintentar Gobierno)'
                    : missingPhases[0] === 'strategy'
                      ? 'Complete report (retry Strategy)'
                      : 'Complete report (retry Governance)'}
                </button>
              )}
            </div>
          </div>
        )}
        {hasWarnings && (
          <div
            role="status"
            aria-live="polite"
            className="shrink-0 border-b border-warning/30 bg-warning/10 px-6 py-3 flex items-start gap-2"
          >
            <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" aria-hidden="true" />
            <div className="flex-1 min-w-0 text-xs text-warning">
              <div className="font-medium mb-0.5">
                {language === 'es'
                  ? 'Reporte generado con advertencias'
                  : 'Report generated with warnings'}
              </div>
              {pipelineState.phase2Error && (
                <p className="whitespace-pre-wrap break-words">
                  {language === 'es'
                    ? 'Auditoría regulatoria no disponible: '
                    : 'Regulatory audit unavailable: '}
                  {pipelineState.phase2Error}
                </p>
              )}
              {pipelineState.phase3Error && (
                <p className="whitespace-pre-wrap break-words">
                  {language === 'es'
                    ? 'Meta-auditoría de calidad no disponible: '
                    : 'Quality meta-audit unavailable: '}
                  {pipelineState.phase3Error}
                </p>
              )}
            </div>
          </div>
        )}
        {/*
          Salvedades del validador contable. También deben verse en la vista de
          reporte terminado: el caso peligroso es precisamente el reporte que
          "salió bien" con la ecuación patrimonial rota.
        */}
        {validationWarnings.length > 0 && (
          <div
            role="status"
            aria-live="polite"
            className="shrink-0 border-b border-gold-500/40 bg-gold-500/10 px-6 py-3"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-gold-700 shrink-0 mt-0.5" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-n-1000">
                  {language === 'es'
                    ? `Validación contable: ${validationWarnings.length} ${
                        validationWarnings.length === 1 ? 'salvedad' : 'salvedades'
                      }`
                    : `Accounting validation: ${validationWarnings.length} ${
                        validationWarnings.length === 1 ? 'exception' : 'exceptions'
                      }`}
                </div>
                <ul className="mt-1 space-y-1">
                  {validationWarnings.map((w, i) => (
                    <li
                      key={`${i}-${w.slice(0, 40)}`}
                      className="text-xs text-n-800 whitespace-pre-wrap break-words"
                    >
                      • {w}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}
        <div className="flex-1 min-h-0">
          <ReportViewer
            content={report.content}
            sections={report.sections}
            report={backendReport ?? undefined}
            rawData={rawData || undefined}
            company={companyInfo ?? undefined}
            language={language}
            conversationId={conversationId || undefined}
            initialTurns={initialTurns}
            auditReport={auditReport}
            qualityReport={qualityReport}
            outputOptions={effectiveOutputOptions}
            onReset={handleReset}
            onPatchReport={handlePatchReport}
            onTurnsChange={handleTurnsChange}
            originalContent={originalReport}
            affectedAccounts={diffAffectedAccounts}
            onGenerateHtml={handleGenerateHtml}
            isGeneratingHtml={isGeneratingHtml}
            htmlReady={htmlReport !== null}
            onShowHtml={() => setShowHtmlViewer(true)}
            htmlError={htmlError}
          />
        </div>
      </div>
    );
  }

  // Phase 2 visual indicator: when the pipeline is running with applied
  // adjustments, show a thin banner so the user knows the regeneration was
  // not a fresh run. Read via the same narrow lookup used in the fetch.
  const adjustmentLedger = (pipelineInput as
    | (NiifReportIntake & { adjustmentLedger?: AdjustmentLedger })
    | null)?.adjustmentLedger;
  const adjustmentCount = adjustmentLedger?.adjustments?.length ?? 0;
  const isRegeneratingWithAdjustments = isRunning && adjustmentCount > 0;

  return (
    <div className="h-full flex flex-col overflow-y-auto styled-scrollbar">
      {isRegeneratingWithAdjustments && (
        <div className="shrink-0 border-b border-gold-500/30 bg-gold-300/10 px-6 py-2 flex items-center gap-2 text-xs text-gold-700">
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
          <span className="font-medium">
            {language === 'es'
              ? `Regenerando con ${adjustmentCount} ajuste${adjustmentCount === 1 ? '' : 's'} aplicado${adjustmentCount === 1 ? '' : 's'}`
              : `Regenerating with ${adjustmentCount} applied adjustment${adjustmentCount === 1 ? '' : 's'}`}
          </span>
        </div>
      )}

      <PipelineMonitor state={pipelineState} language={language} />

      {error && (
        // `role="alert"` — el pipeline tarda minutos; sin esto un usuario de
        // lector de pantalla nunca se entera de que la corrida murió.
        <div
          role="alert"
          className="mx-6 my-4 rounded-lg border border-danger bg-danger/10 px-4 py-3"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-danger">
                {language === 'es' ? 'Error en el pipeline' : 'Pipeline error'}
              </div>
              <p className="text-xs text-n-700 whitespace-pre-wrap break-words">{error}</p>

              {/* Action footer — repair chat toggle + continue-anyway shortcut. */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {/*
                  Reintento por sub-fase: si el NIIF ya está pagado, reintentar
                  SOLO la sub-fase que falló evita re-ejecutar la fase cara y
                  evita que el LLM devuelva cifras distintas a las ya vistas.
                */}
                {canResumePhase && (
                  <button
                    type="button"
                    onClick={() => handleResumePhase(missingPhases[0])}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-gold-500 text-n-0 hover:bg-gold-700 transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                    {language === 'es'
                      ? missingPhases[0] === 'strategy'
                        ? 'Reintentar Estrategia'
                        : 'Reintentar Gobierno'
                      : missingPhases[0] === 'strategy'
                        ? 'Retry Strategy'
                        : 'Retry Governance'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleToggleRepair}
                  aria-expanded={showRepair}
                  aria-controls="repair-chat-panel"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-gold-500 text-n-0 hover:bg-gold-700 transition-colors"
                >
                  <Stethoscope className="w-3.5 h-3.5" />
                  {showRepair
                    ? language === 'es' ? 'Cerrar chat' : 'Close chat'
                    : language === 'es' ? 'Hablar con El Doctor' : 'Talk to the Doctor'}
                  {showRepair ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleContinueAnyway}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-n-200 text-n-700 text-xs font-medium hover:bg-n-50 transition-colors"
                >
                  {language === 'es' ? 'Continuar de todas formas' : 'Continue anyway'}
                </button>
              </div>
            </div>
          </div>

          {showRepair && pipelineInput && (
            <div id="repair-chat-panel" className="mt-3">
              <RepairChat
                context={{
                  errorMessage: error,
                  rawCsv: pipelineInput.rawData ?? null,
                  language,
                  companyName: pipelineInput.company?.name,
                  period: pipelineInput.fiscalPeriod,
                  conversationId: repairConvId,
                }}
                onMarkProvisional={handleMarkProvisional}
                onRegenerateWithAdjustments={handleRegenerateWithAdjustments}
                onClose={() => {
                  setShowRepair(false);
                  setRepairSeed(null);
                }}
                language={language}
                initialUserMessage={repairSeed ?? undefined}
                // Phase 3 P1 fix #4: el provisional flag vive en el pipelineInput
                // como campo runtime (no declarado en NiifReportIntake). Lo
                // pasamos al chat para que el autosave del hook lo persista en DB.
                provisional={
                  (pipelineInput as NiifReportIntake & { provisional?: ProvisionalFlag })
                    ?.provisional ?? null
                }
              />
            </div>
          )}
        </div>
      )}

      {/*
        Advertencias de validación contable. Auditoría 2026-08: hasta esta
        versión el backend las emitía y el cliente las descartaba, de modo que
        un reporte con la ecuación patrimonial rota se entregaba con apariencia
        impecable. Aparecen aunque el pipeline haya terminado "bien", porque
        precisamente ése es el caso peligroso.
      */}
      {validationWarnings.length > 0 && (
        <div
          role="status"
          aria-live="polite"
          className="mx-6 my-4 rounded-lg border border-gold-500 bg-gold-500/10 px-4 py-3"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-gold-700 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-n-1000">
                {language === 'es'
                  ? `Validación contable: ${validationWarnings.length} ${
                      validationWarnings.length === 1 ? 'salvedad' : 'salvedades'
                    }`
                  : `Accounting validation: ${validationWarnings.length} ${
                      validationWarnings.length === 1 ? 'exception' : 'exceptions'
                    }`}
              </div>
              <p className="mt-1 text-xs text-n-700">
                {language === 'es'
                  ? 'El validador determinista encontró diferencias entre el reporte y el balance de origen. Revíselas antes de firmar los estados financieros.'
                  : 'The deterministic validator found differences between the report and the source trial balance. Review them before signing the financial statements.'}
              </p>
              <ul className="mt-2 space-y-1">
                {validationWarnings.map((w, i) => (
                  <li
                    key={`${i}-${w.slice(0, 40)}`}
                    className="text-xs text-n-800 whitespace-pre-wrap break-words"
                  >
                    • {w}
                  </li>
                ))}
              </ul>
              {pipelineInput && (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={handleToggleRepair}
                    aria-expanded={showRepair}
                    aria-controls="repair-chat-panel"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-gold-500 text-n-0 hover:bg-gold-700 transition-colors"
                  >
                    <Stethoscope className="w-3.5 h-3.5" aria-hidden="true" />
                    {language === 'es' ? 'Revisar con el Doctor de Datos' : 'Review with Data Doctor'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {!pipelineInput && !isRunning && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
          {/*
            Reanudación tras F5 / cierre del tab. El intake ya confirmado se
            persiste al arrancar la corrida; sin esto el usuario tenía que
            rehacer el wizard entero y volver a subir el balance.
            NO se relanza sola: la corrida cuesta minutos y dinero, así que
            exige un click explícito.
          */}
          {pendingRun && (
            <div className="rounded-lg border border-gold-500/40 bg-gold-500/10 px-4 py-3 max-w-md">
              <p className="text-sm font-medium text-n-1000">
                {language === 'es'
                  ? `Hay un reporte sin terminar de ${pendingRun.input.company.name}`
                  : `There is an unfinished report for ${pendingRun.input.company.name}`}
              </p>
              <p className="mt-1 text-xs text-n-700">
                {language === 'es'
                  ? 'La corrida se interrumpió (recarga de página o cierre del navegador). Puede relanzarla con los mismos datos ya cargados.'
                  : 'The run was interrupted (page reload or browser close). You can relaunch it with the same data already loaded.'}
              </p>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={resumePendingRun}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-gold-500 text-n-0 hover:bg-gold-700 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  {language === 'es' ? 'Reanudar reporte' : 'Resume report'}
                </button>
                <button
                  type="button"
                  onClick={clearPendingRun}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-n-200 text-n-700 text-xs font-medium hover:bg-n-50 hover:text-n-1000 transition-colors"
                >
                  {language === 'es' ? 'Descartar' : 'Discard'}
                </button>
              </div>
            </div>
          )}
          <p className="text-sm text-n-600">
            {language === 'es'
              ? 'No hay pipeline activo. Inicie un nuevo reporte desde "Nueva Consulta".'
              : 'No active pipeline. Start a new report from "New Consultation".'}
          </p>
        </div>
      )}

      {/* Live streaming preview */}
      {streamedContent && (
        <div className="flex-1 border-t border-n-200 px-8 py-6 overflow-y-auto styled-scrollbar">
          <h3 className="text-2xs font-bold text-n-700 uppercase tracking-wider mb-3 font-mono">
            {language === 'es' ? 'Vista previa en tiempo real' : 'Live preview'}
          </h3>
          <StreamingText isStreaming={isRunning}>
            <div className="prose prose-sm max-w-none text-n-900">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeSanitize, MARKDOWN_SANITIZE_SCHEMA]]}>
                {streamedContent}
              </ReactMarkdown>
            </div>
          </StreamingText>
        </div>
      )}

      {!streamedContent && isRunning && !error && (
        <div className="flex-1 flex items-center justify-center text-sm text-n-600">
          <motion.div
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            {language === 'es'
              ? 'Esperando respuesta de los agentes...'
              : 'Waiting for the agents to respond...'}
          </motion.div>
        </div>
      )}
    </div>
  );
}
