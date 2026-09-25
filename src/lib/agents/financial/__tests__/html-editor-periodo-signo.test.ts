// ---------------------------------------------------------------------------
// Gate del HTML: periodo, columna, signo y cifras del acta
// ---------------------------------------------------------------------------
// Hallazgos pipeline-flujo-08 y pipeline-flujo-09 (auditoría 2026-09):
//   - columnas 2025/2024 intercambiadas o rótulos de otro año salían
//     emittable=true (R1 sólo exigía la cifra EN ALGÚN LUGAR del texto);
//   - una pérdida presentada como utilidad pasaba (R1 comparaba en valor
//     absoluto);
//   - un desliz ×100 en la tabla del acta sólo generaba un aviso (R2 warn).
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import type { NiifReportJson } from '../contracts/niif-report';
import { reconcileBindingFigures } from '../agents/html-editor-validator';

const HASH = 'b'.repeat(64);
const C = (pesos: number) => String(BigInt(pesos) * BigInt(100));

const NIIF_COMP = {
  company: { fiscalPeriod: '2025', comparativePeriod: '2024' },
  balanceSheet: {
    totalAssetsPrimary: C(1_000_000_000), totalAssetsComparative: C(800_000_000),
    totalLiabilitiesPrimary: C(400_000_000), totalLiabilitiesComparative: C(400_000_000),
    totalEquityPrimary: C(600_000_000), totalEquityComparative: C(400_000_000),
  },
  incomeStatement: {
    grossProfitPrimary: C(500_000_000), operatingProfitPrimary: C(300_000_000),
    netIncomePrimary: C(200_000_000), netIncomeComparative: C(50_000_000),
  },
  cashFlow: { cashOpening: C(100_000_000), cashClosing: C(150_000_000), netChange: C(50_000_000) },
  equityChanges: { rows: [{ kind: 'closing_balance', total: C(600_000_000) }] },
} as unknown as NiifReportJson;

const tbl = (head: string[], rows: string[][]) =>
  `<table class="ft"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>` +
  rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('') +
  `</tbody></table>`;

function statements(opts: { swap?: boolean; year?: string; prev?: string; netIncome?: string; summary?: string } = {}) {
  const year = opts.year ?? '2025';
  const prev = opts.prev ?? '2024';
  const p = (a: string, b: string) => (opts.swap ? [b, a] : [a, b]);
  const bal = tbl(['Concepto', year, prev], [
    ['TOTAL ACTIVO', ...p('$1.000.000.000,00', '$800.000.000,00')],
    ['TOTAL PASIVO', ...p('$400.000.000,00', '$400.000.000,00')],
    ['TOTAL PATRIMONIO', ...p('$600.000.000,00', '$400.000.000,00')],
  ]);
  const pyg = tbl(['Concepto', year, prev], [
    ['UTILIDAD BRUTA', ...p('$500.000.000,00', '$200.000.000,00')],
    ['UTILIDAD OPERACIONAL', ...p('$300.000.000,00', '$80.000.000,00')],
    ['UTILIDAD NETA', ...p(opts.netIncome ?? '$200.000.000,00', '$50.000.000,00')],
  ]);
  const efe = tbl(['Concepto', year], [
    ['Efectivo al inicio del período', '$100.000.000,00'],
    ['Aumento neto en efectivo', '$50.000.000,00'],
    ['Efectivo al final del período', '$150.000.000,00'],
  ]);
  const ecp = tbl(['Concepto', year], [[`Saldo al 31 de diciembre de ${year}`, '$600.000.000,00']]);
  return `<html><body>
<article><h1>${year}</h1><p>${opts.summary ?? 'Resumen.'}</p><p>${HASH}</p></article>
<article><h2>Estado de Situación Financiera al 31 de diciembre de ${year}</h2>${bal}</article>
<article><h2>Estado de Resultados ${year}</h2>${pyg}</article>
<article><h2>Flujos de Efectivo</h2>${efe}</article>
<article><h2>Cambios en el Patrimonio</h2>${ecp}</article>
</body></html>`;
}

