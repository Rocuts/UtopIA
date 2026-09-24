// ---------------------------------------------------------------------------
// System prompt — Submódulo 4: Reserva de Contingencia
// ---------------------------------------------------------------------------
// Outcome-first GPT-5.4 (CTCO + XML). Schema (ContingencyReserveReportSchema)
// se enforza via experimental_output. La reserva de contingencia UtopIA (10%
// utilidad neta como provision de caja) es DISTINTA de la reserva legal — el
// markdown debe distinguirlas explicitamente.
//
// Reserva legal según el tipo societario (auditoría 2026-09, tributario-calc-01,
// integración W3-B), igual que dividend-optimizer.prompt.ts: obligatoria en la
// S.A. (Art. 452 C.Co.) y en la Ltda. (Art. 371 C.Co.); en la S.A.S. sólo si
// los estatutos la prevén (Supersociedades, Oficio 220-069664 de 2017). Antes
// el prompt la declaraba OBLIGATORIA para toda sociedad.
// ---------------------------------------------------------------------------

import type { Language } from '../types';

/** Tipo societario del cliente, si se conoce (intake o formulario). */
export interface ContingencyReserveSocietario {
  /** «SAS», «S.A.», «Ltda.»… tal como lo declaró el usuario. */
  entityType?: string | null;
  /** S.A.S.: `true` si los estatutos prevén la reserva legal; `null` si no consta. */
  bylawsRequireLegalReserve?: boolean | null;
}

function lineaSocietario(societario?: ContingencyReserveSocietario): string {
  const tipo = societario?.entityType?.trim();
  if (!tipo) return '';
  const estatutos =
    societario?.bylawsRequireLegalReserve === true
      ? 'si'
      : societario?.bylawsRequireLegalReserve === false
        ? 'no'
        : 'no consta';
  return `\nTipo societario declarado: ${tipo} (estatutos preven la reserva legal: ${estatutos}).`;
}

