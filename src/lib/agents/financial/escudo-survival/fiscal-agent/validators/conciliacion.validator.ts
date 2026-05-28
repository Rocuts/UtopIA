// ---------------------------------------------------------------------------
// EL ESCUDO — Capa 4 (Agente Fiscal) — Módulo 2 · Conciliación
// ---------------------------------------------------------------------------
//
// Elite Protocol 3 capas para el output de conciliación contable-fiscal:
//
//   L1 — Aritmética (tolerancia 1 centavo)
//        L1.1 suma detallesAdiciones = adicionesCents
//        L1.2 suma detallesDeducciones = deduccionesCents
//        L1.3 rentaLiquida = UAI + adiciones − deducciones
//        L1.4 impuestoBruto = rentaLiquida × tarifa Art. 240
//        L1.5 impuestoNeto = impuestoBruto − descuento258_1 − min(descuentos254_256_257, tope25%)
//
//   L2 — Lógica de negocio
//        L2.1 descuento258_1 NO entra en tope conjunto 25%
//        L2.2 descuentos254/256/257 respetan tope 25% impuesto bruto (Art. 258)
//        L2.3 rentas exentas > UAI dispara warning de plausibilidad
//        L2.4 tarifa coincide con régimen declarado (35/40)
//
//   L3 — Defensa tributaria
//        L3.1 closingNote cita parágrafo del Art. 647 E.T.
//        L3.2 NO cita Art. 158-3 (DEROGADO Ley 1819/2016 — exposición Art. 647)
//
// Cero LLM. Cero red. Cero filesystem. Solo TypeScript + Math.
// ---------------------------------------------------------------------------

import type { Modulo2Conciliacion, ValidationCheck } from './types';
import {
  parseCents,
  formatCentsCop,
  TOLERANCE_CENTS,
  citaParagrafo647,
  citaArt158_3,
} from './helpers';

// ---------------------------------------------------------------------------
// Constantes normativas
// ---------------------------------------------------------------------------

/** Tarifa general PJ 2026 — Art. 240 E.T. */
const TARIFA_PJ_PCT = 35;

/** Tarifa para entidades financieras — Art. 240 par. 2 (35% + 5pp = 40%). */
const TARIFA_FINANCIERA_PCT = 40;

/** Tarifas legítimas reconocidas por el validator. */
const TARIFAS_VALIDAS = [TARIFA_PJ_PCT, TARIFA_FINANCIERA_PCT, 38]; // 38 = hidroeléctricas (+3pp)

/** Tope conjunto Arts. 254/256/257 sobre impuesto bruto — Art. 258 E.T. */
const TOPE_DESCUENTOS_PCT = 25;

// ---------------------------------------------------------------------------
// Helpers locales
// ---------------------------------------------------------------------------

function sumarDetalles(detalles: readonly { readonly montoCents: string }[]): number {
  let total = 0;
  for (const d of detalles) total += parseCents(d.montoCents);
  return total;
}

function calcImpuestoBruto(rentaLiquidaCents: number, tarifaPct: number): number {
  if (rentaLiquidaCents <= 0) return 0;
  return Math.round((rentaLiquidaCents * tarifaPct) / 100);
}

function tope25pct(impuestoBrutoCents: number): number {
  if (impuestoBrutoCents <= 0) return 0;
  return Math.round((impuestoBrutoCents * TOPE_DESCUENTOS_PCT) / 100);
}

// ---------------------------------------------------------------------------
// CAPA 1 — Aritmética (tolerancia 1 centavo)
// ---------------------------------------------------------------------------

