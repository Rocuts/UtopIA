---
type: community
cohesion: 0.07
members: 34
---

# runHtmlEditor() / orchestrate()

**Cohesion:** 0.07 - loosely connected
**Members:** 34 nodes

## Members
- [[POST()_36]] - code - app\api\financial-report\html\route.ts
- [[agent-logger.ts]] - code - lib\observability\agent-logger.ts
- [[agentStepLogger()]] - code - lib\observability\agent-logger.ts
- [[base-agent.ts]] - code - lib\agents\specialists\base-agent.ts
- [[buildDocInjectionMessage()]] - code - lib\agents\orchestrator.ts
- [[buildHtmlEditorSystemPrompt()]] - code - lib\agents\financial\prompts\html-editor.prompt.ts
- [[buildHtmlEditorUserContent()]] - code - lib\agents\financial\prompts\html-editor.prompt.ts
- [[buildSpecialistResult()]] - code - lib\agents\specialists\base-agent.ts
- [[buildSynthesizerPrompt()]] - code - lib\agents\prompts\synthesizer.prompt.ts
- [[classifier.ts]] - code - lib\agents\classifier.ts
- [[classifyQuery()]] - code - lib\agents\classifier.ts
- [[enhancePrompt()]] - code - lib\agents\prompt-enhancer.ts
- [[execute()]] - code - lib\agents\specialists\base-agent.ts
- [[getToolsForAgent()]] - code - lib\agents\tools\registry.ts
- [[handleT1()]] - code - lib\agents\orchestrator.ts
- [[html-editor.prompt.ts]] - code - lib\agents\financial\prompts\html-editor.prompt.ts
- [[html-editor.ts]] - code - lib\agents\financial\agents\html-editor.ts
- [[isObviousT1()]] - code - lib\agents\classifier.ts
- [[isRetryable()]] - code - lib\agents\utils\retry.ts
- [[lightweightChecklist()]] - code - lib\agents\financial\agents\html-editor.ts
- [[loadSpecVerbatim()]] - code - lib\agents\financial\prompts\html-editor.prompt.ts
- [[logAgentCall()]] - code - lib\observability\agent-logger.ts
- [[orchestrate()]] - code - lib\agents\orchestrator.ts
- [[orchestrator.ts_11]] - code - lib\agents\orchestrator.ts
- [[prompt-enhancer.ts]] - code - lib\agents\prompt-enhancer.ts
- [[retry.ts]] - code - lib\agents\utils\retry.ts
- [[route.ts_57]] - code - app\api\financial-report\html\route.ts
- [[runHtmlEditor()]] - code - lib\agents\financial\agents\html-editor.ts
- [[supportsStreaming()]] - code - lib\agents\specialists\base-agent.ts
- [[synthesizeResponses()]] - code - lib\agents\synthesizer.ts
- [[synthesizer.prompt.ts]] - code - lib\agents\prompts\synthesizer.prompt.ts
- [[synthesizer.ts]] - code - lib\agents\synthesizer.ts
- [[timeoutSignal()]] - code - lib\agents\utils\retry.ts
- [[withRetry()]] - code - lib\agents\utils\retry.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/runHtmlEditor()_/_orchestrate()
SORT file.name ASC
```

## Connections to other communities
- 1 edge to [[_COMMUNITY_repository.ts  erp-query.ts]]
- 1 edge to [[_COMMUNITY_niif-analyst.prompt.ts  buildAntiHallucinationGuardrail()]]
- 1 edge to [[_COMMUNITY_executeTool()  getTaxCalendar()]]

## Top bridge nodes
- [[orchestrate()]] - degree 6, connects to 1 community
- [[buildHtmlEditorSystemPrompt()]] - degree 4, connects to 1 community
- [[getToolsForAgent()]] - degree 2, connects to 1 community