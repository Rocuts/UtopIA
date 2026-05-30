# Diagnóstico técnico — Integración 4 Áreas con Âncora NIIF 2025

**Fecha:** 2026-05-30  
**Estado:** Producción (main)  
**Alcance:** `ValorArea`, `VerdadArea`, `FuturoArea`, `EscudoArea` + `useAncoraView` + `derive-ancora-view`

---

## 1. Arquitectura de la integración

### Stack y ubicación de archivos

UtopIA corre sobre **Next.js App Router + TypeScript**. Las 4 áreas del workspace viven en:

```
src/components/workspace/areas/
  EscudoArea.tsx   → /workspace/escudo
  ValorArea.tsx    → /workspace/valor
  VerdadArea.tsx   → /workspace/verdad
  FuturoArea.tsx   → /workspace/futuro
```

Cada área se enruta desde su `page.tsx` correspondiente en:

```
src/app/workspace/{escudo,valor,verdad,futuro}/page.tsx
```

### Cómo se lee el âncora (`useAncoraView`)

El hook `src/hooks/useAncoraView.ts` es la **única fuente autorizada** para leer el âncora en las áreas. NO se usa `window.storage` directamente.

Cadena de fuentes (en orden de precedencia):

1. **Local — sesión activa:** `lastCompletedReport.report.ancora` + `.fiscalSnapshot` (almacenado en `localStorage` vía `WorkspaceContext`). Este bloque lo puebla `PipelineWorkspace.tsx` en los checkpoints `setLastCompletedReport` tras completar el pipeline NIIF.
2. **Remoto — multi-dispositivo:** `GET /api/escudo/fiscal-anchor` (recupera con cookie de workspace si el `POST` guardó el snapshot).

El hook deriva un view-model `AncoraView` (en pesos colombianos) usando `src/lib/ancora/derive-ancora-view.ts`.

### Consecuencia crítica de la cadena de fuentes

> **El âncora solo existe tras generar un Informe NIIF en la sesión** (o si el `GET` multi-dispositivo lo recupera con la cookie de workspace activa).

Si el usuario abre `/workspace/valor` sin haber generado un informe NIIF primero, `view.hasData === false` y todas las áreas muestran mocks honestos (con fallback visual explícito).

### Orquestador de chat

- Componente: `ChatSidebar` en `PipelineWorkspace.tsx`
- Mecanismo: `setPendingChatSeed` + `router.push('/workspace')`
- Iconos: `lucide-react` (estándar en todo el proyecto)

---

## 2. Semántica honesta (Elite Protocol)

Los siguientes campos tienen semántica específica que NO debe invertirse ni renombrarse sin coordinación entre prompt, renderer y UI:

| Campo | Semántica correcta | Semántica INCORRECTA (evitar) |
|---|---|---|
| `ancora.A19` | Variación de caja (flujo efectivo del período) | Free Cash Flow |
| `ccvFiscal.F10` / `FiscalAnchorBlock.f10` | Cobertura de retenciones % = F03/F02×100 | "FCF" o cualquier métrica de inversión |
| `scoreRiesgoDIAN` | `fiscalSnapshot.riskScore.score` | Score NIIF / score de auditoría |
| Score DIAN (Factor 6, Art. 365) | `score = 68` tras commit f4731a7 | Cualquier valor inventado |

---

## 3. Pendientes técnicos (TODO — no resolver en esta iteración)

### TODO-1 — Persistencia multi-dispositivo del âncora NIIF

**Síntoma:** tras un `refresh` en otro dispositivo, `GET /api/escudo/fiscal-anchor` puede devolver solo `fiscalSnapshot` (score DIAN) sin el bloque `ancora` completo (métricas NIIF derivadas).

**Causa probable:** el `POST /api/escudo/fiscal-anchor` emitido desde `PipelineWorkspace.tsx` (~líneas 1793–1820) puede no incluir el bloque `ancora` en el body, solo `fiscalSnapshot`.

**Acción pendiente:** verificar el body del `POST` en esas líneas y confirmar que `ancora` viaja junto a `fiscalSnapshot`. Si no viaja, añadirlo.

**Restricción:** NO modificar esquema de base de datos ni migraciones. Solo verificar/ajustar el body del `fetch`.

---

### TODO-2 — Doble nomenclatura F10 ("Eficiencia fiscal" vs "Cobertura de retenciones")

**Síntoma:** `ccvFiscal.F10` está rotulado "Eficiencia fiscal" en algunas partes de la UI y `FiscalAnchorBlock.f10` aparece como "Cobertura de retenciones" en otras. Son la misma fórmula: `F03/F02 × 100`.

**Acción pendiente:** unificar el rótulo canónico en UI y docs. Recomendación: "Eficiencia fiscal (cobertura ret.)" con nota al pie citando Art. 365 ET.

---

### TODO-3 — Altman Z-Score: deuda de dato (Utilidades Retenidas X2)

**Estado actual:** `derive-ancora-view.ts` retorna `altmanZ = null` cuando falta la variable X2 (Utilidades Retenidas / Activos Totales). Esta es la decisión correcta de **honestidad financiera** — no se inventa el Z-Score.

