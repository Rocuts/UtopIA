# Modo Supervivencia Élite — Spec técnico

> Spec de implementación del nuevo módulo del área **Escudo** de UtopIA. Convierte la ventana ESCUDO en un optimizador de carga fiscal y protector de patrimonio en tiempo real, bajo la normativa tributaria colombiana vigente (Estatuto Tributario, Ley 2277/2022, UVT 2026 = $52.374).

## 1. Resumen ejecutivo

Cinco submódulos analizan el balance de la empresa colombiana en paralelo y producen, en una sola pasada, un dashboard que el dueño abre y entiende:

| # | Submódulo | Pregunta que responde | Output principal |
|---|---|---|---|
| 1 | **TET — Tasa Efectiva de Tributación** | ¿Cuánto está pagando realmente la empresa? ¿Está sobre-tributando? | TET % + nivelAlerta + sugerencias optimización |
| 2 | **Escudo de Retenciones** | ¿Tengo plata atrapada en la DIAN? | Saldo a favor proyectado + acciones para liberarlo |
| 3 | **Anti-DIAN Preventivo** | ¿La DIAN me va a buscar? | Inconsistencias detectadas antes de que la DIAN las cruce |
| 4 | **Reserva de Contingencia** | ¿Cuánto debo guardar para impuestos? | 10% utilidad neta como reserva de caja |
| 5 | **Optimización de Dividendos** | ¿Cómo le pago al socio sin pagar más impuestos? | Comparativo distribuir vs capitalizar |

Sintetizador final consolida los cinco hallazgos en un dictamen ejecutivo de una página.

## 2. Disparadores y umbrales (cheat sheet operativo)

| Disparador | Umbral | Submódulo | Acción |
|---|---|---|---|
| TET > 30% | calculado | Submódulo 1 | Sugerir Arts. 255-257, ICA Art. 115, Economía Naranja |
| TET > 35% | calculado | Submódulo 1 | Revisar gastos no deducibles |
| TTD < 15% | parágrafo 6 Art. 240 | Submódulo 1 | Calcular impuesto adicional |
| Saldo 1355 > Impuesto proyectado | calculado | Submódulo 2 | Sugerir certif. no retención / autorretenedor / compensación |
| Pago efectivo individual > 100 UVT | $5.237.400 (2026) | Submódulo 3 | Marcar gasto NO deducible (Art. 771-5 §2) |
| Total efectivo > 35% costos / 40% pagado / 40.000 UVT | (whichever lower) | Submódulo 3 | Calcular exceso no deducible (Art. 771-5 §1) |
| Reserva contingencia | 10% × utilidad neta | Submódulo 4 | Mostrar caja a preservar |
| Distribución de utilidades vs capitalización | calculado | Submódulo 5 | Simular ahorro Art. 36-3 vs Art. 242 |

## 3. Arquitectura técnica

### 3.1 Pipeline backend

```
src/lib/agents/financial/escudo-survival/
├── orchestrator.ts                        ← entry point
├── types.ts
├── agents/
│   ├── tet-calculator.ts                  ← submódulo 1
│   ├── retention-shield.ts                ← submódulo 2
│   ├── anti-dian-auditor.ts               ← submódulo 3
│   ├── contingency-reserve.ts             ← submódulo 4
│   └── dividend-optimizer.ts              ← submódulo 5
├── prompts/
│   ├── tet-calculator.prompt.ts
│   ├── retention-shield.prompt.ts
│   ├── anti-dian-auditor.prompt.ts
│   ├── contingency-reserve.prompt.ts
│   └── dividend-optimizer.prompt.ts
├── validators/
│   └── survival-validators.ts             ← Elite Protocol 3 capas
└── __fixtures__/
    ├── balance-pyme-tet-alta.json
    ├── balance-pyme-saldo-favor.json
    ├── balance-pyme-bancarizacion-violada.json
    ├── balance-pyme-elite-clean.json
    └── balance-pyme-art647-trap.json
```

### 3.2 API route

```
src/app/api/escudo-survival/route.ts
```

Espejo de `src/app/api/tax-planning/route.ts`:
- `POST` con body validado por `escudoSurvivalRequestSchema` (Zod).
- `maxDuration = 300`.
- SSE stream si `X-Stream: true`, JSON normal en otro caso.
- Eventos SSE: `progress` (5 stages + sintetizador), `result`, `error`.

### 3.3 Frontend

```
src/components/workspace/areas/SurvivalModePanel.tsx   ← contenedor del grid
src/components/workspace/cards/SurvivalCard.tsx         ← card base reutilizable
src/components/workspace/cards/TetCard.tsx              ← especializadas por submódulo
src/components/workspace/cards/RetentionShieldCard.tsx
src/components/workspace/cards/AntiDianCard.tsx
src/components/workspace/cards/ContingencyReserveCard.tsx
src/components/workspace/cards/DividendOptimizerCard.tsx
src/components/workspace/cards/SynthesisHeaderCard.tsx
src/hooks/useEscudoSurvival.ts                          ← SSE consumer
```

