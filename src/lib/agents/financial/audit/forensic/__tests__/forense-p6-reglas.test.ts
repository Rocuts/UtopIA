// Fase 2 / P6 — hallazgos bajos de las reglas forenses:
//   auditoria-calidad-24 (Benford: chi² sin control de tamaño y monto afectado
//   = todo el libro), -25 (números redondos: expectativa de ~10 % errónea) y
//   -26 (fin de semana en UTC y festivos sólo de 2026).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JournalLineAmount } from '../repository';

const lines = vi.hoisted(() => ({ current: [] as JournalLineAmount[] }));

vi.mock('../repository', () => ({
  getJournalLinesForPeriod: async () => lines.current,
  getPostedEntriesForPeriod: async () => [],
  getNewThirdPartiesForPeriod: async () => [],
}));

import benfordRule, { evaluateBenford } from '../rules/benford';
import roundNumberBiasRule from '../rules/round-number-bias';
import {
  colombianHolidays,
  easterSunday,
  isNonWorkday,
  toISODateLocal,
} from '../rules/weekend-postings';

const BENFORD = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => Math.log10(1 + 1 / d));

/** Una línea débito por monto; cada una en su propio asiento. */
function debitLines(countsByDigit: number[], amountFor: (digit: number, i: number) => string): JournalLineAmount[] {
  const out: JournalLineAmount[] = [];
  countsByDigit.forEach((count, idx) => {
    const digit = idx + 1;
    for (let i = 0; i < count; i++) {
      out.push({ entryId: `e-${digit}-${i}`, debit: amountFor(digit, i), credit: '0.00', thirdPartyId: null });
    }
  });
  return out;
}

beforeEach(() => {
  lines.current = [];
});

describe('auditoria-calidad-24 — Benford con MAD de Nigrini', () => {
  it('N = 100.000 con desviación inmaterial: chi² significativo pero MAD de conformidad → sin anomalía', async () => {
    const n = 100_000;
    const counts = BENFORD.map((p) => Math.round(p * n));
    counts[0] += 400;
    counts[8] -= 400;
    lines.current = debitLines(counts, (d) => `${d}234567.00`);

    const ev = evaluateBenford(lines.current);
    expect(ev.kind).toBe('conforming');
    if (ev.kind !== 'conforming') return;
    expect(ev.chiSquare).toBeGreaterThan(15.507); // el chi² solo la marcaría
    expect(ev.mad).toBeLessThan(0.006); // conformidad cercana (Nigrini)

    const res = await benfordRule.run({ workspaceId: 'w', periodId: 'p' });
    expect(res.anomalies).toHaveLength(0);
  });

  it('distribución uniforme: anomalía con el monto afectado SÓLO de los dígitos sobre-representados', async () => {
    lines.current = debitLines(new Array(9).fill(100), (d) => `${d}000000.00`);

    const res = await benfordRule.run({ workspaceId: 'w', periodId: 'p' });
    expect(res.anomalies).toHaveLength(1);
    const a = res.anomalies[0];
    expect(a.severity).toBe('medium');
    const deviated = a.evidence.deviatedDigits as number[];
    expect(deviated.length).toBeGreaterThan(0);
    expect(deviated).not.toContain(1);
    expect(deviated.every((d) => d >= 4)).toBe(true);

    // Σ de los montos de los dígitos desviados (100 asientos × d.000.000).
    const expected = deviated.reduce((s, d) => s + 100 * d * 1_000_000, 0);
    expect(a.affectedAmountCop).toBe(`${expected}.00`);
    // Todo el libro sería 100 × (1+…+9) × 1.000.000 = 4.500.000.000.
    expect(Number(a.affectedAmountCop)).toBeLessThan(4_500_000_000);
    expect(a.affectedEntryIds).toHaveLength(100 * deviated.length);
    expect(a.affectedEntryIds.some((id) => id.startsWith('e-1-'))).toBe(false);
    expect(a.evidence.mad).toBeGreaterThan(0.015);
  });

  it('débito y crédito de la misma transacción no se cuentan dos veces en el monto afectado', async () => {
    const single = debitLines(new Array(9).fill(60), (d) => `${d}500000.00`);
    // Cada asiento: la misma cifra al débito y al crédito.
    lines.current = single.flatMap((l) => [l, { ...l, debit: '0.00', credit: l.debit }]);

    const res = await benfordRule.run({ workspaceId: 'w', periodId: 'p' });
    expect(res.anomalies).toHaveLength(1);
    const a = res.anomalies[0];
    const deviated = a.evidence.deviatedDigits as number[];
    const expected = deviated.reduce((s, d) => s + 60 * (d * 1_000_000 + 500_000), 0);
    expect(a.affectedAmountCop).toBe(`${expected}.00`);
  });

  it('montos menores a $10 no entran a la prueba', () => {
    const small = debitLines(new Array(9).fill(10), (d) => `${d}.50`);
    const ev = evaluateBenford(small);
    expect(ev.kind).toBe('insufficient');
    expect(ev.n).toBe(0);
  });
});

