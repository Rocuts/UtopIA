// ---------------------------------------------------------------------------
// POST /api/escudo/fiscal — reenvía el tipo de acto y el saldo declarado
// ---------------------------------------------------------------------------
// Auditoría 2026-09 (integración IW5b):
//   · tributario-modulos-13: el requerimiento especial (Art. 703 E.T.) no
//     estaba en la lista de tipos de acto del request.
//   · tributario-modulos-02: el saldo a favor LIQUIDADO en el Formulario 110
//     (`saldoAFavorDeclaradoCents`, MoneyCop) no llegaba al orquestador, así
//     que la devolución quedaba N/D aunque el usuario lo conociera.
// Ambos por el camino JSON y por el SSE.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { orchestrate } = vi.hoisted(() => ({ orchestrate: vi.fn() }));

vi.mock('@/lib/auth/require-session', () => ({
  requireAuthSession: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/lib/db/activity-log', () => ({ logActivity: vi.fn(async () => undefined) }));
vi.mock('@/lib/agents/financial/escudo-survival/fiscal-agent', () => ({
  orchestrateFiscalAgent: orchestrate,
}));

import { POST } from '../route';

const REPORT = { metadata: { partial: false, modulesRun: ['devoluciones'], modulesFailed: [] } };

function req(body: unknown, stream = false): Request {
  return new Request(`http://localhost/api/escudo/fiscal${stream ? '?stream=1' : ''}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const BODY = {
  rawData: '135515,Retencion en la fuente,20000000,0',
  mode: 'defensa_dian',
  dianRequirementKind: 'requerimiento_especial',
  saldoAFavorDeclaradoCents: '150000000',
};

beforeEach(() => {
  orchestrate.mockReset().mockResolvedValue(REPORT);
});

describe('/api/escudo/fiscal — requerimiento especial y saldo declarado', () => {
  it('camino JSON: los reenvía al orquestador', async () => {
    const res = await POST(req(BODY));
    expect(res.status).toBe(200);
    expect(orchestrate).toHaveBeenCalledTimes(1);
    expect(orchestrate.mock.calls[0][0]).toMatchObject({
      dianRequirementKind: 'requerimiento_especial',
      saldoAFavorDeclaradoCents: '150000000',
    });
  });

  it('camino SSE: los reenvía al orquestador', async () => {
    const res = await POST(req(BODY, true));
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    await res.text();
    expect(orchestrate).toHaveBeenCalledTimes(1);
    expect(orchestrate.mock.calls[0][0]).toMatchObject({
      dianRequirementKind: 'requerimiento_especial',
      saldoAFavorDeclaradoCents: '150000000',
    });
  });

  it('rechaza un saldo que no es MoneyCop sin llamar al orquestador', async () => {
    const res = await POST(req({ ...BODY, saldoAFavorDeclaradoCents: '1.500.000' }));
    expect(res.status).toBe(400);
    expect(orchestrate).not.toHaveBeenCalled();
  });
});
