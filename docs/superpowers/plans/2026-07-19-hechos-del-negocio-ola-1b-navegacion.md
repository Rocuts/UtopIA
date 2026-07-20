# Hechos del negocio — Ola 1 · Team B (Navegación / chip) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el chat orquestado sugiera **una** ruta del workspace bajo la respuesta del asistente — un chip discreto y determinista, calibrado por el `confidence` del classifier — sin auto-navegar y sin repetir la ruta que ya se está viendo.

**Architecture:** El anclaje de Ola 0 ya está cableado: `orchestrate()` llama a `computeSuggestedRoute({domains, intent, confidence})` en sus dos salidas T2/T3 y devuelve `suggestedRoute` dentro de `OrchestrateResult`; el SSE ya lo envía completo vía `send('result', result)`. Team B (1) **llena el stub** `computeSuggestedRoute` con una tabla de mapeo determinista `domain(+intent)→ruta` + umbral de confianza (pura, unit-testeable), y (2) hace que **`ChatSidebar`** capture `suggestedRoute` del evento `result`, lo cuelgue del mensaje assistant, y renderice el chip con `router.push(href)` al click. Cero cambios en `orchestrator.ts`, en el pipeline de reportes, o en `dictionaries.ts`.

**Tech Stack:** TypeScript · Vitest (para la función pura) · React 19 / Next 16 App Router (`useRouter`/`usePathname`) · lucide-react · Tailwind (tokens `n-*`/`gold-*`).

## Global Constraints

- **Interfaces congeladas de Ola 0 (no redefinir):** `SuggestedRoute { label: string; href: string; moduleKey: string }` y `OrchestrateResult.suggestedRoute: SuggestedRoute | null` viven en `@/lib/agents/types`. `AgentDomain = 'tax' | 'accounting' | 'documents' | 'strategy' | 'litigation'`.
- **`computeSuggestedRoute` es PURA y sin `language`:** decide *routing* (moduleKey/href/label ES canónico). La *presentación localizada* (prefijo "Ir a"/"Go to") vive en `ChatSidebar`. Esto mantiene los unit tests limpios y respeta que orchestrator.ts no cambie (sus dos call-sites ya pasan exactamente `{domains, intent, confidence}`).
- **`intent` del classifier es snake_case en INGLÉS** (`tax_planning`, `requerimiento_response`, `risk_assessment`, `document_analysis`, …; ver `src/lib/agents/prompts/classifier.prompt.ts` líneas 68-75). El match es por **substring accent-insensitive** para tolerar tanto inglés como variantes en español.
- **Umbral conservador:** por diseño (§3 spec "empezar conservador/alto") el chip solo aparece con `confidence` alta. Constante `CONFIDENCE_THRESHOLD = 0.75`. El `classifier_error_fallback` (confidence 0.3) queda por debajo → sin chip. Los T1 ya devuelven `suggestedRoute: null` upstream.
- **Anti-ruido:** máximo **un chip por respuesta**; **no** se muestra si `href === pathname` actual (resuelto client-side, que es quien conoce el pathname); **sin** auto-navegación.
- **i18n:** Team B **NO** toca `src/lib/i18n/dictionaries.ts` (WIP ajeno + Team D es dueño único). El chip usa ternarios inline `language === 'es' ? … : …`, patrón ya omnipresente en `ChatSidebar`.
- **Sin persistencia del chip:** `toConvMessages` solo guarda `{id, role, content}`; el chip es **efímero** (vive en la respuesta fresca, desaparece al recargar). Es el comportamiento deseado — no se toca `conversation-history.ts`.
- **Chat surface sin framework de tests** (CLAUDE.md): la lógica testeada por Vitest vive en la función pura (B1). `ChatSidebar` (B2) se valida con `tsc` + `build`.

---

## File Structure

| Archivo | Responsabilidad | Task |
|---|---|---|
| `src/lib/agents/navigation/suggested-route.ts` (modificar) | Reemplazar el stub por la tabla de mapeo determinista + umbral | B1 |
| `src/lib/agents/navigation/__tests__/suggested-route.test.ts` (crear) | Unit tests de la función pura (precedencia, umbral, acentos, dominios) | B1 |
| `src/components/workspace/ChatSidebar.tsx` (modificar) | Capturar `suggestedRoute` del evento `result` → colgarlo del mensaje assistant → chip con `router.push` | B2 |

---

## Task B1: `computeSuggestedRoute` — tabla de mapeo determinista

**Files:**
- Modify: `src/lib/agents/navigation/suggested-route.ts`
- Test: `src/lib/agents/navigation/__tests__/suggested-route.test.ts`

