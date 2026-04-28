# Modulo "Contabilidad Pyme" — Spec Canonico (Fase 0)

> Contrato vinculante para 5 agentes de implementacion paralelos. Cada
> agente solo edita los paths listados en SU bloque. Cualquier desviacion
> debe documentarse y respaldarse con razon tecnica.
>
> Repo raiz: `/Users/rocuts/Documents/GitHub/UtopIA`
> Tech: Next.js 16 App Router + React 19 + Drizzle (Neon Postgres) + AI SDK v6.
> Idioma primario: ES. Toggle EN via dictionaries existentes.

---

## 0. Vision en una linea

Un tendero o microempresario sube **fotos de su cuaderno** de ingresos/egresos.
GPT-4o Vision extrae renglones estructurados, el usuario los revisa, se
guardan en DB por workspace y se generan reportes mensuales (P&L simple,
flujo de caja, top categorias, alertas comparativas vs mes anterior).
Opcionalmente exporta a Excel y a un Balance de Comprobacion compatible con
el pipeline NIIF existente.

NO toca el sistema NIIF complejo. Es un modulo independiente con sus propias
tablas DB, sus propios endpoints y sus propias paginas en `/workspace/pyme`.

---

## 1. Schema DB — bloque LITERAL para apender al final de `src/lib/db/schema.ts`

> AGENT-DB: copia este bloque tal cual al final del archivo. Anade los
> `export type` nuevos al bloque de tipos existente al final del archivo.

```ts
// ─── Modulo "Contabilidad Pyme" ─────────────────────────────────────────────
//
// Modulo simple para tenderos / microempresas que llevan contabilidad en
// cuadernos de papel. El usuario fotografia paginas → OCR Vision (gpt-4o)
// → renglones estructurados (ingreso/egreso, monto, categoria) → revision
// humana → ledger persistido por workspace.
//
// No comparte tablas con el pipeline NIIF. Cuando se quiera puentear, se
// genera un balance de comprobacion derivado y se enchufa al flujo
// existente (`reports.kind = 'pyme_monthly'` o un export CSV).

export const pymeBooks = pgTable('pyme_books', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  currency: text('currency').notNull().default('COP'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Una foto subida = una row aqui. `image_url` puede ser:
//  - una URL https de Vercel Blob (preferido)
//  - una data URL `data:image/...;base64,...` (fallback MVP cuando Blob
//    no esta provisionado)
// `page_count` es siempre 1 para fotos individuales — el campo existe
// para soportar PDFs multi-pagina en el futuro.
//
// El estado avanza pending → processing → done | failed. Los entries
// extraidos se persisten en `pyme_entries` con `source_image_url` y
// `source_page` apuntando a esta row.
export const pymeUploads = pgTable('pyme_uploads', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookId: uuid('book_id')
    .notNull()
    .references(() => pymeBooks.id, { onDelete: 'cascade' }),
  imageUrl: text('image_url').notNull(),
  mimeType: text('mime_type').notNull(),
  pageCount: integer('page_count').notNull().default(1),
  ocrStatus: text('ocr_status').notNull().default('pending'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Cada renglon del cuaderno. `status = 'draft'` mientras el extractor o el
// usuario no han confirmado; `status = 'confirmed'` cuando el usuario
// presiona "guardar" en EntryReview. Solo los confirmed entran a reportes.
//
// `category` es texto libre (catalogo recomendado en `pyme_categories`,
// pero no FK rigida — un tendero puede inventar categorias on-the-fly).
// `raw_ocr_text` guarda la linea cruda del OCR para auditoria.
export const pymeEntries = pgTable('pyme_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookId: uuid('book_id')
    .notNull()
    .references(() => pymeBooks.id, { onDelete: 'cascade' }),
  uploadId: uuid('upload_id').references(() => pymeUploads.id, {
    onDelete: 'set null',
  }),
  entryDate: timestamp('entry_date', { withTimezone: true }).notNull(),
  description: text('description').notNull(),
  kind: text('kind').notNull(), // 'ingreso' | 'egreso'
  amount: numeric('amount', { precision: 20, scale: 2 }).notNull(),
  category: text('category'),
  pucHint: text('puc_hint'), // codigo PUC sugerido (opcional)
  sourceImageUrl: text('source_image_url'),
  sourcePage: integer('source_page'),
  rawOcrText: text('raw_ocr_text'),
  confidence: numeric('confidence', { precision: 4, scale: 3 }), // 0..1
  status: text('status').notNull().default('draft'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Catalogo simple de categorias por libro. NO es FK desde `pyme_entries`
// para permitir categorias ad-hoc, pero la UI sugiere desde aqui.
export const pymeCategories = pgTable('pyme_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookId: uuid('book_id')
    .notNull()
    .references(() => pymeBooks.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  kind: text('kind').notNull(), // 'ingreso' | 'egreso'
  pucHint: text('puc_hint'), // codigo PUC sugerido para futuro export
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type PymeBook = typeof pymeBooks.$inferSelect;
export type NewPymeBook = typeof pymeBooks.$inferInsert;
export type PymeUpload = typeof pymeUploads.$inferSelect;
export type NewPymeUpload = typeof pymeUploads.$inferInsert;
export type PymeEntry = typeof pymeEntries.$inferSelect;
export type NewPymeEntry = typeof pymeEntries.$inferInsert;
export type PymeCategory = typeof pymeCategories.$inferSelect;
export type NewPymeCategory = typeof pymeCategories.$inferInsert;
```