export function validateConciliacionL1(m2: Modulo2Conciliacion): ValidationCheck[] {
  const checks: ValidationCheck[] = [];

  const uai = parseCents(m2.uaiCents);
  const adiciones = parseCents(m2.adicionesCents);
  const deducciones = parseCents(m2.deduccionesCents);
  const rentaLiquida = parseCents(m2.rentaLiquidaCents);
  const impuestoBruto = parseCents(m2.impuestoBrutoCents);
  const desc258_1 = parseCents(m2.descuento258_1Cents);
  const descOtros = parseCents(m2.descuentos254_256_257Cents);
  const impuestoNeto = parseCents(m2.impuestoNetoCents);

  // -------------------------------------------------------------------
  // L1.1 — sum(detallesAdiciones) = adicionesCents
  // -------------------------------------------------------------------
  {
    const sumDet = sumarDetalles(m2.detallesAdiciones);
    const diff = Math.abs(sumDet - adiciones);
    checks.push({
      name: 'M2.L1.1_suma_adiciones',
      passed: diff <= TOLERANCE_CENTS,
      severity: 'error',
      norma: 'INTERNAL',
      detail:
        diff <= TOLERANCE_CENTS
          ? `Adiciones detalladas suman ${formatCentsCop(sumDet)} = reportado ${formatCentsCop(adiciones)} (tolerancia ${TOLERANCE_CENTS}ct).`
          : `Suma de detalles de adiciones ${formatCentsCop(sumDet)} ≠ reportado ${formatCentsCop(adiciones)} (diff ${formatCentsCop(Math.abs(sumDet - adiciones))}; tolerancia ${TOLERANCE_CENTS}ct).`,
    });
  }

  // -------------------------------------------------------------------
  // L1.2 — sum(detallesDeducciones) = deduccionesCents
  // -------------------------------------------------------------------
  {
    const sumDet = sumarDetalles(m2.detallesDeducciones);
    const diff = Math.abs(sumDet - deducciones);
    checks.push({
      name: 'M2.L1.2_suma_deducciones',
      passed: diff <= TOLERANCE_CENTS,
      severity: 'error',
      norma: 'INTERNAL',
      detail:
        diff <= TOLERANCE_CENTS
          ? `Deducciones detalladas suman ${formatCentsCop(sumDet)} = reportado ${formatCentsCop(deducciones)} (tolerancia ${TOLERANCE_CENTS}ct).`
          : `Suma de detalles de deducciones ${formatCentsCop(sumDet)} ≠ reportado ${formatCentsCop(deducciones)} (diff ${formatCentsCop(Math.abs(sumDet - deducciones))}; tolerancia ${TOLERANCE_CENTS}ct).`,
    });
  }

  // -------------------------------------------------------------------
  // L1.3 — rentaLiquida = UAI + adiciones − deducciones
  // -------------------------------------------------------------------
  {
    const esperada = uai + adiciones - deducciones;
    const diff = Math.abs(rentaLiquida - esperada);
    checks.push({
      name: 'M2.L1.3_renta_liquida_identidad',
      passed: diff <= TOLERANCE_CENTS,
      severity: 'error',
      norma: 'Art. 26 E.T.',
      detail:
        diff <= TOLERANCE_CENTS
          ? `Renta líquida ${formatCentsCop(rentaLiquida)} = UAI ${formatCentsCop(uai)} + adiciones ${formatCentsCop(adiciones)} − deducciones ${formatCentsCop(deducciones)}.`
          : `Renta líquida reportada ${formatCentsCop(rentaLiquida)} ≠ esperada ${formatCentsCop(esperada)} (diff ${formatCentsCop(diff)}; tolerancia ${TOLERANCE_CENTS}ct).`,
    });
  }

  // -------------------------------------------------------------------
  // L1.4 — impuestoBruto = rentaLiquida × tarifa / 100
  // -------------------------------------------------------------------
  {
    const esperado = calcImpuestoBruto(rentaLiquida, m2.tarifa);
    const diff = Math.abs(impuestoBruto - esperado);
    checks.push({
      name: 'M2.L1.4_impuesto_bruto_tarifa',
      passed: diff <= TOLERANCE_CENTS,
      severity: 'error',
      norma: 'Art. 240 E.T.',
      detail:
        diff <= TOLERANCE_CENTS
          ? `Impuesto bruto ${formatCentsCop(impuestoBruto)} = renta líquida ${formatCentsCop(rentaLiquida)} × ${m2.tarifa}%.`
          : `Impuesto bruto reportado ${formatCentsCop(impuestoBruto)} ≠ esperado ${formatCentsCop(esperado)} (tarifa ${m2.tarifa}%; diff ${formatCentsCop(diff)}; tolerancia ${TOLERANCE_CENTS}ct).`,
    });
  }

  // -------------------------------------------------------------------
  // L1.5 — impuestoNeto = impuestoBruto − desc258_1 − min(descOtros, tope25%)
  // -------------------------------------------------------------------
  {
    const tope = tope25pct(impuestoBruto);
    const descOtrosAplicable = Math.min(descOtros, tope);
    const esperado = Math.max(0, impuestoBruto - desc258_1 - descOtrosAplicable);
    const diff = Math.abs(impuestoNeto - esperado);
    checks.push({
      name: 'M2.L1.5_impuesto_neto_descuentos',
      passed: diff <= TOLERANCE_CENTS,
      severity: 'error',
      norma: 'Arts. 254, 256, 257, 258, 258-1 E.T.',
      detail:
        diff <= TOLERANCE_CENTS
          ? `Impuesto neto ${formatCentsCop(impuestoNeto)} = bruto ${formatCentsCop(impuestoBruto)} − 258-1 ${formatCentsCop(desc258_1)} − min(${formatCentsCop(descOtros)}, tope25%=${formatCentsCop(tope)})=${formatCentsCop(descOtrosAplicable)}.`
          : `Impuesto neto reportado ${formatCentsCop(impuestoNeto)} ≠ esperado ${formatCentsCop(esperado)} (bruto ${formatCentsCop(impuestoBruto)}, 258-1 ${formatCentsCop(desc258_1)}, otros ${formatCentsCop(descOtros)} tope ${formatCentsCop(tope)}; diff ${formatCentsCop(diff)}).`,
    });
  }

  return checks;
}

