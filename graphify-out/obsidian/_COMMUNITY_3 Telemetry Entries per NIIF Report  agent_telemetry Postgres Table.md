---
type: community
cohesion: 0.67
members: 4
---

# 3 Telemetry Entries per NIIF Report / agent_telemetry Postgres Table

**Cohesion:** 0.67 - moderately connected
**Members:** 4 nodes

## Members
- [[3 Telemetry Entries per NIIF Report]] - document - docs/wave-notes/chunked-niif-analyst.md
- [[agent_telemetry Postgres Table]] - document - docs/TELEMETRY.md
- [[callFinancialAgent meta Object (Telemetry)]] - document - docs/TELEMETRY.md
- [[persistAgentTelemetry Function]] - document - docs/TELEMETRY.md

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/3_Telemetry_Entries_per_NIIF_Report_/_agent_telemetry_Postgres_Table
SORT file.name ASC
```
