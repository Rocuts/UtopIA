// ---------------------------------------------------------------------------
// Editor Jefe HTML — ORI, columna comparativa y comparativos del EFE/ECP fila
// por fila (re-auditoría final de la fase 2: e2e-niif2-03, e2e-niif2-04,
// narrativa-16)
// ---------------------------------------------------------------------------
// e2e-niif2-04: en un informe honesto de dos cortes con utilidad, la fila del
//   EFE "Utilidad neta del ejercicio" con la columna 2024 en "—" (EFE
//   comparativo no presentado) bloqueaba con un mensaje contradictorio ("la
//   columna 2025 imprime $18M; el reporte da $18M").
// e2e-niif2-03: el ORI no se conciliaba (ni signo ni importe) y los
//   comparativos del EFE/ECP se validaban por pertenencia a un CONJUNTO de
//   cifras (valor absoluto, con sumas de columnas de la misma fila): un ORI con
//   el signo invertido, el capital de apertura 2024 del ECP con el del cierre o
//   dos renglones del EFE 2024 permutados salían emitibles.
// narrativa-16: la columna comparativa del EFE sólo se reconocía si el
//   encabezado era el año o terminaba en " <año>" ("2024 (comparativo)",
//   "Dic-2024" pasaban sin cruce).
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { reconcileBindingFigures, validateHtmlChecklist } from '../agents/html-editor-validator';
import type { NiifReportJson } from '../contracts/niif-report';
import {
  csvDosCortes,
  csvTresCortesConValorizaciones,
  informeTresCortes,
  preprocesarTresCortes,
} from '../__fixtures__/tres-cortes-comparativo';
import { informeHonesto, preprocesarPerdidaComparativo } from '../__fixtures__/perdida-comparativo-w4a';
import { buildHonestHtml, cop, honestMetadata, type HonestLanguage } from './html-editor-honesto';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';

interface Scenario {
  name: string;
  pp: PreprocessedBalance;
  niif: NiifReportJson;
}

function tres(): Scenario {
  const pp = preprocesarTresCortes();
  return { name: 'tres cortes', pp, niif: informeTresCortes(pp) };
}
function tresOri(): Scenario {
  const pp = preprocesarTresCortes(csvTresCortesConValorizaciones([5_000_000, 8_000_000, 6_000_000]));
  return { name: 'tres cortes con ORI', pp, niif: informeTresCortes(pp) };
}
function dos(): Scenario {
  const pp = preprocesarTresCortes(csvDosCortes());
  return { name: 'dos cortes', pp, niif: informeTresCortes(pp) };
}
/** El balance de tres cortes sin el corte 2023 (misma transformación que `csvDosCortes`). */
const sinPrimerCorte = (csv: string) =>
  csv
    .split('\n')
    .map((line) => {
      const cells = line.split(',');
      if (cells.length < 7) return line;
      if (cells[4] === 'saldo 2023' || /^\d+$/.test(cells[0])) cells.splice(4, 1);
      return cells.join(',');
    })
    .join('\n');
function dosOri(): Scenario {
  const pp = preprocesarTresCortes(sinPrimerCorte(csvTresCortesConValorizaciones([5_000_000, 8_000_000, 6_000_000])));
  return { name: 'dos cortes con ORI', pp, niif: informeTresCortes(pp) };
}
function perdida(): Scenario {
  const pp = preprocesarPerdidaComparativo();
  return { name: 'pérdida', pp, niif: informeHonesto(pp) };
}

const blocks = (html: string, s: Scenario) =>
  reconcileBindingFigures(html, { niifReport: s.niif, preprocessed: s.pp }).filter((f) => f.severity === 'block');

const allBlocks = (html: string, s: Scenario) => [
  ...validateHtmlChecklist(html, honestMetadata(s.niif)).filter((f) => f.severity === 'block'),
  ...blocks(html, s),
];

