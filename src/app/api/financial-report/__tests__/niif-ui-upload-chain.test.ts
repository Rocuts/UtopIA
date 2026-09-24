/**
 * Integración UI → /api/upload → /api/financial-report/niif (ingesta-01).
 *
 * Recorre la cadena real que usa el wizard NIIF:
 *   POST /api/upload (ruta real, multipart)
 *   → useDocumentExtraction (`pickNiifRawDataFromUpload` + handoff del preprocesado)
 *   → NiifReportIntake (`resolveNiifRawData`)
 *   → PipelineWorkspace (body de /niif + `recallUploadedPreprocessed`)
 *   → POST /api/financial-report/niif (ruta real) → runNiifPhase → prepareFinancialContext
 *
 * Sólo se sustituye el LLM (`callFinancialAgent`) por un centinela que captura
 * el prompt. Antes del fix, el texto de la UI llegaba con el informe de
 * validación antepuesto, el servidor obtenía 0 filas y el prompt decía
 * "No se pudo pre-calcular totales vinculantes"; un balance descuadrado
 * pasaba el gate y llegaba al LLM.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const captured: Array<{ agentName: string; system: string; userContent: string }> = [];

vi.mock('@/lib/auth/require-session', () => ({ requireAuthSession: async () => ({ ok: true }) }));
vi.mock('@/lib/security/rate-limit', () => ({
  checkRateLimit: async () => ({ allowed: true, remaining: 10, limit: 20 }),
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/db/workspace', () => ({
  getOrCreateWorkspace: async () => {
    throw new Error('sin DB');
  },
  getCurrentWorkspaceId: async () => null,
}));
vi.mock('@/lib/rag/vectorstore', () => ({
  addDocumentsToStore: async () => 0,
  invalidateVectorStore: () => {},
  getStoragePath: () => '/tmp/utopia-niif-ui-chain-test',
}));
vi.mock('next/cache', () => ({ revalidateTag: () => {} }));
vi.mock('@/lib/db/activity-log', () => ({ logActivity: async () => {} }));
vi.mock('@/lib/facts/report-facts', () => ({ getHechosEmpresaBlock: async () => '' }));
vi.mock('@/lib/db/telemetry', async (orig) => {
  const actual = await orig<typeof import('@/lib/db/telemetry')>();
  return { ...actual, resolveOwnedReportId: async () => null };
});
vi.mock('@/lib/agents/financial/agents/runtime', () => ({
  callFinancialAgent: vi.fn(async (args: { agentName: string; system: string; userContent: string }) => {
    captured.push({ agentName: args.agentName, system: args.system, userContent: String(args.userContent) });
    throw new Error('SENTINEL: LLM no invocado en la prueba');
  }),
}));

import { Workbook } from 'exceljs';
import {
  pickNiifRawDataFromUpload,
  resolveNiifRawData,
} from '@/components/workspace/intake/niifIntakeValidation';
import {
  clearUploadedPreprocessed,
  recallUploadedPreprocessed,
  rememberUploadedPreprocessed,
} from '@/lib/upload/preprocessed-handoff';

const { POST: uploadPOST } = await import('@/app/api/upload/route');
const { POST: niifPOST } = await import('@/app/api/financial-report/niif/route');

const FIX = path.join(process.cwd(), 'src/lib/preprocessing/__fixtures__');
const NO_BINDING = 'No se pudo pre-calcular';

interface UploadJson {
  extractedText: string;
  rawData?: string;
  preprocessed: unknown;
  isTrialBalance: boolean;
}

async function upload(bytes: Buffer | string, filename: string): Promise<UploadJson> {
  const fd = new FormData();
  fd.append('file', new File([typeof bytes === 'string' ? bytes : new Uint8Array(bytes)], filename));
  fd.append('context', filename);
  const res = await uploadPOST(new Request('http://localhost/api/upload', { method: 'POST', body: fd }));
  expect(res.status).toBe(200);
  return (await res.json()) as UploadJson;
}

const COMPANY = {
  name: 'Demo SAS',
  nit: '900123456',
  entityType: 'SAS',
  niifGroup: 2,
  fiscalPeriod: '2025',
  comparativePeriod: '',
};

/** Réplica de la cadena cliente con las funciones reales del intake. */
function clientNiifBody(uploadJson: UploadJson): Record<string, unknown> {
  // useDocumentExtraction.uploadAndExtract
  const rawText = pickNiifRawDataFromUpload(uploadJson);
  rememberUploadedPreprocessed(rawText, uploadJson.preprocessed);
  // NiifReportIntake: rawData = extracted.rawText || prev.rawData → resolveNiifRawData
  const intakeRawData = rawText || '';
  const finalRawData = resolveNiifRawData(rawText, intakeRawData);
  // PipelineWorkspace: niifBody
  const body: Record<string, unknown> = {
    rawData: finalRawData,
    company: COMPANY,
    language: 'es',
    instructions: '',
  };
  const pp = recallUploadedPreprocessed(finalRawData);
  if (pp) body.preprocessed = pp;
  return body;
}

