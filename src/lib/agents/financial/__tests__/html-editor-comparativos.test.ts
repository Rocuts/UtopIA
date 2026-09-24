// ---------------------------------------------------------------------------
// Editor Jefe HTML — comparativos del EFE y del ECP (integración I2)
// ---------------------------------------------------------------------------
// Desde el pendiente #3 (P2) el contrato NIIF trae la columna comparativa del
// EFE y las filas del ECP comparativo calculadas por el código, o la nota de
// comparativo no presentado. El prompt del Editor Jefe y su validador no las
// usaban: el HTML podía imprimir un comparativo del EFE/ECP redactado por el
// modelo (cifras que no están en el JSON) y salir emittable. Además el prompt
// exigía las devoluciones 4175 en línea separada "(NIIF 15 §47)", norma que no
// lo exige: es criterio de presentación de UtopIA.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { reconcileBindingFigures } from '../agents/html-editor-validator';
import type { HtmlEditorInput } from '../contracts/html-editor';
import type { NiifReportJson } from '../contracts/niif-report';
import { buildHtmlEditorSystemPrompt, buildHtmlEditorUserContent } from '../prompts/html-editor.prompt';
import { formatCopFromCents } from '../contracts/money';
import {
  csvDosCortes,
  csvTresCortes,
  informeTresCortes,
  preprocesarTresCortes,
} from '../__fixtures__/tres-cortes-comparativo';

const tres = () => informeTresCortes(preprocesarTresCortes());
const dos = () => informeTresCortes(preprocesarTresCortes(csvDosCortes()));

const tbl = (head: string[], rows: string[][]) =>
  `<table class="ft"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>` +
  rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('') +
  `</tbody></table>`;

const page = (title: string, body: string) => `<article class="page"><h2>${title}</h2>${body}</article>`;

/** EFE a dos columnas con las cifras del JSON (tres cortes), o con las que se pasen. */
function efeDosColumnas(overrides: Record<string, string> = {}) {
  const row = (label: string, a: string, b: string) => [label, a, overrides[label] ?? b];
  return page(
    'Página 07 · Estado de flujos de efectivo',
    tbl(['Concepto', '2025', '2024'], [
      row('Utilidad neta del ejercicio', '$18.000.000,00', '$15.000.000,00'),
      row('Depreciación', '$7.000.000,00', '$6.000.000,00'),
      row('Flujo neto de actividades de operación', '$19.000.000,00', '$11.000.000,00'),
      row('Flujo neto de actividades de inversión', '$0,00', '($20.000.000,00)'),
      row('Flujo neto de actividades de financiación', '($24.000.000,00)', '$24.000.000,00'),
      row('Aumento (disminución) neto en efectivo', '($5.000.000,00)', '$15.000.000,00'),
      row('Efectivo al inicio del período', '$35.000.000,00', '$20.000.000,00'),
      row('Efectivo al final del período', '$30.000.000,00', '$35.000.000,00'),
    ]),
  );
}

function efeUnaColumna(note: string | null) {
  return page(
    'Página 07 · Estado de flujos de efectivo',
    tbl(['Concepto', '2025'], [
      ['Aumento (disminución) neto en efectivo', '($5.000.000,00)'],
      ['Efectivo al inicio del período', '$35.000.000,00'],
      ['Efectivo al final del período', '$30.000.000,00'],
    ]) + (note ? `<p class="nota">${note}</p>` : ''),
  );
}

function ecpComparativo(rows: string[][]) {
  return page(
    'Página 08 · Estado de cambios en el patrimonio',
    tbl(['Movimiento', 'Capital', 'Reservas', 'Resultados acumulados', 'Resultado del ejercicio', 'Total'], rows),
  );
}

const html = (...pages: string[]) => `<!DOCTYPE html><html><body>${pages.join('')}</body></html>`;

const rule = /Comparativo del EFE\/ECP/;
const failuresOf = (h: string, niif: NiifReportJson) =>
  reconcileBindingFigures(h, { niifReport: niif }).filter((f) => rule.test(f.rule));

