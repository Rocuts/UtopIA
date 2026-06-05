---
type: community
cohesion: 0.08
members: 43
---

# Module Cluster 19

**Cohesion:** 0.08 - loosely connected
**Members:** 43 nodes

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
- [[fmtMoneyOrND()_1]] - code - lib\agents\financial\audit\agents\legal-auditor.ts
- [[fmtMoneyOrNa()]] - code - lib\agents\financial\audit\agents\tax-auditor.ts
- [[fmtPctOrNa()]] - code - lib\agents\financial\audit\agents\tax-auditor.ts
- [[handleStreaming()_4]] - code - app\api\financial-audit\route.ts
- [[horizonLabel()]] - code - lib\agents\financial\audit\agents\niif-auditor.ts
- [[legal-auditor.ts]] - code - lib\agents\financial\audit\agents\legal-auditor.ts
- [[mapFinding()_1]] - code - lib\agents\financial\audit\agents\legal-auditor.ts
- [[mapFinding()_2]] - code - lib\agents\financial\audit\agents\niif-auditor.ts
- [[mapFinding()_3]] - code - lib\agents\financial\audit\agents\tax-auditor.ts
- [[niif-auditor.ts]] - code - lib\agents\financial\audit\agents\niif-auditor.ts
- [[opinionLabel()]] - code - lib\agents\financial\audit\agents\niif-auditor.ts
- [[orchestrateAudit()]] - code - lib\agents\financial\audit\orchestrator.ts
- [[orchestrator.ts_1]] - code - lib\agents\financial\audit\orchestrator.ts
- [[priorityLabel()]] - code - lib\agents\financial\audit\agents\tax-auditor.ts
- [[renderLegacyMarkdown()]] - code - lib\agents\financial\audit\agents\niif-auditor.ts
- [[renderLegacyMarkdown()_1]] - code - lib\agents\financial\audit\agents\tax-auditor.ts
- [[renderLegalAuditorMarkdown()]] - code - lib\agents\financial\audit\agents\legal-auditor.ts
- [[renderMarkdown()_1]] - code - lib\agents\financial\audit\agents\legal-auditor.ts
- [[renderMarkdown()_2]] - code - lib\agents\financial\audit\agents\niif-auditor.ts
- [[renderMarkdown()_3]] - code - lib\agents\financial\audit\agents\tax-auditor.ts
- [[renderNiifDictamenMarkdown()]] - code - lib\agents\financial\audit\agents\niif-auditor.ts
- [[renderTaxDictamenMarkdown()]] - code - lib\agents\financial\audit\agents\tax-auditor.ts
- [[riesgoIcon()]] - code - lib\agents\financial\audit\agents\tax-auditor.ts
- [[route.ts_52]] - code - app\api\financial-audit\route.ts
- [[runLegalAuditor()]] - code - lib\agents\financial\audit\agents\legal-auditor.ts
- [[runNiifAuditor()]] - code - lib\agents\financial\audit\agents\niif-auditor.ts
- [[runTaxAuditor()]] - code - lib\agents\financial\audit\agents\tax-auditor.ts
- [[statusIcon()]] - code - lib\agents\financial\audit\agents\niif-auditor.ts
- [[tax-auditor.ts]] - code - lib\agents\financial\audit\agents\tax-auditor.ts
- [[taxOpinionLabel()]] - code - lib\agents\financial\audit\agents\tax-auditor.ts
- [[tmtIcon()]] - code - lib\agents\financial\audit\agents\tax-auditor.ts
- [[toLegacyAuditorResult()_1]] - code - lib\agents\financial\audit\agents\legal-auditor.ts
- [[toLegacyAuditorResult()_2]] - code - lib\agents\financial\audit\agents\niif-auditor.ts
- [[toLegacyAuditorResult()_3]] - code - lib\agents\financial\audit\agents\tax-auditor.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Module_Cluster_19
SORT file.name ASC
```

## Connections to other communities
- 5 edges to [[_COMMUNITY_Financial Agent Pipelines]]
- 3 edges to [[_COMMUNITY_Audit & Compliance Agents]]
- 3 edges to [[_COMMUNITY_NIIF Analyst Pipeline]]

## Top bridge nodes
- [[runLegalAuditor()]] - degree 5, connects to 2 communities
- [[runNiifAuditor()]] - degree 5, connects to 2 communities
- [[runTaxAuditor()]] - degree 5, connects to 2 communities
- [[orchestrateAudit()]] - degree 9, connects to 1 community
- [[fmtMoneyCop()]] - degree 7, connects to 1 community