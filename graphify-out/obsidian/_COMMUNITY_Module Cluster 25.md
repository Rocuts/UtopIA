---
type: community
cohesion: 0.08
members: 33
---

# Module Cluster 25

**Cohesion:** 0.08 - loosely connected
**Members:** 33 nodes

## Members
- [[GET()_12]] - code - app\api\cron\anomaly-detection\route.ts
- [[GET()_24]] - code - app\api\notifications\unsubscribe\route.ts
- [[_resetResendCache()]] - code - lib\notifications\sentinel-insight.ts
- [[buildIdempotencyKey()]] - code - app\api\cron\anomaly-detection\route.ts
- [[buildUnsubscribeToken()]] - code - lib\notifications\unsubscribe-token.ts
- [[buildUnsubscribeUrl()]] - code - lib\notifications\unsubscribe-token.ts
- [[computeScore()]] - code - lib\agents\financial\audit\forensic\score.ts
- [[countBySeverity()]] - code - lib\agents\financial\audit\forensic\score.ts
- [[dispatch()]] - code - lib\notifications\dispatch.ts
- [[dispatch.ts]] - code - lib\notifications\dispatch.ts
- [[dispatchWebPush()]] - code - lib\notifications\web-push.ts
- [[dispatchWhatsApp()]] - code - lib\notifications\whatsapp.ts
- [[emailSubject()]] - code - lib\notifications\dispatch.ts
- [[from-address.ts]] - code - lib\notifications\email\from-address.ts
- [[fromAddress()]] - code - lib\notifications\email\from-address.ts
- [[getResend()_1]] - code - lib\notifications\sentinel-insight.ts
- [[htmlPage()]] - code - app\api\notifications\unsubscribe\route.ts
- [[isVercelCronAuthorized()]] - code - app\api\cron\anomaly-detection\route.ts
- [[maybeSendAnomalyNotification()]] - code - app\api\cron\anomaly-detection\route.ts
- [[orchestrator.ts]] - code - lib\agents\financial\audit\forensic\orchestrator.ts
- [[renderEmailHtml()]] - code - lib\notifications\dispatch.ts
- [[route.ts_36]] - code - app\api\cron\anomaly-detection\route.ts
- [[route.ts_67]] - code - app\api\notifications\unsubscribe\route.ts
- [[runForensicScan()]] - code - lib\agents\financial\audit\forensic\orchestrator.ts
- [[score.ts]] - code - lib\agents\financial\audit\forensic\score.ts
- [[scoreSummary()]] - code - lib\agents\financial\audit\forensic\score.ts
- [[secret()]] - code - lib\notifications\unsubscribe-token.ts
- [[sendInsightAlert()]] - code - lib\notifications\sentinel-insight.ts
- [[sentinel-insight.ts]] - code - lib\notifications\sentinel-insight.ts
- [[unsubscribe-token.ts]] - code - lib\notifications\unsubscribe-token.ts
- [[verifyUnsubscribeToken()]] - code - lib\notifications\unsubscribe-token.ts
- [[web-push.ts]] - code - lib\notifications\web-push.ts
- [[whatsapp.ts]] - code - lib\notifications\whatsapp.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Module_Cluster_25
SORT file.name ASC
```

## Connections to other communities
- 1 edge to [[_COMMUNITY_Accounting Shared Utilities]]
- 1 edge to [[_COMMUNITY_Cron Jobs & ERP Webhooks]]

## Top bridge nodes
- [[GET()_12]] - degree 6, connects to 1 community
- [[sendInsightAlert()]] - degree 3, connects to 1 community