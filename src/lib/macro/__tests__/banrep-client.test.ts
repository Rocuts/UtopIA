// valoracion-05 — El cliente macro normalizaba con `parsed > 1 ? /100 : parsed`
// (0,39 % mensual ⇒ 39 %), aceptaba cualquier columna 'tasa'/'valor' de un
// dataset que el propio comentario describía como TRM (TRM 3208,66 ⇒ 3.208 %)
// y confundía la TIB con la tasa de intervención. Tampoco registraba la fecha
// de vigencia del dato.
import { describe, it, expect, vi, afterEach } from 'vitest';

import { fetchIPC, fetchTRM, fetchTasaBanRep } from '../banrep-client';

function mockFetchJson(body: unknown, ok = true) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok,
    json: async () => body,
  } as Response);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchTRM (SFC · datos.gov.co 32sa-8pi3)', () => {
  it('lee valor COP con su fecha de vigencia y fuente', async () => {
    mockFetchJson([{ valor: '3208.66', vigenciadesde: '2026-09-23T00:00:00.000' }]);
    const r = await fetchTRM();
    expect(r.reading).toEqual({ value: 3208.66, asOf: '2026-09-23', source: 'superfinanciera' });
  });

  it('rechaza valores fuera de rango plausible (1.000–10.000 COP/USD)', async () => {
    mockFetchJson([{ valor: '32.0866', vigenciadesde: '2026-09-23T00:00:00.000' }]);
    const r = await fetchTRM();
    expect(r.reading).toBeNull();
    expect(r.reason).toMatch(/rango/);
  });

  it('rechaza filas sin fecha de vigencia', async () => {
    mockFetchJson([{ valor: '3208.66' }]);
    expect((await fetchTRM()).reading).toBeNull();
  });
});

describe('fetchIPC (variación ANUAL en porcentaje)', () => {
  it('una variación mensual 0,39 no se convierte en 39 % (columna no anual ⇒ rechazada)', async () => {
    mockFetchJson([{ variacion: '0.39', fecha: '2026-08-01' }]);
    const r = await fetchIPC();
    expect(r.reading).toBeNull();
  });

  it('variación anual en porcentaje ⇒ decimal, con periodo', async () => {
    mockFetchJson([{ variacion_anual: '6.24', fecha: '2026-08-01T00:00:00.000' }]);
    const r = await fetchIPC();
    expect(r.reading?.value).toBeCloseTo(0.0624, 10);
    expect(r.reading?.asOf).toBe('2026-08-01');
    expect(r.reading?.source).toBe('dane');
  });

  it('valor fuera de rango (−5 % a 30 %) o sin fecha ⇒ null', async () => {
    mockFetchJson([{ variacion_anual: '62.4', fecha: '2026-08-01' }]);
    expect((await fetchIPC()).reading).toBeNull();
    vi.restoreAllMocks();
    mockFetchJson([{ variacion_anual: '6.24' }]);
    expect((await fetchIPC()).reading).toBeNull();
  });
});

describe('fetchTasaBanRep', () => {
  it('no lee la TRM ni la TIB como tasa de intervención: N/D con motivo', async () => {
    const spy = mockFetchJson([{ valor: '3208.66', fecha: '2026-09-23' }]);
    const r = await fetchTasaBanRep();
    expect(r.reading).toBeNull();
    expect(r.reason).toMatch(/intervenci/i);
    expect(spy).not.toHaveBeenCalled();
  });
});
