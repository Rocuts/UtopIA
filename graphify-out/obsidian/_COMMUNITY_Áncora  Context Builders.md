---
type: community
cohesion: 0.05
members: 77
---

# Áncora / Context Builders

**Cohesion:** 0.05 - loosely connected
**Members:** 77 nodes

## Members
- [[.constructor()_13]] - code - lib\agents\financial\orchestrator.ts
- [[BalanceValidationError]] - code - lib\agents\financial\orchestrator.ts
- [[POST()_35]] - code - app\api\financial-report\governance\route.ts
- [[POST()_39]] - code - app\api\financial-report\strategy\route.ts
- [[absDelta()]] - code - lib\agents\financial\orchestrator.ts
- [[aggregateConfidence()]] - code - lib\preprocessing\v8-helpers.ts
- [[audit-report-emittable.ts]] - code - lib\pillars\audit-report-emittable.ts
- [[auditReportEmittable()]] - code - lib\pillars\audit-report-emittable.ts
- [[build-ancora.ts]] - code - lib\agents\financial\ancora\build-ancora.ts
- [[buildAdjustmentsAuditSection()]] - code - lib\agents\financial\orchestrator.ts
- [[buildBindingTotalsBlock()]] - code - lib\agents\financial\orchestrator.ts
- [[buildCcvFiscal()]] - code - lib\agents\financial\ancora\build-ancora.ts
- [[buildCcvNiif()]] - code - lib\agents\financial\ancora\build-ancora.ts
- [[buildChecks()]] - code - lib\agents\financial\ancora\build-ancora.ts
- [[buildComparativeAnchorsForValidator()]] - code - lib\agents\financial\orchestrator.ts
- [[buildConsolidatedReport()_2]] - code - lib\agents\financial\orchestrator.ts
- [[buildNiifAncora()]] - code - lib\agents\financial\ancora\build-ancora.ts
- [[buildProvisionalWatermark()]] - code - lib\agents\financial\orchestrator.ts
- [[classAuxiliaryTotal()]] - code - lib\preprocessing\v8-helpers.ts
- [[collectClassAccounts()]] - code - lib\preprocessing\v8-helpers.ts
- [[collectConfidences()]] - code - lib\preprocessing\v8-helpers.ts
- [[computeNITCheckDigit()]] - code - lib\validation\nit-validator.ts
- [[computeReportHash()]] - code - lib\preprocessing\v8-helpers.ts
- [[deriveControlTotals()]] - code - lib\agents\financial\orchestrator.ts
- [[deriveControlTotalsFromSnapshot()]] - code - lib\agents\financial\orchestrator.ts
- [[deriveDiscrepanciesFromSnapshot()]] - code - lib\agents\financial\orchestrator.ts
- [[deriveEquityBreakdownFromSnapshot()]] - code - lib\agents\financial\orchestrator.ts
- [[deriveReportMode()]] - code - lib\preprocessing\v8-helpers.ts
- [[deriveValidation()]] - code - lib\agents\financial\orchestrator.ts
- [[detectBrokenTables()]] - code - lib\agents\financial\validators\report-validator.ts
- [[detectInflatedCash()]] - code - lib\agents\financial\validators\report-validator.ts
- [[detectMissingControlKPIs()]] - code - lib\agents\financial\validators\report-validator.ts
- [[detectMissingWorkingCapital()]] - code - lib\agents\financial\validators\report-validator.ts
- [[extractHeadlineTotal()]] - code - lib\agents\financial\validators\report-validator.ts
- [[extractNITBody()]] - code - lib\validation\nit-validator.ts
- [[extractNitDigit()]] - code - lib\agents\financial\ancora\build-ancora.ts
- [[extractTotalsMentions()]] - code - lib\agents\financial\validators\report-validator.ts
- [[fmtCop()_9]] - code - lib\agents\financial\orchestrator.ts
- [[formatBigCents()]] - code - lib\pillars\audit-report-emittable.ts
- [[formatCop()_2]] - code - lib\agents\financial\validators\report-validator.ts
- [[formatPercentEsCo()]] - code - lib\preprocessing\v8-helpers.ts
- [[getComparativeSnapshot()]] - code - lib\agents\financial\orchestrator.ts
- [[getEstatutosFlag()]] - code - lib\agents\financial\orchestrator.ts
- [[getExtractedMetadataFromPreprocessed()]] - code - lib\agents\financial\orchestrator.ts
- [[getPrimarySnapshot()]] - code - lib\agents\financial\orchestrator.ts
- [[handleStreaming()_5]] - code - app\api\financial-report\governance\route.ts
- [[handleStreaming()_8]] - code - app\api\financial-report\strategy\route.ts
- [[isPreprocessedBalance()]] - code - lib\agents\financial\orchestrator.ts
- [[makeEmptyAncora()]] - code - lib\agents\financial\ancora\build-ancora.ts
- [[niifOutputMentionsBindingTotals()]] - code - lib\agents\financial\orchestrator.ts
- [[nit-validator.ts]] - code - lib\validation\nit-validator.ts
- [[normalizeTipoSocietario()]] - code - lib\agents\financial\orchestrator.ts
- [[orchestrateFinancialReport()]] - code - lib\agents\financial\orchestrator.ts
- [[orchestrator.ts_6]] - code - lib\agents\financial\orchestrator.ts
- [[parseCopAmount()]] - code - lib\agents\financial\validators\report-validator.ts
- [[pctYoY()]] - code - lib\agents\financial\orchestrator.ts
- [[prepareFinancialContext()]] - code - lib\agents\financial\orchestrator.ts
- [[renderSnapshotLines()]] - code - lib\agents\financial\orchestrator.ts
- [[report-validator.ts]] - code - lib\agents\financial\validators\report-validator.ts
- [[reportConstituyeReservaLegal()]] - code - lib\pillars\audit-report-emittable.ts
- [[reportIncluyeTMTCalculada()]] - code - lib\pillars\audit-report-emittable.ts
- [[reportMencionaIFRS18()]] - code - lib\pillars\audit-report-emittable.ts
- [[route.ts_56]] - code - app\api\financial-report\governance\route.ts
- [[route.ts_60]] - code - app\api\financial-report\strategy\route.ts
- [[runGovernancePhase()]] - code - lib\agents\financial\orchestrator.ts
- [[runNiifPhase()]] - code - lib\agents\financial\orchestrator.ts
- [[runStrategyPhase()]] - code - lib\agents\financial\orchestrator.ts
- [[stableStringify()]] - code - lib\preprocessing\v8-helpers.ts
- [[sumAbsAccountsByPrefix()]] - code - lib\agents\financial\ancora\build-ancora.ts
- [[sumAccountsByPrefix()]] - code - lib\agents\financial\ancora\build-ancora.ts
- [[summarizeCoverage()]] - code - lib\preprocessing\v8-helpers.ts
- [[toCentsString()]] - code - lib\agents\financial\ancora\build-ancora.ts
- [[toMoneyCopString()]] - code - lib\preprocessing\v8-helpers.ts
- [[totalAbsClass()]] - code - lib\agents\financial\ancora\build-ancora.ts
- [[v8-helpers.ts]] - code - lib\preprocessing\v8-helpers.ts
- [[validateConsolidatedReport()]] - code - lib\agents\financial\validators\report-validator.ts
- [[validateNITCheckDigit()]] - code - lib\validation\nit-validator.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Áncora_/_Context_Builders
SORT file.name ASC
```

## Connections to other communities
- 8 edges to [[_COMMUNITY_Financial Agent Pipelines]]
- 7 edges to [[_COMMUNITY_Core API Routes]]
- 1 edge to [[_COMMUNITY_Audit & Compliance Agents]]
- 1 edge to [[_COMMUNITY_NIIF Analyst Pipeline]]
- 1 edge to [[_COMMUNITY_Pyme & Workspace Routes]]
- 1 edge to [[_COMMUNITY_Module Cluster 26]]
- 1 edge to [[_COMMUNITY_Tax Calendar & ERP Connect]]
- 1 edge to [[_COMMUNITY_Module Cluster 22]]

## Top bridge nodes
- [[prepareFinancialContext()]] - degree 14, connects to 4 communities
- [[runNiifPhase()]] - degree 11, connects to 3 communities
- [[orchestrator.ts_6]] - degree 29, connects to 2 communities
- [[orchestrateFinancialReport()]] - degree 20, connects to 2 communities
- [[renderSnapshotLines()]] - degree 7, connects to 1 community