---
type: community
cohesion: 0.08
members: 37
---

# route.ts / vectorstore.ts

**Cohesion:** 0.08 - loosely connected
**Members:** 37 nodes

## Members
- [[.constructor()_1]] - code - app\api\upload\route.ts
- [[POST()_48]] - code - app\api\rag\route.ts
- [[POST()_57]] - code - app\api\upload\route.ts
- [[UploadError]] - code - app\api\upload\route.ts
- [[addDocumentsToStore()]] - code - lib\rag\vectorstore.ts
- [[asyncPool()]] - code - lib\rag\ingest.ts
- [[cellToString()]] - code - app\api\upload\route.ts
- [[chunkText()]] - code - lib\rag\vectorstore.ts
- [[classifyDocument()]] - code - app\api\upload\route.ts
- [[deriveFilenameFromBlobUrl()]] - code - app\api\upload\route.ts
- [[detectYearFromString()]] - code - lib\preprocessing\trial-balance.ts
- [[embedSingle()]] - code - lib\rag\vectorstore.ts
- [[extractText()]] - code - app\api\upload\route.ts
- [[extractTextFromImage()]] - code - app\api\upload\route.ts
- [[extractTextFromScannedPDF()]] - code - app\api\upload\route.ts
- [[generateContextualPrefix()]] - code - lib\rag\ingest.ts
- [[getBackendStatus()]] - code - lib\rag\vectorstore.ts
- [[getStaticPrefix()]] - code - lib\rag\ingest.ts
- [[getStoragePath()]] - code - lib\rag\vectorstore.ts
- [[getStoreStats()]] - code - lib\rag\vectorstore.ts
- [[hybridSearch()]] - code - lib\rag\vectorstore.ts
- [[ingest.ts]] - code - lib\rag\ingest.ts
- [[ingestData()]] - code - lib\rag\ingest.ts
- [[init.ts]] - code - lib\rag\init.ts
- [[initRagSchema()]] - code - lib\rag\init.ts
- [[invalidateVectorStore()]] - code - lib\rag\vectorstore.ts
- [[maybeRerank()]] - code - lib\rag\vectorstore.ts
- [[parseFrontmatter()]] - code - lib\rag\ingest.ts
- [[processDocument()]] - code - app\api\upload\route.ts
- [[resetRagInit()]] - code - lib\rag\init.ts
- [[route.ts_77]] - code - app\api\rag\route.ts
- [[route.ts_89]] - code - app\api\upload\route.ts
- [[searchDocuments()]] - code - lib\rag\vectorstore.ts
- [[stripBOM()]] - code - app\api\upload\route.ts
- [[validateMagicBytes()]] - code - app\api\upload\route.ts
- [[vectorstore.ts]] - code - lib\rag\vectorstore.ts
- [[withTimeout()]] - code - lib\rag\ingest.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/route.ts_/_vectorstore.ts
SORT file.name ASC
```

## Connections to other communities
- 4 edges to [[_COMMUNITY_getDb()  getOrCreateWorkspace()]]
- 3 edges to [[_COMMUNITY_trial-balance.ts  orchestrator.ts]]
- 1 edge to [[_COMMUNITY_executeTool()  getTaxCalendar()]]

## Top bridge nodes
- [[processDocument()]] - degree 9, connects to 1 community
- [[ingestData()]] - degree 7, connects to 1 community
- [[searchDocuments()]] - degree 7, connects to 1 community
- [[addDocumentsToStore()]] - degree 5, connects to 1 community
- [[getStoreStats()]] - degree 3, connects to 1 community