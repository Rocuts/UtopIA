// IW4 (pipeline-flujo-01) — Âncoras ya persistidos (localStorage) de versiones
// previas: el Âncora sentinela de ceros y el Âncora real de UN solo periodo
// llegaban a la vista como cifras del cliente.
//   - Todas las cifras ccvNiif en "0" ⇒ vista vacía (hasData=false, N/D).
//   - Sin periodo comparativo, A02/A04/A06/A08/A10/A12/A14/X02 son "0" de
//     relleno (build-ancora usa 0 cuando falta el comparativo), la variación
//     de caja A19 = efectivo − 0 no es una variación, y los checks
//     patrimonioDelta2024 = "0" / efeReconcilia = "ok" son triviales: no suman
//     puntos de scoreNiif (antes +20 +20 inventados).
import { describe, expect, it } from 'vitest';

import { deriveAncoraView } from '../derive-ancora-view';
import { makeAncora } from './ancora.fixture';
import type { NiifAncora } from '@/lib/agents/financial/ancora/types';

function sentinelaDeCeros(): NiifAncora {
  const base = makeAncora();
  const zeros = Object.fromEntries(Object.keys(base.ccvNiif).map((k) => [k, '0'])) as NiifAncora['ccvNiif'];
  const fz = Object.fromEntries(Object.keys(base.ccvFiscal).map((k) => [k, '0'])) as NiifAncora['ccvFiscal'];
  return {
    ...base,
    periodos: { actual: '', comparativo: null },
    ccvNiif: zeros,
    ccvFiscal: { ...fz, F09: '0.00', F10: '0.00' },
    checks: {
      patrimonioDelta2025: '0',
      patrimonioDelta2024: '0',
      efeReconcilia: 'error',
      alertaA5: 'inactiva',
      alertaDev: 'inactiva',
    },
  };
}

/** Âncora real de un solo periodo como lo construye build-ancora (comparativo en 0). */
function unSoloPeriodo(): NiifAncora {
  const base = makeAncora();
  return {
    ...base,
    periodos: { actual: '2025', comparativo: null },
    ccvNiif: {
      ...base.ccvNiif,
      A02: '0', A04: '0', A06: '0', A08: '0', A10: '0', A12: '0', A14: '0', X02: '0',
      A19: base.ccvNiif.A13, // efectivo − 0
    },
    checks: {
      patrimonioDelta2025: '0',
      patrimonioDelta2024: '0', // 0 − 0 − 0: trivial
      efeReconcilia: 'ok', // 0 + A13 = A13: trivial
      alertaA5: 'inactiva',
      alertaDev: 'inactiva',
    },
  };
}

describe('deriveAncoraView — Âncoras persistidos de versiones previas', () => {
  it('Âncora sentinela (todas las cifras NIIF en "0") ⇒ vista vacía, sin score', () => {
    const v = deriveAncoraView(sentinelaDeCeros(), null, { name: 'ACME', nit: '900-1' });
    expect(v.hasData).toBe(false);
    expect(v.niif.activos).toBeNull();
    expect(v.niif.utilidadNeta).toBeNull();
    expect(v.derived.scoreNiif).toBeNull();
    expect(v.meta.empresa).toBe('ACME');
  });

  it('un solo periodo: los "previos" son N/D, no $0', () => {
    const v = deriveAncoraView(unSoloPeriodo(), null);
    expect(v.hasData).toBe(true);
    expect(v.niif.activos).toBe(1_000_000_000);
    for (const k of [
      'activosPrev', 'pasivosPrev', 'patrimonioPrev', 'ingresosPrev',
      'ebitOperacionalPrev', 'utilidadNetaPrev', 'efectivoPrev', 'variacionCaja',
    ] as const) {
      expect(v.niif[k]).toBeNull();
    }
    expect(v.derived.crecimientoIngresosPct).toBeNull();
  });

  it('un solo periodo: los checks comparativos triviales no suman puntos', () => {
    const v = deriveAncoraView(unSoloPeriodo(), null);
    // Evaluables: ecuación actual (40) + sin A5 (10) + sin DEV (10) = 60 de 60
    // ⇒ 100 sobre lo medido; antes 100 "por" 20 + 20 de checks sentinela.
    expect(v.derived.scoreNiif).toBe(100);
    const conFalla = deriveAncoraView(
      { ...unSoloPeriodo(), checks: { ...unSoloPeriodo().checks, alertaA5: 'activa' } },
      null,
    );
    // 50 de 60 evaluables (no 90 de 100 con 40 puntos regalados).
    expect(conFalla.derived.scoreNiif).toBe(83);
  });

  it('con comparativo la rúbrica completa no cambia', () => {
    expect(deriveAncoraView(makeAncora(), null).derived.scoreNiif).toBe(100);
  });
});