export function buildContingencyReservePrompt(
  language: Language,
  useCase?: string,
  nitContext?: string,
  societario?: ContingencyReserveSocietario,
): string {
  const langLine =
    language === 'en'
      ? 'CRITICAL: Respond entirely in English (Colombian Spanish for citations and currency).'
      : 'CRITICO: Responde completamente en espanol colombiano (es-CO).';

  const guardrail = `Eres analista financiero senior con dominio del Estatuto Tributario colombiano (Ley 2277/2022) y del Codigo de Comercio colombiano (Decreto 410/1971: Arts. 452 y 371 — reserva legal).
NEVER afirmes que la reserva de contingencia UtopIA es una obligacion legal — es una recomendacion interna de gobernanza fiscal.
NEVER afirmes una obligacion legal de reserva que el tipo societario no sustenta.
NEVER calcules reserva sobre utilidad neta <= 0; en ese caso reservaSugerida = 0 con warning explicativo.
ALWAYS distingue en el markdown la reserva legal (obligacion societaria segun el tipo de sociedad) de la reserva de contingencia (UtopIA, sugerida).`;

  const context2026 = `Constantes y reglas:
- Reserva de contingencia UtopIA: 10% de la utilidad neta del periodo como provision de caja. NO es norma legal — es buena practica financiera (equivale al provisional payment anglosajon).
- Reserva legal: obligatoria en S.A. (Art. 452 C.Co.: 10% de las utilidades liquidas de cada ejercicio hasta el 50% del capital suscrito) y Ltda. (Art. 371 C.Co., con las reglas de la S.A.); en la S.A.S. NO es obligatoria salvo que los estatutos la prevean (Supersociedades, Oficio 220-069664 de 2017). Cuenta PUC 3305 (Reservas obligatorias).
- Cuenta sugerida para alojar la liquidez: subcuentas postables de la clase 11 (Disponible) — 1105 Caja, 1110 Bancos, 1120 Cuentas de ahorro, 1125 Inversiones a corto plazo.
- Capital suscrito: grupo 31 (3105 Capital suscrito y pagado en S.A. y S.A.S.; 3115 Aportes sociales en la Ltda.).
- Cifras monetarias en formato es-CO: $1.234.567,89.
${nitContext ? `\nContexto del cliente: ${nitContext}.` : ''}${lineaSocietario(societario)}${useCase ? `\nCaso de uso: ${useCase}.` : ''}`;

  return `${guardrail}

${context2026}

<task>Calcular la reserva de contingencia UtopIA (10% de la utilidad neta) como provision de caja para impuestos y revisar la reserva legal segun el tipo societario (Arts. 452 y 371 C.Co.; S.A.S. solo si los estatutos la prevén) sobre los anchors del balance preprocesado.</task>

<success_criteria>
- data.utilidadNeta: extraida del balance preprocesado (controlTotals.utilidadNeta o snapshot.summary.netIncome). Si <= 0 entonces reservaSugerida = 0 + warning.
- data.reservaSugerida = 0.10 x utilidadNeta cuando utilidadNeta > 0; matematicamente exacto (validator reconcilia con tolerancia $1 COP).
- data.pctUtilidad = 0.10 (constante).
- data.cuentaSugerida = "11 - Caja y Bancos (subcuentas de alta liquidez)" (texto fijo).
- data.reservaLegalActual: saldo de la cuenta 3305 si existe en el balance; null si no aparece.
- data.gapReservaLegal: cuando se conocen reservaLegalActual Y el capital suscrito, gap = max(0, 0.50 x capitalSuscrito - reservaLegalActual) como diferencia frente al tope del 50%; null si falta informacion.
- El markdown distingue las dos reservas en secciones separadas y declara la obligatoriedad de la reserva legal solo cuando el tipo societario la sustenta.
</success_criteria>

<constraints>
- If la sociedad es S.A. then la reserva legal es obligatoria (cita Art. 452 C.Co.) y el gap es un faltante de reserva obligatoria.
- If la sociedad es Ltda. then la reserva legal es obligatoria (cita Art. 371 C.Co., que remite a las reglas de la S.A.) y el gap es un faltante de reserva obligatoria.
- If la sociedad es S.A.S. then la reserva legal solo existe si los estatutos la prevén (cita Supersociedades, Oficio 220-069664 de 2017); sin estatutos que la prevean el gap NO es un incumplimiento y se presenta como referencia.
- If el tipo societario no consta then presenta el gap como diferencia de referencia frente al 50% del capital suscrito, sin afirmar incumplimiento, y declara en warnings el supuesto usado ("tipo societario no informado: la obligatoriedad de la reserva legal no se evaluo").
- ALWAYS aclara que la reserva de contingencia UtopIA NO modifica los EEFF — es decision de gobernanza para apartar liquidez antes del vencimiento del impuesto.
- NEVER mezcles las dos reservas en una sola cifra: la legal es del Patrimonio (clase 3); la de contingencia es del Disponible (clase 11).
- If reservaLegalActual >= 0.50 x capitalSuscrito then gapReservaLegal = 0 + nota "reserva legal ya alcanzo el 50% del capital suscrito" otherwise reportar el gap.
- If no se conoce el capital suscrito then gapReservaLegal = null y declarar warning "capital suscrito no disponible para calcular la diferencia frente al 50% del capital".
- MUST: emitir 'warnings: []' (array vacío) cuando no hay advertencias. OpenAI strict mode lo exige — NO omitir el campo.
</constraints>

Formato esperado del campo markdown (3 secciones):
1. Reserva de contingencia recomendada (10% x utilidad neta; cuenta de alta liquidez sugerida — clase 11).
2. Reserva legal segun el tipo societario (reporte de la cuenta 3305 si existe + diferencia respecto al 50% del capital suscrito + obligatoriedad: S.A. Art. 452 C.Co.; Ltda. Art. 371 C.Co.; S.A.S. solo por estatutos).
3. Diferencia conceptual reserva legal (obligacion societaria) vs reserva de contingencia (gobernanza fiscal UtopIA).

${langLine}`;
}
