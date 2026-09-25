// reportes-export-23 — El PDF de cierre mensual se subía a Blob (acceso
// público) con una ruta determinística que incluía el workspaceId y el mes, y
// sin sufijo aleatorio: la URL era predecible y un recierre del mismo mes
// fallaba al chocar con el blob anterior (el `catch` devolvía null).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const put = vi.hoisted(() =>
  vi.fn(async (pathname: string) => ({ url: `https://blob.example/${pathname}-sufijo` })),
);

vi.mock('@vercel/blob', () => ({ put }));
vi.mock('../repository', () => ({
  getPeriodById: vi.fn(async () => ({ id: 'p1', year: 2026, month: 3 })),
}));
vi.mock('@/lib/export/pdf-elite', () => ({
  generateElitePdf: vi.fn(async () => Buffer.from('%PDF-test')),
}));

import { closingReportBlobKey, generatePdfReport } from '../steps/generate-pdf';

const WORKSPACE = '5f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f';
const input = {
  workspaceId: WORKSPACE,
  periodId: 'p1',
  runId: 'r1',
  hash: 'h',
} as unknown as Parameters<typeof generatePdfReport>[0];

const previousToken = process.env.BLOB_READ_WRITE_TOKEN;

beforeEach(() => {
  put.mockClear();
  process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
});

afterEach(() => {
  if (previousToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN = previousToken;
});

describe('reportes-export-23 — PDF de cierre en Blob', () => {
  it('la clave no lleva el workspace y no se repite entre llamadas', () => {
    const a = closingReportBlobKey(2026, 3);
    const b = closingReportBlobKey(2026, 3);
    expect(a).toMatch(/^closing-reports\/[0-9a-f-]{36}\/informe-cierre-2026-03\.pdf$/);
    expect(a).not.toBe(b);
  });

  it('sube con ruta no adivinable, sufijo aleatorio y sin identificadores del tenant', async () => {
    const url = await generatePdfReport(input);
    expect(url).not.toBeNull();
    expect(put).toHaveBeenCalledTimes(1);
    const [pathname, , options] = put.mock.calls[0] as unknown as [string, Buffer, Record<string, unknown>];
    expect(pathname).not.toContain(WORKSPACE);
    expect(pathname).toMatch(/^closing-reports\/[0-9a-f-]{36}\//);
    expect(options).toMatchObject({ addRandomSuffix: true, contentType: 'application/pdf' });
  });

  it('un recierre del mismo mes produce un blob nuevo en vez de chocar con el anterior', async () => {
    await generatePdfReport(input);
    await generatePdfReport(input);
    const [first, second] = put.mock.calls.map((c) => c[0]);
    expect(first).not.toBe(second);
  });
});
