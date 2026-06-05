---
type: community
cohesion: 0.03
members: 87
---

# repository.ts / erp-query.ts

**Cohesion:** 0.03 - loosely connected
**Members:** 87 nodes

## Members
- [[.constructor()_16]] - code - lib\erp\pipeline.ts
- [[ERPPipelineError]] - code - lib\erp\pipeline.ts
- [[GET()_19]] - code - app\api\escudo\fiscal-anchor\route.ts
- [[GET()_28]] - code - app\api\pyme\uploads\[uploadId]\image\route.ts
- [[GET()_18]] - code - app\api\erp\providers\route.ts
- [[GET()_30]] - code - app\api\realtime\route.ts
- [[GET()_29]] - code - app\api\pyme\uploads\[uploadId]\route.ts
- [[POST()_24]] - code - app\api\chat\route.ts
- [[POST()_25]] - code - app\api\erp\connect\route.ts
- [[POST()_29]] - code - app\api\escudo\fiscal-anchor\route.ts
- [[POST()_28]] - code - app\api\escudo\fiscal\route.ts
- [[POST()_26]] - code - app\api\erp\sync\route.ts
- [[VerdadOverviewPage()]] - code - app\workspace\verdad\page.tsx
- [[activity-log.ts]] - code - lib\db\activity-log.ts
- [[alert-mapping.ts]] - code - lib\agents\financial\escudo-survival\fiscal-anchor\alert-mapping.ts
- [[alertRowToView()]] - code - lib\agents\financial\escudo-survival\fiscal-anchor\alert-mapping.ts
- [[buildKpiFromPillar()]] - code - app\workspace\verdad\page.tsx
- [[buildNITContext()]] - code - lib\security\pii-filter.ts
- [[bumpReemitted()]] - code - lib\workflows\sentinel\repository.ts
- [[countAlerts()]] - code - lib\workflows\sentinel\repository.ts
- [[createPIIContext()]] - code - lib\security\pii-filter.ts
- [[currentPeriodId()]] - code - app\workspace\verdad\page.tsx
- [[enabledFor()]] - code - lib\agents\financial\escudo-survival\fiscal-agent\orchestrator.ts
- [[erp-query.ts]] - code - lib\tools\erp-query.ts
- [[exportConversationPDF()]] - code - lib\export\pdf-export.ts
- [[extractNITContext()]] - code - lib\security\pii-filter.ts
- [[findAlertById()]] - code - lib\workflows\sentinel\repository.ts
- [[findPendingAlertsForWorkspace()]] - code - lib\workflows\sentinel\repository.ts
- [[fiscalAlertaToInsight()]] - code - lib\agents\financial\escudo-survival\fiscal-anchor\alert-mapping.ts
- [[formatCOP()_25]] - code - lib\tools\erp-query.ts
- [[formatChartOfAccounts()]] - code - lib\tools\erp-query.ts
- [[formatContacts()]] - code - lib\tools\erp-query.ts
- [[formatInvoices()]] - code - lib\tools\erp-query.ts
- [[formatJournalEntries()]] - code - lib\tools\erp-query.ts
- [[formatTrialBalance()]] - code - lib\tools\erp-query.ts
- [[getConnector()]] - code - lib\erp\registry.ts
- [[getCurrentWorkspaceId()]] - code - lib\db\workspace.ts
- [[getProvidersByCountry()]] - code - lib\erp\registry.ts
- [[handleLegacy()]] - code - app\api\chat\route.ts
- [[handleOrchestrated()]] - code - app\api\chat\route.ts
- [[handleStreaming()_1]] - code - app\api\escudo\fiscal\route.ts
- [[impactoCentsForAlert()]] - code - lib\agents\financial\escudo-survival\fiscal-anchor\alert-mapping.ts
- [[isOrchestrationMode()]] - code - app\api\chat\route.ts
- [[listAlertsForWorkspace()]] - code - lib\workflows\sentinel\repository.ts
- [[logActivity()]] - code - lib\db\activity-log.ts
- [[logApiActivity()]] - code - lib\db\activity-log.ts
- [[markEscalated()]] - code - lib\workflows\sentinel\repository.ts
- [[markdownToPdfLines()]] - code - lib\export\pdf-export.ts
- [[orchestrateFiscalAgent()]] - code - lib\agents\financial\escudo-survival\fiscal-agent\orchestrator.ts
- [[orchestrator.ts_2]] - code - lib\agents\financial\escudo-survival\fiscal-agent\orchestrator.ts
- [[page.tsx_35]] - code - app\workspace\verdad\page.tsx
- [[parseInlineMarkdown()]] - code - lib\export\pdf-export.ts
- [[parseMarkdownTable()]] - code - lib\export\pdf-export.ts
- [[parsePeriod()]] - code - lib\tools\erp-query.ts
- [[pdf-export.ts]] - code - lib\export\pdf-export.ts
- [[pii-filter.ts]] - code - lib\security\pii-filter.ts
- [[pipeline.ts]] - code - lib\erp\pipeline.ts
- [[pullTrialBalanceForPeriod()]] - code - lib\erp\pipeline.ts
- [[queryERP()]] - code - lib\tools\erp-query.ts
- [[redactPII()]] - code - lib\security\pii-filter.ts
- [[redactPIIWithContext()]] - code - lib\security\pii-filter.ts
- [[registry.ts_1]] - code - lib\erp\registry.ts
- [[renderAssistantContent()]] - code - lib\export\pdf-export.ts
- [[renderPdfLines()]] - code - lib\export\pdf-export.ts
- [[renderTable()]] - code - lib\export\pdf-export.ts
- [[repository.ts_10]] - code - lib\workflows\sentinel\repository.ts
- [[requireWorkspace()]] - code - lib\db\workspace.ts
- [[resolveAlert()]] - code - lib\workflows\sentinel\repository.ts
- [[resolveDateRange()]] - code - lib\tools\erp-query.ts
- [[route.ts_35]] - code - app\api\chat\route.ts
- [[route.ts_42]] - code - app\api\erp\connect\route.ts
- [[route.ts_43]] - code - app\api\erp\providers\route.ts
- [[route.ts_45]] - code - app\api\erp\sync\route.ts
- [[route.ts_49]] - code - app\api\escudo\fiscal-anchor\route.ts
- [[route.ts_47]] - code - app\api\escudo\fiscal\route.ts
- [[route.ts_74]] - code - app\api\pyme\uploads\[uploadId]\image\route.ts
- [[route.ts_75]] - code - app\api\pyme\uploads\[uploadId]\route.ts
- [[route.ts_78]] - code - app\api\realtime\route.ts
- [[runOrSettle()]] - code - lib\agents\financial\escudo-survival\fiscal-agent\orchestrator.ts
- [[saldoAFavorCents()]] - code - lib\agents\financial\escudo-survival\fiscal-agent\tools\risk-score-calculator.ts
- [[selectModules()]] - code - lib\agents\financial\escudo-survival\fiscal-agent\orchestrator.ts
- [[serializeTrialBalance()]] - code - lib\erp\pipeline.ts
- [[snoozeAlert()]] - code - lib\workflows\sentinel\repository.ts
- [[trunc()]] - code - lib\db\activity-log.ts
- [[unsnoozeAlert()]] - code - lib\workflows\sentinel\repository.ts
- [[upsertAlert()]] - code - lib\workflows\sentinel\repository.ts
- [[workspace.ts]] - code - lib\db\workspace.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/repository.ts_/_erp-query.ts
SORT file.name ASC
```

## Connections to other communities
- 9 edges to [[_COMMUNITY_getDb()  getOrCreateWorkspace()]]
- 3 edges to [[_COMMUNITY_trial-balance.ts  orchestrator.ts]]
- 1 edge to [[_COMMUNITY_runHtmlEditor()  orchestrate()]]
- 1 edge to [[_COMMUNITY_formatCopFromCents()  parseMoneyCop()]]
- 1 edge to [[_COMMUNITY_buildFiscalAnchor()  dian-calendar.ts]]
- 1 edge to [[_COMMUNITY_risk-score-calculator.ts  computeRiskScore()]]
- 1 edge to [[_COMMUNITY_executeTool()  getTaxCalendar()]]

## Top bridge nodes
- [[logActivity()]] - degree 6, connects to 2 communities
- [[orchestrateFiscalAgent()]] - degree 6, connects to 2 communities
- [[saldoAFavorCents()]] - degree 3, connects to 2 communities
- [[queryERP()]] - degree 9, connects to 1 community
- [[getCurrentWorkspaceId()]] - degree 6, connects to 1 community