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
//   L3 — Defensa tributaria: Art. 647 E.T. — sanción 100% mayor valor impuesto.
//
// Por qué número entero (no BigInt literal):
//   El tsconfig del proyecto apunta a ES2017 donde los BigInt literals (n suffix)
//   no están disponibles. Los montos colombianos en centavos en este módulo
//   (hasta ~2.2e11 cts = ~$2.200M COP) están bien dentro del rango seguro de
//   Number.MAX_SAFE_INTEGER (9.007e15). Usamos parseInt() para parsear y
//   comparamos como enteros con Math.round() donde aplica.
// ---------------------------------------------------------------------------

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

/** Rango defensivo retefuente mensual (días 8–17 del mes siguiente). Art. 376 E.T. */
const RETEFUENTE_DIA_MIN = 8;
const RETEFUENTE_DIA_MAX = 17;

/** Rango defensivo renta jurídica 2025: 9–22 de abril de 2026. Resolución DIAN 2026. */
const RENTA_JURIDICA_2025_MIN = '2026-04-09';
const RENTA_JURIDICA_2025_MAX = '2026-04-22';

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
  // Art. 850 E.T. — saldo a favor devolución/compensación
  // -------------------------------------------------------------------
  {
    const f04Esperado = f02 - f03;
    const diff = Math.abs(f04 - f04Esperado);
    checks.push({
      name: 'L1.2_f04_neto_pagar',
      passed: diff <= TOLERANCE_CENTS,
      severity: 'error',
      norma: 'Art. 850 E.T. — neto a pagar / saldo a favor renta',
      detail: diff <= TOLERANCE_CENTS
        ? `F04 ${formatCentsCop(f04)} = F02 − F03 correcto (diff ${diff}cts ≤ ${TOLERANCE_CENTS}ct).`
        : `F04 ${formatCentsCop(f04)} ≠ F02 ${formatCentsCop(f02)} − F03 ${formatCentsCop(f03)} = ${formatCentsCop(f04Esperado)} (diff ${diff}cts; tolerancia ${TOLERANCE_CENTS}ct).`,
    });
  }

  // -------------------------------------------------------------------
  // L1.3 — F08 ≥ F06 + F07 (pasivos fiscales contienen al menos ICA + predial)
  // NIIF para PYMES §29 — presentación pasivos fiscales
  //
  // Why F06+F07 y no F05+F06+F07: en balances colombianos reales el saldo
  // del Grupo 24 puede ser menor que la Cta.2408 (IVA) cuando hay movimientos
  // débito en subcuentas del grupo (anticipos a favor de IVA) o cuando el
  // balance tiene errores de suma entre auxiliares y resumen. Exigir
  // F08 ≥ F05 genera falsos positivos en datos válidos. La garantía mínima
  // comprobable es que el grupo contiene al menos ICA + predial (componentes
  // más pequeños). Severidad 'warning' porque es señal de calidad, no error
  // aritmético. Documentado en MEMORY.md — edge case real Grupo 2 Tres SAS.
  // -------------------------------------------------------------------
  {
    const minimoEsperado = f06 + f07;
    const ok = f08 >= minimoEsperado;
    checks.push({
      name: 'L1.3_f08_contiene_f06_f07',
      passed: ok,
      severity: 'warning',
      norma: 'NIIF para PYMES §29 — pasivos por impuestos corrientes',
      detail: ok
        ? `F08 ${formatCentsCop(f08)} ≥ F06 + F07 = ${formatCentsCop(minimoEsperado)}. Correcto.`
        : `F08 ${formatCentsCop(f08)} < F06 ${formatCentsCop(f06)} + F07 ${formatCentsCop(f07)} = ${formatCentsCop(minimoEsperado)}. Grupo 24 subtotalizado respecto a ICA+predial. Verificar auxiliares vs resumen de la cuenta 24.`,
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
  {
    const f09ok = block.f09 >= 0 && block.f09 <= 100;
    checks.push({
      name: 'L1.5_f09_rango',
      passed: f09ok,
      severity: 'error',
      norma: 'INTERNAL — porcentaje debe ser [0, 100]',
      detail: f09ok
        ? `F09 = ${block.f09}% en rango [0, 100]. OK.`
        : `F09 = ${block.f09}% fuera de rango [0, 100]. El porcentaje de Clase 54 sobre UAI no puede ser negativo ni > 100%.`,
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
  // L1.6 — Si F04 < 0, debe existir alerta SALDO_A_FAVOR
  // Art. 850 E.T. — devolución de saldos a favor
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
        norma: 'Art. 850 E.T. — devolución / compensación saldo a favor renta',
        detail: tieneAlerta
          ? `F04 ${formatCentsCop(f04)} < 0 y alerta SALDO_A_FAVOR presente. Correcto.`
          : `F04 ${formatCentsCop(f04)} < 0 (saldo a favor) pero NO existe alerta SALDO_A_FAVOR en alertas[]. Art. 850 E.T. exige reportarlo explícitamente.`,
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
    const digitoNit = extractUltimoDigitoNit(block.calendarioDian.nit);
    const digitoCalendario = block.calendarioDian.ultimoDigito;

    const enRango = digitoCalendario >= 0 && digitoCalendario <= 9;
    const coincide = digitoNit !== null && digitoNit === digitoCalendario;

    if (!enRango) {
      checks.push({
        name: 'L1.7_calendario_digito_nit',
        passed: false,
        severity: 'error',
        norma: 'Art. 563 E.T. — NIT como identificador tributario',
        detail: `calendarioDian.ultimoDigito = ${digitoCalendario} fuera de rango [0..9].`,
      });
    } else if (digitoNit === null) {
      checks.push({
        name: 'L1.7_calendario_digito_nit',
        passed: false,
        severity: 'error',
        norma: 'Art. 563 E.T.',
        detail: `No se pudo extraer el último dígito del NIT "${block.calendarioDian.nit}". Formato esperado: 9 o 10 dígitos con o sin guión.`,
      });
    } else {
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
        detail: `F10 = ${block.f10}% > 100%: las retenciones acumuladas (F03 ${formatCentsCop(f03)}) superan el impuesto referencia (F02 ${formatCentsCop(f02)}). Posible doble conteo de subcuentas 1355. Verificar que 135505 + 135510 + 135515 no se sumen junto con el total de 1355.`,
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
    const nitRegex = /^\d{9,10}-?\d?$/;
    const ok = nitRegex.test(block.calendarioDian.nit.replace(/\s/g, ''));
    checks.push({
      name: 'L2.4_nit_formato',
      passed: ok,
      severity: 'warning',
      norma: 'Art. 563 E.T. — NIT como identificador tributario',
      detail: ok
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
}

/**
 * L3: defensa Art. 647 E.T. — sanción por inexactitud = 100% del mayor valor
 * del impuesto determinado sobre la declaración privada.
 *
 * Why: toda recomendación que reduzca el impuesto pagado debe poder sostenerse
 * en una controversia con la DIAN. Si el dictamen dice "F02 = $X" sin citar
 * el Art. 240 E.T., el contribuyente no tiene soporte para una diferencia
 * de criterio ante la sanción por inexactitud.
 */
export function validateFiscalAnchorL3(
  block: FiscalAnchorBlock,
  ctx: L3Context,
): ValidationCheck[] {
  const checks: ValidationCheck[] = [];

  const f01 = parseCents(block.f01);
  const f02 = parseCents(block.f02);
  const f04 = parseCents(block.f04);

  // -------------------------------------------------------------------
  // L3.1 — Sin provisión renta (Art. 647 E.T. + NIIF para PYMES §29)
  // Si F01 > 0 y Clase 54 = 0 y NO hay alerta A5_SIN_PROVISION → ERROR
  //
  // Evidencia adversarial DIAN: "La utilidad antes de impuestos es positiva
  // pero la declaración no muestra gasto por impuesto ni provisión contable.
  // La DIAN aplicaría Art. 647 por la diferencia entre impuesto referencia
  // y cero declarado." Evidencia defensa: alerta A5_SIN_PROVISION documenta
  // que el contribuyente reconoció la omisión y la reportó explícitamente.
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
        norma: 'Art. 647 E.T. — sanción por inexactitud 100% mayor valor impuesto',
        detail: tieneAlerta
          ? `Clase 54 = $0 y F01 ${formatCentsCop(f01)} > 0, pero alerta A5_SIN_PROVISION presente. Defensa: diferencia de criterio documentada. Evidencia: mensaje = "${block.alertas.find((a) => a.codigo === 'A5_SIN_PROVISION')?.mensaje ?? ''}".`
          : `Clase 54 = $0 y F01 ${formatCentsCop(f01)} > 0 y NO hay alerta A5_SIN_PROVISION. Provisionar impuesto renta: ${formatCentsCop(f02)}. Defensa Art. 647 E.T. — diferencia de criterio.`,
      });
    } else {
      checks.push({
        name: 'L3.1_sin_provision_renta',
        passed: true,
        severity: 'error',
        norma: 'Art. 647 E.T.',
        detail: f01 <= 0
          ? 'F01 ≤ 0 (pérdida o UAI nulo) — check provisión no aplica.'
          : `Clase 54 = ${formatCentsCop(ctx.clase54Cents)} > 0. Provisión de renta registrada. OK.`,
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
  // L3.4 — Saldo a favor sin alerta SALDO_A_FAVOR (Art. 850 E.T.)
  // Si F04 < 0 y no hay alerta → el dictamen omite un derecho del contribuyente
  //
  // Evidencia adversarial DIAN: "El contribuyente no solicitó devolución
  // del saldo a favor en tiempo oportuno por omisión del dictamen."
  // Evidencia defensa: alerta SALDO_A_FAVOR documenta el derecho a devolución.
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
        norma: 'Art. 850 E.T. — devolución saldos a favor renta',
        detail: tieneAlerta
          ? `F04 ${formatCentsCop(f04)} < 0 y alerta SALDO_A_FAVOR presente. Defensa: derecho devolución Art. 850 E.T. documentado.`
          : `F04 ${formatCentsCop(f04)} < 0 pero sin alerta SALDO_A_FAVOR. Art. 850 E.T. reconoce el derecho a devolución; omitirlo en el dictamen perjudica al contribuyente.`,
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
  // L3.5 — Retefuente mensual en rango días 8–17 (Art. 376 E.T.)
  // Tabla de vencimientos por último dígito NIT. El rango 8–17 cubre
  // todos los dígitos (0 = día 8, 9 = día 17 aprox según resolución DIAN).
  //
  // Evidencia adversarial DIAN: "El dictamen indica vencimiento fuera del
  // plazo legal, generando intereses de mora Art. 635 E.T."
  // -------------------------------------------------------------------
  {
    const retefuenteVencimientos = block.calendarioDian.vencimientos.filter(
      (v: VencimientoDian) =>
        v.obligacion.toLowerCase().includes('retenci') &&
        v.frecuencia === 'mensual',
    );

    const fuera: string[] = [];
    for (const v of retefuenteVencimientos) {
      const match = v.proximoVencimiento.match(/^\d{4}-(\d{2})-(\d{2})$/);
      if (!match) {
        fuera.push(`${v.proximoVencimiento} (formato inválido)`);
        continue;
      }
      const dia = parseInt(match[2], 10);
      if (dia < RETEFUENTE_DIA_MIN || dia > RETEFUENTE_DIA_MAX) {
        fuera.push(`${v.proximoVencimiento} (día ${dia} fuera de [${RETEFUENTE_DIA_MIN}..${RETEFUENTE_DIA_MAX}])`);
      }
    }

    const ok = fuera.length === 0;
    checks.push({
      name: 'L3.5_retefuente_rango_dias',
      passed: ok,
      severity: 'error',
      norma: 'Art. 376 E.T. — plazos de consignación retenciones en la fuente',
      detail: ok
        ? retefuenteVencimientos.length === 0
          ? 'Sin vencimientos de retefuente mensual en el calendario. Check no aplica.'
          : `${retefuenteVencimientos.length} vencimiento(s) retefuente en rango [${RETEFUENTE_DIA_MIN}..${RETEFUENTE_DIA_MAX}]. Defensa: fechas conforme Art. 376 E.T.`
        : `${fuera.length} fecha(s) de retefuente fuera del rango [${RETEFUENTE_DIA_MIN}..${RETEFUENTE_DIA_MAX}] del mes siguiente: ${fuera.join('; ')}. Art. 376 E.T. expone al contribuyente a intereses de mora Art. 635 E.T.`,
    });
  }

  // -------------------------------------------------------------------
  // L3.6 — Renta jurídica 2025: 9–22 de abril 2026 (Resolución DIAN 2026)
  // El rango es defensivo — la fecha exacta depende del decreto vigente.
  //
  // Evidencia adversarial DIAN: "Vencimiento de renta fuera del plazo
  // legal → declaración extemporánea, sanción Art. 641 E.T."
  // Evidencia defensa: rango 9–22 abr 2026 cubre cualquier decreto DIAN 2026.
  // -------------------------------------------------------------------
  {
    const rentaVencimientos = block.calendarioDian.vencimientos.filter(
      (v: VencimientoDian) =>
        (v.obligacion.toLowerCase().includes('renta') ||
         v.obligacion.toLowerCase().includes('impuesto de renta')) &&
        v.frecuencia === 'anual' &&
        v.proximoVencimiento.startsWith('2026'),
    );

    if (block.calendarioDian.periodo === '2025' && rentaVencimientos.length > 0) {
      const fuera: string[] = [];
      for (const v of rentaVencimientos) {
        const fecha = v.proximoVencimiento;
        if (fecha < RENTA_JURIDICA_2025_MIN || fecha > RENTA_JURIDICA_2025_MAX) {
          fuera.push(`${fecha} (fuera de [${RENTA_JURIDICA_2025_MIN}..${RENTA_JURIDICA_2025_MAX}])`);
        }
      }
      const ok = fuera.length === 0;
      checks.push({
        name: 'L3.6_renta_juridica_2025_fecha',
        passed: ok,
        severity: 'error',
        norma: 'Resolución DIAN 2026 — plazos declaración renta PJ 2025',
        detail: ok
          ? `Fecha(s) renta jurídica 2025: ${rentaVencimientos.map((v) => v.proximoVencimiento).join(', ')} en rango [${RENTA_JURIDICA_2025_MIN}..${RENTA_JURIDICA_2025_MAX}]. Defensa: cumple Resolución DIAN 2026.`
          : `Fecha(s) fuera del rango defensivo abril 2026: ${fuera.join('; ')}. Riesgo Art. 641 E.T. (declaración extemporánea).`,
      });
    } else {
      checks.push({
        name: 'L3.6_renta_juridica_2025_fecha',
        passed: true,
        severity: 'error',
        norma: 'Resolución DIAN 2026',
        detail: block.calendarioDian.periodo !== '2025'
          ? `Período ${block.calendarioDian.periodo} ≠ 2025. Check renta jurídica 2025 no aplica.`
          : 'Sin vencimientos de renta anual 2026 en el calendario. Check no aplica.',
      });
    }
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
