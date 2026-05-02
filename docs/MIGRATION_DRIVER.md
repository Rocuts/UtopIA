# Migración de driver Postgres — Ola 0.A (mayo 2026)

## Qué cambió

UtopIA pasó de `@neondatabase/serverless` + `drizzle-orm/neon-http` (HTTP one-shot)
a `pg.Pool` + `drizzle-orm/node-postgres` + `attachDatabasePool` (TCP).

## Por qué

1. **Transacciones reales.** El módulo contable (Ola 1) requiere `db.transaction()`
   para garantizar partida doble atómica. `drizzle-orm/neon-http` NO soporta
   transacciones interactivas porque cada query es una petición HTTP independiente.
2. **Best-practice Vercel mayo 2026 para Fluid Compute.** Las instancias Fluid
   Compute se reutilizan entre requests. El pool TCP de `pg` se mantiene caliente
   y `attachDatabasePool()` permite que la plataforma cierre las conexiones de
   forma ordenada cuando la instancia se evicta.
3. **WebSocket no es viable.** `@neondatabase/serverless` con WebSocket no
   sobrevive entre requests bajo Fluid Compute (las conexiones quedan colgadas).

## Acción manual requerida del usuario

**Cambiar `DATABASE_URL` en Vercel para apuntar al endpoint POOLED de Neon.**

El host debe contener el sufijo `-pooler`:

```
# Correcto (pooled):
postgres://user:pwd@ep-xxx-pooler.us-east-1.aws.neon.tech/dbname?sslmode=require

# Incorrecto (direct):
postgres://user:pwd@ep-xxx.us-east-1.aws.neon.tech/dbname?sslmode=require
```

### Pasos

1. Ir a Neon dashboard → Connection Details → seleccionar **Pooled connection**.
2. Copiar la connection string.
3. En Vercel: `Project Settings → Environment Variables → DATABASE_URL` (los 3
   environments: production, preview, development) → pegar la nueva URL.
4. Re-deploy (los servidores leen `DATABASE_URL` al primer `getDb()`).
5. Local: `vercel env pull .env.local --yes` para sincronizar.

### Por qué el endpoint pooled

- El runtime ya hace pooling local con `new Pool({ max: 5 })`. Eso da hasta 5
  conexiones por instancia Fluid Compute.
- Sin el endpoint `-pooler` cada instancia abriría conexiones directas al
  primary de Neon. Bajo carga (50+ instancias concurrentes) se agotan los
  slots del plan de Neon.
- El endpoint `-pooler` apunta a PgBouncer transaction-mode, que multiplexa
  miles de conexiones de cliente sobre pocas al primary.

## Files cambiados

- `src/lib/db/client.ts` — driver y pool init.
- `scripts/db-migrate.ts` — usa `drizzle-orm/node-postgres/migrator`.
- `.env.example` — nota sobre endpoint pooled.
- Comentarios actualizados en `src/lib/db/pyme.ts`,
  `src/app/api/pyme/entries/route.ts`, `src/lib/agents/repair/persistence.ts`.

## Compatibilidad

- API pública de `getDb()` se mantiene. Ningún consumidor existente requiere
  cambios.
- Las columnas `numeric` siguen llegando como `string` (lo hace tanto neon-http
  como node-postgres para preservar precisión). El código que ya hacía
  `Number(...)` no requiere cambios.
- Los placeholders SQL son los mismos (`$1`, `$2`, …) — Drizzle abstrae esto.

## Limpieza pendiente (Ola 2)

- Remover `@neondatabase/serverless` de `package.json` cuando se confirme que
  ningún script lo usa (LangChain/RAG ingest scripts deben verificarse).
- Envolver el flujo `repair/persistence.ts` (DELETE + INSERT de adjustments)
  en `db.transaction()` ahora que el driver lo soporta.
- Considerar `pgbouncer=true` en la connection string si el endpoint pooled
  de Neon lo requiere (Neon lo añade automáticamente al copiar desde el
  dashboard).
