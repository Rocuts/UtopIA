// ---------------------------------------------------------------------------
// /api/financial-report/export — una sola fuente por informe
// ---------------------------------------------------------------------------
// pipeline-flujo-07: los estados salían de `report.niifAnalysis.json` (balance
//   ajustado por el Doctor de Datos en /niif) y el KPI grid, cascada, diales,
//   anexo y pestañas deterministas del Excel de `preprocessTrialBalance(rawData)`
//   — el CSV ORIGINAL, sin ajustes y sin cruce entre ambas fuentes.
// pipeline-flujo-06: el modo 1 pasaba `enhancedData` como rawData SIN
//   `options.preprocessed`: el orquestador re-parseaba "# INFORME DE
//   VALIDACION…" → 0 filas → sin anclas ni gate 422.
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
import { orchestrateFinancialReport, BalanceValidationError } from '@/lib/agents/financial/orchestrator';
import { makeExportableReport as makeNiifOnlyReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import { withCoherentParts } from '@/lib/reports/__tests__/coherent-parts';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import { toJsonSafe } from '@/lib/preprocessing/json-safe';
import { applyAdjustments } from '@/lib/agents/repair/adjustments';

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

/** El mismo balance ANTES del ajuste del Doctor de Datos (sueldos +$500). */
const CSV_SIN_AJUSTE = CSV_COHERENTE.replace('510505,Sueldos,Auxiliar,1,2000', '510505,Sueldos,Auxiliar,1,2500');
const LEDGER = {
  adjustments: [
    {
      id: 'adj-1', accountCode: '510505', accountName: 'Sueldos', amount: -500,
      rationale: 'Causación duplicada confirmada', status: 'applied' as const,
      proposedAt: '2026-09-01T00:00:00Z', appliedAt: '2026-09-01T00:00:00Z',
    },
  ],
};

/** /upload antepone el informe de validación al texto del balance. */
const withValidationPrefix = (csv: string) => {
  const pp = preprocessTrialBalance(parseTrialBalanceCSV(csv));
  return `${pp.validationReport}\n\n---\n\nDATOS ORIGINALES:\n${csv}`;
};

const request = (body: unknown) =>
  new Request('http://localhost/api/financial-report/export', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(renderEditorialReportToStream).mockImplementation(async () => Readable.from(['%PDF-test']));
});

