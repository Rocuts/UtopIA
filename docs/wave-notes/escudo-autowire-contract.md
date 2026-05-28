# Contrato — Auto-cableado NIIF → El Escudo (Capa 5)

**Estado:** CONGELADO (Fase 0). Autoritativo para los 4 equipos. Si un detalle de
implementación contradice este doc, este doc gana. No renombrar campos/endpoints
sin actualizar este contrato primero.

**Fecha:** 2026-05-28 · **Mayo 2026**

---

## 1. Objetivo

Cuando el usuario genera un **Informe NIIF**, **El Escudo se auto-puebla** con las
cifras fiscales reales de esa empresa (F01-F10 + Score de Riesgo DIAN + calendario
+ alertas) y el asistente contextual ya tiene el contexto — **sin que el usuario
reingrese nada**. Hoy `EscudoArea` muestra mocks (`buildMockTef`) porque
`/workspace/escudo/page.tsx:71` lo renderiza sin props.

### Decisiones del dueño (NO re-litigar)
1. **Auto-cablear lo existente.** Reutilizar `buildFiscalAnchor()` y
   `computeRiskScore()` (ya determinísticos). **PROHIBIDO** crear un 2º cálculo
   F01-F10, un polyfill `window.storage`, o un sistema de alertas paralelo.
2. **Persistencia cliente + DB en tablas existentes (sin migración):**
   `FinancialReport.fiscalSnapshot` (context + localStorage) **Y** `reports` +
   `sentinelAlerts`. Alertas con ciclo de vida resolver/snooze/regenerar.

### Lo que YA existe (reutilizar, no reescribir)
- `buildFiscalAnchor({ preprocessed, company, hoy, nitFromFile }) → FiscalAnchorBlock`
  en `src/lib/agents/financial/escudo-survival/fiscal-anchor/index.ts:39`. Patrón de
  invocación de referencia: `escudo-survival/orchestrator.ts:111-133`.
- `computeRiskScore({ anchor, preprocessed }) → { score, nivel, factores }`
  en `.../fiscal-agent/tools/risk-score-calculator.ts:256` (los 5 factores exactos).
- `EscudoArea` ya acepta `fiscalAnchor?: FiscalAnchorBlock` y deriva KPI+vencimientos
  reales (`EscudoArea.tsx:203-223`).
- `FiscalAnchorCard`, `CcvFiscalCard`, `RiskScoreCard` renderizan F01-F10, gauge, alertas.
- `sentinel/repository.ts`: `upsertAlert`, `findPendingAlertsForWorkspace`,
  `resolveAlert`, `snoozeAlert`, `listAlertsForWorkspace`.
- Puente cliente: `WorkspaceContext.lastCompletedReport` → localStorage
  (`utopia_reports_v1`). `StoredReportRecord.report` es `unknown` → persiste el
  reporte completo (incluyendo `fiscalSnapshot`) sin cambios en el storage.

---

## 2. Tipo congelado (añadido en Fase 0 — NO modificar)

En `src/lib/agents/financial/types.ts` (YA AÑADIDO por Fase 0):

```ts
import type { FiscalAnchorBlock } from './escudo-survival/fiscal-anchor/types';

export type FiscalRiskNivel = 'bajo' | 'medio' | 'alto' | 'muy_alto' | 'critico';

export interface FiscalRiskFactor {
  factor: string;        // p.ej. 'tet_baja' | 'margen_alto' | ...
  descripcion: string;
  puntos: number;
  detalle: string;
}

export interface FiscalRiskScore {
  score: number;          // 0-100 (Math.min(100, Σ puntos))
  nivel: FiscalRiskNivel;
  factores: FiscalRiskFactor[];
}

/**
 * Artefacto fiscal determinístico calculado en la fase NIIF y consumido por El
 * Escudo sin re-upload. anchor = F01-F10 + calendario DIAN + alertas.
 */
export interface FiscalSnapshot {
  anchor: FiscalAnchorBlock;
  riskScore: FiscalRiskScore;
  period: string;        // ej. "2025"
  computedAt: string;    // ISO 8601
}
```

Y el campo opcional en `FinancialReport`:

```ts
export interface FinancialReport {
  // ...campos existentes...
  /** Capa El Escudo — calculado en fase NIIF, leído por EscudoArea sin re-upload. */
  fiscalSnapshot?: FiscalSnapshot;
}
```

`computeRiskScore(...)` (tipo `RiskScorePrecomputedData`) es **estructuralmente
asignable** a `FiscalRiskScore` — Backend puede asignarlo directo.

---

## 3. Flujo de datos

```
[Servidor — STATELESS, sin workspaceId]
  runNiifPhase (orchestrator.ts)
    → preprocessed + company disponibles
    → buildFiscalAnchor() + computeRiskScore()  ⇒ FiscalSnapshot
    → phase.fiscalSnapshot
  niif/route.ts  ⇒  SSE: event:fiscal_snapshot {fiscalSnapshot}
                     SSE: event:niif_phase {niif, ancora, fiscalSnapshot, context}
                     JSON (no-stream): { niif, ancora, fiscalSnapshot, context }

[Cliente — TIENE workspace via cookie]
  PipelineWorkspace.tsx
    → captura fiscalSnapshot del SSE → report.fiscalSnapshot
    → setLastCompletedReport({ report, ... })   ⇒ localStorage  [persistencia cliente]
    → POST /api/escudo/fiscal-anchor {fiscalSnapshot, company}  ⇒ DB  [persistencia multi-dispositivo]

[El Escudo — al abrir]
  escudo/page.tsx
    → 1º intenta lastCompletedReport.report.fiscalSnapshot (instantáneo)
    → 2º fallback GET /api/escudo/fiscal-anchor (multi-dispositivo + alertas gestionadas)
    → <EscudoArea fiscalAnchor={...} riskScore={...} alertas={...} />
    → inyecta CONTEXTO FISCAL al asistente
```

---

## 4. Contrato BACKEND (Opus · escudo-survival-backend)

### 4.1 Producir el FiscalSnapshot en la fase NIIF
- En `src/lib/agents/financial/orchestrator.ts`, dentro de `runNiifPhase` (o en
  `prepareFinancialContext` junto a `buildNiifAncora`, donde `preprocessed` +
  `effectiveCompany` existen): calcular `fiscalSnapshot` reutilizando
  `buildFiscalAnchor` + `computeRiskScore`. `nitFromFile`: usar
  `extractCompanyMetadata(rawData).nitFromFile` si rawData está disponible; si no,
  `company.nit` cubre el caso (buildFiscalAnchor prioriza `company.nit`).
- Pure/determinístico, **cero LLM**. Si falla, `fiscalSnapshot` = `undefined` y el
  pipeline NIIF continúa (no abortar). Patrón: `escudo-survival/orchestrator.ts:111-133`.
- `runNiifPhase` retorna ahora `{ niif, ancora, fiscalSnapshot, context }`.

### 4.2 Emitir en el route NIIF (`src/app/api/financial-report/niif/route.ts`)
- Streaming: añadir `send('fiscal_snapshot', { fiscalSnapshot })` (evento ligero,
  ANTES de `niif_phase`) **y** añadir `fiscalSnapshot` al payload de `niif_phase`.
- No-streaming (línea ~164): añadir `fiscalSnapshot` al `NextResponse.json`.
- Verificar que `extractSerializableContext` / la serialización no lo rompa
  (FiscalSnapshot es JSON-safe: strings de centavos + numbers).

### 4.3 Endpoints de persistencia (NUEVOS — workspace-aware)
Resolver `workspaceId` desde la cookie `utopia_workspace_id` reutilizando el helper
existente (`src/lib/db/workspace.ts` o el usado por `src/app/api/upload/route.ts` /
`repair-session/route.ts`). Sin workspace → 401.

