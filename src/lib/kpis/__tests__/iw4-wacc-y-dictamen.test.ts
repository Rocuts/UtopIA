// IW4 — valoracion-07 y auditoria-calidad-04.
//   - Exit Value / ROI probabilístico publicaban "WACC de referencia CO 2026 =
//     13,5 %" como supuesto aunque nadie lo declarara (valor típico sin fuente,
//     incoherente con el CAPM sin doble conteo del riesgo país). Sin tasa
//     declarada: "no declarada"; con tasa: supuesto del usuario rotulado.
//   - El dictamen puede llegar como 'no_emitida' (sin opinión del Revisor
//     Fiscal): la salud regulatoria es N/D con ese motivo, no un "falta la
//     auditoría" genérico.
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/storage/conversation-history', () => ({ listReports: vi.fn(() => []) }));

import { calculateExitValue } from '../exit-value';
import { calculateRoiProbabilistic } from '../roi-probabilistic';
import { getRegulatoryHealth } from '../live';

describe('valoracion-07 — sin WACC 13,5 % por defecto', () => {
  it('Exit Value sin WACC declarado no publica una tasa de referencia', () => {
    const r = calculateExitValue({ ebitda: 800_000_000, industry: 'services', growthRate: 0.1, netDebt: 0 });
    const text = (r.assumptions ?? []).join(' | ');
    expect(text).not.toMatch(/13[.,]5/);
    expect(text).toMatch(/WACC no declarad/);
  });

  it('Exit Value con WACC declarado lo rotula como supuesto del usuario', () => {
    const r = calculateExitValue({
      ebitda: 800_000_000, industry: 'services', growthRate: 0.1, wacc: 0.142, netDebt: 0,
    });
    expect((r.assumptions ?? []).join(' | ')).toMatch(/WACC declarado por el usuario \(supuesto\) = 14,2%/);
  });

  it('ROI probabilístico sin tasa declarada no publica 13,5 %', () => {
    const r = calculateRoiProbabilistic({
      projects: [{ name: 'A', expectedReturn: 0.2, probability: 0.5, investment: 100 }],
      failureReturn: 0, // valoracion-25: el retorno en caso de fracaso se declara
    });
    const text = (r.assumptions ?? []).join(' | ');
    expect(text).not.toMatch(/13[.,]5/);
    expect(text).toMatch(/Tasa de descuento no declarada/);
  });
});

describe("auditoria-calidad-04 — dictamen 'no_emitida'", () => {
  it('auditoría completa sin dictamen emitido ⇒ N/D con el motivo', async () => {
    const kpi = await getRegulatoryHealth([], {
      updatedAt: '2026-09-01T00:00:00Z', niifScore: 95, taxScore: 92, legalScore: 90,
      findings: { critico: 0, alto: 2, medio: 5 }, opinion: 'no_emitida',
    });
    expect(kpi.value).toBeNull();
    expect(kpi.source).toBe('unavailable');
    expect(kpi.reason).toMatch(/no emitid/i);
  });
});
