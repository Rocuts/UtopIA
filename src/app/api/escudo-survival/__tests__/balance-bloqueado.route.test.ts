// ---------------------------------------------------------------------------
// POST /api/escudo-survival — balance bloqueado ⇒ 422 con motivos (I4-escudo 1)
// ---------------------------------------------------------------------------
// El orquestador lanza `EscudoBalanceBloqueadoError` cuando la lectura del
// balance no sirve de base para cifras fiscales (unidad sin confirmar, hojas
// incompatibles, descuadre, CUR-R8/R5/R12…). La ruta respondía 500 genérico
// por JSON y, por SSE, un «error interno» con referencia: el usuario no veía
// por qué. Ahora responde como /niif: 422 { code: 'BALANCE_VALIDATION_FAILED',
// reasons } y, por SSE, un evento `error` con las razones en es/en.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { orchestrate } = vi.hoisted(() => ({ orchestrate: vi.fn() }));

vi.mock('@/lib/auth/require-session', () => ({
  requireAuthSession: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/lib/agents/financial/escudo-survival/orchestrator', () => ({
  orchestrateEscudoSurvival: orchestrate,
}));

import { POST } from '../route';
import { EscudoBalanceBloqueadoError } from '@/lib/agents/financial/escudo-survival/lib/balance-ingesta';

const MOTIVO =
  '[2025] [CUR-R8] Residual no explicado por el resultado del ejercicio: $1.000.000,00.';

function req(body: unknown, stream = false): Request {
  return new Request(`http://localhost/api/escudo-survival${stream ? '?stream=1' : ''}`, {
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

beforeEach(() => {
  orchestrate.mockReset();
});

describe('/api/escudo-survival — balance bloqueado', () => {
  it('camino JSON: 422 con code y reasons, no 500 genérico', async () => {
    orchestrate.mockRejectedValue(new EscudoBalanceBloqueadoError([MOTIVO]));
    const res = await POST(req({ rawData: 'codigo,nombre,saldo\n110505,Caja,1' }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; reasons: string[]; error: string };
    expect(body.code).toBe('BALANCE_VALIDATION_FAILED');
    expect(body.reasons).toEqual([MOTIVO]);
    expect(body.error).toMatch(/balance de prueba/i);
  });

  it('camino SSE (es): evento error con code, reasons y el detalle con las razones', async () => {
    orchestrate.mockRejectedValue(new EscudoBalanceBloqueadoError([MOTIVO]));
    const res = await POST(req({ rawData: 'x', language: 'es' }, true));
    const evs = eventos(await res.text());
    const err = evs.find((e) => e.event === 'error');
    expect(err).toBeDefined();
    expect(err!.data.code).toBe('BALANCE_VALIDATION_FAILED');
    expect(err!.data.reasons).toEqual([MOTIVO]);
    expect(String(err!.data.error)).toMatch(/balance de prueba/i);
    expect(String(err!.data.detail)).toContain(MOTIVO);
    expect(String(err!.data.detail)).not.toMatch(/error interno/i);
  });

  it('camino SSE (en): encabezado en inglés', async () => {
    orchestrate.mockRejectedValue(new EscudoBalanceBloqueadoError([MOTIVO], 'en'));
    const res = await POST(req({ rawData: 'x', language: 'en' }, true));
    const err = eventos(await res.text()).find((e) => e.event === 'error');
    expect(String(err!.data.error)).toMatch(/trial balance/i);
    expect(err!.data.reasons).toEqual([MOTIVO]);
  });

  it('otro error: sigue siendo 500 / error genérico sin razones', async () => {
    orchestrate.mockRejectedValue(new Error('fallo de red interno'));
    const res = await POST(req({ rawData: 'x' }));
    expect(res.status).toBe(500);
    const sse = await POST(req({ rawData: 'x', language: 'en' }, true));
    const err = eventos(await sse.text()).find((e) => e.event === 'error');
    expect(err!.data.reasons).toBeUndefined();
    expect(String(err!.data.detail)).not.toContain('fallo de red interno');
  });
});
