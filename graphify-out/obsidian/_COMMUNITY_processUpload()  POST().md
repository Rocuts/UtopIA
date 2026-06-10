---
type: community
cohesion: 0.07
members: 39
---

# processUpload() / POST()

**Cohesion:** 0.07 - loosely connected
**Members:** 39 nodes

## Members
- [[.constructor()]] - code - app\api\pyme\_lib\ownership.ts
- [[GET()_25]] - code - app\api\pyme\books\[bookId]\route.ts
- [[GET()_27]] - code - app\api\pyme\entries\route.ts
- [[HttpError]] - code - app\api\pyme\_lib\ownership.ts
- [[POST()_44]] - code - app\api\pyme\entries\route.ts
- [[POST()_46]] - code - app\api\pyme\reports\monthly\route.ts
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
- [[normalizedLevenshtein()]] - code - lib\agents\pyme\extraction\image-preprocessor.ts
- [[orchestrator.ts_12]] - code - lib\agents\pyme\orchestrator.ts
- [[ownership.ts]] - code - app\api\pyme\_lib\ownership.ts
- [[parseIsoDate()]] - code - lib\agents\pyme\orchestrator.ts
- [[preprocessImage()]] - code - lib\agents\pyme\extraction\image-preprocessor.ts
- [[processUpload()]] - code - lib\agents\pyme\orchestrator.ts
- [[route.ts_68]] - code - app\api\pyme\books\[bookId]\route.ts
- [[route.ts_71]] - code - app\api\pyme\entries\route.ts
- [[route.ts_73]] - code - app\api\pyme\reports\monthly\route.ts
- [[serializeEntry()_1]] - code - app\api\pyme\entries\route.ts
- [[summarizeMonth()]] - code - lib\agents\pyme\agents\summarizer.ts
- [[summarizer.prompt.ts]] - code - lib\agents\pyme\prompts\summarizer.prompt.ts
- [[summarizer.ts]] - code - lib\agents\pyme\agents\summarizer.ts
- [[validateCrossSum()]] - code - lib\agents\pyme\extraction\vision-extractor.ts
- [[vision-extractor.ts]] - code - lib\agents\pyme\extraction\vision-extractor.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/processUpload()_/_POST()
SORT file.name ASC
```

## Connections to other communities
- 7 edges to [[_COMMUNITY_getDb()  getOrCreateWorkspace()]]
- 1 edge to [[_COMMUNITY_trial-balance.ts  orchestrator.ts]]

## Top bridge nodes
- [[processUpload()]] - degree 7, connects to 2 communities
- [[POST()_44]] - degree 6, connects to 1 community
- [[assertBookOwned()]] - degree 6, connects to 1 community
- [[GET()_27]] - degree 5, connects to 1 community
- [[POST()_46]] - degree 5, connects to 1 community