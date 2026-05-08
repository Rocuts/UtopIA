/**
 * Tests unitarios — getMacroFactors service
 *
 * Escenarios:
 *   1. Default fallback: todas las APIs externas fallan → retorna defaults hardcoded.
 *   2. Cache hit: fila DB < 24h → no llama fetch externo.
 *   3. Cache miss: fila DB > 24h → llama fetch + persiste.
 *   4. Force refresh: force=true ignora cache válida → llama fetch.
 *   5. Sin fila en DB: primera vez → llama fetch y persiste.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks de módulos ───────────────────────────────────────────────────────

// Mock del cliente BanRep/DANE (se declara ANTES de importar service).
vi.mock('@/lib/macro/banrep-client', () => ({
  fetchTRM: vi.fn(),
  fetchIPC: vi.fn(),
  fetchTasaBanRep: vi.fn(),
}));

// Mock de DB client.
const mockInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
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

// ─── Helpers ───────────────────────────────────────────────────────────────

const FRESH_DATE = new Date(Date.now() - 1 * 60 * 60 * 1000); // 1h ago
const STALE_DATE = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25h ago

function makeCachedRow(date: Date) {
  return {
    id: 1,
    ipc: 0.05,
    trm: 4215,
    tasaBanRep: 0.0925,
    fuente: 'banrep',
    fechaActualizacion: date,
  };
}

/** Configura el mock de DB para retornar una fila con fecha dada. */
function mockDbWithRow(row: ReturnType<typeof makeCachedRow>) {
  mockSelect.mockReturnValue({
    from: vi.fn().mockReturnValue({
      orderBy: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([row]),
      }),
    }),
  });
}

/** Configura el mock de DB para retornar sin filas (primera vez). */
function mockDbEmpty() {
  mockSelect.mockReturnValue({
    from: vi.fn().mockReturnValue({
      orderBy: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
      }),
    }),
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('getMacroFactors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Por defecto insert es no-op.
    mockInsert.mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('1. Default fallback — todas las APIs fallan → retorna defaults', async () => {
    mockDbEmpty();
    vi.mocked(banrepClient.fetchTRM).mockResolvedValue(null);
    vi.mocked(banrepClient.fetchIPC).mockResolvedValue(null);
    vi.mocked(banrepClient.fetchTasaBanRep).mockResolvedValue(null);

    const result = await getMacroFactors();

    expect(result.ipc).toBe(0.045);
    expect(result.trm).toBe(4200);
    expect(result.tasaBanRep).toBe(0.0925);
    expect(result.fuente).toBe('default');
    expect(result.fechaActualizacion).toBeTruthy();
  });

  it('2. Cache hit — fila < 24h → no llama APIs externas', async () => {
    mockDbWithRow(makeCachedRow(FRESH_DATE));

    const result = await getMacroFactors();

    expect(result.ipc).toBe(0.05);
    expect(result.trm).toBe(4215);
    expect(result.fuente).toBe('banrep');
    // NO debe haber llamado a las APIs externas.
    expect(banrepClient.fetchTRM).not.toHaveBeenCalled();
    expect(banrepClient.fetchIPC).not.toHaveBeenCalled();
    expect(banrepClient.fetchTasaBanRep).not.toHaveBeenCalled();
  });

  it('3. Cache miss — fila > 24h → llama fetch y persiste', async () => {
    mockDbWithRow(makeCachedRow(STALE_DATE));
    vi.mocked(banrepClient.fetchTRM).mockResolvedValue(4230.5);
    vi.mocked(banrepClient.fetchIPC).mockResolvedValue(0.048);
    vi.mocked(banrepClient.fetchTasaBanRep).mockResolvedValue(0.0925);

    const result = await getMacroFactors();

    expect(result.trm).toBe(4230.5);
    expect(result.ipc).toBe(0.048);
    expect(result.fuente).toBe('banrep');
    expect(banrepClient.fetchTRM).toHaveBeenCalledOnce();
    // insert debe haberse llamado para persistir.
    expect(mockInsert).toHaveBeenCalled();
  });

  it('4. Force refresh — ignora cache válida → llama APIs', async () => {
    mockDbWithRow(makeCachedRow(FRESH_DATE));
    vi.mocked(banrepClient.fetchTRM).mockResolvedValue(4250);
    vi.mocked(banrepClient.fetchIPC).mockResolvedValue(null);
    vi.mocked(banrepClient.fetchTasaBanRep).mockResolvedValue(0.09);

    const result = await getMacroFactors({ force: true });

    expect(result.trm).toBe(4250);
    // IPC falló → usa default.
    expect(result.ipc).toBe(0.045);
    expect(banrepClient.fetchTRM).toHaveBeenCalledOnce();
  });

  it('5. Sin fila DB (primera vez) → fetch + persist', async () => {
    mockDbEmpty();
    vi.mocked(banrepClient.fetchTRM).mockResolvedValue(4200);
    vi.mocked(banrepClient.fetchIPC).mockResolvedValue(0.05);
    vi.mocked(banrepClient.fetchTasaBanRep).mockResolvedValue(0.0925);

    const result = await getMacroFactors();

    expect(result.trm).toBe(4200);
    expect(result.ipc).toBe(0.05);
    expect(result.fuente).toBe('banrep');
    expect(mockInsert).toHaveBeenCalled();
  });
});