describe('HTML honesto — sin bloqueantes (dos y tres cortes, ORI, pérdida, inglés)', () => {
  const cases: Array<[() => Scenario, HonestLanguage]> = [
    [dos, 'es'],
    [dosOri, 'es'],
    [tres, 'es'],
    [tresOri, 'es'],
    [perdida, 'es'],
    [dos, 'en'],
    [tresOri, 'en'],
    [perdida, 'en'],
  ];
  for (const [make, language] of cases) {
    const s = make();
    it(`${s.name} (${language})`, () => {
      expect(allBlocks(buildHonestHtml(s.niif, { language }), s)).toEqual([]);
    });
  }

  it('el escenario con ORI mueve el ORI en ambos periodos y con signo distinto', () => {
    const s = tresOri();
    expect(BigInt(s.niif.incomeStatement.oriPrimary)).toBeLessThan(BigInt(0));
    expect(BigInt(s.niif.incomeStatement.oriComparative!)).toBeGreaterThan(BigInt(0));
    const d = dosOri();
    expect(BigInt(d.niif.incomeStatement.oriPrimary)).not.toBe(BigInt(0));
    expect(d.niif.cashFlow.comparativeNote).not.toBeNull();
  });
});

describe('e2e-niif2-04 — la columna comparativa sin cifra no se exige (R4)', () => {
  it('dos cortes: el EFE a dos columnas con "—" en 2024 no bloquea la fila "Utilidad neta del ejercicio"', () => {
    const s = dos();
    // El HTML del auditor: encabezado 2025 | 2024 en el EFE aunque no haya comparativo.
    const html = buildHonestHtml(s.niif, {
      tweak: (h) =>
        h.replace(/(<h1>Estado de Flujos de Efectivo<\/h1><table class="ft"><thead><tr><th>Concepto<\/th><th>2025<\/th>)/, '$1<th>2024</th>')
          .replace(/(<tr><td>[^<]*<\/td><td>[^<]*(?:<sup class="n">†<\/sup>)?[^<]*<\/td>)(<\/tr>)/g, (m, a: string, b: string) =>
            m.includes('<td>—</td>') ? m : `${a}<td>—</td>${b}`),
    });
    expect(html).toContain('<td>Utilidad neta del ejercicio</td><td>$18.000.000,00</td><td>—</td>');
    const out = blocks(html, s).filter((f) => f.rule === '§1.1 · Periodo del reporte — columna');
    expect(out).toEqual([]);
  });

  it('la columna comparativa con OTRA cifra sigue bloqueando y el mensaje nombra la columna que falla', () => {
    const s = tres();
    const html = buildHonestHtml(s.niif, {
      tweak: (h) => h.replace('<td>Utilidad neta</td><td>$18.000.000,00</td><td>$15.000.000,00</td>', '<td>Utilidad neta</td><td>$18.000.000,00</td><td>$16.000.000,00</td>'),
    });
    const out = blocks(html, s).filter((f) => f.rule === '§1.1 · Periodo del reporte — columna');
    expect(out).toHaveLength(1);
    expect(out[0].detail).toMatch(/columna 2024 imprime "\$16\.000\.000,00"/);
    expect(out[0].detail).toMatch(/\$15\.000\.000,00 para 2024/);
  });
});

