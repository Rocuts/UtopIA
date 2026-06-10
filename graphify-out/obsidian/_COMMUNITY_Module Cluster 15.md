---
type: community
cohesion: 0.05
members: 55
---

# Module Cluster 15

**Cohesion:** 0.05 - loosely connected
**Members:** 55 nodes

## Members
- [[POST()_24]] - code - app\api\chat\route.ts
- [[POST()_36]] - code - app\api\financial-report\html\route.ts
- [[agent-logger.ts]] - code - lib\observability\agent-logger.ts
- [[agentStepLogger()]] - code - lib\observability\agent-logger.ts
- [[base-agent.ts]] - code - lib\agents\specialists\base-agent.ts
- [[buildDocInjectionMessage()]] - code - lib\agents\orchestrator.ts
- [[buildHtmlEditorSystemPrompt()]] - code - lib\agents\financial\prompts\html-editor.prompt.ts
- [[buildHtmlEditorUserContent()]] - code - lib\agents\financial\prompts\html-editor.prompt.ts
- [[buildNITContext()]] - code - lib\security\pii-filter.ts
- [[buildSpecialistResult()]] - code - lib\agents\specialists\base-agent.ts
- [[buildSynthesizerPrompt()]] - code - lib\agents\prompts\synthesizer.prompt.ts
- [[classifier.ts]] - code - lib\agents\classifier.ts
- [[classifyQuery()]] - code - lib\agents\classifier.ts
- [[createPIIContext()]] - code - lib\security\pii-filter.ts
- [[enhancePrompt()]] - code - lib\agents\prompt-enhancer.ts
- [[execute()]] - code - lib\agents\specialists\base-agent.ts
- [[exportConversationPDF()]] - code - lib\export\pdf-export.ts
- [[extractNITContext()]] - code - lib\security\pii-filter.ts
- [[getToolsForAgent()]] - code - lib\agents\tools\registry.ts
- [[handleLegacy()]] - code - app\api\chat\route.ts
- [[handleOrchestrated()]] - code - app\api\chat\route.ts
- [[handleT1()]] - code - lib\agents\orchestrator.ts
- [[html-editor.prompt.ts]] - code - lib\agents\financial\prompts\html-editor.prompt.ts
- [[html-editor.ts]] - code - lib\agents\financial\agents\html-editor.ts
- [[isObviousT1()]] - code - lib\agents\classifier.ts
- [[isOrchestrationMode()]] - code - app\api\chat\route.ts
- [[isRetryable()]] - code - lib\agents\utils\retry.ts
- [[lightweightChecklist()]] - code - lib\agents\financial\agents\html-editor.ts
- [[loadSpecVerbatim()]] - code - lib\agents\financial\prompts\html-editor.prompt.ts
- [[logAgentCall()]] - code - lib\observability\agent-logger.ts
- [[markdownToPdfLines()]] - code - lib\export\pdf-export.ts
- [[orchestrate()]] - code - lib\agents\orchestrator.ts
- [[orchestrator.ts_11]] - code - lib\agents\orchestrator.ts
- [[parseInlineMarkdown()]] - code - lib\export\pdf-export.ts
- [[parseMarkdownTable()]] - code - lib\export\pdf-export.ts
- [[pdf-export.ts]] - code - lib\export\pdf-export.ts
- [[pii-filter.ts]] - code - lib\security\pii-filter.ts
- [[prompt-enhancer.ts]] - code - lib\agents\prompt-enhancer.ts
- [[readBag()]] - code - lib\agents\tools\registry.ts
- [[redactPII()]] - code - lib\security\pii-filter.ts
- [[redactPIIWithContext()]] - code - lib\security\pii-filter.ts
- [[registry.ts]] - code - lib\agents\tools\registry.ts
- [[renderAssistantContent()]] - code - lib\export\pdf-export.ts
- [[renderPdfLines()]] - code - lib\export\pdf-export.ts
- [[renderTable()]] - code - lib\export\pdf-export.ts
- [[retry.ts]] - code - lib\agents\utils\retry.ts
- [[route.ts_35]] - code - app\api\chat\route.ts
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
TABLE source_file, type FROM #community/Module_Cluster_15
SORT file.name ASC
```

## Connections to other communities
- 1 edge to [[_COMMUNITY_Core API Routes]]
- 1 edge to [[_COMMUNITY_NIIF Analyst Pipeline]]
- 1 edge to [[_COMMUNITY_Tax Calendar & ERP Connect]]

## Top bridge nodes
- [[POST()_24]] - degree 7, connects to 1 community
- [[buildHtmlEditorSystemPrompt()]] - degree 4, connects to 1 community
- [[registry.ts]] - degree 3, connects to 1 community