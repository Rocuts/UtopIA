// ---------------------------------------------------------------------------
// POST /api/financial-report (legacy) — rawData con el helper compartido
// ---------------------------------------------------------------------------
// ingesta-01 / pipeline-flujo-06: la ruta legacy parseaba `rawData` con
//   `parseTrialBalanceCSV`: el texto con el informe de /upload antepuesto o los
//   bloques `[period=…]` de un XLSX daban 0 filas y el orquestador corría sin
//   el preprocesado del balance.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/require-session', () => ({ requireAuthSession: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/agents/financial/orchestrator', async (orig) => {
  const actual = await orig<typeof import('@/lib/agents/financial/orchestrator')>();
  return { ...actual, orchestrateFinancialReport: vi.fn() };
});

import { POST } from '../route';
import { orchestrateFinancialReport } from '@/lib/agents/financial/orchestrator';
import { makeExportableReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import { parseTrialBalanceCSV, preprocessTrialBalance, type PreprocessedBalance } from '@/lib/preprocessing/trial-balance';

const CSV = [
  'codigo,nombre,nivel,transaccional,saldo',
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

const company = { name: 'Empresa Prueba SAS', nit: '900123456', fiscalPeriod: '2025' };

const request = (body: unknown) =>
  new Request('http://localhost/api/financial-report', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

const receivedPreprocessed = () =>
  vi.mocked(orchestrateFinancialReport).mock.calls[0]?.[1]?.preprocessed as PreprocessedBalance | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(orchestrateFinancialReport).mockResolvedValue(makeExportableReport());
});

describe('ruta legacy — rawData leído como lo lee /upload', () => {
  it('bloques XLSX [period=…] → el orquestador recibe el preprocesado de la hoja', async () => {
    const rawData = `[period=Balance 2025]\n${CSV}\n[/period]`;
    const res = await POST(request({ rawData, company, language: 'es' }));
    expect(res.status).toBe(200);
    expect(receivedPreprocessed()?.primary.controlTotals.activo).toBe(10000);
    expect(receivedPreprocessed()?.primary.period).toBe('2025');
  });

  it('rawData con el informe de validación de /upload antepuesto → mismo preprocesado', async () => {
    const pp = preprocessTrialBalance(parseTrialBalanceCSV(CSV));
    const rawData = `${pp.validationReport}\n\n---\n\nDATOS ORIGINALES:\n${CSV}`;
    const res = await POST(request({ rawData, company, language: 'es' }));
    expect(res.status).toBe(200);
    expect(receivedPreprocessed()?.primary.controlTotals.activo).toBe(10000);
  });

  it('hojas en conflicto → 422 con el motivo, sin correr el pipeline', async () => {
    const rawData = [
      `[period=Balance 2025]\n${CSV}\n[/period]`,
      `[period=Cierre 2025]\n${CSV.replace('110505,Caja,Auxiliar,1,1700', '110505,Caja,Auxiliar,1,9999')}\n[/period]`,
    ].join('\n');
    const res = await POST(request({ rawData, company, language: 'es' }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; reasons: string[] };
    expect(body.code).toBe('BALANCE_VALIDATION_FAILED');
    expect(body.reasons.join(' ')).toMatch(/110505/);
    expect(orchestrateFinancialReport).not.toHaveBeenCalled();
  });

  // ingesta-09 (W3-A): el comparativo leído de la columna de saldo inicial se
  // marca como apertura (P&G comparativo N/D, KPIs de resultados N/D).
  it('columna "saldo inicial 2025" → comparativo 2024 marcado saldosDeApertura', async () => {
    const rawData = [
      'codigo,nombre,nivel,transaccional,saldo inicial 2025,saldo final 2025',
      '110505,Caja,Auxiliar,1,50000000,80000000',
      '130505,Clientes,Auxiliar,1,40000000,60000000',
      '220505,Proveedores,Auxiliar,1,30000000,40000000',
      '311505,Capital,Auxiliar,1,40000000,40000000',
      '360505,Utilidad del ejercicio,Auxiliar,1,0,40000000',
      '370505,Utilidades acumuladas,Auxiliar,1,20000000,20000000',
      '410505,Ventas,Auxiliar,1,0,150000000',
      '510505,Sueldos,Auxiliar,1,0,110000000',
    ].join('\n');
    const res = await POST(request({ rawData, company, language: 'es' }));
    expect(res.status).toBe(200);
    expect(receivedPreprocessed()?.comparative?.period).toBe('2024');
    expect(receivedPreprocessed()?.comparative?.saldosDeApertura).toBe(true);
  });
});
