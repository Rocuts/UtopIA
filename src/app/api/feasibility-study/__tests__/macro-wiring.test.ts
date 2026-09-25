// IW4 (valoracion-18) — La ruta no pasaba `macro` al orquestador: el bloque
// <macro_vigente> del Modelador Financiero salía siempre N/D aunque el
// servicio macro tuviera IPC/TRM con vigencia y fuente.
import { describe, expect, it, vi } from 'vitest';

const orchestrateFeasibilityStudy = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
const snapshot = vi.hoisted(() => ({
  inflationCopYoYPercent: null,
  policyRatePercent: null,
  trmCopPerUsd: { value: 3_987.65, asOf: '2026-09-19', source: 'Superintendencia Financiera de Colombia — TRM' },
}));

vi.mock('@/lib/auth/require-session', () => ({ requireAuthSession: async () => ({ ok: true }) }));
vi.mock('@/lib/agents/financial/feasibility/orchestrator', () => ({ orchestrateFeasibilityStudy }));
vi.mock('@/lib/macro/prompt-snapshot', () => ({ getMacroSnapshotForPrompts: async () => snapshot }));
vi.mock('@/lib/validation/schemas', () => ({
  feasibilityStudyRequestSchema: {
    safeParse: (body: unknown) => ({ success: true, data: body }),
  },
}));

import { POST } from '../route';

describe('POST /api/feasibility-study — macro por campo', () => {
  it('pasa el snapshot macro al orquestador', async () => {
    const req = new Request('https://x/api/feasibility-study', {
      method: 'POST',
      body: JSON.stringify({ projectData: 'x', project: { name: 'P' }, language: 'es' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const call = (orchestrateFeasibilityStudy.mock.calls[0] as unknown as [{ macro: unknown }])[0];
    expect(call.macro).toBe(snapshot);
  });
});
