// ---------------------------------------------------------------------------
// auditReportEmittable — Gate determinístico de emisión del informe NIIF
// ---------------------------------------------------------------------------
// Pulido NIIF PYME Grupo 2 — verifica 11 invariantes contables, regulatorias
// y de identidad ANTES de devolver el informe consolidado al usuario. Si
// CUALQUIER invariante falla, el endpoint `/api/financial-report` devuelve
// un objeto "no emitible" con la lista de blockers en lugar de los EEFF.
//
// Diseño:
//   - 100 % determinístico (sin LLM, sin random).
//   - Tolerancia 0n centavos (BigInt) para chequeos numéricos. Floating-point
//     ya no se usa en el path crítico (los anchors viven en
//     `controlTotals.cents`).
//   - Cada blocker se reporta como string corta legible al socio-director.
//   - El informe (`report`) se inspecciona con regex simples para detectar
//     menciones a IFRS 18, reserva legal SAS, TMT 15%, y placeholders
//     prohibidos ("Triple SSS", "213.092.082-1").
//
// El gate se inyecta en `src/lib/agents/financial/orchestrator.ts` justo
// antes del `return report` final.
// ---------------------------------------------------------------------------

import type { FinancialReport } from '@/lib/agents/financial/types';
import type { ExtractedCompanyMetadata, PeriodSnapshot, ActividadInferida, ReclasificacionNoCompensacion } from '@/lib/preprocessing/trial-balance';
import { validateNITCheckDigit } from '@/lib/validation/nit-validator';

/**
 * Metadata de la empresa que el gate consume. Combina la metadata extraída
 * del Excel (`razonSocialFromFile`, `nitFromFile`) con flags del intake del
 * usuario (`niifGroup`, `tipoSocietario`, `estatutosRequierenReservaLegal`).
 */
export interface AuditCompanyContext {
  razonSocialFromFile: string | null;
  nitFromFile: string | null;
  nit: string | null;
  niifGroup: 1 | 2 | 3;
  tipoSocietario?: 'SAS' | 'SA' | 'LTDA' | 'EU' | 'OTRO';
  /** Tri-state intencionalmente: `undefined` = "no preguntado al usuario". */
  estatutosRequierenReservaLegal?: boolean;
}

export type AuditBlockerCode =
  | 'V1'
  | 'V2'
  | 'V3'
  | 'V4'
  | 'V5'
  | 'V6'
  | 'V7'
  | 'V8'
  | 'V9'
  | 'V10'
  | 'V11'
  | 'V12'
  | 'V13'
  | 'V14'
  | 'V15';

/**
 * Subset cross-period del `PreprocessedBalance` que el gate consume para
 * V14 (margen bruto sospechoso en CIIU G) y V15 (impracticabilidad de
 * comparativos NIIF for SMEs §3.14 / §10.21). Pick para que el gate no
 * necesite importar el shape completo del preprocesador.
 */
export interface EmittableEliteContext {
  comparativos_impracticables?: boolean;
  actividadInferida?: ActividadInferida;
  reclasificacionesNoCompensacion?: ReclasificacionNoCompensacion[];
}

export interface AuditBlocker {
  code: AuditBlockerCode;
  message: string;
  /** Detalle adicional para debug — no para el informe al usuario. */
  detail?: string;
}

export interface AuditReportEmittableResult {
  emittable: boolean;
  blockers: AuditBlocker[];
  /** Sugerencias accionables para el usuario cuando `!emittable`. */
  suggestedAdjustments: string[];
}

// ---------------------------------------------------------------------------
// Tolerancias y umbrales del gate
// ---------------------------------------------------------------------------

/** Tolerancia 0n centavos para checks numéricos críticos (V1, V2, V3, V4). */
const CENTS_TOLERANCE_ZERO = BigInt(0);

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

