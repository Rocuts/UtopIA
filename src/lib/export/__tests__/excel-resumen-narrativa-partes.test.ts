// ---------------------------------------------------------------------------
// procedencia-R2-01 (parte de artefacto) — el Excel rotula la prosa de las
// Partes I–III como narrativa generada por IA no auditada, en el idioma del
// informe, junto a la prosa (no sólo una vez al inicio del Resumen, antes del
// sello de procedencia) — como el PDF.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';

import { generateFinancialExcel } from '../excel-export';
import { NARRATIVE_DISCLAIMER, NARRATIVE_DISCLAIMER_EN } from '../statement-presentation';
import { makeExportableReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import { withExcelProvenance } from '@/lib/reports/provenance-stamp';

function withParts(language: 'es' | 'en') {
  const report = makeExportableReport();
  report.consolidatedReport = [
    '# REPORTE FINANCIERO CONSOLIDADO',
    '',
    '# PARTE I: ESTADOS FINANCIEROS NIIF',
    '| Total Activo | $10.000,00 |',
    '# PARTE II: ANALISIS ESTRATEGICO Y PROYECCIONES',
    'La utilidad del ejercicio y el disponible cerraron en $9.000.000,00.',
    '# PARTE III: GOBIERNO CORPORATIVO Y DOCUMENTOS LEGALES',
    'La utilidad del ejercicio 2025 fue de $9.000.000,00.',
  ].join('\n');
  return withExcelProvenance(report, { kind: 'unverified' }, language);
}

async function resumen(language: 'es' | 'en'): Promise<string[]> {
  const buf = await generateFinancialExcel({ report: withParts(language), language });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as never);
  const vals: string[] = [];
  wb.getWorksheet('Resumen')!.eachRow((row) =>
    row.eachCell((c) => {
      if (typeof c.value === 'string') vals.push(c.value);
    }),
  );
  return vals;
}

describe('R2-01 — Resumen del Excel: aviso de narrativa IA junto a cada Parte', () => {
  it.each([
    ['es', NARRATIVE_DISCLAIMER],
    ['en', NARRATIVE_DISCLAIMER_EN],
  ] as const)('%s: el aviso sigue a cada encabezado de Parte y precede a su prosa', async (language, aviso) => {
    const vals = await resumen(language);
    for (const heading of ['PARTE I:', 'PARTE II:', 'PARTE III:']) {
      const i = vals.findIndex((v) => v.startsWith(heading));
      expect(i, heading).toBeGreaterThanOrEqual(0);
      expect(vals[i + 1], heading).toBe(aviso);
    }
    const acta = vals.findIndex((v) => v.startsWith('La utilidad del ejercicio 2025'));
    expect(vals[acta - 1]).toBe(aviso);
    // El sello de procedencia no queda bajo el aviso de narrativa.
    const stamp = vals.findIndex((v) => /PROCEDENCIA NO VERIFICADA|UNVERIFIED PROVENANCE/.test(v));
    expect(stamp).toBeGreaterThanOrEqual(0);
    expect(vals.slice(0, stamp).includes(aviso)).toBe(false);
  });
});
