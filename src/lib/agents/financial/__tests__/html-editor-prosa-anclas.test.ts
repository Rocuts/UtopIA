// ---------------------------------------------------------------------------
// Gate del HTML: conceptos anclados citados en prosa o abreviados (R6)
// ---------------------------------------------------------------------------
// e2e-niif-11 (re-auditoría 2026-09): R1 sólo exige que la cifra vinculante
// aparezca en ALGÚN lugar y R5 sólo lee encabezados. Salían emittable=true:
//   A19b — <p> "La pérdida neta del ejercicio fue de $4.000.000,00 (real $40M),
//          con un EBITDA positivo de $20.000.000,00 (real −$20M) y un ROE de
//          25,0 % (real −80 %). Estados financieros al 31 de diciembre de 2024."
//   A20  — tabla resumen "Utilidad neta | $4.000 M" e "Ingresos | $95.000.000,00".
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import type { NiifReportJson } from '../contracts/niif-report';
import { reconcileBindingFigures } from '../agents/html-editor-validator';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';

/** Pérdida: UN −30M → −40M; ingresos 100M → 80M; EBITDA −20M; ROE −80 %. */
const CSV = [
  'codigo,nombre,nivel,transaccional,saldo 2024,saldo 2025',
  '110505,Caja general,Auxiliar,1,30000000,5000000',
  '130505,Clientes nacionales,Auxiliar,1,20000000,15000000',
  '152410,Maquinaria,Auxiliar,1,50000000,50000000',
  '152405,Equipo de oficina,Auxiliar,1,50000000,50000000',
  '159205,Depreciacion acumulada equipo,Auxiliar,1,-10000000,-20000000',
  '210505,Bancos nacionales,Auxiliar,1,40000000,45000000',
  '220505,Proveedores nacionales,Auxiliar,1,30000000,25000000',
  '311505,Capital suscrito y pagado,Auxiliar,1,100000000,100000000',
  '360505,Perdida del ejercicio,Auxiliar,1,-30000000,-40000000',
  '370505,Perdidas acumuladas,Auxiliar,1,0,-30000000',
  '410505,Ventas,Auxiliar,1,100000000,80000000',
  '510506,Sueldos,Auxiliar,1,40000000,30000000',
  '516015,Depreciacion equipo,Auxiliar,1,0,10000000',
  '530505,Intereses bancarios,Auxiliar,1,10000000,10000000',
  '613505,Costo de ventas,Auxiliar,1,80000000,70000000',
].join('\n');

const pp = preprocessTrialBalance(parseTrialBalanceCSV(CSV));
const C = (pesos: number) => String(BigInt(pesos) * BigInt(100));

const NIIF = {
  company: { fiscalPeriod: '2025', comparativePeriod: '2024' },
  balanceSheet: {
    totalAssetsPrimary: C(100_000_000), totalAssetsComparative: C(140_000_000),
    totalLiabilitiesPrimary: C(70_000_000), totalLiabilitiesComparative: C(70_000_000),
    totalEquityPrimary: C(30_000_000), totalEquityComparative: C(70_000_000),
  },
  incomeStatement: {
    grossProfitPrimary: C(10_000_000), operatingProfitPrimary: C(-30_000_000),
    netIncomePrimary: C(-40_000_000), netIncomeComparative: C(-30_000_000),
  },
  cashFlow: { cashOpening: C(30_000_000), cashClosing: C(5_000_000), netChange: C(-25_000_000) },
  equityChanges: { rows: [{ kind: 'closing_balance', total: C(30_000_000) }] },
} as unknown as NiifReportJson;

/** HTML fiel: estados con las cifras vinculantes y prosa correcta. */
function html(extra = ''): string {
  return `<html><body>
<article><h1>2025</h1><p>El ejercicio cerró con una pérdida neta de ($40.000.000,00) y un EBITDA negativo de ($20.000.000,00); el ROE fue de -80,0 %.</p>
<p>La pérdida neta pasó de ($30.000.000,00) en 2024 a ($40.000.000,00) en 2025; los ingresos operacionales netos disminuyeron $20.000.000,00.</p>
<p>Estados financieros al 31 de diciembre de 2025 y 2024.</p>${extra}</article>
<article><h2>Estado de Situación Financiera al 31 de diciembre de 2025</h2>
<table class="ft"><thead><tr><th>Concepto</th><th>2025</th><th>2024</th></tr></thead><tbody>
<tr><td>Total activos</td><td>$100.000.000,00</td><td>$140.000.000,00</td></tr>
<tr><td>Total pasivos</td><td>$70.000.000,00</td><td>$70.000.000,00</td></tr>
<tr><td>Total pasivo y patrimonio</td><td>$100.000.000,00</td><td>$140.000.000,00</td></tr>
<tr><td>Total patrimonio</td><td>$30.000.000,00</td><td>$70.000.000,00</td></tr>
</tbody></table></article>
<article><h2>Estado de Resultados 2025</h2>
<table class="ft"><thead><tr><th>Concepto</th><th>2025</th><th>2024</th></tr></thead><tbody>
<tr><td>Utilidad bruta</td><td>$10.000.000,00</td><td>$20.000.000,00</td></tr>
<tr><td>Resultado operacional</td><td>($30.000.000,00)</td><td>($20.000.000,00)</td></tr>
<tr><td>Pérdida neta</td><td>($40.000.000,00)</td><td>($30.000.000,00)</td></tr>
</tbody></table>
<p>Efectivo al inicio del período $30.000.000,00. Disminución neta en efectivo ($25.000.000,00). Efectivo al final del período $5.000.000,00.</p>
<p>Patrimonio al cierre $30.000.000,00.</p></article>
<article><h2>Resumen</h2>
<table class="ft"><thead><tr><th>Indicador</th><th>2025</th></tr></thead><tbody>
<tr><td>Utilidad neta</td><td>$-40 M</td></tr><tr><td>Ingresos</td><td>$80 M</td></tr>
<tr><td>ROE</td><td>-80,0%</td></tr><tr><td>ROE sectorial</td><td>&gt; 15%</td></tr>
</tbody></table></article>
</body></html>`;
}