**Migracion:** despues de apender, correr:
```bash
npm run db:push
```

---

## 2. Estructura de archivos por agente (paths absolutos disjuntos)

### AGENT-DB (owner del schema y del repo)

- **Edita** (apendar al final, sin tocar lo previo):
  - `/Users/rocuts/Documents/GitHub/UtopIA/src/lib/db/schema.ts`
- **Crea**:
  - `/Users/rocuts/Documents/GitHub/UtopIA/src/lib/db/pyme.ts`

`pyme.ts` — repo functions. Firma exacta:

```ts
import 'server-only';
import { and, between, desc, eq, sql } from 'drizzle-orm';
import { getDb } from './client';
import {
  pymeBooks,
  pymeCategories,
  pymeEntries,
  pymeUploads,
  type NewPymeBook,
  type NewPymeEntry,
  type NewPymeUpload,
  type PymeBook,
  type PymeEntry,
  type PymeUpload,
} from './schema';

export async function createBook(input: NewPymeBook): Promise<PymeBook>;
export async function listBooks(workspaceId: string): Promise<PymeBook[]>;
export async function getBook(bookId: string, workspaceId: string): Promise<PymeBook | null>;

export async function createUpload(input: NewPymeUpload): Promise<PymeUpload>;
export async function updateUploadStatus(
  uploadId: string,
  status: 'pending' | 'processing' | 'done' | 'failed',
  errorMessage?: string,
): Promise<void>;
export async function getUpload(uploadId: string): Promise<PymeUpload | null>;

export async function insertEntries(entries: NewPymeEntry[]): Promise<PymeEntry[]>;
export async function listEntries(args: {
  bookId: string;
  status?: 'draft' | 'confirmed';
  kind?: 'ingreso' | 'egreso';
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
  offset?: number;
}): Promise<PymeEntry[]>;
export async function updateEntry(
  entryId: string,
  patch: Partial<Pick<PymeEntry, 'entryDate' | 'description' | 'kind' | 'amount' | 'category' | 'pucHint' | 'status'>>,
): Promise<PymeEntry | null>;
export async function deleteEntry(entryId: string): Promise<boolean>;

export interface MonthlySummary {
  bookId: string;
  year: number;
  month: number;
  totals: {
    ingresos: number;
    egresos: number;
    margen: number;
    margenPct: number;
  };
  topIngresoCategories: { category: string; amount: number }[];
  topEgresoCategories: { category: string; amount: number }[];
  previous: {
    ingresos: number;
    egresos: number;
    margen: number;
  } | null;
  entryCount: number;
}
export async function monthlySummary(
  bookId: string,
  year: number,
  month: number,
): Promise<MonthlySummary>;
```

