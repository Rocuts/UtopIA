---
type: community
cohesion: 1.00
members: 2
---

# GET /api/admin/telemetry Endpoint / Telemetry Alert Thresholds (P0/P1)

**Cohesion:** 1.00 - tightly connected
**Members:** 2 nodes

## Members
- [[GET apiadmintelemetry Endpoint]] - document - docs/TELEMETRY.md
- [[Telemetry Alert Thresholds (P0P1)]] - document - docs/TELEMETRY.md

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/GET_/api/admin/telemetry_Endpoint_/_Telemetry_Alert_Thresholds_(P0/P1)
SORT file.name ASC
```