describe('Validador HTML — comparativo del EFE', () => {
  it('tres cortes: la columna 2024 con las cifras deterministas del JSON pasa', () => {
    expect(failuresOf(html(efeDosColumnas()), tres())).toEqual([]);
  });

  it('tres cortes: una cifra de la columna 2024 que no está en el JSON bloquea', () => {
    const out = failuresOf(
      html(efeDosColumnas({ 'Flujo neto de actividades de operación': '$12.500.000,00' })),
      tres(),
    );
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe('block');
    expect(out[0].detail).toContain('$12.500.000,00');
  });

  it('un subtítulo h3 dentro del EFE no le quita el contexto a la tabla', () => {
    const conSubtitulo = efeDosColumnas({ 'Flujo neto de actividades de operación': '$12.500.000,00' }).replace(
      '</h2>',
      '</h2><h3>Actividades de operación, inversión y financiación</h3>',
    );
    expect(failuresOf(html(conSubtitulo), tres()).map((f) => f.severity)).toEqual(['block']);
  });

  it('una tabla de la Parte II sobre "flujo de caja" con columna 2024 no se toma por el EFE', () => {
    const analisis = page(
      'Análisis del flujo de caja',
      tbl(['Concepto', '2025', '2024'], [['Flujo de caja libre', '$9.000.000,00', '$7.777.777,00']]),
    );
    expect(failuresOf(html(efeDosColumnas(), analisis), tres())).toEqual([]);
  });

  it('dos cortes: una columna comparativa del EFE sin base en el JSON bloquea', () => {
    const out = failuresOf(html(efeDosColumnas()), dos());
    expect(out.some((f) => f.severity === 'block' && /EFE/.test(f.detail) && /2024/.test(f.detail))).toBe(true);
  });

  it('dos cortes: el EFE a una columna con la nota determinista pasa sin avisos', () => {
    const niif = dos();
    const h = html(efeUnaColumna(niif.cashFlow.comparativeNote), `<p>${niif.equityChanges.comparativeNote}</p>`);
    expect(failuresOf(h, niif)).toEqual([]);
  });

  it('dos cortes: sin la nota del comparativo no presentado queda un aviso', () => {
    const niif = dos();
    const out = failuresOf(html(efeUnaColumna(null), `<p>${niif.equityChanges.comparativeNote}</p>`), niif);
    expect(out).toEqual([
      expect.objectContaining({ severity: 'warn', detail: expect.stringMatching(/^El EFE no presenta el periodo 2024.*nota/) }),
    ]);
  });
});

describe('Validador HTML — comparativo del ECP', () => {
  const filasComparativas = [
    ['Saldo al inicio del periodo 2024', '$50.000.000,00', '$3.000.000,00', '$10.000.000,00', '$10.000.000,00', '$73.000.000,00'],
    ['Utilidad del ejercicio 2024', '$0,00', '$0,00', '$0,00', '$15.000.000,00', '$15.000.000,00'],
    ['Saldo al cierre del periodo 2024', '$70.000.000,00', '$4.000.000,00', '$13.000.000,00', '$15.000.000,00', '$102.000.000,00'],
  ];

  it('tres cortes: las filas 2024 con las cifras deterministas pasan', () => {
    expect(failuresOf(html(ecpComparativo(filasComparativas)), tres())).toEqual([]);
  });

  it('tres cortes: una fila 2024 con una cifra que no está en el JSON bloquea', () => {
    const inventada = filasComparativas.map((r) => [...r]);
    inventada[1][4] = '$16.500.000,00';
    inventada[1][5] = '$16.500.000,00';
    const out = failuresOf(html(ecpComparativo(inventada)), tres());
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe('block');
    expect(out[0].detail).toContain('$16.500.000,00');
  });

  it('dos cortes: filas del periodo 2024 redactadas por el modelo bloquean; el saldo inicial 2025 rotulado al 31-dic-2024 no', () => {
    const niif = dos();
    const out = failuresOf(html(ecpComparativo(filasComparativas)), niif);
    expect(out.some((f) => f.severity === 'block' && /ECP/.test(f.detail))).toBe(true);
    // El saldo inicial del periodo actual es el cierre de 2024: cifras del JSON.
    const soloApertura = failuresOf(
      html(
        ecpComparativo([
          ['Saldo al 31 de diciembre de 2024', '$70.000.000,00', '$4.000.000,00', '$13.000.000,00', '$15.000.000,00', '$102.000.000,00'],
        ]) + `<p>${niif.equityChanges.comparativeNote}</p><p>${niif.cashFlow.comparativeNote}</p>`,
      ),
      niif,
    );
    expect(soloApertura).toEqual([]);
  });
});