const blocks = (html: string, niif: NiifReportJson = NIIF_COMP, governanceReport?: unknown) =>
  reconcileBindingFigures(html, { niifReport: niif, governanceReport }).filter((f) => f.severity === 'block');

describe('reconcileBindingFigures — periodo y columna (pipeline-flujo-08)', () => {
  it('el HTML fiel al JSON comparativo no tiene bloqueantes', () => {
    expect(blocks(statements())).toEqual([]);
  });

  it('columnas 2025/2024 intercambiadas bloquean', () => {
    const b = blocks(statements({ swap: true }));
    expect(b.some((f) => f.rule.includes('columna'))).toBe(true);
  });

  it('una proyección rotulada con un año posterior y un resumen abreviado no bloquean', () => {
    const extra =
      `<article><h2>Proyección al 31 de diciembre de 2026</h2>` +
      tbl(['Concepto', '2025', '2026'], [['TOTAL ACTIVO', '$1.000 M', '$1.100 M']]) +
      `</article>`;
    expect(blocks(statements().replace('</body>', `${extra}</body>`))).toEqual([]);
  });

  it('rótulos y fecha de corte de 2024 para un fiscalPeriod 2025 bloquean', () => {
    const b = blocks(statements({ year: '2024', prev: '2023' }));
    expect(b.some((f) => f.rule.includes('fecha de corte'))).toBe(true);
    expect(b.some((f) => f.rule.includes('encabezados de columna'))).toBe(true);
  });
});

describe('reconcileBindingFigures — signo (pipeline-flujo-09)', () => {
  const perdida = JSON.parse(JSON.stringify(NIIF_COMP)) as NiifReportJson;
  perdida.incomeStatement.netIncomePrimary = C(-200_000_000);

  it('una pérdida neta presentada como utilidad en el resumen bloquea', () => {
    const html = statements({
      netIncome: '($200.000.000,00)',
      summary: 'El ejercicio 2025 cerró con una utilidad neta de $200.000.000,00, un resultado favorable.',
    });
    expect(blocks(html, perdida).some((f) => f.rule.includes('signo invertido'))).toBe(true);
  });

  it('la pérdida presentada entre paréntesis y descrita como pérdida no bloquea por signo', () => {
    const html = statements({
      netIncome: '($200.000.000,00)',
      summary: 'El ejercicio 2025 cerró con una pérdida neta de $200.000.000,00.',
    });
    expect(blocks(html, perdida).filter((f) => f.rule.includes('signo'))).toEqual([]);
  });
});

describe('reconcileBindingFigures — cifras del acta (pipeline-flujo-09)', () => {
  const governanceReport = {
    shareholderMinutes: {
      resultDistribution: {
        netIncomeCop: C(200_000_000),
        applies: true,
        lines: [{ label: 'Reserva legal', amountCop: C(20_000_000) }],
      },
      capitalizationProposal: { applies: false, retainedEarningsBaseCop: '0', capitalizationAmountCop: '0' },
    },
  };

  it('un desliz ×100 en la tabla del acta bloquea', () => {
    const acta = tbl(['Concepto', 'Monto'], [['Reserva legal', '$2.000.000.000,00']]);
    const html = statements().replace('</body>', `<article><h2>Acta de asamblea</h2>${acta}</article></body>`);
    const b = blocks(html, NIIF_COMP, governanceReport);
    expect(b.some((f) => f.rule.includes('acta') && f.detail.includes('multiplicada por 100'))).toBe(true);
  });

  it('el acta con la cifra correcta no bloquea', () => {
    const acta = tbl(['Concepto', 'Monto'], [['Reserva legal', '$20.000.000,00']]);
    const html = statements().replace('</body>', `<article><h2>Acta de asamblea</h2>${acta}</article></body>`);
    expect(blocks(html, NIIF_COMP, governanceReport)).toEqual([]);
  });
});
