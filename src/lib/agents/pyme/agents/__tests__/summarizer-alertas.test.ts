// ---------------------------------------------------------------------------
// Pyme — alertas deterministas del resumen mensual (integración fase 2, P6).
//
// La regla de pérdida evaluaba `margenPct < 0`. Con `margenPct = 0` (y ahora
// `null`) en un mes sin ingresos, un mes con egresos y sin ventas no generaba
// la alerta crítica de pérdida. La regla evalúa el resultado del mes
// (`margen < 0`), que existe aunque no haya ingresos.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('ai', () => ({
  generateText: vi.fn(async () => ({ text: 'Narrativa.' })),
}));
vi.mock('@/lib/config/models', () => ({ MODELS: { CHAT: 'mock-model' } }));

import { summarizeMonth } from '../summarizer';
import type { MonthlySummary } from '@/lib/db/pyme';

function summary(totals: MonthlySummary['totals'], previous: MonthlySummary['previous'] = null): MonthlySummary {
  return {
    bookId: 'b-1',
    year: 2026,
    month: 3,
    totals,
    topIngresoCategories: [],
    topEgresoCategories: [],
    previous,
    entryCount: 2,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('computeAlerts — pérdida del mes', () => {
  it('mes con egresos y sin ingresos: alerta crítica de pérdida', async () => {
    const { alerts } = await summarizeMonth(
      summary({ ingresos: 0, egresos: 500_000, margen: -500_000, margenPct: null }),
      { language: 'es' },
    );
    const critical = alerts.filter((a) => a.severity === 'critical');
    expect(critical).toHaveLength(1);
    expect(critical[0].message).toContain('Mes en perdida');
    expect(critical[0].message).toContain('$500.000');
  });

  it('en inglés también', async () => {
    const { alerts } = await summarizeMonth(
      summary({ ingresos: 0, egresos: 500_000, margen: -500_000, margenPct: null }),
      { language: 'en' },
    );
    expect(alerts.some((a) => a.severity === 'critical' && a.message.startsWith('Loss-making month'))).toBe(true);
  });

  it('con ingresos y pérdida sigue alertando', async () => {
    const { alerts } = await summarizeMonth(
      summary({ ingresos: 1_000, egresos: 1_250, margen: -250, margenPct: -0.25 }),
      { language: 'es' },
    );
    expect(alerts.some((a) => a.severity === 'critical' && a.message.includes('Mes en perdida'))).toBe(true);
  });

  it('mes vacío o con utilidad: sin alerta de pérdida', async () => {
    const vacio = await summarizeMonth(
      summary({ ingresos: 0, egresos: 0, margen: 0, margenPct: null }),
      { language: 'es' },
    );
    expect(vacio.alerts).toEqual([]);
    const utilidad = await summarizeMonth(
      summary({ ingresos: 8_000_000, egresos: 7_000_000, margen: 1_000_000, margenPct: 0.125 }),
      { language: 'es' },
    );
    expect(utilidad.alerts.some((a) => a.message.includes('Mes en perdida'))).toBe(false);
  });
});
