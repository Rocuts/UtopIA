---
type: community
cohesion: 0.06
members: 48
---

# Module Cluster 18

**Cohesion:** 0.06 - loosely connected
**Members:** 48 nodes

## Members
- [[.constructor()]] - code - app\api\pyme\_lib\ownership.ts
- [[GET()_25]] - code - app\api\pyme\books\[bookId]\route.ts
- [[GET()_27]] - code - app\api\pyme\entries\route.ts
- [[GET()_31]] - code - app\api\repair-session\route.ts
- [[HttpError]] - code - app\api\pyme\_lib\ownership.ts
- [[POST()_44]] - code - app\api\pyme\entries\route.ts
- [[POST()_46]] - code - app\api\pyme\reports\monthly\route.ts
- [[POST()_47]] - code - app\api\pyme\uploads\route.ts
- [[PUT()]] - code - app\api\repair-session\route.ts
- [[assertBookOwned()]] - code - app\api\pyme\_lib\ownership.ts
- [[buildCategorizerPrompt()]] - code - lib\agents\pyme\prompts\categorizer.prompt.ts
- [[buildNewEntry()]] - code - lib\agents\pyme\orchestrator.ts
- [[buildSummarizerPrompt()]] - code - lib\agents\pyme\prompts\summarizer.prompt.ts
- [[buildSystemPrompt()]] - code - lib\agents\pyme\extraction\vision-extractor.ts
- [[categorizeEntriesBatch()]] - code - lib\agents\pyme\agents\categorizer.ts
- [[categorizeEntry()]] - code - lib\agents\pyme\agents\categorizer.ts
- [[categorizer.prompt.ts]] - code - lib\agents\pyme\prompts\categorizer.prompt.ts
- [[categorizer.ts]] - code - lib\agents\pyme\agents\categorizer.ts
- [[clamp01()_1]] - code - lib\agents\pyme\orchestrator.ts
- [[computeAlerts()]] - code - lib\agents\pyme\agents\summarizer.ts
- [[entryToPrompt()]] - code - lib\agents\pyme\agents\categorizer.ts
- [[extractEntriesFromImage()]] - code - lib\agents\pyme\extraction\vision-extractor.ts
- [[fallbackCategorized()]] - code - lib\agents\pyme\agents\categorizer.ts
- [[formatPesos()]] - code - lib\agents\pyme\agents\summarizer.ts
- [[generateMonthlyReport()]] - code - lib\agents\pyme\orchestrator.ts
- [[handleError()_4]] - code - app\api\pyme\entries\route.ts
- [[image-preprocessor.ts]] - code - lib\agents\pyme\extraction\image-preprocessor.ts
- [[loadSession()]] - code - lib\agents\repair\persistence.ts
- [[normalizedLevenshtein()]] - code - lib\agents\pyme\extraction\image-preprocessor.ts
- [[orchestrator.ts_12]] - code - lib\agents\pyme\orchestrator.ts
- [[ownership.ts]] - code - app\api\pyme\_lib\ownership.ts
- [[parseIsoDate()]] - code - lib\agents\pyme\orchestrator.ts
- [[persistence.ts]] - code - lib\agents\repair\persistence.ts
- [[preprocessImage()]] - code - lib\agents\pyme\extraction\image-preprocessor.ts
- [[processUpload()]] - code - lib\agents\pyme\orchestrator.ts
- [[route.ts_68]] - code - app\api\pyme\books\[bookId]\route.ts
- [[route.ts_71]] - code - app\api\pyme\entries\route.ts
- [[route.ts_73]] - code - app\api\pyme\reports\monthly\route.ts
- [[route.ts_76]] - code - app\api\pyme\uploads\route.ts
- [[route.ts_80]] - code - app\api\repair-session\route.ts
- [[serializeEntry()_1]] - code - app\api\pyme\entries\route.ts
- [[summarizeMonth()]] - code - lib\agents\pyme\agents\summarizer.ts
- [[summarizer.prompt.ts]] - code - lib\agents\pyme\prompts\summarizer.prompt.ts
- [[summarizer.ts]] - code - lib\agents\pyme\agents\summarizer.ts
- [[upsertSession()]] - code - lib\agents\repair\persistence.ts
- [[validMagicBytes()]] - code - app\api\pyme\uploads\route.ts
- [[validateCrossSum()]] - code - lib\agents\pyme\extraction\vision-extractor.ts
- [[vision-extractor.ts]] - code - lib\agents\pyme\extraction\vision-extractor.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Module_Cluster_18
SORT file.name ASC
```

## Connections to other communities
- 10 edges to [[_COMMUNITY_Accounting Shared Utilities]]
- 1 edge to [[_COMMUNITY_Module Cluster 16]]
- 1 edge to [[_COMMUNITY_Core API Routes]]

## Top bridge nodes
- [[PUT()]] - degree 5, connects to 2 communities
- [[processUpload()]] - degree 7, connects to 1 community
- [[POST()_44]] - degree 6, connects to 1 community
- [[POST()_47]] - degree 6, connects to 1 community
- [[GET()_27]] - degree 5, connects to 1 community