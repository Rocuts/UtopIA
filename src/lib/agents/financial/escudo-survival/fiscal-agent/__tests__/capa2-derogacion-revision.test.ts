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