**Interfaces:**
- Consumes: `AgentDomain`, `SuggestedRoute` de `@/lib/agents/types` (importados relativos `../types`, como el stub actual).
- Produces: `function computeSuggestedRoute(input: { domains: AgentDomain[]; intent: string; confidence: number }): SuggestedRoute | null` — misma firma que el stub de Ola 0 (no cambia; orchestrator.ts la llama tal cual).

- [ ] **Step 1: Escribir el test que falla**

Crear `src/lib/agents/navigation/__tests__/suggested-route.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeSuggestedRoute } from '../suggested-route';
import type { AgentDomain } from '../../types';

const call = (domains: AgentDomain[], intent: string, confidence = 0.9) =>
  computeSuggestedRoute({ domains, intent, confidence });

describe('computeSuggestedRoute', () => {
  it('devuelve null bajo el umbral de confianza', () => {
    expect(call(['tax'], 'tax_planning', 0.5)).toBeNull();
  });

  it('devuelve null con domains vacío', () => {
    expect(call([], 'anything')).toBeNull();
  });

  it('litigation → Defensa DIAN sin importar el intent', () => {
    const r = call(['litigation'], 'greeting');
    expect(r).toEqual({
      label: 'Defensa DIAN',
      href: '/workspace/escudo/defensa-dian',
      moduleKey: 'defensa-dian',
    });
  });

  it('tax + requerimiento_response → Defensa DIAN', () => {
    expect(call(['tax'], 'requerimiento_response')?.moduleKey).toBe('defensa-dian');
  });

  it('tax + recurso_reconsideracion → Defensa DIAN', () => {
    expect(call(['tax'], 'recurso_reconsideracion')?.moduleKey).toBe('defensa-dian');
  });

  it('tax + precios/transferencia → Precios de Transferencia', () => {
    expect(call(['tax'], 'transfer_pricing_query')?.moduleKey).toBe('precios-transferencia');
    expect(call(['tax'], 'precios_de_transferencia')?.moduleKey).toBe('precios-transferencia');
  });

  it('tax + tax_planning → Planeación Tributaria', () => {
    const r = call(['tax'], 'tax_planning');
    expect(r).toEqual({
      label: 'Planeación Tributaria',
      href: '/workspace/escudo/planeacion-tributaria',
      moduleKey: 'planeacion-tributaria',
    });
  });

  it('strategy + refund_strategy → Planeación Tributaria', () => {
    expect(call(['strategy'], 'refund_strategy')?.moduleKey).toBe('planeacion-tributaria');
  });

  it('strategy + due_diligence → Valor', () => {
    expect(call(['strategy'], 'due_diligence')?.moduleKey).toBe('valor');
  });

  it('strategy + valoración (con acento) → Valor', () => {
    expect(call(['strategy'], 'valoración_empresa')?.moduleKey).toBe('valor');
  });

  it('accounting + revisoria_fiscal → Verdad', () => {
    expect(call(['accounting'], 'revisoria_fiscal')?.moduleKey).toBe('verdad');
  });

  it('accounting + dictamen → Verdad', () => {
    expect(call(['accounting'], 'dictamen_review')?.moduleKey).toBe('verdad');
  });

  it('strategy + feasibility/escenarios → Futuro', () => {
    expect(call(['strategy'], 'feasibility_study')?.moduleKey).toBe('futuro');
    expect(call(['strategy'], 'escenario_projection')?.moduleKey).toBe('futuro');
  });

  it('tax genérico (iva_treatment) → null (conservador)', () => {
    expect(call(['tax'], 'iva_treatment')).toBeNull();
  });

  it('accounting genérico (niif_recognition) → null (conservador)', () => {
    expect(call(['accounting'], 'niif_recognition')).toBeNull();
  });

  it('precedencia: litigation gana sobre un intent de planeación', () => {
    expect(call(['litigation', 'tax'], 'tax_planning')?.moduleKey).toBe('defensa-dian');
  });

  it('todas las rutas devueltas existen bajo /workspace', () => {
    const hrefs = [
      call(['litigation'], 'x')?.href,
      call(['tax'], 'transferencia')?.href,
      call(['tax'], 'tax_planning')?.href,
      call(['strategy'], 'due_diligence')?.href,
      call(['accounting'], 'revisoria')?.href,
      call(['strategy'], 'feasibility')?.href,
    ];
    expect(hrefs).toEqual([
      '/workspace/escudo/defensa-dian',
      '/workspace/escudo/precios-transferencia',
      '/workspace/escudo/planeacion-tributaria',
      '/workspace/valor',
      '/workspace/verdad',
      '/workspace/futuro',
    ]);
  });
});
```

