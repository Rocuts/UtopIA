// Tests del validador profundo §11 spec v10.1 — html-editor-validator.ts
//
// Cubre los checks del checklist §11 con fixtures HTML sintéticos. El
// validador usa linkedom como DOM parser — no requiere browser real.
//
// Convención de fixtures:
//   - `makeValidHtml(overrides?)` — HTML mínimo que pasa TODOS los checks block.
//   - Tests individuales corrompen partes del HTML válido para disparar fallos.
//
// Refs:
//   - docs/spec/financial-report-v10.1.md §11 (checklist completo)
//   - src/lib/agents/financial/agents/html-editor-validator.ts

import { describe, it, expect } from 'vitest';
import { validateHtmlChecklist } from '../agents/html-editor-validator';
import type { HtmlEditorMetadata } from '../contracts/html-editor';

// ---------------------------------------------------------------------------
// Fixture metadata — metadata mínima válida para todos los tests
// ---------------------------------------------------------------------------

const HASH = 'a'.repeat(64);

const BASE_METADATA: HtmlEditorMetadata = {
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
  coverageByClass: [
    {
      classCode: '1',
      auxiliariesCount: 30,
      totalSaldoCop: '100000000',
      percentOfFolio: '45.2',
    },
    {
      classCode: '4',
      auxiliariesCount: 10,
      totalSaldoCop: '80000000',
      percentOfFolio: '36.1',
    },
  ],
  sectorCIIU: '4711',
  reportHashSha256: HASH,
};

// ---------------------------------------------------------------------------
// HTML fixture mínimo válido (v10.1)
// ---------------------------------------------------------------------------

