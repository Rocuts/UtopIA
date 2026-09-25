// ---------------------------------------------------------------------------
// Fiscal Anchor Validators — Elite Protocol 3 Capas
// ---------------------------------------------------------------------------
// Valida el FiscalAnchorBlock (F01-F10 + Calendario DIAN) producido por el
// backend antes de que llegue al usuario o al pipeline de dictamen.
//
// Cero LLM. Cero red. Cero filesystem. Solo TypeScript + Math.
//
// Capas:
//   L1 — Aritmética: tolerancia 1 centavo, aritmética de enteros exacta.
//   L2 — Lógica de negocio: tolerancia 5%, contexto contable.
//   L3 — Defensa tributaria: tarifa, crédito de renta imputable y plazos DIAN
//        con su fuente (Art. 240, Arts. 373/484-1 E.T.; Decreto 2229/2023).
//
// Producción: `validateSurvivalReport` (survival-validators.ts) corre
// `validateFiscalAnchorAll` sobre el ancla que publica /api/escudo-survival
// (auditoría 2026-09, integración W3-B; tributario-modulos-03).
//
// Por qué número entero (no BigInt literal):
//   El tsconfig del proyecto apunta a ES2017 donde los BigInt literals (n suffix)
//   no están disponibles. Los montos colombianos en centavos en este módulo
//   (hasta ~2.2e11 cts = ~$2.200M COP) están bien dentro del rango seguro de
//   Number.MAX_SAFE_INTEGER (9.007e15). Usamos parseInt() para parsear y
//   comparamos como enteros con Math.round() donde aplica.
// ---------------------------------------------------------------------------

import {
  digitToBusinessDay,
  nthBusinessDay,
  tieneFestivosVerificados,
} from '@/lib/scrapers/dian-scraper';
import { extractCalendarDigit } from '../fiscal-anchor/dian-calendar';
import type { FiscalAnchorBlock, FiscalAlerta, VencimientoDian } from '../fiscal-anchor/types';

// Re-usamos el tipo ya definido en survival-validators.ts para no duplicar
import type { CheckResult } from './survival-validators';

// ---------------------------------------------------------------------------
// Constantes normativas (no magic numbers)
// ---------------------------------------------------------------------------

/** Tolerancia de 1 centavo para comparaciones exactas. */
const TOLERANCE_CENTS = 1;

/** Tarifa renta PJ 2026 = 35%. Art. 240 E.T. */
const TARIFA_RENTA_PCT = 35;

/**
 * Plazos DIAN: del 7º al 16º día hábil del mes según el último dígito del NIT
 * sin DV (dígito 1 = 7º … dígito 0 = 16º). Decreto 2229 de 2023, compilado en
 * el DUR 1625/2016: art. 1.6.1.13.2.33 (retención en la fuente mensual) y art.
 * 1.6.1.13.2.12 (renta de personas jurídicas: declaración y 1ª cuota en mayo,
 * 2ª cuota en julio). El cómputo de días hábiles es el del calendario del
 * ancla (`@/lib/scrapers/dian-scraper`); aquí no se reimplementa. Antes este
 * módulo usaba un rango «días 8–17» sin fuente y «9–22 de abril» para la renta
 * PJ del AG 2025, que contradecían el calendario publicado.
 */
const NORMA_RETEFUENTE =
  'Decreto 2229 de 2023 (DUR 1625/2016 art. 1.6.1.13.2.33) — retención mensual del 7º al 16º día hábil según el último dígito del NIT sin DV; Arts. 376 y 382 E.T.';
const NORMA_RENTA_PJ =
  'Decreto 2229 de 2023 (DUR 1625/2016 art. 1.6.1.13.2.12) — renta PJ: declaración y 1ª cuota en mayo, 2ª cuota en julio, del 7º al 16º día hábil según el último dígito del NIT sin DV';
const MES_RENTA_PJ_PRIMERA_CUOTA = 5;
const MES_RENTA_PJ_SEGUNDA_CUOTA = 7;

/**
 * Frase obligatoria que el bloque builder debe producir para defensa Art. 240 E.T.
 * El validator verifica su presencia en el markdownBlock.
 */
const FRASE_OBLIGATORIA_ART240 = 'Referencia antes de depuraciones fiscales';

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/**
 * Parsea un string de centavos a número entero.
 * El string puede ser positivo ("222849678973") o negativo ("-4607340776").
 */
function parseCents(s: string): number {
  const clean = s.trim();
  if (clean === '' || clean === '0') return 0;
  const n = parseInt(clean, 10);
  if (!Number.isFinite(n)) return 0;
  return n;
}

/**
 * Redondeo bancario al centavo para F02: round(F01 × 35 / 100).
 * Usamos Math.round() para half-up rounding estándar.
 * Garantiza exactitud porque F01 ≤ ~2.2e11 y 0.35 × 2.2e11 = 7.7e10 < MAX_SAFE_INTEGER.
 */
function calcF02(f01Cents: number): number {
  if (f01Cents <= 0) return 0;
  return Math.round(f01Cents * TARIFA_RENTA_PCT / 100);
}

/**
 * Calcula F10 = round((F03 / F02) × 100 × 10) / 10 (1 decimal).
 * Si F02 = 0, retorna 0 (convención cuando UAI = 0).
 */
function calcF10(f03Cents: number, f02Cents: number): number {
  if (f02Cents === 0) return 0;
  return Math.round((f03Cents / f02Cents) * 1000) / 10;
}

/**
 * Extrae el último dígito numérico del NIT.
 * Acepta "9017140146", "901714014-6", "901714014 6".
 * Retorna null si el NIT no tiene un dígito reconocible.
 */
