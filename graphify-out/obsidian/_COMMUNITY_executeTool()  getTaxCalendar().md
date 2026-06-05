---
type: community
cohesion: 0.07
members: 43
---

# executeTool() / getTaxCalendar()

**Cohesion:** 0.07 - loosely connected
**Members:** 43 nodes

## Members
- [[GET()_11]] - code - app\api\calendar\verified\route.ts
- [[POST()_53]] - code - app\api\tools\calendar\route.ts
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
- [[executeTool()]] - code - lib\agents\tools\registry.ts
- [[fallbackAnalysis()]] - code - lib\tools\document-analyzer.ts
- [[fallbackDraft()]] - code - lib\tools\dian-response-generator.ts
- [[fallbackRiskAssessment()]] - code - lib\tools\risk-assessor.ts
- [[formatCOP()_26]] - code - lib\tools\sanction-calculator.ts
- [[formatMunicipalCalendar()]] - code - lib\tools\tax-calendar.ts
- [[formatNationalDeadlines()]] - code - lib\tools\tax-calendar.ts
- [[formatSearchResultsForLLM()]] - code - lib\search\web-search.ts
- [[generateDianResponse()]] - code - lib\tools\dian-response-generator.ts
- [[getAvailableCities()]] - code - data\calendars\index.ts
- [[getMunicipalCalendar()]] - code - data\calendars\index.ts
- [[getNationalDeadlines()]] - code - data\calendars\index.ts
- [[getTaxCalendar()]] - code - lib\tools\tax-calendar.ts
- [[getVerifiedNational()]] - code - lib\calendars\source.ts
- [[index.ts_2]] - code - data\calendars\index.ts
- [[invalidateCache()]] - code - lib\calendars\source.ts
- [[isCacheFresh()]] - code - lib\calendars\source.ts
- [[readBag()]] - code - lib\agents\tools\registry.ts
- [[registry.ts]] - code - lib\agents\tools\registry.ts
- [[risk-assessor.ts_1]] - code - lib\tools\risk-assessor.ts
- [[route.ts_34]] - code - app\api\calendar\verified\route.ts
- [[route.ts_85]] - code - app\api\tools\calendar\route.ts
- [[route.ts_86]] - code - app\api\tools\sanction\route.ts
- [[route.ts_90]] - code - app\api\web-search\route.ts
- [[sanction-calculator.ts]] - code - lib\tools\sanction-calculator.ts
- [[searchWeb()]] - code - lib\search\web-search.ts
- [[source.ts]] - code - lib\calendars\source.ts
- [[tax-calendar.ts]] - code - lib\tools\tax-calendar.ts
- [[web-search.ts]] - code - lib\search\web-search.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/executeTool()_/_getTaxCalendar()
SORT file.name ASC
```

## Connections to other communities
- 1 edge to [[_COMMUNITY_runHtmlEditor()  orchestrate()]]
- 1 edge to [[_COMMUNITY_route.ts  vectorstore.ts]]
- 1 edge to [[_COMMUNITY_repository.ts  erp-query.ts]]
- 1 edge to [[_COMMUNITY_getDb()  getOrCreateWorkspace()]]

## Top bridge nodes
- [[executeTool()]] - degree 10, connects to 2 communities
- [[getVerifiedNational()]] - degree 6, connects to 1 community
- [[registry.ts]] - degree 3, connects to 1 community