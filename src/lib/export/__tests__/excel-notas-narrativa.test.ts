// ---------------------------------------------------------------------------
// e2e-niif-10 (re-auditoría 2026-09-24) en el Excel: las notas en prosa del
// ESF, el ERI y el ECP y las notas técnicas del Pass-3 las redacta el LLM y sus
// cifras no se anclan ("El efectivo al cierre asciende a $9.999.999,00"). El
// PDF ya las rotula como narrativa no auditada; el .xlsx las imprimía sin aviso.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';

import { generateFinancialExcel } from '../excel-export';
import {
  NARRATIVE_DISCLAIMER,
  NARRATIVE_DISCLAIMER_EN,
} from '../statement-presentation';
import { makeExportableReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import type { FinancialReport } from '@/lib/agents/financial/types';

function conNotas(): FinancialReport {
  const report = makeExportableReport();
  const json = report.niifAnalysis.json!;
  json.balanceSheet.notes = [{ ref: 'Nota 2', norma: null, body: 'El efectivo al cierre asciende a $9.999.999,00.' }];
  json.incomeStatement.notes = [{ ref: 'Nota 3', norma: null, body: 'La utilidad neta fue de $44.444.444,00.' }];
  json.equityChanges.notes = [{ ref: null, norma: null, body: 'El patrimonio creció por la utilidad de $40.000.000,00.' }];
  json.technicalNotes = [{ ref: 'Nota 1', norma: null, body: 'El patrimonio es $77.777.777,00 y el ROE fue 25,0%.' }];
  return report;
}

async function textos(report: FinancialReport, language?: 'es' | 'en'): Promise<Record<string, string[]>> {
  const buf = await generateFinancialExcel({ report, language });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as never);
  const out: Record<string, string[]> = {};
  wb.eachSheet((ws) => {
    const vals: string[] = [];
    ws.eachRow((row) => row.eachCell((c) => {
      if (typeof c.value === 'string') vals.push(c.value);
    }));
    out[ws.name] = vals;
  });
  return out;
}

/** El aviso aparece en la hoja ANTES de la primera nota en prosa. */
function avisoAntesDe(vals: string[], aviso: string, nota: string): boolean {
  const i = vals.indexOf(aviso);
  const j = vals.findIndex((v) => v.includes(nota));
  return i >= 0 && j > i;
}

describe('e2e-niif-10 — notas en prosa del Excel rotuladas como narrativa no auditada', () => {
  it('notas del ESF, del ERI, del ECP y notas técnicas llevan el aviso antes de la prosa', async () => {
    const t = await textos(conNotas());
    expect(avisoAntesDe(t['Balance NIIF'], NARRATIVE_DISCLAIMER, '$9.999.999,00')).toBe(true);
    expect(avisoAntesDe(t['Estado Resultados'], NARRATIVE_DISCLAIMER, '$44.444.444,00')).toBe(true);
    expect(avisoAntesDe(t['Cambios en Patrimonio'], NARRATIVE_DISCLAIMER, '$40.000.000,00')).toBe(true);
    expect(avisoAntesDe(t['Notas Técnicas'], NARRATIVE_DISCLAIMER, '$77.777.777,00')).toBe(true);
  });

  it('sin notas en prosa no se agrega el aviso a los estados', async () => {
    const t = await textos(makeExportableReport());
    for (const hoja of ['Balance NIIF', 'Estado Resultados', 'Cambios en Patrimonio']) {
      expect(t[hoja]).not.toContain(NARRATIVE_DISCLAIMER);
    }
  });

  it('en inglés el aviso es la versión en inglés', async () => {
    const t = await textos(conNotas(), 'en');
    expect(avisoAntesDe(t['Balance NIIF'], NARRATIVE_DISCLAIMER_EN, '$9.999.999,00')).toBe(true);
    expect(avisoAntesDe(t['Notas Técnicas'], NARRATIVE_DISCLAIMER_EN, '$77.777.777,00')).toBe(true);
  });
});
