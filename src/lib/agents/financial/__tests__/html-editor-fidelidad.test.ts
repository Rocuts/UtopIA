// ---------------------------------------------------------------------------
// Regresión — Fidelidad numérica del entregable HTML que el cliente firma
// ---------------------------------------------------------------------------
//
// Queja de origen (auditoría 2026-08): "aunque se ve bien los números salen a
// veces mal". Tres defectos encadenados que estos tests fijan:
//
//   (a) El Editor Jefe re-tecleaba ~200 cifras convirtiéndolas de centavos a
//       pesos y NADA comparaba el HTML contra el JSON de origen.
//   (b) `validateHtmlChecklist` —el único validador con aritmética— estaba
//       exportado, testeado y sin un solo importador en producción.
//   (c) Su Check 7 sumaba HORIZONTALMENTE dentro de la fila, así que en el
//       layout real de un estado financiero no podía disparar nunca.
//
// Cada bloque de este archivo falla contra el código anterior a la ola.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateHtmlChecklist, reconcileBindingFigures } from '../agents/html-editor-validator';
import { collectBindingFigures, type HtmlEditorMetadata } from '../contracts/html-editor';
import type { NiifReportJson } from '../contracts/niif-report';

// ---------------------------------------------------------------------------
// Mocks — sólo para los tests de `runHtmlEditor` (bloque D)
// ---------------------------------------------------------------------------

const mockGenerateText = vi.fn();

vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
}));

// Evita cargar `@ai-sdk/openai` (y su cadena de providers) en el runner.
vi.mock('@/lib/config/models', () => ({
  MODELS: { FINANCIAL_PIPELINE: 'mock-model' },
  MODELS_CONFIG: {
    htmlEditor: { reasoningEffort: 'medium', textVerbosity: 'high', maxOutputTokens: 48000 },
  },
}));

// El input real exige los 3 sub-schemas Zod completos (cientos de campos). Se
// sustituye SÓLO el schema; el resto del módulo (collectBindingFigures, que es
// lo que se está probando) sigue siendo el real.
vi.mock('../contracts/html-editor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../contracts/html-editor')>();
  return {
    ...actual,
    HtmlEditorInputSchema: {
      safeParse: (body: unknown) => ({ success: true as const, data: body }),
    },
  };
});

const { runHtmlEditor } = await import('../agents/html-editor');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HASH = 'a'.repeat(64);

const METADATA: HtmlEditorMetadata = {
  reportMode: 'LINEA_BASE',
  entityNit: '900123456-1',
  entityName: 'Empresa Test SAS',
  entityCity: 'Cali',
  entityType: 'SAS',
  entityLaw: 'Ley 1258/2008',
  entityGroup: 'Grupo 2',
  periodStart: '2025-01-01',
  periodEnd: '2025-12-31',
  periodYear: '2025',
  generatedAt: '2026-05-13T10:00:00Z',
  extractedAt: '2026-05-12T08:00:00Z',
  issuedAtHuman: '13 de mayo de 2026',
  modelId: 'gpt-5.4-mini',
  agentVersion: '1+1 v10.1',
  globalConfidence: { highPct: 80, mediumPct: 15, lowPct: 5 },
  alertsCounts: { high: 0, medium: 1, low: 2 },
  auxiliariesProcessed: 120,
  coverageByClass: [],
  sectorCIIU: '4711',
  reportHashSha256: HASH,
};

/**
 * Reporte NIIF de referencia. Cuadra: Activo = Pasivo + Patrimonio y
 * cashClosing = cashOpening + netChange.
 *
 *   Activo      419.655.824.290 centavos = $4.196.558.242,90
 *   Pasivo      120.000.000.000           = $1.200.000.000,00
 *   Patrimonio  299.655.824.290           = $2.996.558.242,90
 */
const NIIF_REPORT = {
  balanceSheet: {
    totalAssetsPrimary: '419655824290',
    totalAssetsComparative: null,
    totalLiabilitiesPrimary: '120000000000',
    totalLiabilitiesComparative: null,
    totalEquityPrimary: '299655824290',
    totalEquityComparative: null,
  },
  incomeStatement: {
    grossProfitPrimary: '50000000000',
    operatingProfitPrimary: '30000000000',
    netIncomePrimary: '20000000000',
    netIncomeComparative: null,
  },
  cashFlow: {
    cashOpening: '1000000000',
    cashClosing: '1500000000',
    netChange: '500000000',
  },
  equityChanges: {
    rows: [
      { kind: 'opening_balance', total: '279655824290' },
      { kind: 'closing_balance', total: '299655824290' },
    ],
  },
} as unknown as NiifReportJson;

