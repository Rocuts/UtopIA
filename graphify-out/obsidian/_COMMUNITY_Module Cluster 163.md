---
type: community
cohesion: 0.67
members: 4
---

# Module Cluster 163

**Cohesion:** 0.67 - moderately connected
**Members:** 4 nodes

## Members
- [[3 Telemetry Entries per NIIF Report]] - document - docs/wave-notes/chunked-niif-analyst.md
- [[agent_telemetry Postgres Table]] - document - docs/TELEMETRY.md
- [[callFinancialAgent meta Object (Telemetry)]] - document - docs/TELEMETRY.md
- [[persistAgentTelemetry Function]] - document - docs/TELEMETRY.md

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Module_Cluster_163
SORT file.name ASC
```
