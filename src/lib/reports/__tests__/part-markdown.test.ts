// ---------------------------------------------------------------------------
// Markdown de las Partes I–III re-renderizado por el servidor (I3)
// ---------------------------------------------------------------------------
// La paridad con las fases reales se prueba en
// src/app/api/financial-report/__tests__/markdown-procedencia.route.test.ts.
// Aquí: los canales por los que un texto del cliente podía colarse en el
// render (pases degradados, lista de no verificables, reconciliación
// "limpia" con desviaciones), el consolidado (sustitución del segmento de las
// Partes y reconstrucción sin referencia) y los casos borde (Parte vacía,
// KPIs sin preprocesado).
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { makeExportableReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import { buildConsolidatedReportMarkdown } from '@/lib/agents/financial/consolidated-markdown';
import { buildProvisionalDraftBanner } from '@/lib/agents/financial/split-consolidation';
import { preprocessUploadedTrialBalanceText } from '@/lib/preprocessing/raw-data';
import type { FinancialReport } from '@/lib/agents/financial/types';
import {
  buildServerConsolidatedReport,
  provisionalReasonOf,
  withServerPartsInConsolidated,
  withServerRenderedParts,
} from '../part-markdown';
import { PROVENANCE_COMPANY, PROVENANCE_CSV } from './provenance-fixture';
import { withCoherentParts } from './coherent-parts';

const read = preprocessUploadedTrialBalanceText(PROVENANCE_CSV);
if (read.kind !== 'ok') throw new Error('fixture sin balance');
const pp = read.preprocessed;
const company = { ...PROVENANCE_COMPANY, niifGroup: 2 as const };
const FAKE = 'La utilidad neta del ejercicio fue de $987.654.321,00.';

function report(): FinancialReport {
  return withCoherentParts({ ...makeExportableReport(), company }, pp, { impracticable: true });
}

describe('withServerRenderedParts — el texto del cliente no entra al render', () => {
  it('Markdown alterado en las tres Partes: se sustituye por el render del JSON', () => {
    const r = report();
    r.niifAnalysis.fullContent = FAKE;
    r.strategicAnalysis.strategicRecommendations = FAKE;
    r.governance.shareholderMinutes = FAKE;
    const out = withServerRenderedParts(r, pp, 'es');
    expect(JSON.stringify([out.niifAnalysis, out.strategicAnalysis, out.governance])).not.toContain('987.654.321');
    expect(out.niifAnalysis.fullContent).toContain('Comparativos impracticables');
    expect(out.governance.shareholderMinutes).toMatch(/^## 2\. ACTA DE ASAMBLEA GENERAL DE ACCIONISTAS ORDINARIA/);
    expect(out.strategicAnalysis.strategicRecommendations).toMatch(/^## 5\. RECOMENDACIONES ESTRATÉGICAS/);
    // Mismo JSON, mismo texto: el render es idempotente.
    const again = withServerRenderedParts(out, pp, 'es');
    expect(again.governance.fullContent).toBe(out.governance.fullContent);
    expect(again.strategicAnalysis.fullContent).toBe(out.strategicAnalysis.fullContent);
    expect(again.niifAnalysis.fullContent).toBe(out.niifAnalysis.fullContent);
  });

  it('pases degradados de la Parte I: sólo los rótulos del analista llegan al aviso', () => {
    const r = report();
    r.niifAnalysis.reconciliation = {
      clean: true, deviations: [], lineGaps: [], repairAttempted: false,
      degradedPasses: ['Notas técnicas', FAKE],
    };
    const out = withServerRenderedParts(r, pp, 'es');
    expect(out.niifAnalysis.fullContent).toMatch(/SECCIÓN GENERADA CON RAZONAMIENTO REDUCIDO/);
    expect(out.niifAnalysis.fullContent).toContain('> Notas técnicas: el primer intento');
    expect(out.niifAnalysis.fullContent).not.toContain('987.654.321');
  });

  it('la lista de no verificables la declara el cruce del servidor, no la del cliente', () => {
    const r = report();
    r.strategicAnalysis.strategyQualifications = { clean: false, motivos: ['Motivo del director'], noVerificables: [FAKE] };
    const out = withServerRenderedParts(r, pp, 'es');
    expect(out.strategicAnalysis.strategyQualifications?.clean).toBe(false);
    expect(out.strategicAnalysis.strategyQualifications?.noVerificables).not.toContain(FAKE);
    expect(out.strategicAnalysis.fullContent).not.toContain('987.654.321');
    // El sello del veredicto (que conserva el motivo del cliente) sí se imprime.
    expect(out.strategicAnalysis.kpiDashboard).toMatch(/ANÁLISIS ESTRATÉGICO CON SALVEDADES[\s\S]*> - Motivo del director/);
  });

  it('una reconciliación "limpia" con desviaciones o discrepancias del EFE no es limpia', () => {
    const r = report();
    r.niifAnalysis.reconciliation = {
      clean: true, deviations: [], lineGaps: [], repairAttempted: false, cashFlowDiscrepancies: ['EFE: brecha en operación.'],
    };
    const out = withServerRenderedParts(r, pp, 'es');
    expect(out.niifAnalysis.reconciliation?.clean).toBe(false);
    // Sello del analista reconstruido desde la reconciliación (ya no limpia).
    expect(out.niifAnalysis.balanceSheet).toMatch(/^> ## REPORTE CON SALVEDADES/);
  });

  it('Parte sin JSON: vacía queda vacía (INCOMPLETO); con texto, el texto se sustituye por el sello', () => {
    const blank = report();
    delete blank.strategicAnalysis.json;
    blank.strategicAnalysis.fullContent = '';
    const outBlank = withServerRenderedParts(blank, pp, 'es');
    expect(outBlank.strategicAnalysis.fullContent).toBe('');
    expect(outBlank.strategicAnalysis.strategyQualifications?.clean).toBe(false);

    const withText = report();
    delete withText.governance.json;
    withText.governance.fullContent = FAKE;
    const outText = withServerRenderedParts(withText, pp, 'es');
    expect(outText.governance.fullContent).toMatch(/^> ## PARTE III SIN CIFRAS ESTRUCTURADAS — NO VERIFICABLE/);
    expect(outText.governance.fullContent).not.toContain('987.654.321');
    expect(outText.niifAnalysis.reconciliation?.clean).toBe(false);
  });

  it('sin preprocesado los KPIs con ancla no se declaran N/D si la tabla imprime su cifra', () => {
    const r = report();
    r.strategicAnalysis.json!.kpis = [
      {
        category: 'liquidity', name: 'Razón corriente', formula: 'AC / PC', resultPrimary: '2,5', resultComparative: null,
        unit: 'times', benchmarkBand: { description: '> 1', lowerBound: '1', upperBound: null }, diagnosis: 'Holgura.',
        yoyVariation: null, confidence: null, anomalyFlag: null, presentationMode: null, baselineLabel: null, sparklinePoints: null,
      },
    ];
    const out = withServerRenderedParts(r, undefined, 'es');
    expect(out.strategicAnalysis.kpiDashboard).toContain('| Razón corriente |');
    expect(out.strategicAnalysis.kpiDashboard).not.toMatch(/Publicados N\/D[^\n]*Razón corriente/);
  });
});

describe('consolidado', () => {
  it('por referencia: sólo se sustituye el segmento de las Partes (encabezado, BORRADOR y traza de ajustes se conservan)', () => {
    const rendered = withServerRenderedParts(report(), pp, 'es');
    const banner = buildProvisionalDraftBanner('Cierre urgente', ['error A'], 'es');
    const legacyBody = buildConsolidatedReportMarkdown(company, `NIIF ${FAKE}`, 'Estrategia', `Acta\n> **Nota Legal:** falsa`, 'es');
    const trailer = '---\n\n## Ajustes contables aplicados durante el proceso de revision\n\n| id |';
    const persisted = `${banner}\n\n${legacyBody}\n\n${trailer}`;
    const out = withServerPartsInConsolidated(persisted, rendered, 'es')!;
    expect(out).not.toContain('987.654.321');
    expect(out.startsWith(`${banner}\n\n# REPORTE FINANCIERO CONSOLIDADO`)).toBe(true);
    expect(out).toContain(rendered.governance.fullContent);
    expect(out.endsWith(`\n\n${trailer}`)).toBe(true);
    expect(out.match(/^# PARTE III:/gm)).toHaveLength(1);
    expect(withServerPartsInConsolidated('Consolidado sin estructura', rendered, 'es')).toBeNull();
  });

  it('sin referencia: se reconstruye entero; conserva la aclaración BORRADOR y añade la traza calculada por el servidor', () => {
    const rendered = withServerRenderedParts(report(), pp, 'es');
    const client = `${buildProvisionalDraftBanner('Cierre urgente', [], 'es')}\n\n# Otro texto ${FAKE}`;
    expect(provisionalReasonOf(client)).toBe('Cierre urgente');
    const out = buildServerConsolidatedReport({
      report: { ...rendered, generatedAt: '2026-09-24T12:00:00Z' },
      preprocessed: pp,
      language: 'es',
      clientConsolidated: client,
      adjustmentsSection: '## Ajustes contables aplicados durante el proceso de revision',
    }).consolidatedReport;
    expect(out).not.toContain('987.654.321');
    expect(out).toMatch(/^> ⚠️ \*\*BORRADOR — VALIDACION PENDIENTE\*\*/);
    expect(out).toContain('Razon declarada: "Cierre urgente"');
    expect(out).toContain(rendered.strategicAnalysis.fullContent);
    expect(out.endsWith('## Ajustes contables aplicados durante el proceso de revision')).toBe(true);

    const noDraft = buildServerConsolidatedReport({
      report: rendered, preprocessed: pp, language: 'es', clientConsolidated: `# X ${FAKE}`,
    }).consolidatedReport;
    expect(noDraft.startsWith('# REPORTE FINANCIERO CONSOLIDADO')).toBe(true);
  });
});