function extractUltimoDigitoNit(nit: string): number | null {
  // Auditoría normativa 2026-08. Este archivo tenía su PROPIA copia del
  // extractor, y esa copia devolvía el DÍGITO DE VERIFICACIÓN: para
  // "901714014-6" retornaba 6 cuando el dígito de calendario es 4.
  //
  // El Decreto 2229/2023 (art. 1.6.1.13.2.1 del DUR 1625/2016) es explícito:
  // los plazos se determinan "teniendo en cuenta el último o los dos últimos
  // dígitos del Número de Identificación Tributaria (NIT) del contribuyente,
  // SIN TENER EN CUENTA EL DÍGITO DE VERIFICACIÓN".
  // https://normograma.dian.gov.co/dian/compilacion/docs/decreto_2229_2023.htm
  //
  // Con dos implementaciones distintas de la misma regla, el validador daba
  // por bueno un calendario correcto sólo cuando ambos se equivocaban igual.
  // Se delega en el extractor canónico; aquí no se reimplementa nada.
  const { digito, ambiguo } = extractCalendarDigit(nit);
  if (digito < 0 || ambiguo) return null;
  return digito;
}

/**
 * Fecha ISO del día hábil que le corresponde al dígito en ese año/mes, o `null`
 * si no hay festivos verificados para ese periodo (no se inventa la fecha).
 */
function fechaHabilDelDigito(year: number, month: number, digito: number): string | null {
  if (!tieneFestivosVerificados(year, month)) return null;
  return nthBusinessDay(year, month, digitToBusinessDay(digito));
}

function parseIsoDate(iso: string): { year: number; month: number } | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { year: parseInt(m[1], 10), month: parseInt(m[2], 10) };
}

/**
 * Formatea centavos a COP legible para mensajes de error.
 * Ej: 222849678973 → "$2.228.496.789,73"
 */
function formatCentsCop(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const pesos = Math.floor(abs / 100);
  const centavos = abs % 100;
  const pesosStr = pesos.toLocaleString('es-CO');
  const centavosStr = centavos.toString().padStart(2, '0');
  return (negative ? '-$' : '$') + pesosStr + ',' + centavosStr;
}

// ---------------------------------------------------------------------------
// CAPA 1 — Integridad Aritmética (tolerancia 1 centavo)
// ---------------------------------------------------------------------------

/**
 * L1: valida que F01-F10 y el calendario sean aritméticamene correctos.
 *
 * Why enteros: las cifras colombianas en centavos (hasta ~2.2e11 para montos de
 * $2.200M COP) están bien dentro del rango Number.MAX_SAFE_INTEGER (9.007e15).
 * Comparamos como enteros con Math.abs(a - b) ≤ TOLERANCE_CENTS = 1.
 */
