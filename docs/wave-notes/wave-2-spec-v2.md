# Wave 2 — Spec v2.0 / 1+1 Financial Pipeline (DONE 2026-05-12)

La especificación normativa del pipeline financiero 1+1 vive en **`docs/spec/financial-pipeline-v2.md`** (superseded por v2.1 en Wave 6). Cuando un prompt o regla determinista entre en conflicto con ese documento, el documento gana. Cita por número de Parte/Sección en commits y PRs.

Componentes implementados — 7 commits sobre `5e903e6`.

## Reglas anti-bug críticas

- **Anti-duplicación Grupo 53** (Parte 1.3 + 8.1 CHECK 4): defensa triple en (a) prompt Pass-1 (`niif-analyst.prompt.ts` constraint + success_criteria), (b) preprocessor (`controlTotals.gastos` consolida correctamente), (c) validator E8 (`niif-json-validator.ts`). Si el LLM lista `Grupo 53 total` + subcuentas `5305/5395` como líneas independientes sumadas, E8 lo detecta y rechaza el reporte (caso histórico: $30.262.041 duplicados).
- **Tabla 8 anomalías** (Parte 5): anomalías 1-5 cubiertas por el curator existente (R1, R4, R7). Anomalías 6/7/8 nuevas: `r17-supplier-debit-balance.ts` (Cta 22 > 0), `r18-equity-negative.ts` (patrimonio neto < 0 — NIC 1 §25 / Art. 459 C.Co.), `r19-net-margin-over-70.ts` (utilidad neta / ingresos > 70% — NIA 240).
- **Cascada impuestos** (Parte 4.1): Pass-1 prompt cubre los 3 casos — Clase 54 → Cta 1805 → 35% teórico con nota provisión pendiente.

## KPIs deterministas (single source of truth)

El preprocessor (`trial-balance.ts`) ahora deriva 14 KPIs cardinales en `controlTotals` como strings decimales, emitidos en `bindingTotalsBlock` con autoridad vinculante: `razonCorriente`, `pruebaAcida`, `endeudamientoTotal`, `apalancamientoFinanc`, `coberturaIntereses`, `margenOperativo`, `margenNeto`, `roe`, `roa`, `rotacionActivos`, `diasCartera`, `diasInventario`, `diasProveedores`, `ebit`. Cuando el denominador es anómalo (< 1% ingresos para inventario/proveedores), el ratio es `null` y se renderiza como `"ND"` con diagnóstico explícito (NIA 240).

**Strategy Director consume estos pre-calculados como ancla** (con fallback defensivo). Idem PDF Élite `compose.ts:buildDialGauges` — los bugs P0 históricos (Prueba Ácida hardcoded inventario=0, Cobertura Intereses hardcoded 0) están eliminados: ahora consumen `controlTotals.{pruebaAcida|coberturaIntereses}` reales.

`KpiSchema.resultPrimary` admite `z.literal('ND')` para marcar KPIs no confiables sin romper el contrato.

## Devoluciones 4175 (Parte 1.3)

`controlTotals` ahora expone tanto `ingresos` (bruto Clase 4) como `ingresosNetos = |Σ 41xx| − |Σ 4175xx|` y `totalDevoluciones`. `bindingTotalsBlock` emite ambas con etiqueta `NIIF 15 §47`. El LLM ya no puede confundirse re-aplicando la resta.

## Decision tree 3605 (Parte 3)

`PeriodSnapshot.periodoTipo: 'cerrado' | 'parcial' | 'indeterminado'` se infiere del header del balance (Ene-Dic = cerrado; cualquier rango parcial = parcial; sin info = indeterminado). R8 (`r8-virtual-close.ts`) bifurca el texto de su finding:
- `cerrado`: "NOTA OBLIGATORIA — el contador DEBE corregir el asiento antes de firmar..."
- `parcial`: "NOTA EXPLICATIVA — corte intermedio del año fiscal; práctica habitual..."

