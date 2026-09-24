// ---------------------------------------------------------------------------
// Re-auditoría 2 de la fase 2 (2026-09-24) — validador de prosa
// ---------------------------------------------------------------------------
// Reproducciones de narrativa.json (narrativa-01..07 falsos positivos,
// narrativa-09..13 escapes) y procedencia-R2-01, portadas a la suite real con
// el comportamiento ESPERADO. Un sello en la Parte I/II/III bloquea /export y
// /html (un falso positivo deja un informe honesto sin entregable); un escape
// sale del servidor con "procedencia verificada".
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import {
  checkGovernanceNarrative,
  checkNiifNarrative,
  checkStrategyNarrative,
  narrativeSourcesFromPreprocessed,
} from '@/lib/agents/financial/validators/narrative-anchors';
import { buildActaExpectedArithmetic } from '@/lib/agents/financial/prompts/governance-specialist.prompt';
import { formatCopFromCents } from '@/lib/agents/financial/contracts/money';
import { informeTresCortes, preprocesarTresCortes } from '@/lib/agents/financial/__fixtures__/tres-cortes-comparativo';
import { informeHonesto, preprocesarPerdidaComparativo } from '@/lib/agents/financial/__fixtures__/perdida-comparativo-w4a';
import type { NiifReportJson } from '@/lib/agents/financial/contracts/niif-report';
import {
  actaSA,
  govJson,
  ppDosCortes,
  ppGrande,
  ppPatrimonioNegativo,
  ppPerdida,
  ppSA,
  strategyJson,
} from '@/lib/agents/financial/__fixtures__/narrativa-corpus';

const cop = (c: string | bigint) => formatCopFromCents(BigInt(c), false);
const sourcesSA = () => narrativeSourcesFromPreprocessed(ppSA, null, { acta: actaSA });
const acta = (developments: string[]) => checkGovernanceNarrative(govJson({ developments }), sourcesSA());
const notes = (n: string[]) => checkGovernanceNarrative(govJson({ notes: n }), sourcesSA());

// ---------------------------------------------------------------------------
// Falsos positivos
// ---------------------------------------------------------------------------

describe('narrativa-01 — la aritmética del acta ("X % de la utilidad neta, es decir $Y") no es la utilidad neta', () => {
  it('las cifras de las frases son las vinculantes del acta', () => {
    expect(cop(actaSA.reservaLegalDelEjercicioCop)).toBe('$2.000.000,00');
    expect(cop(actaSA.capitalizationAmountCop)).toBe('$8.000.000,00');
    expect(cop(actaSA.minimoArt155Cop)).toBe('$10.000.000,00');
    expect(cop(actaSA.distribuibleCop)).toBe('$8.000.000,00');
    expect(cop(actaSA.reservaOcasionalCop)).toBe('$10.000.000,00');
  });

  it('las cinco redacciones de la aritmética del acta no sellan', () => {
    const r = acta([
      'El 10 % de la utilidad neta, es decir $2.000.000,00, se destina a la reserva legal (Art. 452 C.Co.).',
      'Se apropia la reserva legal (10 % de la utilidad neta) por $2.000.000,00.',
      'Se propone la capitalización del 40 % de la utilidad neta, esto es $8.000.000,00, con cargo al saldo distribuible.',
      'El mínimo legal a repartir equivale al 50 % de la utilidad neta: $10.000.000,00 (Art. 155 C.Co.).',
      'Apropiada la reserva legal, queda un saldo de $18.000.000,00, del cual se propone una reserva ocasional de $10.000.000,00 y un saldo distribuible de $8.000.000,00.',
    ]);
    expect(r.motivos).toEqual([]);
  });

  it('una cifra que no es el porcentaje declarado de la base sigue sellando', () => {
    const r = acta([
      'El 10 % de la utilidad neta, es decir $3.000.000,00, se destina a la reserva legal.',
      'Apropiada la reserva legal de $6.000.000,00, queda un saldo de $14.000.000,00.',
    ]);
    const all = r.motivos.join('\n');
    expect(all).toMatch(/punto 1 · Utilidad neta: la narrativa imprime \$3\.000\.000,00 como el 10 %/);
    expect(all).toMatch(/punto 2 · Reserva legal: la narrativa imprime \$6\.000\.000,00/);
  });
});