Integración:
- Nueva sub-ruta `src/app/workspace/escudo/supervivencia/page.tsx` (decisión de routing — alternativa: query string `?mode=survival`).
- Update `src/components/workspace/areas/EscudoArea.tsx` para incluir el nuevo submódulo en la grid de "submódulos del área Escudo" (status: `listo` cuando aterrice).
- i18n keys nuevas en `src/lib/i18n/dictionaries.ts` bajo `elite.areas.escudo.modes.supervivenciaElite.*` (es + en).

## 4. Flujo end-to-end

```
[Cliente UI]
   ↓ POST /api/escudo-survival { rawData, company, language }
[Route handler]
   ↓ valida con Zod
   ↓ abre stream SSE
[Orchestrator]
   ├─ preprocessTrialBalance(rawData)  ← reusa src/lib/preprocessing/trial-balance.ts
   ├─ Promise.allSettled([
   │    runTetCalculator(preprocessed, company)        → emite "progress: tet started/done"
   │    runRetentionShield(preprocessed, company)      → "progress: retention ..."
   │    runAntiDianAuditor(preprocessed, company)      → "progress: antiDian ..."
   │    runContingencyReserve(preprocessed, company)   → "progress: reserve ..."
   │    runDividendOptimizer(preprocessed, company)    → "progress: dividend ..."
   │  ])
   ├─ runSynthesizer(allResults)                       → "progress: synthesis ..."
   ├─ validateSurvivalReport(report, preprocessed)     → adjunta validation
   ↓
[Route handler]
   ↓ emite "result" con EscudoSurvivalReport (incluye validation)
[Cliente UI]
   ↓ renderiza grid + síntesis + modal con dictamen completo
```

## 5. Datos de entrada y salida

### 5.1 Request
```typescript
{
  rawData: string;        // CSV/Excel/PDF del balance, mismo formato que /api/tax-planning
  company?: {
    name?: string;
    nit?: string;
    sector?: string;
    ciiu?: string;        // necesario para identificar hidroeléctrica/financiera
  };
  language?: 'es' | 'en';
  instructions?: string;  // opcional — prompt enhancement
}
```

### 5.2 Response (`EscudoSurvivalReport`)
```typescript
{
  tet: {
    markdown: string;
    data: {
      tet: number;                            // 0..1
      ttd: number;                            // 0..1
      nivelAlerta: 'verde' | 'amarillo' | 'rojo';
      impuestoProyectado: number;
      uai: number;
      sugerenciasOptimizacion: OptimizationSuggestion[];
    };
    warnings: string[];
  },
  retentionShield: {
    markdown: string;
    data: {
      retencionesAcumuladas: number;
      impuestoProyectado: number;
      saldoAFavorProyectado: number;          // puede ser negativo
      acciones: Array<{
        tipo: 'certif_no_retencion' | 'autorretenedor' | 'compensacion' | 'devolucion';
        norma: string;
        dificultad: 'baja' | 'media' | 'alta';
        riesgo: string;
      }>;
    };
    warnings: string[];
  },
  antiDian: {
    markdown: string;
    data: {
      pagosEfectivoTotal: number;
      pagosNoDeduciblesIndividuales: Array<{
        beneficiarioNit?: string;
        beneficiarioNombre?: string;
        monto: number;
        excesoUvt: number;                    // sobre 100 UVT
        norma: 'Art. 771-5 §2 E.T.';
      }>;
      excesoNoDeducibleGeneral: number;
      crucesExogenaSospechosos: Array<{
        cuenta: string;
        terceroNit?: string;
        diferenciaEstimada: number;
        norma: string;
      }>;
      mayorImpuestoEstimado: number;
    };
    warnings: string[];
  },
  contingencyReserve: {
    markdown: string;
    data: {
      utilidadNeta: number;
      reservaSugerida: number;                // = 0.10 × utilidadNeta
      pctUtilidad: number;                     // = 0.10
      cuentaSugerida: string;                  // "11 - Caja y Bancos (subcuentas de alta liquidez)"
      reservaLegalActual?: number;             // si está en clase 3605
      gapReservaLegal?: number;
    };
    warnings: string[];
  },
  dividendOptimizer: {
    markdown: string;
    data: {
      utilidadDistribuible: number;
      escenarios: {
        distribuirTotal: { ahorroSocio: 0; impuestoSocio: number; netoSocio: number; };
        capitalizarTotal: { ahorroSocio: number; impuestoSocio: 0; netoSocio: 0; fortPatrimonio: number; };
        hibrido50_50: { ahorroSocio: number; impuestoSocio: number; netoSocio: number; fortPatrimonio: number; };
      };
      recomendacion: string;
      norma: 'Art. 242 E.T.' | 'Art. 36-3 E.T.';
    };
    warnings: string[];
  },
  synthesis: {
    markdown: string;
    topRecommendations: Array<{ orden: number; titulo: string; impacto: number; norma: string; }>;
  },
  validation: SurvivalValidationResult;
  metadata: {
    uvt: 52374;
    period: string;                            // "2025" | "2026"
    generatedAt: string;                       // ISO
    partial: boolean;
    durationMs: number;
  };
}
```