- [ ] **Step 2: Correr el test → RED**

Run: `npx vitest run src/lib/agents/navigation/__tests__/suggested-route.test.ts`
Expected: FAIL — el stub devuelve `null` para todos, así que fallan todas las aserciones no-null (litigation, tax_planning, etc.).

- [ ] **Step 3: Implementar `src/lib/agents/navigation/suggested-route.ts`** (reemplaza el archivo completo)

```ts
// Chip de navegación contextual. Rescata domains/intent del classifier y
// sugiere UNA ruta del workspace. Tabla de mapeo DETERMINISTA (no LLM) +
// umbral de confianza. El Equipo B (Ola 1) llenó este stub SIN tocar
// orchestrator.ts — sus dos call-sites ya pasan {domains, intent, confidence}.
//
// El anti-ruido "no sugerir la ruta que ya estás viendo" se resuelve
// client-side en ChatSidebar (que conoce el pathname); esta función solo
// mapea señal→ruta y aplica el umbral de confianza.
//
// IMPORTANTE: el `intent` del classifier es snake_case en INGLÉS
// (tax_planning, requerimiento_response, risk_assessment, …; ver
// classifier.prompt.ts). El match es por substring accent-insensitive para
// tolerar tanto inglés como variantes en español.

import type { AgentDomain, SuggestedRoute } from '../types';

// Umbral conservador (§3 spec: "empezar conservador/alto"). Por debajo NO se
// sugiere ruta. El classifier_error_fallback (confidence 0.3) queda excluido.
const CONFIDENCE_THRESHOLD = 0.75;

// minúsculas + sin diacríticos → substring-match robusto.
function normalizeIntent(intent: string): string {
  return intent
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

interface RouteRule {
  moduleKey: string;
  href: string;
  /** Etiqueta ES canónica; ChatSidebar antepone el prefijo localizado. */
  label: string;
  match: (domains: Set<AgentDomain>, intent: string) => boolean;
}

// PRIMER match gana. El orden ES la precedencia: litigio (un acto DIAN ya
// emitido) es la señal más específica y de mayor riesgo → va primero.
const ROUTE_RULES: readonly RouteRule[] = [
  {
    moduleKey: 'defensa-dian',
    href: '/workspace/escudo/defensa-dian',
    label: 'Defensa DIAN',
    match: (d, i) =>
      d.has('litigation') ||
      /dian|requerimiento|pliego|liquidacion|emplazamiento|reconsideracion|recurso|descargos|impugn|procedural_nullity|diferencia_criterio|647|appeal|defense/.test(
        i,
      ),
  },
  {
    moduleKey: 'precios-transferencia',
    href: '/workspace/escudo/precios-transferencia',
    label: 'Precios de Transferencia',
    match: (d, i) => d.has('tax') && /transferencia|precios|transfer_pric|transfer pricing/.test(i),
  },
  {
    moduleKey: 'planeacion-tributaria',
    href: '/workspace/escudo/planeacion-tributaria',
    label: 'Planeación Tributaria',
    match: (d, i) =>
      (d.has('tax') || d.has('strategy')) &&
      /planeacion|planning|optimiz|refund|devolucion|action_plan|tax_planning|refund_strategy/.test(i),
  },
  {
    moduleKey: 'valor',
    href: '/workspace/valor',
    label: 'Valor',
    match: (d, i) => d.has('strategy') && /valoracion|valuation|due.?diligence|due_diligence/.test(i),
  },
  {
    moduleKey: 'verdad',
    href: '/workspace/verdad',
    label: 'Verdad',
    match: (d, i) =>
      d.has('accounting') && /dictamen|revisoria|revisor|audit|conciliacion_fiscal|conciliacion fiscal/.test(i),
  },
  {
    moduleKey: 'futuro',
    href: '/workspace/futuro',
    label: 'Futuro',
    match: (d, i) =>
      d.has('strategy') &&
      /factibilidad|feasibility|escenario|scenario|macro|proyeccion|projection|budget_projection/.test(i),
  },
];

export function computeSuggestedRoute(input: {
  domains: AgentDomain[];
  intent: string;
  confidence: number;
}): SuggestedRoute | null {
  if (input.confidence < CONFIDENCE_THRESHOLD) return null;
  if (input.domains.length === 0) return null;

  const domains = new Set(input.domains);
  const intent = normalizeIntent(input.intent);

  for (const rule of ROUTE_RULES) {
    if (rule.match(domains, intent)) {
      return { label: rule.label, href: rule.href, moduleKey: rule.moduleKey };
    }
  }
  return null;
}
```

