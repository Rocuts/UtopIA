// ---------------------------------------------------------------------------
// Revisión adversarial del validador de prosa (re-auditoría 2, fase 2)
// ---------------------------------------------------------------------------
// Casos que la revisión independiente de integ/fix-narrativa encontró sobre el
// núcleo de narrative-anchors.ts y que el corpus no cubre por Parte:
//   - la aritmética del acta regida por un porcentaje no ampara cualquier
//     cifra del acta: "el 10 % de la utilidad neta, es decir $10M" (el mínimo
//     del Art. 155) con utilidad de $20M sella;
//   - en las Partes I y II (sin conceptos del acta) "enjugar pérdidas" y la
//     "reserva ocasional" siguen cortando la ventana del resultado;
//   - `\b` de JS no reconoce el fin de palabra tras una tilde: "ascendió",
//     "distribuyó", "se ubicó" o "capitalizó" no se reconocían;
//   - una relativa ("…, que ascendió a $6M") es del sustantivo que la precede.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import {
  checkGovernanceNarrative,
  checkNiifNarrative,
  checkStrategyNarrative,
  narrativeSourcesFromPreprocessed,
} from '@/lib/agents/financial/validators/narrative-anchors';
import { formatCopFromCents } from '@/lib/agents/financial/contracts/money';
import { informeHonesto, preprocesarPerdidaComparativo } from '@/lib/agents/financial/__fixtures__/perdida-comparativo-w4a';
import type { NiifReportJson } from '@/lib/agents/financial/contracts/niif-report';
import { actaSA, govJson, ppSA, strategyJson } from '@/lib/agents/financial/__fixtures__/narrativa-corpus';

const cop = (c: string | bigint) => formatCopFromCents(BigInt(c), false);
const sourcesSA = () => narrativeSourcesFromPreprocessed(ppSA, null, { acta: actaSA });
const acta = (developments: string[]) => checkGovernanceNarrative(govJson({ developments }), sourcesSA());
const notes = (n: string[]) => checkGovernanceNarrative(govJson({ notes: n }), sourcesSA());

describe('porcentaje del acta: una cifra del acta mayor que esa fracción de la base sella', () => {
  it('"el 10 % de la utilidad neta, es decir $10M" (mínimo del Art. 155) con utilidad de $20M sella', () => {
    expect(cop(actaSA.minimoArt155Cop)).toBe('$10.000.000,00');
    const r = acta([`El 10 % de la utilidad neta, es decir ${cop(actaSA.minimoArt155Cop)}, se destina a la reserva legal.`]);
    expect(r.motivos.join('\n')).toMatch(/Utilidad neta: la narrativa imprime \$10\.000\.000,00 como el 10 %/);
  });

  it('la reserva legal del ejercicio, el mínimo al 50 % y la capitalización al 40 % siguen valiendo', () => {
    const r = acta([
      `Se apropia la reserva legal (10 % de la utilidad neta) por ${cop(actaSA.reservaLegalDelEjercicioCop)}.`,
      `El mínimo legal a repartir equivale al 50 % de la utilidad neta: ${cop(actaSA.minimoArt155Cop)} (Art. 155 C.Co.).`,
      `Se propone la capitalización del 40 % de la utilidad neta, esto es ${cop(actaSA.capitalizationAmountCop)}.`,
    ]);
    expect(r.motivos).toEqual([]);
  });
});

describe('Partes I y II: enjugar pérdidas y la reserva ocasional cortan la ventana del resultado', () => {
  it('Parte II: "con la utilidad neta se enjugan pérdidas por $7M" y "reserva ocasional de $10M" no sellan', () => {
    const src = narrativeSourcesFromPreprocessed(ppSA, null);
    const r = checkStrategyNarrative(
      strategyJson(
        'Con la utilidad neta se enjugan pérdidas por $7.000.000,00. ' +
          'La utilidad neta del ejercicio se lleva a reserva ocasional por $10.000.000,00.',
      ),
      src,
    );
    expect(r.motivos).toEqual([]);
  });

  it('Parte I: "con la utilidad del ejercicio se enjugan pérdidas por $7M" no sella', () => {
    const pp = preprocesarPerdidaComparativo();
    const json = informeHonesto(pp);
    const j: NiifReportJson = {
      ...json,
      technicalNotes: [...json.technicalNotes, { ref: 'N', norma: null, body: 'Con la utilidad del ejercicio se enjugan pérdidas por $7.000.000,00.' }],
    };
    expect(checkNiifNarrative(j, narrativeSourcesFromPreprocessed(pp, json)).motivos).toEqual([]);
  });

  it('Parte III: el enjugue con una cifra sin base sigue sellando como concepto del acta', () => {
    expect(acta(['Con la utilidad del ejercicio se enjugan pérdidas por $7.000.000,00.']).motivos.join('\n'))
      .toMatch(/Enjugamiento de pérdidas: la narrativa imprime \$7\.000\.000,00/);
  });
});

describe('verbos con tilde: la mención y el verbo de saldo se reconocen', () => {
  it('"ascendió", "sumó", "totalizó", "distribuyó", "repartió", "capitalizó", "enjugó" y "se ubicó" con cifra falsa sellan', () => {
    const r = notes([
      'El patrimonio ascendió a $99.000.000,00.',
      'El patrimonio sumó $99.000.000,00.',
      'El efectivo y equivalentes totalizó $99.000.000,00.',
      'La utilidad neta, que creció frente a 2024, se ubicó en $99.000.000,00.',
      'La utilidad neta, que creció frente a 2024, cerró en $99.000.000,00.',
    ]);
    expect(r.motivos).toHaveLength(5);
    const a = acta([
      'Se distribuyó entre los accionistas la suma de $99.000.000,00.',
      'Se repartió la suma de $99.000.000,00.',
      'Se capitalizó la suma de $99.000.000,00.',
      'Se enjugó la pérdida por $99.000.000,00.',
    ]);
    expect(a.motivos).toHaveLength(4);
  });

  it('las mismas redacciones con la cifra del reporte o del acta no sellan', () => {
    const r = notes([
      'El patrimonio ascendió a $60.000.000,00.',
      'La utilidad neta, que creció frente a 2024, se ubicó en $20.000.000,00.',
    ]);
    expect(r.motivos).toEqual([]);
    expect(acta([`Se distribuyó entre los accionistas la suma de ${cop(actaSA.distribuibleCop)}.`]).motivos).toEqual([]);
  });

  it('una relativa tras otra magnitud es de esa magnitud: "…por el impuesto de renta, que ascendió a $6M"', () => {
    const r = notes([
      'La utilidad neta disminuyó por el mayor impuesto de renta, que ascendió a $6.000.000,00.',
      'La utilidad neta bajó por el impuesto de renta, que se ubicó en $6.000.000,00.',
    ]);
    expect(r.motivos).toEqual([]);
  });
});

describe('variación: sólo "a"/"hasta" pegados al verbo (o tras un porcentaje o un año) marcan el nivel', () => {
  it('"aumentó frente a 2024 debido a $30M de inversiones" no es el nivel; "creció frente a 2024, hasta $X" sí', () => {
    expect(notes(['El total de activos aumentó frente a 2024 debido a $30.000.000,00 de nuevas inversiones.']).motivos).toEqual([]);
    expect(notes(['El total de activos creció frente a 2024, hasta $99.000.000,00.']).motivos.join('\n'))
      .toMatch(/Total Activo: la narrativa imprime \$99\.000\.000,00/);
    expect(notes(['La utilidad neta aumentó en 2025 a $99.000.000,00.']).motivos).toHaveLength(1);
  });
});