/** Estados financieros del fixture, con todas las cifras vinculantes. */
function statementPages(overrides: { totalActivo?: string; totalPasivo2024?: string } = {}) {
  const totalActivo = overrides.totalActivo ?? '$4.196.558.242,90';
  return `
  <article class="page" id="page-04">
    <h2>Estado de Situación Financiera</h2>
    <table class="ft">
      <thead><tr><th>Concepto</th><th>2025</th></tr></thead>
      <tbody>
        <tr><td>Efectivo y equivalentes</td><td>$15.000.000,00</td></tr>
        <tr><td>Otros activos</td><td>$4.181.558.242,90</td></tr>
        <tr class="total"><td>TOTAL ACTIVO</td><td>${totalActivo}</td></tr>
      </tbody>
    </table>
    <table class="ft">
      <thead><tr><th>Concepto</th><th>2025</th></tr></thead>
      <tbody>
        <tr><td>Obligaciones financieras</td><td>$700.000.000,00</td></tr>
        <tr><td>Cuentas por pagar</td><td>$500.000.000,00</td></tr>
        <tr class="total"><td>TOTAL PASIVO</td><td>$1.200.000.000,00</td></tr>
        <tr><td>Capital social</td><td>$1.000.000.000,00</td></tr>
        <tr><td>Resultados acumulados</td><td>$1.796.558.242,90</td></tr>
        <tr><td>Resultado del ejercicio</td><td>$200.000.000,00</td></tr>
        <tr class="total"><td>TOTAL PATRIMONIO</td><td>$2.996.558.242,90</td></tr>
      </tbody>
    </table>
  </article>
  <article class="page" id="page-05"><h2>Cascada de utilidad</h2></article>
  <article class="page" id="page-06">
    <h2>Estado de Resultados Integrales</h2>
    <table class="ft">
      <thead><tr><th>Concepto</th><th>2025</th></tr></thead>
      <tbody>
        <tr><td>Ingresos de actividades ordinarias</td><td>$1.000.000.000,00</td></tr>
        <tr><td>Costo de ventas</td><td>($500.000.000,00)</td></tr>
        <tr class="total"><td>UTILIDAD BRUTA</td><td>$500.000.000,00</td></tr>
        <tr><td>Gastos de administración</td><td>($200.000.000,00)</td></tr>
        <tr class="total"><td>UTILIDAD OPERACIONAL</td><td>$300.000.000,00</td></tr>
        <tr><td>Impuesto de renta</td><td>($100.000.000,00)</td></tr>
        <tr class="total"><td>UTILIDAD NETA</td><td>$200.000.000,00</td></tr>
      </tbody>
    </table>
  </article>
  <article class="page" id="page-07">
    <h2>Estado de Flujos de Efectivo</h2>
    <table class="ft">
      <tbody>
        <tr><td>Efectivo al inicio del período</td><td>$10.000.000,00</td></tr>
        <tr><td>Aumento neto en efectivo</td><td>$5.000.000,00</td></tr>
        <tr class="total"><td>Total efectivo al final del período</td><td>$15.000.000,00</td></tr>
      </tbody>
    </table>
  </article>
  <article class="page" id="page-08">
    <h2>Estado de Cambios en el Patrimonio</h2>
    <table class="ft">
      <tbody>
        <tr><td>Saldo al 1 de enero de 2025</td><td>$2.796.558.242,90</td></tr>
        <tr><td>Resultado del ejercicio</td><td>$200.000.000,00</td></tr>
        <tr class="total"><td>Total saldo al 31 de diciembre de 2025</td><td>$2.996.558.242,90</td></tr>
      </tbody>
    </table>
  </article>${overrides.totalPasivo2024 ?? ''}`;
}

