// W5-9 (NM-15) — SMMLV por año: una sola constante verificada.
// El mapa año → SMMLV estaba duplicado en las provisiones de nómina
// (Art. 114-1 E.T., `provisions/employer.ts`) y en SAGRILAFT
// (`fiscal-opinion/sagrilaft.ts`): añadir un año en uno y no en el otro hacía
// que el mismo corte tuviera SMMLV en un módulo y N/D en el otro. Ahora ambos
// leen `SMMLV_POR_ANIO` de `@/lib/tax/taxCalculator`, junto a `SMMLV_2026`.
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/workspace-empleador', () => ({ getEmpleador114_1: vi.fn(async () => null) }));

import { SMMLV_2026, SMMLV_POR_ANIO, smmlvVerificado } from '@/lib/tax/taxCalculator';
import { smmlvForYear } from '@/lib/accounting/adjustments/provisions/employer';
import { smmlvDelAnio } from '@/lib/agents/financial/fiscal-opinion/sagrilaft';

describe('W5-9 — SMMLV por año, fuente única', () => {
  it('la constante exportada contiene 2026 = SMMLV_2026 (Decreto 1469/2025) y es inmutable', () => {
    expect(SMMLV_POR_ANIO[2026]).toBe(SMMLV_2026);
    expect(Object.isFrozen(SMMLV_POR_ANIO)).toBe(true);
  });

  it('nómina y SAGRILAFT coinciden con la constante para cada año (N/D fuera del mapa)', () => {
    for (let anio = 2018; anio <= 2030; anio++) {
      const v = smmlvVerificado(anio);
      expect(v).toBe(SMMLV_POR_ANIO[anio] ?? null);
      expect(smmlvDelAnio(anio)).toBe(v);
      expect(smmlvForYear(anio)).toBe(v === null ? null : v.toFixed(2));
    }
    expect(smmlvVerificado(2025)).toBeNull();
    expect(smmlvVerificado(null)).toBeNull();
  });
});
