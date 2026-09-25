// ---------------------------------------------------------------------------
// Grupo PUC partido por plazo: un rótulo por bloque (integración I4, 5a)
// ---------------------------------------------------------------------------
// Con una excepción de vencimiento sobre parte del grupo 12 (120505 → no
// corriente), el completado determinista del ESF presenta DOS renglones "12 —
// Inversiones", uno bajo "Total activo corriente" y otro bajo "Total activo
// no corriente". Las cifras y los subtotales eran correctos, pero el lector
// veía el mismo rótulo dos veces en el PDF, el Excel y el Markdown. Ahora cada
// renglón lleva el sufijo de su bloque.
// ---------------------------------------------------------------------------

import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import {
  aplicarVencimientosDeclarados,
  parseTrialBalanceCSVWithMeta,
  preprocessTrialBalance,
} from '@/lib/preprocessing/trial-balance';
import {
  completeBreakdownFromSnapshot,
  fillComparativeBreakdownFromSnapshot,
  reconcileAnchors,
} from '@/lib/agents/financial/agents/reconcile-anchors';
import { toNiifAnalysisResult } from '@/lib/agents/financial/agents/renderer';
import { buildReportAnchors } from '@/lib/agents/financial/contracts/anchors';
import type { NiifReportJson } from '@/lib/agents/financial/contracts/niif-report';
import { makeCoherentNiifReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import { informeExportable } from '@/lib/agents/financial/__fixtures__/perdida-comparativo-w4a';
import { generateFinancialExcel } from '../excel-export';
import { niifJsonToBalanceTable } from '../pdf-elite-react/compose-statements-from-json';
import { balanceTermOfLabel, normalizeNiifStatementLabels } from '../statement-presentation';

const CSV_DOS_CORTES = [
  'codigo,nombre,nivel,Saldo 2024,Saldo 2025',
  '110505,Caja,Auxiliar,100000,140000',
  '120505,CDT a 18 meses,Auxiliar,10000,30000',
  '120510,Acciones negociables,Auxiliar,15000,20000',
  '152405,Equipo de oficina,Auxiliar,150000,200000',
  '210505,Crédito bancario a 3 años,Auxiliar,50000,80000',
  '220505,Proveedores,Auxiliar,25000,70000',
  '310505,Capital,Auxiliar,200000,200000',
  '413505,Ventas,Auxiliar,0,100000',
  '510506,Sueldos,Auxiliar,0,60000',
].join('\n');

/** ESF completado por el código con 120505 declarado no corriente. */
function esfPartido(): NiifReportJson {
  const { rows } = aplicarVencimientosDeclarados(parseTrialBalanceCSVWithMeta(CSV_DOS_CORTES).rows, {
    '120505': 'no_corriente',
  });
  const pp = preprocessTrialBalance(rows);
  const a = buildReportAnchors(pp.primary, pp.comparative ?? undefined);
  const json = makeCoherentNiifReport();
  json.company.comparativePeriod = '2024';
  json.balanceSheet.assets = [];
  json.balanceSheet.liabilities = [];
  json.balanceSheet.equity = [];
  json.balanceSheet.totalAssetsPrimary = String(a.primary!.cents.activo);
  json.balanceSheet.totalLiabilitiesPrimary = String(a.primary!.cents.pasivo);
  json.balanceSheet.totalEquityPrimary = String(a.primary!.cents.patrimonio);
  json.balanceSheet.totalAssetsComparative = String(a.comparative!.cents.activo);
  json.balanceSheet.totalLiabilitiesComparative = String(a.comparative!.cents.pasivo);
  json.balanceSheet.totalEquityComparative = String(a.comparative!.cents.patrimonio);
  const gaps = reconcileAnchors(json, { primary: null, comparative: null }).lineGaps;
  const { json: done } = completeBreakdownFromSnapshot(json, gaps, pp.primary);
  return fillComparativeBreakdownFromSnapshot(done, pp.comparative ?? undefined).json;
}

describe('balanceTermOfLabel', () => {
  it('reconoce subtotales y encabezados de plazo en español e inglés', () => {
    expect(balanceTermOfLabel('assets', 'Total activo corriente')).toEqual({ term: 'current', header: false });
    expect(balanceTermOfLabel('assets', 'TOTAL ACTIVOS NO CORRIENTES')).toEqual({ term: 'nonCurrent', header: false });
    expect(balanceTermOfLabel('assets', 'Activo corriente')).toEqual({ term: 'current', header: true });
    expect(balanceTermOfLabel('liabilities', 'Total non-current liabilities')).toEqual({ term: 'nonCurrent', header: false });
    expect(balanceTermOfLabel('liabilities', 'Total current liabilities (Note 4)')).toEqual({ term: 'current', header: false });
    expect(balanceTermOfLabel('assets', 'Total pasivo corriente')).toBeNull();
    expect(balanceTermOfLabel('assets', 'Total activos')).toBeNull();
  });
});

describe('grupo partido por plazo — un rótulo por bloque', () => {
  it('normalizeNiifStatementLabels añade el sufijo del bloque a los dos renglones del grupo 12 y es idempotente', () => {
    const json = esfPartido();
    expect(json.balanceSheet.assets.filter((l) => l.account === '12').map((l) => l.label)).toEqual([
      'Inversiones',
      'Inversiones',
    ]);
    const { json: out } = normalizeNiifStatementLabels(json);
    expect(out.balanceSheet.assets.map((l) => [l.account, l.label])).toEqual([
      ['11', 'Efectivo y equivalentes de efectivo'],
      ['12', 'Inversiones — porción corriente'],
      [null, 'Total activo corriente'],
      ['12', 'Inversiones — porción no corriente'],
      ['15', 'Propiedades, planta y equipo'],
      [null, 'Total activo no corriente'],
    ]);
    // Cifras intactas.
    expect(out.balanceSheet.assets.map((l) => [l.amountPrimary, l.amountComparative])).toEqual(
      json.balanceSheet.assets.map((l) => [l.amountPrimary, l.amountComparative]),
    );
    expect(normalizeNiifStatementLabels(out).changed).toBe(0);
    // Sin grupo partido el ESF no cambia.
    const coherente = normalizeNiifStatementLabels(makeCoherentNiifReport()).json;
    expect(normalizeNiifStatementLabels(coherente).changed).toBe(0);
  });

  it('los rótulos del ESF se normalizan aunque ningún otro rótulo del informe cambie', () => {
    // Antes el ESF sólo se reescribía si algún rótulo del ERI, del EFE o del
    // ECP cambiaba: sobre un JSON ya normalizado, un rótulo del ESF fuera de
    // catálogo (o un grupo partido sin sufijo) quedaba tal cual.
    const out = normalizeNiifStatementLabels(esfPartido()).json;
    const sinSufijo = {
      ...out,
      balanceSheet: {
        ...out.balanceSheet,
        assets: out.balanceSheet.assets.map((l) =>
          l.account === '12' ? { ...l, label: 'Inversiones' } : l.account === '15' ? { ...l, label: 'Cuentas varias' } : l,
        ),
      },
    };
    const again = normalizeNiifStatementLabels(sinSufijo);
    expect(again.changed).toBe(3);
    expect(again.json.balanceSheet.assets).toEqual(out.balanceSheet.assets);
  });

  it('rótulos distintos dentro del grupo (ya distinguidos) no se tocan', () => {
    const json = esfPartido();
    const idx = json.balanceSheet.assets.findIndex((l) => l.account === '12');
    json.balanceSheet.assets[idx] = { ...json.balanceSheet.assets[idx], label: 'Inversiones temporales' };
    const { json: out } = normalizeNiifStatementLabels(json);
    expect(out.balanceSheet.assets.filter((l) => l.account === '12').map((l) => l.label)).toEqual([
      'Inversiones temporales',
      'Inversiones',
    ]);
  });

  it('revisión I4: el sufijo sólo se quita de los renglones de grupo; un rótulo propio de cuenta lo conserva', () => {
    // El sufijo sólo lo añade la desambiguación a renglones de grupo de dos
    // dígitos; quitarlo de cualquier renglón borraba el rótulo que el modelo
    // escribió para una cuenta de detalle ("CDT a 18 meses — porción no
    // corriente" pasaba a "CDT a 18 meses").
    const json = esfPartido();
    const rotulo = 'CDT a 18 meses — porción no corriente';
    json.balanceSheet.assets.push({ ...json.balanceSheet.assets[0], account: '120505', label: rotulo });
    const { json: out } = normalizeNiifStatementLabels(json);
    expect(out.balanceSheet.assets.find((l) => l.account === '120505')?.label).toBe(rotulo);
  });

  it('Markdown, PDF y Excel imprimen el rótulo de cada porción', async () => {
    const json = esfPartido();
    const md = toNiifAnalysisResult(json).balanceSheet;
    expect(md).toContain('12 — Inversiones — porción corriente');
    expect(md).toContain('12 — Inversiones — porción no corriente');

    const pdf = niifJsonToBalanceTable(json).rows.map((r) => r.account);
    expect(pdf.filter((a) => /Inversiones — porción/.test(a))).toHaveLength(2);

    const buf = await generateFinancialExcel({ report: informeExportable(json) });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const cells: string[] = [];
    wb.getWorksheet('Balance NIIF')!.eachRow((row) => {
      for (const v of (row.values as unknown[]).slice(1)) if (typeof v === 'string') cells.push(v);
    });
    expect(cells.filter((c) => /Inversiones — porción corriente/.test(c))).toHaveLength(1);
    expect(cells.filter((c) => /Inversiones — porción no corriente/.test(c))).toHaveLength(1);
  });
});
