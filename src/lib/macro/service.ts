/**
 * Servicio de Factores Macro Colombia
 *
 * Estrategia de cache:
 *   1. Lee la fila más reciente de `macro_factors` en Postgres.
 *   2. Si `fechaActualizacion` < 24h y no se fuerza refresh → retorna cache.
 *   3. Si es stale o force=true → fetcha BanRep + DANE en paralelo,
 *      persiste la fila, retorna los datos frescos.
 *
 * Defaults conservadores (se usan cuando las APIs fallan):
 *   ipc         = 0.045  (4.5% — referencia DANE 2026)
 *   trm         = 4200   (COP por USD — estimado mercado may-2026)
 *   tasaBanRep  = 0.0925 (9.25% — TIB BanRep vigente ene-2026)
 */

import { getDb } from '@/lib/db/client';
import { macroFactors } from '@/lib/db/schema';
import { desc } from 'drizzle-orm';
import { fetchTRM, fetchIPC, fetchTasaBanRep } from './banrep-client';
import type { MacroFactors } from '@/lib/pillars/types';

// ─── Defaults ─────────────────────────────────────────────────────────────

const DEFAULTS = {
  ipc: 0.045,
  trm: 4200,
  tasaBanRep: 0.0925,
} as const;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas

// ─── Tipo interno de fila DB ───────────────────────────────────────────────

type MacroRow = typeof macroFactors.$inferSelect;

function rowToMacroFactors(row: MacroRow): MacroFactors {
  return {
    ipc: row.ipc,
    trm: row.trm,
    tasaBanRep: row.tasaBanRep,
    fuente: row.fuente as MacroFactors['fuente'],
    fechaActualizacion: row.fechaActualizacion.toISOString(),
  };
}

// ─── Fetch + persist ──────────────────────────────────────────────────────

async function fetchAndPersist(): Promise<MacroFactors> {
  // Llamadas en paralelo — si una falla, el caller usa default.
  const [trm, ipc, tasaBanRep] = await Promise.all([
    fetchTRM(),
    fetchIPC(),
    fetchTasaBanRep(),
  ]);

  const result: Omit<MacroFactors, 'fechaActualizacion'> = {
    ipc: ipc ?? DEFAULTS.ipc,
    trm: trm ?? DEFAULTS.trm,
    tasaBanRep: tasaBanRep ?? DEFAULTS.tasaBanRep,
    // Fuente: si al menos TRM vino de la API se marca 'banrep'; si todo
    // falló se marca 'default'.
    fuente:
      trm !== null || tasaBanRep !== null
        ? 'banrep'
        : ipc !== null
          ? 'dane'
          : 'default',
  };

  // Persistir en Postgres (best-effort — si falla la DB, igual retornamos datos).
  try {
    const db = getDb();
    await db.insert(macroFactors).values({
      ipc: result.ipc,
      trm: result.trm,
      tasaBanRep: result.tasaBanRep,
      fuente: result.fuente,
    });
  } catch (err) {
    console.warn('[macro/service] Error persisting macro_factors:', err);
  }

  return {
    ...result,
    fechaActualizacion: new Date().toISOString(),
  };
}

// ─── API pública ───────────────────────────────────────────────────────────

export interface GetMacroOptions {
  /** Si es true, ignora la cache y fuerza una nueva consulta. */
  force?: boolean;
}

/**
 * Retorna los factores macro actuales.
 * Usa cache Postgres de 24h — si la DB no está disponible cae a defaults.
 */
export async function getMacroFactors(
  options: GetMacroOptions = {},
): Promise<MacroFactors> {
  if (!options.force) {
    // Intentar leer de cache Postgres.
    try {
      const db = getDb();
      const [cached] = await db
        .select()
        .from(macroFactors)
        .orderBy(desc(macroFactors.fechaActualizacion))
        .limit(1);

      if (cached) {
        const age = Date.now() - cached.fechaActualizacion.getTime();
        if (age < CACHE_TTL_MS) {
          return rowToMacroFactors(cached);
        }
      }
    } catch (err) {
      console.warn('[macro/service] Cache read failed — fetching fresh:', err);
    }
  }

  // Cache miss, stale o force → fetch externo.
  try {
    return await fetchAndPersist();
  } catch (err) {
    console.error('[macro/service] fetchAndPersist failed — returning defaults:', err);
    return {
      ...DEFAULTS,
      fuente: 'default',
      fechaActualizacion: new Date().toISOString(),
    };
  }
}