## Validators (Capa 1 Elite Protocol extendida)

`niif-json-validator.ts` ahora tiene 8 checks E1..E8:
- E1..E6: invariantes existentes (A=P+C, EFE cierre, ECP saldo, etc.).
- **E7 (nuevo)**: Variación `resultadoEjercicio` en ECP == `incomeStatement.netIncomePrimary` (tolerancia 0.5%).
- **E8 (nuevo)**: Σ líneas `incomeStatement.lines` con `account.startsWith('5')` ≤ `controlTotals.gastos` + 1% tolerance (anti-dup Grupo 53).

## Governance Specialist v2.0

`GovernanceReportSchema` extendido con:
- `complianceChecklist: z.array(ComplianceChecklistItemSchema).min(8)` — el "Checklist de cumplimiento normativo" del spec Parte III §3 (antes ausente por completo).
- `disclaimers: z.array(DisclaimerSchema)` con `code: enum` de 6 valores literales del spec Parte 9 (`laboral_sin_detalle`, `costo_insuficiente`, `impuesto_no_reconciliable`, `sin_comparativo`, `ajuste_3605`, `inversiones_negativas`).
- `FinancialNoteNumberSchema` ampliado a 1..16: Nota 15 "Partes Vinculadas" (NIC 24) + Nota 16 "Autorización para la Publicación" (NIC 10 §17).
- `ShareholderMinutesSchema.convocationStatement` — declaración Art. 424 C.Co.
- Orden del día canónico incluye "Aprobación de la gestión de los administradores" (Art. 187 §3 Ley 222/1995) y "Designación o ratificación de cargos" (Art. 187 §4).

**Detector regex anti-evasivo refactorizado**: usa look-ahead negativos para discriminar frases evasivas genéricas (bloquear) de disclaimers normados (permitir). Los 6 disclaimers del spec viven en su propio campo `disclaimers[]` y se exceptúan del escaneo por contrato.

## Tests

601 tests verde sobre 59 archivos (vs 544 baseline):
- `niif-json-validator.test.ts`: +9 (E7/E8)
- `wave2-f4.test.ts` + `wave2-f4-binding.test.ts`: +28 (KPIs determinísticos + bindingTotals)
- `spec-v2-integration.test.ts`: +20 (end-to-end por regla del spec)

## Runbook — cuando rompa en producción

1. `/api/admin/telemetry?hours=24` → buscar pattern de finish_reason no-stop en cualquier pass.
2. Si E8 dispara con frecuencia → el LLM está confundiéndose con bindingTotals; revisar `niif-analyst.prompt.ts` Pass-1 constraint "Anti-duplicación Grupo 53".
3. Si E7 dispara → el ECP del LLM tiene inconsistencia entre `resultadoEjercicio` y la Utilidad Neta del P&L; revisar Pass-2 success_criteria.
4. Si R18 dispara → el balance recibido tiene patrimonio neto < 0 (insolvencia técnica); operativamente esperado, pero el `governance` debe emitir el dictamen "con salvedades" — verificar `governance-specialist.ts:detectForbiddenPhrasesInJson` no esté bloqueando disclaimers válidos.
5. Si la Prueba Ácida o Cobertura Intereses muestran 0 en PDF Élite cuando deberían tener valor → el snapshot recibido es pre-F4 (sin los nuevos campos `inventarios14` / `gastoFinanciero5305`); regenerar reporte con `controlTotals` actuales.
6. Reversibilidad: cada uno de los 7 commits Wave 2 (`b36acb5` F1, `da959bb` F2, `7c88e0f` F3, `74ec5a3` F4, `05c1339` F5, `d69c3ff` F6, `5e903e6` F7) es revertible individualmente sin tocar los demás. F4 es el más impactful — revertir F4 obliga a revertir F6 (depende de los nuevos campos) y los tests F7 que los citan.