describe('e2e-niif2-03 — ORI y resultado integral total conciliados con signo', () => {
  const s = tresOri();
  const ori = s.niif.incomeStatement.oriPrimary; // −$2M
  const oriC = s.niif.incomeStatement.oriComparative!; // +$3M
  const row = (label: string, a: string, b: string) => `<tr><td>${label}</td><td>${a}</td><td>${b}</td></tr>`;
  const base = () => buildHonestHtml(s.niif);
  const withRow = (from: string, to: string) => {
    const h = base();
    expect(h).toContain(from);
    return h.replace(from, to);
  };

  it('control: el HTML honesto con ORI no bloquea', () => {
    expect(blocks(base(), s)).toEqual([]);
  });

  it('ORI 2025 con el signo invertido bloquea', () => {
    const h = withRow(row('Otro resultado integral', cop(ori), cop(oriC)), row('Otro resultado integral', cop(-BigInt(ori)), cop(oriC)));
    const out = blocks(h, s);
    expect(out.some((f) => /Otro Resultado Integral|ORI/.test(f.detail))).toBe(true);
  });

  it('ORI 2025 con otro importe negativo ($3M) bloquea', () => {
    const h = withRow(row('Otro resultado integral', cop(ori), cop(oriC)), row('Otro resultado integral', '($3.000.000,00)', cop(oriC)));
    expect(blocks(h, s).some((f) => /Otro Resultado Integral|ORI/.test(f.detail))).toBe(true);
  });

  it('ORI 2024 con otro importe ($5M) bloquea', () => {
    const h = withRow(row('Otro resultado integral', cop(ori), cop(oriC)), row('Otro resultado integral', cop(ori), '$5.000.000,00'));
    expect(blocks(h, s).some((f) => /Otro Resultado Integral|ORI/.test(f.detail) && /2024/.test(f.detail))).toBe(true);
  });

  it('resultado integral total distinto de utilidad + ORI bloquea', () => {
    const rit = (BigInt(s.niif.incomeStatement.netIncomePrimary) + BigInt(ori)).toString();
    const ritC = (BigInt(s.niif.incomeStatement.netIncomeComparative!) + BigInt(oriC)).toString();
    const h = withRow(row('Resultado integral total', cop(rit), cop(ritC)), row('Resultado integral total', '$20.000.000,00', cop(ritC)));
    expect(blocks(h, s).some((f) => /Resultado Integral Total/.test(f.detail))).toBe(true);
  });

  // Revisión F-html: con el rótulo en otra variante habitual el ORI invertido
  // no se conciliaba (R4 exigía el rótulo exacto y R3 lo encontraba con su
  // signo en la columna ORI del ECP).
  for (const label of ['Otro resultado integral (ORI)', 'Otro resultado integral, neto de impuestos', 'Otro resultado integral del año']) {
    it(`ORI 2025 con el signo invertido bloquea con el rótulo "${label}"; el honesto con ese rótulo pasa`, () => {
      const honest = withRow(row('Otro resultado integral', cop(ori), cop(oriC)), row(label, cop(ori), cop(oriC)));
      expect(blocks(honest, s)).toEqual([]);
      const h = withRow(row('Otro resultado integral', cop(ori), cop(oriC)), row(label, cop(-BigInt(ori)), cop(oriC)));
      expect(blocks(h, s).some((f) => /columna/.test(f.rule) && /Otro Resultado Integral/.test(f.detail))).toBe(true);
    });
  }

  it('un ORI que no aparece en ninguna parte del HTML bloquea (cifra vinculante)', () => {
    const h = withRow(row('Otro resultado integral', cop(ori), cop(oriC)), '').replace(/<td>\(\$2\.000\.000,00\)<\/td>/g, '<td>—</td>');
    expect(h).not.toContain('($2.000.000,00)');
    // Ausente con su signo: R1 (ausente) o R3 (sólo aparece sin signo, p. ej. la
    // variación de inventarios del EFE, que también vale $2.000.000,00).
    expect(blocks(h, s).some((f) => /Otro Resultado Integral — período actual/.test(f.detail))).toBe(true);
  });
});

