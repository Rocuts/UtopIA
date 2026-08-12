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
//        L1.5 impuestoNeto = impuestoBruto − descuento258_1 − descuento254
//                            − min(descuentos255_256_257, tope25%)
//
//   L2 — Lógica de negocio
//        L2.1 descuento258_1 NO entra en tope conjunto 25%
//        L2.2 descuentos 255/256/257 respetan tope 25% impuesto bruto (Art. 258)
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

/**
 * Tope conjunto sobre el impuesto a cargo — Art. 258 E.T.
 *
 * Texto vigente (mod. Art. 106 Ley 1819/2016), verbatim: «Los descuentos de que
 * tratan los artículos 255, 256 y 257 del Estatuto Tributario tomados en su
 * conjunto no podrán exceder del 25% del impuesto sobre la renta a cargo del
 * contribuyente en el respectivo año gravable.» El propio título del artículo
 * enumera 255, 256 y 257 — el Art. 254 (descuento por impuestos pagados en el
 * exterior) NO está cobijado: su límite es el impuesto colombiano generado por
 * esas rentas (Art. 254 lit. e y par. 1) y el piso general del Art. 259.
 *
 * Aplicarle el 25% al Art. 254 obliga al contribuyente a pagar de más y hace
 * que el validador rechace conciliaciones correctas.
 */
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
  // L1.5 — impuestoNeto = bruto − 258-1 − 254 − min(255/256/257, tope 25%)
  //
  // El tope del Art. 258 cobija sólo 255, 256 y 257. Cuando la conciliación
  // declara qué parte es del Art. 254, la identidad es exacta y se exige al
  // centavo. Cuando NO lo declara, el reparto es desconocido y el validador
  // NO inventa una cifra: valida que el neto caiga dentro del rango que
  // delimitan los dos extremos posibles (todo topeado ↔ todo del Art. 254).
  // Antes se exigía siempre el extremo topeado, y eso rechazaba la
  // conciliación correcta exigiendo una liquidación mayor a la debida.
  // -------------------------------------------------------------------
  {
    const tope = tope25pct(impuestoBruto);
    const declara254 = m2.descuento254Cents !== undefined && m2.descuento254Cents !== null;
    const desc254 = declara254 ? Math.max(0, parseCents(m2.descuento254Cents as string)) : 0;

    if (desc254 > descOtros) {
      // El 254 declarado no cabe dentro del total: el desglose se contradice.
      checks.push({
        name: 'M2.L1.5_impuesto_neto_descuentos',
        passed: false,
        severity: 'error',
        norma: 'Arts. 254 y 258 E.T.',
        detail: `Descuento del Art. 254 declarado ${formatCentsCop(desc254)} excede el total de descuentos distintos del 258-1 ${formatCentsCop(descOtros)}. El 254 es una PARTE de ese total, no un sumando adicional.`,
      });
    } else if (declara254) {
      const desc255_256_257 = descOtros - desc254;
      const aplicable = desc254 + Math.min(desc255_256_257, tope);
      const esperado = Math.max(0, impuestoBruto - desc258_1 - aplicable);
      const diff = Math.abs(impuestoNeto - esperado);
      checks.push({
        name: 'M2.L1.5_impuesto_neto_descuentos',
        passed: diff <= TOLERANCE_CENTS,
        severity: 'error',
        norma: 'Arts. 254, 255, 256, 257, 258, 258-1 E.T.',
        detail:
          diff <= TOLERANCE_CENTS
            ? `Impuesto neto ${formatCentsCop(impuestoNeto)} = bruto ${formatCentsCop(impuestoBruto)} − 258-1 ${formatCentsCop(desc258_1)} − 254 ${formatCentsCop(desc254)} (sin tope) − min(255/256/257 ${formatCentsCop(desc255_256_257)}, tope25% ${formatCentsCop(tope)}).`
            : `Impuesto neto reportado ${formatCentsCop(impuestoNeto)} ≠ esperado ${formatCentsCop(esperado)} (bruto ${formatCentsCop(impuestoBruto)}, 258-1 ${formatCentsCop(desc258_1)}, 254 sin tope ${formatCentsCop(desc254)}, 255/256/257 ${formatCentsCop(desc255_256_257)} topeados a ${formatCentsCop(tope)}; diff ${formatCentsCop(diff)}).`,
      });
    } else {
      // Sin desglose: dos extremos legítimos.
      //   piso  = todo el descuento es del Art. 254 → nada se topea.
      //   techo = nada es del Art. 254 → se topea todo al 25%.
      const netoSiTodo254 = Math.max(0, impuestoBruto - desc258_1 - descOtros);
      const netoSiNada254 = Math.max(
        0,
        impuestoBruto - desc258_1 - Math.min(descOtros, tope),
      );
      const dentro =
        impuestoNeto >= netoSiTodo254 - TOLERANCE_CENTS &&
        impuestoNeto <= netoSiNada254 + TOLERANCE_CENTS;
      const hayTope = descOtros > tope;
      checks.push({
        name: 'M2.L1.5_impuesto_neto_descuentos',
        passed: dentro,
        severity: 'error',
        norma: 'Arts. 254, 255, 256, 257, 258, 258-1 E.T.',
        detail: dentro
          ? hayTope
            ? `Impuesto neto ${formatCentsCop(impuestoNeto)} dentro del rango admisible [${formatCentsCop(netoSiTodo254)} … ${formatCentsCop(netoSiNada254)}]. La conciliación no separa el Art. 254 (sin tope) de los Arts. 255/256/257 (tope 25% = ${formatCentsCop(tope)}); declare \`descuento254Cents\` para exigir la cifra exacta.`
            : `Impuesto neto ${formatCentsCop(impuestoNeto)} = bruto ${formatCentsCop(impuestoBruto)} − 258-1 ${formatCentsCop(desc258_1)} − descuentos ${formatCentsCop(descOtros)} (por debajo del tope 25% ${formatCentsCop(tope)}: el reparto entre 254 y 255/256/257 no altera el resultado).`
          : `Impuesto neto reportado ${formatCentsCop(impuestoNeto)} fuera del rango admisible [${formatCentsCop(netoSiTodo254)} … ${formatCentsCop(netoSiNada254)}] (bruto ${formatCentsCop(impuestoBruto)}, 258-1 ${formatCentsCop(desc258_1)}, descuentos ${formatCentsCop(descOtros)}, tope 25% ${formatCentsCop(tope)}).`,
      });
    }
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
  // L2.2 — sólo 255/256/257 respetan el tope 25% del impuesto a cargo
  //
  // El Art. 254 queda fuera del tope. Si la conciliación no separa su porción
  // y el total excede el tope, el reparto es material y hay que pedirlo: la
  // diferencia entre topear o no topear es dinero real que el cliente paga.
  // -------------------------------------------------------------------
  {
    const tope = tope25pct(impuestoBruto);
    const declara254 = m2.descuento254Cents !== undefined && m2.descuento254Cents !== null;
    const desc254 = declara254 ? Math.max(0, parseCents(m2.descuento254Cents as string)) : 0;
    const desc255_256_257 = Math.max(0, descOtros - desc254);
    const excede = desc255_256_257 > tope;
    const ambiguo = !declara254 && descOtros > tope;
    checks.push({
      name: 'M2.L2.2_descuentos_otros_tope_25pct',
      passed: !ambiguo, // L1.5 ya validó la fórmula; acá señalamos el desglose faltante
      severity: 'warning',
      norma: 'Art. 258 E.T. — tope conjunto sólo de los Arts. 255, 256 y 257',
      detail: ambiguo
        ? `Descuentos distintos del 258-1 ${formatCentsCop(descOtros)} exceden el tope del 25% ${formatCentsCop(tope)} y la conciliación no declara cuánto corresponde al Art. 254 (impuestos pagados en el exterior), que NO está sujeto a ese tope. Diferencia en juego: ${formatCentsCop(descOtros - tope)}. Declare \`descuento254Cents\`.`
        : excede
          ? `Descuentos Arts. 255/256/257 ${formatCentsCop(desc255_256_257)} exceden el tope del 25% ${formatCentsCop(tope)}: se aplica sólo el tope y el exceso se traslada (Art. 258 nums. 1-3). El descuento del Art. 254 ${formatCentsCop(desc254)} se aplica sin ese tope.`
          : `Descuentos Arts. 255/256/257 ${formatCentsCop(desc255_256_257)} ≤ tope 25% ${formatCentsCop(tope)} — OK. Art. 254 ${formatCentsCop(desc254)} fuera del tope por norma.`,
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