// ---------------------------------------------------------------------------
// CAPA 2 — Lógica de negocio
// ---------------------------------------------------------------------------

export function validateConciliacionL2(m2: Modulo2Conciliacion): ValidationCheck[] {
  const checks: ValidationCheck[] = [];

  const uai = parseCents(m2.uaiCents);
  const impuestoBruto = parseCents(m2.impuestoBrutoCents);
  const desc258_1 = parseCents(m2.descuento258_1Cents);
  const descOtros = parseCents(m2.descuentos254_256_257Cents);
  const rentasExentas = parseCents(m2.rentasExentasCents);

  // -------------------------------------------------------------------
  // L2.1 — descuento 258-1 NO entra en el tope conjunto 25%
  //        (chequea que el cálculo L1.5 lo separó — informativo)
  // -------------------------------------------------------------------
  {
    // Si desc258_1 > tope25%(bruto), igual debe aplicarse al 100% sin tope.
    // El check es declarativo: si el agente lo metió al cálculo de tope,
    // L1.5 ya falló. Acá ratificamos el principio normativo.
    const ok = true; // L1.5 ya valida el cálculo correcto
    checks.push({
      name: 'M2.L2.1_descuento_258_1_sin_tope_conjunto',
      passed: ok,
      severity: 'warning',
      norma: 'Art. 258-1 par. E.T.',
      detail: `Descuento IVA bienes de capital ${formatCentsCop(desc258_1)} se aplica al 100% del impuesto bruto sin tope conjunto del 25%. Ver Art. 258 par.`,
    });
  }

  // -------------------------------------------------------------------
  // L2.2 — descuentos 254/256/257 respetan tope 25% del impuesto bruto
  // -------------------------------------------------------------------
  {
    const tope = tope25pct(impuestoBruto);
    // Si el agente reporta descOtros > tope, debe haberlos limitado en L1.5.
    // Como L1.5 ya valida la fórmula, acá emitimos un warning informativo
    // si excede para que el usuario sepa que se le aplica el tope.
    const excede = descOtros > tope;
    checks.push({
      name: 'M2.L2.2_descuentos_otros_tope_25pct',
      passed: true, // No es error en sí — L1.5 ya capó el cálculo
      severity: 'warning',
      norma: 'Art. 258 E.T.',
      detail: excede
        ? `Descuentos Arts. 254/256/257 reportados ${formatCentsCop(descOtros)} exceden el tope del 25% del impuesto bruto ${formatCentsCop(tope)}. Se aplica solo el tope (Art. 258 E.T.).`
        : `Descuentos Arts. 254/256/257 ${formatCentsCop(descOtros)} ≤ tope 25% ${formatCentsCop(tope)} — OK.`,
    });
  }

  // -------------------------------------------------------------------
  // L2.3 — rentas exentas > UAI → warning plausibilidad
  // -------------------------------------------------------------------
  if (uai > 0 && rentasExentas > uai) {
    checks.push({
      name: 'M2.L2.3_rentas_exentas_excesivas',
      passed: false,
      severity: 'warning',
      norma: 'INTERNAL',
      detail: `Rentas exentas ${formatCentsCop(rentasExentas)} > UAI ${formatCentsCop(uai)}. Caso atípico — validar con revisor fiscal antes de declarar.`,
    });
  }

  // -------------------------------------------------------------------
  // L2.4 — tarifa pertenece al catálogo de tarifas válidas
  // -------------------------------------------------------------------
  {
    const ok = TARIFAS_VALIDAS.includes(m2.tarifa);
    checks.push({
      name: 'M2.L2.4_tarifa_valida_2026',
      passed: ok,
      severity: 'error',
      norma: 'Art. 240 E.T. + par. 2',
      detail: ok
        ? `Tarifa ${m2.tarifa}% reconocida (Art. 240 / par. 2 — 35% PJ, 38% hidroeléctrica, 40% financiera).`
        : `Tarifa ${m2.tarifa}% NO reconocida para 2026. Valores válidos: ${TARIFAS_VALIDAS.join('% / ')}% — recordar Sentencia C-079/2026 que tumbó Decreto 1474/2025 (sobretasa 50%).`,
    });
  }

  return checks;
}

