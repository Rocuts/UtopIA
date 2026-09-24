// ---------------------------------------------------------------------------
// Re-auditoría 2 (fase 2, 2026-09-24) — e2e-niif2-07
// ---------------------------------------------------------------------------
// `validateConsolidatedReport` leía la fila "| Utilidad del ejercicio 2024 |
// $0,00 | … | $15.000.000,00 |" del Estado de Cambios en el Patrimonio como
// "Utilidad Neta reportada $0,00" (la primera cifra de la fila es la columna
// Capital) y todo informe honesto salía con "Utilidad Neta [2025]: reportado
// $0,00 vs. esperado …" (y [2024] con tres cortes), que la UI muestra.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { validateConsolidatedReport } from '../report-validator';
import { toNiifAnalysisResult } from '../../agents/renderer';
import { informeTresCortes, preprocesarTresCortes } from '../../__fixtures__/tres-cortes-comparativo';
import { informeHonesto, preprocesarPerdidaComparativo } from '../../__fixtures__/perdida-comparativo-w4a';
import type { NiifReportJson } from '../../contracts/niif-report';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';

function consolidated(json: NiifReportJson): string {
  return [
    '# PARTE I: ESTADOS FINANCIEROS NIIF',
    toNiifAnalysisResult(json).fullContent,
    '# PARTE II: ANALISIS ESTRATEGICO Y PROYECCIONES',
    'Sin proyección.',
    '# PARTE III: GOBIERNO CORPORATIVO',
    'Acta.',
  ].join('\n\n');
}

function validate(md: string, pp: PreprocessedBalance) {
  return validateConsolidatedReport(md, pp.primary.controlTotals, {
    comparativeTotals: pp.comparative?.controlTotals,
    primaryPeriod: pp.primary.period,
    comparativePeriod: pp.comparative?.period,
  });
}

describe('e2e-niif2-07 — las filas del ECP no son menciones de la utilidad neta', () => {
  it('tres cortes: el ECP comparativo imprime "Utilidad del ejercicio 2024 | $0,00 | …" sin advertencia', () => {
    const pp = preprocesarTresCortes();
    const md = consolidated(informeTresCortes(pp));
    expect(md).toMatch(/\| Utilidad del ejercicio 2024 \| \$0,00 \|/);
    const r = validate(md, pp);
    expect(r.warnings.filter((w) => /Utilidad Neta/.test(w))).toEqual([]);
  });

  it('pérdida con comparativo: la fila del resultado del ECP no genera "reportado $0,00"', () => {
    const pp = preprocesarPerdidaComparativo();
    const r = validate(consolidated(informeHonesto(pp)), pp);
    expect(r.warnings.filter((w) => /Utilidad Neta/.test(w))).toEqual([]);
  });

  it('la utilidad neta del ERI con otra cifra sigue advirtiendo', () => {
    const pp = preprocesarTresCortes();
    const md = consolidated(informeTresCortes(pp)).replace(
      /(\|\s*\**UTILIDAD NETA DEL PER[IÍ]ODO\**\s*\|\s*\**)\$18\.000\.000,00/,
      '$1$9.000.000,00',
    );
    expect(md).toContain('$9.000.000,00');
    const r = validate(md, pp);
    expect(r.warnings.join('\n')).toMatch(/Utilidad Neta \[2025\]: reportado \$9\.000\.000,00/);
  });

  it('"Total activos fijos" no es el total del balance', () => {
    const pp = preprocesarTresCortes();
    const md = `${consolidated(informeTresCortes(pp))}\n\nEl total activos fijos asciende a $55.000.000,00.`;
    expect(validate(md, pp).warnings.filter((w) => /Total Activo/.test(w))).toEqual([]);
  });
});