export function validateFiscalAnchorL1(block: FiscalAnchorBlock): ValidationCheck[] {
  const checks: ValidationCheck[] = [];

  const f01 = parseCents(block.f01);
  const f02 = parseCents(block.f02);
  const f03 = parseCents(block.f03);
  const f04 = parseCents(block.f04);
  const f06 = parseCents(block.f06);
  const f07 = parseCents(block.f07);
  const f08 = parseCents(block.f08);

  // -------------------------------------------------------------------
  // L1.1 — F02 = round(F01 × 35 / 100) al centavo
  // Art. 240 E.T. — tarifa general personas jurídicas 35%
  // -------------------------------------------------------------------
  {
    const f02Esperado = calcF02(f01);
    const diff = Math.abs(f02 - f02Esperado);
    checks.push({
      name: 'L1.1_f02_tarifa_35pct',
      passed: diff <= TOLERANCE_CENTS,
      severity: 'error',
      norma: 'Art. 240 E.T. — tarifa renta PJ 35% (Ley 2277/2022)',
      detail: diff <= TOLERANCE_CENTS
        ? `F02 ${formatCentsCop(f02)} = round(F01 × 35%) correcto (diff ${diff}cts ≤ ${TOLERANCE_CENTS}ct).`
        : `F02 ${formatCentsCop(f02)} ≠ round(F01 ${formatCentsCop(f01)} × 35%) = ${formatCentsCop(f02Esperado)} (diff ${diff}cts; tolerancia ${TOLERANCE_CENTS}ct).`,
    });
  }

  // -------------------------------------------------------------------
  // L1.2 — F04 = F02 − F03 (firma incluida — puede ser negativo)
  // Identidad aritmética de una ESTIMACIÓN contable: F04 no es la
  // liquidación del Formulario 110 ni el saldo a favor que regulan los
  // Arts. 815 y 850 E.T. (esos salen de la declaración).
  // -------------------------------------------------------------------
  {
    const f04Esperado = f02 - f03;
    const diff = Math.abs(f04 - f04Esperado);
    checks.push({
      name: 'L1.2_f04_neto_pagar',
      passed: diff <= TOLERANCE_CENTS,
      severity: 'error',
      norma: 'INTERNAL — identidad F04 = F02 − F03 de la estimación contable (no es la liquidación del Formulario 110)',
      detail: diff <= TOLERANCE_CENTS
        ? `F04 ${formatCentsCop(f04)} = F02 − F03 correcto (diff ${diff}cts ≤ ${TOLERANCE_CENTS}ct).`
        : `F04 ${formatCentsCop(f04)} ≠ F02 ${formatCentsCop(f02)} − F03 ${formatCentsCop(f03)} = ${formatCentsCop(f04Esperado)} (diff ${diff}cts; tolerancia ${TOLERANCE_CENTS}ct).`,
    });
  }

  // -------------------------------------------------------------------
  // L1.3 — F08 frente a F06 + F07: NO hay relación de contenido.
  // F06 (|Cta.2365| retención en la fuente) y F07 (|Cta.2368|) son del
  // grupo 23 del PUC (Decreto 2650/1993) y F08 es |grupo 24|: el grupo 24
  // no las contiene. La regla anterior («F08 ≥ F06 + F07») advertía sobre
  // balances correctos cada vez que la retención por pagar superaba los
  // impuestos del grupo 24. Se conserva el nombre del check (contrato) y se
  // declara no aplicable (auditoría 2026-09, integración W3-B).
  // -------------------------------------------------------------------
  {
    checks.push({
      name: 'L1.3_f08_contiene_f06_f07',
      passed: true,
      severity: 'warning',
      norma: 'PUC Decreto 2650/1993 — 2365 y 2368 pertenecen al grupo 23, no al 24',
      detail: `No aplica: F06 ${formatCentsCop(f06)} (Cta.2365) y F07 ${formatCentsCop(f07)} (Cta.2368) son del grupo 23; F08 ${formatCentsCop(f08)} es el grupo 24 y no las contiene.`,
    });
  }

  // -------------------------------------------------------------------
  // L1.4 — F10 = round((F03/F02) × 100, 1 decimal) sin float drift
  //
  // Why: comparar con calcF10() (que usa el mismo algoritmo que el backend
  // correcto). Si el backend usó Number con operaciones adicionales puede
  // acumular drift. Tolerancia 0.15 pp (1 unidad del último decimal redondeado).
  // -------------------------------------------------------------------
  {
    const f10Esperado = calcF10(f03, f02);
    const diff = Math.abs(block.f10 - f10Esperado);
    const ok = diff < 0.15; // tolerancia 0.15 pp
    checks.push({
      name: 'L1.4_f10_cobertura_retenciones',
      passed: ok,
      severity: 'error',
      norma: 'INTERNAL — coherencia aritmética F10 = F03/F02×100',
      detail: ok
        ? `F10 ${block.f10}% ≈ ${f10Esperado}% (diff ${diff.toFixed(2)}pp ≤ 0.15pp).`
        : `F10 reportado ${block.f10}% ≠ calc F03/F02×100 = ${f10Esperado}% (diff ${diff.toFixed(2)}pp; tolerancia 0.15pp). Probable uso de operaciones Number encadenadas en lugar de Math.round(ratio×1000)/10.`,
    });
  }

  // -------------------------------------------------------------------
  // L1.5 — F09 ∈ [0, 100] y F10 ≥ 0
  // F10 puede superar 100% (retenciones > impuesto) — eso se captura en L2.3
  // -------------------------------------------------------------------
  // F09 (Clase 54 / UAI) puede superar el 100 % —gastos no deducibles,
  // impuesto mayor que la utilidad contable— o ser negativo con un ingreso
  // por impuesto: es una señal para revisar, no un error aritmético.
  {
    const f09Finito = Number.isFinite(block.f09);
    const f09ok = f09Finito && block.f09 >= 0 && block.f09 <= 100;
    checks.push({
      name: 'L1.5_f09_rango',
      passed: f09ok,
      severity: f09Finito ? 'warning' : 'error',
      norma: 'INTERNAL — tasa contable de impuesto (Clase 54 / UAI)',
      detail: f09ok
        ? `F09 = ${block.f09}% en rango [0, 100]. OK.`
        : f09Finito
          ? `F09 = ${block.f09}% fuera de [0, 100]: el impuesto contable (Clase 54) es negativo o mayor que la UAI. Revisar gastos no deducibles, impuesto diferido o la causación del periodo.`
          : `F09 no es un número finito (${block.f09}).`,
    });
    const f10ok = block.f10 >= 0;
    checks.push({
      name: 'L1.5_f10_rango',
      passed: f10ok,
      severity: 'error',
      norma: 'INTERNAL — porcentaje debe ser ≥ 0',
      detail: f10ok
        ? `F10 = ${block.f10}% ≥ 0. OK.`
        : `F10 = ${block.f10}% es negativo — imposible (F03 y F02 son positivos).`,
    });
  }

  // -------------------------------------------------------------------
  // L1.6 — Si F04 < 0, debe existir alerta SALDO_A_FAVOR (posible saldo a
  // favor como estimación contable; no liquidación ni acción de devolución)
  // -------------------------------------------------------------------
  {
    if (f04 < 0) {
      const tieneAlerta = block.alertas.some(
        (a: FiscalAlerta) => a.codigo === 'SALDO_A_FAVOR',
      );
      checks.push({
        name: 'L1.6_saldo_favor_alerta',
        passed: tieneAlerta,
        severity: 'error',
        norma: 'Estimación contable F04 — posible saldo a favor (no liquidación)',
        detail: tieneAlerta
          ? `F04 ${formatCentsCop(f04)} < 0 y alerta SALDO_A_FAVOR (estimación contable) presente. Correcto.`
          : `F04 ${formatCentsCop(f04)} < 0 (posible saldo a favor, estimación contable) pero NO existe alerta SALDO_A_FAVOR en alertas[]. Debe advertirse que requiere verificación contra la declaración.`,
      });
    } else {
      checks.push({
        name: 'L1.6_saldo_favor_alerta',
        passed: true,
        severity: 'error',
        norma: 'Art. 850 E.T.',
        detail: `F04 ${formatCentsCop(f04)} ≥ 0 — no hay saldo a favor. Check no aplica.`,
      });
    }
  }

  // -------------------------------------------------------------------
  // L1.7 — calendarioDian.ultimoDigito ∈ [0..9] y coincide con NIT
  // Art. 563 E.T. — NIT como identificador tributario
  // -------------------------------------------------------------------
  {
    // `null` sin NIT o con NIT sin separador de DV (ambiguo).
    const digitoNit = extractUltimoDigitoNit(block.calendarioDian.nit);
    const digitoCalendario = block.calendarioDian.ultimoDigito;

    if (digitoNit === null) {
      // Sin NIT, o NIT sin separador de DV: el calendario del ancla ya marca
      // todas las fechas «verificar». No hay dígito cierto contra el cual
      // comparar, así que el check es N/D y no un error.
      checks.push({
        name: 'L1.7_calendario_digito_nit',
        passed: true,
        severity: 'error',
        norma: 'Art. 563 E.T.; Decreto 2229 de 2023 — último dígito del NIT sin DV',
        detail:
          block.calendarioDian.nit.trim() === ''
            ? 'N/D — no se recibió el NIT; el calendario sale con estado «verificar».'
            : `N/D — el NIT "${block.calendarioDian.nit}" no permite separar el dígito de verificación; el calendario sale con estado «verificar».`,
      });
    } else if (digitoCalendario < 0 || digitoCalendario > 9) {
      checks.push({
        name: 'L1.7_calendario_digito_nit',
        passed: false,
        severity: 'error',
        norma: 'Art. 563 E.T. — NIT como identificador tributario',
        detail: `calendarioDian.ultimoDigito = ${digitoCalendario} fuera de rango [0..9].`,
      });
    } else {
      const coincide = digitoNit === digitoCalendario;
      checks.push({
        name: 'L1.7_calendario_digito_nit',
        passed: coincide,
        severity: 'error',
        norma: 'Art. 563 E.T.',
        detail: coincide
          ? `NIT "${block.calendarioDian.nit}" → último dígito ${digitoNit} coincide con ultimoDigito ${digitoCalendario}. OK.`
          : `NIT "${block.calendarioDian.nit}" → último dígito extraído ${digitoNit} ≠ ultimoDigito declarado ${digitoCalendario}.`,
      });
    }
  }

  return checks;
}

