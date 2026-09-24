// ---------------------------------------------------------------------------
// Cross-dep W3-B (tributario-calc-01) — el tipo societario llega al servidor
// ---------------------------------------------------------------------------
// SurvivalModePanel ya envía `company.entityType` y
// `company.bylawsRequireLegalReserve`, y el agente de reserva de contingencia
// los usa para decidir si la reserva legal es obligatoria (S.A. Art. 452 y
// Ltda. Art. 371 C.Co.; S.A.S. sólo por estatutos, Supersociedades
// 220-069664/2017). Pero `escudoSurvivalRequestSchema` los descartaba (zod
// elimina las claves no declaradas): el agente nunca recibía el tipo
// societario y toda brecha salía «sin tipo societario».
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { escudoSurvivalRequestSchema } from '@/lib/validation/schemas';

const { orchestrate } = vi.hoisted(() => ({ orchestrate: vi.fn() }));

vi.mock('@/lib/auth/require-session', () => ({
  requireAuthSession: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/lib/agents/financial/escudo-survival/orchestrator', () => ({
  orchestrateEscudoSurvival: orchestrate,
}));

import { POST } from '@/app/api/escudo-survival/route';

const BODY = {
  rawData: '110505,Caja,1000000',
  company: { name: 'Demo SAS', nit: '900123456-7', entityType: 'SAS', bylawsRequireLegalReserve: true },
  language: 'es',
};

beforeEach(() => {
  orchestrate.mockReset().mockResolvedValue({ ok: true });
});

describe('escudoSurvivalRequestSchema — tipo societario', () => {
  it('conserva entityType y bylawsRequireLegalReserve', () => {
    const parsed = escudoSurvivalRequestSchema.parse(BODY);
    expect(parsed.company?.entityType).toBe('SAS');
    expect(parsed.company?.bylawsRequireLegalReserve).toBe(true);
  });

  it('acepta null (no declarado) y la ausencia de ambos campos', () => {
    const conNull = escudoSurvivalRequestSchema.parse({
      rawData: 'x',
      company: { entityType: null, bylawsRequireLegalReserve: null },
    });
    expect(conNull.company?.entityType).toBeNull();
    expect(conNull.company?.bylawsRequireLegalReserve).toBeNull();
    const sin = escudoSurvivalRequestSchema.parse({ rawData: 'x', company: { name: 'X' } });
    expect(sin.company?.entityType).toBeUndefined();
  });

  it('rechaza tipos inválidos', () => {
    expect(
      escudoSurvivalRequestSchema.safeParse({ rawData: 'x', company: { bylawsRequireLegalReserve: 'si' } }).success,
    ).toBe(false);
    expect(
      escudoSurvivalRequestSchema.safeParse({ rawData: 'x', company: { entityType: 'S'.repeat(51) } }).success,
    ).toBe(false);
  });
});

describe('POST /api/escudo-survival — el tipo societario llega al orquestador', () => {
  it('camino JSON', async () => {
    const res = await POST(
      new Request('http://localhost/api/escudo-survival', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(BODY),
      }),
    );
    expect(res.status).toBe(200);
    expect(orchestrate).toHaveBeenCalledTimes(1);
    expect(orchestrate.mock.calls[0][0].company).toMatchObject({
      entityType: 'SAS',
      bylawsRequireLegalReserve: true,
    });
  });
});
