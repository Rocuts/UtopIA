---
type: community
cohesion: 0.31
members: 11
---

# queryActivityFeed() / activity-feed.ts

**Cohesion:** 0.31 - loosely connected
**Members:** 11 nodes

## Members
- [[GET()_9]] - code - app\api\admin\activity\route.ts
- [[activity-feed.ts]] - code - lib\observability\activity-feed.ts
- [[csv()]] - code - app\api\admin\activity\route.ts
- [[fmtUsd()]] - code - lib\observability\activity-feed.ts
- [[normalizeActivity()]] - code - lib\observability\activity-feed.ts
- [[normalizeAgent()]] - code - lib\observability\activity-feed.ts
- [[normalizeNotification()]] - code - lib\observability\activity-feed.ts
- [[normalizeTax()]] - code - lib\observability\activity-feed.ts
- [[queryActivityFeed()]] - code - lib\observability\activity-feed.ts
- [[resolveSources()]] - code - lib\observability\activity-feed.ts
- [[route.ts_31]] - code - app\api\admin\activity\route.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/queryActivityFeed()_/_activity-feed.ts
SORT file.name ASC
```

## Connections to other communities
- 1 edge to [[_COMMUNITY_getDb()  getOrCreateWorkspace()]]

## Top bridge nodes
- [[queryActivityFeed()]] - degree 8, connects to 1 community