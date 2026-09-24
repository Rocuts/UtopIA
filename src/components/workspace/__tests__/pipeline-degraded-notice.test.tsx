// pipeline-flujo-15 (cross-dep W3-A): cuando Estrategia o Gobierno se
// completan con razonamiento reducido (`degraded === true`), el visor debe
// mostrar el aviso junto a las descargas SIN bloquearlas. El helper
// `reportExportDegradedNotice` existía pero ningún componente lo usaba.
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { DegradedExportNotice } from '../PipelineWorkspace';
import { resolveReportExportBlock } from '../report-export-gate';

const clean = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('DegradedExportNotice — aviso de pases degradados en el visor', () => {
  it('sin pases degradados no renderiza nada', () => {
    const html = renderToStaticMarkup(
      <DegradedExportNotice report={{ strategicAnalysis: {}, governance: {} }} language="es" />,
    );
    expect(html).toBe('');
  });

  it('Estrategia degradada: aviso visible (es / en) con rol de estado', () => {
    const report = { strategicAnalysis: { degraded: true }, governance: {} };
    const es = renderToStaticMarkup(<DegradedExportNotice report={report} language="es" />);
    expect(es).toContain('role="status"');
    expect(clean(es)).toMatch(/Estrategia \(Parte II\) se completó con esfuerzo de razonamiento reducido/);
    const en = renderToStaticMarkup(<DegradedExportNotice report={report} language="en" />);
    expect(clean(en)).toMatch(/Strategy \(Part II\) completed with reduced reasoning effort/);
  });

  it('el aviso no bloquea: un informe limpio con pase degradado sigue siendo descargable', () => {
    const report = {
      niifAnalysis: { fullContent: '# NIIF', reconciliation: { clean: true } },
      strategicAnalysis: { fullContent: '# Estrategia', degraded: true },
      governance: { fullContent: '# Gobierno', degraded: true },
    };
    expect(resolveReportExportBlock(report)).toBeNull();
    expect(clean(renderToStaticMarkup(<DegradedExportNotice report={report} language="es" />))).toMatch(
      /Estrategia \(Parte II\) y Gobierno Corporativo \(Parte III\)/,
    );
  });
});
