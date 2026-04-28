# Refactor multiperíodo — análisis comparativo year-over-year

> **Estado:** completado 2026-04-28. `tsc` limpio, `npm run build` OK, migración DB aplicada vía `npm run db:push`.

## 1. Origen del bug

Un usuario subió un Excel con datos 2024 y 2025 (en columnas `Saldo 2024 | Saldo 2025` o en hojas separadas) y pidió un análisis comparativo. El reporte solo cubrió 2025; los datos de 2024 desaparecieron silenciosamente, aunque sí estaban en el archivo.

Cuatro auditorías paralelas (upload+OCR, preprocessing, tool calling, prompts) convergieron en una causa raíz multi-capa:

1. **Mecánica del parser**. `parseTrialBalanceCSV` solo capturaba **una** columna de saldo. Al ver `Saldo 2024 | Saldo 2025`, `findColumnIndex(['saldo', ...])` devolvía el primer match (2024) y la segunda columna era invisible. `RawAccountRow.period` existía pero nunca se asignaba.
2. **Concatenación naive de hojas Excel**. `workbook.eachSheet()` concatenaba con `--- Sheet: NAME ---` como separador textual, pero el parser leía los headers de columna **una sola vez** (de la primera hoja) y los aplicaba a las siguientes; si los órdenes de columna diferían, las cifras se interpretaban mal.
3. **Truncados aditivos**. Cinco capas truncaban silenciosamente: Zod schema (200K), orchestrator (80K), `BaseSpecialist` (80K), `analyze_document` (60K), `ReportFollowUpChat` (40K). El más estricto (40K) cortaba balances grandes en el chat de seguimiento.
4. **Prompts inertes**. Los prompts NIIF/Strategy ya tenían instrucciones tipo "si existe periodo comparativo, úsalo", pero `comparativePeriod` no se inyectaba en `enhancedInstructions` del route, así que los modelos nunca activaban la rama comparativa.

## 2. Decisión de diseño — opción B (refactor amplio)

Se descartó el shim de retrocompatibilidad. **Todos** los pipelines aprendieron multiperíodo:

- Pipeline financiero (NIIF/Strategy/Governance)
- Quality auditor + Audit pipeline (4 auditores)
- Tax Planning, Tax Reconciliation, Transfer Pricing, Valuation, Fiscal Opinion, Feasibility (6 specialists)
- Repair Doctor + chat de seguimiento

## 3. Contrato canónico

Los nuevos tipos están en [src/lib/preprocessing/trial-balance.ts](src/lib/preprocessing/trial-balance.ts).

```ts
interface RawAccountRow {
  code: string; name: string; level: string; transactional: boolean;
  /** Saldos por período. Claves: "2024", "2025", … */
  balancesByPeriod: Record<string, number>;
}

interface ValidatedAccount {
  code: string; name: string; level: string;
  balance: number;        // SOLO el balance del snapshot al que pertenece
  isLeaf: boolean;
}

interface PUCClass {
  code: number; name: string;
  auxiliaryTotal: number;
  reportedTotal: number | null;
  discrepancy: number;
  accounts: ValidatedAccount[];
}

interface PeriodSnapshot {
  period: string;                     // "2024", "2025"
  classes: PUCClass[];
  controlTotals: ControlTotals;
  equityBreakdown: EquityBreakdown;
  summary: { totalAssets, totalLiabilities, …, equationBalanced };
  validation: ValidationResult;
  discrepancies: Discrepancy[];
  missingExpectedAccounts: string[];
}

interface PreprocessedBalance {
  periods: PeriodSnapshot[];          // No vacío. Asc (más antiguo → más nuevo).
  primary: PeriodSnapshot;            // = periods[N-1]
  comparative: PeriodSnapshot | null; // = periods[N-2] o null
  rawRows: RawAccountRow[];
  auxiliaryCount: number;
  cleanData: string;                  // CSV etiquetado [period=YYYY] por bloque
  validationReport: string;           // Markdown human-readable
}

// CompanyInfo en src/lib/agents/financial/types.ts gana:
detectedPeriods?: string[];
```