describe('e2e-niif2-03 — ECP comparativo fila por fila', () => {
  const s = tresOri();
  const openLabel = s.niif.equityChanges.comparativeRows![0].label;

  it('un movimiento 2024 impreso sin su signo bloquea y el mensaje lo dice (pista para el reintento)', () => {
    const t = s.niif.equityChanges.comparativeRows!.find((r) => r.kind === 'prior_period_result_cancellation')!;
    const h = buildHonestHtml(s.niif, {
      tweak: (x) => {
        const i = x.indexOf(`<td>${t.label}</td>`);
        const end = x.indexOf('</tr>', i);
        return x.slice(0, i) + x.slice(i, end).replace('($10.000.000,00)', '$10.000.000,00') + x.slice(end);
      },
    });
    const out = blocks(h, s).filter((f) => /Comparativo del EFE\/ECP/.test(f.rule));
    expect(out).toHaveLength(1);
    expect(out[0].detail).toContain(`${t.label}: $10.000.000,00 (signo invertido)`);
  });

  it('el saldo de apertura rotulado con el corte anterior ("31 de diciembre de 2023") también se cruza', () => {
    const relabel = (x: string) => x.replace(`<td>${openLabel}</td>`, '<td>Saldo al 31 de diciembre de 2023</td>').replace(/<tr><td>Periodo 2024<\/td>(?:<td><\/td>)+<\/tr>/, '');
    expect(blocks(buildHonestHtml(s.niif, { tweak: relabel }), s).filter((f) => /Comparativo/.test(f.rule))).toEqual([]);
    const fake = buildHonestHtml(s.niif, {
      tweak: (x) => relabel(x).replace('<td>Saldo al 31 de diciembre de 2023</td><td>$50.000.000,00</td>', '<td>Saldo al 31 de diciembre de 2023</td><td>$55.000.000,00</td>'),
    });
    expect(fake).toContain('<td>Saldo al 31 de diciembre de 2023</td><td>$55.000.000,00</td>');
    expect(blocks(fake, s).some((f) => /Comparativo del EFE\/ECP/.test(f.rule) && f.detail.includes('$55.000.000,00'))).toBe(true);
  });

  it('capital de apertura 2024 con el del cierre ($70M en lugar de $50M) bloquea', () => {
    const h = buildHonestHtml(s.niif, {
      tweak: (x) => x.replace(`<td>${openLabel}</td><td>$50.000.000,00</td>`, `<td>${openLabel}</td><td>$70.000.000,00</td>`),
    });
    expect(h).toContain(`<td>${openLabel}</td><td>$70.000.000,00</td>`);
    const out = blocks(h, s).filter((f) => /Comparativo del EFE\/ECP/.test(f.rule));
    expect(out).toHaveLength(1);
    expect(out[0].detail).toContain('$70.000.000,00');
  });

  it('total de apertura 2024 igual a una suma de columnas de la misma fila ($83M) bloquea', () => {
    const open = s.niif.equityChanges.comparativeRows![0];
    const total = cop(open.total);
    const h = buildHonestHtml(s.niif, {
      tweak: (x) => {
        const i = x.indexOf(`<td>${openLabel}</td>`);
        const end = x.indexOf('</tr>', i);
        const rowHtml = x.slice(i, end);
        return x.slice(0, i) + rowHtml.replace(`<td>${total}</td>`, '<td>$83.000.000,00</td>') + x.slice(end);
      },
    });
    expect(h).toContain('$83.000.000,00');
    expect(blocks(h, s).some((f) => /Comparativo del EFE\/ECP/.test(f.rule) && f.detail.includes('$83.000.000,00'))).toBe(true);
  });

  it('una fila 2024 con las cifras de la fila 2025 equivalente bloquea (utilidad 2024 impresa con la de 2025)', () => {
    const profit = s.niif.equityChanges.comparativeRows!.find((r) => r.kind === 'profit_for_period')!;
    const h = buildHonestHtml(s.niif, {
      tweak: (x) => {
        const i = x.indexOf(`<td>${profit.label}</td>`);
        const end = x.indexOf('</tr>', i);
        return x.slice(0, i) + x.slice(i, end).split('$15.000.000,00').join('$18.000.000,00') + x.slice(end);
      },
    });
    expect(h).toMatch(new RegExp(`<td>${profit.label}</td>.*?\\$18\\.000\\.000,00`));
    const out = blocks(h, s).filter((f) => /Comparativo del EFE\/ECP/.test(f.rule));
    expect(out).toHaveLength(1);
    expect(out[0].detail).toContain(`${profit.label}: $18.000.000,00`);
  });
});