Implementacion: usa `getDb()` lazy (igual que `workspace.ts`). Valida
`workspaceId` en `getBook`/`listBooks` con `eq(pymeBooks.workspaceId, ...)`.
`insertEntries` usa batched `.values(entries).returning()`. La agregacion
mensual usa `sum(case when kind = 'ingreso' ...)` SQL puro.

---

### AGENT-EXTRACTION (Vision OCR + structured output)

- **Crea**:
  - `/Users/rocuts/Documents/GitHub/UtopIA/src/lib/agents/pyme/extraction/types.ts`
  - `/Users/rocuts/Documents/GitHub/UtopIA/src/lib/agents/pyme/extraction/schemas.ts`
  - `/Users/rocuts/Documents/GitHub/UtopIA/src/lib/agents/pyme/extraction/vision-extractor.ts`

`schemas.ts`:

```ts
import { z } from 'zod';

export const ExtractedEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  description: z.string().min(1).max(500),
  kind: z.enum(['ingreso', 'egreso']),
  amount: z.number().nonnegative().nullable(),
  category: z.string().max(120).nullable(),
  confidence: z.number().min(0).max(1),
  rawText: z.string().max(1000).nullable(),
});

export const ExtractionResultSchema = z.object({
  pageDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  entries: z.array(ExtractedEntrySchema).max(200),
  notes: z.string().max(1000).nullable(),
});

export type ExtractedEntry = z.infer<typeof ExtractedEntrySchema>;
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;
```

`vision-extractor.ts` — firma:

```ts
import 'server-only';
import { generateText, Output } from 'ai';
import { MODELS } from '@/lib/config/models';
import { ExtractionResultSchema, type ExtractionResult } from './schemas';

export interface ExtractionContext {
  language: 'es' | 'en';
  bookCurrency: string;
  knownCategories?: string[];
}

export async function extractEntriesFromImage(
  imageDataUrl: string,
  ctx: ExtractionContext,
): Promise<ExtractionResult>;
```

Patron: igual que `src/lib/agents/classifier.ts` — `generateText` con
`experimental_output: Output.object({ schema: ExtractionResultSchema })`.
Modelo: `MODELS.OCR`. `maxOutputTokens: 4096`. `abortSignal:
AbortSignal.timeout(90_000)`. NUNCA pasar apiKey.

Anti-alucinacion en system prompt:
- Si NO es cuaderno contable → `entries: []`, `notes: 'no_ledger_detected'`.
- Nunca inventar montos. Renglon ilegible → omitir.
- Confidence < 0.5 cuando hay dudas razonables.

`types.ts` reexporta los tipos derivados de `schemas.ts`.

---

### AGENT-ORCHESTRATOR (agentes de IA del modulo)

- **Crea**:
  - `/Users/rocuts/Documents/GitHub/UtopIA/src/lib/agents/pyme/types.ts`
  - `/Users/rocuts/Documents/GitHub/UtopIA/src/lib/agents/pyme/prompts/categorizer.prompt.ts`
  - `/Users/rocuts/Documents/GitHub/UtopIA/src/lib/agents/pyme/prompts/summarizer.prompt.ts`
  - `/Users/rocuts/Documents/GitHub/UtopIA/src/lib/agents/pyme/agents/categorizer.ts`
  - `/Users/rocuts/Documents/GitHub/UtopIA/src/lib/agents/pyme/agents/summarizer.ts`
  - `/Users/rocuts/Documents/GitHub/UtopIA/src/lib/agents/pyme/orchestrator.ts`

`types.ts`:
```ts
export type PymeProgressEvent =
  | { type: 'stage_start'; stage: 'extract' | 'categorize' | 'persist' | 'summary'; label: string }
  | { type: 'stage_progress'; stage: string; detail: string }
  | { type: 'stage_complete'; stage: string }
  | { type: 'warning'; message: string }
  | { type: 'error'; message: string }
  | { type: 'done' };

export interface ProcessUploadOptions {
  onProgress?: (e: PymeProgressEvent) => void;
}

export interface MonthlyReportPayload {
  bookId: string;
  year: number;
  month: number;
  summary: import('@/lib/db/pyme').MonthlySummary;
  narrative: string;
  alerts: Array<{
    severity: 'info' | 'warning' | 'critical';
    message: string;
  }>;
  generatedAt: string;
}
```

