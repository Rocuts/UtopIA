// ---------------------------------------------------------------------------
// Regresión — coherencia de las tres representaciones de ControlTotals
// ---------------------------------------------------------------------------
// Auditoría 2026-08 (P0 `curator-r8-cents-desync`): las reglas del curator que
// mutan el balance recalculaban sólo la representación en pesos (`number`) y
// dejaban `cents` (bigint) y `raw` (string canónica) con los valores previos.
//
// Eso importa porque los consumidores están repartidos:
//   - renderers y pilares          → leen `number`
//   - `auditReportEmittable` (gate) → compara en `cents` con tolerancia 0n
//   - bloque TOTALES VINCULANTES    → se construye desde `raw`
//
// Con las tres desalineadas, el gate valida el reporte contra un patrimonio
// que ya no existe y el LLM recibe anclas de un momento distinto al del
// balance que se le está entregando.
//
// Este test corre el pipeline completo sobre el fixture del CFO (que activa
// R1, R6, R7 y R8, es decir todas las reglas mutantes) y exige coherencia
// exacta al centavo.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  centsToCanonical,
  equationGapCents,
  pesosToCents,
} from '../curator-rules/sync-control-totals';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '../trial-balance';
import type { PeriodSnapshot } from '../trial-balance';

// `balanced`: si el archivo cumple A = P + K una vez trasladado el resultado.
// El fixture del CFO trae un descuadre deliberado (379505 −$1.572M) que desde
// la auditoría 2026-09 (niif-preproceso-06) R8 ya no absorbe: el residual
// debe quedar expuesto — en centavos — y bloquear, no desaparecer.
const FIXTURES = [
  { file: 'elite-pulido-diamante.csv', balanced: false },
  { file: 'patologicos/sin-comparativo.csv', balanced: true },
] as const;

function loadPeriods(fixture: string): PeriodSnapshot[] {
  const csv = readFileSync(
    resolve(__dirname, '..', '__fixtures__', fixture),
    'utf-8',
  );
  const result = preprocessTrialBalance(parseTrialBalanceCSV(csv));
  const periods: PeriodSnapshot[] = [];
  if (result.primary) periods.push(result.primary);
  if (result.comparative) periods.push(result.comparative);
  return periods;
}

describe('ControlTotals — coherencia number / cents / raw tras el curator', () => {
  for (const { file: fixture, balanced } of FIXTURES) {
    describe(fixture, () => {
      const periods = loadPeriods(fixture);

      it('el fixture produce al menos un periodo', () => {
        expect(periods.length).toBeGreaterThan(0);
      });

      for (const snap of periods) {
        describe(`periodo ${snap.period}`, () => {
          const totals = snap.controlTotals;

          it('cents coincide con la representación en pesos al centavo', () => {
            expect(totals.cents, 'el snapshot no trae cents').toBeDefined();
            for (const key of ['activo', 'pasivo', 'patrimonio'] as const) {
              expect(
                totals.cents![key],
                `controlTotals.cents.${key} quedó desincronizado respecto de ` +
                  `controlTotals.${key} (${totals[key]}). Alguna regla del ` +
                  `curator mutó el total sin llamar a syncControlTotals().`,
              ).toBe(pesosToCents(totals[key]));
            }
          });

          it('raw coincide con cents', () => {
            expect(totals.raw, 'el snapshot no trae raw').toBeDefined();
            for (const key of ['activo', 'pasivo', 'patrimonio'] as const) {
              expect(
                totals.raw![key],
                `controlTotals.raw.${key} no corresponde a cents.${key}. El ` +
                  `bloque TOTALES VINCULANTES que ve el LLM se construye desde ` +
                  `raw: una desincronización aquí le entrega anclas falsas.`,
              ).toBe(centsToCanonical(totals.cents![key]));
            }
          });

          if (balanced) {
            it('la ecuación patrimonial cuadra en centavos exactos', () => {
              // Es la forma que el gate `auditReportEmittable` evalúa (V1) con
              // tolerancia 0n. Cuadrar en float no basta.
              expect(
                equationGapCents(totals),
                `Activo − (Pasivo + Patrimonio) ≠ 0 en centavos. ` +
                  `activo=${totals.cents!.activo} pasivo=${totals.cents!.pasivo} ` +
                  `patrimonio=${totals.cents!.patrimonio}`,
              ).toBe(BigInt(0));
              expect(snap.validation.blocking).toBe(false);
            });
          } else {
            it('el descuadre del archivo queda expuesto en centavos exactos y bloquea', () => {
              // El residual en cents (lo que evalúa el gate V1) coincide con
              // el que R8 reporta como no explicado: no hay plug escondido.
              const gap = equationGapCents(totals);
              expect(gap).not.toBe(BigInt(0));
              expect(centsToCanonical(gap)).toBe(
                snap.virtualCloseAdjustment?.unexplainedResidualRaw,
              );
              expect(snap.summary.equationBalanced).toBe(false);
              expect(snap.validation.blocking).toBe(true);
            });
          }
        });
      }
    });
  }
});

describe('helpers de conversión', () => {
  it('pesosToCents redondea el drift de punto flotante', () => {
    // 0.1 + 0.2 = 0.30000000000000004 en float.
    expect(pesosToCents(0.1 + 0.2)).toBe(BigInt(30));
    expect(pesosToCents(1_234_567.89)).toBe(BigInt(123456789));
    expect(pesosToCents(-1_234_567.89)).toBe(BigInt(-123456789));
  });

  it('pesosToCents degrada a 0 ante valores no finitos', () => {
    expect(pesosToCents(Number.NaN)).toBe(BigInt(0));
    expect(pesosToCents(Number.POSITIVE_INFINITY)).toBe(BigInt(0));
  });

  it('centsToCanonical conserva el signo y los dos decimales', () => {
    expect(centsToCanonical(BigInt(123456789))).toBe('1234567.89');
    expect(centsToCanonical(BigInt(-123456789))).toBe('-1234567.89');
    expect(centsToCanonical(BigInt(5))).toBe('0.05');
    expect(centsToCanonical(BigInt(0))).toBe('0.00');
    expect(centsToCanonical(BigInt(-5))).toBe('-0.05');
  });

  it('centsToCanonical soporta magnitudes por encima de 2^53', () => {
    // Un billón de pesos en centavos excede el entero seguro de JS: es la
    // razón por la que el contrato viaja en BigInt.
    const cents = BigInt('900719925474099100');
    expect(centsToCanonical(cents)).toBe('9007199254740991.00');
  });
});
