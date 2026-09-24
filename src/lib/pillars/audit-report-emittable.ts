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
//     menciones a IFRS 18, reserva legal SAS, la TTD (Art. 240 par. 6) y placeholders
//     prohibidos ("Triple SSS", "213.092.082-1").
//
// El gate se inyecta en `src/lib/agents/financial/orchestrator.ts` justo
// antes del `return report` final.
// ---------------------------------------------------------------------------

import type { FinancialReport } from '@/lib/agents/financial/types';
import type { ExtractedCompanyMetadata, PeriodSnapshot, ActividadInferida, ReclasificacionNoCompensacion } from '@/lib/preprocessing/trial-balance';
import { validateNITCheckDigit } from '@/lib/validation/nit-validator';
import { buildDeterministicCashFlow } from '@/lib/agents/financial/contracts/deterministic-breakdown';
import { formatCopFromCents } from '@/lib/agents/financial/contracts/money';

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

/** Opciones del gate. */
export interface AuditReportEmittableOptions {
  /**
   * Omite los checks que dependen del TEXTO del informe consolidado (V8, V9,
   * V10, V15). Se usa en el modo PRE-VUELO, que corre en
   * `prepareFinancialContext` —Stage 0, antes de que exista informe alguno—
   * para bloquear de entrada los balances que nunca van a producir un informe
   * emitible.
   *
   * Sin esta opción el pre-vuelo dispararía V10 siempre (la TTD la declara el
   * Strategy Director, que aún no ha corrido) y V15 en todo balance de un solo
   * periodo (la declaración de impracticabilidad la redacta el Analista NIIF),
   * y el gate perdería toda credibilidad justo donde más falta hace. Quien usa
   * el pre-vuelo evalúa esos checks después, sobre el texto real (ver
   * `checkComparativosImpracticablesDeclaration`).
   */
  skipReportTextChecks?: boolean;
  /**
   * Snapshot del periodo comparativo. Habilita V3 sobre el EFE DETERMINISTA
   * (`buildDeterministicCashFlow`), la única fuente vinculante del EFE.
   *
   * Sin comparativo V3 no se evalúa: no hay saldo de apertura contra el cual
   * medir variaciones (NIC 7 ¶1). El EFE del curator R2
   * (`snapshot.cashFlowIndirecto`) NO se usa como sustituto — arranca de la
   * utilidad acumulada y produce bloqueantes falsos (recalculo-11).
   */
  comparativeSnapshot?: PeriodSnapshot | null;
}

/**
 * V3 — el EFE determinista concilia con la variación del PUC 11 al centavo.
 *
 * Exportada para que el orquestador la evalúe tras Stage 0 con los dos
 * snapshots, la misma función que usa el gate completo.
 */
export function checkDeterministicCashFlowV3(
  primary: PeriodSnapshot,
  comparative: PeriodSnapshot | null | undefined,
): AuditBlocker | null {
  if (!comparative) return null;
  const efe = buildDeterministicCashFlow(primary, comparative);
  if (!efe || efe.reconciled) return null;
  return {
    code: 'V3',
    message:
      `V3: el EFE determinista (${efe.comparativePeriod} → ${efe.primaryPeriod}) no concilia con la ` +
      `variación de la cuenta 11 (diferencia = ${formatBigCents(efe.reconciliationGapCents)}). ` +
      'Revisar la ecuación patrimonial de ambos periodos (NIC 7 ¶45).',
  };
}

/** Año del periodo anterior al que se firma, o `null` si el periodo no trae año. */
function priorPeriodLabel(primaryPeriod: string | undefined): string | null {
  const year = /(\d{4})/.exec(primaryPeriod ?? '')?.[1];
  return year ? String(Number(year) - 1) : null;
}

/**
 * V15 — el informe declara la impracticabilidad de los comparativos (NIIF para
 * las PYMES §3.14 / §10.21) cuando el preprocesador la detectó.
 *
 * Depende del TEXTO del informe: sólo tiene sentido evaluarla cuando ese texto
 * existe. Exportada para que el orquestador la corra después del Analista
 * NIIF sobre el contenido real, no en el pre-vuelo de Stage 0.
 */
