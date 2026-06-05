---
type: community
cohesion: 0.11
members: 25
---

# promoteEntries() / entry-builder.ts

**Cohesion:** 0.11 - loosely connected
**Members:** 25 nodes

## Members
- [[.constructor()_9]] - code - lib\accounting\tax-engine\types.ts
- [[POST()_45]] - code - app\api\pyme\promote\route.ts
- [[TaxEngineError]] - code - lib\accounting\tax-engine\types.ts
- [[account-mapper.ts]] - code - lib\agents\pyme\promote\account-mapper.ts
- [[buildGroupEntry()]] - code - lib\agents\pyme\promote\entry-builder.ts
- [[buildSimpleLines()]] - code - lib\agents\pyme\promote\entry-builder.ts
- [[centavosToNumericStr()]] - code - lib\agents\pyme\promote\entry-builder.ts
- [[entry-builder.ts]] - code - lib\agents\pyme\promote\entry-builder.ts
- [[extractBookId()]] - code - lib\agents\pyme\promote\repository.ts
- [[findAccountForKind()]] - code - lib\agents\pyme\promote\repository.ts
- [[groupEntries()]] - code - lib\agents\pyme\promote\entry-builder.ts
- [[index.ts_21]] - code - lib\agents\pyme\promote\index.ts
- [[isOcrPromoteEnabled()]] - code - lib\agents\pyme\promote\index.ts
- [[isTaxEngineEnabled()]] - code - lib\accounting\tax-engine\types.ts
- [[loadConfirmedEntries()]] - code - lib\agents\pyme\promote\repository.ts
- [[looksLikeInvoice()]] - code - lib\agents\pyme\promote\index.ts
- [[mapCategoryToAccount()]] - code - lib\agents\pyme\promote\account-mapper.ts
- [[parseDateKey()]] - code - lib\agents\pyme\promote\entry-builder.ts
- [[parseToCentavos()]] - code - lib\agents\pyme\promote\entry-builder.ts
- [[promoteEntries()]] - code - lib\agents\pyme\promote\index.ts
- [[repository.ts_7]] - code - lib\agents\pyme\promote\repository.ts
- [[resolveCajaAccount()]] - code - lib\agents\pyme\promote\account-mapper.ts
- [[route.ts_72]] - code - app\api\pyme\promote\route.ts
- [[toDateKey()]] - code - lib\agents\pyme\promote\entry-builder.ts
- [[types.ts_11]] - code - lib\accounting\tax-engine\types.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/promoteEntries()_/_entry-builder.ts
SORT file.name ASC
```

## Connections to other communities
- 7 edges to [[_COMMUNITY_getDb()  getOrCreateWorkspace()]]

## Top bridge nodes
- [[promoteEntries()]] - degree 11, connects to 1 community
- [[mapCategoryToAccount()]] - degree 4, connects to 1 community
- [[POST()_45]] - degree 4, connects to 1 community
- [[resolveCajaAccount()]] - degree 3, connects to 1 community
- [[findAccountForKind()]] - degree 3, connects to 1 community