// ---------------------------------------------------------------------------
// CAPA 2 — Lógica de Negocio (severity: 'warning', tolerancia 5%)
// ---------------------------------------------------------------------------

export interface L2Context {
  /** Clase 54 en centavos (impuesto renta causado, provisionado en el balance). */
  clase54Cents: number;
  /** Datos del balance crudo para coherencia contable. */
  rawBalance: {
    /** True si existe la cuenta 1355 en el balance. */
    hasCta1355: boolean;
    /** True si existe la cuenta 1805 (impuesto corriente activo NIIF). */
    hasCta1805: boolean;
    /** Efectivo y equivalentes en centavos (PUC 11). */
    caja: number;
  };
}

/**
 * L2: valida coherencia contable y de negocio. Severidad warning — no bloquea.
 *
 * Why: los checks de L2 detectan inconsistencias plausibles que no son errores
 * aritméticos pero que señalan problemas de extracción o situaciones atípicas.
 */
export function validateFiscalAnchorL2(
  block: FiscalAnchorBlock,
  ctx: L2Context,
): ValidationCheck[] {
  const checks: ValidationCheck[] = [];

  const f01 = parseCents(block.f01);
  const f02 = parseCents(block.f02);
  const f03 = parseCents(block.f03);

  // -------------------------------------------------------------------
  // L2.1 — Si F03 > 0 pero 1355 / 1805 ausentes → incoherencia
  // NIIF para PYMES §29 — retenciones deben estar en activo
  // -------------------------------------------------------------------
  {
    if (f03 > 0 && !ctx.rawBalance.hasCta1355 && !ctx.rawBalance.hasCta1805) {
      checks.push({
        name: 'L2.1_retenciones_en_balance',
        passed: false,
        severity: 'warning',
        norma: 'NIIF para PYMES §29 — anticipos impuestos en activo corriente',
        detail: `F03 ${formatCentsCop(f03)} > 0 pero el balance no reporta cuentas 1355 ni 1805. Las retenciones a favor deben existir como activo corriente. Posible error de extracción.`,
      });
    } else {
      checks.push({
        name: 'L2.1_retenciones_en_balance',
        passed: true,
        severity: 'warning',
        norma: 'NIIF para PYMES §29',
        detail: f03 === 0
          ? 'F03 = 0 — sin retenciones acumuladas. OK.'
          : `F03 ${formatCentsCop(f03)} > 0 y balance incluye cuentas de retenciones. OK.`,
      });
    }
  }

  // -------------------------------------------------------------------
  // L2.2 — Coherencia caja vs UAI: si F01 > $1.000M pero caja < $50M → flag
  // Heurística: empresa con alta utilidad y caja mínima puede indicar
  // problemas de liquidez o error de extracción del UAI.
  // $1.000M en centavos = 1.000.000.000 × 100 = 100.000.000.000
  // $50M en centavos = 50.000.000 × 100 = 5.000.000.000
  // -------------------------------------------------------------------
  {
    const F01_UMBRAL_CENTS = 100000000000; // $1.000M COP
    const CAJA_MINIMA_CENTS = 5000000000;  // $50M COP

    if (f01 > F01_UMBRAL_CENTS && ctx.rawBalance.caja < CAJA_MINIMA_CENTS) {
      checks.push({
        name: 'L2.2_coherencia_caja_utilidad',
        passed: false,
        severity: 'warning',
        norma: 'INTERNAL — heurística liquidez empresarial',
        detail: `F01 (UAI) ${formatCentsCop(f01)} > $1.000M pero caja PUC 11 = ${formatCentsCop(ctx.rawBalance.caja)} < $50M. Posible desconexión utilidad/caja (ventas a crédito o error de extracción). Verificar cuentas 1305 y 11.`,
      });
    } else {
      checks.push({
        name: 'L2.2_coherencia_caja_utilidad',
        passed: true,
        severity: 'warning',
        norma: 'INTERNAL',
        detail: `F01 ${formatCentsCop(f01)} / caja ${formatCentsCop(ctx.rawBalance.caja)}: sin desconexión evidente.`,
      });
    }
  }

  // -------------------------------------------------------------------
  // L2.3 — F10 razonable: si F10 > 100%, retenciones exceden impuesto
  // Puede indicar doble conteo (135505 + 135515 sumados dos veces)
  // -------------------------------------------------------------------
  {
    if (block.f10 > 100) {
      checks.push({
        name: 'L2.3_f10_doble_conteo',
        passed: false,
        severity: 'warning',
        norma: 'INTERNAL — retenciones vs impuesto referencia',
        detail: `F10 = ${block.f10}% > 100%: las retenciones acumuladas (F03 ${formatCentsCop(f03)}) superan el impuesto referencia (F02 ${formatCentsCop(f02)}). Puede ser legítimo (UAI baja frente a las retenciones) o un doble conteo: verificar que no se sumen subcuentas junto con su cuenta total (p. ej. 135515 y 1355).`,
      });
    } else {
      checks.push({
        name: 'L2.3_f10_doble_conteo',
        passed: true,
        severity: 'warning',
        norma: 'INTERNAL',
        detail: `F10 = ${block.f10}% ≤ 100%. Sin señal de doble conteo. OK.`,
      });
    }
  }

  // -------------------------------------------------------------------
  // L2.4 — NIT formato canónico (regex ^\d{9,10}-?\d?$)
  // Art. 563 E.T. — NIT como identificador tributario
  // -------------------------------------------------------------------
  {
    const nit = block.calendarioDian.nit.replace(/\s/g, '');
    const nitRegex = /^\d{9,10}-?\d?$/;
    const ok = nit === '' || nitRegex.test(nit);
    checks.push({
      name: 'L2.4_nit_formato',
      passed: ok,
      severity: 'warning',
      norma: 'Art. 563 E.T. — NIT como identificador tributario',
      detail: nit === ''
        ? 'N/D — no se recibió el NIT.'
        : ok
          ? `NIT "${block.calendarioDian.nit}" cumple formato canónico. OK.`
          : `NIT "${block.calendarioDian.nit}" no cumple formato canónico (9-10 dígitos con dígito de verificación opcional).`,
    });
  }

  // -------------------------------------------------------------------
  // L2.5 — Vencimientos vencidos deben tener estado: 'vencido'
  // -------------------------------------------------------------------
  {
    const vencimientosErroneos: string[] = [];
    for (const v of block.calendarioDian.vencimientos) {
      if (v.diasRestantes < 0 && v.estado !== 'vencido') {
        vencimientosErroneos.push(`"${v.obligacion}" (diasRestantes=${v.diasRestantes}, estado="${v.estado}")`);
      }
    }
    const ok = vencimientosErroneos.length === 0;
    checks.push({
      name: 'L2.5_vencimientos_estado',
      passed: ok,
      severity: 'warning',
      norma: 'INTERNAL — coherencia estado vs diasRestantes',
      detail: ok
        ? 'Todos los vencimientos con diasRestantes < 0 tienen estado "vencido". OK.'
        : `${vencimientosErroneos.length} vencimiento(s) con diasRestantes < 0 pero estado ≠ "vencido": ${vencimientosErroneos.join('; ')}.`,
    });
  }

  return checks;
}

