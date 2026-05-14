# Wave 7 — Spec v2.1 Parte IV (4 dictámenes) + Parte V (Meta-auditoría 12 dims) (2026-05-13)

La spec v2.1 (`docs/spec/financial-pipeline-v2.1.md`) se amplía con dos secciones nuevas:

- **Parte IV — Auditoría Especializada**: cada uno de los 4 auditores (NIIF, Tributario, Legal, Fiscal) emite un dictamen con estructura editorial fija (alcance numerado, checklist canónica, opinión seleccionada, acciones requeridas) y formato visual ASCII-boxed (`═══`).
- **Parte V — Meta-auditoría de Calidad**: el Quality Meta-Auditor expone una subvista de 12 dimensiones agrupadas en bloques A (ISO 25012) / B (ISO 42001) / C (IASB Conceptual Framework), score 0–10 por dimensión, score global promedio, y un sello de calidad final (`✅ certificada ≥ 8.0` / `⚠ con observaciones 6.0–7.9` / `❌ requiere corrección < 6.0`).

## Arquitectura

Cada agente sigue emitiendo JSON validado por Zod (contrato existente). El formato visual ASCII-boxed lo produce el **renderer determinista** de cada slot — el LLM no compone ASCII.

### Parte IV — schemas extendidos (additive only)

`src/lib/agents/financial/contracts/audit-report.ts` agrega campos nullable a los 4 schemas existentes:

- **`NiifAuditReportSchema`** → `niifSectionChecks` (13 entradas: secciones 3, 4, 5, 6, 7, 8, 11, 13, 17, 23, 28, 29, 32), `summaryStats`, `auditOpinion`, `requiredActions`.
- **`TaxAuditReportSchema`** → 8 sub-bloques (`rentaAnalysis`, `retencionesAnalysis`, `ivaIcaAnalysis`, `tmtAnalysis`, `riesgosTributarios`, `calendario2026`, `auditOpinion`, `requiredActions`).
- **`LegalAuditReportSchema`** → `societaryObligations` (14 entradas en orden fijo), `patrimonyDistribution`, `capitalizacionAnalysis`, `riesgosLegales`, `auditOpinion`, `requiredActions`.
- **`FiscalReviewReportSchema`** → `formalObligations` (10 entradas), `criticalSaldos`, `dianRiskIndicators` (6 indicadores), `riesgoFiscalizacionGlobal`, `obligations2026`, `fiscalAuditOpinion`, `fiscalRequiredActions`. **Importante:** el bloque NIA-700/706 legacy (`opinionType`, `materiality`, `goingConcern`, `dictamen`) se conserva intacto. El Fiscal Reviewer ahora emite ambos en su `fullContent`: primero el "Dictamen 4 — Auditor Fiscal" v2.1 (riesgo DIAN accionable), después el dictamen formal NIA-700 con bloque de firma literal.

Todos los campos nuevos son `.nullable()` por contrato Zod strict mode 2026. Cuando el agente no puede inferir el valor, emite `null`; el renderer imprime "— Dato no suministrado".

Cada `renderMarkdown` por auditor sigue siendo privado dentro de su archivo (`niif-auditor.ts`, `tax-auditor.ts`, etc.) y produce el formato v2.1 cuando `hasV21Structure` detecta cualquier campo poblado, con fallback al render legacy.

### Parte V — Quality v2.1 subvista (no rompe contrato de 14 dims)

El `QualityReportSchema` interno mantiene las 14 dimensiones D1..D14. La subvista v2.1 se deriva determinísticamente del JSON existente:

- **`src/lib/agents/financial/quality/v21-mapping.ts`** (nuevo):
  - `QUALITY_V21_DIM_META`: tabla constante con las 12 dimensiones v2.1 (num, bloque A/B/C, nombre, framework, definición, verificación). Las prosas son contractuales, hard-coded.
  - `buildQualityV21View(json: QualityReportJson): QualityV21View`: pure function. Devuelve `dimensions: QualityV21Dimension[]` (12 entradas con `scoreInt0to10 = round(internalScore / 10)` y `status: 'aprobado' | 'en_revision' | 'requiere_correccion'`), `globalScoreInt0to10` (promedio aritmético), `sello` (tipo + título + bottom line), `correctiveActions` (solo dims con `scoreInt0to10 < 7`).
  - Mapeo 14 → 12:
    | v2.1 # | Bloque | Nombre | Fuente |
    |---|---|---|---|
    | 1 | A | Exactitud | D2 |
    | 2 | A | Completitud | D1 |
    | 3 | A | Consistencia | D3 |
    | 4 | A | Actualidad | D14 |
    | 5 | B | Trazabilidad IA | D8 |
    | 6 | B | Transparencia | `D9*0.9 + D6*0.1` (composite) |
    | 7 | B | Sesgo y neutralidad | D9 |
    | 8 | B | Responsabilidad humana | D10 |
    | 9 | C | Relevancia | D6 |
    | 10 | C | Representación fiel | D4 |
    | 11 | C | Comprensibilidad | D11 |
    | 12 | C | Comparabilidad | `(D14 + D12) / 2` (composite) |
  - Fallback en cascada cuando una D-dim interna no existe: lookup secundario en `aiGovernance` / `dataQuality` / `ifrs18Readiness`; default 7/10 con punto "Dato incompleta" si no hay fuente.