**Reglas duras**:
- Un consumer que solo necesite período actual lee `preprocessed.primary.summary` (NO `preprocessed.summary` — ya no existe).
- Para comparativos: `preprocessed.primary` vs `preprocessed.comparative`.
- Si `periods.length === 1`, `comparative` es `null`. Los prompts deben degradar elegantemente y declararlo: `"Sin periodo comparativo disponible"`.

## 4. Pipeline de detección de períodos

Tres mecanismos en cascada (de más fuerte a más débil):

1. **Nombre de hoja Excel**. Una hoja llamada `2024` etiqueta TODAS sus filas con `period='2024'` (parámetro `forcePeriod`).
2. **Header con año explícito**. Regex `/saldo|balance|neto/i` × `/20\d{2}/` extrae el año de cada columna (`Saldo 2024`, `Saldo Final 2025`, `Saldo a Diciembre 31 2024`).
3. **Heurística "saldo / saldo anterior"**. Si hay dos columnas sin año pero una contiene `'saldo'` y otra `'anterior'/'comparativo'/'prior'`, se asume `currentYear` y `currentYear - 1` (requiere `currentYear` en options).

Implementado en [src/lib/preprocessing/trial-balance.ts](src/lib/preprocessing/trial-balance.ts) (`detectBalanceColumns`, `detectYearFromString`, `sortPeriodsAscending`).

La extracción Excel ([src/app/api/upload/route.ts](src/app/api/upload/route.ts) líneas ~298-310) ahora itera hoja por hoja, etiqueta cada bloque con `[period=YYYY]…[/period]` (o `[period=current]` si no detecta año), y devuelve `detectedPeriods: string[]` en la response del endpoint.

## 5. Cambios por capa

### 5.1 Foundation (T1)
- [src/lib/preprocessing/trial-balance.ts](src/lib/preprocessing/trial-balance.ts) — refactor completo. `parseTrialBalanceCSV` acepta `forcePeriod`. `preprocessTrialBalance` corre validación patrimonial **por snapshot** (cada período con su propia ecuación, equityBreakdown, controlTotals, summary).
- [src/lib/agents/financial/types.ts](src/lib/agents/financial/types.ts) — `CompanyInfo.detectedPeriods?: string[]`.
- [src/lib/validation/schemas.ts](src/lib/validation/schemas.ts) — `export const DOCUMENT_MAX_CHARS = 500_000` (subió de 200K). Todas las validaciones de texto crudo (`rawData`, `financialData`, `projectData`, `documentContext`) lo importan.
- [src/app/api/upload/route.ts](src/app/api/upload/route.ts) — extracción Excel hoja por hoja con etiquetado de período.

### 5.2 Pipeline NIIF/Strategy/Governance (T2)
- [src/lib/agents/financial/orchestrator.ts](src/lib/agents/financial/orchestrator.ts) — helpers `getPrimarySnapshot`/`getComparativeSnapshot`. `buildBindingTotalsBlock` emite tres secciones cuando hay 2+ períodos (`=== Periodo actual ===`, `=== Periodo comparativo ===`, `=== Variación YoY ===`) con `pctYoY()` y `absDelta()`.
- 3 agents y 3 prompts (`niif-analyst`, `strategy-director`, `governance-specialist`) — bloque `## MODO COMPARATIVO` con regla inviolable: "produce TODOS los EEFF / KPIs / análisis con DOS columnas + variación absoluta y %. NUNCA omitas el comparativo. Si las cifras del comparativo son 0/null, usa `ND` explícito".
- [src/lib/agents/financial/validators/report-validator.ts](src/lib/agents/financial/validators/report-validator.ts) — `ValidateConsolidatedReportOptions { comparativeTotals, primaryPeriod, comparativePeriod }`. Tags `[YYYY]` en cada warning.
- [src/app/api/financial-report/route.ts](src/app/api/financial-report/route.ts) y `/export` — autocompletan `effectiveCompany.comparativePeriod` desde `preprocessed.periods` cuando no viene en el body.

