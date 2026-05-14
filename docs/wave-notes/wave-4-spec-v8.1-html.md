# Wave 4 — Spec v8.1 + Editor Jefe HTML (2026-05-13)

La especificación normativa del agente generador de reporte HTML 1+1 vive en **`docs/spec/financial-report-v8.1.md`**. Cuando un prompt o regla entre en conflicto con ese doc, el doc gana. Citar por número de Sección en commits/PRs.

## Reglas editoriales v8.1 integradas en los 3 agentes existentes

- **Modos del reporte** (§2 spec): `LINEA_BASE` / `TRANSICION` / `COMPARATIVO_COMPLETO`. Derivados por `deriveReportMode(preprocessed)` en `v8-helpers.ts` y propagados vía `prepareFinancialContext` → `runNiifPhase` / `runStrategyPhase` / `runGovernancePhase`. Cada prompt cambia verbos, layout y secciones según el modo.
- **Verbos prohibidos por modo** (§3 spec): en LINEA_BASE `mejoró`/`creció`/`aumentó`/`se redujo`/`evolucionó`/`varió respecto a` son falsos sin referencia previa. Los 3 prompts (NIIF, Strategy, Governance) los prohíben.
- **Vocabulario marketing prohibido** (§1.6): `Élite`, `Excelencia`, `Premium`, `Excepcional`, `Único`, `Mejor`, `Sólido`, `Robusto`, `Extraordinario`. NIIF Analyst renombró internamente "R-Élite" → "Regla R N". Governance Specialist amplió `FORBIDDEN_EVASIVE_PHRASES` con 9 patrones regex Unicode-aware (no `\b` plain — falla con tildes).
- **Confianza por cifra** (§1.5): `confidence: 'high' | 'medium' | 'low'` nullable en `StatementLineSchema`, `KpiSchema`, `FinancialNoteSchema`. Editor Jefe HTML renderiza dot `.conf.medium` / `.conf.low` adjacente al número cuando aplica.
- **Anomaly flag 2σ banda sectorial CIIU** (§1.3): `AnomalyFlagSchema` con `severity / message / normaRef / benchmarkBand { lowerBound, upperBound, observed }`. Strategy Director emite cuando KPI cae fuera de 2σ del benchmark sectorial.
- **Anti-`$0` huérfanos** (§1.2): líneas con monto 0 sin nota explicativa se OMITEN. Si el cero es materialmente significativo, va con nota citando norma.
- **EFE degeneracy flag** (§5 Slide 08): si el método indirecto produce ≥6 líneas en cero, `cashFlow.degeneracyFlag='indirect_method_unreliable'` con methodNote literal NIC 7 §18 + NIA 705 §7.

## Editor Jefe HTML — agente nuevo al final del pipeline

Cuarto agente del pipeline 1+1. Consume los 3 JSONs (NIIF + Strategy + Governance) + metadata pre-cocinada y produce HTML 12-slide auto-contenido (`aspect-ratio: 16/9`, `max-width: 1440px`, Plus Jakarta Sans, CSS embedded).

**Endpoint:** `POST /api/financial-report/html` con SSE (events: `progress` / `html_phase` / `done` / `error`). `maxDuration = 800`.

**Archivos clave:**
- `src/lib/agents/financial/contracts/html-editor.ts` — `HtmlEditorInputSchema` + `HtmlEditorMetadataSchema` (hash SHA-256, coverage por clase PUC, globalConfidence bucket, sectorCIIU).
- `src/lib/agents/financial/prompts/html-editor.prompt.ts` — `buildHtmlEditorSystemPrompt()` carga `docs/spec/financial-report-v8.1.md` VERBATIM (memoización proceso-local, cache hit rate ~95%).
- `src/lib/agents/financial/agents/html-editor.ts` — `runHtmlEditor()` con `generateText` directo (NO `callFinancialAgent` porque HTML no se valida con Zod). Linter post-emisión liviano cubre 3 checks críticos: §10 comments, §1.6 vocabulario, §5 Slide 12 hash.
- `src/lib/agents/financial/agents/html-editor-validator.ts` — validador profundo con `linkedom` (DOM parser server-side, ~30KB) ejecutando 21 checks §11. Severity `block` para críticos (hash, vocabulary, comments), `warn` para heurísticas (verbos contextual, ortografía sutil, contraste WCAG).
- `src/app/api/financial-report/html/route.ts` — endpoint SSE.
- `src/components/workspace/HtmlReportViewer.tsx` — iframe `sandbox="allow-same-origin"` (sin `allow-scripts`, anti-XSS) + botón "Descargar HTML" (blob download).
- `src/components/workspace/PipelineWorkspace.tsx` — botón "Generar HTML" en action bar del ReportViewer, post-Quality. Pre-cocinado de metadata cliente (Web Crypto subtle.digest para hash, walk recursivo del JSON para confidence + alerts).