describe('Validador HTML — ECP en las 6 columnas de la plantilla v10.1 (revisión I2)', () => {
  // La página 08 de la plantilla agrega "Reservas" (legal + otras). Con
  // reservas estatutarias (3315) además de la legal, una fila honesta imprime
  // una suma que no es una celda del JSON: antes bloqueaba el informe.
  const conOtrasReservas = () =>
    informeTresCortes(
      preprocesarTresCortes(
        csvTresCortes()
          .replace('110505,Caja general,Auxiliar,1,20000000,35000000,30000000', '110505,Caja general,Auxiliar,1,22000000,37000000,32000000')
          .replace('360505,', '331505,Reservas estatutarias,Auxiliar,1,2000000,2000000,2000000\n360505,'),
      ),
    );
  const cop = (cents: bigint) => formatCopFromCents(cents < BigInt(0) ? -cents : cents, true);
  type Row = NiifReportJson['equityChanges']['rows'][number];
  const filaPlantilla = (label: string, r: Row, reservas?: string) => [
    label,
    cop(BigInt(r.capitalSocial)),
    reservas ?? cop(BigInt(r.reservaLegal) + BigInt(r.otrasReservas)),
    cop(BigInt(r.resultadosAcumulados)),
    cop(BigInt(r.resultadoEjercicio)),
    cop(BigInt(r.total)),
  ];
  const tabla = (niif: NiifReportJson, reservasApertura?: string) => {
    const cmp = niif.equityChanges.comparativeRows!;
    const cur = niif.equityChanges.rows;
    return ecpComparativo([
      ['Periodo 2024', '', '', '', '', ''],
      ...cmp.map((r, i) => filaPlantilla(r.label, r, i === 0 ? reservasApertura : undefined)),
      ['Periodo 2025', '', '', '', '', ''],
      filaPlantilla('Saldo al 31 de diciembre de 2024', cur[0]),
      ...cur.slice(1).map((r) => filaPlantilla(r.label, r)),
    ]);
  };

  it('Reservas = legal + otras en las filas 2024 y en la apertura 2025 no bloquea', () => {
    const niif = conOtrasReservas();
    const apertura = niif.equityChanges.comparativeRows![0];
    expect(BigInt(apertura.reservaLegal)).not.toBe(BigInt(0));
    expect(BigInt(apertura.otrasReservas)).not.toBe(BigInt(0));
    expect(failuresOf(html(tabla(niif)), niif)).toEqual([]);
  });

  it('una cifra inventada en la columna agregada sigue bloqueando', () => {
    const niif = conOtrasReservas();
    const out = failuresOf(html(tabla(niif, '$7.777.777,00')), niif);
    expect(out.map((f) => f.severity)).toEqual(['block']);
    expect(out[0].detail).toContain('$7.777.777,00');
  });
});

describe('Prompt del Editor Jefe — comparativos deterministas y devoluciones 4175', () => {
  const input = (niif: NiifReportJson) =>
    ({
      metadata: {},
      niifReport: niif,
      strategyReport: {},
      governanceReport: {},
      company: { name: niif.company.name, nit: niif.company.nit, fiscalPeriod: '2025' },
      language: 'es',
    }) as unknown as HtmlEditorInput;

  it('tres cortes: el bloque de comparativos trae las cifras del EFE y del ECP 2024 ya formateadas', () => {
    const content = buildHtmlEditorUserContent(input(tres()));
    const start = content.indexOf('<comparativos_efe_ecp>\nComparativos');
    const block = content.slice(start, content.indexOf('</comparativos_efe_ecp>', start));
    expect(block).toContain('EFE 2024');
    expect(block).toContain('Flujo neto de actividades de operación 2024: $11.000.000,00');
    expect(block).toContain('Flujo neto de actividades de inversión 2024: $20.000.000,00  (valor negativo');
    expect(block).toContain('Aumento (disminución) neto en efectivo 2024: $15.000.000,00');
    expect(block).toContain('Efectivo al final del período 2024: $35.000.000,00');
    expect(block).toContain('ECP 2024');
    expect(block).toContain('Utilidad del ejercicio 2024');
    expect(block).toContain('total $102.000.000,00');
    expect(content).toMatch(/NEVER: (?:calcular|redactar|inventar)[^\n]*comparativ[^\n]*EFE/i);
  });

  it('dos cortes: el bloque trae la nota determinista para copiarla literal', () => {
    const niif = dos();
    const content = buildHtmlEditorUserContent(input(niif));
    const start = content.indexOf('<comparativos_efe_ecp>\nComparativos');
    const block = content.slice(start, content.indexOf('</comparativos_efe_ecp>', start));
    expect(start).toBeGreaterThan(-1);
    expect(block).toContain(niif.cashFlow.comparativeNote!);
    expect(block).toContain(niif.equityChanges.comparativeNote!);
    expect(block).not.toMatch(/\$\d/);
  });

  it('sin periodo comparativo no hay bloque', () => {
    const niif = tres();
    const sin = { ...niif, company: { ...niif.company, comparativePeriod: null } };
    expect(buildHtmlEditorUserContent(input(sin))).not.toContain('<comparativos_efe_ecp>\nComparativos');
  });

  it('las devoluciones 4175 son criterio de presentación de UtopIA, no NIIF 15 §47', () => {
    const content = buildHtmlEditorUserContent(input(tres()));
    expect(content).not.toMatch(/NIIF 15 §47/);
    expect(content).toMatch(/4175[^\n]*criterio de presentación de UtopIA/);
  });

  it('integración I4: la spec v10.1 embebida en el system prompt tampoco atribuye la línea 4175 a NIIF 15 §47', () => {
    const system = buildHtmlEditorSystemPrompt();
    const linea4175 = system.split('\n').find((l) => l.includes('Cta 4175'));
    expect(linea4175).toBeDefined();
    expect(linea4175).not.toMatch(/NIIF 15/);
    expect(linea4175).toMatch(/criterio de presentación de UtopIA/);
    expect(linea4175).toMatch(/41 − 4175/);
    expect(system).not.toMatch(/NIIF 15 §47/);
  });
});