describe('narrativa-02 — "total de activos fijos / pasivos laborales" son subtotales de una nota', () => {
  it('Parte III: activos fijos, financieros, pasivos laborales y financieros no se juzgan como el total', () => {
    const r = notes([
      'El total de activos fijos asciende a $30.000.000,00.',
      'El total de activos financieros (cartera de clientes, Sección 11) asciende a $40.000.000,00.',
      'El total de pasivos laborales asciende a $3.000.000,00.',
      'El total de pasivos financieros es de $5.000.000,00.',
    ]);
    expect(r.motivos).toEqual([]);
  });

  it('Parte I (traza pérdida con comparativo): "total de activos fijos" y "total de pasivos financieros" no sellan', () => {
    const pp = preprocesarPerdidaComparativo();
    const json = informeHonesto(pp);
    const withNotes: NiifReportJson = {
      ...json,
      technicalNotes: [
        ...json.technicalNotes,
        { ref: 'Nota PPE', norma: null, body: 'El total de activos fijos (propiedad, planta y equipo neto) asciende a $80.000.000,00.' },
        { ref: 'Nota Obligaciones', norma: null, body: 'El total de pasivos financieros asciende a $45.000.000,00.' },
      ],
    };
    expect(checkNiifNarrative(withNotes, narrativeSourcesFromPreprocessed(pp, json)).motivos).toEqual([]);
  });

  it('el total del balance con cifra falsa sigue sellando', () => {
    expect(notes(['El total de activos de la sociedad asciende a $30.000.000,00.']).motivos.join('\n'))
      .toMatch(/Total Activo: la narrativa imprime \$30\.000\.000,00/);
  });
});

describe('narrativa-03 — desglose del efectivo y "otros ingresos operacionales"', () => {
  it('"se compone de", "está representado por", "se discrimina así" y "otros ingresos" no sellan', () => {
    const r = notes([
      'El efectivo al cierre se compone de caja general por $2.000.000,00 y bancos por $48.000.000,00.',
      'El efectivo al cierre está representado por saldos en bancos de $48.000.000,00 y caja de $2.000.000,00.',
      'El efectivo y equivalentes al cierre se discrimina así: caja $2.000.000,00; bancos $48.000.000,00.',
      'Los otros ingresos operacionales por $1.000.000,00 corresponden a arrendamientos.',
    ]);
    expect(r.motivos).toEqual([]);
  });

  it('un componente seguido de un verbo de saldo se juzga ("detallado en la nota 5, asciende a")', () => {
    const r = notes(['El efectivo al cierre, detallado en la Nota 5, asciende a $9.000.000,00.']);
    expect(r.motivos.join('\n')).toMatch(/Efectivo al cierre: la narrativa imprime \$9\.000\.000,00/);
  });
});

