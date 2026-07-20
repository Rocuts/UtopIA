// ---------------------------------------------------------------------------
// Regression — "Hechos del negocio · Ola 2": comportamiento del loader
// `getHechosEmpresaBlock` (narrative-only, exclusiones, normalización de año,
// degrade-safe). Test-only, con la capa DB mockeada.
// ---------------------------------------------------------------------------

import { vi, describe, it, expect, beforeEach } from 'vitest';

// `server-only` es un poison-pill de Next: no-op bajo Vitest.
vi.mock('server-only', () => ({}));
// Mock de la capa DB: `getHechosEmpresaBlock` la invoca internamente.
vi.mock('@/lib/db/facts', () => ({ getActiveFacts: vi.fn() }));

import { getActiveFacts } from '@/lib/db/facts';
import { getHechosEmpresaBlock } from '@/lib/facts/report-facts';
import type { WorkspaceFact } from '@/lib/db/schema';

// Row falsa completa: `selectNarrativeContents` solo lee id/kind/title/body,
// pero devolvemos un WorkspaceFact estructuralmente válido (cast tras defaults)
// para que `getActiveFacts` (tipado) acepte el `mockResolvedValue`.
function makeFact(
  over: Pick<WorkspaceFact, 'id' | 'kind' | 'title' | 'body'> & Partial<WorkspaceFact>,
): WorkspaceFact {
  return {
    id: over.id,
    workspaceId: over.workspaceId ?? 'ws-1',
    kind: over.kind,
    title: over.title,
    body: over.body,
    structured: over.structured ?? null,
    fiscalPeriod: over.fiscalPeriod ?? null,
    status: over.status ?? 'active',
    supersededById: over.supersededById ?? null,
    source: over.source ?? 'chat',
    createdAt: over.createdAt ?? new Date(),
    updatedAt: over.updatedAt ?? new Date(),
    revokedAt: over.revokedAt ?? null,
  } as WorkspaceFact;
}

const NARRATIVE_ID = 'fact-narr-1';
const narrativeRow = makeFact({
  id: NARRATIVE_ID,
  kind: 'narrative',
  title: 'Alianza estratégica',
  body: 'La empresa firmó un acuerdo de distribución exclusiva en la costa.',
});
const donationRow = makeFact({
  id: 'fact-don-1',
  kind: 'donation',
  title: 'Donación ESAL 2026',
  body: 'Donación en efectivo a la fundación X.',
  fiscalPeriod: '2026',
  structured: { montoCentavos: '150000000' },
});

describe('getHechosEmpresaBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders only narrative facts, wrapped in <hechos_empresa>, excluding structured donations', async () => {
    vi.mocked(getActiveFacts).mockResolvedValue([narrativeRow, donationRow]);

    const block = await getHechosEmpresaBlock('ws-1', '2026', 'es');

    expect(block).toContain('<hechos_empresa>');
    expect(block).toContain('</hechos_empresa>');
    // La narrativa entra como prosa (título + cuerpo).
    expect(block).toContain('Alianza estratégica');
    expect(block).toContain('La empresa firmó un acuerdo de distribución exclusiva en la costa.');
    // La donación (kind estructurado) NO viaja por el bloque de prosa (Art. 647,
    // anti doble conteo — sus cifras van por el path determinista).
    expect(block).not.toContain('Donación ESAL 2026');
  });

  it('returns "" when the only narrative is excluded via excludedFactIds', async () => {
    vi.mocked(getActiveFacts).mockResolvedValue([narrativeRow, donationRow]);

    const block = await getHechosEmpresaBlock('ws-1', '2026', 'es', {
      excludedFactIds: [NARRATIVE_ID],
    });

    expect(block).toBe('');
  });

  it('returns "" and never queries the DB when workspaceId is null', async () => {
    const block = await getHechosEmpresaBlock(null, '2026', 'es');

    expect(block).toBe('');
    expect(getActiveFacts).not.toHaveBeenCalled();
  });

  it('degrades safe (returns "") when getActiveFacts rejects', async () => {
    vi.mocked(getActiveFacts).mockRejectedValue(new Error('db down'));

    const block = await getHechosEmpresaBlock('ws-1', '2026', 'es');

    expect(block).toBe('');
  });

  it('normalizes a free-text fiscalPeriod to the 4-digit year before querying', async () => {
    vi.mocked(getActiveFacts).mockResolvedValue([]);

    await getHechosEmpresaBlock('ws-1', 'Enero-Diciembre 2026', 'es');

    expect(getActiveFacts).toHaveBeenCalledWith('ws-1', '2026');
  });
});