const blocks = (h: string) =>
  reconcileBindingFigures(h, { niifReport: NIIF, preprocessed: pp }).filter((f) => f.severity === 'block');
const r6 = (h: string) => blocks(h).filter((f) => /concepto anclado|fecha de corte/.test(f.rule));

describe('R6 — conceptos anclados en prosa y abreviados (e2e-niif-11)', () => {
  it('las anclas del caso son las del hallazgo', () => {
    expect(pp.primary.controlTotals.ebitda).toBe(-20_000_000);
    expect(pp.primary.controlTotals.roe).toBeCloseTo(-80, 5);
  });

  it('un HTML fiel (prosa, comparativo, variaciones, resumen abreviado y bandas) no tiene bloqueantes R6', () => {
    expect(r6(html())).toEqual([]);
  });

  it('A19b: pérdida $4M, EBITDA "positivo", ROE 25 % y corte 2024 en un <p> bloquean', () => {
    const b = r6(html(
      '<p>La pérdida neta del ejercicio fue de $4.000.000,00, con un EBITDA positivo de $20.000.000,00 y un ROE de 25,0 %. ' +
        'Estados financieros al 31 de diciembre de 2024.</p>',
    ));
    const all = b.map((f) => f.detail).join('\n');
    expect(all).toMatch(/Utilidad neta: el HTML imprime \$4\.000\.000,00/);
    expect(all).toMatch(/EBITDA: es negativa .* presenta como positiva/);
    expect(all).toMatch(/ROE: el HTML imprime 25,0 %/);
    expect(all).toMatch(/corte al 31 de diciembre de 2024/);
  });

  it('A20: tabla resumen con "Utilidad neta | $4.000 M" e "Ingresos | $95.000.000,00" bloquea', () => {
    const b = r6(html(
      '<table class="ft"><thead><tr><th>Indicador</th><th>2025</th></tr></thead><tbody>' +
        '<tr><td>Utilidad neta</td><td>$4.000 M</td></tr><tr><td>Ingresos</td><td>$95.000.000,00</td></tr></tbody></table>',
    ));
    const all = b.map((f) => f.detail).join('\n');
    expect(all).toMatch(/Utilidad neta: el HTML imprime \$4\.000\.000\.000,00 \(abreviado\)/);
    expect(all).toMatch(/Ingresos: el HTML imprime \$95\.000\.000,00/);
  });

  it('una pérdida presentada como utilidad en prosa (misma magnitud) bloquea', () => {
    const b = r6(html('<p>La utilidad neta del ejercicio fue de $40.000.000,00.</p>'));
    expect(b.map((f) => f.detail).join(' ')).toMatch(/Utilidad neta: es negativa/);
  });

  it('EBITDA citado cuando el preprocesador lo publica N/D bloquea', () => {
    const ppNd = preprocessTrialBalance(parseTrialBalanceCSV(CSV));
    ppNd.primary.controlTotals.ebitda = null;
    const b = reconcileBindingFigures(html(), { niifReport: NIIF, preprocessed: ppNd }).filter(
      (f) => f.severity === 'block' && /concepto anclado/.test(f.rule),
    );
    expect(b.map((f) => f.detail).join(' ')).toMatch(/EBITDA: .* N\/D/);
  });

  it('sin preprocesado no se inventan anclas de EBITDA/ingresos/ROE', () => {
    const h = html('<p>Con un EBITDA de $99.000.000,00 y un ROE de 25,0 %.</p>');
    const b = reconcileBindingFigures(h, { niifReport: NIIF }).filter((f) => /concepto anclado/.test(f.rule));
    expect(b).toEqual([]);
  });
});