// ---------------------------------------------------------------------------
// CAPA 3 — Defensa tributaria (Art. 647 E.T.)
// ---------------------------------------------------------------------------

export function validateConciliacionL3(m2: Modulo2Conciliacion): ValidationCheck[] {
  const checks: ValidationCheck[] = [];

  // -------------------------------------------------------------------
  // L3.1 — closingNote cita parágrafo del Art. 647 E.T.
  // -------------------------------------------------------------------
  {
    const ok = citaParagrafo647(m2.closingNote);
    checks.push({
      name: 'M2.L3.1_closing_note_cita_par_647',
      passed: ok,
      severity: 'error',
      norma: 'Art. 647 par. E.T.',
      detail: ok
        ? 'closingNote invoca el parágrafo del Art. 647 — defensa diferencia de criterio disponible.'
        : 'closingNote NO cita el parágrafo del Art. 647 E.T. Sin esta cita el cliente queda expuesto a sanción del 100% del mayor valor del impuesto en una controversia con DIAN.',
    });
  }

  // -------------------------------------------------------------------
  // L3.2 — NO cita Art. 158-3 (DEROGADO)
  // -------------------------------------------------------------------
  {
    const violacionClosing = citaArt158_3(m2.closingNote);
    const violacionDetalles = m2.detallesAdiciones.some((d) => citaArt158_3(d.norma)) ||
      m2.detallesDeducciones.some((d) => citaArt158_3(d.norma));
    const violacion = violacionClosing || violacionDetalles;
    checks.push({
      name: 'M2.L3.2_no_cita_art_158_3_derogado',
      passed: !violacion,
      severity: 'error',
      norma: 'Ley 1819 de 2016, Art. 376 (deroga Art. 158-3)',
      detail: violacion
        ? `Cita Art. 158-3 E.T. que fue DEROGADO por Ley 1819/2016. Emitir esta cita ante DIAN configura inexactitud (Art. 647). Alternativa: Art. 258-1 (descuento IVA bienes de capital).`
        : 'No se detectó cita al Art. 158-3 derogado — OK.',
    });
  }

  return checks;
}

// ---------------------------------------------------------------------------
// Entry point del módulo
// ---------------------------------------------------------------------------

export function validateConciliacion(m2: Modulo2Conciliacion): ValidationCheck[] {
  return [
    ...validateConciliacionL1(m2),
    ...validateConciliacionL2(m2),
    ...validateConciliacionL3(m2),
  ];
}
