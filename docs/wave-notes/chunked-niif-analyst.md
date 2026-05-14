# Chunked NIIF Analyst — 3 sequential passes (Fase 3 DONE 2026-05-12)

The NIIF Analyst (`src/lib/agents/financial/agents/niif-analyst.ts`) ejecuta 3 `callFinancialAgent` secuenciales contra `MODELS.FINANCIAL_PIPELINE` (gpt-5.4-mini) en lugar de UNA llamada a `FINANCIAL_PIPELINE_PREMIUM` (gpt-5.5). El bug `finish_reason=length` que el blindaje gpt-5.5 mitigaba se vuelve estructuralmente imposible — cada pass tiene su propio reasoning budget contra un sub-schema más pequeño.

## Arquitectura (no tocar sin entender por qué cada pieza está donde está)

```
Pass 1 — niif-analyst-pass1 (slot niifAnalystPass1, 16K maxOutputTokens, medium)
  Schema: BalanceAndPnlSubSchema
    - company, balanceSheet, incomeStatement, curatorFlags
  System prompt: buildNiifAnalystPass1Prompt(company, language, preprocessed, elite)
  Output: BalanceAndPnlSubJson

Pass 2 — niif-analyst-pass2 (slot niifAnalystPass2, 12K, medium)
  Schema: CashFlowAndEquitySubSchema
    - cashFlow (3 secciones + closure), equityChanges (rows + notes)
  System prompt: buildNiifAnalystPass2Prompt(company, lang, pass1Anchors, preprocessed, elite)
    - <previously_computed> con: totalAssetsPrimary, totalLiabilitiesPrimary,
      totalEquityPrimary, netIncomePrimary, oriPrimary, curatorFlags
  Output: CashFlowAndEquitySubJson

Pass 3 — niif-analyst-pass3 (slot niifAnalystPass3, 12K, medium)
  Schema: TechnicalNotesSubSchema
    - technicalNotes (incluye sub-notas Defensa Art. 647 E.T.)
  System prompt: buildNiifAnalystPass3Prompt(company, lang, pass1Anchors, pass2Anchors, preprocessed, elite)
    - <previously_computed> con anchors de Pass-1 + Pass-2 (cashClosing, ecpClosingTotal)
  Output: TechnicalNotesSubJson

Ensamblaje (pura función determinística, sin LLM):
  assembled = assembleNiifReport(pass1.json, pass2.json, pass3.json)
  parsed = NiifReportSchema.safeParse(assembled)  // red de seguridad estructural
  result = toNiifAnalysisResult(parsed.data)       // adapter → NiifAnalysisResult legacy
```

## Por qué dividir el schema en este eje específico

- Pass 1 es el "backbone numérico": Balance + P&L comparten la identidad `netIncome → resultadoEjercicio del ECP`. Dejarlos juntos enforza el bridge automáticamente y produce los anchors que Pass-2 necesita (`totalEquityPrimary`, `cashClosing implícito en PUC 11`). `curatorFlags` viven con los anchors porque son ecos deterministas del orchestrator.
- Pass 2 es el "estados derivados": EFE y ECP dependen ambos de cifras de Pass-1 (`cashClosing ≡ PUC 11 balance`, `ECP saldo final ≡ totalEquity`). Mantenerlos juntos en un mismo pass es coherente con la coherencia cruzada del flujo y patrimonio (cierre del ECP usa la utilidad ya anclada en Pass-1).
- Pass 3 es la "narrativa técnica" — sólo notas. Recibe anchors de los 2 passes anteriores y sus activadores Élite filtrados. No produce cifras nuevas, sólo cita las ya emitidas.

## Cumplimiento normativo (NIC 1 §10 / NIIF for SMEs §3.17)

La normativa exige presentar un "conjunto completo de Estados Financieros" — eso es un requisito de **presentación**, no de generación. El output reensamblado (`NiifReportSchema.parse(assembled)`) cumple §3.17 byte-a-byte como cumplía antes; sólo se chunkó la generación interna. La validación post-ensamblaje (`validateNiifReportJson`, Capa 1 Elite Protocol) verifica los invariantes (Activo = Pasivo + Patrimonio, EFE = PUC 11, ECP saldo final = totalEquity, todos a $0 centavos).

## Telemetría — ahora 3 entradas por reporte

El bus `agent_telemetry` ya no recibe UN evento por reporte; recibe **tres**, una por pass:
- `agentName: 'niif-analyst-pass1'` con `modelId: gpt-5.4-mini` (no gpt-5.5)
- `agentName: 'niif-analyst-pass2'`
- `agentName: 'niif-analyst-pass3'`

Cuando consultes `/api/admin/telemetry?hours=N`, `perAgent.niif-analyst*` desglosa los tres. El costo agregado por reporte debe ser ~4-5x menor que el legado gpt-5.5 (input ligeramente sube por la triple re-emisión del system prompt; mitigado por `cachedInputTokens`).

## Diagnóstico de fallos por pass

Si Pass-N falla, el error se propaga con mensaje `"runNiifAnalyst: Pass N (descripción) falló — <causa>"` + el `cause` original preservado. NO es genérico. Cada pass se aísla.

## Reversibilidad

Un sólo `git revert` del commit final (Fase F) restaura el comportamiento monolítico premium. Los commits incrementales (B1, B2, C, D, E1, E2) se diseñaron para ser revertibles individualmente sin tocar otros — cada uno toca un archivo distinto. El slot legacy `niifAnalyst` (32K, premium) se conservó como `@deprecated` en `MODELS_CONFIG` por si se necesita revertir rápido sin re-introducirlo.

## Lo que NO cambió (contract con consumers downstream)

- `runNiifAnalyst()` signature pública.
- `toNiifAnalysisResult()` adapter.
- PDF Élite + Excel — siguen leyendo el `NiifReportJson` ensamblado.
- `validateNiifReportJson` — Capa 1 Elite Protocol intacta.
- Strategy Director + Governance Specialist — siguen consumiendo `niifOutput.fullContent` (Markdown legacy). Su chunking es Fase 4 (no se incluyó aquí; el cuello de botella era niif-analyst).

## Runbook — cuando rompa en producción

1. Mira `/api/admin/telemetry?hours=24` — busca `perAgent.niif-analyst-passN.unclean_finish_rate` > 0.
2. Si Pass-1 rompe → puede que el schema esté demasiado denso para 16K; sube a 20K en `MODELS_CONFIG.niifAnalystPass1`.
3. Si Pass-2 rompe → probablemente el ECP/EFE de un fixture exótico desborda 12K; sube a 16K.
4. Si Pass-3 rompe → notas Art. 647 E.T. demasiado largas; sube a 16K.
5. Si el assembled falla `NiifReportSchema.safeParse(...)` post-ensamblaje (raro, estructuralmente impossible si los sub-schemas pasaron) → bug en `assembleNiifReport`; corre `npx vitest run src/lib/agents/financial/__tests__/assemble-niif-report.test.ts` para localizar.
6. Cualquier regresión grave: `git revert <hash final Fase F>` y redeploy.
