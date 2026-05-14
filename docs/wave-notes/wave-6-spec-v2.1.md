# Wave 6 — Spec v2.1 (correcciones auditora externa, 2026-05-13)

Auditora contadora externa revisó un informe real generado por el pipeline 1+1 e identificó 9 correcciones (3 críticas, 4 moderadas, 2 presentación). Wave 6 las integra al codebase. Northstar: `docs/spec/financial-pipeline-v2.1.md`.

## Correcciones críticas

1. **Tablas Markdown reales** (`renderer.ts`) — los 4 renderers (`renderBalanceSheet`, `renderIncomeStatement`, `renderCashFlowStatement`, `renderEquityChanges`) ahora producen tablas Markdown verdaderas con header + separator alineado (`:---` / `---:`) + filas. Eliminado el formato inline pipe-separated que generaba `11 — Efectivo : $X | $Y` (el bug del 13-may-2026). Helper `buildMarkdownTable()` exportado.

2. **Asiento 3605 NUNCA en EFE** (Pass-2 prompt) — constraint absoluto: el traslado contable de utilidad a Cta.3605 es PURAMENTE CONTABLE, no flujo de efectivo. Si EFE no cuadra: ajustar variaciones de capital de trabajo o emitir `cashFlow.degeneracyFlag='indirect_method_unreliable'` (NIC 7 §18 + NIA 705 §7). NUNCA usar 3605 como comodín.

3. **ROE fórmula UNICA** (Strategy Director prompt) — el LLM MUST anclar a `controlTotals.roe` del binding (que ya computa con patrimonio promedio desde Wave 2.F4). Aplica IGUAL en KPIs, executiveDashboard, dupontAnalysis, trends, recommendations, projectedCashFlow.scenarios. CHECK auto-validable: `dupontAnalysis.roe == KPI ROE.resultPrimary`. LINEA_BASE usa patrimonio cierre (no hay comparativo), resto modos usan promedio.

## Correcciones moderadas

4. **Cascada impuesto Cta.1805** (Pass-1 prompt) — formato literal en `incomeStatement.lines` cuando se usa Cta.1805 (caso b) + nota obligatoria literal en `incomeStatement.notes`: *"El gasto de impuesto de renta del período corresponde a retenciones y anticipos registrados en Cta.1805..."*

5. **ECP saldo REAL de 3605** (Pass-2 prompt) — el ECP usa `saldo3605 = totalEquityPrimary − saldoCta3710`, NO `netIncomePrimary` directamente. Diferencia atribuible a Cta.3710 (convergencia NIIF) se documenta en `equityChanges.notes`.

6. **Numeración secuencial de notas** (Governance prompt) — `financialNotes[]` se numera 1, 2, 3, ... contiguos. Si nota canónica no aplica, OMITIR + renumerar consecutivamente. NEVER saltar números (e.g. pasar de Nota 6 a Nota 8).

7. **NO "Notas internas del preparador"** (Pass-3 + Governance prompts) — NEVER emitir secciones de proceso AI ni "Notas internas". Limitaciones reales van EXCLUSIVAMENTE en sección "Limitaciones de Información" o `disclaimers[]` Wave 2.F3.

## Correcciones de presentación

8. **NO metadatos internos en output** (renderer + html-editor linter) — `lightweightChecklist` ampliado con `FORBIDDEN_METADATA_PATTERNS`: `Pass-1/2/3`, `anchors`, `curatorFlags`, `netIncomePrimary`, `totalAssetsPrimary`, `ecpClosingTotal`, cifras en centavos crudos (`\d{10,}\s*centavos`). Cifras siempre formato es-CO `$X.XXX.XXX,XX`.

9. **Defensa Art.647 ET en UNA sola nota consolidada** (Pass-3 prompt) — reemplaza el patrón "sub-nota por cada curator rule" (R1, R5, R6, R7, R-Élite 3.b, R-Élite 4 = 6 repeticiones casi idénticas en el output real) por UNA SOLA nota al final con label literal "Diferencias de criterio contable (Art.647 E.T.)" y body LITERAL prescrito. MÁXIMO 1 nota Defensa Art.647 en TODO `technicalNotes`.

## Commits Wave 6

- `cd637be` — Spec v2.1 northstar (auditora externa)
- `f3caa81` F2 — Strategy Director ROE consistente
- `fe099a0` F3 — Governance numeración + cleanup
- `aa186da` F1 — NIIF Analyst (5 correcciones)
- `41a420c` F4 — Renderer tablas Markdown + cleanup metadatos

## Validación

- `npx tsc --noEmit`: exit 0
- `npx vitest run`: 660/660 verde
- `npx vitest run --config vitest.integration.config.ts`: 8/8 verde
- `npm run lint:strict-mode`: All contracts pass

## Cuando rompa en producción

Si auditora reporta otro defecto del output:
1. Documentar en `docs/spec/financial-pipeline-v2.X.md` con ejemplo correcto/incorrecto.
2. Mapear corrección → archivo (renderer / prompt NIIF / prompt Strategy / prompt Governance).
3. Spawn fix worker con scope archivo-único (worktree, Opus para criterio, Sonnet para mecánico).
4. Cherry-pick + verify (tsc + vitest + integration + lint:strict-mode).
5. Push. CLAUDE.md update con la nueva corrección.