async function callNiif(body: unknown, stream = false) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (stream) headers['x-stream'] = 'true';
  const res = await niifPOST(
    new Request('http://localhost/api/financial-report/niif', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
  );
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* SSE */
  }
  return { status: res.status, json, text };
}

function pass1Prompt(): string {
  const p = captured.find((c) => c.agentName === 'niif-analyst-pass1');
  expect(p).toBeDefined();
  return `${p!.system}\n${p!.userContent}`;
}

// Libros cerrados y coherentes: A 200M = P 80M + K 120M, y el 3605 ($20M) es
// el resultado de las clases 4-7 (190M netos − 20M − 10M − 140M). Con CMV de
// $150M el P&G daba $10M ≠ 3605: el archivo cuadraba SIN el resultado y R8
// (auditoría 2026-09, niif-preproceso-06) lo bloquea con razón en vez de
// absorber $10M en 3710VC.
const BALANCED_CSV = [
  'codigo,nombre,nivel,saldo 2025',
  '110505,Caja,Auxiliar,50000000',
  '130505,Clientes,Auxiliar,40000000',
  '143505,Mercancias,Auxiliar,60000000',
  '152405,"Equipo de oficina, muebles",Auxiliar,50000000',
  '220505,Proveedores,Auxiliar,30000000',
  '230505,Cxp,Auxiliar,30000000',
  '240405,Renta,Auxiliar,20000000',
  '311505,Capital,Auxiliar,100000000',
  '360505,Utilidad del ejercicio,Auxiliar,20000000',
  '410505,Ventas,Auxiliar,200000000',
  '417505,Devoluciones,Auxiliar,10000000',
  '510505,Sueldos,Auxiliar,20000000',
  '530505,Intereses,Auxiliar,10000000',
  '613505,CMV,Auxiliar,140000000',
].join('\n');

