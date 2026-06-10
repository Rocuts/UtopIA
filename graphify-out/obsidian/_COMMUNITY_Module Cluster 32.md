---
type: community
cohesion: 0.14
members: 24
---

# Module Cluster 32

**Cohesion:** 0.14 - loosely connected
**Members:** 24 nodes

## Members
- [[POST()_52]] - code - app\api\tax-reconciliation\route.ts
- [[buildConsolidatedReport()_4]] - code - lib\agents\financial\tax-reconciliation\orchestrator.ts
- [[classificationLabel()]] - code - lib\agents\financial\tax-reconciliation\agents\difference-identifier.ts
- [[deferred-tax-calculator.ts]] - code - lib\agents\financial\tax-reconciliation\agents\deferred-tax-calculator.ts
- [[difference-identifier.ts]] - code - lib\agents\financial\tax-reconciliation\agents\difference-identifier.ts
- [[handleStreaming()_11]] - code - app\api\tax-reconciliation\route.ts
- [[money()_2]] - code - lib\agents\financial\tax-reconciliation\agents\deferred-tax-calculator.ts
- [[money()_3]] - code - lib\agents\financial\tax-reconciliation\agents\difference-identifier.ts
- [[orchestrateTaxReconciliation()]] - code - lib\agents\financial\tax-reconciliation\orchestrator.ts
- [[orchestrator.ts_8]] - code - lib\agents\financial\tax-reconciliation\orchestrator.ts
- [[renderBreakdown()]] - code - lib\agents\financial\tax-reconciliation\agents\deferred-tax-calculator.ts
- [[renderBridge()]] - code - lib\agents\financial\tax-reconciliation\agents\difference-identifier.ts
- [[renderCategory()]] - code - lib\agents\financial\tax-reconciliation\agents\difference-identifier.ts
- [[renderDtaDtl()]] - code - lib\agents\financial\tax-reconciliation\agents\deferred-tax-calculator.ts
- [[renderEffectiveRate()]] - code - lib\agents\financial\tax-reconciliation\agents\deferred-tax-calculator.ts
- [[renderFormato()]] - code - lib\agents\financial\tax-reconciliation\agents\deferred-tax-calculator.ts
- [[renderFormato2516Mapping()]] - code - lib\agents\financial\tax-reconciliation\agents\difference-identifier.ts
- [[renderJournalEntries()]] - code - lib\agents\financial\tax-reconciliation\agents\deferred-tax-calculator.ts
- [[renderWorksheet()]] - code - lib\agents\financial\tax-reconciliation\agents\deferred-tax-calculator.ts
- [[route.ts_84]] - code - app\api\tax-reconciliation\route.ts
- [[runDeferredTaxCalculator()]] - code - lib\agents\financial\tax-reconciliation\agents\deferred-tax-calculator.ts
- [[runDifferenceIdentifier()]] - code - lib\agents\financial\tax-reconciliation\agents\difference-identifier.ts
- [[toLegacyShape()_10]] - code - lib\agents\financial\tax-reconciliation\agents\deferred-tax-calculator.ts
- [[toLegacyShape()_11]] - code - lib\agents\financial\tax-reconciliation\agents\difference-identifier.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Module_Cluster_32
SORT file.name ASC
```

## Connections to other communities
- 4 edges to [[_COMMUNITY_Financial Agent Pipelines]]
- 2 edges to [[_COMMUNITY_Audit & Compliance Agents]]
- 2 edges to [[_COMMUNITY_NIIF Analyst Pipeline]]

## Top bridge nodes
- [[runDeferredTaxCalculator()]] - degree 5, connects to 2 communities
- [[runDifferenceIdentifier()]] - degree 5, connects to 2 communities
- [[money()_2]] - degree 5, connects to 1 community
- [[money()_3]] - degree 4, connects to 1 community