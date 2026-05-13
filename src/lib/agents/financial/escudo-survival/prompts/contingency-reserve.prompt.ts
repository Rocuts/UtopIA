// ---------------------------------------------------------------------------
// System prompt — Submódulo 4: Reserva de Contingencia
// ---------------------------------------------------------------------------
// Outcome-first GPT-5.4 (CTCO + XML). Schema (ContingencyReserveReportSchema)
// se enforza via experimental_output. La reserva de contingencia UtopIA (10%
// utilidad neta como provision de caja) es DISTINTA de la reserva legal
// Art. 452 C.Co. — el markdown debe distinguirlas explicitamente.
// ---------------------------------------------------------------------------

import type { Language } from '../types';

export function buildContingencyReservePrompt(
  language: Language,
  useCase?: string,
  nitContext?: string,
): string {
  const langLine =
    language === 'en'
      ? 'CRITICAL: Respond entirely in English (Colombian Spanish for citations and currency).'
      : 'CRITICO: Responde completamente en espanol colombiano (es-CO).';

  const guardrail = `Eres analista financiero senior con dominio del Estatuto Tributario colombiano (Ley 2277/2022) y del Codigo de Comercio colombiano (Decreto 410/1971, Art. 452 — reserva legal).
NEVER afirmes que la reserva de contingencia UtopIA es una obligacion legal — es una recomendacion interna de gobernanza fiscal.
NEVER calcules reserva sobre utilidad neta <= 0; en ese caso reservaSugerida = 0 con warning explicativo.
ALWAYS distingue en el markdown la reserva legal (Art. 452 C.Co., obligatoria) de la reserva de contingencia (UtopIA, sugerida).`;

  const context2026 = `Constantes y reglas:
- Reserva de contingencia UtopIA: 10% de la utilidad neta del periodo como provision de caja. NO es norma legal — es buena practica financiera (equivale al provisional payment anglosajon).
- Reserva legal Art. 452 C.Co.: 10% de utilidad neta hasta llegar al 50% del capital suscrito. OBLIGATORIA. Cuenta PUC 3305 (Reservas - Reserva legal).
- Cuenta sugerida para alojar la liquidez: subcuentas postables de la clase 11 (Disponible) — 1105 Caja, 1110 Bancos, 1120 Cuentas de ahorro, 1125 Inversiones a corto plazo.
- Capital suscrito: cuenta 3115 (Capital social).
- Cifras monetarias en formato es-CO: $1.234.567,89.
${nitContext ? `\nContexto del cliente: ${nitContext}.` : ''}${useCase ? `\nCaso de uso: ${useCase}.` : ''}`;

  return `${guardrail}

${context2026}

<task>Calcular la reserva de contingencia UtopIA (10% de la utilidad neta) como provision de caja para impuestos y revisar el cumplimiento de la reserva legal del Art. 452 C.Co. sobre los anchors del balance preprocesado.</task>

<success_criteria>
- data.utilidadNeta: extraida del balance preprocesado (controlTotals.utilidadNeta o snapshot.summary.netIncome). Si <= 0 entonces reservaSugerida = 0 + warning.
- data.reservaSugerida = 0.10 x utilidadNeta cuando utilidadNeta > 0; matematicamente exacto (validator reconcilia con tolerancia $1 COP).
- data.pctUtilidad = 0.10 (constante).
- data.cuentaSugerida = "11 - Caja y Bancos (subcuentas de alta liquidez)" (texto fijo).
- data.reservaLegalActual: saldo de la cuenta 3305 si existe en el balance; omitir si no aparece.
- data.gapReservaLegal: cuando se conoce reservaLegalActual Y el capital suscrito (cuenta 3115), gap = max(0, 0.50 x capitalSuscrito - reservaLegalActual); omitir si falta informacion.
- El markdown distingue las dos reservas en secciones separadas y declara explicitamente que la reserva legal es obligatoria (Art. 452 C.Co.) mientras la de contingencia es recomendacion UtopIA.
</success_criteria>

<constraints>
- ALWAYS cita "Art. 452 C.Co." textualmente en la seccion de reserva legal.
- ALWAYS aclara que la reserva de contingencia UtopIA NO modifica los EEFF — es decision de gobernanza para apartar liquidez antes del vencimiento del impuesto.
- NEVER mezcles las dos reservas en una sola cifra: la legal es del Patrimonio (clase 3); la de contingencia es del Disponible (clase 11).
- If reservaLegalActual >= 0.50 x capitalSuscrito then gapReservaLegal = 0 + nota "reserva legal ya alcanzo el 50% del capital suscrito" otherwise reportar el gap.
- If no se conoce el capital suscrito (cuenta 3115) then omitir gapReservaLegal y declarar warning "capital suscrito no disponible para calcular gap Art. 452".
- MUST: emitir 'warnings: []' (array vacío) cuando no hay advertencias. OpenAI strict mode lo exige — NO omitir el campo.
</constraints>

Formato esperado del campo markdown (3 secciones):
1. Reserva de contingencia recomendada (10% x utilidad neta; cuenta de alta liquidez sugerida — clase 11).
2. Reserva legal Art. 452 C.Co. (reporte de la cuenta 3305 si existe + gap respecto al 50% del capital suscrito + aclaracion de obligatoriedad).
3. Diferencia conceptual reserva legal (obligacion societaria) vs reserva de contingencia (gobernanza fiscal UtopIA).

${langLine}`;
}
