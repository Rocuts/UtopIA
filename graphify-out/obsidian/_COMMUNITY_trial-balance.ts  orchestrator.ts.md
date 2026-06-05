---
type: community
cohesion: 0.03
members: 122
---

# trial-balance.ts / orchestrator.ts

**Cohesion:** 0.03 - loosely connected
**Members:** 122 nodes

## Members
- [[.constructor()_13]] - code - lib\agents\financial\orchestrator.ts
- [[BalanceValidationError]] - code - lib\agents\financial\orchestrator.ts
- [[POST()_30]] - code - app\api\escudo-survival\route.ts
- [[POST()_34]] - code - app\api\financial-report\export\route.ts
- [[POST()_38]] - code - app\api\financial-report\route.ts
- [[POST()_35]] - code - app\api\financial-report\governance\route.ts
- [[POST()_37]] - code - app\api\financial-report\niif\route.ts
- [[POST()_39]] - code - app\api\financial-report\strategy\route.ts
- [[absDelta()]] - code - lib\agents\financial\orchestrator.ts
- [[audit-report-emittable.test.ts]] - code - lib\pillars\__tests__\audit-report-emittable.test.ts
- [[buildBindingTotalsBlock()]] - code - lib\agents\financial\orchestrator.ts
- [[buildCleanDataMultiPeriod()]] - code - lib\preprocessing\trial-balance.ts
- [[buildComparativeAnchorsForValidator()]] - code - lib\agents\financial\orchestrator.ts
- [[buildConsolidatedReport()_2]] - code - lib\agents\financial\orchestrator.ts
- [[buildFallbackAntiDian()]] - code - lib\agents\financial\escudo-survival\orchestrator.ts
- [[buildFallbackDividend()]] - code - lib\agents\financial\escudo-survival\orchestrator.ts
- [[buildFallbackReserve()]] - code - lib\agents\financial\escudo-survival\orchestrator.ts
- [[buildFallbackRetention()]] - code - lib\agents\financial\escudo-survival\orchestrator.ts
- [[buildFallbackSynthesis()]] - code - lib\agents\financial\escudo-survival\orchestrator.ts
- [[buildFallbackTet()]] - code - lib\agents\financial\escudo-survival\orchestrator.ts
- [[buildMissingAccountsForView()]] - code - lib\preprocessing\trial-balance.ts
- [[buildMultiPeriodValidationReport()]] - code - lib\preprocessing\trial-balance.ts
- [[buildPreprocessed()]] - code - lib\preprocessing\__tests__\wave2-f4-binding.test.ts
- [[buildProvisionalWatermark()]] - code - lib\agents\financial\orchestrator.ts
- [[buildReclasificacionesNoCompensacion()]] - code - lib\preprocessing\trial-balance.ts
- [[buildReport()]] - code - lib\pillars\__tests__\audit-report-emittable.test.ts
- [[buildSnapshot()_1]] - code - lib\pillars\__tests__\audit-report-emittable.test.ts
- [[buildSnapshotForPeriod()]] - code - lib\preprocessing\trial-balance.ts
- [[cellToCSV()]] - code - lib\accounting\opening-balance\parser.ts
- [[computeDerivedKpis()]] - code - lib\preprocessing\trial-balance.ts
- [[createExcelResponse()]] - code - app\api\financial-report\export\route.ts
- [[curatorFindingToDiscrepancy()]] - code - lib\preprocessing\trial-balance.ts
- [[deriveControlTotals()]] - code - lib\agents\financial\orchestrator.ts
- [[deriveControlTotalsFromSnapshot()]] - code - lib\agents\financial\orchestrator.ts
- [[deriveDiscrepanciesFromSnapshot()]] - code - lib\agents\financial\orchestrator.ts
- [[deriveEquityBreakdownFromSnapshot()]] - code - lib\agents\financial\orchestrator.ts
- [[deriveValidation()]] - code - lib\agents\financial\orchestrator.ts
- [[detectBalanceColumns()]] - code - lib\preprocessing\trial-balance.ts
- [[detectBrokenTables()]] - code - lib\agents\financial\validators\report-validator.ts
- [[detectComparativosImpracticables()_1]] - code - lib\preprocessing\trial-balance.ts
- [[detectInflatedCash()]] - code - lib\agents\financial\validators\report-validator.ts
- [[detectMissingControlKPIs()]] - code - lib\agents\financial\validators\report-validator.ts
- [[detectMissingWorkingCapital()]] - code - lib\agents\financial\validators\report-validator.ts
- [[elite-pulido-diamante-binding.test.ts]] - code - lib\preprocessing\__tests__\elite-pulido-diamante-binding.test.ts
- [[elite-pulido-diamante.test.ts]] - code - lib\preprocessing\__tests__\elite-pulido-diamante.test.ts
- [[emit()]] - code - lib\agents\financial\escudo-survival\orchestrator.ts
- [[extractCompanyMetadata()]] - code - lib\preprocessing\trial-balance.ts
- [[extractEquityBreakdown()]] - code - lib\preprocessing\trial-balance.ts
- [[extractEquityBreakdownForView()]] - code - lib\preprocessing\trial-balance.ts
- [[extractExtension()]] - code - lib\accounting\opening-balance\parser.ts
- [[extractHeadlineTotal()]] - code - lib\agents\financial\validators\report-validator.ts
- [[extractSerializableContext()]] - code - app\api\financial-report\niif\route.ts
- [[extractTotalsMentions()]] - code - lib\agents\financial\validators\report-validator.ts
- [[findColumnIndex()]] - code - lib\preprocessing\trial-balance.ts
- [[findMissingAccountsForClass()]] - code - lib\preprocessing\trial-balance.ts
- [[fmtCop()_9]] - code - lib\agents\financial\orchestrator.ts
- [[formatCOP()_24]] - code - lib\preprocessing\trial-balance.ts
- [[formatCop()_2]] - code - lib\agents\financial\validators\report-validator.ts
- [[formatNitWithDots()]] - code - lib\preprocessing\trial-balance.ts
- [[getComparativeSnapshot()]] - code - lib\agents\financial\orchestrator.ts
- [[getEstatutosFlag()]] - code - lib\agents\financial\orchestrator.ts
- [[getExtractedMetadataFromPreprocessed()]] - code - lib\agents\financial\orchestrator.ts
- [[getPrimarySnapshot()]] - code - lib\agents\financial\orchestrator.ts
- [[handlePdfElite()]] - code - app\api\financial-report\export\route.ts
- [[handleStreaming()_2]] - code - app\api\escudo-survival\route.ts
- [[handleStreaming()_7]] - code - app\api\financial-report\route.ts
- [[handleStreaming()_5]] - code - app\api\financial-report\governance\route.ts
- [[handleStreaming()_6]] - code - app\api\financial-report\niif\route.ts
- [[handleStreaming()_8]] - code - app\api\financial-report\strategy\route.ts
- [[inferActividadFromSnapshot()]] - code - lib\preprocessing\trial-balance.ts
- [[inferLevel()_1]] - code - lib\preprocessing\trial-balance.ts
- [[inferPeriodoTipo()]] - code - lib\preprocessing\trial-balance.ts
- [[isBalanceHeader()]] - code - lib\preprocessing\trial-balance.ts
- [[isPreprocessedBalance()]] - code - lib\agents\financial\orchestrator.ts
- [[isPreviousBalanceHeader()]] - code - lib\preprocessing\trial-balance.ts
- [[loadPrimarySnapshot()]] - code - lib\preprocessing\__tests__\elite-pulido-diamante-binding.test.ts
- [[loadSnapshot()]] - code - lib\preprocessing\__tests__\elite-pulido-diamante.test.ts
- [[niifOutputMentionsBindingTotals()]] - code - lib\agents\financial\orchestrator.ts
- [[normalizeLevel()]] - code - lib\preprocessing\trial-balance.ts
- [[normalizeTipoSocietario()]] - code - lib\agents\financial\orchestrator.ts
- [[orchestrateEscudoSurvival()]] - code - lib\agents\financial\escudo-survival\orchestrator.ts
- [[orchestrateFinancialReport()]] - code - lib\agents\financial\orchestrator.ts
- [[orchestrator.ts_3]] - code - lib\agents\financial\escudo-survival\orchestrator.ts
- [[orchestrator.ts_6]] - code - lib\agents\financial\orchestrator.ts
- [[parseCSVContent()]] - code - lib\accounting\opening-balance\parser.ts
- [[parseCopAmount()]] - code - lib\agents\financial\validators\report-validator.ts
- [[parseLine()]] - code - lib\preprocessing\trial-balance.ts
- [[parseNumber()_1]] - code - lib\preprocessing\trial-balance.ts
- [[parseOpeningBalanceFile()]] - code - lib\accounting\opening-balance\parser.ts
- [[parseTrialBalanceCSV()]] - code - lib\preprocessing\trial-balance.ts
- [[parseXLSXContent()]] - code - lib\accounting\opening-balance\parser.ts
- [[parser.ts]] - code - lib\accounting\opening-balance\parser.ts
- [[pctYoY()]] - code - lib\agents\financial\orchestrator.ts
- [[pdfResponse()]] - code - app\api\financial-report\export\route.ts
- [[prepareFinancialContext()]] - code - lib\agents\financial\orchestrator.ts
- [[preprocessTrialBalance()]] - code - lib\preprocessing\trial-balance.ts
- [[renderSnapshotLines()]] - code - lib\agents\financial\orchestrator.ts
- [[report-validator.ts]] - code - lib\agents\financial\validators\report-validator.ts
- [[roundCop()]] - code - lib\accounting\opening-balance\parser.ts
- [[route.ts_50]] - code - app\api\escudo-survival\route.ts
- [[route.ts_54]] - code - app\api\financial-report\export\route.ts
- [[route.ts_56]] - code - app\api\financial-report\governance\route.ts
- [[route.ts_58]] - code - app\api\financial-report\niif\route.ts
- [[route.ts_59]] - code - app\api\financial-report\route.ts
- [[route.ts_60]] - code - app\api\financial-report\strategy\route.ts
- [[rowsToOpeningLines()]] - code - lib\accounting\opening-balance\parser.ts
- [[runGovernancePhase()]] - code - lib\agents\financial\orchestrator.ts
- [[runNiifPhase()]] - code - lib\agents\financial\orchestrator.ts
- [[runStage()]] - code - lib\agents\financial\escudo-survival\orchestrator.ts
- [[runStrategyPhase()]] - code - lib\agents\financial\orchestrator.ts
- [[runSynthesizer()_1]] - code - lib\agents\financial\escudo-survival\orchestrator.ts
- [[safeNumber()]] - code - lib\preprocessing\trial-balance.ts
- [[sanitizeRazonSocial()]] - code - lib\preprocessing\trial-balance.ts
- [[sortPeriodsAscending()]] - code - lib\preprocessing\trial-balance.ts
- [[stripBOM()_1]] - code - lib\accounting\opening-balance\parser.ts
- [[sumLeavesByGroupPrefixes()]] - code - lib\preprocessing\trial-balance.ts
- [[sumLeavesPrecise()]] - code - lib\preprocessing\trial-balance.ts
- [[toCents()]] - code - lib\preprocessing\trial-balance.ts
- [[toRawString()]] - code - lib\preprocessing\trial-balance.ts
- [[trial-balance.ts]] - code - lib\preprocessing\trial-balance.ts
- [[validateConsolidatedReport()]] - code - lib\agents\financial\validators\report-validator.ts
- [[wave2-f4-binding.test.ts]] - code - lib\preprocessing\__tests__\wave2-f4-binding.test.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/trial-balance.ts_/_orchestrator.ts
SORT file.name ASC
```

## Connections to other communities
- 10 edges to [[_COMMUNITY_formatCopFromCents()  parseMoneyCop()]]
- 3 edges to [[_COMMUNITY_repository.ts  erp-query.ts]]
- 3 edges to [[_COMMUNITY_route.ts  vectorstore.ts]]
- 3 edges to [[_COMMUNITY_tools.ts  adjustments.ts]]
- 2 edges to [[_COMMUNITY_niif-analyst.prompt.ts  buildAntiHallucinationGuardrail()]]
- 2 edges to [[_COMMUNITY_build-ancora.ts  buildNiifAncora()]]
- 2 edges to [[_COMMUNITY_buildFiscalAnchor()  dian-calendar.ts]]
- 1 edge to [[_COMMUNITY_POST()  importOpeningBalance()]]
- 1 edge to [[_COMMUNITY_excel-export.ts  generateFinancialExcel()]]
- 1 edge to [[_COMMUNITY_escudo-cards.ts  verdad-cards.ts]]
- 1 edge to [[_COMMUNITY_compose.ts  composeEditorialReport()]]
- 1 edge to [[_COMMUNITY_fonts.ts  registerEditorialFonts()]]
- 1 edge to [[_COMMUNITY_callFinancialAgent()  orchestrateFiscalOpinion()]]
- 1 edge to [[_COMMUNITY_processUpload()  POST()]]
- 1 edge to [[_COMMUNITY_ERPService  ERPAdapter]]
- 1 edge to [[_COMMUNITY_v8-helpers.ts  deriveReportMode()]]
- 1 edge to [[_COMMUNITY_auditReportEmittable()  audit-report-emittable.ts]]
- 1 edge to [[_COMMUNITY_preprocessed-balance.ts  getCachedPreprocessedBalance()]]
- 1 edge to [[_COMMUNITY_runCurator()  runR2()]]

## Top bridge nodes
- [[prepareFinancialContext()]] - degree 14, connects to 5 communities
- [[preprocessTrialBalance()]] - degree 25, connects to 4 communities
- [[handlePdfElite()]] - degree 9, connects to 3 communities
- [[orchestrator.ts_6]] - degree 29, connects to 2 communities
- [[orchestrateFinancialReport()]] - degree 20, connects to 2 communities