---
type: community
cohesion: 0.05
members: 63
---

# Tax Calendar & ERP Connect

**Cohesion:** 0.05 - loosely connected
**Members:** 63 nodes

## Members
- [[.constructor()_16]] - code - lib\erp\pipeline.ts
- [[ERPPipelineError]] - code - lib\erp\pipeline.ts
- [[GET()_18]] - code - app\api\erp\providers\route.ts
- [[GET()_11]] - code - app\api\calendar\verified\route.ts
- [[POST()_53]] - code - app\api\tools\calendar\route.ts
- [[POST()_25]] - code - app\api\erp\connect\route.ts
- [[POST()_54]] - code - app\api\tools\sanction\route.ts
- [[POST()_58]] - code - app\api\web-search\route.ts
- [[analyzeDocument()]] - code - lib\tools\document-analyzer.ts
- [[assessRisk()]] - code - lib\tools\risk-assessor.ts
- [[buildPromptFromRequest()]] - code - lib\tools\dian-response-generator.ts
- [[calcCorreccion()]] - code - lib\tools\sanction-calculator.ts
- [[calcExtemporaneidad()]] - code - lib\tools\sanction-calculator.ts
- [[calcInexactitud()]] - code - lib\tools\sanction-calculator.ts
- [[calcInteresesMoratorios()]] - code - lib\tools\sanction-calculator.ts
- [[calculateSanction()]] - code - lib\tools\sanction-calculator.ts
- [[dian-response-generator.ts]] - code - lib\tools\dian-response-generator.ts
- [[document-analyzer.ts]] - code - lib\tools\document-analyzer.ts
- [[erp-query.ts]] - code - lib\tools\erp-query.ts
- [[executeTool()]] - code - lib\agents\tools\registry.ts
- [[fallbackAnalysis()]] - code - lib\tools\document-analyzer.ts
- [[fallbackDraft()]] - code - lib\tools\dian-response-generator.ts
- [[fallbackRiskAssessment()]] - code - lib\tools\risk-assessor.ts
- [[formatCOP()_25]] - code - lib\tools\erp-query.ts
- [[formatCOP()_26]] - code - lib\tools\sanction-calculator.ts
- [[formatChartOfAccounts()]] - code - lib\tools\erp-query.ts
- [[formatContacts()]] - code - lib\tools\erp-query.ts
- [[formatInvoices()]] - code - lib\tools\erp-query.ts
- [[formatJournalEntries()]] - code - lib\tools\erp-query.ts
- [[formatMunicipalCalendar()]] - code - lib\tools\tax-calendar.ts
- [[formatNationalDeadlines()]] - code - lib\tools\tax-calendar.ts
- [[formatSearchResultsForLLM()]] - code - lib\search\web-search.ts
- [[formatTrialBalance()]] - code - lib\tools\erp-query.ts
- [[generateDianResponse()]] - code - lib\tools\dian-response-generator.ts
- [[getAvailableCities()]] - code - data\calendars\index.ts
- [[getConnector()]] - code - lib\erp\registry.ts
- [[getMunicipalCalendar()]] - code - data\calendars\index.ts
- [[getNationalDeadlines()]] - code - data\calendars\index.ts
- [[getProvidersByCountry()]] - code - lib\erp\registry.ts
- [[getTaxCalendar()]] - code - lib\tools\tax-calendar.ts
- [[getVerifiedNational()]] - code - lib\calendars\source.ts
- [[index.ts_2]] - code - data\calendars\index.ts
- [[invalidateCache()]] - code - lib\calendars\source.ts
- [[isCacheFresh()]] - code - lib\calendars\source.ts
- [[parsePeriod()]] - code - lib\tools\erp-query.ts
- [[pipeline.ts]] - code - lib\erp\pipeline.ts
- [[pullTrialBalanceForPeriod()]] - code - lib\erp\pipeline.ts
- [[queryERP()]] - code - lib\tools\erp-query.ts
- [[registry.ts_1]] - code - lib\erp\registry.ts
- [[resolveDateRange()]] - code - lib\tools\erp-query.ts
- [[risk-assessor.ts_1]] - code - lib\tools\risk-assessor.ts
- [[route.ts_34]] - code - app\api\calendar\verified\route.ts
- [[route.ts_42]] - code - app\api\erp\connect\route.ts
- [[route.ts_43]] - code - app\api\erp\providers\route.ts
- [[route.ts_85]] - code - app\api\tools\calendar\route.ts
- [[route.ts_86]] - code - app\api\tools\sanction\route.ts
- [[route.ts_90]] - code - app\api\web-search\route.ts
- [[sanction-calculator.ts]] - code - lib\tools\sanction-calculator.ts
- [[searchWeb()]] - code - lib\search\web-search.ts
- [[serializeTrialBalance()]] - code - lib\erp\pipeline.ts
- [[source.ts]] - code - lib\calendars\source.ts
- [[tax-calendar.ts]] - code - lib\tools\tax-calendar.ts
- [[web-search.ts]] - code - lib\search\web-search.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Tax_Calendar_&_ERP_Connect
SORT file.name ASC
```

## Connections to other communities
- 1 edge to [[_COMMUNITY_Core API Routes]]
- 1 edge to [[_COMMUNITY_Áncora  Context Builders]]
- 1 edge to [[_COMMUNITY_Module Cluster 15]]
- 1 edge to [[_COMMUNITY_Module Cluster 24]]
- 1 edge to [[_COMMUNITY_Accounting Shared Utilities]]

## Top bridge nodes
- [[executeTool()]] - degree 10, connects to 2 communities
- [[getVerifiedNational()]] - degree 6, connects to 1 community
- [[getConnector()]] - degree 5, connects to 1 community
- [[pullTrialBalanceForPeriod()]] - degree 3, connects to 1 community