describe('narrativa-04 — tres cortes: saldos 2023 y distribuciones 2024 del comparativo en las Partes II/III', () => {
  const pp = preprocesarTresCortes();
  const niif = informeTresCortes(pp);
  const eqOpen = niif.equityChanges.comparativeRows!.find((r) => r.kind === 'opening_balance')!.total;
  const cashOpen = niif.cashFlow.cashOpeningComparative!;
  const n1 = `El patrimonio al cierre de 2023, saldo inicial del periodo comparativo, fue de ${cop(eqOpen)}.`;
  const n2 = `El efectivo y equivalentes al cierre de 2023 fue de ${cop(cashOpen)}.`;

  it('control: la Parte I los admite', () => {
    const r = checkNiifNarrative({ ...niif, technicalNotes: [{ ref: 'N', norma: null, body: `${n1} ${n2}` }] }, narrativeSourcesFromPreprocessed(pp, niif));
    expect(r.motivos).toEqual([]);
  });

  it('Parte III (notas de Gobierno) y Parte II admiten el patrimonio y el efectivo de 2023', () => {
    const g = checkGovernanceNarrative(govJson({ notes: [n1, n2], acta: null }), narrativeSourcesFromPreprocessed(pp, niif));
    expect(g.motivos).toEqual([]);
    expect(g.checked).toBe(2);
    expect(checkStrategyNarrative(strategyJson(n2), narrativeSourcesFromPreprocessed(pp, niif)).motivos).toEqual([]);
  });

  it('las distribuciones del ECP (2025, $9M) y las derivadas del comparativo (2024, $6M) son ancla de una nota', () => {
    const actaTres = buildActaExpectedArithmetic({ name: 'Demo', nit: '900765432-6', fiscalPeriod: '2025', entityType: 'SAS' }, pp);
    const src = narrativeSourcesFromPreprocessed(pp, niif, { acta: actaTres });
    const r = checkGovernanceNarrative(
      govJson({
        notes: [
          'Durante 2024 se pagaron dividendos por $6.000.000,00.',
          'Las distribuciones a socios del ejercicio 2025 fueron de $9.000.000,00.',
        ],
        acta: null,
      }),
      src,
    );
    expect(r.motivos).toEqual([]);
    // Una cifra que no sale del ECP ni del EFE sigue sin respaldo.
    const fake = checkGovernanceNarrative(govJson({ notes: ['Durante 2024 se pagaron dividendos por $7.000.000,00.'], acta: null }), src);
    expect(fake.motivos.join('\n')).toMatch(/Dividendos: la narrativa imprime \$7\.000\.000,00/);
  });

  it('un saldo de 2023 que no imprime ningún estado sigue sellando en la Parte III', () => {
    const r = checkGovernanceNarrative(govJson({ notes: ['El patrimonio al cierre de 2023 fue de $74.000.000,00.'], acta: null }), narrativeSourcesFromPreprocessed(pp, niif));
    expect(r.motivos.join('\n')).toMatch(/Total Patrimonio: la narrativa imprime \$74\.000\.000,00/);
  });
});

describe('narrativa-05 — fecha de corte con el comparativo nombrado antes del año', () => {
  it('"… en forma comparativa con los estados financieros al 31 de diciembre de 2024" no sella', () => {
    const r = checkGovernanceNarrative(
      govJson({ developments: ['Se aprueban los estados financieros al 31 de diciembre de 2025, presentados en forma comparativa con los estados financieros al 31 de diciembre de 2024.'] }),
      narrativeSourcesFromPreprocessed(ppDosCortes, null),
    );
    expect(r.motivos).toEqual([]);
  });

  it('un corte ajeno sin marca de comparativo sigue sellando', () => {
    for (const text of [
      'Se aprueban los estados financieros al 31 de diciembre de 2024.',
      'Frente a lo aprobado en la reunión, los estados financieros al 31 de diciembre de 2024 se someten a votación.',
    ]) {
      const r = checkGovernanceNarrative(govJson({ developments: [text] }), narrativeSourcesFromPreprocessed(ppDosCortes, null));
      expect(r.motivos.join('\n')).toMatch(/corte al 31 de diciembre de 2024 y el reporte corresponde al periodo 2025/);
    }
  });
});

describe('narrativa-06 — "ROE negativo de 80,0 %"', () => {
  it('la palabra "negativo" da el signo; con el signo contrario sella', () => {
    expect(ppPerdida.primary.controlTotals.roe).toBeCloseTo(-80, 5);
    const src = narrativeSourcesFromPreprocessed(ppPerdida, null);
    expect(checkStrategyNarrative(strategyJson('El ROE negativo de 80,0 % refleja la pérdida del ejercicio.'), src).motivos).toEqual([]);
    expect(checkStrategyNarrative(strategyJson('El ROE fue de -80,0 %.'), src).motivos).toEqual([]);
    expect(checkStrategyNarrative(strategyJson('El ROE fue de 80,0 %.'), src).motivos.join('\n'))
      .toMatch(/ROE: la narrativa imprime 80,0 % y el preprocesador calcula -80,0 %/);
    // "pérdida" en la frase no invierte un ROE positivo.
    const pos = narrativeSourcesFromPreprocessed(ppSA, null);
    const roe = (ppSA.primary.controlTotals.roe as number).toFixed(1).replace('.', ',');
    expect(checkStrategyNarrative(strategyJson(`Sin pérdidas en el año, el ROE fue de ${roe} %.`), pos).motivos).toEqual([]);
  });
});