export function checkComparativosImpracticablesDeclaration(
  reportText: string,
  elite: EmittableEliteContext | undefined,
  primaryPeriod: string | undefined,
): AuditBlocker | null {
  if (elite?.comparativos_impracticables !== true) return null;
  const text = reportText ?? '';
  // "Sección 3.14" / "párrafo 10.21" sin "§" también son declaración
  // (prompts-normativa-23). "10.21" sólo cuenta como número aislado: dentro de
  // una cifra ("$10.210.000") no es una cita.
  const declaresImpracticabilidad =
    /\bimpracticabl[ei]\b/i.test(text) ||
    /§\s*3\.14/i.test(text) ||
    /§\s*10\.21/i.test(text) ||
    /Secci[oó]n(?:es)?\s*3\.14(?![\d.]\d)/i.test(text) ||
    /(?<![\d.])10\.21(?![\d.]?\d)/.test(text) ||
    /sin\s+comparativos\s+del\s+periodo\s+(\d{4}|anterior)/i.test(text);
  if (declaresImpracticabilidad) return null;

  const prior = priorPeriodLabel(primaryPeriod);
  const priorBooks = prior ? `los libros del periodo ${prior}` : 'los libros del periodo anterior';
  return {
    code: 'V15',
    message:
      'V15: el preprocesador detectó que no hay comparativos materiales del periodo ' +
      'anterior, pero el informe NO declara impracticabilidad NIIF for SMEs §3.14 / §10.21. ' +
      'Reconstruir cuentas individuales desde Utilidades Retenidas viola §10.19 (es ' +
      'manipulación). Declarar la impracticabilidad explícitamente en notas, o presentar ' +
      `comparativos reales obtenidos de ${priorBooks}.`,
  };
}

