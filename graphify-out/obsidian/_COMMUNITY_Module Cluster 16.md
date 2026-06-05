---
type: community
cohesion: 0.06
members: 51
---

# Module Cluster 16

**Cohesion:** 0.06 - loosely connected
**Members:** 51 nodes

## Members
- [[.constructor()_7]] - code - lib\accounting\closing\types.ts
- [[ClosingError]] - code - lib\accounting\closing\types.ts
- [[GET()_16]] - code - app\api\cron\monthly-close\route.ts
- [[GET()_6]] - code - app\api\accounting\close\status\[runId]\route.ts
- [[POST()_13]] - code - app\api\accounting\close\start\route.ts
- [[buildCanonicalPayload()]] - code - lib\workflows\monthly-close\canonical.ts
- [[canonical.ts]] - code - lib\workflows\monthly-close\canonical.ts
- [[canonicalizeEntry()]] - code - lib\workflows\monthly-close\canonical.ts
- [[canonicalizeLine()]] - code - lib\workflows\monthly-close\canonical.ts
- [[closeApprovalHookToken()]] - code - lib\accounting\closing\types.ts
- [[closeMonthWorkflow()]] - code - lib\workflows\monthly-close\index.ts
- [[closing-entry.ts]] - code - lib\workflows\monthly-close\steps\closing-entry.ts
- [[computePeriodHash()]] - code - lib\workflows\monthly-close\steps\period-hash.ts
- [[generate-pdf.ts]] - code - lib\workflows\monthly-close\steps\generate-pdf.ts
- [[generateClosingEntry()]] - code - lib\workflows\monthly-close\steps\closing-entry.ts
- [[generatePdfReport()]] - code - lib\workflows\monthly-close\steps\generate-pdf.ts
- [[getAccountPeriodBalance()]] - code - lib\workflows\monthly-close\repository.ts
- [[getActiveWorkspacesWithCloseEnabled()]] - code - lib\workflows\monthly-close\repository.ts
- [[getDraftEntriesCount()]] - code - lib\workflows\monthly-close\repository.ts
- [[getPendingDocsCount()]] - code - lib\workflows\monthly-close\repository.ts
- [[getPeriodById()]] - code - lib\workflows\monthly-close\repository.ts
- [[getPeriodLabel()]] - code - lib\workflows\monthly-close\repository.ts
- [[getPeriodsEligibleForClose()]] - code - lib\workflows\monthly-close\repository.ts
- [[getPostedEntriesForPeriod()_1]] - code - lib\workflows\monthly-close\repository.ts
- [[getPreviousPeriod()]] - code - lib\workflows\monthly-close\repository.ts
- [[getPreviousPeriodHash()]] - code - lib\workflows\monthly-close\repository.ts
- [[getResultAccounts()]] - code - lib\workflows\monthly-close\repository.ts
- [[getRunById()]] - code - lib\workflows\monthly-close\repository.ts
- [[getRunByPeriodId()]] - code - lib\workflows\monthly-close\repository.ts
- [[getUnbalancedPostedEntriesCount()]] - code - lib\workflows\monthly-close\repository.ts
- [[getWorkspaceName()]] - code - lib\workflows\monthly-close\repository.ts
- [[health-check.ts]] - code - lib\workflows\monthly-close\steps\health-check.ts
- [[index.ts_27]] - code - lib\workflows\monthly-close\index.ts
- [[isMonthlyCloseEnabled()]] - code - lib\accounting\closing\types.ts
- [[lock-period.ts]] - code - lib\workflows\monthly-close\steps\lock-period.ts
- [[lockPeriod()]] - code - lib\workflows\monthly-close\steps\lock-period.ts
- [[notify.ts]] - code - lib\workflows\monthly-close\steps\notify.ts
- [[period-hash.ts]] - code - lib\workflows\monthly-close\steps\period-hash.ts
- [[persist-run.ts]] - code - lib\workflows\monthly-close\steps\persist-run.ts
- [[persistRunSnapshot()]] - code - lib\workflows\monthly-close\steps\persist-run.ts
- [[repository.ts_9]] - code - lib\workflows\monthly-close\repository.ts
- [[route.ts_19]] - code - app\api\accounting\close\start\route.ts
- [[route.ts_20]] - code - app\api\accounting\close\status\[runId]\route.ts
- [[route.ts_40]] - code - app\api\cron\monthly-close\route.ts
- [[run-adjustments.ts]] - code - lib\workflows\monthly-close\steps\run-adjustments.ts
- [[runAdjustments()]] - code - lib\workflows\monthly-close\steps\run-adjustments.ts
- [[runHealthCheck()]] - code - lib\workflows\monthly-close\steps\health-check.ts
- [[sendLockNotification()]] - code - lib\workflows\monthly-close\steps\notify.ts
- [[types.ts_9]] - code - lib\accounting\closing\types.ts
- [[updateCloseRun()]] - code - lib\workflows\monthly-close\repository.ts
- [[upsertCloseRun()]] - code - lib\workflows\monthly-close\repository.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Module_Cluster_16
SORT file.name ASC
```

## Connections to other communities
- 22 edges to [[_COMMUNITY_Accounting Shared Utilities]]
- 1 edge to [[_COMMUNITY_Module Cluster 18]]
- 1 edge to [[_COMMUNITY_Module Cluster 53]]

## Top bridge nodes
- [[generatePdfReport()]] - degree 5, connects to 2 communities
- [[getPeriodById()]] - degree 8, connects to 1 community
- [[generateClosingEntry()]] - degree 7, connects to 1 community
- [[upsertCloseRun()]] - degree 6, connects to 1 community
- [[runHealthCheck()]] - degree 6, connects to 1 community