describe('narrativa-07 — "$2 mil M" (formatBigCop de los pilares) es mil millones', () => {
  it('utilidad $2.000.000.000: "$2 mil M", "$2,0 mil M", "$2.000 M" y "$2 mil millones" no sellan; "$3 mil M" sí', () => {
    const src = narrativeSourcesFromPreprocessed(ppGrande, null);
    const m = (t: string) => checkStrategyNarrative(strategyJson(`La utilidad neta del ejercicio fue de ${t}.`), src).motivos;
    expect(m('$2 mil M')).toEqual([]);
    expect(m('$2,0 mil M')).toEqual([]);
    expect(m('$2.000 M')).toEqual([]);
    expect(m('$2 mil millones')).toEqual([]);
    expect(m('$3 mil M').join('\n')).toMatch(/imprime \$3\.000\.000\.000,00 \(abreviado\)/);
  });
});

// ---------------------------------------------------------------------------
// Escapes
// ---------------------------------------------------------------------------

describe('narrativa-09 / procedencia-R2-01 — vocabulario habitual del P&G y del balance', () => {
  it('control: "La utilidad neta del ejercicio fue de $4.000.000,00" sella', () => {
    expect(acta(['La utilidad neta del ejercicio fue de $4.000.000,00.']).motivos).toHaveLength(1);
  });

  it('"utilidad/resultado/pérdida del ejercicio", "ganancia del periodo", "obtuvo utilidades por" sellan', () => {
    const r = acta([
      'La utilidad del ejercicio fue de $4.000.000,00.',
      'El resultado del ejercicio asciende a $4.000.000,00.',
      'La ganancia del periodo asciende a $4.000.000,00.',
      'La pérdida del ejercicio de $9.000.000,00 se cubrirá con reservas.',
      'La utilidad del ejercicio 2025 fue de $9.000.000,00, que la asamblea aprueba.',
      'La sociedad obtuvo utilidades por $9.000.000,00 en el ejercicio.',
    ]);
    expect(r.motivos).toHaveLength(6);
    expect(r.motivos.every((x) => /Utilidad neta/.test(x))).toBe(true);
  });

  it('activos/pasivos/ingresos/efectivo sin "total" ni "al cierre" sellan', () => {
    const r = notes([
      'Los activos de la sociedad ascienden a $12.000.000,00.',
      'Los pasivos suman $1.000.000,00.',
      'Los ingresos del ejercicio ascendieron a $9.000.000,00.',
      'Las ventas del año fueron de $9.000.000,00.',
      'El efectivo asciende a $9.000.000,00.',
      'El efectivo de la compañía al 31 de diciembre de 2025 era de $9.000.000,00.',
      'El disponible cerró en $9.000.000,00.',
      'La caja y bancos suman $9.000.000,00.',
    ]);
    expect(r.motivos).toHaveLength(8);
    const all = r.motivos.join('\n');
    expect(all).toMatch(/Total Activo: la narrativa imprime \$12\.000\.000,00/);
    expect(all).toMatch(/Total Pasivo: la narrativa imprime \$1\.000\.000,00/);
    expect(all).toMatch(/Ingresos: la narrativa imprime \$9\.000\.000,00/);
    expect((all.match(/Efectivo al cierre/g) ?? []).length).toBe(4);
  });

  it('Parte II: "La utilidad del ejercicio… y el disponible cerró en $X" sella las dos cifras', () => {
    const r = checkStrategyNarrative(
      strategyJson('La utilidad del ejercicio fue de $9.000.000,00 y el disponible cerró en $9.000.000,00.'),
      narrativeSourcesFromPreprocessed(ppSA, null),
    );
    expect(r.motivos).toHaveLength(2);
  });

  it('Parte I: "El resultado del periodo asciende a $9M y la pérdida del ejercicio a $9M" (pérdida real $40M) sella', () => {
    const pp = preprocesarPerdidaComparativo();
    const json = informeHonesto(pp);
    const j: NiifReportJson = { ...json, technicalNotes: [...json.technicalNotes, { ref: 'N', norma: null, body: 'El resultado del periodo asciende a $9.000.000,00 y la pérdida del ejercicio a $9.000.000,00.' }] };
    expect(checkNiifNarrative(j, narrativeSourcesFromPreprocessed(pp, json)).motivos).toHaveLength(2);
  });
});