beforeAll(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
beforeEach(() => {
  captured.length = 0;
  clearUploadedPreprocessed();
});

describe('UI → /niif: el informe corre con el motor determinista', () => {
  it('CSV cuadrado: la UI envía el dato limpio y el prompt lleva TOTALES VINCULANTES', async () => {
    const up = await upload(BALANCED_CSV, 'balance.csv');
    expect(up.isTrialBalance).toBe(true);
    const body = clientNiifBody(up);
    expect(String(body.rawData).split('\n')[0]).toBe('codigo,nombre,nivel,saldo 2025');
    await callNiif(body);
    const prompt = pass1Prompt();
    expect(prompt).toContain('TOTALES VINCULANTES');
    expect(prompt).not.toContain(NO_BINDING);
    // El informe de validación no viaja como dato al LLM.
    expect(prompt).not.toContain('# INFORME DE VALIDACION ARITMETICA');
  });

  it('XLSX sintético cuadrado: bloques [period=…] producen preprocesado en /niif', async () => {
    const wb = new Workbook();
    const ws = wb.addWorksheet('Balance 2025');
    ws.addRow(['codigo', 'nombre', 'nivel', 'saldo']);
    for (const line of BALANCED_CSV.split('\n').slice(1)) {
      const [code, ...rest] = line.match(/("[^"]*"|[^,]+)/g)!.map((c) => c.replace(/"/g, ''));
      ws.addRow([Number(code), rest[0], rest[1], Number(rest[2])]);
    }
    const up = await upload(Buffer.from(await wb.xlsx.writeBuffer()), 'balance.xlsx');
    expect(up.isTrialBalance).toBe(true);
    const body = clientNiifBody(up);
    expect(String(body.rawData).startsWith('[period=Balance 2025]')).toBe(true);
    await callNiif(body);
    const prompt = pass1Prompt();
    expect(prompt).not.toContain(NO_BINDING);
    expect(prompt).toContain('Periodo actual (2025)');
  });

  it('XLSX real del repositorio: o corre con preprocesado o se detiene con 422, nunca sin totales vinculantes', async () => {
    // Export real de ERP: filas de título y el código en la tercera columna.
    // Mientras el parser no lo lea (detección de columnas, otro paquete), la
    // ruta de la UI se detiene con motivo en vez de correr sólo con el LLM.
    const buf = fs.readFileSync(path.join(FIX, 'grupo-empresarial-2tres-sas.xlsx'));
    const up = await upload(buf, 'grupo.xlsx');
    const res = await callNiif(clientNiifBody(up));
    if (res.status === 422) {
      expect((res.json as { code?: string }).code).toBe('BALANCE_VALIDATION_FAILED');
      expect(captured).toHaveLength(0);
      return;
    }
    expect(pass1Prompt()).not.toContain(NO_BINDING);
  });

  it('cliente anterior (extractedText con informe antepuesto): el servidor descarta el informe y preprocesa', async () => {
    const up = await upload(BALANCED_CSV, 'balance.csv');
    expect(up.extractedText.startsWith('# INFORME DE VALIDACION')).toBe(true);
    await callNiif({ rawData: up.extractedText, company: COMPANY, language: 'es', instructions: '' });
    expect(pass1Prompt()).not.toContain(NO_BINDING);
  });
});

describe('UI → /niif: el gate 422 se aplica igual que por envío directo', () => {
  const DESCUADRADO = () => fs.readFileSync(path.join(FIX, 'elite-pulido-diamante.csv'), 'utf8');

  it('balance descuadrado: 422 por la UI y por envío directo, sin llegar al LLM', async () => {
    const csv = DESCUADRADO();
    const up = await upload(csv, 'elite.csv');
    const body = clientNiifBody(up);

    const direct = await callNiif({ ...body, rawData: csv, preprocessed: undefined });
    expect(direct.status).toBe(422);
    expect((direct.json as { code?: string }).code).toBe('BALANCE_VALIDATION_FAILED');

    const ui = await callNiif(body);
    expect(ui.status).toBe(422);
    expect((ui.json as { code?: string }).code).toBe('BALANCE_VALIDATION_FAILED');

    // Mismo resultado sin el preprocesado reenviado (p. ej. tras recargar).
    const uiWithoutHandoff = await callNiif({ ...body, preprocessed: undefined });
    expect(uiWithoutHandoff.status).toBe(422);
    expect(captured).toHaveLength(0);
  });

  it('balance descuadrado por SSE (la UI usa streaming): evento error BALANCE_VALIDATION_FAILED', async () => {
    const up = await upload(DESCUADRADO(), 'elite.csv');
    const res = await callNiif(clientNiifBody(up), true);
    expect(res.text).toContain('event: error');
    expect(res.text).toContain('BALANCE_VALIDATION_FAILED');
    expect(res.text).not.toContain('event: niif_phase');
    expect(captured).toHaveLength(0);
  });

  it('procedencia: un preprocesado del cliente que no corresponde a rawData no sustituye al del servidor', async () => {
    const balanced = await upload(BALANCED_CSV, 'balance.csv');
    const res = await callNiif({
      rawData: DESCUADRADO(),
      company: COMPANY,
      language: 'es',
      instructions: '',
      preprocessed: balanced.preprocessed,
    });
    expect(res.status).toBe(422);
    expect(captured).toHaveLength(0);
  });

  it('hojas en conflicto: 422 con los motivos aunque el cliente envíe un preprocesado', async () => {
    const balanced = await upload(BALANCED_CSV, 'balance.csv');
    const half = BALANCED_CSV.replace(/,(\d+)$/gm, (_m, v) => `,${Math.round(Number(v) / 2)}`);
    const rawData = `[period=Balance 2025]\n${BALANCED_CSV}\n[/period]\n\n[period=Ajustado 2025]\n${half}\n[/period]`;
    const res = await callNiif({
      rawData,
      company: COMPANY,
      language: 'es',
      instructions: '',
      preprocessed: balanced.preprocessed,
    });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.json)).toContain('Ajustado 2025');
    expect(captured).toHaveLength(0);
  });

  it('balance tabular ilegible: 422 con motivo en vez de seguir sólo con el LLM', async () => {
    const unreadable = BALANCED_CSV.replace('codigo,nombre,nivel,saldo 2025', 'BALANCE DE PRUEBA DEMO SAS,,,');
    const res = await callNiif({ rawData: unreadable, company: COMPANY, language: 'es', instructions: '' });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.json)).toMatch(/No se pudieron leer las filas/);
    expect(captured).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ingesta-09 (cross-dep W3-A): /api/upload y /niif llamaban