### 5.3 Quality + Audit + Excel export (T3)
- [src/lib/agents/financial/quality/prompt.ts](src/lib/agents/financial/quality/prompt.ts) — nueva dimensión **D14 (Cobertura Multiperíodo)** anclada en NIC 1 par. 38 + IASB QC20-QC25. Si `preprocessed.periods.length > 1` y el reporte solo cubre uno → hallazgo crítico, score D14 ∈ [0, 30].
- [src/lib/agents/financial/audit/types.ts](src/lib/agents/financial/audit/types.ts) — `AuditFinding.period?: string` (formatos: `"2025"`, `"2024 → 2025"`, omitido).
- [src/lib/agents/financial/audit/orchestrator.ts](src/lib/agents/financial/audit/orchestrator.ts) — acepta `preprocessed?: PreprocessedBalance`; construye `buildPeriodContext()` con tablas comparadas que los 4 auditores leen.
- 4 prompts de auditoría — sección "Coherencia Inter-Período" con reglas duras:
  - **NIIF**: cuadre del Estado de Cambios en el Patrimonio (saldo inicial = comparative, final = primary).
  - **Tax**: evolución de PUC 24 (impuestos por pagar).
  - **Legal**: movimiento patrimonial = utilidad − dividendos del acta; reserva legal acumulativa.
  - **Fiscal Reviewer**: NIA 710 (información comparativa); salvedad si el reporte ignora comparativo disponible.
- [src/lib/export/excel-export.ts](src/lib/export/excel-export.ts) — reescrito. Layout multiperíodo: `Cuenta | Saldo Y-1 | Saldo Y | Δ$ | Δ%`. KPIs calculados deterministamente por código (no parseados del LLM) con dos columnas por período.

### 5.4 Specialist pipelines (T4) — 18 prompts + 5 routes
Bloque `## MODO MULTIPERIODO` añadido a cada prompt, especializado por dominio:

| Pipeline | Énfasis |
|---|---|
| Tax Optimizer | Tarifa efectiva YoY; tendencia |
| NIIF Impact | NIC 12 par. 81(g) movimiento del ejercicio |
| Compliance Validator | Trayectoria como bandera Art. 869 ET |
| Difference Identifier | Art. 772-1 ET requiere comparativo |
| Deferred Tax | Sin comparativo, "gasto por impuesto diferido" no se determina fielmente |
| TP Analyst | Análisis YoY de operaciones con vinculados (Formato 1125) |
| Comparable Analyst | OCDE Cap. III: 3-5 años, rango intercuartil plurianual |
| DCF Modeler | Tasas YoY como input; CAPEX/WC promedio |
| Market Comparables | Multiplos sobre EBITDA promedio + período actual |
| Going Concern | NIA 570 par. 12-13 "pérdidas recurrentes" requiere >1 período |
| Misstatement Reviewer | NIC 8 reclasificaciones requieren comparativo |
| Opinion Drafter | NIA 710 (Información Comparativa); párrafo de otras cuestiones (NIA 706) si falta |
| Feasibility (3) | Anclaje histórico para CAGR/sensibilidad; flag de riesgo si solo 1 período |

5 routes (`tax-planning`, `tax-reconciliation`, `transfer-pricing`, `business-valuation`, `fiscal-audit-opinion`) autocompletan `comparativePeriod` desde `company.detectedPeriods`. La route `feasibility-study` no se tocó (usa `ProjectInfo`, no `CompanyInfo`).

### 5.5 Repair Doctor + límites unificados (T5)
- [src/lib/agents/repair/types.ts](src/lib/agents/repair/types.ts) — `Adjustment.period?`, `ReadAccountInput.period?`, `ProposeAdjustmentInput.period?`, `RecheckValidationInput.period?`.
- [src/lib/agents/repair/adjustments.ts](src/lib/agents/repair/adjustments.ts) — `cloneBalance` clona cada `PeriodSnapshot`; `applyAdjustments` resuelve `adj.period ?? primary.period`, dispatcha al snapshot correcto y recomputa solo los snapshots dirty.
- [src/lib/agents/repair/tools.ts](src/lib/agents/repair/tools.ts) — `read_account` sin `period` devuelve **ambos** saldos (primary + comparative) en una sola tool call, vía el campo `comparative` del output.
- [src/lib/agents/repair/prompt.ts](src/lib/agents/repair/prompt.ts) — sección "Modo comparativo" instruye al doctor a (a) tag de período en toda cita, (b) usar `period` arg en tools, (c) detectar inconsistencias inter-período (ej: cierre 3705 en `comparative` ≠ apertura en `primary`).
- [src/lib/agents/repair/persistence.ts](src/lib/agents/repair/persistence.ts) — round-trip de `adj.period` a/desde la DB.
- [src/lib/db/schema.ts](src/lib/db/schema.ts) — columna `period text` (nullable) en `repair_adjustments`.

