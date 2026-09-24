// ---------------------------------------------------------------------------
// R6 del HTML alineado con el cruce de prosa de la Parte II (re-auditoría
// final de la fase 2: narrativa-08)
// ---------------------------------------------------------------------------
// R6 juzgaba proyecciones, metas, impactos de recomendaciones, incisos y
// componentes que `checkStrategyNarrative` acepta en la Parte II: la MISMA
// prosa dejaba el HTML en BORRADOR (emittable=false) tras un reintento pagado
// del Editor Jefe. Ahora R6 usa las exenciones de la Parte II y trata como
// propuesta la prosa de las secciones de recomendaciones / plan de acción /
// próximo cierre / proyección y las frases en infinitivo. Las cifras del
// periodo afirmadas fuera de esas secciones se siguen cruzando.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { reconcileBindingFigures } from '../agents/html-editor-validator';
import type { NiifReportJson } from '../contracts/niif-report';
import type { StrategyReportJson } from '../contracts/strategy-report';
import { checkStrategyNarrative, narrativeSourcesFromPreprocessed } from '../validators/narrative-anchors';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';

/** S.A. con utilidad $20M: activo 90M, pasivo 30M, patrimonio 60M, efectivo 50M, ingresos 100M. */
const CSV_SA = [
  'codigo,nombre,nivel,transaccional,saldo 2025',
  '110505,Caja,Auxiliar,1,50000000',
  '130505,Clientes,Auxiliar,1,40000000',
  '220505,Proveedores,Auxiliar,1,30000000',
  '311505,Capital,Auxiliar,1,40000000',
  '360505,Utilidad del ejercicio,Auxiliar,1,20000000',
  '410505,Ventas,Auxiliar,1,100000000',
  '510505,Sueldos,Auxiliar,1,80000000',
].join('\n');
const pp = preprocessTrialBalance(parseTrialBalanceCSV(CSV_SA));
const C = (p: number) => String(BigInt(p) * BigInt(100));
const NIIF = {
  company: { fiscalPeriod: '2025', comparativePeriod: null },
  balanceSheet: { totalAssetsPrimary: C(90_000_000), totalLiabilitiesPrimary: C(30_000_000), totalEquityPrimary: C(60_000_000) },
  incomeStatement: { grossProfitPrimary: C(100_000_000), operatingProfitPrimary: C(20_000_000), netIncomePrimary: C(20_000_000), oriPrimary: '0' },
  cashFlow: { cashOpening: C(0), cashClosing: C(50_000_000), netChange: C(50_000_000) },
  equityChanges: { rows: [{ kind: 'closing_balance', total: C(60_000_000) }] },
} as unknown as NiifReportJson;
const BASE =
  '<article class="page"><h1>Resumen</h1><p>Total activos $90.000.000,00; total pasivos $30.000.000,00; total patrimonio $60.000.000,00; ' +
  'utilidad neta $20.000.000,00; efectivo al cierre $50.000.000,00.</p></article>';

const r6 = (body: string) =>
  reconcileBindingFigures(`<html><body>${BASE}${body}</body></html>`, { niifReport: NIIF, preprocessed: pp })
    .filter((f) => f.severity === 'block' && /concepto anclado/.test(f.rule))
    .map((f) => f.detail);
const page = (title: string, inner: string) => `<article class="page"><h1>${title}</h1>${inner}</article>`;

/** La prosa honesta del hallazgo (FP-8 de la re-auditoría). */
const PROSE = [
  'Para 2026 se proyecta una utilidad neta de $30.000.000,00.',
  'Meta: llevar los ingresos operacionales netos a $150.000.000,00 en 2026.',
  'El total de activos se concentra en el efectivo, con $50.000.000,00.',
  'La reserva legal se calcula como el 10 % de la utilidad neta ($20.000.000,00).',
];