describe('e2e-niif2-03 / narrativa-16 — EFE comparativo fila por fila y con signo', () => {
  const s = tres();
  const efeRow = (label: string, a: string, b: string) => `<tr><td>${label}</td><td>${a}</td><td>${b}</td></tr>`;
  const deudores = 'Variación de deudores comerciales y otras cuentas por cobrar';
  const inventarios = 'Variación de inventarios';

  it('control: el EFE honesto a dos columnas pasa', () => {
    expect(blocks(buildHonestHtml(s.niif), s).filter((f) => /Comparativo del EFE\/ECP/.test(f.rule))).toEqual([]);
  });

  it('renglones deudores e inventarios de 2024 permutados bloquean', () => {
    const h = buildHonestHtml(s.niif, {
      tweak: (x) =>
        x
          .replace(efeRow(deudores, '($5.000.000,00)', '($10.000.000,00)'), efeRow(deudores, '($5.000.000,00)', '($5.000.000,00)'))
          .replace(efeRow(inventarios, '$2.000.000,00', '($5.000.000,00)'), efeRow(inventarios, '$2.000.000,00', '($10.000.000,00)')),
    });
    expect(h).toContain(efeRow(deudores, '($5.000.000,00)', '($5.000.000,00)'));
    const out = blocks(h, s).filter((f) => /Comparativo del EFE\/ECP/.test(f.rule));
    expect(out).toHaveLength(1);
    expect(out[0].detail).toContain(deudores);
    expect(out[0].detail).toContain(inventarios);
  });

  it('operación 2024 con la cifra de financiación ($24M) e inversión 2024 en positivo bloquean', () => {
    const h = buildHonestHtml(s.niif, {
      tweak: (x) =>
        x
          .replace(efeRow('Flujo neto de actividades de operación', '$19.000.000,00', '$11.000.000,00'), efeRow('Flujo neto de actividades de operación', '$19.000.000,00', '$24.000.000,00'))
          .replace(efeRow('Flujo neto de actividades de inversión', '<sup class="n">†</sup>$0,00', '($20.000.000,00)'), efeRow('Flujo neto de actividades de inversión', '<sup class="n">†</sup>$0,00', '$20.000.000,00')),
    });
    const out = blocks(h, s).filter((f) => /Comparativo del EFE\/ECP/.test(f.rule));
    expect(out).toHaveLength(1);
    expect(out[0].detail).toContain('Flujo neto de actividades de operación: $24.000.000,00');
    expect(out[0].detail).toMatch(/Flujo neto de actividades de inversión: \$20\.000\.000,00[^;]*signo/);
  });

  for (const header of ['2024 (comparativo)', 'Dic-2024', 'Año 2024']) {
    it(`encabezado "${header}": la operación 2024 inventada ($99M) bloquea; la honesta pasa`, () => {
      const rename = (x: string) =>
        x.replace(/(<h1>Estado de Flujos de Efectivo<\/h1><table class="ft"><thead><tr><th>Concepto<\/th><th>2025<\/th>)<th>2024<\/th>/, `$1<th>${header}</th>`);
      const honest = buildHonestHtml(s.niif, { tweak: rename });
      expect(honest).toContain(`<th>${header}</th>`);
      expect(blocks(honest, s).filter((f) => /Comparativo del EFE\/ECP/.test(f.rule))).toEqual([]);
      const fake = buildHonestHtml(s.niif, {
        tweak: (x) =>
          rename(x).replace(
            efeRow('Flujo neto de actividades de operación', '$19.000.000,00', '$11.000.000,00'),
            efeRow('Flujo neto de actividades de operación', '$19.000.000,00', '$99.000.000,00'),
          ),
      });
      expect(blocks(fake, s).some((f) => /Comparativo del EFE\/ECP/.test(f.rule) && f.detail.includes('$99.000.000,00'))).toBe(true);
    });
  }

  it('una columna "Variación 2025 vs 2024" no se toma por la columna comparativa', () => {
    const h = buildHonestHtml(s.niif, {
      tweak: (x) =>
        x.replace(
          /(<h1>Estado de Flujos de Efectivo<\/h1><table class="ft"><thead><tr><th>Concepto<\/th><th>2025<\/th><th>2024<\/th>)/,
          '$1<th>Variación 2025 vs 2024</th>',
        ).replace(
          efeRow('Efectivo al final del período', '$30.000.000,00', '$35.000.000,00'),
          '<tr><td>Efectivo al final del período</td><td>$30.000.000,00</td><td>$35.000.000,00</td><td>($5.000.000,00)</td></tr>',
        ),
    });
    expect(blocks(h, s).filter((f) => /Comparativo del EFE\/ECP/.test(f.rule))).toEqual([]);
  });
});

describe('Prompt del Editor Jefe — ORI y resultado integral total vinculantes', () => {
  it('el bloque <cifras_vinculantes> trae el ORI y el resultado integral total de cada periodo con su signo', async () => {
    const { buildHtmlEditorUserContent } = await import('../prompts/html-editor.prompt');
    const s = tresOri();
    const content = buildHtmlEditorUserContent({
      metadata: {},
      niifReport: s.niif,
      strategyReport: {},
      governanceReport: {},
      company: { name: s.niif.company.name, nit: s.niif.company.nit, fiscalPeriod: '2025' },
      language: 'es',
    } as never);
    const block = content.slice(content.indexOf('<cifras_vinculantes>'), content.indexOf('</cifras_vinculantes>'));
    expect(block).toContain('Otro Resultado Integral — período actual: $2.000.000,00  (valor negativo');
    expect(block).toContain('Otro Resultado Integral — período comparativo: $3.000.000,00  ←');
    expect(block).toContain('Resultado Integral Total — período actual: $16.000.000,00');
    expect(block).toContain('Resultado Integral Total — período comparativo: $18.000.000,00');
  });

  it('sin ORI no se añade nada (el resultado integral total es la utilidad neta, ya vinculante)', async () => {
    const { buildHtmlEditorUserContent } = await import('../prompts/html-editor.prompt');
    const s = tres();
    const content = buildHtmlEditorUserContent({
      metadata: {}, niifReport: s.niif, strategyReport: {}, governanceReport: {},
      company: { name: s.niif.company.name, nit: s.niif.company.nit, fiscalPeriod: '2025' }, language: 'es',
    } as never);
    expect(content).not.toContain('Otro Resultado Integral —');
  });
});