`agents/categorizer.ts`:
```ts
import 'server-only';
import { generateText, Output } from 'ai';
import { z } from 'zod';
import { MODELS } from '@/lib/config/models';
import type { ExtractedEntry } from '@/lib/agents/pyme/extraction/schemas';

const CategorizedSchema = z.object({
  category: z.string().min(1).max(120),
  pucHint: z.string().max(20).nullable(),
  rationale: z.string().max(200),
});

export async function categorizeEntry(
  entry: ExtractedEntry,
  ctx: { language: 'es' | 'en'; knownCategories: string[] },
): Promise<z.infer<typeof CategorizedSchema>>;

export async function categorizeEntriesBatch(
  entries: ExtractedEntry[],
  ctx: { language: 'es' | 'en'; knownCategories: string[] },
): Promise<z.infer<typeof CategorizedSchema>[]>;
```

`agents/summarizer.ts`:
```ts
import 'server-only';
import { generateText } from 'ai';
import { MODELS } from '@/lib/config/models';
import type { MonthlySummary } from '@/lib/db/pyme';

export interface SummaryNarrative {
  narrative: string;
  alerts: Array<{
    severity: 'info' | 'warning' | 'critical';
    message: string;
  }>;
}

export async function summarizeMonth(
  data: MonthlySummary,
  ctx: { language: 'es' | 'en'; companyName?: string },
): Promise<SummaryNarrative>;
```

`orchestrator.ts`:
```ts
import 'server-only';
import * as repo from '@/lib/db/pyme';
import { extractEntriesFromImage } from '@/lib/agents/pyme/extraction/vision-extractor';
import { categorizeEntriesBatch } from './agents/categorizer';
import { summarizeMonth } from './agents/summarizer';
import type { MonthlyReportPayload, ProcessUploadOptions } from './types';

export async function processUpload(
  uploadId: string,
  options?: ProcessUploadOptions,
): Promise<{ entryIds: string[] }>;

export async function generateMonthlyReport(
  bookId: string,
  workspaceId: string,
  year: number,
  month: number,
  language: 'es' | 'en',
): Promise<MonthlyReportPayload>;
```

Modelos: `MODELS.CHAT` para categorizer y summarizer.
Temperatura 0.2 (categorizer), 0.4 (summarizer).

---

### AGENT-API (Next.js App Router, Fluid Compute, Node runtime)

- **Crea**:
  - `/Users/rocuts/Documents/GitHub/UtopIA/src/lib/validation/pyme-schemas.ts`
  - `/Users/rocuts/Documents/GitHub/UtopIA/src/app/api/pyme/books/route.ts`
  - `/Users/rocuts/Documents/GitHub/UtopIA/src/app/api/pyme/books/[bookId]/route.ts`
  - `/Users/rocuts/Documents/GitHub/UtopIA/src/app/api/pyme/uploads/route.ts`
  - `/Users/rocuts/Documents/GitHub/UtopIA/src/app/api/pyme/uploads/[uploadId]/route.ts`
  - `/Users/rocuts/Documents/GitHub/UtopIA/src/app/api/pyme/entries/route.ts`
  - `/Users/rocuts/Documents/GitHub/UtopIA/src/app/api/pyme/entries/[entryId]/route.ts`
  - `/Users/rocuts/Documents/GitHub/UtopIA/src/app/api/pyme/reports/monthly/route.ts`

Cada handler:
- `export const runtime = 'nodejs';`
- `export const maxDuration = 300;` (uploads + reports). Resto: 60s.
- Llama `getOrCreateWorkspace()` PRIMERO.
- Valida body con Zod ANTES de tocar DB.
- Usa `repo.*` de `@/lib/db/pyme`.
- Devuelve `NextResponse.json` consistente.
- Errores: `{ ok: false, error: string, details?: unknown }` + status apropiado.