describe('narrativa-10 — destinación del acta con otra redacción', () => {
  it('control: "Se decreta un dividendo de $900.000.000,00" sella', () => {
    expect(acta(['Se decreta un dividendo de $900.000.000,00.']).motivos).toHaveLength(1);
  });

  it('distribuir, capitalizan, utilidades líquidas, utilidad distribuible/a disposición, reserva ocasional y enjugar sellan', () => {
    const r = acta([
      'Se aprueba distribuir entre los accionistas la suma de $900.000.000,00.',
      'Se capitalizan $800.000,00 de la utilidad del ejercicio.',
      'La asamblea capitaliza la suma de $800.000,00.',
      'Las utilidades líquidas del ejercicio ascienden a $900.000.000,00.',
      'La utilidad neta distribuible asciende a $900.000.000,00.',
      'La utilidad neta a disposición de la asamblea es de $900.000.000,00.',
      'Se apropia una reserva ocasional de $15.000.000,00.',
      'Se enjugan pérdidas de ejercicios anteriores por $7.000.000,00.',
    ]);
    expect(r.motivos).toHaveLength(8);
    const all = r.motivos.join('\n');
    expect(all).toMatch(/punto 1 · Dividendos: la narrativa imprime \$900\.000\.000,00/);
    expect(all).toMatch(/punto 2 · Monto a capitalizar: la narrativa imprime \$800\.000,00/);
    expect(all).toMatch(/punto 7 · Reserva ocasional: la narrativa imprime \$15\.000\.000,00/);
    expect(all).toMatch(/punto 8 · Enjugamiento de pérdidas: la narrativa imprime \$7\.000\.000,00/);
  });

  it('las mismas redacciones con la aritmética del acta no sellan', () => {
    const r = acta([
      `Se aprueba distribuir entre los accionistas la suma de ${cop(actaSA.distribuibleCop)}.`,
      `Se capitalizan ${cop(actaSA.capitalizationAmountCop)} de la utilidad del ejercicio.`,
      `Las utilidades líquidas del ejercicio ascienden a ${cop(actaSA.netIncomeCop)}.`,
      `La utilidad neta a disposición de la asamblea, apropiada la reserva legal, es de $18.000.000,00.`,
      `Se apropia una reserva ocasional de ${cop(actaSA.reservaOcasionalCop)}.`,
      'No hay pérdidas de ejercicios anteriores por enjugar.',
    ]);
    expect(r.motivos).toEqual([]);
  });
});

describe('narrativa-11 — montos con escala, "COP" detrás o sin moneda', () => {
  it('control: "COP 4.000.000,00" y "4.000.000 de pesos" sellan', () => {
    expect(acta(['La utilidad neta del ejercicio fue de COP 4.000.000,00.']).motivos).toHaveLength(1);
    expect(acta(['La utilidad neta del ejercicio fue de 4.000.000 de pesos.']).motivos).toHaveLength(1);
  });

  it('"900 millones de pesos", "COP 4 millones", "4.000.000 COP", "4.000.000,00" sin moneda sellan', () => {
    const r = acta([
      'La utilidad neta del ejercicio fue de 900 millones de pesos.',
      'La utilidad neta del ejercicio fue de COP 4 millones.',
      'La utilidad neta del ejercicio fue de 4.000.000 COP.',
      'La utilidad neta del ejercicio fue de 4.000.000,00.',
    ]);
    expect(r.motivos).toHaveLength(4);
  });

  it('un NIT, una cédula o "millones de acciones" no son montos', () => {
    const r = acta([
      'La utilidad neta de la sociedad identificada con NIT 900.123.456-7 fue de $20.000.000,00.',
      'El capital está representado por 2 millones de acciones; la utilidad neta fue de 20 millones de pesos.',
      'El representante legal, C.C. 1.234.567, certifica que la utilidad neta fue de $20.000.000,00.',
    ]);
    expect(r.motivos).toEqual([]);
  });
});