// preprocessTrialBalance(rows) sin `openingPeriods`, así que una columna
// "saldo inicial" se trataba como un cierre 2024 con P&G comparativo, a
// diferencia de /api/financial-report, /export y el Stage 0.
// ---------------------------------------------------------------------------
describe('UI → /niif: columna de saldo inicial = saldos de apertura', () => {
  // Apertura: A 170 = P 50 + K 120 (sin P&G). Cierre: A 220 = P 60 + K 160 con
  // 3605 = 40 = 150 − 80 − 10 − 20.
  const OPENING_CSV = [
    'codigo,nombre,nivel,transaccional,saldo inicial 2025,saldo final 2025',
    '110505,Caja,Auxiliar,1,50000000,80000000',
    '130505,Clientes,Auxiliar,1,40000000,60000000',
    '143505,Mercancias,Auxiliar,1,30000000,30000000',
    '152405,Equipo de oficina,Auxiliar,1,50000000,50000000',
    '220505,Proveedores,Auxiliar,1,30000000,40000000',
    '230505,Cxp,Auxiliar,1,20000000,20000000',
    '311505,Capital,Auxiliar,1,100000000,100000000',
    '360505,Utilidad del ejercicio,Auxiliar,1,0,40000000',
    '370505,Utilidades acumuladas,Auxiliar,1,20000000,20000000',
    '410505,Ventas,Auxiliar,1,0,150000000',
    '510505,Sueldos,Auxiliar,1,0,80000000',
    '530505,Intereses,Auxiliar,1,0,10000000',
    '613505,CMV,Auxiliar,1,0,20000000',
  ].join('\n');

  it('/api/upload marca el comparativo como saldos de apertura', async () => {
    const up = await upload(OPENING_CSV, 'balance.csv');
    expect(up.isTrialBalance).toBe(true);
    const pp = up.preprocessed as { comparative?: { period?: string; saldosDeApertura?: boolean } };
    expect(pp.comparative?.period).toBe('2024');
    expect(pp.comparative?.saldosDeApertura).toBe(true);
  });

  it('/niif re-deriva el preprocesado con el mismo marcado: el bloque vinculante no trata la apertura como P&G', async () => {
    const up = await upload(OPENING_CSV, 'balance.csv');
    await callNiif(clientNiifBody(up));
    expect(pass1Prompt()).toContain('NO es P&G comparativo');
  });
});