describe('export — el JSON y las superficies deterministas salen del mismo balance', () => {
  for (const format of ['excel', 'pdf-elite']) {
    it(`${format}: informe con Activo $10.000 + rawData con otro balance → 422 (fuentes incoherentes)`, async () => {
      const otro = CSV_COHERENTE.replace('130505,Clientes,Auxiliar,1,8300', '130505,Clientes,Auxiliar,1,99999')
        .replace('311505,Capital,Auxiliar,1,3000', '311505,Capital,Auxiliar,1,94699');
      const res = await POST(request({ report: makeExportableReport(), rawData: otro, format }));
      expect(res.status).toBe(422);
      const body = (await res.json()) as { details: string[] };
      expect(body.details.join(' ')).toMatch(/Fuentes incoherentes/);
      expect(generateFinancialExcel).not.toHaveBeenCalled();
      expect(renderEditorialReportToStream).not.toHaveBeenCalled();
    });

    it(`${format}: Doctor de Datos — sin el ledger el CSV original no casa con el informe ajustado (422)`, async () => {
      const res = await POST(request({ report: makeExportableReport(), rawData: CSV_SIN_AJUSTE, format }));
      expect(res.status).toBe(422);
    });

    it(`${format}: Doctor de Datos — con el mismo ledger las superficies usan el balance ajustado`, async () => {
      const res = await POST(
        request({ report: makeExportableReport(), rawData: CSV_SIN_AJUSTE, adjustmentLedger: LEDGER, format }),
      );
      expect(res.status).toBe(200);
      const pp =
        format === 'excel'
          ? vi.mocked(generateFinancialExcel).mock.calls[0][0].preprocessed
          : vi.mocked(composeEditorialReport).mock.calls[0][0].preprocessed;
      expect(pp?.primary.controlTotals.utilidadNeta).toBe(2000);
    });

    // niif-preproceso-33: antes el preprocesado del cliente se usaba tal cual
    // (sin ledger ni cruce); ahora el servidor re-deriva el balance de la
    // petición con el MISMO ledger y exige que coincida. La UI envía ambos.
    it(`${format}: acepta el preprocesado que usó /niif (ya ajustado) con el mismo ledger`, async () => {
      const original = preprocessTrialBalance(parseTrialBalanceCSV(CSV_SIN_AJUSTE));
      const ajustado = applyAdjustments(original, LEDGER.adjustments).balance;
      const res = await POST(
        request({
          report: makeExportableReport(),
          preprocessed: toJsonSafe(ajustado),
          adjustmentLedger: LEDGER,
          rawData: CSV_SIN_AJUSTE,
          format,
        }),
      );
      expect(res.status).toBe(200);
    });

    it(`${format}: niif-preproceso-33 — preprocesado ajustado sin su ledger no casa con el rawData re-derivado (422)`, async () => {
      const original = preprocessTrialBalance(parseTrialBalanceCSV(CSV_SIN_AJUSTE));
      const ajustado = applyAdjustments(original, LEDGER.adjustments).balance;
      const res = await POST(
        request({ report: makeExportableReport(), preprocessed: toJsonSafe(ajustado), rawData: CSV_SIN_AJUSTE, format }),
      );
      expect(res.status).toBe(422);
      expect(((await res.json()) as { details: string[] }).details.join(' ')).toMatch(/Fuentes incoherentes/);
    });

    it(`${format}: niif-preproceso-33 — totales de control alterados en el preprocesado + rawData → 422`, async () => {
      const pp = toJsonSafe(preprocessTrialBalance(parseTrialBalanceCSV(CSV_COHERENTE)));
      (pp.primary.controlTotals.cents as unknown as Record<string, string>).activo = '99999900';
      const res = await POST(request({ report: makeExportableReport(), preprocessed: pp, rawData: CSV_COHERENTE, format }));
      expect(res.status).toBe(422);
      const body = (await res.json()) as { details: string[] };
      expect(body.details.join(' ')).toMatch(/activo: enviado 99999900, recalculado 1000000/);
      expect(generateFinancialExcel).not.toHaveBeenCalled();
      expect(renderEditorialReportToStream).not.toHaveBeenCalled();
    });

    it(`${format}: niif-preproceso-33 — sin rawData, totales alterados frente a sus propias filas → 422`, async () => {
      const pp = toJsonSafe(preprocessTrialBalance(parseTrialBalanceCSV(CSV_COHERENTE)));
      (pp.primary.controlTotals.cents as unknown as Record<string, string>).utilidadNeta = '1';
      const res = await POST(request({ report: makeExportableReport(), preprocessed: pp, format }));
      expect(res.status).toBe(422);
      expect(((await res.json()) as { details: string[] }).details.join(' ')).toMatch(/sus propias filas/);
    });

    it(`${format}: niif-preproceso-33 — sin rawData, preprocesado íntegro → se exporta el re-derivado desde sus filas`, async () => {
      const pp = toJsonSafe(preprocessTrialBalance(parseTrialBalanceCSV(CSV_COHERENTE)));
      // Una cuenta alterada sin tocar los totales no llega a las superficies.
      const caja = pp.primary.classes.find((c) => c.code === 1)!.accounts.find((a) => a.code === '110505')!;
      caja.balance = 123456;
      const res = await POST(request({ report: makeExportableReport(), preprocessed: pp, format }));
      expect(res.status).toBe(200);
      const used =
        format === 'excel'
          ? vi.mocked(generateFinancialExcel).mock.calls[0][0].preprocessed
          : vi.mocked(composeEditorialReport).mock.calls[0][0].preprocessed;
      const usedCaja = (used as ReturnType<typeof preprocessTrialBalance>).primary.classes
        .find((c) => c.code === 1)!
        .accounts.find((a) => a.code === '110505')!;
      expect(usedCaja.balance).toBe(1700);
    });

    it(`${format}: rawData con el informe de validación antepuesto se recorta antes de parsear`, async () => {
      const res = await POST(
        request({ report: makeExportableReport(), rawData: withValidationPrefix(CSV_COHERENTE), format }),
      );
      expect(res.status).toBe(200);
      const pp =
        format === 'excel'
          ? vi.mocked(generateFinancialExcel).mock.calls[0][0].preprocessed
          : vi.mocked(composeEditorialReport).mock.calls[0][0].preprocessed;
      expect(pp?.primary.controlTotals.activo).toBe(10000);
    });

    it(`${format}: Parte II sellada por el Director de Estrategia → 422`, async () => {
      const report = makeExportableReport();
      Object.assign(report.strategicAnalysis, {
        strategyQualifications: { clean: false, motivos: ['Dashboard — Total Activo'], noVerificables: [] },
      });
      const res = await POST(request({ report, format }));
      expect(res.status).toBe(422);
    });
  }

  it('preprocesado malformado → 400', async () => {
    const res = await POST(request({ report: makeExportableReport(), preprocessed: { periods: [] }, format: 'excel' }));
    expect(res.status).toBe(400);
  });
});

describe('export modo 1 (Excel full pipeline) — mismo preprocesado y gate 422', () => {
  const company = { name: 'Empresa Prueba SAS', nit: '900123456', fiscalPeriod: '2025' };

  it('el orquestador recibe el preprocesado (no re-parsea el informe de validación)', async () => {
    vi.mocked(orchestrateFinancialReport).mockResolvedValue(makeExportableReport());
    const res = await POST(request({ rawData: CSV_COHERENTE, company, language: 'es', format: 'excel' }));
    expect(res.status).toBe(200);
    const [, options] = vi.mocked(orchestrateFinancialReport).mock.calls[0];
    const pp = options?.preprocessed as ReturnType<typeof preprocessTrialBalance> | undefined;
    expect(pp?.primary.controlTotals.activo).toBe(10000);
    expect(vi.mocked(generateFinancialExcel).mock.calls[0][0].preprocessed).toBe(pp);
  });

  it('balance descuadrado → 422 con las razones del gate, no 500', async () => {
    vi.mocked(orchestrateFinancialReport).mockRejectedValue(
      new BalanceValidationError(['Activo ≠ Pasivo + Patrimonio'], ['1105']),
    );
    const res = await POST(request({ rawData: CSV_COHERENTE, company, language: 'es', format: 'excel' }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; reasons: string[] };
    expect(body.code).toBe('BALANCE_VALIDATION_FAILED');
    expect(body.reasons).toContain('Activo ≠ Pasivo + Patrimonio');
  });
});