**Acción pendiente:** capturar "Utilidades Retenidas" en el Âncora NIIF (bloque `ancora`) para activar el cálculo de Altman Z. Esto requiere que el pipeline NIIF exponga ese campo en el balance. Documentado como deuda de dato, no como bug.

---

### TODO-4 — `window.sendPrompt` / `window.storage` / Tabler Icons

**Contexto:** la capa `window.sendPrompt`, `window.storage` y las referencias a Tabler Icons son parte del componente `WindowBridge` — una capa de **compatibilidad para el diagnóstico de consola** (`DIAGNOSTICO_CONSOLA.js`).

**Impacto:** no destructivo. El flujo nativo de UtopIA (`setPendingChatSeed`, `useAncoraView`, `lucide-react`) no los necesita.

**Acción pendiente:** cuando el diagnóstico de consola quede obsoleto, `WindowBridge` puede eliminarse sin afectar ninguna función del producto. Documentado para evitar confusión futura.

---

### TODO-5 — Errores de compilación TypeScript

Este espacio se reserva para anotar cualquier error que el Lead reporte en `npx tsc --noEmit` o `npm run build`.

_(Vacío al 2026-05-30 — compilación limpia tras los cambios de esta ola.)_

---

## 4. Checklist de aceptación

| # | Criterio | Estado |
|---|---|---|
| 1 | `ValorArea` raíz tiene `data-modulo="valor"` | Hecho |
| 2 | `VerdadArea` raíz tiene `data-modulo="verdad"` | Hecho |
| 3 | `FuturoArea` raíz tiene `data-modulo="futuro"` | Hecho |
| 4 | `EscudoArea` raíz tiene `data-modulo="escudo"` | Pendiente (otro agente) |
| 5 | `npx tsc --noEmit` sin errores nuevos | Verificar |
| 6 | Score DIAN = 68 visible en `/workspace/escudo` tras informe NIIF | Verificar |
| 7 | F10 visible con valor defensible (no `null`, no inventado) | Verificar |
| 8 | Altman Z muestra "—" o "Requiere utilidades retenidas" (nunca número inventado) | Verificar |
| 9 | Mocks honestos visibles cuando `view.hasData === false` | Verificar |
| 10 | `window.sendPrompt` / `window.storage` no rompen si `WindowBridge` no está cargado | Verificar |

---

## 5. Cómo probar la integración completa

### Flujo principal (con datos reales)

1. Iniciar sesión en UtopIA (`npm run dev` → `localhost:3000`).
2. Ir a `/workspace` y generar un **Informe NIIF Elite** con un balance cargado.
3. Esperar a que el pipeline complete (checkpoint `setLastCompletedReport`).
4. Navegar a `/workspace/escudo` — verificar:
   - Score DIAN = **68** (Factor 6 Art. 365)
   - F10 = cobertura de retenciones (valor numérico, no `null`)
   - Alertas DIAN activas en los módulos correspondientes
5. Navegar a `/workspace/valor` — verificar:
   - Hero valor = Equity Value real (no mock)
   - Sub-KPIs con datos del balance
6. Navegar a `/workspace/verdad` — verificar:
   - Altman Z = "Requiere utilidades retenidas" (estado honesto) o valor real si X2 disponible
   - Score NIIF en gauge
7. Navegar a `/workspace/futuro` — verificar:
   - Oportunidades con valores reales del âncora (no mocks hardcodeados)

### Flujo de diagnóstico por consola

Si no se puede generar un informe NIIF, usar el script `DIAGNOSTICO_CONSOLA.js` en la DevTools del navegador:

```js
// El script puebla window.__utopia_debug__ con datos de prueba
// y emula el flujo de useAncoraView con datos sintéticos.
// Ver comentarios en WindowBridge.tsx para el protocolo completo.
```

Alternativamente, inyectar un snapshot de prueba en `localStorage`:

```js
localStorage.setItem(
  'utopia_workspace_v1',
  JSON.stringify({
    lastCompletedReport: {
      report: {
        ancora: { /* campos del AnchoraBlock */ },
        fiscalSnapshot: { riskScore: { score: 68 } }
      }
    }
  })
);
// Luego recargar la página.
```

---

## 6. Referencias

| Recurso | Ruta |
|---|---|
| Hook de lectura del âncora | `src/hooks/useAncoraView.ts` |
| View-model derivado | `src/lib/ancora/derive-ancora-view.ts` |
| Pipeline NIIF (checkpoint) | `src/components/workspace/PipelineWorkspace.tsx` |
| Endpoint multi-dispositivo | `src/app/api/escudo/fiscal-anchor/route.ts` |
| Score DIAN Factor 6 Art. 365 | commit `f4731a7` |
| Spec pipeline financiero v2.1 | `docs/spec/financial-pipeline-v2.1.md` |
| Ola anterior (Áreas + AncoraView) | memoria `project_areas_ancora_view.md` |
| Ola anterior (Escudo Capa 5) | memoria `project_escudo_capa5_autowire.md` |