`pyme-schemas.ts`:
```ts
import { z } from 'zod';

export const createBookBodySchema = z.object({
  name: z.string().min(1).max(120),
  currency: z.string().length(3).default('COP'),
});

export const listEntriesQuerySchema = z.object({
  bookId: z.string().uuid(),
  status: z.enum(['draft', 'confirmed']).optional(),
  kind: z.enum(['ingreso', 'egreso']).optional(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export const createEntryBodySchema = z.object({
  bookId: z.string().uuid(),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1).max(500),
  kind: z.enum(['ingreso', 'egreso']),
  amount: z.number().positive(),
  category: z.string().max(120).optional(),
  pucHint: z.string().max(20).optional(),
  status: z.enum(['draft', 'confirmed']).default('confirmed'),
});

export const patchEntryBodySchema = createEntryBodySchema
  .partial()
  .omit({ bookId: true });

export const monthlyReportBodySchema = z.object({
  bookId: z.string().uuid(),
  year: z.number().int().min(2020).max(2099),
  month: z.number().int().min(1).max(12),
  language: z.enum(['es', 'en']).default('es'),
});
```

`uploads/route.ts` — patron:
```ts
import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import * as repo from '@/lib/db/pyme';
import { processUpload } from '@/lib/agents/pyme/orchestrator';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_IMAGE_SIZE = 4 * 1024 * 1024;
const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic']);

export async function POST(req: Request) {
  const ws = await getOrCreateWorkspace();
  const form = await req.formData();
  const bookId = form.get('bookId') as string;
  const file = form.get('file') as File | null;
  if (!file || !bookId) return NextResponse.json({ ok: false, error: 'missing_fields' }, { status: 400 });

  if (file.size > MAX_IMAGE_SIZE) {
    return NextResponse.json({ ok: false, error: 'file_too_large' }, { status: 413 });
  }
  if (!ALLOWED_MIMES.has(file.type)) {
    return NextResponse.json({ ok: false, error: 'unsupported_mime' }, { status: 415 });
  }

  const book = await repo.getBook(bookId, ws.id);
  if (!book) return NextResponse.json({ ok: false, error: 'book_not_found' }, { status: 404 });

  let imageUrl: string;
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import('@vercel/blob');
    const blob = await put(`pyme/${ws.id}/${crypto.randomUUID()}-${file.name}`, file, { access: 'public' });
    imageUrl = blob.url;
  } else {
    imageUrl = `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString('base64')}`;
  }

  const upload = await repo.createUpload({
    bookId,
    imageUrl,
    mimeType: file.type,
    pageCount: 1,
    ocrStatus: 'pending',
  });

  waitUntil(processUpload(upload.id).catch((err) => {
    console.error('[pyme] processUpload failed:', err);
  }));

  return NextResponse.json({ ok: true, uploadId: upload.id, imageUrl });
}
```

`reports/monthly/route.ts` — POST genera + persiste a `reports`:
```ts
const body = monthlyReportBodySchema.parse(await req.json());
const ws = await getOrCreateWorkspace();
const book = await repo.getBook(body.bookId, ws.id);
if (!book) return NextResponse.json({ ok: false, error: 'book_not_found' }, { status: 404 });

const payload = await generateMonthlyReport(body.bookId, ws.id, body.year, body.month, body.language);
const db = getDb();
const [persisted] = await db.insert(reports).values({
  workspaceId: ws.id,
  kind: 'pyme_monthly',
  title: `Pyme — ${book.name} — ${body.year}-${String(body.month).padStart(2, '0')}`,
  data: payload,
}).returning();
return NextResponse.json({ ok: true, report: persisted });
```

---

### AGENT-UI (App Router pages + componentes cliente)