**Modelo:** `MODELS.FINANCIAL_PIPELINE` (gpt-5.5 premium). Slot `htmlEditor` con `maxOutputTokens: 32000`, `reasoningEffort: 'medium'`, `textVerbosity: 'high'`.

**Integración:** post-Quality, opcional. PDF Élite legacy y HTML v8.1 coexisten — el usuario elige cuál descarga.

## Metadata pre-cocinada (frontend o backend)

Helpers determinísticos puros (sin LLM):
- `deriveReportMode(preprocessed): ReportMode` — árbol §2 spec.
- `summarizeCoverage(preprocessed): CoverageByClass[]` — auxiliares procesados por clase PUC + % del folio.
- `aggregateConfidence(payload): { highPct, mediumPct, lowPct }` — walk recursivo del JSON contando `confidence: 'high'|'medium'|'low'`.
- `computeReportHash(payload): string` — SHA-256 estable con keys ordenadas; en el frontend usa Web Crypto subtle.digest.

Estos garantizan que Slide 12 del HTML emita los metadatos auditables sin que el LLM los invente.

## Tests

660 tests en total (vs 544 baseline pre-Wave 4):
- v8-helpers.test.ts: 10 tests (deriveReportMode 5 / summarizeCoverage 2 / computeReportHash 3)
- html-editor-validator.test.ts: 17 tests (cada §11 check)
- html.route.test.ts: 7 tests (endpoint integration, mocks de runHtmlEditor)
- niif-analyst-chunked.integration.test.ts: +2 tests del hotfix comparativo (regression d18fccd)

## Hotfix regresión comparativo (d18fccd)

Bug encontrado durante Wave 4: tras Fase 3 chunked, `extractPass1Anchors` solo propagaba campos `*Primary` a Pass-2/Pass-3. El reasoning model gpt-5.5 leía `<previously_computed>`, no veía cifras comparativas, y null-eaba `amountComparative` en TODAS las líneas del Balance/P&L/EFE/ECP. Síntoma: reportes sin columna comparativa.

**Fix:** `PreviouslyComputedPass1Anchors` extendido con 7 campos `*Comparative`. `extractPass1Anchors` los propaga desde `pass1.balanceSheet.*Comparative` y `pass1.incomeStatement.*Comparative`. `renderPass1AnchorsBlock` emite "Anchors comparativos de Pass 1" con cifras explícitas o "N/A (sin comparativo)" cuando null — evita que el modelo interprete ausencia como autorización para null-ear todo.

**Cobertura:** 2 tests en `niif-analyst-chunked.integration.test.ts` validan que los anchors aparecen literales en los prompts downstream.

## Runbook — cuando rompa en producción

1. **HTML no se genera** — `/api/admin/telemetry?hours=1` busca agentName='html-editor'. Si `unclean_finish_rate > 0`, el output truncó. Subir `MODELS_CONFIG.htmlEditor.maxOutputTokens` de 32K a 48K. Si persiste, considerar opción B del A4 audit (JSON-por-slide + renderer TS).
2. **Reporte sin comparativo en producción** — verificar que `niifReport.balanceSheet.totalAssetsComparative !== null`. Si el JSON sí lo trae pero el HTML no, bug en el prompt v8.1 — el Editor Jefe HTML está null-eando. Si el JSON viene null, el bug está upstream en Pass-1 — verificar bindingTotals tiene "Periodo comparativo" en `buildBindingTotalsBlock`.
3. **HTML con vocabulario prohibido** — el linter post-emisión liviano debería detectarlo (severity `block`). Si pasa al cliente, el validador profundo linkedom F9 lo capturaría — verificar que se invoca downstream.
4. **HTML 12-slide layout roto** — los CSS tokens están en §6 spec verbatim. Si el LLM se desvía, refuerza con un constraint adicional en el system prompt referenciando `tl-tick.hero`, `stmt-table td.future`, etc.
5. **Reversibilidad:** Wave 4 está hecha de 13 commits incrementales. Cualquier issue puntual es revertible con `git revert` individualizado. El spec v8.1 sigue siendo authoritative independiente de qué commits caigan/se reviertan.