describe('narrativa-08 — la prosa que la Parte II acepta no bloquea el HTML', () => {
  it('control: el HTML base no tiene bloqueantes R6', () => expect(r6('')).toEqual([]));

  it('proyección, meta, componente e inciso: 0 motivos en la Parte II y 0 bloqueantes R6', () => {
    const strategy = {
      company: { fiscalPeriod: '2025' },
      executiveDashboard: { rows: [], executiveCommentary: PROSE.join(' ') },
      recommendations: [],
    } as unknown as StrategyReportJson;
    expect(checkStrategyNarrative(strategy, narrativeSourcesFromPreprocessed(pp, null)).motivos).toEqual([]);
    expect(r6(page('Análisis', PROSE.map((p) => `<p>${p}</p>`).join('')))).toEqual([]);
  });

  it('recomendación en infinitivo (página 13 v10.1), dentro o fuera de su sección, no bloquea', () => {
    const li = '<li>Elevar la utilidad neta a $30 M y el EBITDA en $12 M.</li>';
    expect(r6(`<ol>${li}</ol>`)).toEqual([]);
    expect(
      r6(page('Recomendaciones y plan de acción', `<div class="rec"><h3>Prioridad alta · Sección 3</h3><p><strong>Elevar la utilidad</strong></p><p>Elevar la utilidad neta a $30 M y el EBITDA en $12 M.</p></div>`)),
    ).toEqual([]);
  });

  it('impacto esperado y "próximo cierre" dentro de su sección no bloquean', () => {
    expect(
      r6(
        page('Recomendaciones y plan de acción', '<h3>Prioridad media</h3><p>Mayor utilidad neta en $3.000.000,00 por menores provisiones.</p>') +
          page('Análisis editorial', '<h2>El próximo cierre</h2><p>La utilidad neta llegaría a $35.000.000,00 con la nueva línea.</p>'),
      ),
    ).toEqual([]);
  });

  it('una tabla de proyección (encabezado de años futuros o sección de proyección) no se juzga', () => {
    expect(r6('<table><tr><th>Concepto</th><th>2026</th><th>2027</th></tr><tr><td>Utilidad neta</td><td>$30 M</td><td>$36 M</td></tr></table>')).toEqual([]);
    expect(
      r6(page('Proyección de flujo de caja', '<table><tr><th>Concepto</th><th>Conservador</th><th>Base</th></tr><tr><td>Utilidad neta</td><td>$25 M</td><td>$30 M</td></tr></table>')),
    ).toEqual([]);
  });
});

describe('narrativa-08 — las cifras del periodo afirmadas fuera de una propuesta siguen bloqueando', () => {
  it('prosa del resumen con utilidad, efectivo y activos falsos bloquea', () => {
    const b = r6(
      page(
        'Los tres movimientos del año',
        '<p>La utilidad neta del ejercicio fue de $4.000.000,00.</p><p>El efectivo al cierre de 2025 asciende a $9.999.999,00.</p>' +
          '<p>El total de activos asciende a $95.000.000,00.</p>',
      ),
    );
    expect(b.join('\n')).toMatch(/Utilidad neta: el HTML imprime \$4\.000\.000,00/);
    expect(b.join('\n')).toMatch(/Efectivo al cierre: el HTML imprime \$9\.999\.999,00/);
    expect(b.join('\n')).toMatch(/Total Activo: el HTML imprime \$95\.000\.000,00/);
  });

  it('un párrafo mixto: la afirmación del periodo bloquea aunque siga una frase en infinitivo', () => {
    const b = r6('<p>La utilidad neta del ejercicio fue de $4.000.000,00. Elevarla a $30 M exige ajustar precios.</p>');
    expect(b).toHaveLength(1);
    expect(b[0]).toMatch(/Utilidad neta: el HTML imprime \$4\.000\.000,00/);
  });

  it('"Primer"/"Cualquier" no son infinitivos: la frase se juzga', () => {
    expect(r6('<li>Primer cierre con una utilidad neta de $4.000.000,00.</li>')).toHaveLength(1);
  });

  it('una tabla resumen del periodo con cifra abreviada falsa bloquea', () => {
    const b = r6('<table><tr><th>Indicador</th><th>2025</th></tr><tr><td>Utilidad neta</td><td>$4.000 M</td></tr></table>');
    expect(b.join('\n')).toMatch(/Utilidad neta: el HTML imprime \$4\.000\.000\.000,00 \(abreviado\)/);
  });

  it('una sección editorial que no es de propuestas se juzga ("La posición financiera")', () => {
    const b = r6(page('Análisis editorial', '<h2>La posición financiera</h2><p>El patrimonio al cierre es de $66.000.000,00.</p>'));
    expect(b.join('\n')).toMatch(/Total Patrimonio: el HTML imprime \$66\.000\.000,00/);
  });

  it('en la sección de recomendaciones, o tras un infinitivo, la frase que AFIRMA un saldo se juzga', () => {
    const b = r6(
      page(
        'Recomendaciones y plan de acción',
        '<h3>Prioridad alta</h3><p>La utilidad neta del ejercicio fue de $4.000.000,00; elevarla a $30 M exige ajustar precios.</p>' +
          '<p>Destacar que el total de activos asciende a $95.000.000,00.</p>',
      ),
    );
    expect(b.join('\n')).toMatch(/Utilidad neta: el HTML imprime \$4\.000\.000,00/);
    expect(b.join('\n')).toMatch(/Total Activo: el HTML imprime \$95\.000\.000,00/);
    expect(b).toHaveLength(2);
  });

  it('la sección de recomendaciones termina con su página: la siguiente se juzga', () => {
    const b = r6(
      page('Recomendaciones y plan de acción', '<p>Elevar la utilidad neta a $30 M.</p>') +
        page('Cierre y trazabilidad', '<p>La utilidad neta del ejercicio fue de $4.000.000,00.</p>'),
    );
    expect(b).toHaveLength(1);
  });
});

