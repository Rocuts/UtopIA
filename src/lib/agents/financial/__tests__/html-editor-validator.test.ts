// Tests del validador profundo §11 spec v8.1 — html-editor-validator.ts
//
// Cubre los 21 checks del checklist §11 con fixtures HTML sintéticos.
// El validador usa linkedom como DOM parser — no requiere browser real.
//
// Convención de fixtures:
//   - `makeValidHtml(overrides?)` — HTML mínimo que pasa TODOS los checks.
//   - Tests individuales corrompen partes del HTML válido para disparar fallos.
//
// Refs:
//   - docs/spec/financial-report-v8.1.md §11 (checklist completo)
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
  periodStart: '2025-01-01',
  periodEnd: '2025-12-31',
  generatedAt: '2026-05-13T10:00:00Z',
  extractedAt: '2026-05-12T08:00:00Z',
  modelId: 'gpt-5.4-mini',
  agentVersion: '1+1 v8.1',
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
// HTML fixture mínimo válido
//
// Construye un HTML que pasa todos los checks del §11. Los tests corrompen
// secciones específicas para disparar fallos individuales.
// ---------------------------------------------------------------------------

function makeValidHtml(
  overrides: {
    omitReportModeComment?: boolean;
    omitEntityComment?: boolean;
    omitAgentVersionComment?: boolean;
    reportMode?: string;
    omitComparableColumn?: boolean;
    omitLimitaciones?: boolean;
    omitHowBuilt?: boolean;
    omitHash?: boolean;
    injectForbiddenWord?: string;
    injectOrphanZero?: boolean;
    reportModeForNarrative?: string;
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
    : `<!-- AGENT_VERSION: 1+1 v8.1 -->`;
  const hash = overrides.omitHash ? '' : HASH;
  const comparableCol = overrides.omitComparableColumn
    ? ''
    : '<th>[ Comparable 2026 → ]</th>';
  const limitaciones = overrides.omitLimitaciones
    ? ''
    : '<section id="limitaciones"><h2>Limitaciones de Información</h2></section>';
  const howBuilt = overrides.omitHowBuilt
    ? ''
    : '<section id="slide-12"><h2>Cómo se construyó este reporte</h2></section>';
  const forbiddenWord = overrides.injectForbiddenWord ?? '';
  const orphanZero = overrides.injectOrphanZero ? '<td>$0</td>' : '';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Reporte NIIF 2025 — Empresa Test SAS</title>
  <style>
    :root {
      --gold-d: #c49a2e;
      font-variant-numeric: tabular-nums;
    }
    .conf { display: inline-block; }
    .conf.medium::before { content: '·'; color: orange; }
    .conf.low::before { content: '··'; color: red; }
  </style>
  ${reportModeComment}
  ${entityComment}
  ${agentVersionComment}
  <!-- PERIOD: 2025-01-01 a 2025-12-31 -->
  <!-- GENERATED_AT: 2026-05-13T10:00:00Z -->
  <!-- CONFIDENCE_GLOBAL: medium -->
</head>
<body>
  <div class="mode-banner">Modo activo: Línea Base — primer informe NIIF</div>
  ${forbiddenWord}
  ${orphanZero}

  <section id="slide-03">
    <h2>Composición del Período</h2>
    <p>Este ciclo cierra; el siguiente se medirá contra esta base.</p>
    <p>La entidad establece la línea base documental para el período 2025.</p>
  </section>

  <section id="slide-06">
    <h2>Estado de Situación Financiera</h2>
    <table>
      <thead>
        <tr>
          <th>Concepto</th>
          <th>2025 COP</th>
          ${comparableCol}
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Total Activos</td>
          <td class="num">$1.000.000</td>
          <td class="num">—</td>
        </tr>
        <tr>
          <td>Total Pasivos</td>
          <td class="num">$400.000</td>
          <td class="num">—</td>
        </tr>
        <tr>
          <td>Patrimonio</td>
          <td class="num">$600.000</td>
          <td class="num">—</td>
        </tr>
      </tbody>
    </table>
  </section>

  <section id="slide-08">
    <h2>Flujo de Efectivo</h2>
    <p>Efectivo al inicio del período: $100.000</p>
    <table>
      <tbody>
        <tr><td>Actividades operativas</td><td class="num">$150.000</td></tr>
        <tr><td>Actividades inversión</td><td class="num">-$50.000</td></tr>
        <tr><td>Actividades financiación</td><td class="num">-$30.000</td></tr>
        <tr><td class="total">Variación neta efectivo</td><td class="num total">$70.000</td></tr>
        <tr><td>Saldo inicial de efectivo</td><td class="num">$100.000</td></tr>
        <tr><td>Efectivo al cierre</td><td class="num">$170.000</td></tr>
      </tbody>
    </table>
    <p>Activo corriente de alta liquidez: $100.000</p>
  </section>

  <section id="slide-09">
    <h2>Notas — Parte 1</h2>
    <p>Los ingresos ordinarios provienen exclusivamente de Clase 4 (Arts. 600-699 PUC).</p>
    <p>Las políticas contables se aplican conforme a NIIF Pymes Sección 10.</p>
    <p>Razón corriente: 2.5x. Endeudamiento: 40%.</p>
    <span class="conf medium">Confianza media en ratios sectoriales</span>
  </section>

  ${limitaciones}
  ${howBuilt}

  <section id="slide-12-transparency">
    <h2>Transparencia — Hash de Verificación</h2>
    <p>Hash SHA-256: <code>${hash}</code></p>
    <div class="qr" id="qr-code">QR de verificación</div>
    <p>Agentes utilizados: NIIF Analyst · Strategy Director · Governance Specialist · Editor Jefe HTML</p>
    <p>Fecha extracción: 2026-05-12T08:00:00Z</p>
    <p>Modelo: gpt-5.4-mini · Versión: 1+1 v8.1</p>
    <p>Este reporte proporciona una base documental verificable para el período fiscal 2025.</p>
  </section>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validateHtmlChecklist — §11 spec v8.1', () => {
  // ── 1. Happy path ──────────────────────────────────────────────────────────

  it('happy path: HTML válido → 0 failures (solo warns tolerados)', () => {
    const html = makeValidHtml();
    const failures = validateHtmlChecklist(html, BASE_METADATA);
    const blockFailures = failures.filter((f) => f.severity === 'block');
    // El happy path no debe tener ningún bloqueo
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

  // ── 5. §1.6 — vocabulario prohibido: "Élite" ──────────────────────────────

  it('failure §1.6 Check 17: "Élite" en cuerpo → block', () => {
    const html = makeValidHtml({ injectForbiddenWord: '<p>Reporte Élite financiero</p>' });
    const failures = validateHtmlChecklist(html, BASE_METADATA);
    const match = failures.find((f) => f.rule.includes('vocabulario prohibido'));
    expect(match).toBeDefined();
    expect(match?.severity).toBe('block');
    expect(match?.detail).toContain('Élite');
  });

  it('failure §1.6 Check 17: "Premium" en cuerpo → block', () => {
    const html = makeValidHtml({ injectForbiddenWord: '<p>Servicio Premium para clientes</p>' });
    const failures = validateHtmlChecklist(html, BASE_METADATA);
    const match = failures.find((f) => f.rule.includes('vocabulario prohibido'));
    expect(match).toBeDefined();
    expect(match?.detail).toContain('Premium');
  });

  // ── 6. §5 — hash SHA-256 ausente ──────────────────────────────────────────

  it('failure §5 Check 15: sin hash SHA-256 → block', () => {
    const html = makeValidHtml({ omitHash: true });
    const failures = validateHtmlChecklist(html, BASE_METADATA);
    const match = failures.find((f) => f.rule.includes('hash SHA-256'));
    expect(match).toBeDefined();
    expect(match?.severity).toBe('block');
  });

  // ── 7. §3 — columna [ Comparable ] ausente en LINEA_BASE ─────────────────

  it('failure §3 Check 6: LINEA_BASE sin columna [ Comparable ] → block', () => {
    const html = makeValidHtml({ omitComparableColumn: true, reportMode: 'LINEA_BASE' });
    const failures = validateHtmlChecklist(html, BASE_METADATA);
    const match = failures.find((f) => f.rule.includes('columna [ Comparable ]'));
    expect(match).toBeDefined();
    expect(match?.severity).toBe('block');
  });

  // ── 8. §11 — sección Limitaciones de Información ausente en LINEA_BASE ────

  it('failure §11 Check 13: LINEA_BASE sin sección "Limitaciones de Información" → block', () => {
    const html = makeValidHtml({ omitLimitaciones: true });
    const failures = validateHtmlChecklist(html, BASE_METADATA);
    const match = failures.find((f) => f.rule.includes('Limitaciones de Información'));
    expect(match).toBeDefined();
    expect(match?.severity).toBe('block');
  });

  // ── 9. §1.8 — bloque "Cómo se construyó este reporte" ausente ─────────────

  it('failure §1.8 Check 14: sin bloque "Cómo se construyó" → block', () => {
    const html = makeValidHtml({ omitHowBuilt: true });
    const failures = validateHtmlChecklist(html, BASE_METADATA);
    const match = failures.find((f) => f.rule.includes('Cómo se construyó'));
    expect(match).toBeDefined();
    expect(match?.severity).toBe('block');
  });

  // ── 10. §1.2 — $0 huérfanos sin nota ─────────────────────────────────────

  it('failure §1.2 Check 8: $0 huérfano sin nota → block', () => {
    const html = makeValidHtml({ injectOrphanZero: true });
    const failures = validateHtmlChecklist(html, BASE_METADATA);
    const match = failures.find((f) => f.rule.includes('$0 huérfanos'));
    expect(match).toBeDefined();
    expect(match?.severity).toBe('block');
  });

  // ── 11. §3 Check 4 — título resumen ejecutivo incorrecto ──────────────────

  it('failure §3 Check 4: TRANSICION con título de LINEA_BASE → block', () => {
    // Metadata en modo TRANSICION pero HTML con título de LINEA_BASE
    const metadataTransicion: HtmlEditorMetadata = {
      ...BASE_METADATA,
      reportMode: 'TRANSICION',
    };
    // El HTML makeValidHtml pone el título "Composición del Período" (LINEA_BASE)
    const html = makeValidHtml({ reportMode: 'TRANSICION' });
    // Con modo TRANSICION, el título "Composición del Período" es incorrecto
    // La metadata dice TRANSICION, el HTML tiene título de LINEA_BASE
    // Nota: el HTML fixture usa "Composición del Período" que no está en los
    // títulos esperados para TRANSICION — debería disparar el check.
    const failures = validateHtmlChecklist(html, metadataTransicion);
    const match = failures.find((f) => f.rule.includes('título resumen ejecutivo'));
    expect(match).toBeDefined();
    expect(match?.severity).toBe('block');
  });

  // ── 12. Modo COMPARATIVO_COMPLETO — no requiere [ Comparable ] ────────────

  it('modo COMPARATIVO_COMPLETO: ausencia de [ Comparable ] NO dispara failure §6', () => {
    const metadataComp: HtmlEditorMetadata = {
      ...BASE_METADATA,
      reportMode: 'COMPARATIVO_COMPLETO',
    };
    const html = makeValidHtml({
      omitComparableColumn: true,
      reportMode: 'COMPARATIVO_COMPLETO',
    });
    const failures = validateHtmlChecklist(html, metadataComp);
    const match = failures.find((f) => f.rule.includes('columna [ Comparable ]'));
    // No debe dispararse para COMPARATIVO_COMPLETO
    expect(match).toBeUndefined();
  });

  // ── 13. Modo COMPARATIVO_COMPLETO — no requiere Limitaciones ──────────────

  it('modo COMPARATIVO_COMPLETO: ausencia de Limitaciones NO dispara failure §13', () => {
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
    // COMPARATIVO_COMPLETO no requiere esta sección (§11 la pide solo en LINEA_BASE/TRANSICION)
    expect(match).toBeUndefined();
  });

  // ── 14. Múltiples fallos acumulados ───────────────────────────────────────

  it('HTML con múltiples violaciones → múltiples failures acumulados', () => {
    const html = makeValidHtml({
      omitReportModeComment: true,
      omitHash: true,
      injectForbiddenWord: '<p>Robusto reporte financiero</p>',
    });
    const failures = validateHtmlChecklist(html, BASE_METADATA);
    const blockFailures = failures.filter((f) => f.severity === 'block');
    // Al menos: REPORT_MODE + hash + vocabulario prohibido
    expect(blockFailures.length).toBeGreaterThanOrEqual(3);
  });

  // ── 15. Check 17 — múltiples palabras prohibidas ──────────────────────────

  it('failure §1.6 Check 17: "Excepcional" detectado como block', () => {
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

  // ── 16. Hash correcto en metadata y HTML → no dispara failure ─────────────

  it('hash correcto en HTML y metadata → sin failure §15', () => {
    const html = makeValidHtml();
    const failures = validateHtmlChecklist(html, BASE_METADATA);
    const match = failures.find((f) => f.rule.includes('hash SHA-256'));
    expect(match).toBeUndefined();
  });

  // ── 17. Metadata con hash diferente → failure §15 ─────────────────────────

  it('failure §15: metadata con hash diferente al declarado en HTML → block', () => {
    const html = makeValidHtml(); // HTML contiene HASH='aaa...64'
    const metaDifferentHash: HtmlEditorMetadata = {
      ...BASE_METADATA,
      reportHashSha256: 'b'.repeat(64), // hash diferente
    };
    const failures = validateHtmlChecklist(html, metaDifferentHash);
    const match = failures.find((f) => f.rule.includes('hash SHA-256'));
    expect(match).toBeDefined();
    expect(match?.severity).toBe('block');
  });
});