**`POST /api/escudo/fiscal-anchor/route.ts`**
```
body: { fiscalSnapshot: FiscalSnapshot, company: { name?: string; nit?: string } }
acción:
  - upsert fila `reports`: { workspaceId, kind:'escudo_fiscal', title:`Âncora Fiscal ${period}`,
    data: fiscalSnapshot (jsonb), controlTotals: null }
  - por cada fiscalSnapshot.anchor.alertas → mapear a Insight → upsertAlert(db, insight,
    { workspaceId, periodId? }). pillar='escudo'. severidad→severity: error→critico,
    warning→advertencia, info→informativo. triggerCode (≤8): 'ESC_A5','ESC_SF','ESC_V15',
    'ESC_F10','ESC_ICA' (mapear por codigo). dedupKey: `escudo:${period}:${codigo}`.
    El payload del Insight DEBE preservar codigo/mensaje/norma + titulo/impacto/accion.
  → 200 { ok:true, reportId, alertsUpserted:number }
```
Leer `src/lib/notifications/insight-types.ts` para la forma exacta de `Insight`.

**`GET /api/escudo/fiscal-anchor/route.ts`** (mismo archivo, export GET)
```
query: ?period=2025 (opcional → última)
  → última fila reports kind='escudo_fiscal' del workspace
  → findPendingAlertsForWorkspace(db, workspaceId) filtradas pillar='escudo'
  → 200 {
       hasData: boolean,
       fiscalSnapshot: FiscalSnapshot | null,
       alertas: AlertView[]
     }
```

**`PATCH /api/escudo/fiscal-anchor/alerts/[id]/route.ts`** (NUEVO)
```
body: { action:'resolve' | 'snooze', days?:number }
  → resolveAlert / snoozeAlert
  → 200 { ok:true, alert: AlertView }
```

**AlertView (forma de salida congelada — UI la consume):**
```ts
interface AlertView {
  id: string;
  codigo: string;          // 'A5_SIN_PROVISION' | 'SALDO_A_FAVOR' | 'F10_BAJA' | ...
  severidad: 'error' | 'warning' | 'info';
  titulo: string;
  mensaje: string;
  norma: string;
  impacto?: string;        // MoneyCop centavos string, si aplica
  accion?: string;
  status: 'pending' | 'snoozed' | 'resolved' | 'escalated';
  createdAt: string;       // ISO
}
```

### 4.4 Archivos que BACKEND escribe (disjuntos)
- `src/lib/agents/financial/orchestrator.ts`
- `src/app/api/financial-report/niif/route.ts`
- `src/app/api/escudo/fiscal-anchor/route.ts` (GET + POST) — NUEVO
- `src/app/api/escudo/fiscal-anchor/alerts/[id]/route.ts` (PATCH) — NUEVO
- helpers nuevos bajo `.../escudo-survival/fiscal-anchor/` (p.ej. `snapshot.ts`,
  `alert-mapping.ts`) si los necesita.
- **NO toca** `types.ts` (congelado Fase 0), ni UI, ni tests, ni dictionaries.

---

## 5. Contrato UI (Sonnet · escudo-survival-ui)

### 5.1 Capturar el snapshot del SSE
- `src/components/workspace/PipelineWorkspace.tsx`: en el consumer del SSE NIIF,
  capturar `event:fiscal_snapshot` (o `niif_phase.fiscalSnapshot`) y asignarlo a
  `report.fiscalSnapshot` en el objeto que se pasa a `setLastCompletedReport(...)`
  (3 sitios: ~1686, ~1840, ~1990). Tras `setLastCompletedReport`, hacer
  `fetch('POST /api/escudo/fiscal-anchor', { fiscalSnapshot, company })`
  best-effort (no bloquear UI; try/catch silencioso).

### 5.2 Auto-lectura en El Escudo
- `src/app/workspace/escudo/page.tsx`: leer `useWorkspace().lastCompletedReport`.
  Si `report.fiscalSnapshot` existe → usarlo. Si no → `GET /api/escudo/fiscal-anchor`
  en un `useEffect` (con guard `useRef` — ver memoria intake-guard). Pasar a
  `<EscudoArea fiscalAnchor={snapshot.anchor} riskScore={snapshot.riskScore}
  alertas={alertas} />`. Si ambos vacíos → estado vacío con CTA "Generar Informe NIIF".
- `src/components/workspace/areas/EscudoArea.tsx`: añadir props
  `riskScore?: FiscalRiskScore` y `alertas?: AlertView[]`. Mostrar Score DIAN
  (reusar `RiskScoreCard` o un KPI; nivel→label: muy_alto/critico="ALTO",
  alto="ALTO", medio="MEDIO", bajo="BAJO") y un panel de alertas accionables
  (reusar el render de alertas; botón resolver→PATCH). Mantener mocks SOLO como
  fallback cuando no hay datos.