export function auditReportEmittable(
  report: FinancialReport,
  snapshot: PeriodSnapshot,
  company: AuditCompanyContext,
  elite?: EmittableEliteContext,
): AuditReportEmittableResult {
  const blockers: AuditBlocker[] = [];
  const suggestedAdjustments: string[] = [];

  const reportText = report?.consolidatedReport ?? '';
  const ct = snapshot.controlTotals;
  const cents = ct.cents;

  // -------------------------------------------------------------------------
  // V12 (especial): si R12 detectó libros no cerrados, NUNCA es emitible.
  // Lo evaluamos primero porque cualquier otro check sobre el balance es
  // engañoso (la utilidad no está trasladada al patrimonio).
  // -------------------------------------------------------------------------
  if (snapshot.findings?.librosNoCerrados === true) {
    blockers.push({
      code: 'V12',
      message:
        'V12: libros no cerrados — utilidad del ejercicio sin trasladar al patrimonio. ' +
        'Pasar el asiento de cierre antes de re-procesar.',
      detail: snapshot.closingDetectorAudit?.suggestedClosingEntries.join(' | '),
    });
    if (snapshot.closingDetectorAudit?.suggestedClosingEntries) {
      suggestedAdjustments.push(...snapshot.closingDetectorAudit.suggestedClosingEntries);
    }
  }

  // -------------------------------------------------------------------------
  // V1 — Ecuación patrimonial: Activo === Pasivo + Patrimonio (cents BigInt).
  // -------------------------------------------------------------------------
  if (cents) {
    const equationDiff = cents.activo - cents.pasivo - cents.patrimonio;
    if (equationDiff !== CENTS_TOLERANCE_ZERO) {
      blockers.push({
        code: 'V1',
        message: `V1: ecuación patrimonial rota (Activo − Pasivo − Patrimonio = ${formatBigCents(equationDiff)}).`,
      });
    }
  } else {
    blockers.push({
      code: 'V1',
      message: 'V1: ecuación patrimonial no verificable — controlTotals.cents ausente.',
    });
  }

  // -------------------------------------------------------------------------
  // V2 — U Neta === UAI − Impuesto Causado (cents BigInt).
  // -------------------------------------------------------------------------
  if (cents) {
    const expectedUNeta = cents.utilidadAntesImpuestos - cents.impuestoCausado;
    if (cents.utilidadNeta !== expectedUNeta) {
      const diff = cents.utilidadNeta - expectedUNeta;
      blockers.push({
        code: 'V2',
        message: `V2: U Neta ≠ UAI − Impuesto Causado (drift = ${formatBigCents(diff)}).`,
      });
    }
  }

  // -------------------------------------------------------------------------
  // V3 — EFE concilia con caja PUC 11 al cierre.
  // R6 ya cierra el EFE contra PUC 11. Si el ajuste residual de R6 está
  // cerrado al centavo, V3 pasa. Si R6 no se ejecutó (no hubo comparativo),
  // saltamos V3 (no aplicable).
  // -------------------------------------------------------------------------
  if (snapshot.cashFlowIndirecto) {
    const efeNetCents = BigInt(Math.round(snapshot.cashFlowIndirecto.netChangeInCash * 100));
    const observedCents = BigInt(Math.round(snapshot.cashFlowIndirecto.observedChangeInCash * 100));
    if (efeNetCents !== observedCents) {
      blockers.push({
        code: 'V3',
        message: `V3: EFE no concilia con cuenta 11 (diferencia = ${formatBigCents(efeNetCents - observedCents)}).`,
      });
    }
  }

  // -------------------------------------------------------------------------
  // V4 — ECP === patrimonio del balance (post-R5/R8 al centavo).
  // -------------------------------------------------------------------------
  if (cents) {
    const summaryEquityCents = BigInt(Math.round(snapshot.summary.totalEquity * 100));
    if (summaryEquityCents !== cents.patrimonio) {
      blockers.push({
        code: 'V4',
        message: `V4: ECP ≠ patrimonio del balance (drift = ${formatBigCents(summaryEquityCents - cents.patrimonio)}).`,
      });
    }
  }

  // -------------------------------------------------------------------------
  // V5 — identidad extraída del archivo (NUNCA placeholder/fallback).
  // -------------------------------------------------------------------------
  if (!company.razonSocialFromFile || !company.nitFromFile) {
    blockers.push({
      code: 'V5',
      message:
        'V5: identidad sin extraer del archivo. Razón social o NIT no detectados en los ' +
        'encabezados del balance de prueba. Revisar el header del Excel — el sistema NO emite ' +
        'EEFF con identidad de fallback.',
    });
  }

  // Detección defensiva de placeholders prohibidos ("Triple SSS", etc.).
  const PLACEHOLDER_PATTERNS = [
    /Triple\s*SSS/i,
    /213\.?092\.?082-?1/,
    /\bDEFAULT_COMPANY\b/,
    /\bplaceholder\b/i,
  ];
  for (const re of PLACEHOLDER_PATTERNS) {
    if (re.test(reportText)) {
      blockers.push({
        code: 'V5',
        message: `V5: placeholder prohibido detectado en el informe ("${re.source}"). El informe NO es emitible.`,
      });
      break;
    }
  }

  // -------------------------------------------------------------------------
  // V6 — DV NIT válido contra DIAN (vector de pesos primos).
  // -------------------------------------------------------------------------
  const nitToValidate = company.nitFromFile ?? company.nit ?? null;
  if (nitToValidate && !validateNITCheckDigit(nitToValidate)) {
    blockers.push({
      code: 'V6',
      message: `V6: DV NIT inválido (NIT="${nitToValidate}"). Verificar contra RUT — el algoritmo DIAN no lo valida.`,
    });
  }

  // -------------------------------------------------------------------------
  // V7 — cuenta 18 mal clasificada (R10).
  // -------------------------------------------------------------------------
  if (snapshot.findings?.cuenta18UsadaComoGasto === true) {
    blockers.push({
      code: 'V7',
      message:
        'V7: cuenta 18 (Otros activos) con saldo acreedor — uso indebido como gasto. ' +
        'Reclasificar a 24xx (impuesto por pagar) o investigar la causación.',
    });
  }

  // -------------------------------------------------------------------------
  // V8 — IFRS 18 mencionada en informe de Grupo 2 o 3.
  // -------------------------------------------------------------------------
  if (company.niifGroup !== 1 && reportMencionaIFRS18(reportText)) {
    blockers.push({
      code: 'V8',
      message:
        'V8: IFRS 18 referenciada en informe de Grupo ' +
        `${company.niifGroup} (sólo aplica a Grupo 1). Eliminar las referencias del informe.`,
    });
  }

  // -------------------------------------------------------------------------
  // V9 — reserva legal SAS sin habilitación estatutaria.
  // -------------------------------------------------------------------------
  if (
    company.tipoSocietario === 'SAS' &&
    company.estatutosRequierenReservaLegal !== true &&
    reportConstituyeReservaLegal(reportText)
  ) {
    blockers.push({
      code: 'V9',
      message:
        'V9: reserva legal SAS constituida sin habilitación estatutaria. La Ley 1258/2008 ' +
        'NO obliga a las SAS a constituir reserva legal (Supersociedades Oficios 220-115333/2009 ' +
        'y 220-069664/2017). Sólo si los estatutos lo prevén explícitamente.',
    });
  }

  // -------------------------------------------------------------------------
  // V10 — TMT 15% calculada en el informe del Strategy Director.
  // Sólo aplica al régimen ordinario (no SIMPLE / no Zona Franca).
  // -------------------------------------------------------------------------
  if (!reportIncluyeTMTCalculada(reportText)) {
    blockers.push({
      code: 'V10',
      message:
        'V10: TMT (Tasa Mínima de Tributación, 15%, parágrafo 6 Art. 240 E.T.) NO calculada ' +
        'en el informe. Debe calcularse SIEMPRE: tarifa general 35% sobre renta líquida fiscal ' +
        'vs. TMT 15% sobre utilidad contable depurada — tomar el mayor.',
    });
  }

  // -------------------------------------------------------------------------
  // V11 — causación impuesto del periodo verificada (R10).
  // -------------------------------------------------------------------------
  if (snapshot.findings?.missingTaxCausation === true) {
    blockers.push({
      code: 'V11',
      message:
        'V11: causación impuesto del periodo no verificada en BP. Grupo 54xx (gasto impuesto) ' +
        '> 0 pero grupo 24xx (impuestos por pagar) ≈ 0. Pasar el asiento Dr. 5405 / Cr. 2404.',
    });
  }

  // -------------------------------------------------------------------------
  // V13 — signo del impuesto de renta (NIIF for SMEs §29.27 + E.T. art. 850).
  // El gasto por impuesto causado del periodo es siempre DÉBITO en P&L
  // (≥ 0n). Si el cierre tributario produjo saldo a favor, va a 1355 / 1805
  // separado en el activo (campo `saldoAFavorImpuesto`), nunca neteado contra
  // el causado del periodo. Un valor `< 0` significa que el reporte presenta
  // el impuesto como ingreso (crédito), lo que viola la presentación NIIF.
  // -------------------------------------------------------------------------
  if (cents && cents.impuestoCausado < CENTS_TOLERANCE_ZERO) {
    blockers.push({
      code: 'V13',
      message:
        'V13: gasto por impuesto de renta presentado con signo crédito. ' +
        'NIIF for SMEs §29.27 + E.T. art. 850 exigen presentación como gasto débito; ' +
        'si el periodo cerró con saldo a favor, va a cuenta 1355/1805 en el activo, ' +
        'no se neta contra el causado en P&L.',
      detail: `impuestoCausado=${formatBigCents(cents.impuestoCausado)}`,
    });
  }

  // -------------------------------------------------------------------------
  // V14 — margen bruto > 80% en CIIU G con costos no descargados.
  // Se dispara cuando la actividad inferida es Comercio (sector G) Y la
  // evidencia de la inferencia incluye que la Clase 6 (Costo de Ventas) está
  // ausente o es inmaterial. Esa combinación es la huella exacta del costeo
  // incompleto que NIIF for SMEs §13.20 prohíbe (el costo se reconoce como
  // gasto al momento de la venta) y dispara salvedad NIA 705 §7.
  //
  // La lógica reusa el detector ampliado de A en `inferActividadFromSnapshot`
  // — el gate NO recalcula margen bruto: confía en la evidencia ya validada.
  // -------------------------------------------------------------------------
  if (elite?.actividadInferida?.sectorCIIU === 'G') {
    const evidenciaCosteoIncompleto = elite.actividadInferida.evidencia.some(
      (e) => /clase\s*6.*ausente/i.test(e) || /clase\s*6.*inmaterial/i.test(e),
    );
    if (evidenciaCosteoIncompleto) {
      blockers.push({
        code: 'V14',
        message:
          'V14: actividad comercial (CIIU G) con costo de ventas no descargado. ' +
          'NIIF for SMEs §13.20 exige reconocer el costo como gasto cuando se vende; ' +
          'omitirlo infla utilidad e inventario simultáneamente. La opinión limpia no es ' +
          'defendible — el revisor fiscal debe emitir salvedad NIA 705 §7 (o adversa §8 ' +
          'si el efecto es generalizado), nunca énfasis NIA 706 (§7 lo prohíbe expresamente).',
        detail: elite.actividadInferida.evidencia.join(' | '),
      });
    }
  }

  // -------------------------------------------------------------------------
  // V15 — comparativos impracticables sin declaración explícita.
  // Si el preprocesador detectó que NO hay periodo comparativo material
  // (`comparativos_impracticables===true`), el reporte DEBE declarar la
  // impracticabilidad NIIF for SMEs §3.14 / §10.21 explícitamente en notas.
  // Si el reporte presenta una columna 2024 con números sin esta declaración,
  // es manipulación contable: §10.19 prohíbe reconstruir cuentas individuales
  // desde Utilidades Retenidas.
  // -------------------------------------------------------------------------
  if (elite?.comparativos_impracticables === true) {
    const declaresImpracticabilidad =
      /\bimpracticabl[ei]\b/i.test(reportText) ||
      /§\s*3\.14/i.test(reportText) ||
      /§\s*10\.21/i.test(reportText) ||
      /sin\s+comparativos\s+del\s+periodo\s+(2024|anterior)/i.test(reportText);

    if (!declaresImpracticabilidad) {
      blockers.push({
        code: 'V15',
        message:
          'V15: el preprocesador detectó que no hay comparativos materiales del periodo ' +
          'anterior, pero el informe NO declara impracticabilidad NIIF for SMEs §3.14 / §10.21. ' +
          'Reconstruir cuentas individuales desde Utilidades Retenidas viola §10.19 (es ' +
          'manipulación). Declarar la impracticabilidad explícitamente en notas, o presentar ' +
          'comparativos reales obtenidos de los libros de 2024.',
      });
    }
  }

  return {
    emittable: blockers.length === 0,
    blockers,
    suggestedAdjustments: Array.from(new Set(suggestedAdjustments)),
  };
}

