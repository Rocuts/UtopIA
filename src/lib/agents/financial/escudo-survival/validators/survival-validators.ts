// ---------------------------------------------------------------------------
// Survival Validators — Elite Protocol 3 capas
// ---------------------------------------------------------------------------
// Cero LLM. Cero red. Cero filesystem. Solo TypeScript + Math.
// Detecta errores aritméticos, inconsistencias de negocio y violaciones
// normativas (Art. 647 E.T.) antes de que el reporte llegue al usuario.
// ---------------------------------------------------------------------------

import type { PreprocessedBalance, PUCClass, ValidatedAccount } from '@/lib/preprocessing/trial-balance';
import type {
  EscudoSurvivalReport,
  CashPaymentViolation,
  OptimizationSuggestion,
  RetentionAction,
} from '../types';
import { UVT_2026, TOPE_INDIVIDUAL_UVT, TET_ALERTA_ROJA } from '../types';

// ---------------------------------------------------------------------------
// Tolerancias (constantes explícitas — no magic numbers)
// ---------------------------------------------------------------------------

const TOLERANCE_PESOS = 1; // suma exacta: diferencia ≤ $1 COP
const TOLERANCE_PCT = 0.01; // 1% para validaciones de orden de magnitud
const TOLERANCE_CASH_FLOW = 0.05; // 5% para coherencia caja vs utilidad
const TOLERANCE_TET = 0.001; // 0.1 pp para reconciliación de ratio TET

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export type Severity = 'error' | 'warning';
export type LayerName = 'aritmetica' | 'logicaNegocio' | 'defensaTributaria';

export interface CheckResult {
  name: string;
  passed: boolean;
  detail?: string;
  severity: Severity;
  /** Requerido para defensaTributaria; INTERNAL para buenas prácticas sin norma expresa */
  norma?: string;
}

export interface LayerResult {
  ok: boolean;
  checks: CheckResult[];
}

export interface StressTestResult {
  passed: boolean;
  detail: string;
}