// ---------------------------------------------------------------------------
// CAPA 3 — Defensa Tributaria (severity: 'error', citada con norma)
// ---------------------------------------------------------------------------
// Simula el modo "auditor adversarial": qué argumentaría un funcionario DIAN
// para cuestionar las cifras. Documenta la evidencia de respaldo en `detail`.
// ---------------------------------------------------------------------------

export interface L3Context {
  /** Clase 54 en centavos (impuesto renta causado/provisionado). */
  clase54Cents: number;
  /**
   * El markdown que el bloque builder produce para el usuario.
   * L3 verifica que contenga las frases y citas normativas obligatorias.
   */
  markdownBlock: string;
  /**
   * Composición de 1355/1805 del balance con la regla ÚNICA de crédito de
   * renta (`@/lib/accounting/renta-credit`, vía `componerActivosImpuesto`), en
   * centavos. Cuando viene, L3.7 ancla F03 al centavo: F03 = crédito de renta.
   * Ausente ⇒ el check se declara no aplicable (no se inventa un veredicto).
   */
  creditoRenta?: {
    /** Crédito imputable a renta: 135505/135515 y 135595/1805 con nombre de renta. */
    creditoRentaCents: number;
    /** ReteIVA (135517 o nombre de IVA) — va contra IVA (Art. 484-1 E.T.). */
    reteIvaCents: number;
    /** ReteICA / anticipo de ICA (135510, 135518 o nombre de ICA). */
    reteIcaCents: number;
    /** Resto de 1355/1805 que no es crédito de renta (p. ej. 135530, obras de arte). */
    otrosNoRentaCents: number;
  };
}

/**
 * L3: defensa tributaria — cada cifra del ancla con su norma, fuente y
 * vigencia: tarifa (Art. 240 E.T.), crédito imputable a renta (Arts. 373 y
 * 484-1 E.T.) y plazos (Decreto 2229/2023).
 *
 * Why: F02 es una referencia contable (UAI × tarifa), no la liquidación. Si el
 * dictamen la presenta como impuesto, o acredita en renta lo que no es de
 * renta, el contribuyente queda expuesto a la inexactitud del Art. 647 E.T.
 */