/** HTML de 15 páginas que pasa TODOS los checks block. */
function makeReportHtml(
  overrides: { totalActivo?: string; pages?: number; extraBody?: string; close?: boolean } = {},
): string {
  const pages = overrides.pages ?? 15;
  // Páginas de relleno para llegar a las 15 que exige §4.
  const filler = Array.from({ length: Math.max(0, pages - 10) }, (_, i) =>
    `<article class="page" id="fill-${i}"><h2>Sección ${i + 1}</h2></article>`,
  ).join('\n');

  const doc = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Informe Financiero NIIF 2025</title>
  <!-- REPORT_MODE: LINEA_BASE -->
  <!-- ENTITY: 900123456-1 -->
  <!-- AGENT_VERSION: 1+1 v10.1 -->
  <link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@400&family=Inter:wght@400&family=IBM+Plex+Mono:wght@400&display=swap" rel="stylesheet">
  <style>
    :root { --accent: #1E3A5F; }
    @page { size: A4 portrait; margin: 0; } .page { width: 210mm; min-height: 297mm; }
    .ft { font-variant-numeric: tabular-nums; }
  </style>
</head>
<body>
  <article class="page" id="portada">
    <h1>2025</h1>
    <p>Primer cierre formal bajo NIIF — la línea base del negocio.</p>
    <p>Hash: ${HASH}</p>
  </article>
  <article class="page" id="toc"><h2>Tabla de Contenido</h2></article>
  <article class="page" id="page-02"><h2>Mensaje del Representante Legal</h2></article>
  <article class="page" id="page-03">
    <h1>El ejercicio 2025 en cifras</h1>
    <p>La entidad establece la línea base documental. Sin período comparativo.</p>
    <p>Razón corriente 2,13×. Margen fuera de banda △. Confianza media · conciliar.</p>
  </article>
${statementPages({ totalActivo: overrides.totalActivo })}
  <article class="page" id="page-10">
    <h2>Notas — Parte 2</h2>
    <section><h2>Limitaciones de Información</h2></section>
  </article>
${filler}
  <article class="page" id="page-14">
    <h2>Cierre y Trazabilidad</h2>
    <section><h2>Cómo se construyó este informe</h2></section>
    <p>Hash SHA-256: <code>${HASH}</code></p>
  </article>
  ${overrides.extraBody ?? ''}
</body>
</html>`;
  return overrides.close === false ? doc.replace(/<\/html>\s*$/, '') : doc;
}

// ===========================================================================
// A · Check 7 — aritmética POR COLUMNA
// ===========================================================================

describe('Check 7 · §1.1 — aritmética de totales por columna', () => {
  const check7 = (html: string) =>
    validateHtmlChecklist(html, METADATA).filter((f) => f.rule.includes('Check 7'));

  it('tabla comparativa | Rubro | 2025 | 2024 | cuyas columnas cuadran → 0 fallos', () => {
    const html = `<!DOCTYPE html><html><body><table class="ft">
      <thead><tr><th>Rubro</th><th>2025</th><th>2024</th></tr></thead>
      <tbody>
        <tr><td>Efectivo</td><td>$15.000.000,00</td><td>$10.000.000,00</td></tr>
        <tr><td>Deudores</td><td>$25.000.000,00</td><td>$20.000.000,00</td></tr>
        <tr><td>Inventarios</td><td>$60.000.000,00</td><td>$50.000.000,00</td></tr>
        <tr class="total"><td>TOTAL ACTIVO</td><td>$100.000.000,00</td><td>$80.000.000,00</td></tr>
      </tbody></table></body></html>`;
    expect(check7(html)).toHaveLength(0);
  });

  it('el TOTAL de la columna 2024 alterado en $1.000.000 → 1 fallo block que cita la columna', () => {
    // REGRESIÓN (c): con el Check 7 horizontal esto devolvía 0 fallos, porque
    // tras descartar la etiqueta quedaba un solo valor en la fila.
    const html = `<!DOCTYPE html><html><body><table class="ft">
      <thead><tr><th>Rubro</th><th>2025</th><th>2024</th></tr></thead>
      <tbody>
        <tr><td>Efectivo</td><td>$15.000.000,00</td><td>$10.000.000,00</td></tr>
        <tr><td>Deudores</td><td>$25.000.000,00</td><td>$20.000.000,00</td></tr>
        <tr><td>Inventarios</td><td>$60.000.000,00</td><td>$50.000.000,00</td></tr>
        <tr class="total"><td>TOTAL ACTIVO</td><td>$100.000.000,00</td><td>$81.000.000,00</td></tr>
      </tbody></table></body></html>`;
    const failures = check7(html);
    expect(failures).toHaveLength(1);
    expect(failures[0].severity).toBe('block');
    expect(failures[0].detail).toContain('columna 3');
  });

  it('columna Δ% adicional no genera falsos bloqueos', () => {
    const html = `<!DOCTYPE html><html><body><table class="ft">
      <thead><tr><th>Rubro</th><th>2025</th><th>2024</th><th>Δ%</th></tr></thead>
      <tbody>
        <tr><td>Efectivo</td><td>$15.000.000,00</td><td>$10.000.000,00</td><td>50,0%</td></tr>
        <tr><td>Deudores</td><td>$25.000.000,00</td><td>$20.000.000,00</td><td>25,0%</td></tr>
        <tr class="total"><td>TOTAL</td><td>$40.000.000,00</td><td>$30.000.000,00</td><td>33,3%</td></tr>
      </tbody></table></body></html>`;
    expect(check7(html)).toHaveLength(0);
  });

  it('los negativos entre paréntesis (convención NIIF) se computan como negativos', () => {
    const html = `<!DOCTYPE html><html><body><table class="ft">
      <tbody>
        <tr><td>Ingresos</td><td>$1.000.000,00</td></tr>
        <tr><td>Costos</td><td>($400.000,00)</td></tr>
        <tr class="total"><td>TOTAL UTILIDAD BRUTA</td><td>$600.000,00</td></tr>
      </tbody></table></body></html>`;
    expect(check7(html)).toHaveLength(0);
  });

  it('el fixture completo de 15 páginas no dispara Check 7', () => {
    expect(check7(makeReportHtml())).toHaveLength(0);
  });
});

// ===========================================================================
// B · Reconciliación HTML ↔ JSON
// ===========================================================================

describe('reconcileBindingFigures — HTML contra el JSON de origen', () => {
  const blocks = (html: string) =>
    reconcileBindingFigures(html, { niifReport: NIIF_REPORT }).filter(
      (f) => f.severity === 'block',
    );

  it('las cifras vinculantes salen convertidas UNA vez, en TypeScript', () => {
    const figures = collectBindingFigures(NIIF_REPORT);
    const activo = figures.find((f) => f.path === 'balanceSheet.totalAssetsPrimary');
    expect(activo?.formatted).toBe('$4.196.558.242,90');
    // Los ceros no son vinculantes: §1.2 manda renderizarlos como "—".
    expect(figures.every((f) => f.cents !== '0')).toBe(true);
  });

  it('HTML fiel al JSON → 0 fallos block', () => {
    expect(blocks(makeReportHtml())).toHaveLength(0);
  });

  it('desliz de escala ×100 en el Activo Total → block que nombra el desliz', () => {
    // REGRESIÓN (a): la cifra está inflada 100×, la fila sigue cuadrando
    // horizontalmente y ningún check anterior lo veía.
    const html = makeReportHtml({ totalActivo: '$419.655.824.290,00' });
    const failures = blocks(html);
    const activo = failures.find((f) => f.detail.includes('Total Activo'));
    expect(activo).toBeDefined();
    expect(activo?.detail).toContain('desliz de escala');
  });

  it('presentación en pesos enteros (sin centavos) se acepta', () => {
    const html = makeReportHtml().replace(
      '$4.196.558.242,90',
      '$4.196.558.243',
    );
    const activo = blocks(html).find((f) => f.detail.includes('Total Activo'));
    expect(activo).toBeUndefined();
  });

  it('una cifra vinculante simplemente ausente → block', () => {
    const html = makeReportHtml().replace(/\$2\.996\.558\.242,90/g, '—');
    const failures = blocks(html);
    expect(failures.some((f) => f.detail.includes('Patrimonio'))).toBe(true);
  });
});

// ===========================================================================
// C · Check 22 — el conteo de páginas es el único testigo de la truncación
// ===========================================================================

describe('Check 22 · §4 — 15 páginas', () => {
  it('un informe de 13 páginas es BLOQUEANTE, no un aviso', () => {
    const failures = validateHtmlChecklist(makeReportHtml({ pages: 13 }), METADATA);
    const c22 = failures.find((f) => f.rule.includes('Check 22'));
    expect(c22).toBeDefined();
    expect(c22?.severity).toBe('block');
  });
});

// ===========================================================================
// D · runHtmlEditor — cableado, finishReason y política de `block`
// ===========================================================================

describe('runHtmlEditor — gate de fidelidad', () => {
  const INPUT = {
    niifReport: NIIF_REPORT,
    strategyReport: {},
    governanceReport: {},
    company: { name: 'Empresa Test SAS', nit: '900123456-1', fiscalPeriod: '2025' },
    metadata: METADATA,
    language: 'es',
  } as never;

  beforeEach(() => {
    mockGenerateText.mockReset();
  });

  it('happy path: HTML fiel → emittable, sin BORRADOR y una sola emisión', async () => {
    mockGenerateText.mockResolvedValue({ text: makeReportHtml(), finishReason: 'stop' });
    const out = await runHtmlEditor(INPUT);

    expect(out.checklistFailures.filter((f) => f.severity === 'block')).toHaveLength(0);
    expect(out.emittable).toBe(true);
    expect(out.html).not.toContain('BORRADOR');
    expect(mockGenerateText).toHaveBeenCalledTimes(1);
  });

  it('cifra inflada 100×: el validador profundo + la reconciliación SÍ corren en producción', async () => {
    // REGRESIÓN (b): antes `runHtmlEditor` sólo ejecutaba el linter ligero
    // —sin un solo check numérico— y devolvía checklistFailures: [].
    const roto = makeReportHtml({ totalActivo: '$419.655.824.290,00' });
    mockGenerateText.mockResolvedValue({ text: roto, finishReason: 'stop' });

    const out = await runHtmlEditor(INPUT);

    expect(
      out.checklistFailures.some(
        (f) => f.severity === 'block' && f.rule.includes('Reconciliación'),
      ),
    ).toBe(true);
    expect(out.emittable).toBe(false);
  });

  it('un fallo bloqueante que persiste estampa el HTML como BORRADOR', async () => {
    mockGenerateText.mockResolvedValue({
      text: makeReportHtml({ totalActivo: '$419.655.824.290,00' }),
      finishReason: 'stop',
    });

    const out = await runHtmlEditor(INPUT);

    expect(out.emittable).toBe(false);
    expect(out.html).toContain('BORRADOR');
    expect(out.html).toContain('No es apto para firma');
    // Reintento correctivo: 2 emisiones.
    expect(mockGenerateText).toHaveBeenCalledTimes(2);
    const [, retryCall] = mockGenerateText.mock.calls as Array<[{ messages: Array<{ content: string }> }]>;
    expect(retryCall[0].messages[1].content).toContain('<correcciones_obligatorias>');
  });

  it('el reintento correctivo recupera el informe y lo deja emitible', async () => {
    mockGenerateText
      .mockResolvedValueOnce({
        text: makeReportHtml({ totalActivo: '$419.655.824.290,00' }),
        finishReason: 'stop',
      })
      .mockResolvedValueOnce({ text: makeReportHtml(), finishReason: 'stop' });

    const out = await runHtmlEditor(INPUT);

    expect(out.emittable).toBe(true);
    expect(out.html).not.toContain('BORRADOR');
  });

  it('finishReason="length" LANZA en vez de servir un informe truncado', async () => {
    // REGRESIÓN: el DOCTYPE es el primer byte emitido, así que un HTML cortado
    // a mitad de la página 09 pasaba el único gate que existía.
    mockGenerateText.mockResolvedValue({ text: makeReportHtml(), finishReason: 'length' });
    await expect(runHtmlEditor(INPUT)).rejects.toThrow(/finish_reason=length/);
  });

  it('un HTML que no cierra con </html> LANZA como truncado', async () => {
    mockGenerateText.mockResolvedValue({
      text: makeReportHtml({ close: false }),
      finishReason: 'stop',
    });
    await expect(runHtmlEditor(INPUT)).rejects.toThrow(/TRUNCADO/);
  });

  it('centavos crudos filtrados al cuerpo → block (§1.9) aunque no diga "centavos"', async () => {
    mockGenerateText.mockResolvedValue({
      text: makeReportHtml({ extraBody: '<p>Total activo: 419655824290</p>' }),
      finishReason: 'stop',
    });
    const out = await runHtmlEditor(INPUT);
    expect(
      out.checklistFailures.some(
        (f) => f.severity === 'block' && f.detail.includes('sin separadores'),
      ),
    ).toBe(true);
  });

  it('los checks §10/§1.6/§5/§6 no salen duplicados en el banner', async () => {
    mockGenerateText.mockResolvedValue({
      text: makeReportHtml().replace('<!-- ENTITY: 900123456-1 -->', ''),
      finishReason: 'stop',
    });
    const out = await runHtmlEditor(INPUT);
    const entity = out.checklistFailures.filter((f) => f.rule.includes('ENTITY'));
    expect(entity).toHaveLength(1);
  });
});