### 5.3 Inyección de contexto al asistente (best-effort, sin refactor del chat)
- Construir un bloque "CONTEXTO FISCAL AUTOMÁTICO — {empresa} · {periodo}" con
  F01-F10 formateados (`formatCopFromCents`), F09/F10 %, score, alertas.
- Inyectarlo por el bus existente. Si solo existe `pendingChatSeed` (pre-llena el
  input del usuario), añadir un canal nuevo `pendingChatContext` en
  `WorkspaceContext` (UI lo posee) que el consumer del chat antepone como
  contexto/sistema. Si la integración con el system-prompt del chat es demasiado
  profunda, documentar el punto exacto e inyectar via seed como fallback. **No
  refactorizar `/api/chat` ni el orchestrator del chat.**

### 5.4 i18n
- `src/lib/i18n/dictionaries.ts`: claves ES+EN para Score DIAN, alertas-como-tareas,
  estado vacío, labels del contexto del asistente. Reusar el namespace
  `elite.areas.escudo`.

### 5.5 Archivos que UI escribe (disjuntos)
- `src/app/workspace/escudo/page.tsx`
- `src/components/workspace/areas/EscudoArea.tsx`
- `src/components/workspace/PipelineWorkspace.tsx`
- `src/context/WorkspaceContext.tsx` (solo si añade `pendingChatContext`)
- `src/lib/i18n/dictionaries.ts`
- componentes nuevos bajo `src/components/workspace/escudo/` si hacen falta
  (p.ej. `FiscalAlertsPanel.tsx`).
- **NO toca** backend, orchestrator, routes, ni `types.ts`.

### 5.6 Reglas UI duras
- **Polaridad de tokens** (CLAUDE.md): tinta primaria `text-n-1000`, secundaria
  `n-700/800`; NUNCA `n-100..n-400` como texto legible. Disabled `n-600` min.
- **data-lenis-prevent**: no romper el scroll del workspace.
- Correr el agente `utopia-contrast-auditor` mentalmente / revisar contraste.

---

## 6. Contrato VALIDATOR (Sonnet · escudo-survival-validator)

Vitest. Fixture determinístico + 3 capas + regresión Art. 647.

### 6.1 Fixture: "Grupo Empresarial 2 Tres SAS 2025"
- Localizar el balance/fixture real en `__fixtures__/` (memoria: Pulido Diamante Ola D).
  Si no existe el balance real, construir un fixture determinístico que produzca los
  F01-F04/F09/F10 esperados (§9).
- Aserción **exacta** en centavos (NO floats):

| Ind | Pesos (input del dueño) | **Centavos string (aserción)** | Fórmula |
|---|---|---|---|
| F01 | 2.228.496.789,73 | `"222849678973"` | UAI ≈ A11 |
| F02 | 779.973.876,41 | `"77997387641"` | round(F01×35/100) |
| F03 | 46.073.407,76 | `"4607340776"` | Cta.1355+1805 |
| F04 | 733.900.468,65 | `"73390046865"` | F02−F03 |
| F09 | 0 | `0` | sin Clase 54 |
| F10 | 5,9 | `5.9` | F03/F02×100 (1 decimal) |

### 6.2 Score de Riesgo — RECONCILIACIÓN (no asumir 68)
- El dueño espera `scoreRiesgo: 68`, calculado con su pseudocódigo. El sistema real
  usa `computeRiskScore` (mismos 5 factores, buckets {0,5,8,10,15,20,25,30}).
- **Computar el score REAL** sobre el fixture y **reportar la divergencia** si la hay
  (p.ej. 65 vs 68), identificando qué bucket de factor difiere. Lockear el valor
  REAL como fixture de regresión. NO forzar 68 si el algoritmo determinístico da otro.
  Documentar el hallazgo para revisión del dueño.

### 6.3 Capas + stress
- **Capa 1 (Aritmética):** F04=F02−F03; F02=round(F01×0.35); identidades en centavos
  exactos (tolerancia $0).
