---
type: community
cohesion: 0.05
members: 68
---

# risk-score-calculator.ts / computeRiskScore()

**Cohesion:** 0.05 - loosely connected
**Members:** 68 nodes

## Members
- [[brechaPpVsUmbral()]] - code - lib\agents\financial\escudo-survival\fiscal-agent\tools\ccv-calculator.ts
- [[buildAlertaTasaMinima()]] - code - lib\agents\financial\escudo-survival\fiscal-agent\tools\ccv-calculator.ts
- [[buildCcvFiscalPrompt()]] - code - lib\agents\financial\escudo-survival\fiscal-agent\prompts\ccv-fiscal.prompt.ts
- [[buildConciliacionPrompt()]] - code - lib\agents\financial\escudo-survival\fiscal-agent\prompts\conciliacion.prompt.ts
- [[buildDefensaDianPrompt()]] - code - lib\agents\financial\escudo-survival\fiscal-agent\prompts\defensa-dian.prompt.ts
- [[buildDevolucionesPrompt()]] - code - lib\agents\financial\escudo-survival\fiscal-agent\prompts\devoluciones.prompt.ts
- [[buildDianLetterSkeleton()]] - code - lib\agents\financial\escudo-survival\fiscal-agent\tools\dian-letter-builder.ts
- [[buildFiscalAgentHeader()]] - code - lib\agents\financial\escudo-survival\fiscal-agent\prompts\fiscal-agent.prompt.ts
- [[buildLanguageLine()]] - code - lib\agents\financial\escudo-survival\fiscal-agent\prompts\fiscal-agent.prompt.ts
- [[buildMotorNormativoPrompt()]] - code - lib\agents\financial\escudo-survival\normative\prompts\motor-normativo.prompt.ts
- [[buildPlaneacionPrompt()]] - code - lib\agents\financial\escudo-survival\fiscal-agent\prompts\planeacion.prompt.ts
- [[buildRiskScorePrompt()]] - code - lib\agents\financial\escudo-survival\fiscal-agent\prompts\risk-score.prompt.ts
- [[buildSupervivenciaPrompt()]] - code - lib\agents\financial\escudo-survival\fiscal-agent\prompts\supervivencia.prompt.ts
- [[buildSystem()]] - code - lib\agents\financial\escudo-survival\fiscal-agent\agents\synthesizer.agent.ts
- [[calcularImpuestoAdicionalCents()]] - code - lib\agents\financial\escudo-survival\fiscal-agent\tools\ccv-calculator.ts
- [[callFiscalAgent()]] - code - lib\agents\financial\escudo-survival\fiscal-agent\runtime.ts
- [[ccv-calculator.ts]] - code - lib\agents\financial\escudo-survival\fiscal-agent\tools\ccv-calculator.ts
- [[ccv-fiscal.agent.ts]] - code - lib\agents\financial\escudo-survival\fiscal-agent\agents\ccv-fiscal.agent.ts
- [[ccv-fiscal.prompt.ts]] - code - lib\agents\financial\escudo-survival\fiscal-agent\prompts\ccv-fiscal.prompt.ts
- [[centsToPesosNumber()]] - code - lib\agents\financial\escudo-survival\fiscal-agent\tools\ccv-calculator.ts
- [[clasificarEficienciaFiscal()]] - code - lib\agents\financial\escudo-survival\fiscal-agent\tools\ccv-calculator.ts
- [[classificationFromKind()]] - code - lib\agents\financial\escudo-survival\fiscal-agent\tools\dian-letter-builder.ts
- [[classifyDianRequirement()]] - code - lib\agents\financial\escudo-survival\fiscal-agent\tools\dian-letter-builder.ts
- [[classifyNivel()]] - code - lib\agents\financial\escudo-survival\fiscal-agent\tools\risk-score-calculator.ts
- [[computeRiskScore()]] - code - lib\agents\financial\escudo-survival\fiscal-agent\tools\risk-score-calculator.ts
- [[conciliacion.agent.ts]] - code - lib\agents\financial\escudo-survival\fiscal-agent\agents\conciliacion.agent.ts
- [[conciliacion.prompt.ts]] - code - lib\agents\financial\escudo-survival\fiscal-agent\prompts\conciliacion.prompt.ts
- [[defensa-dian.agent.ts]] - code - lib\agents\financial\escudo-survival\fiscal-agent\agents\defensa-dian.agent.ts
- [[defensa-dian.prompt.ts]] - code - lib\agents\financial\escudo-survival\fiscal-agent\prompts\defensa-dian.prompt.ts
- [[devoluciones.agent.ts]] - code - lib\agents\financial\escudo-survival\fiscal-agent\agents\devoluciones.agent.ts
- [[devoluciones.prompt.ts]] - code - lib\agents\financial\escudo-survival\fiscal-agent\prompts\devoluciones.prompt.ts
- [[dian-letter-builder.ts]] - code - lib\agents\financial\escudo-survival\fiscal-agent\tools\dian-letter-builder.ts
- [[factorCoberturaRetenciones()]] - code - lib\agents\financial\escudo-survival\fiscal-agent\tools\risk-score-calculator.ts
- [[factorCostoBajo()]] - code - lib\agents\financial\escudo-survival\fiscal-agent\tools\risk-score-calculator.ts
- [[factorCrecimiento()]] - code - lib\agents\financial\escudo-survival\fiscal-agent\tools\risk-score-calculator.ts
- [[factorMargenNeto()]] - code - lib\agents\financial\escudo-survival\fiscal-agent\tools\risk-score-calculator.ts
- [[factorSaldoFavor()]] - code - lib\agents\financial\escudo-survival\fiscal-agent\tools\risk-score-calculator.ts
- [[factorTet()]] - code - lib\agents\financial\escudo-survival\fiscal-agent\tools\risk-score-calculator.ts
- [[filterByUseCase()]] - code - lib\agents\financial\escudo-survival\normative\prompts\motor-normativo.prompt.ts
- [[fiscal-agent.prompt.ts]] - code - lib\agents\financial\escudo-survival\fiscal-agent\prompts\fiscal-agent.prompt.ts
- [[ingresosComparativoCents()]] - code - lib\agents\financial\escudo-survival\fiscal-agent\tools\risk-score-calculator.ts
- [[motor-normativo.prompt.ts]] - code - lib\agents\financial\escudo-survival\normative\prompts\motor-normativo.prompt.ts
- [[pctRatioCents()]] - code - lib\agents\financial\escudo-survival\fiscal-agent\tools\risk-score-calculator.ts
- [[planeacion.agent.ts]] - code - lib\agents\financial\escudo-survival\fiscal-agent\agents\planeacion.agent.ts
- [[planeacion.prompt.ts]] - code - lib\agents\financial\escudo-survival\fiscal-agent\prompts\planeacion.prompt.ts
- [[precomputeCcv()]] - code - lib\agents\financial\escudo-survival\fiscal-agent\tools\ccv-calculator.ts
- [[reduccionesDisponibles()]] - code - lib\agents\financial\escudo-survival\fiscal-agent\tools\dian-letter-builder.ts
- [[renderArticulosET()]] - code - lib\agents\financial\escudo-survival\normative\prompts\motor-normativo.prompt.ts
- [[renderBlacklist()]] - code - lib\agents\financial\escudo-survival\normative\prompts\motor-normativo.prompt.ts
- [[renderNITCalendarHint()]] - code - lib\agents\financial\escudo-survival\normative\prompts\motor-normativo.prompt.ts
- [[renderNormasAuditoria()]] - code - lib\agents\financial\escudo-survival\normative\prompts\motor-normativo.prompt.ts
- [[renderSanciones()]] - code - lib\agents\financial\escudo-survival\normative\prompts\motor-normativo.prompt.ts
- [[renderTarifasRetencion()]] - code - lib\agents\financial\escudo-survival\normative\prompts\motor-normativo.prompt.ts
- [[risk-score-calculator.ts]] - code - lib\agents\financial\escudo-survival\fiscal-agent\tools\risk-score-calculator.ts
- [[risk-score.agent.ts]] - code - lib\agents\financial\escudo-survival\fiscal-agent\agents\risk-score.agent.ts
- [[risk-score.prompt.ts]] - code - lib\agents\financial\escudo-survival\fiscal-agent\prompts\risk-score.prompt.ts
- [[runCcvFiscalAgent()]] - code - lib\agents\financial\escudo-survival\fiscal-agent\agents\ccv-fiscal.agent.ts
- [[runConciliacionAgent()]] - code - lib\agents\financial\escudo-survival\fiscal-agent\agents\conciliacion.agent.ts
- [[runDefensaDianAgent()]] - code - lib\agents\financial\escudo-survival\fiscal-agent\agents\defensa-dian.agent.ts
- [[runDevolucionesAgent()]] - code - lib\agents\financial\escudo-survival\fiscal-agent\agents\devoluciones.agent.ts
- [[runPlaneacionAgent()]] - code - lib\agents\financial\escudo-survival\fiscal-agent\agents\planeacion.agent.ts
- [[runRiskScoreAgent()]] - code - lib\agents\financial\escudo-survival\fiscal-agent\agents\risk-score.agent.ts
- [[runSupervivenciaAgent()]] - code - lib\agents\financial\escudo-survival\fiscal-agent\agents\supervivencia.agent.ts
- [[runSynthesizer()]] - code - lib\agents\financial\escudo-survival\fiscal-agent\agents\synthesizer.agent.ts
- [[runtime.ts_1]] - code - lib\agents\financial\escudo-survival\fiscal-agent\runtime.ts
- [[supervivencia.agent.ts]] - code - lib\agents\financial\escudo-survival\fiscal-agent\agents\supervivencia.agent.ts
- [[supervivencia.prompt.ts]] - code - lib\agents\financial\escudo-survival\fiscal-agent\prompts\supervivencia.prompt.ts
- [[synthesizer.agent.ts]] - code - lib\agents\financial\escudo-survival\fiscal-agent\agents\synthesizer.agent.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/risk-score-calculator.ts_/_computeRiskScore()
SORT file.name ASC
```

## Connections to other communities
- 10 edges to [[_COMMUNITY_formatCopFromCents()  parseMoneyCop()]]
- 1 edge to [[_COMMUNITY_callFinancialAgent()  orchestrateFiscalOpinion()]]
- 1 edge to [[_COMMUNITY_repository.ts  erp-query.ts]]
- 1 edge to [[_COMMUNITY_buildFiscalAnchor()  dian-calendar.ts]]

## Top bridge nodes
- [[risk-score-calculator.ts]] - degree 11, connects to 1 community
- [[computeRiskScore()]] - degree 11, connects to 1 community
- [[callFiscalAgent()]] - degree 10, connects to 1 community
- [[runSupervivenciaAgent()]] - degree 6, connects to 1 community
- [[runCcvFiscalAgent()]] - degree 5, connects to 1 community