describe('Maqueta de la re-auditoría (buildHtmlFull): H4 y H3', () => {
  it('H4 — dos cortes con utilidad: EFE a dos columnas con "—" en 2024 → sin bloqueantes', () => {
    for (const make of [dos, dosOri]) {
      const s = make();
      const h = buildHonestHtml(s.niif, { layout: 'auditor' });
      expect(h).toContain('<td>Utilidad neta del ejercicio</td><td>$18.000.000,00</td><td>—</td>');
      expect(allBlocks(h, s)).toEqual([]);
    }
  });

  it('H3 — tres cortes con ORI: el honesto pasa; ORI invertido, capital de apertura 2024 y total 2024 alterados bloquean', () => {
    const s = tresOri();
    const honest = buildHonestHtml(s.niif, { layout: 'auditor' });
    expect(allBlocks(honest, s)).toEqual([]);
    const flip = buildHonestHtml(s.niif, {
      layout: 'auditor',
      tweak: (x) => x.replace('<td>Otro resultado integral</td><td>($2.000.000,00)</td>', '<td>Otro resultado integral</td><td>$2.000.000,00</td>'),
    });
    expect(flip).toContain('<td>Otro resultado integral</td><td>$2.000.000,00</td>');
    expect(blocks(flip, s).some((f) => /columna/.test(f.rule) && /Otro Resultado Integral/.test(f.detail))).toBe(true);
    const open = s.niif.equityChanges.comparativeRows![0];
    const capital = buildHonestHtml(s.niif, {
      layout: 'auditor',
      tweak: (x) => x.replace(`<td>${open.label}</td><td>$50.000.000,00</td>`, `<td>${open.label}</td><td>$70.000.000,00</td>`),
    });
    expect(capital).toContain(`<td>${open.label}</td><td>$70.000.000,00</td>`);
    expect(blocks(capital, s).some((f) => /Comparativo del EFE\/ECP/.test(f.rule))).toBe(true);
    const total = buildHonestHtml(s.niif, {
      layout: 'auditor',
      tweak: (x) => x.replace('<td>$78.000.000,00</td></tr>', '<td>$88.000.000,00</td></tr>'),
    });
    expect(total).toContain('<td>$88.000.000,00</td></tr>');
    expect(blocks(total, s).some((f) => /Comparativo del EFE\/ECP/.test(f.rule) && f.detail.includes('$88.000.000,00'))).toBe(true);
  });
});

describe('revisión F-html — encabezado "Total <componente>" del ECP', () => {
  it('"Total reservas" es la columna de reservas, no el total del patrimonio: el ECP honesto no bloquea', () => {
    const s = tresOri();
    const h = buildHonestHtml(s.niif, { tweak: (x) => x.replace('<th>Reservas</th>', '<th>Total reservas</th>') });
    expect(h).toContain('<th>Total reservas</th>');
    expect(blocks(h, s).filter((f) => /Comparativo del EFE\/ECP/.test(f.rule))).toEqual([]);
  });

  it('"Total reservas" con la reserva de otra fila sigue bloqueando', () => {
    const s = tresOri();
    const open = s.niif.equityChanges.comparativeRows![0];
    const reservas = BigInt(open.reservaLegal) + BigInt(open.otrasReservas);
    const h = buildHonestHtml(s.niif, {
      tweak: (x) => {
        const y = x.replace('<th>Reservas</th>', '<th>Total reservas</th>');
        const i = y.indexOf(`<td>${open.label}</td>`);
        const end = y.indexOf('</tr>', i);
        return y.slice(0, i) + y.slice(i, end).replace(`<td>${cop(reservas.toString())}</td>`, '<td>$9.000.000,00</td>') + y.slice(end);
      },
    });
    expect(h).toContain('$9.000.000,00');
    expect(blocks(h, s).some((f) => /Comparativo del EFE\/ECP/.test(f.rule) && f.detail.includes('$9.000.000,00'))).toBe(true);
  });
});