describe('auditoria-calidad-25 — números redondos', () => {
  it('la descripción no afirma una expectativa de ~10 % y el monto afectado es sólo el de los redondos', async () => {
    lines.current = [
      ...Array.from({ length: 6 }, (_, i) => ({
        entryId: `r${i}`, debit: '2000000.00', credit: '0.00', thirdPartyId: null,
      })),
      // Contrapartida redonda del mismo asiento: no duplica el monto afectado.
      { entryId: 'r0', debit: '0.00', credit: '2000000.00', thirdPartyId: null },
      ...Array.from({ length: 3 }, (_, i) => ({
        entryId: `n${i}`, debit: '1234567.89', credit: '0.00', thirdPartyId: null,
      })),
    ];

    const res = await roundNumberBiasRule.run({ workspaceId: 'w', periodId: 'p' });
    expect(res.anomalies).toHaveLength(1);
    const a = res.anomalies[0];
    expect(a.description).not.toMatch(/~\s*10\s*%/);
    expect(a.description).toMatch(/0,1 %/);
    expect(a.description).toMatch(/empíric/);
    expect(a.affectedAmountCop).toBe('12000000.00');
    expect(a.affectedEntryIds.sort()).toEqual(['r0', 'r1', 'r2', 'r3', 'r4', 'r5']);
  });
});

describe('auditoria-calidad-26 — día en America/Bogota y festivos por año', () => {
  it('viernes 19:30 en Bogotá (sábado 00:30 UTC) es día hábil', () => {
    expect(isNonWorkday(new Date('2026-03-07T00:30:00Z'))).toBe(false);
    expect(toISODateLocal(new Date('2026-03-07T00:30:00Z'))).toBe('2026-03-06');
  });

  it('domingo 21:00 en Bogotá (lunes 02:00 UTC) es no hábil', () => {
    expect(isNonWorkday(new Date('2026-03-09T02:00:00Z'))).toBe(true);
  });

  it('una fecha sin hora (medianoche UTC del formulario) conserva su día', () => {
    // new Date('2026-03-09') → lunes; no debe correrse al domingo.
    expect(isNonWorkday(new Date('2026-03-09'))).toBe(false);
    expect(isNonWorkday(new Date('2026-03-08'))).toBe(true);
  });

  it('Viernes Santo 2025 y Reyes 2027 se detectan sin lista fija', () => {
    expect(isNonWorkday(new Date('2025-04-18T15:00:00Z'))).toBe(true);
    expect(isNonWorkday(new Date('2027-01-11T15:00:00Z'))).toBe(true);
  });

  it('el cálculo de 2026 coincide con los festivos del calendario DIAN (sin el Día Cívico)', () => {
    expect(easterSunday(2026).toISOString().slice(0, 10)).toBe('2026-04-05');
    expect([...colombianHolidays(2026)].sort()).toEqual([
      '2026-01-01', '2026-01-12', '2026-03-23', '2026-04-02', '2026-04-03',
      '2026-05-01', '2026-05-18', '2026-06-08', '2026-06-15', '2026-06-29',
      '2026-07-20', '2026-08-07', '2026-08-17', '2026-10-12', '2026-11-02',
      '2026-11-16', '2026-12-08', '2026-12-25',
    ]);
  });

  it('un festivo que cae en lunes no se traslada (San Pedro 2026 = lunes 29-jun)', () => {
    expect(colombianHolidays(2026).has('2026-06-29')).toBe(true);
    expect(colombianHolidays(2026).has('2026-07-06')).toBe(false);
  });
});
