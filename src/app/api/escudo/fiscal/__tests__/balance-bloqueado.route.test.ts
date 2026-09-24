// ---------------------------------------------------------------------------
// POST /api/escudo/fiscal — balance bloqueado ⇒ 422 con motivos (I4-escudo 1)
// ---------------------------------------------------------------------------
// El Agente Fiscal lanza `EscudoBalanceBloqueadoError` antes de correr los
// módulos cuando la lectura del balance no sirve de base para cifras
// fiscales. La ruta respondía 500 genérico por JSON y, por SSE, un «error
// interno» con referencia (toFriendlyError no lo reconocía). Ahora responde
// como /niif: 422 { code: 'BALANCE_VALIDATION_FAILED', reasons } y, por SSE,
// un evento `error` con las razones en es/en.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { orchestrate } = vi.hoisted(() => ({ orchestrate: vi.fn() }));

vi.mock('@/lib/auth/require-session', () => ({
  requireAuthSession: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/lib/db/activity-log', () => ({ logActivity: vi.fn(async () => undefined) }));
vi.mock('@/lib/agents/financial/escudo-survival/fiscal-agent', () => ({
  orchestrateFiscalAgent: orchestrate,
}));

import { POST } from '../route';
import { EscudoBalanceBloqueadoError } from '@/lib/agents/financial/escudo-survival/lib/balance-ingesta';

const MOTIVO =
  'El archivo declara las cifras en miles de pesos y la unidad no fue confirmada.';

function req(body: unknown, stream = false): Request {
  return new Request(`http://localhost/api/escudo/fiscal${stream ? '?stream=1' : ''}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function eventos(sse: string): Array<{ event: string; data: Record<string, unknown> }> {
  return sse
    .split('\n\n')
    .filter((b) => b.trim())
    .map((b) => {
      const event = /^event: (.+)$/m.exec(b)?.[1] ?? 'message';
      const data = JSON.parse(/^data: (.+)$/m.exec(b)?.[1] ?? '{}') as Record<string, unknown>;
      return { event, data };
    });
}

const BODY = { rawData: 'codigo,nombre,saldo\n110505,Caja,1', mode: 'quick' };

beforeEach(() => {
  orchestrate.mockReset();
});

describe('/api/escudo/fiscal — balance bloqueado', () => {
  it('camino JSON: 422 con code y reasons, no 500 genérico', async () => {
    orchestrate.mockRejectedValue(new EscudoBalanceBloqueadoError([MOTIVO]));
    const res = await POST(req(BODY));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; reasons: string[]; error: string };
    expect(body.code).toBe('BALANCE_VALIDATION_FAILED');
    expect(body.reasons).toEqual([MOTIVO]);
    expect(body.error).toMatch(/balance de prueba/i);
  });

  it('camino JSON (en): encabezado en inglés', async () => {
    orchestrate.mockRejectedValue(new EscudoBalanceBloqueadoError([MOTIVO], 'en'));
    const res = await POST(req({ ...BODY, language: 'en' }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/trial balance/i);
  });

  it('camino SSE: evento error con code, reasons y el detalle con las razones', async () => {
    orchestrate.mockRejectedValue(new EscudoBalanceBloqueadoError([MOTIVO]));
    const res = await POST(req(BODY, true));
    const err = eventos(await res.text()).find((e) => e.event === 'error');
    expect(err).toBeDefined();
    expect(err!.data.code).toBe('BALANCE_VALIDATION_FAILED');
    expect(err!.data.reasons).toEqual([MOTIVO]);
    expect(String(err!.data.detail)).toContain(MOTIVO);
    expect(String(err!.data.detail)).not.toMatch(/error interno/i);
  });

  it('otro error: sigue siendo 500 / error genérico sin razones', async () => {
    orchestrate.mockRejectedValue(new Error('fallo de red interno'));
    const res = await POST(req(BODY));
    expect(res.status).toBe(500);
    const sse = await POST(req(BODY, true));
    const err = eventos(await sse.text()).find((e) => e.event === 'error');
    expect(err!.data.reasons).toBeUndefined();
    expect(String(err!.data.detail)).not.toContain('fallo de red interno');
  });
});
