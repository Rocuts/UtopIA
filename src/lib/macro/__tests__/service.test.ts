/**
 * Tests unitarios — getMacroFactors service
 *
 * valoracion-04: el servicio sustituía cada serie fallida por DEFAULTS
 * (IPC 4,5 %, TRM 4.200, tasa 9,25 %), marcaba todo con fuente 'banrep' si
 * llegaba la TRM o la tasa y fechaba el registro con la hora de la consulta.
 * Las pruebas previas codificaban ese comportamiento ("1. Default fallback");
 * se reemplazan por el contrato por campo: valor o null, fuente, fecha de
 * vigencia, fecha de consulta y marca `stale` para el último valor bueno.
 *
 * Escenarios:
 *   1. Todas las series fallan → null por campo con motivo (nunca defaults).
 *   2. TRM ok, IPC/tasa fallan → sólo la TRM con su fuente y vigencia.
 *   3. Cache v2 fresca → no llama APIs, respeta nulls por campo.
 *   4. Fila legada (sin procedencia por campo) → se ignora y se consulta.
 *   5. Fallo de una serie con último valor bueno → stale con su fecha original.
 *   6. Persistencia v2 con procedencia por campo.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/macro/banrep-client', () => ({
  fetchTRM: vi.fn(),
  fetchIPC: vi.fn(),
  fetchTasaBanRep: vi.fn(),
}));

const mockValues = vi.fn().mockResolvedValue(undefined);
const mockInsert = vi.fn().mockReturnValue({ values: mockValues });
const mockSelect = vi.fn();

vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(() => ({
    select: mockSelect,
    insert: mockInsert,
  })),
}));

vi.mock('@/lib/db/schema', () => ({
  macroFactors: 'macro_factors_table_symbol',
}));

import * as banrepClient from '@/lib/macro/banrep-client';
import { getMacroFactors } from '../service';

const FRESH_DATE = new Date(Date.now() - 1 * 60 * 60 * 1000); // 1h
const STALE_DATE = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25h

function mockDbRows(rows: unknown[]) {
  mockSelect.mockReturnValue({
    from: vi.fn().mockReturnValue({
      orderBy: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rows),
      }),
    }),
  });
}

const NONE = { reading: null, reason: 'sin dato' };
const trmOk = { reading: { value: 3208.66, asOf: '2026-09-23', source: 'superfinanciera' as const }, reason: null };

function v2Row(date: Date, prov: Record<string, unknown>, nums = { ipc: 0.0624, trm: 3300, tasaBanRep: 0 }) {
  return { id: 1, ...nums, fuente: JSON.stringify({ v: 2, ...prov }), fechaActualizacion: date };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockInsert.mockReturnValue({ values: mockValues });
});

describe('getMacroFactors — procedencia por campo, sin defaults', () => {
  it('1. todas las series fallan → null con motivo, nunca 4,5 % / 4.200 / 9,25 %', async () => {
    mockDbRows([]);
    vi.mocked(banrepClient.fetchTRM).mockResolvedValue(NONE);
    vi.mocked(banrepClient.fetchIPC).mockResolvedValue(NONE);
    vi.mocked(banrepClient.fetchTasaBanRep).mockResolvedValue(NONE);

    const r = await getMacroFactors();
    for (const f of [r.ipc, r.trm, r.tasaBanRep]) {
      expect(f.value).toBeNull();
      expect(f.source).toBeNull();
      expect(f.reason).toBeTruthy();
    }
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('2. TRM ok e IPC/tasa fallidos → sólo la TRM, con fuente y vigencia propias', async () => {
    mockDbRows([]);
    vi.mocked(banrepClient.fetchTRM).mockResolvedValue(trmOk);
    vi.mocked(banrepClient.fetchIPC).mockResolvedValue(NONE);
    vi.mocked(banrepClient.fetchTasaBanRep).mockResolvedValue({ reading: null, reason: 'tasa de intervención: serie no configurada' });

    const r = await getMacroFactors();
    expect(r.trm).toMatchObject({ value: 3208.66, source: 'superfinanciera', asOf: '2026-09-23', stale: false });
    expect(r.trm.fetchedAt).toBeTruthy();
    expect(r.ipc.value).toBeNull();
    expect(r.tasaBanRep.value).toBeNull();
    expect(r.tasaBanRep.reason).toMatch(/intervención/);
  });

  it('3. cache v2 fresca → no consulta APIs y respeta los null por campo', async () => {
    mockDbRows([
      v2Row(FRESH_DATE, {
        trm: { asOf: '2026-09-22', source: 'superfinanciera', fetchedAt: FRESH_DATE.toISOString() },
        ipc: { asOf: '2026-08-01', source: 'dane', fetchedAt: FRESH_DATE.toISOString() },
        tasaBanRep: null,
      }),
    ]);
    const r = await getMacroFactors();
    expect(r.trm.value).toBe(3300);
    expect(r.ipc.value).toBe(0.0624);
    expect(r.tasaBanRep.value).toBeNull(); // la columna numérica (0) no se publica
    expect(banrepClient.fetchTRM).not.toHaveBeenCalled();
  });

  it('4. fila legada sin procedencia por campo (pudo traer defaults) → se ignora', async () => {
    mockDbRows([{ id: 1, ipc: 0.045, trm: 4200, tasaBanRep: 0.0925, fuente: 'banrep', fechaActualizacion: FRESH_DATE }]);
    vi.mocked(banrepClient.fetchTRM).mockResolvedValue(trmOk);
    vi.mocked(banrepClient.fetchIPC).mockResolvedValue(NONE);
    vi.mocked(banrepClient.fetchTasaBanRep).mockResolvedValue(NONE);

    const r = await getMacroFactors();
    expect(banrepClient.fetchTRM).toHaveBeenCalledOnce();
    expect(r.ipc.value).toBeNull(); // no el 0,045 de la fila legada
  });

  it('5. serie fallida con último valor bueno → stale con su vigencia original', async () => {
    mockDbRows([
      v2Row(STALE_DATE, {
        trm: { asOf: '2026-09-20', source: 'superfinanciera', fetchedAt: STALE_DATE.toISOString() },
        ipc: null,
        tasaBanRep: null,
      }),
    ]);
    vi.mocked(banrepClient.fetchTRM).mockResolvedValue(NONE);
    vi.mocked(banrepClient.fetchIPC).mockResolvedValue(NONE);
    vi.mocked(banrepClient.fetchTasaBanRep).mockResolvedValue(NONE);

    const r = await getMacroFactors();
    expect(r.trm).toMatchObject({ value: 3300, asOf: '2026-09-20', stale: true });
    expect(r.trm.fetchedAt).toBe(STALE_DATE.toISOString());
  });

  it('6. persiste v2 con procedencia por campo', async () => {
    mockDbRows([]);
    vi.mocked(banrepClient.fetchTRM).mockResolvedValue(trmOk);
    vi.mocked(banrepClient.fetchIPC).mockResolvedValue(NONE);
    vi.mocked(banrepClient.fetchTasaBanRep).mockResolvedValue(NONE);

    await getMacroFactors({ force: true });
    expect(mockInsert).toHaveBeenCalled();
    const row = mockValues.mock.calls[0][0] as { fuente: string; trm: number };
    const prov = JSON.parse(row.fuente);
    expect(prov.v).toBe(2);
    expect(prov.trm).toMatchObject({ asOf: '2026-09-23', source: 'superfinanciera' });
    expect(prov.ipc).toBeNull();
    expect(row.trm).toBe(3208.66);
  });
});
