// ---------------------------------------------------------------------------
// I5-4 — /export SIN referencia recalcula todo el gate de emisión y los
// anexos deterministas del informe
// ---------------------------------------------------------------------------
// Desde I3, /export sin referencia reconstruye el consolidado con el gate de
// /consolidate pero sólo plegaba sobre la emitibilidad recibida los
// bloqueantes de TEXTO (V8/V9/V10/V15). Los que dependen del balance (V1–V4,
// V7, V11–V14) y de la identidad del archivo (V5/V6) se tomaban del cuerpo:
// un informe honesto sobre un balance con libros no cerrados (V12) o un NIT
// con DV inválido (V6) se exportaba con una emitibilidad "emittable" declarada
// por el cliente. Ahora se pliegan todos los del gate recalculado sobre el
// balance re-derivado (sólo endurecen); V5/V6 sólo cuando la petición trae el
// `rawData` del que salen. `fiscalSnapshot` y `ancora` se recalculan como en
// /consolidate: los del cuerpo no viajan al artefacto.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';

vi.mock('@/lib/auth/require-session', () => ({ requireAuthSession: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/export/excel-export', () => ({ generateFinancialExcel: vi.fn(async () => Buffer.from('xlsx')) }));
vi.mock('@/lib/export/pdf-elite-react', () => ({
  composeEditorialReport: vi.fn(() => ({ appendix: { validationWarnings: [] } })),
  renderEditorialReportToStream: vi.fn(),
}));

import { POST } from '../export/route';
import { generateFinancialExcel } from '@/lib/export/excel-export';
import { composeEditorialReport, renderEditorialReportToStream } from '@/lib/export/pdf-elite-react';
import {
  CSV_PERDIDA_COMPARATIVO,
  informeExportable,
  informeHonesto,
} from '@/lib/agents/financial/__fixtures__/perdida-comparativo-w4a';
import { deriveReportSidecars } from '@/lib/agents/financial/orchestrator';
import { ancoraOrNull } from '@/lib/agents/financial/ancora/build-ancora';
import { preprocessUploadedTrialBalanceText } from '@/lib/preprocessing/raw-data';
import { toJsonSafe } from '@/lib/preprocessing/json-safe';
import type { CompanyInfo, FinancialReport } from '@/lib/agents/financial/types';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import { withCoherentParts } from '@/lib/reports/__tests__/coherent-parts';

const COMPANY: CompanyInfo = { name: 'Demo Perdidas SAS', nit: '900123456-8', fiscalPeriod: '2025', entityType: 'SAS', niifGroup: 2 };

/** Libros no cerrados: sin la cuenta 36 del resultado del ejercicio (V12). */
const CSV_V12 = CSV_PERDIDA_COMPARATIVO.split('\n').filter((l) => !l.startsWith('360505')).join('\n');
/** NIT del encabezado del archivo con DV inválido (V6). */
const CSV_V6 = CSV_PERDIDA_COMPARATIVO.replace('NIT: 900.123.456-8', 'NIT: 900.123.456-1');

function read(csv: string): PreprocessedBalance {
  const r = preprocessUploadedTrialBalanceText(csv);
  if (r.kind !== 'ok') throw new Error('fixture ilegible');
  return r.preprocessed;
}

/** Informe honesto sobre `pp`, con la emitibilidad "limpia" que declara el cliente. */
function clientReport(pp: PreprocessedBalance): FinancialReport {
  const r = withCoherentParts({ ...informeExportable(informeHonesto(pp)), company: COMPANY }, pp);
  return {
    ...r,
    validation: { ok: true, errors: [], warnings: [] } as unknown as FinancialReport['validation'],
    emittability: { kind: 'emittable', blockers: [], suggestedAdjustments: [] },
  };
}

const request = (body: unknown) =>
  new Request('http://localhost/api/financial-report/export', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

const exported = (format: string): FinancialReport =>
  format === 'excel'
    ? vi.mocked(generateFinancialExcel).mock.calls[0][0].report
    : vi.mocked(composeEditorialReport).mock.calls[0][0].report;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(renderEditorialReportToStream).mockImplementation(async () => Readable.from(['%PDF-test']));
});

describe('I5-4 — bloqueantes del balance recalculados sin referencia', () => {
  for (const format of ['excel', 'pdf-elite'] as const) {
    it(`${format}: balance honesto → 200 (con rawData y sólo con el preprocesado)`, async () => {
      const pp = read(CSV_PERDIDA_COMPARATIVO);
      const withRaw = await POST(request({ report: clientReport(pp), rawData: CSV_PERDIDA_COMPARATIVO, format, language: 'es' }));
      expect(withRaw.status).toBe(200);
      vi.clearAllMocks();
      vi.mocked(renderEditorialReportToStream).mockImplementation(async () => Readable.from(['%PDF-test']));
      const ppOnly = await POST(request({ report: clientReport(pp), preprocessed: toJsonSafe(pp), format, language: 'es' }));
      // Sin rawData V5/V6 no se evalúan: no hay falso bloqueo por identidad del archivo.
      expect(ppOnly.status).toBe(200);
    });

    it(`${format}: libros no cerrados (V12) con emitibilidad "emittable" declarada → 422`, async () => {
      const pp = read(CSV_V12);
      for (const body of [
        { report: clientReport(pp), rawData: CSV_V12, format, language: 'es' },
        { report: clientReport(pp), preprocessed: toJsonSafe(pp), format, language: 'es' },
      ]) {
        const res = await POST(request(body));
        expect(res.status).toBe(422);
      }
      expect(generateFinancialExcel).not.toHaveBeenCalled();
      expect(renderEditorialReportToStream).not.toHaveBeenCalled();
    });

    it(`${format}: NIT del archivo con DV inválido (V6) → 422 cuando llega el rawData`, async () => {
      const pp = read(CSV_V6);
      const res = await POST(request({ report: clientReport(pp), rawData: CSV_V6, format, language: 'es' }));
      expect(res.status).toBe(422);
    });
  }
});

describe('I5-4 — fiscalSnapshot y Âncora los recalcula el servidor', () => {
  it('los del cuerpo no llegan al artefacto; van los de deriveReportSidecars sobre el balance re-derivado', async () => {
    const pp = read(CSV_PERDIDA_COMPARATIVO);
    const forged = {
      ...clientReport(pp),
      fiscalSnapshot: { forged: 'SNAPSHOT-FALSO' },
      ancora: { forged: 'ANCORA-FALSA' },
      generatedAt: '2099-01-01T00:00:00.000Z',
    } as unknown as FinancialReport;
    const res = await POST(request({ report: forged, rawData: CSV_PERDIDA_COMPARATIVO, format: 'excel', language: 'es' }));
    expect(res.status).toBe(200);
    const used = exported('excel');
    expect(JSON.stringify(used)).not.toMatch(/SNAPSHOT-FALSO|ANCORA-FALSA/);
    const expected = deriveReportSidecars({ preprocessed: pp, company: COMPANY, rawData: CSV_PERDIDA_COMPARATIVO });
    const sinHora = (a: unknown) => ({ ...(a as object), computedAt: null });
    expect(sinHora(used.ancora)).toEqual(sinHora(ancoraOrNull(expected.ancora)));
    expect(used.fiscalSnapshot?.anchor).toEqual(expected.fiscalSnapshot?.anchor);
    // Una fecha futura no encabeza el consolidado.
    expect(new Date(used.generatedAt).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('sin balance re-derivado no se conservan los del cuerpo', async () => {
    const pp = read(CSV_PERDIDA_COMPARATIVO);
    const forged = { ...clientReport(pp), fiscalSnapshot: { forged: 'SNAPSHOT-FALSO' }, ancora: { forged: 'ANCORA-FALSA' } } as unknown as FinancialReport;
    // Sin rawData ni preprocesado el artefacto sale "procedencia no verificada"
    // y sin los anexos del cliente.
    const res = await POST(request({ report: forged, format: 'excel', language: 'es' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Report-Provenance')).toBe('unverified');
    const used = exported('excel');
    expect(JSON.stringify(used)).not.toMatch(/SNAPSHOT-FALSO|ANCORA-FALSA/);
    expect(used.fiscalSnapshot).toBeUndefined();
    expect(used.ancora).toBeUndefined();
  });
});