- [ ] **Step 4: Correr el test → GREEN**

Run: `npx vitest run src/lib/agents/navigation/__tests__/suggested-route.test.ts`
Expected: PASS (17 tests).

- [ ] **Step 5: Typecheck + guard strict-mode**

Run: `npx tsc --noEmit`
Expected: 0 errores.

Run: `npm run lint:strict-mode`
Expected: pass (suggested-route.ts no tiene Zod).

- [ ] **Step 6: Commit**

```bash
git add src/lib/agents/navigation/suggested-route.ts src/lib/agents/navigation/__tests__/suggested-route.test.ts
git commit -m "feat(facts): computeSuggestedRoute — tabla determinista domain/intent→ruta + umbral (Ola 1B)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task B2: Chip de navegación en `ChatSidebar`

**Files:**
- Modify: `src/components/workspace/ChatSidebar.tsx`

**Interfaces:**
- Consumes: `SuggestedRoute` (`@/lib/agents/types`, import type), `useRouter` (`next/navigation`), `ArrowRight` (`lucide-react`). El evento SSE `result` ya entrega el `OrchestrateResult` completo (incl. `suggestedRoute`).
- Produces: chip discreto bajo cada respuesta assistant que traiga `suggestedRoute` y cuya `href !== pathname`; al click → `router.push(href)`.

- [ ] **Step 1: Extender imports**

Cambiar la línea de `next/navigation` (actual `import { usePathname } from 'next/navigation';`) por:

```ts
import { usePathname, useRouter } from 'next/navigation';
```

Añadir `ArrowRight` al bloque de imports de `lucide-react` (mantener orden alfabético — va antes de `BookOpen`):

```ts
import {
  ArrowRight,
  BookOpen,
  Bot,
  ChevronLeft,
  ChevronRight,
  History,
  MessageSquare,
  Paperclip,
  Plus,
  Search,
  Send,
  Square,
  Trash2,
  X,
} from 'lucide-react';
```

Añadir el import de tipo (junto a los demás `@/…` imports, p.ej. tras el import de `@/lib/utils`):

```ts
import type { SuggestedRoute } from '@/lib/agents/types';
```

- [ ] **Step 2: Extender la interfaz `ChatMessage`**

En la sección `// ─── Types ───`, añadir el campo a `ChatMessage`:

```ts
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  error?: boolean;
  /** Chip de navegación sugerido (Ola 1B). Efímero — no se persiste. */
  suggestedRoute?: SuggestedRoute | null;
}
```

- [ ] **Step 3: Capturar `suggestedRoute` del evento `result`**

En `sendMessage`, cambiar el tipo de `finalData` (actual `let finalData: { content?: string } | null = null;`) por:

```ts
        let finalData: { content?: string; suggestedRoute?: SuggestedRoute | null } | null = null;
```

Y en el bloque de finalización, donde se construye `updated`, colgar el chip del mensaje assistant. Reemplazar:

```ts
        const updated = messagesRef.current.map((m) =>
          m.id === streamId ? { ...m, content: finalContent } : m,
        );
```

por:

```ts
        const routeSuggestion = finalData?.suggestedRoute ?? null;
        const updated = messagesRef.current.map((m) =>
          m.id === streamId ? { ...m, content: finalContent, suggestedRoute: routeSuggestion } : m,
        );
```

- [ ] **Step 4: Instanciar `router` en el componente**

Dentro de `ChatSidebar`, junto a `const pathname = usePathname();`, añadir:

```ts
  const router = useRouter();
```

- [ ] **Step 5: Renderizar el chip en `MessageBubble`**

Cambiar la firma de `MessageBubble` para recibir el pathname actual y el navegador. Reemplazar:

```ts
function MessageBubble({ msg, language }: { msg: ChatMessage; language: 'es' | 'en' }) {
  const isUser = msg.role === 'user';
  const hasContent = msg.content.trim().length > 0;
```

por:

```ts
function MessageBubble({
  msg,
  language,
  currentPath,
  onNavigate,
}: {
  msg: ChatMessage;
  language: 'es' | 'en';
  currentPath: string;
  onNavigate: (href: string) => void;
}) {
  const isUser = msg.role === 'user';
  const hasContent = msg.content.trim().length > 0;
  // Chip solo en respuestas del asistente, cuando hay sugerencia y NO es la
  // ruta que ya se está viendo (anti-ruido). Un chip por respuesta.
  const route = !isUser ? msg.suggestedRoute ?? null : null;
  const showChip = route !== null && route.href !== currentPath;
```

