---
type: community
cohesion: 0.21
members: 16
---

# POST() / importOpeningBalance()

**Cohesion:** 0.21 - loosely connected
**Members:** 16 nodes

## Members
- [[POST()_18]] - code - app\api\accounting\opening-balance\route.ts
- [[centsToNumericString()]] - code - lib\accounting\opening-balance\import.ts
- [[extractExt()]] - code - app\api\accounting\opening-balance\route.ts
- [[getAccount()]] - code - lib\accounting\chart-of-accounts\queries.ts
- [[import.ts_1]] - code - lib\accounting\opening-balance\import.ts
- [[importOpeningBalance()]] - code - lib\accounting\opening-balance\import.ts
- [[importOpeningBalanceAction()]] - code - lib\accounting\actions\opening-balance-actions.ts
- [[isUuid()]] - code - app\api\accounting\opening-balance\route.ts
- [[jsonError()]] - code - app\api\accounting\opening-balance\route.ts
- [[mapErrorToResponse()]] - code - app\api\accounting\opening-balance\route.ts
- [[numericStringToCents()]] - code - lib\accounting\opening-balance\import.ts
- [[opening-balance-actions.ts]] - code - lib\accounting\actions\opening-balance-actions.ts
- [[parseEntryDate()]] - code - app\api\accounting\opening-balance\route.ts
- [[route.ts_25]] - code - app\api\accounting\opening-balance\route.ts
- [[toSerializableError()_2]] - code - lib\accounting\actions\opening-balance-actions.ts
- [[zodToActionError()_2]] - code - lib\accounting\actions\opening-balance-actions.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/POST()_/_importOpeningBalance()
SORT file.name ASC
```

## Connections to other communities
- 6 edges to [[_COMMUNITY_getDb()  getOrCreateWorkspace()]]
- 1 edge to [[_COMMUNITY_trial-balance.ts  orchestrator.ts]]

## Top bridge nodes
- [[POST()_18]] - degree 9, connects to 2 communities
- [[importOpeningBalance()]] - degree 7, connects to 1 community
- [[importOpeningBalanceAction()]] - degree 5, connects to 1 community
- [[getAccount()]] - degree 4, connects to 1 community