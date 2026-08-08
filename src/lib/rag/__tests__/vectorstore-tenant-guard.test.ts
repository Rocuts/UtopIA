// ---------------------------------------------------------------------------
// Regresion — RAG: ningun upload de usuario puede entrar al corpus GLOBAL
// ---------------------------------------------------------------------------
//
// Hallazgo (medido contra produccion 2026-08): 1.892 chunks con
// doc_type='user_upload' y workspace_id NULL viviendo en el pool global — 3
// balances de prueba y un documento de defensa ante la DIAN de clientes
// reales, recuperables por CUALQUIER tenant via `search_docs`. El ultimo es de
// 2026-05-28 y el leak del lado del caller se cerro el 2026-06-10 (8ff6c0ab),
// asi que son residuos; pero la libreria seguia SIN defensa propia: cualquier
// caller nuevo que olvidara `workspaceId` reabria la fuga en silencio.
//
// El contrato aqui es "falla ruidosa": un upload sin tenant es un error de
// programacion, no un caso degradado. Devolver 0 lo haria indistinguible de
// "el embedding fallo" y volveria a pasar desapercibido.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/client', () => ({ getDb: vi.fn() }));
vi.mock('../init', () => ({ initRagSchema: vi.fn().mockResolvedValue(undefined) }));
vi.mock('ai', async (importActual) => {
  const actual = await importActual<typeof import('ai')>();
  return { ...actual, embedMany: vi.fn(), rerank: vi.fn() };
});
vi.mock('@ai-sdk/openai', () => ({
  openai: { embedding: vi.fn(() => 'mock-embedding-model') },
}));
vi.mock('@/lib/config/models', () => ({
  MODEL_IDS: { EMBEDDINGS: 'text-embedding-3-small' },
}));

import { embedMany } from 'ai';
import { getDb } from '@/lib/db/client';
import { addDocumentsToStore } from '../vectorstore';

const mockEmbedMany = vi.mocked(embedMany);
const mockGetDb = vi.mocked(getDb);

const WORKSPACE = '11111111-2222-3333-4444-555555555555';
const TEXTO = 'Balance de prueba America SAS — cuenta 1105 caja 12.500.000';

function mockOk() {
  mockEmbedMany.mockResolvedValue({ embeddings: [[0.1, 0.2]] } as never);
  const execute = vi.fn().mockResolvedValue([]);
  mockGetDb.mockReturnValue({ execute } as never);
  return execute;
}

describe('addDocumentsToStore — guardia multi-tenant', () => {
  beforeEach(() => vi.clearAllMocks());

  it('LANZA cuando un user_upload llega sin workspaceId (no lo escribe en el corpus global)', async () => {
    const execute = mockOk();

    await expect(
      addDocumentsToStore([TEXTO], { source: 'BALANCE DE PRUEBA AMERICA SAS.xlsx' }),
    ).rejects.toThrow(/workspaceId/i);

    // Lo critico no es el throw sino que NO haya INSERT.
    expect(execute).not.toHaveBeenCalled();
  });

  it('LANZA tambien cuando docType se pasa explicitamente como user_upload sin tenant', async () => {
    const execute = mockOk();

    await expect(
      addDocumentsToStore([TEXTO], {
        source: 'DEFENSA DIAN- REQUERIMIENTO DE IVA.docx',
        docType: 'user_upload',
      }),
    ).rejects.toThrow(/workspaceId/i);
    expect(execute).not.toHaveBeenCalled();
  });

  it('LANZA cuando workspaceId viene vacio o en blanco (no basta con que la clave exista)', async () => {
    const execute = mockOk();

    await expect(
      addDocumentsToStore([TEXTO], { source: 'x.xlsx', workspaceId: '   ' }),
    ).rejects.toThrow(/workspaceId/i);
    expect(execute).not.toHaveBeenCalled();
  });

  it('acepta el upload cuando SI trae workspaceId y lo escribe scoped al tenant', async () => {
    const execute = mockOk();

    const n = await addDocumentsToStore([TEXTO], {
      source: 'BALANCE DE PRUEBA AMERICA SAS.xlsx',
      workspaceId: WORKSPACE,
    });

    expect(n).toBeGreaterThan(0);
    expect(execute).toHaveBeenCalled();
    expect(JSON.stringify(execute.mock.calls[0]?.[0])).toContain(WORKSPACE);
  });

  it('sigue permitiendo ingesta GLOBAL de corpus normativo (docType != user_upload, sin tenant)', async () => {
    const execute = mockOk();

    const n = await addDocumentsToStore(['Art. 240 E.T. — tarifa general del impuesto sobre la renta.'], {
      source: 'estatuto_tributario_completo.md',
      docType: 'estatuto',
    });

    expect(n).toBeGreaterThan(0);
    expect(execute).toHaveBeenCalled();
  });
});
