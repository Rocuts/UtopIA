// ---------------------------------------------------------------------------
// Integration test — fixture testigo Grupo Empresarial 2 Tres SAS
// ---------------------------------------------------------------------------
// Pulido NIIF PYME Grupo 2 — corre el pipeline determinístico (parser +
// curator + gate auditReportEmittable) sobre el XLSX testigo y verifica
// que el sistema produce dictamen "no emitible" con los blockers correctos.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import path from 'node:path';
import ExcelJS from 'exceljs';

import {
  extractCompanyMetadata,
  parseTrialBalanceCSV,
  preprocessTrialBalance,
} from '@/lib/preprocessing/trial-balance';
import {
  auditReportEmittable,
  reportConstituyeReservaLegal,
  reportMencionaIFRS18,
  type AuditCompanyContext,
} from '@/lib/pillars/audit-report-emittable';
import { validateNITCheckDigit } from '@/lib/validation/nit-validator';
import type { FinancialReport } from '@/lib/agents/financial/types';

const FIXTURE_PATH = path.resolve(
  process.cwd(),
  'src/lib/preprocessing/__fixtures__/grupo-empresarial-2tres-sas.xlsx',
);

async function loadFixtureAsCSV(): Promise<{ csv: string; rawText: string }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FIXTURE_PATH);
  const ws = wb.worksheets[0];

  const allLines: string[] = [];
  ws.eachRow((row) => {
    const values = row.values as unknown[];
    const cells = values.slice(1).map((v) => {
      if (v === null || v === undefined) return '';
      if (typeof v === 'string') return v;
      if (typeof v === 'number') return String(v);
      if (typeof v === 'object') {
        const obj = v as {
          text?: string;
          result?: unknown;
          richText?: Array<{ text: string }>;
          formula?: string;
        };
        if (obj.text) return obj.text;
        if (obj.richText) return obj.richText.map((rt) => rt.text).join('');
        if (obj.result !== undefined) return String(obj.result);
      }
      return String(v);
    });
    allLines.push(cells.join(','));
  });

  // Para parseTrialBalanceCSV: necesitamos los headers de columna
  // ("Nivel,Transaccional,Código cuenta contable,Nombre cuenta contable,Saldo inicial 2024,Saldo final 2025")
  // como primera línea + las filas de cuentas. Los meta-rows (1-7) los
  // pasamos al raw para extractCompanyMetadata pero los descartamos antes
  // de parseTrialBalanceCSV — parseo arranca en row 8 (header).
  const rawText = allLines.join('\n');
  // El header del XLSX está en la fila 8 (R8 según ExcelJS).
  // Las filas 1-7 son metadata (razón social, NIT, periodo).
  // parseTrialBalanceCSV espera headers conocidos; mapeamos:
  //   "Código cuenta contable" → "codigo" (parser ya tolera "código")
  //   "Nombre cuenta contable" → "nombre"
  //   "Nivel" → "nivel"
  //   "Transaccional" → "transaccional"
  //   "Saldo inicial 2024" / "Saldo final 2025" → balance columns con año detectado
  const dataLines = allLines.slice(7); // descartar rows 1-7 (1-indexed → 0-6 array)
  return { csv: dataLines.join('\n'), rawText };
}

describe('Integration — Grupo Empresarial 2 Tres SAS (fixture testigo)', () => {
  it('extractCompanyMetadata extrae razón social y NIT del Excel', async () => {
    const { rawText } = await loadFixtureAsCSV();
    const meta = extractCompanyMetadata(rawText);

    expect(meta.razonSocialFromFile).toMatch(/Grupo Empresarial 2 Tres/i);
    expect(meta.nitFromFile).toBe('901.714.014-6');
    expect(meta.nitBodyDigits).toBe('901714014');
    expect(meta.nitCheckDigit).toBe('6');
  });

  it('NIT 901714014-6 verifica DV DIAN correctamente', () => {
    expect(validateNITCheckDigit('901714014-6')).toBe(true);
  });

  it('preprocessTrialBalance + auditReportEmittable produce dictamen "no emitible"', async () => {
    const { csv, rawText } = await loadFixtureAsCSV();
    const meta = extractCompanyMetadata(rawText);

    const rows = parseTrialBalanceCSV(csv, { currentYear: '2025' });
    expect(rows.length).toBeGreaterThan(50);

    const result = preprocessTrialBalance(rows);
    const snap = result.primary;

    // Verificaciones del Curator: el balance de prueba real tiene libros
    // NO cerrados (clase 3 sólo tiene 3710 Convergencia $42.720, mientras
    // el P&L produce utilidad transitoria material).
    // El test acepta que CUALQUIERA de los blockers críticos del Pulido
    // dispare — V12 (libros no cerrados) o V11 (causación impuesto)
    // dependiendo del orden de R8/R12 y de los datos exactos.

    const fakeReport: FinancialReport = {
      company: { name: meta.razonSocialFromFile ?? '', nit: meta.nitFromFile ?? '', fiscalPeriod: '2025' },
      niifAnalysis: {
        balanceSheet: '',
        incomeStatement: '',
        cashFlowStatement: '',
        equityChangesStatement: '',
        technicalNotes: '',
        fullContent: '',
      },
      strategicAnalysis: {
        kpiDashboard: '',
        breakEvenAnalysis: '',
        projectedCashFlow: '',
        strategicRecommendations: '',
        fullContent: '',
      },
      governance: { financialNotes: '', shareholderMinutes: '', fullContent: '' },
      // Reporte vacío → falla V10 (TMT no calculada) entre otros.
      consolidatedReport: '# Informe stub para test',
      generatedAt: '2026-05-08T00:00:00Z',
    };

    const company: AuditCompanyContext = {
      razonSocialFromFile: meta.razonSocialFromFile,
      nitFromFile: meta.nitFromFile,
      nit: meta.nitFromFile,
      niifGroup: 2,
      tipoSocietario: 'SAS',
      estatutosRequierenReservaLegal: undefined,
    };

    const gate = auditReportEmittable(fakeReport, snap, company);

    // El reporte NO debe ser emitible.
    expect(gate.emittable).toBe(false);
    expect(gate.blockers.length).toBeGreaterThan(0);

    // Debe incluir V10 (TMT no calculada — informe stub no menciona TMT).
    expect(gate.blockers.some((b) => b.code === 'V10')).toBe(true);

    // Debe estar V12 (libros no cerrados) Y/O V11 (causación impuesto)
    // según el saldo real del balance de prueba.
    const blockerCodes = gate.blockers.map((b) => b.code);
    expect(blockerCodes).toEqual(
      expect.arrayContaining([expect.stringMatching(/^V(11|12)$/)]),
    );

    // El reporte stub NO menciona IFRS 18 ni constituye reserva legal,
    // así que V8 / V9 NO deben dispararse.
    expect(reportMencionaIFRS18(fakeReport.consolidatedReport)).toBe(false);
    expect(reportConstituyeReservaLegal(fakeReport.consolidatedReport)).toBe(false);
    expect(blockerCodes).not.toContain('V8');
    expect(blockerCodes).not.toContain('V9');
  });
});
