// ratios-kpis-09 — El Índice de Consistencia contaba cada pasivo normal (el
// preprocesador los entrega como magnitudes POSITIVAS) y cada cuenta correctora
// (1592, 1399…) como "signo incorrecto": un balance sano daba 75/100 'watch'.
// Además "Terceros válidos" (20 %) valía 1,0 sin dato e inflaba el índice.
import { describe, it, expect } from 'vitest';

import { computeVerdadExecutiveCards } from '../verdad-cards';
import { makeClass, makeControlTotals, makeSnapshot } from './_fixtures';

function sano() {
  return makeSnapshot(
    makeControlTotals({ activo: 1_000_000_000, pasivo: 400_000_000, patrimonio: 600_000_000 }),
    [
      makeClass(1, [
        { code: '110505', balance: 300_000_000 },
        { code: '130505', balance: 250_000_000 },
        { code: '139905', balance: -10_000_000 }, // deterioro de cartera (correctora)
        { code: '152405', balance: 560_000_000 },
        { code: '159205', balance: -100_000_000 }, // depreciación acumulada (correctora)
      ]),
      makeClass(2, [
        { code: '210505', balance: 150_000_000 },
        { code: '220505', balance: 120_000_000 },
        { code: '236540', balance: 30_000_000 },
        { code: '250505', balance: 100_000_000 },
      ]),
      makeClass(3, [
        { code: '310505', balance: 500_000_000 },
        { code: '360505', balance: 150_000_000 },
        { code: '371005', balance: -50_000_000 }, // pérdidas acumuladas (naturaleza débito)
      ]),
    ],
  );
}

describe('Índice de Consistencia — naturaleza por clase/grupo', () => {
  it('balance sano (pasivos positivos, correctoras y pérdidas acumuladas negativas) → 100', () => {
    const cards = computeVerdadExecutiveCards({ snapshot: sano() });
    expect(cards.audit.saldosContrariosActivo).toBe(0);
    expect(cards.audit.saldosContrariosPasivo).toBe(0);
    expect(cards.audit.saldosContrariosPatrimonio).toBe(0);
    expect(cards.consistencia.value).toBe(100);
    expect(cards.consistencia.status).toBe('healthy');
  });

  it('pasivo con saldo débito y correctora con saldo débito sí son anomalías', () => {
    const snap = sano();
    snap.classes[1].accounts.push({
      code: '236575', name: 'Retención con signo invertido', level: 'Auxiliar', balance: -5_000_000, isLeaf: true,
    });
    snap.classes[0].accounts.push({
      code: '159210', name: 'Depreciación con saldo débito', level: 'Auxiliar', balance: 2_000_000, isLeaf: true,
    });
    const cards = computeVerdadExecutiveCards({ snapshot: snap });
    expect(cards.audit.saldosContrariosPasivo).toBe(1);
    expect(cards.audit.saldosContrariosActivo).toBe(1);
    expect(cards.consistencia.value).toBeLessThan(100);
  });

  it('sin dato de terceros el componente se excluye y los pesos se renormalizan (no suma 20 pts gratis)', () => {
    const snap = sano();
    // 1 anomalía entre 13 cuentas analizadas
    snap.classes[1].accounts.push({
      code: '236575', name: 'x', level: 'Auxiliar', balance: -5_000_000, isLeaf: true,
    });
    const cards = computeVerdadExecutiveCards({ snapshot: snap });
    expect(cards.audit.integridadTerceros).toBeNull();
    const total = cards.audit.totalCuentasAnalizadas;
    const signo = 1 - 1 / total;
    const esperado = ((signo * 0.5 + 1 * 0.3) / 0.8) * 100;
    expect(cards.consistencia.value).toBeCloseTo(esperado, 6);
    expect(cards.consistencia.formulaEs).toMatch(/renormaliz/i);
  });
});
