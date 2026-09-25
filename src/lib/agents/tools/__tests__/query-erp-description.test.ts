// Auditoría 2026-09 (ingesta-14, integración IW5b) — la descripción de la tool
// `query_erp` debe advertir al modelo que para algunos ERP `trial_balance`
// devuelve movimientos del periodo (no saldos) y declarar los formatos de
// periodo que `resolveERPPeriod` acepta, para que no invente un balance ni
// pida periodos que la tool rechaza.
import { describe, it, expect } from 'vitest';

import { getToolsForAgent } from '../registry';

type Described = {
  description?: string;
  inputSchema: { shape?: Record<string, { description?: string }> };
};

describe('query_erp — descripción para el modelo', () => {
  const tool = getToolsForAgent('accounting').query_erp as unknown as Described;

  it('advierte que trial_balance puede traer movimientos del periodo, no saldos', () => {
    expect(tool.description).toMatch(/movimientos del periodo/i);
    expect(tool.description).toMatch(/no (son )?saldos/i);
  });

  it('declara los formatos de periodo válidos (AAAA, AAAA-MM, AAAA-Qn o dateFrom/dateTo)', () => {
    const period = tool.inputSchema.shape?.period?.description ?? '';
    expect(period).toMatch(/AAAA-MM/);
    expect(period).toMatch(/AAAA-Qn/);
    expect(period).toMatch(/dateFrom\/dateTo/);
  });
});