Luego, insertar el markup del chip **justo antes** del cierre del `<div>` exterior del bubble (después del `<div>` que contiene el contenido markdown/texto, y antes de su `</div>` de cierre — el que precede al `</div>` raíz del componente). Concretamente, tras el bloque `{isUser ? (...) : hasContent ? (...) : null}` y su `</div>`, añadir:

```tsx
      {showChip && route !== null && (
        <button
          type="button"
          onClick={() => onNavigate(route.href)}
          className={cn(
            'mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full',
            'text-2xs font-medium uppercase tracking-wider',
            'bg-gold-500/10 border border-gold-500/25 text-n-900',
            'hover:bg-gold-500/15 hover:text-n-1000 transition-colors',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
          )}
          aria-label={`${language === 'es' ? 'Ir a' : 'Go to'} ${route.label}`}
        >
          {language === 'es' ? 'Ir a' : 'Go to'} {route.label}
          <ArrowRight className="w-3 h-3 text-gold-500" />
        </button>
      )}
```

> Contraste (CLAUDE.md token polarity): texto `text-n-900` (tinta fuerte, segura sobre glass + tinte gold), hover **oscurece** a `n-1000` (nunca invierte polaridad); flecha decorativa en `text-gold-500`. Es el mismo patrón del CTA "Nuevo chat" ya presente en el componente.

- [ ] **Step 6: Pasar las props en el render de la lista de mensajes**

En el `.map` de mensajes (actual `{messages.map((m) => (<MessageBubble key={m.id} msg={m} language={language} />))}`), reemplazar por:

```tsx
                  {messages.map((m) => (
                    <MessageBubble
                      key={m.id}
                      msg={m}
                      language={language}
                      currentPath={pathname ?? ''}
                      onNavigate={(href) => router.push(href)}
                    />
                  ))}
```

- [ ] **Step 7: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: 0 errores (el `finalData.suggestedRoute ?? null` es `SuggestedRoute | null`; `MessageBubble` recibe `currentPath`/`onNavigate`).

Run: `npm run build`
Expected: build OK.

- [ ] **Step 8: Commit**

```bash
git add src/components/workspace/ChatSidebar.tsx
git commit -m "feat(facts): chip de navegación contextual en ChatSidebar (Ola 1B)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (contra el spec §3 + código real)

- §3 "Tabla de mapeo determinista (no LLM), nuevo archivo, indexa por el enum real `domains` + refinamiento por substring de `intent`" → B1 (`ROUTE_RULES`, `Set<AgentDomain>` + regex sobre intent normalizado). ✅ **Ajuste vs spec:** los substrings se construyeron contra las etiquetas REALES del classifier (snake_case inglés), no las españolas del ejemplo del spec — verificado en `classifier.prompt.ts`.
- §3 rutas verificadas existentes (`defensa-dian`, `planeacion-tributaria`, `precios-transferencia`, `valor`, `verdad`, `futuro`) → confirmadas con `find src/app/workspace`. ✅
- §3 "ChatSidebar lee `finalData.suggestedRoute` del evento `result` y, si no es null, renderiza un chip discreto; al click → `router.push(href)`" → B2 Steps 3-6. ✅
- §3 "Anti-ruido: solo con confidence alta + ruta ≠ la que ya se ve; sin auto-navegación; un chip por respuesta" → umbral `0.75` (B1) + `route.href !== currentPath` (B2) + un solo `showChip` por bubble. ✅
- §3 "Blast radius: 1 tabla de mapeo, 1 lectura + 1 componente chip en ChatSidebar; cero cambios en el pipeline de reportes" → exactamente B1+B2; orchestrator.ts, dictionaries.ts, y el pipeline de reportes intactos. ✅
- **i18n sin colisión con WIP:** el chip localiza su prefijo con ternario inline (patrón del propio ChatSidebar); NO se toca `dictionaries.ts`. ✅
- **Placeholder scan:** cada step trae código real completo (regex, tests, JSX). ✅
- **Type consistency:** `SuggestedRoute {label, href, moduleKey}` idéntico en B1 (return) y B2 (import type + `ChatMessage.suggestedRoute` + `MessageBubble`); firma de `computeSuggestedRoute` sin cambios (orchestrator.ts la sigue llamando). ✅
- **Fuera de alcance (otras olas/teams):** captura+persistencia de hechos (Team A ✅), panel Contexto (Team D), cálculo donation→TOTAL VINCULANTE (Team C), integración a reportes (Ola 2). Team B solo navegación. ✅

### Verificación final de rama (tras B1+B2)
- `npx tsc --noEmit` · `npm run build` · `npm run lint:strict-mode` · `npx vitest run src/lib/agents/navigation`
