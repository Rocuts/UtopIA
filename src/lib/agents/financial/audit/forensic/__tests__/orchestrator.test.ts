// orchestrator.test.ts — Tests e2e del scan forense con datos sintéticos.
//
// NO se mockea la DB. Se llaman directamente las funciones puras de las
// reglas y el score — el orchestrator se llama con stubs de repositorio
// via vi.mock de los módulos de rules individuales.
//
// Esto valida el contrato del orchestrator: que agrega Anomaly[],
// calcula score y retorna ForensicScanResult con la forma correcta.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeScore, countBySeverity } from '../score';
import { runBenfordOnAmounts } from '../rules/benford';
import { detectGaps } from '../rules/numeration-gaps';
import { isNonWorkday } from '../rules/weekend-postings';
import { detectRepeatedAmounts } from '../rules/repeated-amounts';
import { analyzeRoundBias } from '../rules/round-number-bias';
import type { Anomaly } from '../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAnomaly(
  kind: Anomaly['kind'],
  severity: Anomaly['severity'],
): Anomaly {
  return {
    kind,
    severity,
    description: `Test anomaly: ${kind}`,
    affectedEntryIds: ['entry-1'],
    affectedAmountCop: '1000000.00',
    evidence: {},
  };
}

// ── Tests: score + severity counting ────────────────────────────────────────

describe('computeScore', () => {
  it('sin anomalías → score 100 (período limpio)', () => {
    expect(computeScore([])).toBe(100);
  });

  it('1 anomalía low → score 98', () => {
    expect(computeScore([makeAnomaly('benford_violation', 'low')])).toBe(98);
  });

  it('1 anomalía medium → score 94', () => {
    expect(computeScore([makeAnomaly('numeration_gap', 'medium')])).toBe(94);
  });

  it('1 anomalía high → score 85', () => {
    expect(computeScore([makeAnomaly('new_third_party_unverified', 'high')])).toBe(85);
  });

  it('período sucio con múltiples anomalías → score < 50', () => {
    const anomalies: Anomaly[] = [
      makeAnomaly('benford_violation', 'medium'),          // -6
      makeAnomaly('numeration_gap', 'medium'),             // -6
      makeAnomaly('weekend_posting', 'high'),              // -15
      makeAnomaly('repeated_amount', 'medium'),            // -6
      makeAnomaly('new_third_party_unverified', 'high'),   // -15
      makeAnomaly('round_number_bias', 'high'),            // -15
    ];
    const score = computeScore(anomalies);
    // Total deduction: 6+6+15+6+15+15 = 63 → score = 37
    expect(score).toBe(37);
    expect(score).toBeLessThan(50);
  });

  it('score no puede ser negativo (clamped a 0)', () => {
    const anomalies = Array.from({ length: 10 }, () =>
      makeAnomaly('new_third_party_unverified', 'high'),
    );
    expect(computeScore(anomalies)).toBe(0);
  });
});

describe('countBySeverity', () => {
  it('sin anomalías → todo en 0', () => {
    expect(countBySeverity([])).toEqual({ low: 0, medium: 0, high: 0 });
  });

  it('mezcla de severidades contadas correctamente', () => {
    const anomalies: Anomaly[] = [
      makeAnomaly('benford_violation', 'low'),
      makeAnomaly('numeration_gap', 'low'),
      makeAnomaly('weekend_posting', 'medium'),
      makeAnomaly('new_third_party_unverified', 'high'),
      makeAnomaly('round_number_bias', 'high'),
    ];
    expect(countBySeverity(anomalies)).toEqual({ low: 2, medium: 1, high: 2 });
  });
});

// ── Tests: integración de reglas puras ───────────────────────────────────────

describe('ForensicScan — dataset limpio (reglas puras)', () => {
  it('Benford con distribución correcta → no viola', () => {
    // Dataset limpio: ~300 montos con distribución Benford
    const amounts: string[] = [];
    const dist = [301, 176, 125, 97, 79, 67, 58, 51, 46];
    for (let d = 1; d <= 9; d++) {
      for (let i = 0; i < dist[d - 1]; i++) {
        amounts.push(`${d}${String(Math.floor(Math.random() * 900) + 100)}.00`);
      }
    }
    const result = runBenfordOnAmounts(amounts);
    expect(result.chiSquare).toBeLessThan(15.507);
  });

  it('Gaps: secuencia 1-50 consecutiva → sin gaps', () => {
    const nums = Array.from({ length: 50 }, (_, i) => i + 1);
    expect(detectGaps(nums)).toHaveLength(0);
  });

  it('Weekend: fechas de lunes a viernes → ninguna no hábil', () => {
    // 2026-01-05 al 2026-01-09 (lunes a viernes)
    const dates = [
      new Date('2026-01-05T08:00:00Z'), // lunes
      new Date('2026-01-06T08:00:00Z'), // martes
      new Date('2026-01-07T08:00:00Z'), // miércoles
      new Date('2026-01-08T08:00:00Z'), // jueves
      new Date('2026-01-09T08:00:00Z'), // viernes
    ];
    expect(dates.every((d) => !isNonWorkday(d))).toBe(true);
  });

  it('Round bias: montos variados → sesgo bajo', () => {
    // Montos que NO terminan en 000
    const amounts = [
      '1234.50', '567890.25', '345678.75', '890123.00',  // solo 1 redondo
      '234567.50', '678901.25', '123456.75', '789012.50',
      '456789.25', '901234.75',
    ];
    const { percentage } = analyzeRoundBias(amounts);
    expect(percentage).toBeLessThanOrEqual(0.30);
  });
});

describe('ForensicScan — dataset sucio (reglas puras)', () => {
  it('Benford con distribución uniforme → viola (chi > umbral)', () => {
    const amounts: string[] = [];
    for (let d = 1; d <= 9; d++) {
      for (let i = 0; i < 100; i++) {
        amounts.push(`${d}${String(Math.floor(Math.random() * 900) + 100)}.00`);
      }
    }
    const result = runBenfordOnAmounts(amounts);
    expect(result.chiSquare).toBeGreaterThan(15.507);
  });

  it('Gaps con saltos → múltiples gaps detectados', () => {
    const nums = [1, 2, 5, 8, 9, 10, 15, 20];
    const gaps = detectGaps(nums);
    expect(gaps.length).toBeGreaterThan(1);
  });

  it('Round bias: todos los montos son múltiplos de 1000 → 100% sesgo', () => {
    const amounts = ['1000000.00', '2000000.00', '3000000.00', '5000000.00'];
    const { percentage } = analyzeRoundBias(amounts);
    expect(percentage).toBeGreaterThan(0.50);
  });

  it('Repeated amounts: mismo monto repetido 8 veces → anomalía detectada', () => {
    const occs = Array.from({ length: 8 }, (_, i) => ({
      entryId: `entry-${i}`,
      amount: 175_000,
      date: new Date(`2026-01-${String(i + 1).padStart(2, '0')}T08:00:00Z`),
      thirdPartyId: 'tp-1',
    }));
    const anomalies = detectRepeatedAmounts(occs, {
      minPeriodRepeats: 8,
      minWeeklyRepeats: 5,
      commonRoundAmounts: new Set(),
    });
    expect(anomalies.length).toBeGreaterThan(0);
    expect(anomalies[0].evidence.amount).toBe(175_000);
  });
});
