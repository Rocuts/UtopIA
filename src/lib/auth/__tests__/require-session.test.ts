// ---------------------------------------------------------------------------
// Regresión — requireAuthSession contrato de fases.
//
// Fase 1 (BETTER_AUTH_SECRET ausente): MUST ser no-op { ok: true } para
// preservar el comportamiento anónimo actual en dev/pre-auth. Si esto se
// rompiera, las 15 rutas costosas devolverían 401 sin auth configurada y
// tumbarían la app entera.
//
// La fase 2 (validación real contra DB) requiere next/headers + el cliente
// BetterAuth + tablas migradas — se verifica en integración / E2E, no aquí.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { requireAuthSession } from '../require-session';

describe('requireAuthSession — fase 1 (sin BETTER_AUTH_SECRET)', () => {
  const original = process.env.BETTER_AUTH_SECRET;

  beforeEach(() => {
    delete process.env.BETTER_AUTH_SECRET;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = original;
  });

  it('es no-op y devuelve { ok: true } cuando auth no está configurada', async () => {
    const result = await requireAuthSession();
    expect(result).toEqual({ ok: true });
  });

  it('no intenta cargar el cliente de auth en fase 1 (no lanza sin DB)', async () => {
    // Sin secret, NO debe tocar next/headers ni @/lib/auth/config (que abriría
    // un pool pg). Si lo hiciera, esto lanzaría en el entorno de test.
    await expect(requireAuthSession()).resolves.toEqual({ ok: true });
  });
});
