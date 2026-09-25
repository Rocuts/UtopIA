/**
 * Servicio de Factores Macro Colombia — procedencia POR CAMPO.
 *
 * Auditoría valoracion-04: antes cada serie fallida se rellenaba con DEFAULTS
 * (IPC 4,5 %, TRM 4.200, tasa 9,25 %), todo el registro se marcaba 'banrep' si
 * llegaba la TRM o la tasa y la fecha era la de la consulta. Ahora:
 *   - Cada campo es { value | null, source, asOf (vigencia), fetchedAt, stale,
 *     reason }. Un fallo nunca se sustituye por una constante.
 *   - Si una serie falla y hay un último valor bueno persistido, se devuelve
 *     marcado `stale: true` con su vigencia y fecha de consulta ORIGINALES.
 *   - Persistencia sin migración: la tabla `macro_factors` exige números, así
 *     que la procedencia v2 viaja en `fuente` (JSON) y un campo sin dato se
 *     guarda con procedencia `null` (la columna numérica es un marcador que
 *     nunca se publica). Filas legadas sin procedencia v2 se ignoran: pudieron
 *     contener los DEFAULTS.
 *
 * Cache: 24 h sobre la última fila v2.
 */

import { getDb } from '@/lib/db/client';
import { macroFactors } from '@/lib/db/schema';
import { desc } from 'drizzle-orm';
import { fetchTRM, fetchIPC, fetchTasaBanRep, type MacroFetch } from './banrep-client';
import type { MacroFactors, MacroIndicator, MacroSource } from '@/lib/pillars/types';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas

type Field = 'ipc' | 'trm' | 'tasaBanRep';
const FIELDS: Field[] = ['ipc', 'trm', 'tasaBanRep'];

interface FieldProvenance {
  asOf: string;
  source: MacroSource;
  fetchedAt: string;
}

interface ProvenanceV2 {
  v: 2;
  /** Momento de la consulta que produjo la fila (los campos con otro
   *  `fetchedAt` son últimos valores buenos ⇒ stale). */
  consultaAt?: string;
  ipc: FieldProvenance | null;
  trm: FieldProvenance | null;
  tasaBanRep: FieldProvenance | null;
}

type MacroRow = typeof macroFactors.$inferSelect;

const NO_DATA_REASON = 'Sin dato verificado de la fuente oficial.';

function parseProvenance(fuente: unknown): ProvenanceV2 | null {
  if (typeof fuente !== 'string' || !fuente.startsWith('{')) return null;
  try {
    const p = JSON.parse(fuente) as Partial<ProvenanceV2>;
    if (p?.v !== 2) return null;
    return {
      v: 2,
      consultaAt: p.consultaAt,
      ipc: p.ipc ?? null,
      trm: p.trm ?? null,
      tasaBanRep: p.tasaBanRep ?? null,
    };
  } catch {
    return null;
  }
}

function emptyIndicator(reason: string | null): MacroIndicator {
  return { value: null, source: null, asOf: null, fetchedAt: null, stale: false, reason: reason ?? NO_DATA_REASON };
}

/** Decodifica una fila v2. `stale` = el dato se consultó antes que la fila. */
function rowToMacroFactors(row: MacroRow, prov: ProvenanceV2): MacroFactors {
  const rowAt = row.fechaActualizacion.toISOString();
  const out = {} as Record<Field, MacroIndicator>;
  for (const f of FIELDS) {
    const p = prov[f];
    out[f] = p
      ? {
          value: row[f],
          source: p.source,
          asOf: p.asOf,
          fetchedAt: p.fetchedAt,
          stale: prov.consultaAt ? p.fetchedAt !== prov.consultaAt : false,
          reason: null,
        }
      : emptyIndicator(null);
  }
  return { ...out, fechaActualizacion: rowAt, fuente: 'por-campo' };
}

async function readLatestV2(): Promise<{ row: MacroRow; prov: ProvenanceV2 } | null> {
  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(macroFactors)
      .orderBy(desc(macroFactors.fechaActualizacion))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const prov = parseProvenance(row.fuente);
    return prov ? { row, prov } : null;
  } catch (err) {
    console.warn('[macro/service] Cache read failed:', err);
    return null;
  }
}

async function fetchAndPersist(
  previous: { row: MacroRow; prov: ProvenanceV2 } | null,
): Promise<MacroFactors> {
  const now = new Date().toISOString();
  const fetched: Record<Field, MacroFetch> = {
    trm: await fetchTRM(),
    ipc: await fetchIPC(),
    tasaBanRep: await fetchTasaBanRep(),
  };

  const out = {} as Record<Field, MacroIndicator>;
  const prov: ProvenanceV2 = { v: 2, consultaAt: now, ipc: null, trm: null, tasaBanRep: null };
  const nums: Record<Field, number> = { ipc: 0, trm: 0, tasaBanRep: 0 };

  for (const f of FIELDS) {
    const r = fetched[f].reading;
    if (r) {
      out[f] = { value: r.value, source: r.source, asOf: r.asOf, fetchedAt: now, stale: false, reason: null };
      prov[f] = { asOf: r.asOf, source: r.source, fetchedAt: now };
      nums[f] = r.value;
      continue;
    }
    // Último valor bueno persistido ⇒ stale con su fecha original.
    const prevProv = previous?.prov[f];
    if (previous && prevProv) {
      out[f] = {
        value: previous.row[f],
        source: prevProv.source,
        asOf: prevProv.asOf,
        fetchedAt: prevProv.fetchedAt,
        stale: true,
        reason: fetched[f].reason,
      };
      prov[f] = prevProv;
      nums[f] = previous.row[f];
      continue;
    }
    out[f] = emptyIndicator(fetched[f].reason);
  }

  const anyFresh = FIELDS.some((f) => fetched[f].reading !== null);
  if (anyFresh) {
    try {
      const db = getDb();
      await db.insert(macroFactors).values({
        ipc: nums.ipc,
        trm: nums.trm,
        tasaBanRep: nums.tasaBanRep,
        fuente: JSON.stringify(prov),
      });
    } catch (err) {
      console.warn('[macro/service] Error persisting macro_factors:', err);
    }
  }

  return { ...out, fechaActualizacion: now, fuente: 'por-campo' };
}

// ─── API pública ───────────────────────────────────────────────────────────

export interface GetMacroOptions {
  /** Si es true, ignora la cache y fuerza una nueva consulta. */
  force?: boolean;
}

/**
 * Retorna los factores macro con procedencia por campo. Nunca rellena con
 * constantes: un campo sin dato verificado es `value: null` con motivo.
 */
export async function getMacroFactors(
  options: GetMacroOptions = {},
): Promise<MacroFactors> {
  const latest = await readLatestV2();
  if (!options.force && latest) {
    const age = Date.now() - latest.row.fechaActualizacion.getTime();
    if (age < CACHE_TTL_MS) return rowToMacroFactors(latest.row, latest.prov);
  }
  return fetchAndPersist(latest);
}