- **`src/lib/agents/financial/quality/agent.ts`** (`renderMarkdown` reescrito):
  - Primero emite el formato v2.1 (banner `╔══╗`, 3 bloques `┌──┐` con 4 DIM cada uno, tabla resumen de 12 filas + score global, sello, acciones correctivas).
  - Después emite un **`## APÉNDICE`** con el bloque legacy de 14 dimensiones + métricas ISO 25012 / 42001 / IFRS 18 raw. Esto preserva el contrato downstream (PDF Élite y dashboards que parsean los scores raw siguen funcionando).
  - `__test_renderMarkdown` alias exportado para tests unitarios sin invocar al LLM.

### Consolidador del audit

`src/lib/agents/financial/audit/orchestrator.ts:buildConsolidatedAuditReport` ahora envuelve los 4 `fullContent` (que ya vienen formateados v2.1 por cada auditor) en una **frame ASCII v2.1**: banner superior, executive summary, matriz de findings por severidad, los 4 bloques per-auditor concatenados, banner inferior. El signature de la función no cambia.

## Validación al integrarse

- `npx tsc --noEmit`: clean
- `npm run lint:strict-mode`: All contracts pass strict mode lint.
- `npx vitest run`: **770/770** (baseline pre-Wave-7 era 660; los 3 teams aportaron +110 tests).
- `npx vitest run --config vitest.integration.config.ts`: 8/8.

## Commits (orden de aplicación en `main`)

1. `697aaef` — `docs(spec): Wave 7 — Parte IV + Parte V` (contrato authoritative).
2. `aa1927e` — Wave 7.A1 NIIF auditor.
3. `7257980` — Wave 7.A2 Tax auditor.
4. `da03f1b` — Wave 7.B1 Legal auditor.
5. `c59757f` — Wave 7.B2 Fiscal auditor.
6. `a1e2cd7` — Wave 7.C1 mapping helper.
7. `84aaab4` — Wave 7.C2 quality renderer v2.1 + sello.
8. `432b3b9` — Wave 7.C3 consolidator wrapped en v2.1 frame.

Auto-merge limpio en `contracts/audit-report.ts` (Teams A y B editaron schemas disjuntos del mismo archivo).

## Lo que NO cambió (contract con consumers downstream)

- `runAuditOrchestrator()` y `runQualityAuditor()` mantienen la misma firma pública.
- El PDF Élite (`src/lib/export/pdf-elite-react/compose.ts`) sigue consumiendo `AuditReport` y `QualityAssessment` con los mismos campos; los nuevos campos v2.1 son nullable y opt-in.
- El HTML Editor v8.1 NO consume audit ni quality (siguen siendo Phase 2 / Phase 3 independientes).
- El follow-up chat (`ReportFollowUpChat.tsx`) sigue leyendo `consolidatedReport` y `fullReport` (ahora con el wrapper v2.1).
- El bloque NIA-700/706 del Fiscal Reviewer (con `dictamen` formal + bloque de firma literal) se mantiene intacto al final del `fullContent` después del dictamen v2.1 — el documento legalmente firmable no se contamina.

## Cuando rompa en producción (runbook)

1. **Output truncado en cualquier auditor** → `/api/admin/telemetry?hours=1` y revisar `unclean_finish_rate` por auditor. Los slots actuales (`niifAuditor`, `taxAuditor`, `legalAuditor: 6000`, `fiscalReviewer: 8000` `maxOutputTokens`) son el primer lugar a bumpear cuando el dictamen v2.1 satura el budget.
2. **Sello de calidad anómalo** (e.g. todas las dims caen a 7/10) → probable fallback de mapeo: los D-dims del JSON interno no traen el prefijo `D<n>` esperado. Verificar `QualityDimensionSchema.name` upstream — el prompt del Quality Meta-Auditor debe emitirlas con prefijo. `__test_renderMarkdown` permite reproducir el caso localmente.
3. **Render v2.1 falta y aparece legacy** → `hasV21Structure` no detecta ningún campo poblado. El agente correspondiente devolvió todos los nuevos campos como `null`. Revisar el `<success_criteria>` del prompt: la regla "emite cada checklist incluso si todo es conforme" puede no estar enforced.
4. **Tablas de fingidos en el dictamen** → el LLM inventó cifras a pesar de `null`. El renderer NO valida cifras (solo formatea); validación semántica es responsabilidad del prompt + del auditor humano que firma.
5. **Auto-merge falla al rebasar Wave 7 sobre cambios concurrentes en `audit-report.ts`** → cada auditor agrega sus sub-schemas justo antes de la definición del schema principal. Los conflictos esperados son additive y se resuelven concatenando los bloques.

## Reversibilidad

Cada commit Wave 7 es revertible individualmente sin tocar los demás (verificado: ningún commit depende de otro a nivel de tipo). Para un revert completo de Wave 7 manteniendo el spec doc como referencia futura: `git revert 432b3b9 84aaab4 a1e2cd7 c59757f da03f1b 7257980 aa1927e`. El commit `697aaef` del spec doc se puede mantener — los teams futuros lo seguirán como contrato.
