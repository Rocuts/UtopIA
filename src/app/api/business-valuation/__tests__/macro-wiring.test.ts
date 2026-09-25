// IW4 (valoracion-18) — La ruta no pasaba `macro` al orquestador: el bloque
// <macro_vigente> de los agentes DCF/Comparables salía siempre N/D aunque el
// servicio macro tuviera IPC/TRM con vigencia y fuente.
import { describe, expect, it, vi } from 'vitest';

const orchestrateValuation = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
const snapshot = vi.hoisted(() => ({
  inflationCopYoYPercent: { value: 5.12, asOf: '2026-08', source: 'DANE — IPC, variación anual' },
  policyRatePercent: null,
  trmCopPerUsd: null,
}));

vi.mock('@/lib/auth/require-session', () => ({ requireAuthSession: async () => ({ ok: true }) }));
vi.mock('@/lib/agents/financial/valuation/orchestrator', () => ({ orchestrateValuation }));
vi.mock('@/lib/macro/prompt-snapshot', () => ({ getMacroSnapshotForPrompts: async () => snapshot }));
vi.mock('@/lib/validation/schemas', () => ({
  businessValuationRequestSchema: {
    safeParse: (body: unknown) => ({ success: true, data: body }),
  },
}));

import { POST } from '../route';

describe('POST /api/business-valuation — macro por campo', () => {
  it('pasa el snapshot macro al orquestador', async () => {
    const req = new Request('https://x/api/business-valuation', {
      method: 'POST',
      body: JSON.stringify({
        financialData: 'x',
        company: { name: 'ACME', nit: '900', fiscalPeriod: '2025' },
        language: 'es',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const call = (orchestrateValuation.mock.calls[0] as unknown as [{ macro: unknown }])[0];
    expect(call.macro).toBe(snapshot);
  });
});
