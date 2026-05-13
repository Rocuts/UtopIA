# Zod Strict Mode 2026 — Patron canonico UtopIA

> Status: authoritative. Cualquier schema Zod que viaje al LLM via
> `experimental_output: Output.object({ schema })` o `generateObject` DEBE
> seguir este patron. Violarlo rompe produccion.

## Stack actual (2026-05-13)

- `ai@6.0.174` — Vercel AI SDK v6
- `@ai-sdk/openai@3.0.58` — provider OpenAI
- `zod@4.3.6` — Zod v4 (con json-schema export nativo)

## Patron canonico — que SI, que NO

### Permitido en schemas que van al LLM

```ts
const Schema = z.object({
  // Required, no admite null
  workspaceId: z.string(),

  // Required, admite null (= "opcional" bajo strict)
  nitContext: z.string().nullable(),

  // Array siempre presente, vacio si no hay datos
  findings: z.array(FindingSchema),

  // Enum / literal union
  severity: z.enum(['low', 'medium', 'high']),
  niifGroup: z.union([z.literal(1), z.literal(2), z.literal(3)]),

  // Discriminated union (mismo set de campos por rama)
  opinion: z.discriminatedUnion('verdict', [
    z.object({ verdict: z.literal('favorable'), reason: z.string() }),
    z.object({ verdict: z.literal('con_salvedades'), reason: z.string() }),
  ]),
});
```

### Prohibido en schemas que van al LLM

```ts
const BadSchema = z.object({
  field1: z.string().optional(),        // ROTO: Zod v3 -> HTTP 400. Zod v4 -> type mangling silencioso.
  field2: z.string().nullish(),         // ROTO: equivalente a .optional().
  field3: z.array(X).default([]),       // ROTO: strict no admite defaults.
  field4: z.object({}).passthrough(),   // ROTO: incompatible con additionalProperties: false.
  field5: z.record(z.string(), z.any()), // ROTO: idem passthrough.
  field6: z.string().catchall(z.any()),  // ROTO: idem.
  field7: z.string().refine(...),        // IGNORADO: refinements son ignorados por strict; OK para
                                         // validacion cliente pero NO confiar en ellos para enforcement LLM.
});
```

## Por que

OpenAI strict mode (`response_format: { type: 'json_schema', strict: true }`) exige:

1. `additionalProperties: false` en TODO objeto.
2. TODAS las properties en `required[]`.
3. NO `default` (el modelo decide).
4. NO refinements/transforms (solo validacion estructural).
5. NO recursive schemas.

Modeling "valor ausente" en strict: usar `type: ["string", "null"]` (union con null),
que Zod v4 genera nativamente con `.nullable()`.

## Zod v3 vs v4 — que cambia

| Aspecto | Zod v3 | Zod v4 |
|---|---|---|
| JSON Schema export | Necesita zod-to-json-schema (3rd-party) | Nativo: `z.toJSONSchema()` |
| `.optional()` en strict | HTTP 400 instantaneo | Type mangling silencioso |
| `.nullable()` en strict | OK | OK (mismo mapping) |
| Precio de detectar el bug | Falla ruidosa en runtime | Falla silenciosa — el campo aparece como `string | undefined` en el output pero el modelo lo omite sin error |

**UtopIA esta en Zod v4 con ai@6** — la combinacion recomendada por Vercel 2026.
El riesgo v4 es peor que v3: las violaciones son silenciosas. El guardrail CI
(`npm run lint:strict-mode`) es la unica defensa automatica.

## Bugs historicos UtopIA

| Fecha | Bug | Resolucion |
|---|---|---|
| 2026-05-13 | Wave 4.F1 dejo `.nullable().optional()` en 7 campos de `niif-report.ts` | Hotfix d18fccd / 5dcd46c |
| 2026-05-13 | Wave 4.F2 dejo `.default([])` en `strategy-report.ts:315` | Wave 5.F1 |
| 2026-05-13 | `escudo-survival.ts` tenia 10 `.default([])` heredados | Wave 5.F2 |

## Guardrail CI

Script de lint en `scripts/lint-strict-mode.mjs` falla el build si detecta patrones
prohibidos. Correr:

```bash
npm run lint:strict-mode
```

El script hace grep de los patrones prohibidos sobre todos los archivos `*.ts` bajo
`src/lib/agents/financial/contracts/` y `src/lib/agents/financial/audit/`,
que son los directorios donde viven los schemas que viajan al LLM. Una coincidencia
produce exit code 1 y bloquea el pipeline CI.

Ver implementacion: `scripts/lint-strict-mode.mjs` (Wave 5.F3).

## Patron para "campo opcional"

Si el LLM puede o no llenar un campo, usar **siempre** `.nullable()`:

```ts
// CORRECTO
nota: z.string().nullable()  // El modelo emite null o un string

// INCORRECTO (legacy pre-strict)
nota: z.string().optional()  // El modelo OMITE el campo o lo emite — strict falla o mangling
```

## Patron para arrays

Si el LLM puede o no tener items en un array, usar **siempre** array sin default:

```ts
// CORRECTO
warnings: z.array(WarningSchema)
// El prompt instruye: "emit warnings: [] cuando no hay advertencias"

// INCORRECTO
warnings: z.array(WarningSchema).default([])
// strict mode rechaza el default; el modelo no sabe que emitir si "no hay datos"
```

El prompt del agente DEBE incluir la instruccion explícita: cuando el array este
vacio, emitir `[]` — no omitir el campo. Esto reemplaza la convencion `.default([])`.

## Patron para objetos anidados

```ts
// CORRECTO — cada nivel declara todos sus campos
const InnerSchema = z.object({
  label: z.string(),
  value: z.number().nullable(),
});

const OuterSchema = z.object({
  items: z.array(InnerSchema),
  meta: InnerSchema.nullable(),
});

// INCORRECTO — passthrough rompe additionalProperties:false en el nivel anidado
const BadInner = z.object({ label: z.string() }).passthrough();
```

## Checklist pre-merge para schemas nuevos o modificados

Antes de hacer merge de cualquier archivo bajo `src/lib/agents/financial/contracts/`
o `src/lib/agents/financial/*/contracts/`, verificar manualmente:

- [ ] Ningun campo usa `.optional()`, `.nullish()`, `.default(...)`, `.passthrough()`, `.catchall(...)`, o `z.record()`
- [ ] Todo campo "nullable" usa exactamente `.nullable()` y nada mas
- [ ] Todo array carece de `.default([])`; el prompt del agente correspondiente instruye emitir `[]` cuando vacio
- [ ] `npm run lint:strict-mode` pasa con exit 0
- [ ] `npx tsc --noEmit` pasa con exit 0

## Referencias

- [OpenAI Structured Outputs guide](https://platform.openai.com/docs/guides/structured-outputs)
- [AI SDK — zodSchema reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/zod-schema)
- [Zod v4 JSON Schema](https://zod.dev/json-schema)
- [vercel/ai PR #7298 — Zod v4 support](https://github.com/vercel/ai/pull/7298)
- [mastra-ai/mastra issue #16383 — Zod v3 vs v4 strict mode](https://github.com/mastra-ai/mastra/issues/16383)
