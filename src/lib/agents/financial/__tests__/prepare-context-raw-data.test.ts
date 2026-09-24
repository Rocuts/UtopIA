/**
 * prepareFinancialContext — Stage 0 con el rawData que envía la UI (ingesta-01).
 *
 * El texto que /api/upload devolvía como `extractedText` llevaba el informe de
 * validación antepuesto; `parseTrialBalanceCSV` tomaba el título del informe
 * como encabezado → 0 filas → sin preprocesado, sin totales vinculantes, sin
 * gate 422 y sin anclas. Stage 0 ahora lee el texto con el mismo helper que el
 * upload y, si un balance tabular no produce filas, se detiene con motivo.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  prepareFinancialContext,
  BalanceValidationError,
} from '@/lib/agents/financial/orchestrator';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import type { CompanyInfo } from '@/lib/agents/financial/types';

const COMPANY: CompanyInfo = {
  name: 'Demo SAS',
  nit: '900123456-7',
  entityType: 'SAS',
  fiscalPeriod: '2025',
  niifGroup: 2,
};

// Balance cuadrado: A = 1.000.000 = P 400.000 + K 600.000.
const CSV = [
  'codigo,nombre,saldo',
  '11050501,Caja general,150000',
  '11100501,Bancos,250000',
  '13050501,Clientes,100000',
  '15200101,"Propiedades, planta y equipo",500000',
  '22050101,Proveedores,150000',
  '23359501,Otros,100000',
  '25050101,Salarios,50000',
  '24080101,IVA,100000',
  '31050501,Capital,400000',
  '33050501,Reserva legal,200000',
  '14350101,Mercancias,0',
].join('\n');

/** Réplica de lo que /api/upload anteponía al texto (upload/route.ts, antes del fix). */
function withUploadReport(data: string): string {
  const rows = data.startsWith('[period=')
    ? parseTrialBalanceCSV(data.split('\n').slice(1, -1).join('\n'), { forcePeriod: '2025' })
    : parseTrialBalanceCSV(data);
  const pp = preprocessTrialBalance(rows);
  return `${pp.validationReport}\n\n---\n\nDATOS ORIGINALES:\n${data}`;
}

const NO_BINDING = 'No se pudo pre-calcular';

beforeAll(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('prepareFinancialContext — rawData de la UI', () => {
  it('CSV con informe antepuesto: hay preprocesado, totales vinculantes y el LLM recibe sólo el dato', async () => {
    const ctx = await prepareFinancialContext(
      { rawData: withUploadReport(CSV), company: COMPANY, language: 'es' },
      {},
    );
    expect(ctx.ppForAgents).toBeDefined();
    expect(ctx.ppForAgents!.primary.controlTotals.activo).toBe(1_000_000);
    expect(ctx.bindingTotalsBlock).not.toContain(NO_BINDING);
    expect(ctx.effectiveRawData).toBe(CSV);
  });

  it('XLSX (bloques [period=…]) con y sin informe antepuesto', async () => {
    const blocks = `[period=Balance 2025]\n${CSV}\n[/period]`;
    for (const rawData of [blocks, withUploadReport(blocks)]) {
      const ctx = await prepareFinancialContext({ rawData, company: COMPANY, language: 'es' }, {});
      expect(ctx.ppForAgents?.primary.period).toBe('2025');
      expect(ctx.bindingTotalsBlock).not.toContain(NO_BINDING);
    }
  });

  it('balance descuadrado con informe antepuesto: el gate 422 se aplica igual que con el CSV directo', async () => {
    const csv = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/preprocessing/__fixtures__/elite-pulido-diamante.csv'),
      'utf8',
    );
    await expect(
      prepareFinancialContext({ rawData: csv, company: COMPANY, language: 'es' }, {}),
    ).rejects.toBeInstanceOf(BalanceValidationError);
    await expect(
      prepareFinancialContext({ rawData: withUploadReport(csv), company: COMPANY, language: 'es' }, {}),
    ).rejects.toBeInstanceOf(BalanceValidationError);
  });

  it('balance tabular sin filas legibles: se detiene con motivo en vez de seguir sin cifras vinculantes', async () => {
    const unreadable = CSV.replace('codigo,nombre,saldo', 'EMPRESA DEMO SAS,,');
    const err = await prepareFinancialContext(
      { rawData: unreadable, company: COMPANY, language: 'es' },
      {},
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BalanceValidationError);
    expect((err as BalanceValidationError).reasons.join(' ')).toMatch(/no se pudieron leer/i);
  });

  it('hojas en conflicto: los motivos de ingesta llegan como 422', async () => {
    const half = CSV.replace(/,(\d+)$/gm, (_m, v) => `,${Math.round(Number(v) / 2)}`);
    const rawData = `[period=Balance 2025]\n${CSV}\n[/period]\n\n[period=Ajustado 2025]\n${half}\n[/period]`;
    const err = await prepareFinancialContext(
      { rawData, company: COMPANY, language: 'es' },
      {},
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BalanceValidationError);
    expect((err as BalanceValidationError).reasons.join(' ')).toContain('Ajustado 2025');
  });

  it('texto no tabular (p. ej. OCR de un PDF) sigue sin preprocesado y lo declara en el bloque vinculante', async () => {
    const ctx = await prepareFinancialContext(
      { rawData: 'Estado de situación financiera\nActivo total: 1.000.000', company: COMPANY, language: 'es' },
      {},
    );
    expect(ctx.ppForAgents).toBeUndefined();
    expect(ctx.bindingTotalsBlock).toContain(NO_BINDING);
  });
});