- **Capa 2 (Lógica negocio):** alertas correctas (A5 si F01>0 ∧ F09=0; SALDO_A_FAVOR si
  F04<0; F10_BAJA si aplica); score nivel coherente.
- **Capa 3 (Defensa tributaria / Art. 647):** las citas en alertas/score son las
  correctas (verificar contra el dictamen del Oráculo §7). Regresión: el output no
  induce inexactitud sancionable.
- **Stress:** auxiliares vs resumen (suma hojas = totales control), coherencia
  caja vs utilidad, escenarios extremos (sin comparativo, ingresos=0).

### 6.4 Archivos que VALIDATOR escribe (disjuntos)
- `src/lib/agents/financial/escudo-survival/fiscal-anchor/__tests__/*.test.ts` (nuevos)
- `__fixtures__/` (nuevos o extendidos)
- **NO toca** código de producción (backend/UI).

---

## 7. Contrato ORÁCULO (Opus · escudo-tributario-co · read-only)

Emitir un dictamen citado (NO escribe código) verificando para 2026:
1. **Art. 240 E.T.** — tarifa renta 35% (impuesto referencial F02).
2. **Art. 240 par. 6 E.T. / Ley 2277/2022 Art. 10** — Tasa de Tributación
   Depurada mínima 15% (umbral F09 del score y alerta tasa mínima).
3. **Art. 850 / 854 E.T.** — devolución/compensación saldo a favor (F04<0) y
   prescripción 2 años (factor 5 del score + alerta SALDO_A_FAVOR).
4. **Art. 647 E.T.** — sanción por inexactitud (defensa que el validator regresiona).
5. **Art. 242 E.T.** — dividendos (si aparece en contexto del asistente).
Salida: tabla {afirmación en código → norma exacta → ✔/✘ → corrección}. Los demás
equipos aplican las correcciones en Fase 3.

---

## 8. Matriz de propiedad de archivos (DISJUNTA — sin colisión de merge)

| Archivo | Equipo |
|---|---|
| `types.ts` (FiscalSnapshot) | **Fase 0 (congelado)** — nadie más escribe |
| `orchestrator.ts` | Backend |
| `api/financial-report/niif/route.ts` | Backend |
| `api/escudo/fiscal-anchor/**` (nuevos) | Backend |
| `escudo-survival/fiscal-anchor/snapshot.ts, alert-mapping.ts` (nuevos) | Backend |
| `workspace/escudo/page.tsx` | UI |
| `areas/EscudoArea.tsx` | UI |
| `PipelineWorkspace.tsx` | UI |
| `context/WorkspaceContext.tsx` | UI (solo si pendingChatContext) |
| `i18n/dictionaries.ts` | UI |
| `escudo-survival/fiscal-anchor/__tests__/**`, `__fixtures__/**` | Validator |
| (ningún archivo) | Oráculo (read-only) |

---

## 9. Números esperados — "Grupo Empresarial 2 Tres SAS 2025"
Ver §6.1. **Toda cifra monetaria viaja como string de centavos (MoneyCop).** Los
pesos del dueño son solo para lectura humana. El renderer formatea con
`formatCopFromCents`. F09/F10 son `number` con 1 decimal.

---

## 10. Reglas duras (TODOS los equipos)
1. **MoneyCop:** centavos como string/BigInt. NUNCA floats para dinero. Multiplicar
   via `pctOfCents`, no `× 0.35`. Helpers en `contracts/money.ts`.
2. **Zod strict-mode 2026:** `.nullable()` siempre; NUNCA `.optional()`/`.nullish()`/
   `.default()`/`.passthrough()`/`z.record()` en schemas que van al LLM. (No aplica a
   tipos TS puros como FiscalSnapshot.)
3. **Prompts GPT-5.4:** sin numeración procedural; XML tags + `<success_criteria>`;
   `ALWAYS/NEVER/MUST` solo para safety rails; sin "be thorough"/"double-check".
   (Este flujo es determinístico — probablemente no añade prompts nuevos.)
4. **No duplicar** cálculo F01-F10 ni alertas. Reutilizar lo existente.
5. **Anti-alucinación:** cero cifras inventadas; todo deriva del balance.
6. Validar con `npx tsc --noEmit` antes de declarar done. Validator corre `npx vitest run`.