### 5.3 SSE Events
```
event: progress
data: { stage: 'tet', status: 'started' }

event: progress
data: { stage: 'tet', status: 'completed', message: 'TET 32.5% — alerta amarilla' }

...

event: result
data: <EscudoSurvivalReport>

event: error
data: { error: string, detail: string }
```

## 6. Equipo y división de trabajo

| Agente | Modelo | Worktree | Archivos disjuntos |
|---|---|---|---|
| `escudo-tributario-co` | Opus | n/a (oracle, no escribe) | resuelve dudas normativas durante el desarrollo |
| `escudo-survival-backend` | Opus | sí | `src/lib/agents/financial/escudo-survival/{orchestrator,types,agents/*,prompts/*}.ts` + `src/app/api/escudo-survival/route.ts` + extensión de `src/lib/validation/schemas.ts` |
| `escudo-survival-ui` | Sonnet | sí | `src/components/workspace/areas/SurvivalModePanel.tsx`, cards, hook SSE, route page, i18n keys |
| `escudo-survival-validator` | Sonnet | sí | `src/lib/agents/financial/escudo-survival/validators/survival-validators.ts` + `__fixtures__/*.json` + tests |

**Cero overlap de archivos**. Los tres engineers trabajan en paralelo en worktrees aislados; el lead mergea al final.

## 7. Patrón de orquestación elegido

**Orchestrator-Subagent** (Anthropic engineering 2025) sobre **worktrees disjuntos**.

Justificación:
- Tareas paralelizables por archivo.
- Cada subagente tiene objetivo claro, formato de output cerrado, fuentes definidas, límites explícitos (los 4 elementos del playbook §7.1).
- Lead Opus 4.7 (sesión humana) + 3 workers (1 Opus, 2 Sonnet) = misma proporción que Anthropic Multi-Agent Research System (que reportó +90.2% mejora vs single-agent).
- Pattern Generator-Verifier embebido: el `validator` actúa como verificador del output del `backend` con criterios computables.

## 8. Verificación final

Lead-side checks antes de declarar listo:

```bash
cd /Users/rocuts/Documents/GitHub/UtopIA
npx tsc --noEmit                                         # tipos
npm run lint                                              # ESLint
npm run build                                             # build completo
npx tsx src/lib/agents/financial/escudo-survival/__fixtures__/run-validation.ts  # validators sobre fixtures
# Smoke test manual:
#   curl -X POST http://localhost:3000/api/escudo-survival -H "X-Stream: true" -d @balance-pyme-elite-clean.json
```

UI checks (manual):
- Carga sin errores en consola.
- Cinco cards renderizadas, cada una con su norma citada.
- Modo claro/oscuro WCAG 2.1 AA (validar con `utopia-contrast-auditor` si está disponible).
- SSE progress visible (loaders por card).
- Modal de dictamen completo abre y cierra sin glitches.
- Wheel scroll funcional (validar respeto a Lenis).

## 9. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| LLM inventa normas inexistentes | Pack normativo en system prompt + validator capa 3 que rechaza norma derogada |
| Cifras del balance mal extraídas | Reuso de `src/lib/preprocessing/trial-balance.ts` (ya probado) + validator capa 1 |
| Pipeline de 5 agentes excede 300s | Paralelización con `Promise.allSettled` + `partial: true` cuando uno falla |
| UI rompe contraste en oscuro | Skill `utopia-contrast-auditor` post-cambios |
| Mismo archivo editado por 2 agentes | `isolation: worktree` obligatorio |
| Costo en tokens (15x chat) | Justificado: el output evita sanciones de hasta 100% del impuesto (Art. 647) |

## 10. Próximos pasos inmediatos

1. **Aprobación del plan** por el operador humano.
2. **Spawn del equipo** en worktrees paralelos (TaskCreate por agente).
3. **Lead supervisa** progress events; revisa al término de cada agente.
4. **Merge**: tras 3 agentes completos + tsc/lint/build verde, mergear a `main`.
5. **Smoke test** con fixture real y captura de UI.
6. **Commit** con mensaje `feat(escudo-survival): modo supervivencia élite — 5 submódulos + validators`.

---

**Última actualización**: 2026-05-08. Mantenedor: lead orchestrator.