**Truncados unificados**. Antes / después:

| Lugar | Antes | Después |
|---|---|---|
| `lib/agents/orchestrator.ts` (default) | `30_000` | `DOCUMENT_MAX_CHARS` + `console.warn` |
| `lib/agents/orchestrator.ts` (financial) | `80_000` | `DOCUMENT_MAX_CHARS` + `console.warn` |
| `lib/agents/specialists/base-agent.ts` | `80_000` | `DOCUMENT_MAX_CHARS` + `console.warn` |
| `lib/tools/document-analyzer.ts` | `60_000` | `DOCUMENT_MAX_CHARS` + `console.warn` |
| `app/api/chat/route.ts` (legacy) | `30_000` | `DOCUMENT_MAX_CHARS` + `console.warn` |
| `components/workspace/ReportFollowUpChat.tsx` | `40_000` | `DOCUMENT_MAX_CHARS` + nota visible "[…rawData truncado…]" |
| `lib/validation/schemas.ts` `documentContext` | `100_000` | `DOCUMENT_MAX_CHARS` |

Cuando truncar es inevitable, se emite `console.warn(...)` server-side con la cantidad de caracteres perdidos.

## 6. Migración DB

Aplicada el 2026-04-28 vía `npm run db:push`. Cambios efectivos en Neon Postgres:

- `ALTER TABLE repair_adjustments ADD COLUMN period text;` (nullable, additive — habilita el Repair Doctor multiperíodo).
- Tablas `pyme_books`, `pyme_categories`, `pyme_entries`, `pyme_uploads` creadas (parte del módulo PYME en progreso, no del refactor multiperíodo, pero coexistían en el schema TS al momento del push).

## 7. Cómo reproducir el fix

1. Sube un Excel con dos hojas (`2024`, `2025`) o con columnas `Saldo 2024 | Saldo 2025`.
2. En el orchestrador NIIF, espera ver:
   - Estados financieros con dos columnas + variación absoluta y %.
   - Estado de Cambios en el Patrimonio que va de saldo inicial (`comparative.equityBreakdown`) a saldo final (`primary.equityBreakdown`).
   - KPIs (Razón Corriente, Margen Neto, ROA, Endeudamiento) calculados para ambos períodos.
3. En la auditoría, los `AuditFinding[]` deben llevar `period: "2025"` (período auditado) o `period: "2024 → 2025"` (hallazgos inter-período).
4. Si el archivo solo trae un período, los prompts entran en `## MODO SINGLE-PERIOD` y declaran "Sin periodo comparativo disponible" en lugar de inventar columnas vacías.

## 8. Decisiones que evitar revisitar

- **`preprocessed.summary` ya NO existe al top level**. Vive dentro de cada `PeriodSnapshot`. Cualquier consumer nuevo lee `preprocessed.primary.summary` o itera `preprocessed.periods[i].summary`.
- **`RawAccountRow.balance` y `previousBalance` ya NO existen**. Reemplazados por `balancesByPeriod: Record<string, number>`.
- **`ReadAccountOutput.account.previousBalance` se eliminó**. La info equivalente vive en `ReadAccountOutput.comparative.balance`.
- **NO usar el viejo nombre `missingAccounts`**. El campo se llama `missingExpectedAccounts` en `PeriodSnapshot`.

## 9. Próximos pasos sugeridos (post-merge)

1. Aplicar la migración DB (§6).
2. Regression test manual: subir el Excel original del bug y validar que ambos períodos llegan al reporte.
3. Considerar añadir `detectedPeriods` al UI (badge en la pantalla de upload mostrando "Detectados: 2024, 2025") para que el usuario tenga señal visible antes de generar el reporte.
4. Auditoría rápida del módulo PYME (untracked) por si comparte algún consumer con preprocessor — no debería, pero conviene chequear.