- **Crea**:
  - `/Users/rocuts/Documents/GitHub/UtopIA/src/app/workspace/pyme/page.tsx` (server)
  - `/Users/rocuts/Documents/GitHub/UtopIA/src/app/workspace/pyme/[bookId]/page.tsx` (server)
  - `/Users/rocuts/Documents/GitHub/UtopIA/src/app/workspace/pyme/[bookId]/subir/page.tsx` (client)
  - `/Users/rocuts/Documents/GitHub/UtopIA/src/components/workspace/pyme/PymeLanding.tsx`
  - `/Users/rocuts/Documents/GitHub/UtopIA/src/components/workspace/pyme/PhotoUploader.tsx`
  - `/Users/rocuts/Documents/GitHub/UtopIA/src/components/workspace/pyme/EntryReview.tsx`
  - `/Users/rocuts/Documents/GitHub/UtopIA/src/components/workspace/pyme/Ledger.tsx`
  - `/Users/rocuts/Documents/GitHub/UtopIA/src/components/workspace/pyme/MonthlyReport.tsx`
  - `/Users/rocuts/Documents/GitHub/UtopIA/src/components/workspace/pyme/types.ts` (UI-local types)

Convenciones de design:
- Tinta primaria: `text-n-1000`. Subtitulo: `text-n-800`. Muted: `text-n-500`.
- Superficies: `bg-n-0`, `bg-n-100`, `glass-elite`, `glass-elite-elevated`.
- Acento del modulo: `text-acento-vino`. Iconos: `lucide-react`.
- NUNCA hardcodear colores hex. Si falta token, comentar `// FIXME: token` y NO inventarlo.
- Cualquier scroll interno de tabla larga: `data-lenis-prevent` en si mismo o ancestor.
- AGENT-UI NUNCA importa de `@/lib/db/*`, `@/lib/agents/pyme/*`. Solo fetch a `/api/pyme/*`.

`PhotoUploader.tsx`:
- `<input type="file" multiple accept="image/*" capture="environment" />`.
- Por archivo: POST a `/api/pyme/uploads`, polling cada 2s a status hasta `done`/`failed`.
- Cuando `done`: GET `/api/pyme/entries?bookId=...&status=draft`, emite `onEntriesReady`.

`EntryReview.tsx` — tabla editable. Filas con date picker, description, kind toggle (ingreso `text-success`, egreso `text-acento-vino`), amount input, category combobox, confidence chip (`< 0.5` → amber). "Confirmar todos" → PATCH masivo. "Eliminar" → DELETE.

`Ledger.tsx` — tabla virtualizada. Filtros: mes, kind, search description. Total agregado footer.

`MonthlyReport.tsx` — KPIs: ingresos, egresos, margen, margen %. Lista alertas con severity chips.

i18n keys nuevas (a añadir en `src/lib/i18n/dictionaries.ts`):
```
pyme.landing.title, pyme.landing.subtitle, pyme.landing.create_book
pyme.book.tabs.ledger, pyme.book.tabs.upload, pyme.book.tabs.reports
pyme.uploader.drop, pyme.uploader.processing
pyme.review.confirm_all, pyme.review.no_entries
pyme.report.alerts, pyme.report.margin
```

---

## 3. Contratos compartidos

| Importa | De | Tipos / funciones |
|---|---|---|
| AGENT-EXTRACTION | AGENT-DB | (nada — extraction es puro dominio) |
| AGENT-ORCHESTRATOR | AGENT-DB | `repo.*`, `MonthlySummary`, `PymeEntry`, `NewPymeEntry`, `PymeUpload` |
| AGENT-ORCHESTRATOR | AGENT-EXTRACTION | `extractEntriesFromImage`, `ExtractedEntry`, `ExtractionResult` |
| AGENT-API | AGENT-DB | `repo.*`, types de schema |
| AGENT-API | AGENT-ORCHESTRATOR | `processUpload`, `generateMonthlyReport`, `MonthlyReportPayload` |
| AGENT-API | AGENT-DB existente | `getOrCreateWorkspace`, `reports`, `getDb` |
| AGENT-API | propio | `pyme-schemas` |
| AGENT-UI | (server-side) | NADA. Solo fetch a `/api/pyme/*` |

---

## 4. Convenciones obligatorias

