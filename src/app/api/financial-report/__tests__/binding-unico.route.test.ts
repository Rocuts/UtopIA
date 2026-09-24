// ---------------------------------------------------------------------------
// NM-16 (re-auditoría 2026-09-24) — rutas legacy y /export modo pipeline
// ---------------------------------------------------------------------------
// Ambas rutas anteponían a las instrucciones un bloque "TOTALES
// PRE-CALCULADOS (VINCULANTES)" con `summary` previo al curator (Activo
// 1.150 M sin la reclasificación R1 del sobregiro) y la Σ bruta de la clase 4
// como "Total Ingresos" (2.120 M, YoY +17,13 %), mientras el bloque del
// orquestador publicaba Activo 1.180 M e ingresos netos 1.920 M (+6,08 %).
// Ahora las cifras vinculantes llegan sólo por el bloque del orquestador.
// ---------------------------------------------------------------------------
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/require-session', () => ({ requireAuthSession: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/export/excel-export', () => ({ generateFinancialExcel: vi.fn(async () => Buffer.from('xlsx')) }));
vi.mock('@/lib/agents/financial/orchestrator', async (orig) => {
  const actual = await orig<typeof import('@/lib/agents/financial/orchestrator')>();
  return { ...actual, orchestrateFinancialReport: vi.fn() };
});

import { POST as legacyPOST } from '../route';
import { POST as exportPOST } from '../export/route';
import { orchestrateFinancialReport, renderSnapshotLines } from '@/lib/agents/financial/orchestrator';
import { makeExportableReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import { CSV_NM_ANUAL } from '@/lib/pillars/__tests__/_fixture-nm';

const company = { name: 'Demo SAS', nit: '900123456', fiscalPeriod: '2025' };
const USER_INSTRUCTIONS = 'Enfatizar la liquidez.';

const request = (url: string, body: unknown) =>
  new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(orchestrateFinancialReport).mockResolvedValue(makeExportableReport());
});

function llamada() {
  const [req, opts] = vi.mocked(orchestrateFinancialReport).mock.calls[0]!;
  return { instructions: req.instructions ?? '', pp: opts?.preprocessed as PreprocessedBalance, company: req.company };
}

describe.each([
  ['legacy /api/financial-report', 'http://localhost/api/financial-report', legacyPOST],
  ['/api/financial-report/export (pipeline)', 'http://localhost/api/financial-report/export', exportPOST],
])('NM-16 — %s no publica un segundo bloque vinculante pre-curator', (_n, url, POST) => {
  it('las instrucciones llegan sin "TOTALES PRE-CALCULADOS" ni cifras del summary pre-curator', async () => {
    // (El estado HTTP depende del gate de exportación contra el informe de
    // prueba; lo que se verifica es lo que recibe el orquestador.)
    await POST(
      request(url, { rawData: CSV_NM_ANUAL, company, language: 'es', instructions: USER_INSTRUCTIONS, format: 'excel' }),
    );
    expect(orchestrateFinancialReport).toHaveBeenCalledTimes(1);
    const { instructions, pp, company: co } = llamada();
    expect(instructions).toBe(USER_INSTRUCTIONS);
    expect(instructions).not.toMatch(/TOTALES PRE-CALCULADOS|Total Ingresos \(Clase 4\)|1\.150\.000\.000|2\.120\.000\.000/);
    // Los periodos detectados siguen completándose para prompts y UI.
    expect(co.comparativePeriod).toBe('2024');
    // El ancla que sí ve el modelo es la post-curator del orquestador.
    expect(pp.primary.summary.totalAssets).toBe(1_150_000_000);
    expect(renderSnapshotLines(pp.primary).join('\n')).toContain('Total Activo: $1.180.000.000,00');
  });
});
