# Migration recovery — Modulo Pyme

## Contexto

El commit `df9fc19 feat(pyme): nuevo modulo Contabilidad Pyme con OCR Vision`
introdujo cuatro tablas nuevas en `src/lib/db/schema.ts`
(`pyme_books`, `pyme_uploads`, `pyme_entries`, `pyme_categories`) pero
nunca corrio `drizzle-kit generate`, asi que el directorio
`src/lib/db/migrations/` quedo desincronizado con el TypeScript: la
ultima migracion era `0002_repair_sessions.sql`, sin rastro del modulo
Pyme.

Cualquier `drizzle-kit migrate` en un entorno fresh dejaba el chat de
Pyme y el OCR rotos por tablas inexistentes, y la siguiente migracion
contable (Ola 1) iba a partir de un baseline que no representaba la
realidad del codigo.

Adicionalmente la columna `repair_adjustments.period` (anadida durante
el refactor multiperiodo de Ola anterior) ya estaba en TS pero nunca
quedo plasmada en `0002_repair_sessions.sql`. Mismo problema, escala
distinta.

## Que hicimos

1. `src/lib/db/migrations/0003_pyme_tables.sql` — escrito a mano (no
   `drizzle-kit generate`) para coexistir con otros agentes paralelos
   en Ola 0 que pudieran tocar la DB. Contiene:
   - `CREATE TABLE pyme_books`, `pyme_uploads`, `pyme_entries`,
     `pyme_categories` con tipos Postgres exactos (numeric(20,2),
     numeric(4,3), timestamp with time zone, defaults, etc.).
   - Foreign keys con `ON DELETE cascade` (workspace -> book -> upload
     -> entry / categoria) y `ON DELETE set null` para
     `pyme_entries.upload_id` (matchea `onDelete: 'set null'` en TS).
   - Indices identificados por el DB Auditor:
     - `pyme_books (workspace_id, created_at DESC)` — listados por
       workspace.
     - `pyme_uploads (book_id, created_at)` — historial de fotos.
     - `pyme_entries (book_id, entry_date)` — vista cronologica.
     - `pyme_entries (book_id, status, kind, entry_date)` — filtros
       compuestos confirmed/draft x ingreso/egreso.
   - `ALTER TABLE repair_adjustments ADD COLUMN IF NOT EXISTS period
     text` al final, idempotente, para cerrar el drift legacy del
     refactor multiperiodo.
2. `src/lib/db/migrations/meta/_journal.json` — agregada la entrada
   `idx: 3 / tag: 0003_pyme_tables` con timestamp actual y
   `hash: "pyme-migration-manual"` como marca de que NO fue generada
   por drizzle-kit. El campo `breakpoints: true` se conserva por
   convencion.

No modificamos `src/lib/db/schema.ts` ni `src/lib/db/client.ts`. Esos
archivos los gestiona Agent 0.A y/u otros del plan multi-agente.

## Accion manual requerida

Cuando todas las olas 0 terminen, ejecutar UNO de:

```bash
npm run db:push     # aplica el SQL via drizzle-kit (push)
# O bien
npx drizzle-kit migrate
```

No corras `drizzle-kit generate` antes de aplicar — sobrescribiria el
journal y volveria a desincronizar el SQL con el schema. Si en algun
momento se hace, hay que volver a producir manualmente la entrada
`0003_pyme_tables` o renombrar la nueva.