// ---------------------------------------------------------------------------
// Helpers de inspección del reporte (regex sobre el markdown consolidado)
// ---------------------------------------------------------------------------

export function reportMencionaIFRS18(reportText: string): boolean {
  if (!reportText) return false;
  return /\bIFRS\s*18\b/i.test(reportText);
}

const RESERVA_LEGAL_REGEX =
  /(constituci[oó]n|constituye|aplicaci[oó]n|aplicar|apropiar|apropiaci[oó]n|asignaci[oó]n)\s+(?:la\s+|una\s+|de\s+(?:la\s+)?)?reserva\s+legal/i;

export function reportConstituyeReservaLegal(reportText: string): boolean {
  if (!reportText) return false;
  // Detectamos una constitución activa, no cualquier mención. Si aparece
  // "Art. 40 Ley 1258" referenciado como obligación, también es flag rojo.
  if (/Art\.?\s*40\s+Ley\s+1258/i.test(reportText)) return true;
  return RESERVA_LEGAL_REGEX.test(reportText);
}

export function reportIncluyeTMTCalculada(reportText: string): boolean {
  if (!reportText) return false;
  // Heurística: el informe debe mencionar "TMT" o "Tasa Mínima" o "tasa mínima"
  // o "15%" en contexto de tributación o "parágrafo 6". Aceptamos cualquier
  // de estas variantes.
  const indicators = [
    /\bTMT\b/i,
    /tasa\s+m[ií]nima/i,
    /par[aá]grafo\s+6\s+(del\s+)?art(\.|[ií]culo)\s+240/i,
    /tributaci[oó]n\s+m[ií]nima/i,
  ];
  return indicators.some((re) => re.test(reportText));
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

function formatBigCents(cents: bigint): string {
  const ZERO = BigInt(0);
  const HUNDRED = BigInt(100);
  const negative = cents < ZERO;
  const abs = negative ? -cents : cents;
  const integer = abs / HUNDRED;
  const fraction = abs % HUNDRED;
  return `${negative ? '-$' : '$'}${integer.toString()}.${fraction.toString().padStart(2, '0')} COP`;
}