export function validateFiscalAnchorL3(
  block: FiscalAnchorBlock,
  ctx: L3Context,
): ValidationCheck[] {
  const checks: ValidationCheck[] = [];

  const f01 = parseCents(block.f01);
  const f02 = parseCents(block.f02);
  const f03 = parseCents(block.f03);
  const f04 = parseCents(block.f04);

  // -------------------------------------------------------------------
  // L3.7 — F03 sólo con crédito imputable a RENTA (Art. 373 E.T.)
  //
  // F03 debe ser exactamente el crédito de renta de la lista blanca única
  // (`@/lib/accounting/renta-credit`): 135505/135515 salvo nombre de otro
  // tributo, y 135595/1805 sólo con nombre de renta. El ancla anterior
  // (Σ 1355+1805 − 135517 − 135518) aceptaba una obra de arte (1805), un
  // anticipo de ICA (135510) o los impuestos descontables (135530) como
  // crédito de renta (auditoría 2026-09, integración W3-B). Acreditar en
  // renta lo que no es de renta baja F04 y empuja a subdeclarar: Art. 647
  // num. 3 E.T. (retenciones o anticipos inexistentes o inexactos) y, si
  // media devolución, Art. 670 E.T.
  //
  // Tolerancia CERO: es un ancla, no una estimación.
  // -------------------------------------------------------------------
  {
    const cr = ctx.creditoRenta;
    if (!cr) {
      checks.push({
        name: 'L3.7_f03_solo_credito_renta',
        passed: true,
        severity: 'error',
        norma: 'Art. 373 E.T. — imputación de lo retenido a título de renta',
        detail:
          'Sin desagregación de 1355/1805 en el contexto — el ancla de F03 no se puede evaluar. Provea `creditoRenta` para activarla.',
      });
    } else {
      const esperado = cr.creditoRentaCents;
      const diff = Math.abs(f03 - esperado);
      const ok = diff === 0;
      const noRenta = cr.reteIvaCents + cr.reteIcaCents + cr.otrosNoRentaCents;
      checks.push({
        name: 'L3.7_f03_solo_credito_renta',
        passed: ok,
        severity: 'error',
        norma: 'Arts. 373 y 484-1 E.T. — sólo lo retenido o anticipado a título de renta se imputa a renta',
        detail: ok
          ? `F03 ${formatCentsCop(f03)} = crédito de renta de la lista blanca ${formatCentsCop(esperado)}. Quedan fuera ReteIVA ${formatCentsCop(cr.reteIvaCents)}, ReteICA/anticipo ICA ${formatCentsCop(cr.reteIcaCents)} y otros activos por impuestos ${formatCentsCop(cr.otrosNoRentaCents)}.`
          : `F03 ${formatCentsCop(f03)} ≠ crédito de renta de la lista blanca ${formatCentsCop(esperado)} (135505/135515 y 135595/1805 con nombre de renta). Diferencia ${formatCentsCop(diff)}; activos por impuestos que no son crédito de renta en el balance: ${formatCentsCop(noRenta)}. El ReteIVA se acredita en la declaración de IVA (Art. 484-1 E.T.), el ICA en la declaración municipal y la 1805 del PUC son bienes de arte y cultura; acreditarlos en renta configura inexactitud (Art. 647 E.T.) y, si origina devolución, sanción del Art. 670 E.T.`,
      });
    }
  }

  // -------------------------------------------------------------------
  // L3.1 — Utilidad sin gasto por impuesto de renta reconocido
  // Si F01 > 0 y Clase 54 = 0 y NO hay alerta A5_SIN_PROVISION → ERROR.
  //
  // Es una exigencia contable (NIIF para las PYMES Sección 29 / NIC 12:
  // reconocer el impuesto corriente del periodo), no una «diferencia de
  // criterio» del Art. 647 E.T.: ésta sólo excluye la inexactitud cuando el
  // menor impuesto proviene de una interpretación razonable del derecho
  // aplicable y los hechos y cifras declarados son completos y verdaderos.
  // Tampoco se ordena provisionar F02: UAI × 35 % no es base fiscal; la
  // provisión sale de la renta líquida depurada (Art. 26 E.T.).
  // -------------------------------------------------------------------
  {
    if (f01 > 0 && ctx.clase54Cents === 0) {
      const tieneAlerta = block.alertas.some(
        (a: FiscalAlerta) => a.codigo === 'A5_SIN_PROVISION',
      );
      checks.push({
        name: 'L3.1_sin_provision_renta',
        passed: tieneAlerta,
        severity: 'error',
        norma: 'NIIF para las PYMES Sección 29 / NIC 12 — reconocimiento del impuesto corriente',
        detail: tieneAlerta
          ? `Clase 54 = $0 con F01 ${formatCentsCop(f01)} > 0 y alerta A5_SIN_PROVISION presente: el dictamen advierte que no hay gasto por impuesto de renta reconocido.`
          : `Clase 54 = $0 con F01 ${formatCentsCop(f01)} > 0 y SIN alerta A5_SIN_PROVISION: el dictamen debe advertir que no hay gasto por impuesto de renta reconocido. F02 (${formatCentsCop(f02)}) es una referencia UAI × 35 %, no la provisión: ésta se determina con la renta líquida depurada (Art. 26 E.T.).`,
      });
    } else {
      checks.push({
        name: 'L3.1_sin_provision_renta',
        passed: true,
        severity: 'error',
        norma: 'NIIF para las PYMES Sección 29 / NIC 12',
        detail: f01 <= 0
          ? 'F01 ≤ 0 (pérdida o UAI nulo) — check provisión no aplica.'
          : `Clase 54 = ${formatCentsCop(ctx.clase54Cents)} ≠ 0. Gasto por impuesto de renta registrado.`,
      });
    }
  }

  // -------------------------------------------------------------------
  // L3.2 — F02 calculado siempre al 35% (Art. 240 E.T.)
  // El F02 es REFERENCIA — no admite otra tarifa aunque el contribuyente
  // aplique tarifas especiales. Si alguien cambia la tarifa, el validator
  // lo detecta comparando F02 reportado con 35% de F01.
  //
  // Evidencia adversarial DIAN: "F02 con tarifa diferente a 35% es una
  // referencia incorrecta que puede inducir al contribuyente a subdeclarar."
  // Evidencia defensa: F02 = round(F01 × 35%) documentado con norma.
  // -------------------------------------------------------------------
  {
    const f02Esperado = calcF02(f01);
    const diff = Math.abs(f02 - f02Esperado);
    checks.push({
      name: 'L3.2_tarifa_35pct_art240',
      passed: diff <= TOLERANCE_CENTS,
      severity: 'error',
      norma: 'Art. 240 E.T. — tarifa general PJ 35% (Ley 2277/2022, vigente 2026)',
      detail: diff <= TOLERANCE_CENTS
        ? `F02 ${formatCentsCop(f02)} = F01 × 35% (Art. 240 E.T.). Defensa: tarifa vigente corroborada.`
        : `F02 ${formatCentsCop(f02)} ≠ F01 × 35% = ${formatCentsCop(f02Esperado)} (diff ${diff}cts). La tarifa de referencia DEBE ser 35% según Art. 240 E.T. Ley 2277/2022. Si se aplicó otra tarifa, el dictamen es indefendible ante DIAN.`,
    });
  }

  // -------------------------------------------------------------------
  // L3.3 — Frase obligatoria Art. 240 en markdownBlock
  // El builder debe incluir: "Referencia antes de depuraciones fiscales..."
  //
  // Evidencia adversarial DIAN: "El dictamen afirma que F02 es el impuesto
  // a pagar, induciendo al contribuyente a no hacer la conciliación fiscal."
  // Evidencia defensa: la frase en el markdown deja claro que F02 es
  // referencia y que el impuesto definitivo requiere conciliación Art. 240 E.T.
  // -------------------------------------------------------------------
  {
    const tieneFrase = ctx.markdownBlock.includes(FRASE_OBLIGATORIA_ART240);
    checks.push({
      name: 'L3.3_frase_obligatoria_art240',
      passed: tieneFrase,
      severity: 'error',
      norma: 'Art. 240 E.T. + Art. 647 E.T. — disclaimer de referencia OBLIGATORIO',
      detail: tieneFrase
        ? `markdownBlock contiene frase obligatoria "${FRASE_OBLIGATORIA_ART240}...". Defensa: el dictamen no afirma que F02 sea el impuesto definitivo.`
        : `markdownBlock NO contiene "${FRASE_OBLIGATORIA_ART240}". OBLIGATORIO según contrato Art. 240 E.T.: la frase debe aclarar que F02 es referencia antes de depuraciones y que el impuesto definitivo requiere conciliación formal conforme al Artículo 240 del E.T.`,
    });
  }

  // -------------------------------------------------------------------
  // L3.4 — Posible saldo a favor sin alerta SALDO_A_FAVOR
  // Si F04 < 0 y no hay alerta → el dictamen omite advertir que la estimación
  // contable sugiere revisar la declaración. F04 no es el saldo a favor del
  // Formulario 110 (no depura renta, descuentos ni anticipo Art. 807 E.T.): la
  // alerta es informativa y no recomienda devolución (Art. 670 E.T.).
  // -------------------------------------------------------------------
  {
    if (f04 < 0) {
      const tieneAlerta = block.alertas.some(
        (a: FiscalAlerta) => a.codigo === 'SALDO_A_FAVOR',
      );
      checks.push({
        name: 'L3.4_saldo_favor_art850',
        passed: tieneAlerta,
        severity: 'error',
        norma: 'Arts. 26, 807 y 850 E.T. — el saldo a favor sale de la declaración',
        detail: tieneAlerta
          ? `F04 ${formatCentsCop(f04)} < 0 y alerta SALDO_A_FAVOR (estimación contable, no liquidación) presente.`
          : `F04 ${formatCentsCop(f04)} < 0 pero sin alerta SALDO_A_FAVOR. El dictamen debe advertir que la estimación contable sugiere verificar un posible saldo a favor en la declaración.`,
      });
    } else {
      checks.push({
        name: 'L3.4_saldo_favor_art850',
        passed: true,
        severity: 'error',
        norma: 'Art. 850 E.T.',
        detail: `F04 ${formatCentsCop(f04)} ≥ 0. No hay saldo a favor. Check no aplica.`,
      });
    }
  }

  // -------------------------------------------------------------------
  // L3.5 — Retención en la fuente mensual en el día hábil del dígito
  // (Decreto 2229/2023, DUR 1625/2016 art. 1.6.1.13.2.33). Cada fecha debe
  // ser el día hábil que le corresponde al último dígito del NIT en su mes.
  // N/D (sin veredicto) cuando no hay NIT inequívoco, la fecha ya está
  // marcada «verificar» o no hay festivos verificados para ese mes.
  //
  // Evidencia adversarial DIAN: presentar tarde la retención genera sanción
  // por extemporaneidad (Art. 641 E.T.) e intereses (Art. 635 E.T.).
  // -------------------------------------------------------------------
  const digitoPlazos = extractUltimoDigitoNit(block.calendarioDian.nit);
  {
    const retefuenteVencimientos = block.calendarioDian.vencimientos.filter(
      (v: VencimientoDian) =>
        v.obligacion.toLowerCase().includes('retenci') &&
        v.frecuencia === 'mensual',
    );

    const fuera: string[] = [];
    let verificadas = 0;
    let sinVerificar = 0;
    for (const v of retefuenteVencimientos) {
      if (digitoPlazos === null || v.estado === 'verificar') {
        sinVerificar++;
        continue;
      }
      const fecha = parseIsoDate(v.proximoVencimiento);
      if (!fecha) {
        fuera.push(`${v.proximoVencimiento} (formato inválido)`);
        continue;
      }
      const esperado = fechaHabilDelDigito(fecha.year, fecha.month, digitoPlazos);
      if (esperado === null) {
        sinVerificar++;
        continue;
      }
      verificadas++;
      if (v.proximoVencimiento !== esperado) {
        fuera.push(`${v.proximoVencimiento} (le corresponde ${esperado} al dígito ${digitoPlazos})`);
      }
    }

    const ok = fuera.length === 0;
    checks.push({
      name: 'L3.5_retefuente_rango_dias',
      passed: ok,
      severity: 'error',
      norma: NORMA_RETEFUENTE,
      detail: !ok
        ? `${fuera.length} fecha(s) de retención en la fuente fuera del día hábil del dígito: ${fuera.join('; ')}. Presentarla tarde expone a la sanción por extemporaneidad (Art. 641 E.T.).`
        : retefuenteVencimientos.length === 0
          ? 'Sin vencimientos de retención mensual en el calendario. Check no aplica.'
          : verificadas === 0
            ? `N/D — ${sinVerificar} vencimiento(s) de retención sin NIT inequívoco, marcados «verificar» o sin festivos verificados: no se emite veredicto.`
            : `${verificadas} vencimiento(s) de retención en el día hábil del dígito ${digitoPlazos}${sinVerificar > 0 ? `; ${sinVerificar} N/D` : ''}.`,
    });
  }

  // -------------------------------------------------------------------
  // L3.6 — Renta de personas jurídicas (Decreto 2229/2023, DUR 1625/2016
  // art. 1.6.1.13.2.12): declaración y 1ª cuota en mayo; 2ª cuota en julio;
  // del 7º al 16º día hábil según el último dígito del NIT. Es el calendario
  // que publica el ancla. El check anterior exigía el 9–22 de abril de 2026
  // «Resolución DIAN 2026» y marcaba como extemporáneas las fechas correctas.
  // Mismo tratamiento N/D que L3.5. (Grandes contribuyentes tienen otro
  // calendario —tres cuotas—, que el ancla no modela.)
  //
  // Evidencia adversarial DIAN: vencimiento fuera del plazo legal →
  // declaración extemporánea, sanción Art. 641 E.T.
  // -------------------------------------------------------------------
  {
    const rentaVencimientos = block.calendarioDian.vencimientos.filter(
      (v: VencimientoDian) =>
        v.obligacion.toLowerCase().includes('renta') && v.frecuencia === 'anual',
    );

    const fuera: string[] = [];
    let verificadas = 0;
    let sinVerificar = 0;
    for (const v of rentaVencimientos) {
      if (digitoPlazos === null || v.estado === 'verificar') {
        sinVerificar++;
        continue;
      }
      const fecha = parseIsoDate(v.proximoVencimiento);
      if (!fecha) {
        fuera.push(`${v.proximoVencimiento} (formato inválido)`);
        continue;
      }
      const segundaCuota = /2ª|2a cuota|segunda/i.test(v.obligacion);
      const mes = segundaCuota ? MES_RENTA_PJ_SEGUNDA_CUOTA : MES_RENTA_PJ_PRIMERA_CUOTA;
      const esperado = fechaHabilDelDigito(fecha.year, mes, digitoPlazos);
      if (esperado === null) {
        sinVerificar++;
        continue;
      }
      verificadas++;
      if (v.proximoVencimiento !== esperado) {
        fuera.push(
          `"${v.obligacion}" ${v.proximoVencimiento} (le corresponde ${esperado}: ${segundaCuota ? '2ª cuota en julio' : 'declaración y 1ª cuota en mayo'})`,
        );
      }
    }

    const ok = fuera.length === 0;
    checks.push({
      name: 'L3.6_renta_juridica_2025_fecha',
      passed: ok,
      severity: 'error',
      norma: NORMA_RENTA_PJ,
      detail: !ok
        ? `${fuera.length} fecha(s) de renta PJ fuera del plazo del dígito: ${fuera.join('; ')}. Riesgo Art. 641 E.T. (declaración extemporánea).`
        : rentaVencimientos.length === 0
          ? 'Sin vencimientos de renta anual en el calendario. Check no aplica.'
          : verificadas === 0
            ? `N/D — ${sinVerificar} vencimiento(s) de renta sin NIT inequívoco, marcados «verificar» o sin festivos verificados: no se emite veredicto.`
            : `${verificadas} vencimiento(s) de renta PJ en el día hábil del dígito ${digitoPlazos} (mayo / julio)${sinVerificar > 0 ? `; ${sinVerificar} N/D` : ''}.`,
    });
  }

  return checks;
}

// ---------------------------------------------------------------------------
// Entrada unificada
// ---------------------------------------------------------------------------

/**
 * Corre L1 ⊕ L2 ⊕ L3 y devuelve el array completo de checks.
 * Permite filtrar por capa usando el prefijo del nombre (L1.*, L2.*, L3.*).
 */
export function validateFiscalAnchorAll(
  block: FiscalAnchorBlock,
  l2ctx: L2Context,
  l3ctx: L3Context,
): ValidationCheck[] {
  return [
    ...validateFiscalAnchorL1(block),
    ...validateFiscalAnchorL2(block, l2ctx),
    ...validateFiscalAnchorL3(block, l3ctx),
  ];
}

// ---------------------------------------------------------------------------
// Re-export del tipo para consumers
// ---------------------------------------------------------------------------

/**
 * Alias de CheckResult (definido en survival-validators.ts) para que los
 * consumers de este módulo no necesiten importar ambos archivos.
 * El campo `norma` es obligatorio en L3; en L1/L2 se usa 'INTERNAL' cuando
 * no hay norma tributaria estricta.
 */
export type ValidationCheck = CheckResult;
