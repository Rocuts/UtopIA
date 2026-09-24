/**
 * POST /api/upload — ingesta de balances CSV/XLSX (camino multipart real).
 *
 * Regresiones de la auditoría de exactitud 2026-09:
 *  - ingesta-01: `rawData` (texto sin informe) se expone aparte y es re-parseable.
 *  - ingesta-05: XLSX → CSV con escape RFC 4180 (comas en nombres de cuenta).
 *  - ingesta-03: columnas "Saldo 2025 | Saldo 2024" no colapsan por el nombre de hoja.
 *  - ingesta-04: hojas del mismo año / sin año → periodos con mes o conflicto explícito.
 *  - ingesta-12: códigos repetidos se suman igual en CSV y XLSX.
 *  - Celdas numéricas: enteros tal cual (códigos PUC), no enteros a 2 decimales.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('@/lib/auth/require-session', () => ({
  requireAuthSession: async () => ({ ok: true }),
}));
vi.mock('@/lib/security/rate-limit', () => ({
  checkRateLimit: async () => ({ allowed: true, remaining: 10, limit: 20 }),
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/db/workspace', () => ({
  getOrCreateWorkspace: async () => {
    throw new Error('sin DB en la prueba');
  },
}));
vi.mock('@/lib/rag/vectorstore', () => ({
  addDocumentsToStore: async () => 0,
  invalidateVectorStore: () => {},
  getStoragePath: () => '/tmp/utopia-upload-route-test',
}));
vi.mock('next/cache', () => ({ revalidateTag: () => {} }));

import { Workbook } from 'exceljs';
import { POST } from '@/app/api/upload/route';
import { parseUploadedTrialBalanceText } from '@/lib/preprocessing/raw-data';
import { preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';

interface UploadJson {
  extractedText: string;
  rawData?: string;
  validationReport?: string;
  isTrialBalance: boolean;
  preprocessed: null | {
    primary: { period: string; controlTotals: { activo: number; pasivo: number; patrimonio: number } };
    comparative: null | { period: string; controlTotals: { activo: number } };
    periods: Array<{ period: string }>;
  };
  detectedPeriods: string[];
  ingestWarnings?: string[];
  ingestErrors?: string[];
}

async function upload(bytes: Buffer | string, filename: string): Promise<UploadJson> {
  const fd = new FormData();
  const blob = new Blob([typeof bytes === 'string' ? bytes : new Uint8Array(bytes)]);
  fd.append('file', new File([blob], filename));
  fd.append('context', 'test');
  const res = await POST(new Request('http://localhost/api/upload', { method: 'POST', body: fd }));
  const json = (await res.json()) as UploadJson & { error?: string };
  if (res.status !== 200) throw new Error(`upload ${res.status}: ${json.error}`);
  return json;
}

async function xlsxOf(
  sheets: Array<{ name: string; header: string[]; rows: unknown[][] }>,
): Promise<Buffer> {
  const wb = new Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    ws.addRow(s.header);
    for (const r of s.rows) ws.addRow(r);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// A = 1.000.000 = P 400.000 + K 600.000 (12 auxiliares, sin resultados).
const BASE: Array<[string, string, number]> = [
  ['11050501', 'Caja general', 150000],
  ['11100501', 'Bancos nacionales', 250000],
  ['13050501', 'Clientes nacionales', 100000],
  ['15200101', 'Propiedades, planta y equipo', 500000],
  ['22050101', 'Proveedores nacionales', 150000],
  ['23359501', 'Otros costos y gastos por pagar', 100000],
  ['25050101', 'Salarios por pagar', 50000],
  ['24080101', 'IVA por pagar', 100000],
  ['31050501', 'Capital autorizado', 400000],
  ['33050501', 'Reserva legal', 200000],
  ['14350101', 'Mercancias no fabricadas', 0],
  ['11200501', 'Ahorros', 0],
];

const plain = (n: string) => n.replace(',', '');

beforeAll(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('/api/upload — rawData separado del informe (ingesta-01)', () => {
  it('CSV: rawData es el CSV original, re-parseable al mismo preprocesado; extractedText conserva el informe para el chat', async () => {
    const csv = ['codigo,nombre,saldo', ...BASE.map(([c, n, v]) => `${c},"${n}",${v}`)].join('\n');
    const r = await upload(csv, 'balance.csv');
    expect(r.isTrialBalance).toBe(true);
    expect(r.rawData).toBe(csv);
    expect(r.extractedText.startsWith('# INFORME DE VALIDACION')).toBe(true);
    expect(r.extractedText).toContain('DATOS ORIGINALES:');

    const reparsed = preprocessTrialBalance(parseUploadedTrialBalanceText(r.rawData!).rows);
    expect(reparsed.primary.controlTotals.activo).toBe(r.preprocessed!.primary.controlTotals.activo);
    // Defensa: incluso el texto con informe antepuesto vuelve a dar las mismas filas.
    const fromExtracted = preprocessTrialBalance(parseUploadedTrialBalanceText(r.extractedText).rows);
    expect(fromExtracted.primary.controlTotals.activo).toBe(1_000_000);
  });

  it('XLSX: rawData son los bloques [period=…] y producen el mismo preprocesado', async () => {
    const rows = BASE.map(([c, n, v]) => [c, n, v]);
    const r = await upload(
      await xlsxOf([{ name: 'Balance 2025', header: ['codigo', 'nombre', 'saldo'], rows }]),
      'balance.xlsx',
    );
    expect(r.rawData!.startsWith('[period=Balance 2025]')).toBe(true);
    const reparsed = preprocessTrialBalance(parseUploadedTrialBalanceText(r.rawData!).rows);
    expect(reparsed.primary.period).toBe(r.preprocessed!.primary.period);
    expect(reparsed.primary.controlTotals.activo).toBe(r.preprocessed!.primary.controlTotals.activo);
  });

  it('documento no contable: rawData === extractedText', async () => {
    const r = await upload('Acta de asamblea\nSe aprueba el orden del día.', 'acta.txt');
    expect(r.rawData).toBe(r.extractedText);
    expect(r.isTrialBalance).toBe(false);
  });
});

describe('/api/upload — XLSX → CSV (ingesta-05 y celdas numéricas)', () => {
  it('una coma en el nombre de cuenta no desplaza columnas (RFC 4180)', async () => {
    const rows = BASE.map(([c, n, v]) => [c, n, c === '15200101' ? 20000 : 0, 0, v]);
    const r = await upload(
      await xlsxOf([{ name: 'Balance', header: ['codigo', 'nombre', 'debito', 'credito', 'saldo'], rows }]),
      'balance.xlsx',
    );
    expect(r.preprocessed!.primary.controlTotals.activo).toBe(1_000_000);
    expect(r.rawData).toContain('"Propiedades, planta y equipo"');
  });

  it('coma decimal en el nombre ("Retención 2,5%") no cambia el saldo', async () => {
    const rows: unknown[][] = BASE.map(([c, n, v]) => [c, plain(n), v]);
    rows[2] = ['13551501', 'Anticipo retención en la fuente 2,5%', 100000];
    const r = await upload(
      await xlsxOf([{ name: 'Balance', header: ['codigo', 'nombre', 'saldo'], rows }]),
      'balance.xlsx',
    );
    expect(r.preprocessed!.primary.controlTotals.activo).toBe(1_000_000);
  });

  it('filas vacías (sólo formato) antes del encabezado no se toman como encabezado', async () => {
    const wb = new Workbook();
    const ws = wb.addWorksheet('Balance 2025');
    ws.addRow(['', '', '']);
    ws.addRow(['codigo', 'nombre', 'saldo']);
    for (const [c, n, v] of BASE) ws.addRow([c, n, v]);
    const r = await upload(Buffer.from(await wb.xlsx.writeBuffer()), 'balance.xlsx');
    expect(r.rawData!.split('\n')[1]).toBe('codigo,nombre,saldo');
    expect(r.preprocessed!.primary.controlTotals.activo).toBe(1_000_000);
  });

  it('códigos PUC numéricos se emiten como enteros y el resultado de fórmula IEEE-754 se redondea a centavos', async () => {
    const rows: unknown[][] = BASE.map(([c, n, v]) => [Number(c), plain(n), v]);
    rows[0] = [11050501, 'Caja general', 100.1 + 200.2]; // 300.29999999999995
    rows[1] = [11100501, 'Bancos nacionales', 250000 + 149699.7];
    const r = await upload(
      await xlsxOf([{ name: 'Balance', header: ['codigo', 'nombre', 'saldo'], rows }]),
      'balance.xlsx',
    );
    expect(r.rawData).toContain('11050501,Caja general,300.3');
    expect(r.rawData).not.toContain('11050501.00');
    // Caja 300,30 + Bancos 399.699,70 = 400.000 (antes 150.000 + 250.000)
    expect(r.preprocessed!.primary.controlTotals.activo).toBeCloseTo(1_000_000, 2);
  });
});

describe('/api/upload — periodos por hoja (ingesta-03 / ingesta-04)', () => {
  it('hoja "Balance 2025" con columnas "Saldo 2025 | Saldo 2024": el encabezado manda', async () => {
    const rows = BASE.map(([c, n, v]) => [c, plain(n), v, Math.round(v * 0.8)]);
    const r = await upload(
      await xlsxOf([{ name: 'Balance 2025', header: ['codigo', 'nombre', 'Saldo 2025', 'Saldo 2024'], rows }]),
      'balance.xlsx',
    );
    const csv = ['codigo,nombre,Saldo 2025,Saldo 2024', ...rows.map((x) => x.join(','))].join('\n');
    const rc = await upload(csv, 'balance.csv');
    expect(r.detectedPeriods).toEqual(['2024', '2025']);
    expect(r.preprocessed!.primary.period).toBe('2025');
    expect(r.preprocessed!.primary.controlTotals.activo).toBe(1_000_000);
    expect(r.preprocessed!.comparative!.controlTotals.activo).toBe(800_000);
    expect(r.preprocessed!.primary.controlTotals.activo).toBe(rc.preprocessed!.primary.controlTotals.activo);
  });

  it('hoja genérica "Hoja1" con "Saldo 2025 | Saldo 2024" se interpreta igual que el CSV', async () => {
    const rows = BASE.map(([c, n, v]) => [c, plain(n), v, Math.round(v * 0.8)]);
    const r = await upload(
      await xlsxOf([{ name: 'Hoja1', header: ['codigo', 'nombre', 'Saldo 2025', 'Saldo 2024'], rows }]),
      'balance.xlsx',
    );
    expect(r.preprocessed!.primary.period).toBe('2025');
    expect(r.preprocessed!.primary.controlTotals.activo).toBe(1_000_000);
  });

  it('hojas "Dic 2025" y "Jun 2025": periodos 2025-06 y 2025-12 en orden cronológico, sin mezclar cuentas', async () => {
    const dic = BASE.map(([c, n, v]) => [c, plain(n), v]);
    const jun: unknown[][] = BASE.map(([c, n, v]) => [c, plain(n), Math.round(v / 2)]);
    jun.push(['11200502', 'Cuenta cerrada en julio', 999]);
    const r = await upload(
      await xlsxOf([
        { name: 'Dic 2025', header: ['codigo', 'nombre', 'saldo'], rows: dic },
        { name: 'Jun 2025', header: ['codigo', 'nombre', 'saldo'], rows: jun },
      ]),
      'balance.xlsx',
    );
    expect(r.detectedPeriods).toEqual(['2025-06', '2025-12']);
    expect(r.preprocessed!.primary.period).toBe('2025-12');
    expect(r.preprocessed!.primary.controlTotals.activo).toBe(1_000_000);
    expect(r.preprocessed!.comparative!.controlTotals.activo).toBe(500_000 + 999);
  });

  it('hojas sin año ("Noviembre", "Diciembre"): conflicto explícito, sin preprocesado por orden alfabético', async () => {
    const dic = BASE.map(([c, n, v]) => [c, plain(n), v]);
    const nov = BASE.map(([c, n, v]) => [c, plain(n), Math.round(v * 0.9)]);
    const r = await upload(
      await xlsxOf([
        { name: 'Noviembre', header: ['codigo', 'nombre', 'saldo'], rows: nov },
        { name: 'Diciembre', header: ['codigo', 'nombre', 'saldo'], rows: dic },
      ]),
      'balance.xlsx',
    );
    expect(r.preprocessed).toBeNull();
    expect(r.isTrialBalance).toBe(false);
    expect(r.ingestErrors!.join(' ')).toMatch(/Noviembre.*Diciembre|no indican un año/);
  });

  it('dos hojas del mismo año sin mes y cifras distintas: conflicto explícito', async () => {
    const a = BASE.map(([c, n, v]) => [c, plain(n), v]);
    const b = BASE.map(([c, n, v]) => [c, plain(n), Math.round(v / 2)]);
    const r = await upload(
      await xlsxOf([
        { name: 'Balance 2025', header: ['codigo', 'nombre', 'saldo'], rows: a },
        { name: 'Ajustado 2025', header: ['codigo', 'nombre', 'saldo'], rows: b },
      ]),
      'balance.xlsx',
    );
    expect(r.preprocessed).toBeNull();
    expect(r.ingestErrors!.join(' ')).toContain('2025');
  });

  it('dos hojas de años distintos se fusionan por código (comparativo)', async () => {
    const a = BASE.map(([c, n, v]) => [c, plain(n), v]);
    const b = BASE.map(([c, n, v]) => [c, plain(n), Math.round(v * 0.8)]);
    const r = await upload(
      await xlsxOf([
        { name: '2025', header: ['codigo', 'nombre', 'saldo'], rows: a },
        { name: '2024', header: ['codigo', 'nombre', 'saldo'], rows: b },
      ]),
      'balance.xlsx',
    );
    expect(r.detectedPeriods).toEqual(['2024', '2025']);
    expect(r.preprocessed!.primary.controlTotals.activo).toBe(1_000_000);
    expect(r.preprocessed!.comparative!.controlTotals.activo).toBe(800_000);
  });
});

describe('/api/upload — códigos repetidos (ingesta-12)', () => {
  it('XLSX suma las filas repetidas igual que el CSV y avisa', async () => {
    const rows: unknown[][] = BASE.map(([c, n, v]) => [c, plain(n), v]);
    rows.splice(2, 1, ['13050501', 'Clientes - tercero A', 60000], ['13050501', 'Clientes - tercero B', 40000]);
    const csv = ['codigo,nombre,saldo', ...rows.map((x) => x.join(','))].join('\n');
    const rc = await upload(csv, 'balance.csv');
    const rx = await upload(
      await xlsxOf([{ name: 'Balance 2025', header: ['codigo', 'nombre', 'saldo'], rows }]),
      'balance.xlsx',
    );
    expect(rc.preprocessed!.primary.controlTotals.activo).toBe(1_000_000);
    expect(rx.preprocessed!.primary.controlTotals.activo).toBe(1_000_000);
    expect(rx.ingestWarnings!.join(' ')).toContain('13050501');
  });

  it('XLSX multihoja: los repetidos de cada hoja se suman antes de fusionar periodos', async () => {
    const a: unknown[][] = BASE.map(([c, n, v]) => [c, plain(n), v]);
    a.splice(2, 1, ['13050501', 'Clientes A', 60000], ['13050501', 'Clientes B', 40000]);
    const b = BASE.map(([c, n, v]) => [c, plain(n), Math.round(v * 0.8)]);
    const r = await upload(
      await xlsxOf([
        { name: '2025', header: ['codigo', 'nombre', 'saldo'], rows: a },
        { name: '2024', header: ['codigo', 'nombre', 'saldo'], rows: b },
      ]),
      'balance.xlsx',
    );
    expect(r.preprocessed!.primary.controlTotals.activo).toBe(1_000_000);
    expect(r.preprocessed!.comparative!.controlTotals.activo).toBe(800_000);
  });
});