describe('narrativa-12 — un verbo de variación antes de la cifra no exime el nivel', () => {
  it('control: "La utilidad neta aumentó $5.000.000,00" (variación) no se juzga', () => {
    expect(acta(['La utilidad neta aumentó $5.000.000,00.']).motivos).toEqual([]);
    expect(acta(['La utilidad neta aumentó en $5.000.000,00 frente a 2024.']).motivos).toEqual([]);
  });

  it('"aumentó a", "creció hasta", "que mejoró frente a 2024, fue de" y "pasó de A a B" juzgan el nivel', () => {
    const r = acta([
      'La utilidad neta del ejercicio aumentó a $4.000.000,00.',
      'La utilidad neta creció hasta $4.000.000,00.',
      'La utilidad neta del ejercicio, que mejoró frente a 2024, fue de $4.000.000,00.',
      'La utilidad neta pasó de $1.000.000,00 a $4.000.000,00.',
      'La utilidad neta aumentó $3.000.000,00, hasta $4.000.000,00.',
    ]);
    expect(r.motivos).toHaveLength(5);
    expect(r.motivos.every((x) => /Utilidad neta: la narrativa imprime \$4\.000\.000,00/.test(x))).toBe(true);
  });

  it('los mismos giros con el nivel real no sellan', () => {
    const r = checkGovernanceNarrative(
      govJson({
        developments: [
          'La utilidad neta aumentó a $20.000.000,00.',
          'La utilidad neta pasó de $10.000.000,00 en 2024 a $20.000.000,00 en 2025.',
          'La utilidad neta, frente a $10.000.000,00 de 2024, fue de $20.000.000,00.',
          'La variación de la utilidad neta fue de $10.000.000,00.',
        ],
        acta: null,
      }),
      narrativeSourcesFromPreprocessed(ppDosCortes, null),
    );
    expect(r.motivos).toEqual([]);
  });
});

describe('narrativa-13 — cifra negativa impresa sin signo bajo un rótulo neutro', () => {
  it('pérdida −$40M, EBITDA −$20M: "resultado neto de $40M" y "EBITDA de $20M" sellan', () => {
    expect(ppPerdida.primary.controlTotals.ebitda).toBe(-20_000_000);
    const src = narrativeSourcesFromPreprocessed(ppPerdida, null);
    expect(checkStrategyNarrative(strategyJson('El resultado neto del ejercicio fue de $40.000.000,00.'), src).motivos.join('\n'))
      .toMatch(/Utilidad neta: es negativa .* la presenta como positiva/);
    expect(checkStrategyNarrative(strategyJson('El EBITDA del ejercicio fue de $20.000.000,00.'), src).motivos.join('\n'))
      .toMatch(/EBITDA: es negativa .* la presenta como positiva/);
  });

  it('patrimonio NEGATIVO −$40M presentado "asciende a $40.000.000,00" sella en notas y acta', () => {
    expect(ppPatrimonioNegativo.primary.controlTotals.patrimonio).toBe(-40_000_000);
    const r = checkGovernanceNarrative(
      govJson({ notes: ['El patrimonio asciende a $40.000.000,00 al cierre.'], developments: ['El total patrimonio es de $40.000.000,00.'], acta: null }),
      narrativeSourcesFromPreprocessed(ppPatrimonioNegativo, null),
    );
    expect(r.motivos).toHaveLength(2);
    expect(r.motivos.every((x) => /Total Patrimonio: es negativa/.test(x))).toBe(true);
  });

  it('con signo, paréntesis o la palabra "negativo/pérdida/déficit" no sella', () => {
    const src = narrativeSourcesFromPreprocessed(ppPerdida, null);
    const r = checkStrategyNarrative(
      strategyJson(
        'El resultado neto del ejercicio fue una pérdida de $40.000.000,00. El EBITDA fue negativo en $20.000.000,00. ' +
          'El resultado neto del ejercicio fue de -$40.000.000,00. El EBITDA del ejercicio fue de ($20.000.000,00).',
      ),
      src,
    );
    expect(r.motivos).toEqual([]);
    const neg = checkGovernanceNarrative(
      govJson({ notes: ['El patrimonio presenta un déficit de $40.000.000,00, causal de disolución.', 'El patrimonio asciende a $40.000.000,00 negativos.'], acta: null }),
      narrativeSourcesFromPreprocessed(ppPatrimonioNegativo, null),
    );
    expect(neg.motivos).toEqual([]);
  });
});
