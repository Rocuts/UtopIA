// ---------------------------------------------------------------------------
// Acta: una capitalización propuesta cuando el ancla dice que NO aplica
// ---------------------------------------------------------------------------
// Hallazgo pipeline-flujo-12 (auditoría 2026-09): la capitalización sólo se
// revisaba cuando el ancla decía que aplicaba. Con pérdida (o utilidad bajo el
// umbral) un acta que proponía capitalizar salía limpia.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { buildActaArithmetic, reconcileActaArithmetic } from '../base';

const conPerdida = buildActaArithmetic({
  netIncomeCents: BigInt(-5_000_000_000),
  accumulatedLossesCents: BigInt(0),
  capitalSuscritoPagadoCents: BigInt(100_000_000_000),
  reservaLegalAcumuladaCents: BigInt(0),
  otrasReservasCents: BigInt(0),
  regime: 'obligatoria_ley',
  reservaOcasionalPct: 0,
  capitalizationPct: 40,
});

describe('reconcileActaArithmetic — capitalización (pipeline-flujo-12)', () => {
  it('el ancla con pérdida no admite capitalización', () => {
    expect(conPerdida.capitalizationApplies).toBe(false);
  });

  it('un acta que propone capitalizar cuando el ancla dice que no aplica es una desviación', () => {
    const devs = reconcileActaArithmetic(
      {
        netIncomeCop: conPerdida.netIncomeCop,
        distributionApplies: conPerdida.distributionApplies,
        distributionLines: [],
        capitalizationApplies: true,
        capitalizationBaseCop: '2000000000',
        capitalizationAmountCop: '800000000',
      },
      conPerdida,
    );
    expect(devs.some((d) => d.field === 'shareholderMinutes.capitalizationProposal.applies')).toBe(true);
  });

  it('sin capitalización propuesta el acta con pérdida queda limpia en ese renglón', () => {
    const devs = reconcileActaArithmetic(
      {
        netIncomeCop: conPerdida.netIncomeCop,
        distributionApplies: conPerdida.distributionApplies,
        distributionLines: [],
        capitalizationApplies: false,
        capitalizationBaseCop: null,
        capitalizationAmountCop: null,
      },
      conPerdida,
    );
    expect(devs.some((d) => d.field.startsWith('shareholderMinutes.capitalizationProposal'))).toBe(false);
  });
});