export interface SurvivalValidationResult {
  ok: boolean;
  /** Hard fails: capa 1 errors + capa 3 errors */
  errors: string[];
  /** Soft: capa 2 warnings */
  warnings: string[];
  stressTests: {
    auxiliaresVsResumen: StressTestResult;
    coherenciaCajaUtilidad: StressTestResult;
    defensaArt647: StressTestResult;
  };
  layers: {
    aritmetica: LayerResult;
    logicaNegocio: LayerResult;
    defensaTributaria: LayerResult;
  };
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

function formatCop(n: number): string {
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return (n < 0 ? '-$' : '$') + formatted;
}

function formatPct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

/**
 * Suma los saldos de todas las cuentas de una clase PUC que sean hojas
 * (isLeaf = true) y cuyo código comience con el prefijo dado.
 */
function sumLeafAccountsByPrefix(pucClass: PUCClass, prefix: string): number {
  return pucClass.accounts
    .filter((a: ValidatedAccount) => a.isLeaf && a.code.startsWith(prefix))
    .reduce((acc: number, a: ValidatedAccount) => acc + a.balance, 0);
}

/**
 * Encuentra una clase PUC por su código numérico (primer dígito = número de clase).
 */
function findClass(classes: PUCClass[], classCode: number): PUCClass | undefined {
  return classes.find((c) => c.code === classCode);
}

// ---------------------------------------------------------------------------
// CAPA 1 — Aritmética (cero LLM, sólo matemáticas)
// ---------------------------------------------------------------------------

function runLayer1(
  report: EscudoSurvivalReport,
  preprocessed: PreprocessedBalance,
): LayerResult {
  const checks: CheckResult[] = [];
  const classes = preprocessed.primary.classes;

  // -----------------------------------------------------------------------
  // C1.1 — tet_calculada_reconcilia
  // -----------------------------------------------------------------------
  {
    const { tet, uai, impuestoProyectado } = report.tet.data;

    if (uai === 0) {
      checks.push({
        name: 'tet_calculada_reconcilia',
        passed: true,
        severity: 'warning',
        detail:
          'UAI = 0: la empresa no tiene utilidad antes de impuestos en el periodo. ' +
          'TET no es aplicable; se omite la validación de ratio (no es error).',
      });
    } else {
      const tetEsperada = impuestoProyectado / Math.max(Math.abs(uai), 1);
      const diff = Math.abs(tet - tetEsperada);

      if (diff > TOLERANCE_TET) {
        checks.push({
          name: 'tet_calculada_reconcilia',
          passed: false,
          severity: 'error',
          detail:
            `TET reportada ${formatPct(tet)} no reconcilia con impuestoProyectado/uai = ` +
            `${formatPct(tetEsperada)} ` +
            `(impuesto=${formatCop(impuestoProyectado)}, uai=${formatCop(uai)}, ` +
            `diff=${(diff * 100).toFixed(3)} pp; tolerancia 0.1 pp).`,
        });
      } else {
        checks.push({
          name: 'tet_calculada_reconcilia',
          passed: true,
          severity: 'error',
          detail:
            `TET=${formatPct(tet)} concilia con impuesto/uai=${formatPct(tetEsperada)} ` +
            `(diff=${(diff * 100).toFixed(3)} pp ≤ 0.1 pp).`,
        });
      }
    }
  }

  // -----------------------------------------------------------------------
  // C1.2 — retencionesAcumuladas_suma_subcuentas
  // -----------------------------------------------------------------------
  {
    const reportedRetenciones = report.retentionShield.data.retencionesAcumuladas;

    // Cuenta 1355 — Anticipo de impuestos y contribuciones (retenciones a favor)
    // Buscar cuentas 13550* (subcuentas postables de 1355)
    const class1 = findClass(classes, 1);
    let sumaRetenciones = 0;

    if (class1) {
      // Cuentas de 6 dígitos que comienzan con 1355
      const retCuentas = class1.accounts.filter(
        (a) => a.isLeaf && a.code.startsWith('1355'),
      );
      sumaRetenciones = retCuentas.reduce((s, a) => s + a.balance, 0);

      // Si no hay auxiliares 1355.* postables, usar el saldo de la cuenta 1355 misma
      if (sumaRetenciones === 0) {
        const cta1355 = class1.accounts.find((a) => a.code === '1355');
        if (cta1355) sumaRetenciones = cta1355.balance;
      }
    }

    const diff = Math.abs(reportedRetenciones - sumaRetenciones);

    // Sólo validamos si hay algo en el balance (si sumaRetenciones = 0 y
    // reportedRetenciones > 0, el agente extrajo de texto libre — advertir
    // pero no fallar duro, pues el balance puede no traer cuenta 1355)
    if (sumaRetenciones === 0 && reportedRetenciones > 0) {
      checks.push({
        name: 'retencionesAcumuladas_suma_subcuentas',
        passed: true,
        severity: 'warning',
        detail:
          `Cuenta 1355 no encontrada en el balance preprocesado. ` +
          `El agente reporta ${formatCop(reportedRetenciones)} basado en texto libre del balance. ` +
          `Verificar que el archivo incluya la cuenta 1355 con sus auxiliares.`,
      });
    } else if (diff > TOLERANCE_PESOS) {
      checks.push({
        name: 'retencionesAcumuladas_suma_subcuentas',
        passed: false,
        severity: 'error',
        detail:
          `Retenciones acumuladas: reportado ${formatCop(reportedRetenciones)} ≠ ` +
          `suma auxiliares 1355 en balance ${formatCop(sumaRetenciones)} ` +
          `(diferencia ${formatCop(diff)}; tolerancia ${formatCop(TOLERANCE_PESOS)}).`,
      });
    } else {
      checks.push({
        name: 'retencionesAcumuladas_suma_subcuentas',
        passed: true,
        severity: 'error',
        detail:
          `Retenciones acumuladas ${formatCop(reportedRetenciones)} concilia con ` +
          `suma auxiliares 1355 en balance ${formatCop(sumaRetenciones)} ` +
          `(diff ${formatCop(diff)} ≤ ${formatCop(TOLERANCE_PESOS)}).`,
      });
    }
  }

  // -----------------------------------------------------------------------
  // C1.3 — pagosNoDeducibles_listado_suma
  // -----------------------------------------------------------------------
  {
    const { pagosNoDeduciblesIndividuales, pagosEfectivoTotal } =
      report.antiDian.data;

    if (pagosNoDeduciblesIndividuales.length > 0) {
      const sumaIndividuales = pagosNoDeduciblesIndividuales.reduce(
        (s: number, v: CashPaymentViolation) => s + v.monto,
        0,
      );

      // Los pagos individuales no deducibles son un subconjunto del total efectivo.
      // Verificar que la suma de individuales ≤ total efectivo (con tolerancia).
      const exceso = sumaIndividuales - pagosEfectivoTotal;
      if (exceso > TOLERANCE_PESOS) {
        checks.push({
          name: 'pagosNoDeducibles_listado_suma',
          passed: false,
          severity: 'error',
          detail:
            `Suma de pagos no deducibles individuales (${formatCop(sumaIndividuales)}) ` +
            `excede el total de pagos en efectivo (${formatCop(pagosEfectivoTotal)}) ` +
            `en ${formatCop(exceso)}. Los individuales deben ser subconjunto del total.`,
        });
      } else {
        checks.push({
          name: 'pagosNoDeducibles_listado_suma',
          passed: true,
          severity: 'error',
          detail:
            `Suma individuales ${formatCop(sumaIndividuales)} ≤ total efectivo ` +
            `${formatCop(pagosEfectivoTotal)}: listado internamente consistente.`,
        });
      }
    } else {
      checks.push({
        name: 'pagosNoDeducibles_listado_suma',
        passed: true,
        severity: 'error',
        detail: 'Sin pagos no deducibles individuales listados — nada que sumar.',
      });
    }
  }

  // -----------------------------------------------------------------------
  // C1.4 — reservaSugerida_es_10pct_utilidadNeta
  // -----------------------------------------------------------------------
  {
    const { reservaSugerida, utilidadNeta } = report.contingencyReserve.data;
    const esperada = 0.1 * utilidadNeta;
    const diff = Math.abs(reservaSugerida - esperada);

    if (diff > TOLERANCE_PESOS) {
      checks.push({
        name: 'reservaSugerida_es_10pct_utilidadNeta',
        passed: false,
        severity: 'error',
        detail:
          `Reserva sugerida ${formatCop(reservaSugerida)} ≠ 10% de utilidad neta ` +
          `${formatCop(utilidadNeta)} = ${formatCop(esperada)} ` +
          `(diferencia ${formatCop(diff)}; tolerancia ${formatCop(TOLERANCE_PESOS)}).`,
      });
    } else {
      checks.push({
        name: 'reservaSugerida_es_10pct_utilidadNeta',
        passed: true,
        severity: 'error',
        detail:
          `Reserva ${formatCop(reservaSugerida)} = 10% × ${formatCop(utilidadNeta)} = ` +
          `${formatCop(esperada)} (diff ${formatCop(diff)} ≤ ${formatCop(TOLERANCE_PESOS)}).`,
      });
    }
  }

  // -----------------------------------------------------------------------
  // C1.5 — mayorImpuesto_es_35pct_excedente
  // -----------------------------------------------------------------------
  {
    const { mayorImpuestoEstimado, pagosNoDeduciblesIndividuales, excesoNoDeducibleGeneral } =
      report.antiDian.data;

    // El mayor impuesto estimado = 35% del total de pagos no deducibles
    // (suma de individuales + exceso general, sin doble contar)
    const sumaIndividuales = pagosNoDeduciblesIndividuales.reduce(
      (s: number, v: CashPaymentViolation) => s + v.monto,
      0,
    );
    const totalNoDeducible = Math.max(sumaIndividuales, excesoNoDeducibleGeneral);
    const expectedMayor = 0.35 * totalNoDeducible;

    if (totalNoDeducible === 0) {
      // Si no hay pagos no deducibles, el mayor impuesto debe ser 0
      if (Math.abs(mayorImpuestoEstimado) > TOLERANCE_PESOS) {
        checks.push({
          name: 'mayorImpuesto_es_35pct_excedente',
          passed: false,
          severity: 'error',
          detail:
            `Mayor impuesto reportado ${formatCop(mayorImpuestoEstimado)} pero no hay ` +
            `pagos no deducibles (suma individuales=0, exceso general=0). Debe ser $0.`,
        });
      } else {
        checks.push({
          name: 'mayorImpuesto_es_35pct_excedente',
          passed: true,
          severity: 'error',
          detail: 'Sin pagos no deducibles → mayor impuesto estimado = $0. Correcto.',
        });
      }
    } else {
      const diff = Math.abs(mayorImpuestoEstimado - expectedMayor);
      const pct = expectedMayor > 0 ? diff / expectedMayor : 0;

      if (pct > TOLERANCE_PCT) {
        checks.push({
          name: 'mayorImpuesto_es_35pct_excedente',
          passed: false,
          severity: 'error',
          detail:
            `Mayor impuesto estimado ${formatCop(mayorImpuestoEstimado)} ≠ ` +
            `35% × no-deducible (${formatCop(totalNoDeducible)}) = ${formatCop(expectedMayor)} ` +
            `(diff ${formatCop(diff)}, ${formatPct(pct)}; tolerancia ${formatPct(TOLERANCE_PCT)}).`,
        });
      } else {
        checks.push({
          name: 'mayorImpuesto_es_35pct_excedente',
          passed: true,
          severity: 'error',
          detail:
            `Mayor impuesto ${formatCop(mayorImpuestoEstimado)} ≈ 35% × ${formatCop(totalNoDeducible)} ` +
            `= ${formatCop(expectedMayor)} (diff ${formatCop(diff)}, ${formatPct(pct)} ≤ ${formatPct(TOLERANCE_PCT)}).`,
        });
      }
    }
  }

  // -----------------------------------------------------------------------
  // C1.6 — dividend_escenarios_capitalizar_tieneCero
  // -----------------------------------------------------------------------
  {
    const impuestoCapitalizar =
      report.dividendOptimizer.data.escenarios.capitalizarTotal.impuestoSocio;

    if (impuestoCapitalizar !== 0) {
      checks.push({
        name: 'dividend_escenarios_capitalizar_tieneCero',
        passed: false,
        severity: 'error',
        detail:
          `Escenario capitalización: impuestoSocio = ${formatCop(impuestoCapitalizar)} ` +
          `pero debe ser $0 (capitalización es INCRGNO según Art. 36-3 E.T. — ` +
          `ingreso no constitutivo de renta ni ganancia ocasional, sin tributación al socio).`,
      });
    } else {
      checks.push({
        name: 'dividend_escenarios_capitalizar_tieneCero',
        passed: true,
        severity: 'error',
        detail:
          'Escenario capitalización: impuestoSocio = $0 (INCRGNO Art. 36-3 E.T.). Correcto.',
      });
    }
  }

  const hardFails = checks.filter((c) => c.severity === 'error' && !c.passed);
  return { ok: hardFails.length === 0, checks };
}

// ---------------------------------------------------------------------------
// CAPA 2 — Lógica de negocio
// ---------------------------------------------------------------------------

function runLayer2(
  report: EscudoSurvivalReport,
  // preprocessed reserved for future layer-2 checks that cross-reference the balance
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _preprocessed: PreprocessedBalance,
): LayerResult {
  const checks: CheckResult[] = [];

  // -----------------------------------------------------------------------
  // C2.1 — tet_alta_genera_optimizaciones
  // -----------------------------------------------------------------------
  {
    const { nivelAlerta, sugerenciasOptimizacion } = report.tet.data;

    if (nivelAlerta === 'rojo') {
      const tieneAltaMedia = sugerenciasOptimizacion.some(
        (s: OptimizationSuggestion) => s.factibilidad === 'alta' || s.factibilidad === 'media',
      );

      if (sugerenciasOptimizacion.length < 1 || !tieneAltaMedia) {
        checks.push({
          name: 'tet_alta_genera_optimizaciones',
          passed: false,
          severity: 'error',
          detail:
            `TET en zona roja (> ${TET_ALERTA_ROJA * 100}%) pero hay ` +
            `${sugerenciasOptimizacion.length} sugerencias de optimización ` +
            `(${sugerenciasOptimizacion.filter((s: OptimizationSuggestion) => s.factibilidad === 'alta' || s.factibilidad === 'media').length} de alta/media factibilidad). ` +
            `Se requiere al menos 1 con factibilidad 'alta' o 'media' (Arts. 255-257 E.T., Art. 115 E.T.).`,
        });
      } else {
        checks.push({
          name: 'tet_alta_genera_optimizaciones',
          passed: true,
          severity: 'error',
          detail:
            `TET roja → ${sugerenciasOptimizacion.length} sugerencias, ` +
            `${sugerenciasOptimizacion.filter((s: OptimizationSuggestion) => s.factibilidad === 'alta' || s.factibilidad === 'media').length} de alta/media factibilidad. Correcto.`,
        });
      }
    } else {
      checks.push({
        name: 'tet_alta_genera_optimizaciones',
        passed: true,
        severity: 'error',
        detail: `TET en nivel '${nivelAlerta}' — check de optimizaciones no aplica (no es alerta roja).`,
      });
    }
  }

  // -----------------------------------------------------------------------
  // C2.2 — saldo_favor_genera_acciones
  // -----------------------------------------------------------------------
  {
    const { saldoAFavorProyectado, acciones } = report.retentionShield.data;

    if (saldoAFavorProyectado > 0) {
      if (acciones.length < 1) {
        checks.push({
          name: 'saldo_favor_genera_acciones',
          passed: false,
          severity: 'error',
          detail:
            `Saldo a favor proyectado ${formatCop(saldoAFavorProyectado)} pero ` +
            `acciones[].length = 0. Debe haber al menos 1 acción concreta ` +
            `(certif. no retención, autorretenedor, compensación o devolución).`,
        });
      } else {
        checks.push({
          name: 'saldo_favor_genera_acciones',
          passed: true,
          severity: 'error',
          detail:
            `Saldo a favor ${formatCop(saldoAFavorProyectado)} → ${acciones.length} acción(es) definidas. Correcto.`,
        });
      }
    } else {
      checks.push({
        name: 'saldo_favor_genera_acciones',
        passed: true,
        severity: 'error',
        detail: `Sin saldo a favor proyectado (${formatCop(saldoAFavorProyectado)}) — check no aplica.`,
      });
    }
  }

  // -----------------------------------------------------------------------
  // C2.3 — bancarizacion_violada_listada
  // -----------------------------------------------------------------------
  {
    const { pagosEfectivoTotal, pagosNoDeduciblesIndividuales } = report.antiDian.data;
    const topeIndividual = TOPE_INDIVIDUAL_UVT * UVT_2026; // $5.237.400 COP

    // Si hay pagos totales en efectivo > 0, verificar que los pagos individuales
    // que superen 100 UVT estén listados.
    // Heurística: si pagosEfectivoTotal > topeIndividual × 3, es plausible que
    // haya pagos individuales; si el listado está vacío, es sospechoso.
    if (pagosEfectivoTotal > topeIndividual) {
      const tieneListados = pagosNoDeduciblesIndividuales.length > 0;
      const todosConNorma = pagosNoDeduciblesIndividuales.every(
        (v: CashPaymentViolation) => v.norma === 'Art. 771-5 §2 E.T.',
      );

      if (!tieneListados) {
        checks.push({
          name: 'bancarizacion_violada_listada',
          passed: false,
          severity: 'warning',
          detail:
            `Pagos en efectivo total ${formatCop(pagosEfectivoTotal)} supera tope individual ` +
            `100 UVT (${formatCop(topeIndividual)}) pero pagosNoDeduciblesIndividuales[] está vacío. ` +
            `Si hay pagos a un mismo beneficiario > 100 UVT, deben aparecer listados (Art. 771-5 §2 E.T.).`,
        });
      } else if (!todosConNorma) {
        checks.push({
          name: 'bancarizacion_violada_listada',
          passed: false,
          severity: 'warning',
          detail:
            `pagosNoDeduciblesIndividuales[] tiene ${pagosNoDeduciblesIndividuales.length} item(s) ` +
            `pero algunos no citan 'Art. 771-5 §2 E.T.' (campo norma).`,
        });
      } else {
        checks.push({
          name: 'bancarizacion_violada_listada',
          passed: true,
          severity: 'warning',
          detail:
            `${pagosNoDeduciblesIndividuales.length} pago(s) individual(es) > 100 UVT listados ` +
            `con norma 'Art. 771-5 §2 E.T.'. Correcto.`,
        });
      }
    } else {
      checks.push({
        name: 'bancarizacion_violada_listada',
        passed: true,
        severity: 'warning',
        detail:
          `Pagos en efectivo total ${formatCop(pagosEfectivoTotal)} ≤ tope individual ` +
          `${formatCop(topeIndividual)} — check bancarización no aplica.`,
      });
    }
  }

  // -----------------------------------------------------------------------
  // C2.4 — tet_no_implausible
  // -----------------------------------------------------------------------
  {
    const { tet, uai } = report.tet.data;

    if (uai !== 0) {
      if (tet < 0.05) {
        checks.push({
          name: 'tet_no_implausible',
          passed: false,
          severity: 'warning',
          detail:
            `TET = ${formatPct(tet)} < 5% — valor implausiblemente bajo. ` +
            `Probable error de extracción del impuesto causado del balance. ` +
            `Verificar cuenta grupo 54 (Impuesto de renta).`,
        });
      } else if (tet > 0.5) {
        checks.push({
          name: 'tet_no_implausible',
          passed: false,
          severity: 'warning',
          detail:
            `TET = ${formatPct(tet)} > 50% — valor implausiblemente alto. ` +
            `Posible error en partidas no deducibles extremas o extracción de UAI incorrecta.`,
        });
      } else {
        checks.push({
          name: 'tet_no_implausible',
          passed: true,
          severity: 'warning',
          detail: `TET = ${formatPct(tet)} en rango plausible [5%, 50%]. OK.`,
        });
      }
    } else {
      checks.push({
        name: 'tet_no_implausible',
        passed: true,
        severity: 'warning',
        detail: 'UAI = 0 — check de implausibilidad no aplica.',
      });
    }
  }

  // -----------------------------------------------------------------------
  // C2.5 — synthesis_no_contradice_cards
  // -----------------------------------------------------------------------
  {
    const { topRecommendations } = report.synthesis;
    const hayAlertaRoja = report.tet.data.nivelAlerta === 'rojo';

    if (topRecommendations.length === 0 && hayAlertaRoja) {
      checks.push({
        name: 'synthesis_no_contradice_cards',
        passed: false,
        severity: 'warning',
        detail:
          'Síntesis tiene topRecommendations vacío pero TET está en alerta roja. ' +
          'El sintetizador debe incluir al menos 1 recomendación cuando hay alertas críticas.',
      });
    } else {
      checks.push({
        name: 'synthesis_no_contradice_cards',
        passed: true,
        severity: 'warning',
        detail:
          topRecommendations.length === 0
            ? 'Sin alertas rojas activas — síntesis vacía es coherente.'
            : `Síntesis tiene ${topRecommendations.length} recomendación(es) — coherente con estado de cards.`,
      });
    }
  }

  // -----------------------------------------------------------------------
  // C2.6 — dividend_recomendacion_no_vacia
  // -----------------------------------------------------------------------
  {
    const { recomendacion } = report.dividendOptimizer.data;

    if (!recomendacion || recomendacion.length <= 20) {
      checks.push({
        name: 'dividend_recomendacion_no_vacia',
        passed: false,
        severity: 'warning',
        detail:
          `Recomendación de dividendos muy corta o vacía (${recomendacion?.length ?? 0} caracteres). ` +
          `Se requieren > 20 caracteres para ser accionable.`,
      });
    } else {
      checks.push({
        name: 'dividend_recomendacion_no_vacia',
        passed: true,
        severity: 'warning',
        detail: `Recomendación dividendos: ${recomendacion.length} caracteres. OK.`,
      });
    }
  }

  // Solo errores (severity=error) bloquean la capa; warnings no
  const hardFails = checks.filter((c) => c.severity === 'error' && !c.passed);
  return { ok: hardFails.length === 0, checks };
}

// ---------------------------------------------------------------------------
// CAPA 3 — Defensa tributaria (Art. 647 E.T.)
// ---------------------------------------------------------------------------
// CADA check de esta capa DEBE tener un campo norma con la cita exacta.
// Sanción por inexactitud = 100% del mayor valor del impuesto (Art. 647 E.T.)

function runLayer3(report: EscudoSurvivalReport): LayerResult {
  const checks: CheckResult[] = [];

  // -----------------------------------------------------------------------
  // C3.1 — tet_cita_art_240
  // -----------------------------------------------------------------------
  {
    const citaOk = report.tet.markdown.includes('Art. 240');
    checks.push({
      name: 'tet_cita_art_240',
      passed: citaOk,
      severity: 'error',
      norma: 'Art. 240 E.T. — Tarifa general personas jurídicas 35%',
      detail: citaOk
        ? 'Markdown TET cita Art. 240 E.T. (tarifa de renta). Correcto.'
        : 'Markdown TET NO cita Art. 240 E.T. Toda afirmación de tarifa de renta debe citar la norma fuente.',
    });
  }

  // -----------------------------------------------------------------------
  // C3.2 — bancarizacion_cita_art_771_5
  // -----------------------------------------------------------------------
  {
    const citaOk = report.antiDian.markdown.includes('Art. 771-5');
    checks.push({
      name: 'bancarizacion_cita_art_771_5',
      passed: citaOk,
      severity: 'error',
      norma: 'Art. 771-5 E.T. — Medios de pago para aceptación de costos y deducciones',
      detail: citaOk
        ? 'Markdown Anti-DIAN cita Art. 771-5 E.T. (bancarización). Correcto.'
        : 'Markdown Anti-DIAN NO cita Art. 771-5 E.T. Toda referencia a pagos en efectivo no deducibles debe citarlo.',
    });
  }

  // -----------------------------------------------------------------------
  // C3.3 — dividendos_cita_art_242_o_36_3
  // -----------------------------------------------------------------------
  {
    const md = report.dividendOptimizer.markdown;
    const citaOk = md.includes('Art. 242') || md.includes('Art. 36-3');
    checks.push({
      name: 'dividendos_cita_art_242_o_36_3',
      passed: citaOk,
      severity: 'error',
      norma: 'Art. 242 E.T. — Impuesto a dividendos personas naturales | Art. 36-3 E.T. — Capitalización INCRGNO',
      detail: citaOk
        ? 'Markdown dividendos cita Art. 242 o Art. 36-3 E.T. Correcto.'
        : 'Markdown dividendos NO cita Art. 242 E.T. ni Art. 36-3 E.T. Los escenarios tributarios de dividendos requieren ambas normas.',
    });
  }

  // -----------------------------------------------------------------------
  // C3.4 — descuentos_no_norma_derogada (Art. 130 E.T. derogado Ley 1819/2016)
  // -----------------------------------------------------------------------
  {
    // Art. 130 fue derogado por Ley 1819/2016. Cualquier mención sin marcar
    // como derogado es un riesgo Art. 647 E.T.
    const allMarkdown = [
      report.tet.markdown,
      report.retentionShield.markdown,
      report.antiDian.markdown,
      report.contingencyReserve.markdown,
      report.dividendOptimizer.markdown,
      report.synthesis.markdown,
    ].join('\n');

    const art130Regex = /Art\.\s*130\s*E\.T\./gi;
    const art130Mentions = allMarkdown.match(art130Regex);

    if (art130Mentions && art130Mentions.length > 0) {
      // Verificar si cada mención va acompañada de "derogado" o "Ley 1819"
      // en un radio de 100 caracteres
      const hasDerogadoContext = art130Regex.test('derogado') || (() => {
        const lines = allMarkdown.split('\n');
        for (const line of lines) {
          if (/Art\.\s*130\s*E\.T\./i.test(line)) {
            const context = line.toLowerCase();
            if (context.includes('derogado') || context.includes('ley 1819')) {
              return true;
            }
          }
        }
        return false;
      })();

      checks.push({
        name: 'descuentos_no_norma_derogada',
        passed: hasDerogadoContext,
        severity: 'error',
        norma: 'Ley 1819/2016 art. 376 — derogación expresa Art. 130 E.T.',
        detail: hasDerogadoContext
          ? 'Art. 130 E.T. mencionado con contexto "derogado" / "Ley 1819". Correcto.'
          : `Art. 130 E.T. mencionado ${art130Mentions.length} vez(ces) sin marcarlo como derogado por Ley 1819/2016. ` +
            'Usar norma derogada en una recomendación fiscal expone al cliente a sanción Art. 647 E.T.',
      });
    } else {
      checks.push({
        name: 'descuentos_no_norma_derogada',
        passed: true,
        severity: 'error',
        norma: 'Ley 1819/2016 art. 376 — derogación expresa Art. 130 E.T.',
        detail: 'Art. 130 E.T. (derogado) no mencionado en el reporte. Correcto.',
      });
    }
  }

  // -----------------------------------------------------------------------
  // C3.5 — tarifa_general_correcta
  // -----------------------------------------------------------------------
  {
    // Tarifas válidas para personas jurídicas 2026:
    // 35% (general), 38% (hidroeléctricas), 40% (financieras/seguros/bolsas)
    // Tarifas prohibidas: 33%, 34% (régimen anterior a Ley 2277/2022)
    const allMarkdown = [
      report.tet.markdown,
      report.retentionShield.markdown,
      report.antiDian.markdown,
      report.contingencyReserve.markdown,
      report.dividendOptimizer.markdown,
      report.synthesis.markdown,
    ].join('\n');

    // Buscar menciones de % con valores incorrectos
    const tarifasProhibidas = allMarkdown.match(/\b(3[12349]|2[0-9]|3[0-2])\s*%/g);

    if (tarifasProhibidas && tarifasProhibidas.length > 0) {
      const unique = Array.from(new Set(tarifasProhibidas)).join(', ');
      checks.push({
        name: 'tarifa_general_correcta',
        passed: false,
        severity: 'error',
        norma: 'Art. 240 E.T. — Tarifa general 35% vigente (Ley 2277/2022)',
        detail:
          `Posibles tarifas incorrectas detectadas: ${unique}. ` +
          'Para personas jurídicas 2026: tarifa general = 35%, hidroeléctricas = 38%, financieras = 40%. ' +
          'Tarifas como 33% o 34% correspondían al régimen anterior a Ley 2277/2022.',
      });
    } else {
      checks.push({
        name: 'tarifa_general_correcta',
        passed: true,
        severity: 'error',
        norma: 'Art. 240 E.T. — Tarifa general 35% vigente (Ley 2277/2022)',
        detail: 'No se detectaron tarifas prohibidas (33%, 34%). Correcto.',
      });
    }
  }

  // -----------------------------------------------------------------------
  // C3.6 — uvt_correcta_2026
  // -----------------------------------------------------------------------
  {
    const UVT_2026_STR = '52.374';
    const UVT_2026_STR_ALT = '52374';

    const allMarkdown = [
      report.tet.markdown,
      report.antiDian.markdown,
      report.synthesis.markdown,
    ].join('\n');

    const period = report.metadata.period;
    const is2026Period = period.includes('2026');

    const citaUVT2026 =
      allMarkdown.includes(UVT_2026_STR) || allMarkdown.includes(UVT_2026_STR_ALT);

    // Detectar UVT de otros años (solo como advertencia)
    const uvtHistoricas = allMarkdown.match(/\b(49\.799|47\.065|47065|49799)\b/g);

    if (is2026Period && !citaUVT2026) {
      checks.push({
        name: 'uvt_correcta_2026',
        passed: false,
        severity: 'error',
        norma: 'Resolución DIAN 000238/2025 — UVT 2026 = $52.374 COP',
        detail:
          `Periodo ${period}: el reporte NO menciona UVT 2026 ($52.374). ` +
          'Todos los cálculos en UVT deben usar $52.374 para el año gravable 2026.',
      });
    } else if (uvtHistoricas && uvtHistoricas.length > 0) {
      checks.push({
        name: 'uvt_correcta_2026',
        passed: false,
        severity: 'warning',
        norma: 'Resolución DIAN 000238/2025 — UVT 2026 = $52.374 COP',
        detail:
          `UVT histórica de otro año detectada: ${Array.from(new Set(uvtHistoricas)).join(', ')}. ` +
          'Si se usa UVT de otro año para datos históricos, marcarla explícitamente.',
      });
    } else {
      checks.push({
        name: 'uvt_correcta_2026',
        passed: true,
        severity: 'error',
        norma: 'Resolución DIAN 000238/2025 — UVT 2026 = $52.374 COP',
        detail: is2026Period
          ? `Periodo ${period}: UVT 2026 ($52.374) citada correctamente.`
          : `Periodo ${period}: no es 2026, check de UVT 2026 no aplica.`,
      });
    }
  }

  // -----------------------------------------------------------------------
  // C3.7 — disclaimer_revisor_fiscal
  // -----------------------------------------------------------------------
  {
    const synthMd = report.synthesis.markdown;
    // Frases que constituyen un disclaimer adecuado
    const disclaimerPatterns = [
      /revisor\s+fiscal/i,
      /validaci[oó]n\s+de\s+revisor/i,
      /contador\s+p[uú]blico/i,
      /asesor\s+tributario/i,
      /profesional\s+habilitado/i,
      /consultor\s+especializado/i,
      /no\s+reemplaza.*asesor[ía]a/i,
      /decisi[oó]n(?:es)?\s+tributaria(?:s)?\s+final(?:es)?\s+requiere/i,
    ];

    const tieneDisclaimer = disclaimerPatterns.some((p) => p.test(synthMd));

    checks.push({
      name: 'disclaimer_revisor_fiscal',
      passed: tieneDisclaimer,
      severity: 'error',
      norma: 'INTERNAL — Buena práctica: dictamen requiere disclaimer de validación profesional',
      detail: tieneDisclaimer
        ? 'Síntesis incluye disclaimer de validación profesional. Correcto.'
        : 'Síntesis NO incluye disclaimer de revisor fiscal / contador / asesor tributario. ' +
          'El dictamen debe aclarar que las decisiones finales requieren validación profesional.',
    });
  }

  const hardFails = checks.filter((c) => c.severity === 'error' && !c.passed);
  return { ok: hardFails.length === 0, checks };
}

// ---------------------------------------------------------------------------
// STRESS TEST A — Auxiliares vs Resumen
// ---------------------------------------------------------------------------

function runStressAuxiliaresVsResumen(
  preprocessed: PreprocessedBalance,
): StressTestResult {
  const classes = preprocessed.primary.classes;
  const inconsistencias: string[] = [];

  for (const cls of classes) {
    // Solo validar clases que tengan un reportedTotal explícito (cuenta clase/raíz)
    if (cls.reportedTotal === null) continue;

    const sumaAuxiliares = cls.auxiliaryTotal;
    const diff = Math.abs(sumaAuxiliares - cls.reportedTotal);

    if (diff > TOLERANCE_PESOS) {
      inconsistencias.push(
        `Clase ${cls.code} (${cls.name}): ` +
          `reportado ${formatCop(cls.reportedTotal)}, ` +
          `suma auxiliares ${formatCop(sumaAuxiliares)}, ` +
          `diferencia ${formatCop(diff)}.`,
      );
    }

    // Verificar también subcuentas con reportedTotal vs sus auxiliares
    // agrupando por prefijo de 4 dígitos (cuenta PUC)
    const cuentasPadre = new Map<string, { reported: number | null; sumaHijos: number }>();

    for (const acc of cls.accounts) {
      if (acc.code.length <= 4) {
        // Es cuenta padre (2 a 4 dígitos)
        const entry = cuentasPadre.get(acc.code) ?? { reported: null, sumaHijos: 0 };
        entry.reported = acc.balance;
        cuentasPadre.set(acc.code, entry);
      } else if (acc.code.length >= 6) {
        // Es auxiliar — acumularlo al padre de 4 dígitos
        const parentCode = acc.code.slice(0, 4);
        const entry = cuentasPadre.get(parentCode) ?? { reported: null, sumaHijos: 0 };
        if (acc.isLeaf) entry.sumaHijos += acc.balance;
        cuentasPadre.set(parentCode, entry);
      }
    }

    for (const [code, { reported, sumaHijos }] of cuentasPadre) {
      if (reported === null || sumaHijos === 0) continue; // sin auxiliares postables
      const subDiff = Math.abs(reported - sumaHijos);
      if (subDiff > TOLERANCE_PESOS) {
        inconsistencias.push(
          `Inconsistencia auxiliares vs resumen en cuenta ${code} ` +
            `(reportado ${formatCop(reported)}, suma auxiliares ${formatCop(sumaHijos)}, ` +
            `diferencia ${formatCop(subDiff)}).`,
        );
      }
    }
  }

  if (inconsistencias.length === 0) {
    return {
      passed: true,
      detail: 'Todos los totales de clase cuadran con la suma de auxiliares. OK.',
    };
  }

  return {
    passed: false,
    detail: `${inconsistencias.length} inconsistencia(s) auxiliares vs resumen:\n` +
      inconsistencias.join('\n'),
  };
}

// ---------------------------------------------------------------------------
// STRESS TEST B — Coherencia Caja vs Utilidad
// ---------------------------------------------------------------------------

function runStressCoherenciaCajaUtilidad(
  report: EscudoSurvivalReport,
  preprocessed: PreprocessedBalance,
): StressTestResult {
  const { controlTotals } = preprocessed.primary;

  // Extraer efectivo de PUC 11
  const efectivo = controlTotals.efectivoCuenta11 ?? (() => {
    // Fallback: sumar clase 11 manualmente
    const class1 = preprocessed.primary.classes.find((c) => c.code === 1);
    if (!class1) return 0;
    return sumLeafAccountsByPrefix(class1, '11');
  })();

  const utilidadNeta = report.contingencyReserve.data.utilidadNeta;

  if (efectivo <= 0) {
    return {
      passed: true,
      detail:
        `Efectivo (PUC 11) = ${formatCop(efectivo)}: con caja cero o negativa, ` +
        'la heurística caja/utilidad no aplica.',
    };
  }

  // Heurística: si utilidadNeta > 3 × efectivo, es implausible
  const ratio = utilidadNeta / efectivo;

  if (ratio > 3 * (1 + TOLERANCE_CASH_FLOW)) {
    return {
      passed: false,
      detail:
        `Coherencia caja/utilidad: utilidadNeta ${formatCop(utilidadNeta)} = ` +
        `${ratio.toFixed(1)}× el efectivo disponible ${formatCop(efectivo)}. ` +
        `Ratio > 3× (tolerancia 5%) sugiere desconexión entre resultado contable y caja. ` +
        'Verificar: deudores comerciales altos, ventas a crédito no cobradas, o error de extracción.',
    };
  }

  return {
    passed: true,
    detail:
      `Utilidad ${formatCop(utilidadNeta)} / caja ${formatCop(efectivo)} = ` +
      `${ratio.toFixed(2)}× (umbral máximo: 3.15×). Coherencia caja/utilidad OK.`,
  };
}

// ---------------------------------------------------------------------------
// STRESS TEST C — Defensa Art. 647 (modo auditor adversarial)
// ---------------------------------------------------------------------------

function runStressDefensaArt647(report: EscudoSurvivalReport): StressTestResult {
  // Recolectar todas las recomendaciones del reporte
  const recomendaciones: Array<{ fuente: string; texto: string }> = [];

  // Acciones de retención
  for (const acc of report.retentionShield.data.acciones as RetentionAction[]) {
    recomendaciones.push({
      fuente: 'retentionShield.acciones',
      texto: `${acc.tipo} — norma: ${acc.norma}`,
    });
  }

  // Sugerencias de optimización TET
  for (const sug of report.tet.data.sugerenciasOptimizacion as OptimizationSuggestion[]) {
    recomendaciones.push({
      fuente: 'tet.sugerenciasOptimizacion',
      texto: `${sug.norma} (factibilidad ${sug.factibilidad})`,
    });
  }

  // Recomendación de dividendos
  if (report.dividendOptimizer.data.recomendacion) {
    recomendaciones.push({
      fuente: 'dividendOptimizer.recomendacion',
      texto: report.dividendOptimizer.data.recomendacion,
    });
  }

  // Verificar normas citadas en capa 3
  const layer3 = runLayer3(report);
  const layer3Fails = layer3.checks.filter((c) => !c.passed && c.severity === 'error');

  // Verificar que cada acción de retención cite norma real (no vacía)
  const accionesSinNorma = report.retentionShield.data.acciones.filter(
    (a: RetentionAction) => !a.norma || a.norma.trim().length < 5,
  );

  // Verificar que cada sugerencia de TET cite norma real
  const sugerenciasSinNorma = report.tet.data.sugerenciasOptimizacion.filter(
    (s: OptimizationSuggestion) => !s.norma || s.norma.trim().length < 5,
  );

  const problemas: string[] = [];

  if (layer3Fails.length > 0) {
    problemas.push(
      ...layer3Fails.map((c) => `[Capa 3 fail] ${c.name}: ${c.detail ?? 'sin detail'}`),
    );
  }

  if (accionesSinNorma.length > 0) {
    problemas.push(
      `${accionesSinNorma.length} acción(es) de retención sin norma citada.`,
    );
  }

  if (sugerenciasSinNorma.length > 0) {
    problemas.push(
      `${sugerenciasSinNorma.length} sugerencia(s) de optimización TET sin norma citada.`,
    );
  }

  // Verificar que no haya Art. 130 sin marcar como derogado
  // (replicando el check C3.4 desde la perspectiva adversarial)
  const allMd = [
    report.tet.markdown,
    report.antiDian.markdown,
    report.dividendOptimizer.markdown,
  ].join('\n');
  const art130Matches = allMd.match(/Art\.\s*130\s*E\.T\./gi);
  if (art130Matches) {
    const lines = allMd.split('\n');
    const sinDerogado = lines.filter(
      (l) =>
        /Art\.\s*130\s*E\.T\./i.test(l) &&
        !l.toLowerCase().includes('derogado') &&
        !l.toLowerCase().includes('ley 1819'),
    );
    if (sinDerogado.length > 0) {
      problemas.push(
        `Art. 130 E.T. (derogado Ley 1819/2016) citado ${sinDerogado.length} ` +
          'vez(ces) sin indicar que fue derogado — sanción Art. 647 E.T. si DIAN lo detecta.',
      );
    }
  }

  if (problemas.length === 0) {
    return {
      passed: true,
      detail:
        `Defensa Art. 647 OK. ${recomendaciones.length} recomendación(es) revisadas: ` +
        'todas tienen respaldo normativo y el reporte no cita normas derogadas.',
    };
  }

  return {
    passed: false,
    detail:
      `${problemas.length} problema(s) de defensa Art. 647 detectados:\n` +
      problemas.join('\n'),
  };
}

// ---------------------------------------------------------------------------
// Punto de entrada público
// ---------------------------------------------------------------------------

/**
 * Valida el reporte de supervivencia élite contra el balance preprocesado.
 *
 * - Capa 1 (Aritmética): chequeos matemáticos puros. Errores = hard fail.
 * - Capa 2 (Lógica de negocio): coherencia de recomendaciones. Errores = hard fail; warnings = soft.
 * - Capa 3 (Defensa tributaria): citas normativas. Errores = hard fail.
 * - Stress tests: auxiliares vs resumen, caja vs utilidad, Art. 647 adversarial.
 *
 * `ok: false` cuando hay cualquier hard fail. Los warnings no bloquean.
 */
export function validateSurvivalReport(
  report: EscudoSurvivalReport,
  preprocessed: PreprocessedBalance,
): SurvivalValidationResult {
  const layer1 = runLayer1(report, preprocessed);
  const layer2 = runLayer2(report, preprocessed);
  const layer3 = runLayer3(report);

  const stressAux = runStressAuxiliaresVsResumen(preprocessed);
  const stressCaja = runStressCoherenciaCajaUtilidad(report, preprocessed);
  const stressArt647 = runStressDefensaArt647(report);

  // Hard fails: errores en capas 1, 3, y stress tests adversariales
  const hardFails: string[] = [];

  for (const c of layer1.checks) {
    if (!c.passed && c.severity === 'error') {
      hardFails.push(`[Capa 1 — Aritmética] ${c.name}: ${c.detail ?? ''}`);
    }
  }

  for (const c of layer2.checks) {
    if (!c.passed && c.severity === 'error') {
      hardFails.push(`[Capa 2 — Negocio] ${c.name}: ${c.detail ?? ''}`);
    }
  }

  for (const c of layer3.checks) {
    if (!c.passed && c.severity === 'error') {
      hardFails.push(`[Capa 3 — Tributaria] ${c.name}: ${c.detail ?? ''}`);
    }
  }

  // Stress tests: solo defensaArt647 es hard fail si falla
  if (!stressArt647.passed) {
    hardFails.push(`[Stress C — Art. 647] ${stressArt647.detail}`);
  }

  // Soft warnings: layer2 warnings + stress tests A y B
  const softWarnings: string[] = [];

  for (const c of layer2.checks) {
    if (!c.passed && c.severity === 'warning') {
      softWarnings.push(`[Capa 2] ${c.name}: ${c.detail ?? ''}`);
    }
  }

  if (!stressAux.passed) {
    softWarnings.push(`[Stress A — Auxiliares] ${stressAux.detail}`);
  }

  if (!stressCaja.passed) {
    softWarnings.push(`[Stress B — Caja/Utilidad] ${stressCaja.detail}`);
  }

  // Warnings de capa 3 (uvt_correcta_2026 puede ser warning)
  for (const c of layer3.checks) {
    if (!c.passed && c.severity === 'warning') {
      softWarnings.push(`[Capa 3] ${c.name}: ${c.detail ?? ''}`);
    }
  }

  return {
    ok: hardFails.length === 0,
    errors: hardFails,
    warnings: softWarnings,
    stressTests: {
      auxiliaresVsResumen: stressAux,
      coherenciaCajaUtilidad: stressCaja,
      defensaArt647: stressArt647,
    },
    layers: {
      aritmetica: layer1,
      logicaNegocio: layer2,
      defensaTributaria: layer3,
    },
  };
}
