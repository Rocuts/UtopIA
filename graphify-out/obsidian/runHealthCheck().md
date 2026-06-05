---
source_file: "lib\workflows\monthly-close\steps\health-check.ts"
type: "code"
community: "getDb() / getOrCreateWorkspace()"
location: "L21"
tags:
  - graphify/code
  - graphify/INFERRED
  - community/getDb()_/_getOrCreateWorkspace()
---

# runHealthCheck()

## Connections
- [[closeMonthWorkflow()]] - `calls` [INFERRED]
- [[getDraftEntriesCount()]] - `calls` [INFERRED]
- [[getPendingDocsCount()]] - `calls` [INFERRED]
- [[getUnbalancedPostedEntriesCount()]] - `calls` [INFERRED]
- [[health-check.ts]] - `contains` [EXTRACTED]
- [[isReconciliationBlocking()]] - `calls` [INFERRED]

#graphify/code #graphify/INFERRED #community/getDb()_/_getOrCreateWorkspace()