1. **AI SDK v6** unicamente. Prohibido `openai.chat.completions.create`. Prohibido pasar `apiKey`.
2. **Modelos**: solo desde `@/lib/config/models`. `MODELS.OCR` para vision, `MODELS.CHAT` para texto.
3. **Idioma**: ES primario. Texto user-facing en `dictionaries.ts`.
4. **Anti-alucinacion**: extractor devuelve `null`, confidence visible en UI, NO inventa montos.
5. **Validacion**: Zod en cada endpoint.
6. **PII**: fotos son del propio negocio — no se aplica `pii-filter`. Middleware global aplica.
7. **Lenis-aware**: `data-lenis-prevent` en tablas con scroll interno.
8. **Vercel Fluid Compute**: `runtime = 'nodejs'`, `maxDuration = 300`. `waitUntil` para post-response work. NO Edge.
9. **Cookies/tenant**: `getOrCreateWorkspace()` SOLO en Route Handlers.
10. **Errores**: throw `Error` en orchestrators, handler captura → 500 con message.
11. **Costos**: limitar **5 paginas por upload**. Mas → 413 `too_many_pages`.
12. **Cache Components**: este modulo es 100% dinamico. NO `'use cache'`.

---

## 5. MCPs disponibles

- `mcp__magic__21st_magic_component_builder` — AGENT-UI puede usarlo para acelerar PhotoUploader y Ledger. Adaptar output a tokens del proyecto (no aceptar hex inventados).
- No existe MCP para handwriting OCR — OpenAI Vision via AI SDK (gpt-4o).

---

## 6. Test plan compacto (Fase 2 — auditoria)

1. **Happy path**: crear libro → subir foto → ver drafts → editar 1 monto → confirmar → ledger.
2. **Reporte 2 meses**: insertar entries N-1 y N → POST monthly → alertas comparativas (`previous` no nulo).
3. **Edit/delete confirmed**: PATCH y DELETE.
4. **Multi-foto**: 3 fotos en paralelo, cada una via `waitUntil`, polling independiente.
5. **Caso bizarro**: subir selfie → `entries: []`, `notes: 'no_ledger_detected'`, UI no crashea.

---

## 7. Riesgos conocidos

### R1. Filesystem read-only en Vercel
**Decision: Vercel Blob preferido, data URL fallback MVP.**
- Si `BLOB_READ_WRITE_TOKEN` presente → Blob.
- Si no → data URL inline. Trade-off: rows de ~5MB.

### R2. Token cost gpt-4o vision
- ~3k tokens output por pagina, ~$0.015/foto.
- **Limite: 5 paginas por upload** (UI + orchestrator).

### R3. Latencia OCR (8-25s)
- Async via `waitUntil`. Cliente hace polling cada 2s.

### R4. Concurrencia
- `processUpload` re-lee estado, aborta si `ocrStatus !== 'pending'`. Idempotente.

### R5. Deps
- AGENT-API debe agregar `@vercel/functions` y `@vercel/blob` a `package.json`.

---

## 8. Orden de ejecucion paralelo

```
T0:   AGENT-DB         (schema + repo)
T0:   AGENT-EXTRACTION (vision + zod)
T0:   AGENT-ORCHESTRATOR (signatures pueden mockearse hasta merge de DB)
T0:   AGENT-API        (idem, mocks locales hasta merge)
T0:   AGENT-UI         (NO depende de nada server-side)
```

Todos arrancan en paralelo. Si alguno bloquea, las firmas estan
literales en el spec — pueden mockear y refactorar al merge.

---

## 9. Definition of Done

- [ ] `npm run db:push` corre sin errores tras apender el schema.
- [ ] `npx tsc --noEmit` pasa con 0 errores.
- [ ] `npm run lint` no introduce errores nuevos.
- [ ] `npm run build` pasa.
- [ ] No hay `apiKey:` strings en codigo nuevo.
- [ ] No hay `openai/` strings (gateway legacy).
- [ ] Diseno respeta tokens (sin hex hardcoded).
- [ ] `data-lenis-prevent` presente en tablas con scroll interno.
