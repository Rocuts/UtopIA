---
type: community
cohesion: 0.08
members: 38
---

# toComparableAnalysisResult() / toTPDocumentationResult()

**Cohesion:** 0.08 - loosely connected
**Members:** 38 nodes

## Members
- [[POST()_55]] - code - app\api\transfer-pricing\route.ts
- [[buildComparableAnalystPrompt()]] - code - lib\agents\financial\transfer-pricing\prompts\comparable-analyst.prompt.ts
- [[buildConsolidatedReport()_5]] - code - lib\agents\financial\transfer-pricing\orchestrator.ts
- [[buildTPAnalystPrompt()]] - code - lib\agents\financial\transfer-pricing\prompts\tp-analyst.prompt.ts
- [[buildTPDocumentationPrompt()]] - code - lib\agents\financial\transfer-pricing\prompts\tp-documentation.prompt.ts
- [[comparable-analyst.prompt.ts]] - code - lib\agents\financial\transfer-pricing\prompts\comparable-analyst.prompt.ts
- [[comparable-analyst.ts]] - code - lib\agents\financial\transfer-pricing\agents\comparable-analyst.ts
- [[handleStreaming()_12]] - code - app\api\transfer-pricing\route.ts
- [[orchestrateTransferPricing()]] - code - lib\agents\financial\transfer-pricing\orchestrator.ts
- [[orchestrator.ts_9]] - code - lib\agents\financial\transfer-pricing\orchestrator.ts
- [[renderAdjustments()]] - code - lib\agents\financial\transfer-pricing\agents\comparable-analyst.ts
- [[renderArmLengthConclusion()]] - code - lib\agents\financial\transfer-pricing\agents\comparable-analyst.ts
- [[renderComparabilityCriteria()]] - code - lib\agents\financial\transfer-pricing\agents\comparable-analyst.ts
- [[renderExecutiveSummary()]] - code - lib\agents\financial\transfer-pricing\agents\tp-documentation-writer.ts
- [[renderFAR()]] - code - lib\agents\financial\transfer-pricing\agents\tp-analyst.ts
- [[renderFormato1125()]] - code - lib\agents\financial\transfer-pricing\agents\tp-documentation-writer.ts
- [[renderInterquartileRange()]] - code - lib\agents\financial\transfer-pricing\agents\comparable-analyst.ts
- [[renderLocalFile()]] - code - lib\agents\financial\transfer-pricing\agents\tp-documentation-writer.ts
- [[renderMasterFile()]] - code - lib\agents\financial\transfer-pricing\agents\tp-documentation-writer.ts
- [[renderMethodSelection()]] - code - lib\agents\financial\transfer-pricing\agents\tp-analyst.ts
- [[renderObligation()]] - code - lib\agents\financial\transfer-pricing\agents\tp-analyst.ts
- [[renderPreliminary()]] - code - lib\agents\financial\transfer-pricing\agents\tp-analyst.ts
- [[renderRecommendationsAndDefense()]] - code - lib\agents\financial\transfer-pricing\agents\tp-documentation-writer.ts
- [[renderSanctions()]] - code - lib\agents\financial\transfer-pricing\agents\tp-documentation-writer.ts
- [[renderSearchStrategy()]] - code - lib\agents\financial\transfer-pricing\agents\comparable-analyst.ts
- [[renderSelectedComparables()]] - code - lib\agents\financial\transfer-pricing\agents\comparable-analyst.ts
- [[renderTransactions()]] - code - lib\agents\financial\transfer-pricing\agents\tp-analyst.ts
- [[route.ts_87]] - code - app\api\transfer-pricing\route.ts
- [[runComparableAnalyst()]] - code - lib\agents\financial\transfer-pricing\agents\comparable-analyst.ts
- [[runTPAnalyst()]] - code - lib\agents\financial\transfer-pricing\agents\tp-analyst.ts
- [[runTPDocumentationWriter()]] - code - lib\agents\financial\transfer-pricing\agents\tp-documentation-writer.ts
- [[toComparableAnalysisResult()]] - code - lib\agents\financial\transfer-pricing\agents\comparable-analyst.ts
- [[toTPAnalysisResult()]] - code - lib\agents\financial\transfer-pricing\agents\tp-analyst.ts
- [[toTPDocumentationResult()]] - code - lib\agents\financial\transfer-pricing\agents\tp-documentation-writer.ts
- [[tp-analyst.prompt.ts]] - code - lib\agents\financial\transfer-pricing\prompts\tp-analyst.prompt.ts
- [[tp-analyst.ts]] - code - lib\agents\financial\transfer-pricing\agents\tp-analyst.ts
- [[tp-documentation-writer.ts]] - code - lib\agents\financial\transfer-pricing\agents\tp-documentation-writer.ts
- [[tp-documentation.prompt.ts]] - code - lib\agents\financial\transfer-pricing\prompts\tp-documentation.prompt.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/toComparableAnalysisResult()_/_toTPDocumentationResult()
SORT file.name ASC
```

## Connections to other communities
- 5 edges to [[_COMMUNITY_formatCopFromCents()  parseMoneyCop()]]
- 3 edges to [[_COMMUNITY_callFinancialAgent()  orchestrateFiscalOpinion()]]

## Top bridge nodes
- [[orchestrateTransferPricing()]] - degree 7, connects to 1 community
- [[runComparableAnalyst()]] - degree 5, connects to 1 community
- [[runTPAnalyst()]] - degree 5, connects to 1 community
- [[runTPDocumentationWriter()]] - degree 5, connects to 1 community
- [[renderArmLengthConclusion()]] - degree 4, connects to 1 community