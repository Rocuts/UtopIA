---
type: community
cohesion: 0.05
members: 65
---

# Cron Jobs & ERP Webhooks

**Cohesion:** 0.05 - loosely connected
**Members:** 65 nodes

## Members
- [[EscudoTrendBars.tsx]] - code - components\workspace\pillars\EscudoTrendBars.tsx
- [[FiscalAnchorCard.tsx]] - code - components\workspace\cards\FiscalAnchorCard.tsx
- [[GET()_14]] - code - app\api\cron\erp-sync\route.ts
- [[GET()_17]] - code - app\api\cron\sentinel\route.ts
- [[MoneyCop()]] - code - components\workspace\cards\FiscalAnchorCard.tsx
- [[POST()_50]] - code - app\api\sentinel\check\route.ts
- [[POST()_27]] - code - app\api\erp\webhook\[provider]\route.ts
- [[aggregateLedger()]] - code - lib\cache\preprocessed-balance.ts
- [[credentials.ts]] - code - lib\erp\credentials.ts
- [[currentPeriod()]] - code - app\api\cron\erp-sync\route.ts
- [[decryptSecret()]] - code - lib\security\vault.ts
- [[decryptWithKey()]] - code - lib\security\vault.ts
- [[encryptSecret()]] - code - lib\security\vault.ts
- [[encryptWithKey()]] - code - lib\security\vault.ts
- [[evaluateEscalation()]] - code - lib\workflows\sentinel\relevance-learning.ts
- [[evaluateTriggers()]] - code - lib\workflows\sentinel\orchestrator.ts
- [[evaluateTriggersForTest()]] - code - lib\workflows\sentinel\orchestrator.ts
- [[fillInsightFromTemplate()]] - code - lib\notifications\insight-templates.ts
- [[findComparativePeriod()]] - code - lib\cache\preprocessed-balance.ts
- [[findCredentialByToken()]] - code - app\api\erp\webhook\[provider]\route.ts
- [[formatCop()_9]] - code - lib\workflows\sentinel\triggers\r1-truth-gap.ts
- [[formatCop()_10]] - code - lib\workflows\sentinel\triggers\r2-shield-liquidity.ts
- [[formatDeadlineDate()]] - code - components\workspace\cards\FiscalAnchorCard.tsx
- [[formatValue()_1]] - code - components\workspace\pillars\EscudoTrendBars.tsx
- [[getCachedAccountsFlat()]] - code - lib\cache\ledger-queries.ts
- [[getCachedPreprocessedBalance()]] - code - lib\cache\preprocessed-balance.ts
- [[getInsightTemplate()]] - code - lib\notifications\insight-templates.ts
- [[getLatestOpenPeriod()]] - code - lib\cache\preprocessed-balance.ts
- [[getValue()]] - code - components\workspace\pillars\EscudoTrendBars.tsx
- [[inferLevel()]] - code - lib\cache\preprocessed-balance.ts
- [[insight-templates.ts]] - code - lib\notifications\insight-templates.ts
- [[interpolate()_1]] - code - lib\notifications\insight-templates.ts
- [[isAuthorized()]] - code - app\api\cron\erp-sync\route.ts
- [[isEncryptedEnvelope()]] - code - lib\security\vault.ts
- [[isSolvenciaNull()]] - code - components\workspace\pillars\EscudoTrendBars.tsx
- [[isValidProvider()]] - code - app\api\erp\webhook\[provider]\route.ts
- [[loadCredentials()]] - code - lib\erp\credentials.ts
- [[loadKey()]] - code - lib\security\vault.ts
- [[loadSentinelData()]] - code - lib\workflows\sentinel\orchestrator.ts
- [[loadTrialBalanceRows()]] - code - lib\cache\preprocessed-balance.ts
- [[naturalSide()]] - code - lib\cache\preprocessed-balance.ts
- [[orchestrator.ts_13]] - code - lib\workflows\sentinel\orchestrator.ts
- [[parsePayload()]] - code - app\api\erp\webhook\[provider]\route.ts
- [[periodLabel()_3]] - code - lib\cache\preprocessed-balance.ts
- [[persistAndNotify()]] - code - lib\workflows\sentinel\orchestrator.ts
- [[preprocessed-balance.ts]] - code - lib\cache\preprocessed-balance.ts
- [[r1-truth-gap.ts]] - code - lib\workflows\sentinel\triggers\r1-truth-gap.ts
- [[r2-shield-liquidity.ts]] - code - lib\workflows\sentinel\triggers\r2-shield-liquidity.ts
- [[r3-value-anomaly.ts]] - code - lib\workflows\sentinel\triggers\r3-value-anomaly.ts
- [[r4-future-inflection.ts]] - code - lib\workflows\sentinel\triggers\r4-future-inflection.ts
- [[relevance-learning.ts]] - code - lib\workflows\sentinel\relevance-learning.ts
- [[route.ts_38]] - code - app\api\cron\erp-sync\route.ts
- [[route.ts_41]] - code - app\api\cron\sentinel\route.ts
- [[route.ts_46]] - code - app\api\erp\webhook\[provider]\route.ts
- [[route.ts_82]] - code - app\api\sentinel\check\route.ts
- [[runSentinelCheck()]] - code - lib\workflows\sentinel\orchestrator.ts
- [[runT1()]] - code - lib\workflows\sentinel\triggers\r1-truth-gap.ts
- [[runT2()]] - code - lib\workflows\sentinel\triggers\r2-shield-liquidity.ts
- [[runT3()]] - code - lib\workflows\sentinel\triggers\r3-value-anomaly.ts
- [[runT4()]] - code - lib\workflows\sentinel\triggers\r4-future-inflection.ts
- [[serializeCredentials()]] - code - lib\erp\credentials.ts
- [[syncTrialBalance()]] - code - app\api\erp\webhook\[provider]\route.ts
- [[syncWorkspace()]] - code - app\api\cron\erp-sync\route.ts
- [[tryDecryptWithRotation()]] - code - lib\security\vault.ts
- [[vault.ts]] - code - lib\security\vault.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Cron_Jobs_&_ERP_Webhooks
SORT file.name ASC
```

## Connections to other communities
- 12 edges to [[_COMMUNITY_Accounting Shared Utilities]]
- 1 edge to [[_COMMUNITY_Core API Routes]]
- 1 edge to [[_COMMUNITY_Module Cluster 25]]
- 1 edge to [[_COMMUNITY_Platform Pillar Config]]

## Top bridge nodes
- [[persistAndNotify()]] - degree 5, connects to 2 communities
- [[getCachedPreprocessedBalance()]] - degree 7, connects to 1 community
- [[loadTrialBalanceRows()]] - degree 7, connects to 1 community
- [[POST()_50]] - degree 7, connects to 1 community
- [[getLatestOpenPeriod()]] - degree 6, connects to 1 community