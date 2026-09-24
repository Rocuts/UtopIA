// ---------------------------------------------------------------------------
// Capa 2 — Art. 36-3 E.T. derogado: revisión adversarial de la regla 3(b)
// ---------------------------------------------------------------------------
// Decisión del coordinador (I4-escudo 3b): una cita DEROGADA en una frase que
// afirma su derogación pasa como advertencia; citarla como vigente sigue
// bloqueando. La primera versión de la regla fallaba en ambos sentidos:
//   - negaciones que no reconocía («nunca fue derogado», «jamás fue
//     derogado», «no se ha derogado», «wasn't repealed») afirmaban la
//     vigencia y pasaban como advertencia;
//   - un paréntesis tras «E.T.» partía la frase («Art. 36-3 E.T. (derogado
//     por …)») y «derogatoria» / «the repeal of» no contaban como derogación:
//     menciones honestas quedaban en bloqueo.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { MOTOR_NORMATIVO_CATALOG } from '../../normative';
import { validateNormativeResponse } from '../../normative/validators/normative.validator';

function veredicto(texto: string, cita = 'Art. 36-3 E.T.'): string | undefined {
  const r = validateNormativeResponse(texto, MOTOR_NORMATIVO_CATALOG);
  return r.citations.find((c) => c.citation.normalized === cita)?.veredicto;
}

describe('Art. 36-3 E.T. — negaciones de la derogación siguen bloqueando', () => {
  it.each([
    'El Art. 36-3 E.T. nunca fue derogado.',
    'El Art. 36-3 E.T. jamás fue derogado y permite capitalizar sin impuesto.',
    'El Art. 36-3 E.T. no se ha derogado.',
    'El Art. 36-3 E.T. no fue objeto de derogación.',
    'El Art. 36-3 E.T. sigue produciendo efectos sin haber sido derogado.',
    "Art. 36-3 E.T. wasn't repealed.",
    'Art. 36-3 E.T. has never been repealed.',
  ])('%s ⇒ bloqueo', (t) => {
    expect(veredicto(t)).toBe('bloqueo');
  });
});

describe('Art. 36-3 E.T. — menciones honestas de la derogación advierten', () => {
  it.each([
    'El Art. 36-3 E.T. (derogado por el art. 96 de la Ley 2277 de 2022) no aplica a la capitalización.',
    'Art. 36-3 E.T. (repealed by Law 2277 of 2022, art. 96).',
    'Capitalización de utilidades tras la derogatoria del Art. 36-3 E.T.',
    'Following the repeal of Art. 36-3 E.T., capitalisation is taxed as a distribution.',
    'El Art. 36-3 E.T. no aplica porque fue derogado por la Ley 2277 de 2022.',
  ])('%s ⇒ advertencia', (t) => {
    expect(veredicto(t)).toBe('advertencia');
  });
});

// ---------------------------------------------------------------------------
// Re-auditoría 2026-09-24 (NT-09): la palabra de derogación no protege una
// frase que presenta el Art. 36-3 como aplicable, y la cita sin «E.T.» del
// artículo derogado también se valida.
// ---------------------------------------------------------------------------
describe('NT-09 — Art. 36-3 presentado como aplicable', () => {
  it.each([
    'Aunque fue derogado, el Art. 36-3 E.T. sigue siendo aplicable a las capitalizaciones de 2026.',
    'El Art. 36-3 E.T. permite capitalizar utilidades sin impuesto pese a la propuesta de derogación.',
    'Art. 36-3 E.T. is yet to be repealed, so the capitalization is tax-free.',
    'La derogación del Art. 36-3 E.T. quedó sin efecto, por lo que la capitalización no está gravada.',
  ])('%s ⇒ bloqueo', (t) => {
    expect(veredicto(t)).toBe('bloqueo');
  });

  it('sin «E.T.»: «Con el Art. 36-3 se capitalizan utilidades sin impuesto» ⇒ bloqueo', () => {
    const r = validateNormativeResponse('Con el Art. 36-3 se pueden capitalizar utilidades sin impuesto para el socio.', MOTOR_NORMATIVO_CATALOG);
    expect(r.citations.map((c) => [c.citation.normalized, c.veredicto])).toEqual([['Art. 36-3 E.T.', 'bloqueo']]);
    expect(r.veredictoGlobal).toBe('bloqueo');
  });

  it.each([
    'La capitalización de utilidades sigue este régimen general de distribución (Art. 36-3 derogado).',
    'El Art. 36-3 E.T., que permitía capitalizar sin impuesto, fue derogado por la Ley 2277 de 2022.',
    'El Art. 36-3 E.T. fue derogado, por lo que es aplicable el régimen de dividendos (Art. 242 E.T.).',
    'Art. 36-3 del E.T. derogado desde el 1-ene-2023: capitalizar tributa como distribuir.',
  ])('menciones honestas siguen advirtiendo: %s', (t) => {
    expect(veredicto(t)).toBe('advertencia');
  });

  it('el «Art. 36-3» de otra norma o de un artículo vigente no se extrae', () => {
    const r = validateNormativeResponse('El Art. 36-3 de la Ley 9999 de 2030 y el Art. 240 regulan otra materia.', MOTOR_NORMATIVO_CATALOG);
    expect(r.citations.some((c) => c.citation.normalized === 'Art. 36-3 E.T.')).toBe(false);
    expect(r.citations.some((c) => c.citation.normalized === 'Art. 240 E.T.')).toBe(false);
  });
});
