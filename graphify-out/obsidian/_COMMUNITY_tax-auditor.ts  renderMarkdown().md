---
type: community
cohesion: 0.14
members: 26
---

# tax-auditor.ts / renderMarkdown()

**Cohesion:** 0.14 - loosely connected
**Members:** 26 nodes

## Members
- [[POST()_32]] - code - app\api\financial-audit\route.ts
- [[buildConsolidatedAuditReport()]] - code - lib\agents\financial\audit\orchestrator.ts
- [[buildExecutiveSummary()]] - code - lib\agents\financial\audit\orchestrator.ts
- [[buildPeriodContext()]] - code - lib\agents\financial\audit\orchestrator.ts
- [[centerInAuditFrame()]] - code - lib\agents\financial\audit\orchestrator.ts
- [[escapeAuditCell()]] - code - lib\agents\financial\audit\orchestrator.ts
- [[evaluacionIcon()]] - code - lib\agents\financial\audit\agents\tax-auditor.ts
- [[fmtCOP()]] - code - lib\agents\financial\audit\orchestrator.ts
- [[fmtMoneyCop()]] - code - lib\agents\financial\audit\agents\tax-auditor.ts
- [[fmtMoneyOrNa()]] - code - lib\agents\financial\audit\agents\tax-auditor.ts
- [[fmtPctOrNa()]] - code - lib\agents\financial\audit\agents\tax-auditor.ts
- [[handleStreaming()_4]] - code - app\api\financial-audit\route.ts
- [[mapFinding()_3]] - code - lib\agents\financial\audit\agents\tax-auditor.ts
- [[orchestrateAudit()]] - code - lib\agents\financial\audit\orchestrator.ts
- [[orchestrator.ts_1]] - code - lib\agents\financial\audit\orchestrator.ts
- [[priorityLabel()]] - code - lib\agents\financial\audit\agents\tax-auditor.ts
- [[renderLegacyMarkdown()_1]] - code - lib\agents\financial\audit\agents\tax-auditor.ts
- [[renderMarkdown()_3]] - code - lib\agents\financial\audit\agents\tax-auditor.ts
- [[renderTaxDictamenMarkdown()]] - code - lib\agents\financial\audit\agents\tax-auditor.ts
- [[riesgoIcon()]] - code - lib\agents\financial\audit\agents\tax-auditor.ts
- [[route.ts_52]] - code - app\api\financial-audit\route.ts
- [[runTaxAuditor()]] - code - lib\agents\financial\audit\agents\tax-auditor.ts
- [[tax-auditor.ts]] - code - lib\agents\financial\audit\agents\tax-auditor.ts
- [[taxOpinionLabel()]] - code - lib\agents\financial\audit\agents\tax-auditor.ts
- [[tmtIcon()]] - code - lib\agents\financial\audit\agents\tax-auditor.ts
- [[toLegacyAuditorResult()_3]] - code - lib\agents\financial\audit\agents\tax-auditor.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/tax-auditor.ts_/_renderMarkdown()
SORT file.name ASC
```

## Connections to other communities
- 4 edges to [[_COMMUNITY_formatCopFromCents()  parseMoneyCop()]]
- 2 edges to [[_COMMUNITY_niif-analyst.prompt.ts  buildAntiHallucinationGuardrail()]]
- 1 edge to [[_COMMUNITY_callFinancialAgent()  orchestrateFiscalOpinion()]]

## Top bridge nodes
- [[orchestrateAudit()]] - degree 9, connects to 2 communities
- [[runTaxAuditor()]] - degree 5, connects to 2 communities
- [[fmtMoneyCop()]] - degree 7, connects to 1 community