// Revisión adversarial F-html: en la sección de recomendaciones la tarjeta
// mezcla el diagnóstico (que la Parte II juzga) con la acción y el impacto
// (que exime). Eximir TODA su prosa dejaba pasar cifras falsas del periodo.
describe('revisión F-html — el diagnóstico dentro de la sección de recomendaciones se juzga', () => {
  const reco = (inner: string) => page('Recomendaciones y plan de acción', `<h3>Prioridad alta · Sección 3</h3>${inner}`);

  for (const p of [
    'La utilidad neta de $4.000.000,00 limita el reparto de dividendos.',
    'Utilidad neta: $4.000.000,00.',
    'La utilidad neta registra $4.000.000,00 y no cubre la reserva.',
    'El patrimonio al cierre, de $66.000.000,00, respalda el plan.',
    'Con una utilidad neta del ejercicio de $4.000.000,00, la empresa debe reducir costos.',
    // Un comparativo DESPUÉS de la cifra califica el saldo del periodo, no es un impacto.
    'La utilidad neta de $4.000.000,00 es menor a la esperada.',
    'La utilidad neta de $4.000.000,00 refleja una reducción de márgenes.',
  ]) {
    it(`bloquea: "${p}"`, () => {
      expect(r6(reco(`<p>${p}</p>`))).toHaveLength(1);
    });
  }

  it('el mismo diagnóstico en la tarjeta "El próximo cierre" bloquea', () => {
    expect(r6(page('Análisis editorial', '<h2>El próximo cierre</h2><p>La utilidad neta de $4.000.000,00 limita el reparto.</p>'))).toHaveLength(1);
  });

  it('el diagnóstico honesto, la acción y el impacto de la misma tarjeta no bloquean', () => {
    expect(
      r6(
        reco(
          '<p>La utilidad neta de $20.000.000,00 cubre la reserva legal. Elevar la utilidad neta a $30 M con la revisión de precios.</p>' +
            '<p>Impacto esperado: utilidad neta de $30.000.000,00.</p><p>Ahorro de $3.000.000,00 en la utilidad neta por menores provisiones.</p>' +
            '<p>Menor utilidad neta, de $18.000.000,00, si no se ajustan precios.</p><p>La utilidad neta subiría a $25.000.000,00.</p>' +
            '<p>Utilidad neta de $30.000.000,00 en 2026.</p><p>Utilidad neta de $30.000.000,00 (meta).</p>',
        ),
      ),
    ).toEqual([]);
  });

  it('una sección de recomendaciones en inglés (imperativo no reconocible por su forma) sigue exenta', () => {
    expect(r6(page('Recommendations and action plan', '<p>Raise EBITDA by $12 M.</p>'))).toEqual([]);
    expect(r6(page('Three urgent actions', '<ol><li>Raise EBITDA by $12 M.</li></ol>'))).toEqual([]);
    // Documento en inglés con un encabezado que no nombra la sección en inglés.
    const en = reconcileBindingFigures(
      `<html lang="en"><body>${BASE}${page('Recomendaciones', '<p>Raise EBITDA by $12 M.</p>')}</body></html>`,
      { niifReport: NIIF, preprocessed: pp },
    ).filter((f) => f.severity === 'block' && /concepto anclado/.test(f.rule));
    expect(en).toEqual([]);
  });
});