export function auditReportEmittable(
  report: FinancialReport,
  snapshot: PeriodSnapshot,
  company: AuditCompanyContext,
  elite?: EmittableEliteContext,
  options: AuditReportEmittableOptions = {},
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
    // recalculo-03: con el comparativo sin cerrar (R12 `pygAcumulado`) la causa
    // no es un traslado pendiente del año sino un P&G posiblemente ACUMULADO;
    // el mensaje nombra el periodo no cerrado y el resultado alternativo.
    const pyg = snapshot.closingDetectorAudit?.pygAcumulado;
    blockers.push({
      code: 'V12',
      message: pyg
        ? `V12: P&G posiblemente acumulado: el periodo ${pyg.comparativePeriod} no se cerró; ` +
          `resultado del ejercicio alternativo ${formatCanonicalCop(pyg.utilidadMovimientoRaw)} ` +
          `(saldo final − saldo ${pyg.comparativePeriod}). Pasar el asiento de cierre de ` +
          `${pyg.comparativePeriod} o cargar el balance con el P&G del ejercicio antes de re-procesar.`
        : 'V12: libros no cerrados — utilidad del ejercicio sin trasladar al patrimonio. ' +
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
  // Se evalúa sobre el EFE DETERMINISTA (la misma fuente que el prompt declara
  // vinculante), nunca sobre el EFE del curator R2: R2 arranca de la utilidad
  // acumulada y, en el balance real de la auditoría, dejaba una brecha de
  // $1.559.097.749,11 que el determinista no tiene (recalculo-11). Sin
  // comparativo V3 no aplica (NIC 7 ¶1: sin saldo de apertura no hay EFE).
  // -------------------------------------------------------------------------
  const v3 = checkDeterministicCashFlowV3(snapshot, options.comparativeSnapshot);
  if (v3) blockers.push(v3);

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
  if (
    !options.skipReportTextChecks &&
    company.niifGroup !== 1 &&
    reportMencionaIFRS18(reportText)
  ) {
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
    !options.skipReportTextChecks &&
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
  // V10 — el informe aborda la Tasa de Tributación Depurada (Art. 240 par. 6).
  // Regla del corpus (estatuto_tributario_completo.md, par. 6 Art. 240):
  // TTD = ID / UD; si es < 15 % se liquida IA = UD × 15 % − ID. Sin ID/UD
  // verificados la TTD es N/D con motivo: la UAI contable no es base fiscal
  // (re-auditoría 2026-09, NM-13 — el mensaje anterior pedía «TMT 15 % sobre
  // utilidad contable depurada — tomar el mayor»).
  // -------------------------------------------------------------------------
  if (!options.skipReportTextChecks && !reportIncluyeTMTCalculada(reportText)) {
    blockers.push({
      code: 'V10',
      message:
        'V10: el informe no aborda la Tasa de Tributación Depurada (TTD, parágrafo 6 Art. 240 E.T.). ' +
        'TTD = ID / UD (impuesto depurado / utilidad depurada); si resulta inferior al 15% se ' +
        'liquida un impuesto a adicionar IA = UD × 15% − ID. Sin ID y UD verificados la TTD se ' +
        'declara N/D con motivo: la utilidad contable (UAI) no es base fiscal ni sustituye la UD.',
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
  // Si el reporte presenta una columna comparativa con números sin esta
  // declaración, es manipulación contable: §10.19 prohíbe reconstruir cuentas
  // individuales desde Utilidades Retenidas.
  //
  // Depende del TEXTO: en el pre-vuelo (`skipReportTextChecks`) todavía no hay
  // informe y evaluarla sobre '' sellaba todo balance de un solo periodo
  // (pipeline-flujo-02). Quien corre el pre-vuelo la evalúa después, sobre el
  // texto del Analista NIIF.
  // -------------------------------------------------------------------------
  if (!options.skipReportTextChecks) {
    const v15 = checkComparativosImpracticablesDeclaration(reportText, elite, snapshot.period);
    if (v15) blockers.push(v15);
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

/**
 * ¿El informe aborda la Tasa de Tributación Depurada (Art. 240 par. 6 E.T.)?
 * Heurística de mención: acepta la terminología canónica del repo («Tasa de
 * Tributación Depurada», «TTD», «Art. 240 par. 6» en cualquier orden) y la
 * histórica («TMT», «tasa mínima», «tributación mínima»). No valida la cifra:
 * sin ID/UD verificados lo correcto es declararla N/D.
 */
export function reportIncluyeTMTCalculada(reportText: string): boolean {
  if (!reportText) return false;
  const indicators = [
    /\bTTD\b/,
    /tributaci[oó]n\s+depurada/i,
    /\bTMT\b/i,
    /tasa\s+m[ií]nima/i,
    /tributaci[oó]n\s+m[ií]nima/i,
    /par[aá]grafo\s+6\s+(del\s+)?art(\.|[ií]culo)\s+240/i,
    /art(\.|[ií]culo)\s*240,?\s+par(\.|[aá]grafo)\s*6\b/i,
  ];
  return indicators.some((re) => re.test(reportText));
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/** Cifra canónica de centavos exactos (`-?\d+\.\d{2}`) en formato COP; N/D si no lo es. */
function formatCanonicalCop(raw: string): string {
  const m = /^(-?)(\d+)\.(\d{2})$/.exec(raw ?? '');
  if (!m) return 'N/D';
  const cents = BigInt(`${m[1]}${m[2]}${m[3]}`);
  return formatCopFromCents(cents, false);
}

function formatBigCents(cents: bigint): string {
  const ZERO = BigInt(0);
  const HUNDRED = BigInt(100);
  const negative = cents < ZERO;
  const abs = negative ? -cents : cents;
  const integer = abs / HUNDRED;
  const fraction = abs % HUNDRED;
  return `${negative ? '-$' : '$'}${integer.toString()}.${fraction.toString().padStart(2, '0')} COP`;
}
