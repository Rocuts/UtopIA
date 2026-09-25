// ---------------------------------------------------------------------------
// POST /api/accounting/tax-engine/preview — reenvía los tratamientos declarados
// ---------------------------------------------------------------------------
// Auditoría 2026-09 (tributario-calc-08, integración IW5b). El motor sólo aplica
// las reglas que dependen de una calificación que no puede inferir (IVA 5 %,
// exento/excluido, honorarios, honorarios PN ≤ 3.300 UVT, tabla del Art. 383,
// agente retenedor de ICA) cuando el caller las declara en `taxTreatments`.
// El schema del preview no tenía el campo: Zod lo descartaba y el preview
// mostraba siempre las reglas residuales (IVA 19 % y servicios 4 %).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { evaluate } = vi.hoisted(() => ({ evaluate: vi.fn() }));

vi.mock('@/lib/auth/require-session', () => ({
  requireAuthSession: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/lib/db/workspace', () => ({
  getOrCreateWorkspace: vi.fn(async () => ({ id: 'ws-1' })),
}));
vi.mock('@/lib/accounting/tax-engine', async () => {
  const types = await vi.importActual<typeof import('@/lib/accounting/tax-engine/types')>(
    '@/lib/accounting/tax-engine/types',
  );
  return {
    taxEngine: { evaluate },
    isTaxEngineEnabled: () => true,
    TaxEngineError: types.TaxEngineError,
    TAX_ERR: types.TAX_ERR,
  };
});

import { POST } from '../route';
import { TAX_TREATMENT } from '@/lib/accounting/tax-engine/types';

function req(body: unknown): Request {
  return new Request('http://localhost/api/accounting/tax-engine/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  evaluate.mockReset();
  evaluate.mockResolvedValue({
    proposedLines: [],
    journalLines: [],
    totalPayableCop: '0.00',
    matchedRuleIds: [],
    summary: '',
    warnings: [],
  });
});

describe('tax-engine preview — taxTreatments', () => {
  it('reenvía los tratamientos declarados al motor', async () => {
    const res = await POST(
      req({
        transactionType: 'service_purchase',
        subtotalCop: '1000000.00',
        taxTreatments: [TAX_TREATMENT.HONORARIOS_PN_HASTA_3300_UVT, TAX_TREATMENT.AGENTE_RETENEDOR_ICA],
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(evaluate.mock.calls[0][0].taxTreatments).toEqual([
      'honorarios_pn_hasta_3300_uvt',
      'agente_retenedor_ica',
    ]);
  });

  it('acepta todas las etiquetas del catálogo TAX_TREATMENT', async () => {
    const all = Object.values(TAX_TREATMENT);
    const res = await POST(
      req({ transactionType: 'purchase', subtotalCop: '500000', taxTreatments: all }) as never,
    );
    expect(res.status).toBe(200);
    expect(evaluate.mock.calls[0][0].taxTreatments).toEqual(all);
  });

  it('rechaza etiquetas que el motor no reconoce (400) sin evaluar', async () => {
    const res = await POST(
      req({ transactionType: 'purchase', subtotalCop: '500000', taxTreatments: ['iva_0_inventado'] }) as never,
    );
    expect(res.status).toBe(400);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('sin tratamientos declarados el motor recibe undefined (reglas residuales)', async () => {
    await POST(req({ transactionType: 'purchase', subtotalCop: '500000' }) as never);
    expect(evaluate.mock.calls[0][0].taxTreatments).toBeUndefined();
  });
});

// tributario-calc-23: el preview calculaba uvtYear con getFullYear(), en la
// zona del servidor (UTC en Vercel). El 31-dic después de las 19:00 hora
// Colombia pedía la UVT del año siguiente. Sin uvtYear declarado, el motor la
// mide en America/Bogota.
describe('tax-engine preview — año de la UVT', () => {
  it('sin uvtYear no lo fija con la zona del servidor', async () => {
    const { anioColombia } = await import('@/lib/accounting/tax-engine/constants');
    const res = await POST(
      req({ transactionType: 'purchase', subtotalCop: '500000', transactionDate: '2027-01-01T01:00:00Z' }) as never,
    );
    expect(res.status).toBe(200);
    const call = evaluate.mock.calls[0][0];
    expect(call.uvtYear).toBeUndefined();
    expect(anioColombia(call.transactionDate)).toBe(2026);
  });

  it('respeta el uvtYear declarado', async () => {
    await POST(req({ transactionType: 'purchase', subtotalCop: '500000', uvtYear: 2025 }) as never);
    expect(evaluate.mock.calls[0][0].uvtYear).toBe(2025);
  });
});