function makeValidHtml(
  overrides: {
    omitReportModeComment?: boolean;
    omitEntityComment?: boolean;
    omitAgentVersionComment?: boolean;
    reportMode?: string;
    omitLimitaciones?: boolean;
    omitHowBuilt?: boolean;
    omitHash?: boolean;
    injectForbiddenWord?: string;
    injectGoldToken?: string;
    injectOrphanZero?: boolean;
    injectPlusJakarta?: boolean;
    injectAspectRatio16x9?: boolean;
  } = {},
): string {
  const mode = overrides.reportMode ?? 'LINEA_BASE';
  const reportModeComment = overrides.omitReportModeComment
    ? ''
    : `<!-- REPORT_MODE: ${mode} -->`;
  const entityComment = overrides.omitEntityComment
    ? ''
    : `<!-- ENTITY: 900123456-1 -->`;
  const agentVersionComment = overrides.omitAgentVersionComment
    ? ''
    : `<!-- AGENT_VERSION: 1+1 v10.1 -->`;
  const hash = overrides.omitHash ? '' : HASH;
  const limitaciones = overrides.omitLimitaciones
    ? ''
    : '<section id="limitaciones"><h2>Limitaciones de Información</h2></section>';
  const howBuilt = overrides.omitHowBuilt
    ? ''
    : '<section id="page-14"><h2>Cómo se construyó este informe</h2></section>';
  const forbiddenWord = overrides.injectForbiddenWord ?? '';
  const goldToken = overrides.injectGoldToken ?? '';
  const orphanZero = overrides.injectOrphanZero ? '<td>$0</td>' : '';
  const fontFamily = overrides.injectPlusJakarta
    ? 'family=Plus+Jakarta+Sans:wght@400;600'
    : 'family=Source+Serif+4:wght@300;400&family=Inter:wght@400;600&family=IBM+Plex+Mono:wght@400';
  const pageGeometry = overrides.injectAspectRatio16x9
    ? '.page { aspect-ratio: 16/9; max-width: 1440px; }'
    : '@page { size: A4 portrait; margin: 0; } .page { width: 210mm; min-height: 297mm; }';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Informe Financiero NIIF 2025 — Empresa Test SAS</title>
  ${reportModeComment}
  ${entityComment}
  ${agentVersionComment}
  <!-- PERIOD: 2025-01-01 a 2025-12-31 -->
  <!-- GENERATED_AT: 2026-05-13T10:00:00Z -->
  <!-- CONFIDENCE_GLOBAL: medium -->
  <link href="https://fonts.googleapis.com/css2?${fontFamily}&display=swap" rel="stylesheet">
  <style>
    :root {
      --paper: #FAF8F3;
      --accent: #1E3A5F;
      ${goldToken}
    }
    ${pageGeometry}
    .ft { font-variant-numeric: tabular-nums; }
  </style>
</head>
<body>
  <article class="page" id="portada">
    <h1>2025</h1>
    <p>Primer cierre formal bajo NIIF — la línea base del negocio.</p>
    <p>Hash: ${hash}</p>
  </article>
  <article class="page" id="toc"><h2>Tabla de Contenido</h2></article>
  <article class="page" id="page-02"><h2>Mensaje del Representante Legal</h2></article>
  <article class="page" id="page-03">
    <h1>El ejercicio 2025 en cifras</h1>
    <p>La entidad establece la línea base documental para el período 2025. Sin período comparativo.</p>
    <p>Indicador: razón corriente 2,13×. Margen neto fuera de banda <sup class="n">△</sup>.</p>
    <p>Confianza media · conciliar antes de firmar.</p>
    ${forbiddenWord}
    ${orphanZero}
  </article>
  <article class="page" id="page-04">
    <h2>Estado de Situación Financiera</h2>
    <table class="ft">
      <thead><tr><th>Concepto</th><th>Activo</th><th>Pasivo</th><th>Total</th></tr></thead>
      <tbody>
        <tr><td>Línea 1</td><td>400</td><td>200</td><td>600</td></tr>
      </tbody>
      <tfoot><tr><td>Total general</td><td>400</td><td>200</td><td class="total">600</td></tr></tfoot>
    </table>
  </article>
  <article class="page" id="page-05"><h2>Cascada de utilidad</h2></article>
  <article class="page" id="page-06"><h2>Estado de Resultados Integrales</h2></article>
  <article class="page" id="page-07">
    <h2>Estado de Flujos de Efectivo</h2>
    <p>Efectivo al inicio del período: $100.000</p>
    <p>Total activo: $4.196.558.243</p>
  </article>
  <article class="page" id="page-08"><h2>Estado de Cambios en el Patrimonio</h2></article>
  <article class="page" id="page-09"><h2>Notas — Parte 1</h2></article>
  <article class="page" id="page-10">
    <h2>Notas — Parte 2</h2>
    ${limitaciones}
  </article>
  <article class="page" id="page-11"><h2>Indicadores</h2></article>
  <article class="page" id="page-12"><h2>Análisis editorial</h2></article>
  <article class="page" id="page-13"><h2>Recomendaciones</h2></article>
  <article class="page" id="page-14">
    <h2>Cierre y Trazabilidad</h2>
    ${howBuilt}
    <p>Hash SHA-256: <code>${hash}</code></p>
    <p>1+1 · Plataforma Contable Colombia</p>
  </article>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validateHtmlChecklist — §11 spec v10.1', () => {
  // ── 1. Happy path ──────────────────────────────────────────────────────────

  it('happy path: HTML válido → 0 failures block', () => {
    const html = makeValidHtml();
    const failures = validateHtmlChecklist(html, BASE_METADATA);
    const blockFailures = failures.filter((f) => f.severity === 'block');
    expect(blockFailures).toHaveLength(0);
  });

  // ── 2. §10 — REPORT_MODE comment ausente ──────────────────────────────────

  it('failure §10 Check 1: sin REPORT_MODE comment → block', () => {
    const html = makeValidHtml({ omitReportModeComment: true });
    const failures = validateHtmlChecklist(html, BASE_METADATA);
    const match = failures.find((f) => f.rule.includes('REPORT_MODE'));
    expect(match).toBeDefined();
    expect(match?.severity).toBe('block');
  });

  // ── 3. §10 — ENTITY comment ausente ───────────────────────────────────────

  it('failure §10 Check 1: sin ENTITY comment → block', () => {
    const html = makeValidHtml({ omitEntityComment: true });
    const failures = validateHtmlChecklist(html, BASE_METADATA);
    const match = failures.find((f) => f.rule.includes('ENTITY'));
    expect(match).toBeDefined();
    expect(match?.severity).toBe('block');
  });

  // ── 4. §10 — AGENT_VERSION comment ausente ────────────────────────────────

  it('failure §10 Check 1: sin AGENT_VERSION comment → block', () => {
    const html = makeValidHtml({ omitAgentVersionComment: true });
    const failures = validateHtmlChecklist(html, BASE_METADATA);
    const match = failures.find((f) => f.rule.includes('AGENT_VERSION'));
    expect(match).toBeDefined();
    expect(match?.severity).toBe('block');
  });

  // ── 5. §1.6 — vocabulario prohibido ───────────────────────────────────────

  it('failure §1.6 Check 15: "Élite" en cuerpo → block', () => {
    const html = makeValidHtml({ injectForbiddenWord: '<p>Reporte Élite financiero</p>' });
    const failures = validateHtmlChecklist(html, BASE_METADATA);
    const match = failures.find((f) => f.rule.includes('vocabulario prohibido'));
    expect(match).toBeDefined();
    expect(match?.severity).toBe('block');
    expect(match?.detail).toContain('Élite');
  });

  it('failure §1.6 Check 15: "Premium" en cuerpo → block', () => {
    const html = makeValidHtml({ injectForbiddenWord: '<p>Servicio Premium para clientes</p>' });
    const failures = validateHtmlChecklist(html, BASE_METADATA);
    const match = failures.find((f) => f.rule.includes('vocabulario prohibido'));
    expect(match).toBeDefined();
    expect(match?.detail).toContain('Premium');
  });

  it('failure §1.6 Check 15: "Excepcional" en cuerpo → block', () => {
    const html = makeValidHtml({
      injectForbiddenWord: '<p>Resultado Excepcional del ejercicio</p>',
    });
    const failures = validateHtmlChecklist(html, BASE_METADATA);
    const match = failures.find(
      (f) => f.rule.includes('vocabulario prohibido') && f.detail.includes('Excepcional'),
    );
    expect(match).toBeDefined();
    expect(match?.severity).toBe('block');
  });

  // ── 6. §11 — hash SHA-256 ausente ─────────────────────────────────────────

  it('failure §11 Check 13: sin hash SHA-256 → block', () => {
    const html = makeValidHtml({ omitHash: true });
    const failures = validateHtmlChecklist(html, BASE_METADATA);
    const match = failures.find((f) => f.rule.includes('hash SHA-256'));
    expect(match).toBeDefined();
    expect(match?.severity).toBe('block');
  });

  // ── 7. §11 — Limitaciones de Información ausente en LINEA_BASE ────────────

  it('failure §11 Check 11: LINEA_BASE sin sección "Limitaciones" → block', () => {
    const html = makeValidHtml({ omitLimitaciones: true });
    const failures = validateHtmlChecklist(html, BASE_METADATA);
    const match = failures.find((f) => f.rule.includes('Limitaciones de Información'));
    expect(match).toBeDefined();
    expect(match?.severity).toBe('block');
  });

  // ── 8. §1.8 — bloque "Cómo se construyó este informe" ausente ─────────────

  it('failure §1.8 Check 12: sin bloque "Cómo se construyó" → block', () => {
    const html = makeValidHtml({ omitHowBuilt: true });
    const failures = validateHtmlChecklist(html, BASE_METADATA);
    const match = failures.find((f) => f.rule.includes('Cómo se construyó'));
    expect(match).toBeDefined();
    expect(match?.severity).toBe('block');
  });

  // ── 9. §1.2 — $0 huérfanos sin nota ──────────────────────────────────────

  it('failure §1.2 Check 6: $0 huérfano sin nota → block', () => {
    const html = makeValidHtml({ injectOrphanZero: true });
    const failures = validateHtmlChecklist(html, BASE_METADATA);
    const match = failures.find((f) => f.rule.includes('$0 huérfanos'));
    expect(match).toBeDefined();
    expect(match?.severity).toBe('block');
  });

  // ── 10. §6 — paleta sin oro (v10.1) ──────────────────────────────────────

  it('failure §6 Check 16: token --gold detectado → block', () => {
    const html = makeValidHtml({ injectGoldToken: '--gold: #C49A2E;' });
    const failures = validateHtmlChecklist(html, BASE_METADATA);
    const match = failures.find((f) => f.rule.includes('paleta sin oro'));
    expect(match).toBeDefined();
    expect(match?.severity).toBe('block');
  });

  it('failure §6 Check 16: hex #C49A2E detectado → block', () => {
    const html = makeValidHtml({ injectGoldToken: '--brand-color: #C49A2E;' });
    const failures = validateHtmlChecklist(html, BASE_METADATA);
    const match = failures.find((f) => f.detail.includes('#C49A2E'));
    expect(match).toBeDefined();
    expect(match?.severity).toBe('block');
  });

  // ── 11. §7 — sin Plus Jakarta Sans (es v8.1 leak) ────────────────────────

  it('failure §7 Check 17: Plus Jakarta Sans detectada → block', () => {
    const html = makeValidHtml({ injectPlusJakarta: true });
    const failures = validateHtmlChecklist(html, BASE_METADATA);
    const match = failures.find((f) => f.rule.includes('sin Plus Jakarta Sans'));
    expect(match).toBeDefined();
    expect(match?.severity).toBe('block');
  });

  // ── 12. §10 — aspect-ratio 16/9 es v8.1 leak ──────────────────────────────

  it('failure §10 Check 18: aspect-ratio 16/9 detectado → block', () => {
    const html = makeValidHtml({ injectAspectRatio16x9: true });
    const failures = validateHtmlChecklist(html, BASE_METADATA);
    const match = failures.find((f) => f.rule.includes('aspect-ratio v8.1'));
    expect(match).toBeDefined();
    expect(match?.severity).toBe('block');
  });

  // ── 13. §3 Check 4 — título resumen ejecutivo incorrecto ──────────────────

  it('failure §3 Check 4: TRANSICION con título de LINEA_BASE → block', () => {
    const metadataTransicion: HtmlEditorMetadata = {
      ...BASE_METADATA,
      reportMode: 'TRANSICION',
    };
    const html = makeValidHtml({ reportMode: 'TRANSICION' });
    // El fixture trae "El ejercicio 2025 en cifras" (LINEA_BASE) — incorrecto para TRANSICION
    const failures = validateHtmlChecklist(html, metadataTransicion);
    const match = failures.find((f) => f.rule.includes('título resumen ejecutivo'));
    expect(match).toBeDefined();
    expect(match?.severity).toBe('block');
  });

  // ── 14. Modo COMPARATIVO_COMPLETO — no requiere Limitaciones ──────────────

  it('modo COMPARATIVO_COMPLETO: ausencia de Limitaciones NO dispara failure', () => {
    const metadataComp: HtmlEditorMetadata = {
      ...BASE_METADATA,
      reportMode: 'COMPARATIVO_COMPLETO',
    };
    const html = makeValidHtml({
      omitLimitaciones: true,
      reportMode: 'COMPARATIVO_COMPLETO',
    });
    const failures = validateHtmlChecklist(html, metadataComp);
    const match = failures.find((f) => f.rule.includes('Limitaciones de Información'));
    expect(match).toBeUndefined();
  });

  // ── 15. Múltiples fallos acumulados ───────────────────────────────────────

  it('HTML con múltiples violaciones → múltiples failures acumulados', () => {
    const html = makeValidHtml({
      omitReportModeComment: true,
      omitHash: true,
      injectForbiddenWord: '<p>Robusto reporte financiero</p>',
    });
    const failures = validateHtmlChecklist(html, BASE_METADATA);
    const blockFailures = failures.filter((f) => f.severity === 'block');
    expect(blockFailures.length).toBeGreaterThanOrEqual(3);
  });

  // ── 16. Hash correcto en metadata y HTML → no dispara failure ─────────────

  it('hash correcto en HTML y metadata → sin failure §13', () => {
    const html = makeValidHtml();
    const failures = validateHtmlChecklist(html, BASE_METADATA);
    const match = failures.find((f) => f.rule.includes('hash SHA-256'));
    expect(match).toBeUndefined();
  });

  // ── 17. Metadata con hash diferente → failure §13 ─────────────────────────

  it('failure §13: metadata con hash diferente al declarado en HTML → block', () => {
    const html = makeValidHtml();
    const metaDifferentHash: HtmlEditorMetadata = {
      ...BASE_METADATA,
      reportHashSha256: 'b'.repeat(64),
    };
    const failures = validateHtmlChecklist(html, metaDifferentHash);
    const match = failures.find((f) => f.rule.includes('hash SHA-256'));
    expect(match).toBeDefined();
    expect(match?.severity).toBe('block');
  });
});
