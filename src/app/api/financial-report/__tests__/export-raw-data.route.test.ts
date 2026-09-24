// ---------------------------------------------------------------------------
// /api/financial-report/export — lectura del rawData con el helper compartido
// ---------------------------------------------------------------------------
// ingesta-01 / pipeline-flujo-06/07: /export parseaba `rawData` con
//   `parseTrialBalanceCSV` y omitía los bloques `[period=…]` que la UI envía
//   para un XLSX: el PDF/Excel se componía sin preprocesado y el gate no
//   cruzaba el informe contra el balance.
// pipeline-flujo-13: un `rawData` que llega pero no se puede preprocesar
//   (hojas en conflicto, balance tabular sin filas legibles) es 422, no una
//   exportación sin procedencia.
// pipeline-flujo-14: un informe INCOMPLETO (Partes II/III vacías) no se
//   exporta aunque sus cifras NIIF cuadren.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';

vi.mock('@/lib/auth/require-session', () => ({ requireAuthSession: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/export/excel-export', () => ({ generateFinancialExcel: vi.fn(async () => Buffer.from('xlsx')) }));
vi.mock('@/lib/export/pdf-elite-react', () => ({
  composeEditorialReport: vi.fn(() => ({})),
  renderEditorialReportToStream: vi.fn(),
}));
vi.mock('@/lib/agents/financial/orchestrator', async (orig) => {
  const actual = await orig<typeof import('@/lib/agents/financial/orchestrator')>();
  return { ...actual, orchestrateFinancialReport: vi.fn() };
});

import { POST } from '../export/route';
import { generateFinancialExcel } from '@/lib/export/excel-export';
import { composeEditorialReport, renderEditorialReportToStream } from '@/lib/export/pdf-elite-react';
import { orchestrateFinancialReport } from '@/lib/agents/financial/orchestrator';
import { makeExportableReport as makeNiifOnlyReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import { withCoherentParts } from '@/lib/reports/__tests__/coherent-parts';
import {
  parseTrialBalanceCSV,
  preprocessTrialBalance,
  type PreprocessedBalance,
} from '@/lib/preprocessing/trial-balance';

/** Balance cuyas anclas coinciden con `makeCoherentNiifReport` (Activo $10.000). */
const CSV_COHERENTE = [
  'codigo,nombre,nivel,transaccional,saldo 2025',
  '110505,Caja,Auxiliar,1,1700',
  '130505,Clientes,Auxiliar,1,8300',
  '220505,Proveedores,Auxiliar,1,4000',
  '311505,Capital,Auxiliar,1,3000',
  '330505,Reserva legal,Auxiliar,1,500',
  '370505,Utilidades acumuladas,Auxiliar,1,500',
  '360505,Utilidad del ejercicio,Auxiliar,1,2000',
  '410505,Ventas,Auxiliar,1,7000',
  '510505,Sueldos,Auxiliar,1,2000',
  '530505,Intereses,Auxiliar,1,1000',
  '613505,CMV,Auxiliar,1,2000',
].join('\n');

/**
 * Informe coherente con `CSV_COHERENTE`, con Partes II y III estructuradas
 * (I3: el servidor re-renderiza su Markdown desde el JSON y sella la Parte sin
 * JSON válido).
 */
const makeExportableReport = () =>
  withCoherentParts(makeNiifOnlyReport(), preprocessTrialBalance(parseTrialBalanceCSV(CSV_COHERENTE)));

/** Lo que /upload envía como rawData para un XLSX de una hoja. */
const XLSX_BLOCKS = `[period=Balance 2025]\n${CSV_COHERENTE.replace('saldo 2025', 'saldo')}\n[/period]`;

/** Dos hojas del mismo año con cifras distintas para la misma cuenta. */
const XLSX_CONFLICT = [
  `[period=Balance 2025]\n${CSV_COHERENTE.replace('saldo 2025', 'saldo')}\n[/period]`,
  `[period=Cierre 2025]\n${CSV_COHERENTE.replace('saldo 2025', 'saldo').replace('110505,Caja,Auxiliar,1,1700', '110505,Caja,Auxiliar,1,9999')}\n[/period]`,
].join('\n');

/** Balance tabular (códigos PUC) cuyo encabezado no se reconoce → 0 filas. */
const TABULAR_UNREADABLE = [
  'Reporte generado por el ERP;;;',
  ...Array.from({ length: 12 }, (_, i) => `1105${String(i + 10).padStart(2, '0')};Caja ${i};x;1000`),
].join('\n');

const request = (body: unknown) =>
  new Request('http://localhost/api/financial-report/export', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

const usedPreprocessed = (format: string): PreprocessedBalance | null | undefined =>
  format === 'excel'
    ? vi.mocked(generateFinancialExcel).mock.calls[0]?.[0].preprocessed
    : vi.mocked(composeEditorialReport).mock.calls[0]?.[0].preprocessed;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(renderEditorialReportToStream).mockImplementation(async () => Readable.from(['%PDF-test']));
});

describe('export con informe — rawData leído con parseUploadedTrialBalanceText', () => {
  for (const format of ['excel', 'pdf-elite']) {
    it(`${format}: bloques XLSX [period=…] producen el preprocesado de las superficies`, async () => {
      const res = await POST(request({ report: makeExportableReport(), rawData: XLSX_BLOCKS, format }));
      expect(res.status).toBe(200);
      expect(usedPreprocessed(format)?.primary.controlTotals.activo).toBe(10000);
    });

    it(`${format}: bloques XLSX de OTRO balance → 422 por fuentes incoherentes`, async () => {
      const otro = XLSX_BLOCKS.replace('130505,Clientes,Auxiliar,1,8300', '130505,Clientes,Auxiliar,1,99999')
        .replace('311505,Capital,Auxiliar,1,3000', '311505,Capital,Auxiliar,1,94699');
      const res = await POST(request({ report: makeExportableReport(), rawData: otro, format }));
      expect(res.status).toBe(422);
      const body = (await res.json()) as { details: string[] };
      expect(body.details.join(' ')).toMatch(/Fuentes incoherentes/);
      expect(generateFinancialExcel).not.toHaveBeenCalled();
      expect(renderEditorialReportToStream).not.toHaveBeenCalled();
    });

    it(`${format}: hojas en conflicto → 422 con el motivo de ingesta`, async () => {
      const res = await POST(request({ report: makeExportableReport(), rawData: XLSX_CONFLICT, format }));
      expect(res.status).toBe(422);
      const body = (await res.json()) as { reasons?: string[]; details?: string[] };
      expect([...(body.reasons ?? []), ...(body.details ?? [])].join(' ')).toMatch(/saldos distintos a la cuenta 110505/);
      expect(generateFinancialExcel).not.toHaveBeenCalled();
      expect(renderEditorialReportToStream).not.toHaveBeenCalled();
    });

    it(`${format}: balance tabular sin filas legibles → 422 (sin procedencia no se exporta)`, async () => {
      const res = await POST(request({ report: makeExportableReport(), rawData: TABULAR_UNREADABLE, format }));
      expect(res.status).toBe(422);
      expect(generateFinancialExcel).not.toHaveBeenCalled();
      expect(renderEditorialReportToStream).not.toHaveBeenCalled();
    });

    it(`${format}: informe con la Parte II o III vacía → 422 (INCOMPLETO)`, async () => {
      for (const part of ['strategicAnalysis', 'governance'] as const) {
        vi.clearAllMocks();
        // Vacía = sin texto y sin JSON (con JSON el servidor re-renderiza el
        // texto desde él, I3).
        const report = makeExportableReport();
        report[part].fullContent = '   ';
        delete report[part].json;
        const res = await POST(request({ report, format }));
        expect(res.status).toBe(422);
        const body = (await res.json()) as { details: string[] };
        expect(body.details.join(' ')).toMatch(/INCOMPLETO/);
      }
    });
  }
});

describe('export sin informe (pipeline completo) — mismo helper', () => {
  const company = { name: 'Empresa Prueba SAS', nit: '900123456', fiscalPeriod: '2025' };

  it('excel: bloques XLSX → el orquestador recibe el preprocesado', async () => {
    vi.mocked(orchestrateFinancialReport).mockResolvedValue(makeExportableReport());
    const res = await POST(request({ rawData: XLSX_BLOCKS, company, language: 'es', format: 'excel' }));
    expect(res.status).toBe(200);
    const [, options] = vi.mocked(orchestrateFinancialReport).mock.calls[0];
    const pp = options?.preprocessed as PreprocessedBalance | undefined;
    expect(pp?.primary.controlTotals.activo).toBe(10000);
    expect(vi.mocked(generateFinancialExcel).mock.calls[0][0].preprocessed).toBe(pp);
  });

  it('excel: hojas en conflicto → 422 BALANCE_VALIDATION_FAILED sin correr agentes', async () => {
    const res = await POST(request({ rawData: XLSX_CONFLICT, company, language: 'es', format: 'excel' }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; reasons: string[] };
    expect(body.code).toBe('BALANCE_VALIDATION_FAILED');
    expect(body.reasons.join(' ')).toMatch(/110505/);
    expect(orchestrateFinancialReport).not.toHaveBeenCalled();
  });

  it('pdf-elite: hojas en conflicto → PDF BLOQUEADO con los motivos, sin correr agentes', async () => {
    const res = await POST(request({ rawData: XLSX_CONFLICT, company, language: 'es', format: 'pdf-elite' }));
    expect(res.status).toBe(200);
    expect(orchestrateFinancialReport).not.toHaveBeenCalled();
    const args = vi.mocked(composeEditorialReport).mock.calls[0][0];
    expect(args.emittable?.ok).toBe(false);
    expect((args.emittable as { blockers: string[] }).blockers.join(' ')).toMatch(/110505/);
  });
});
