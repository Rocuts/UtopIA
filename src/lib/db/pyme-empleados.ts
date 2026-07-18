import 'server-only';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from './client';
import {
  pymeEmpleados,
  pymeTaxCalculations,
  type NewPymeEmpleado,
  type NewPymeTaxCalculation,
  type PymeEmpleado,
  type PymeTaxCalculation,
} from './schema';

// Repo del módulo de nómina simple Pyme (Ola 8). Scoping: TODAS las
// funciones filtran por workspaceId — un empleado nunca cruza tenants.
// Patrón lazy getDb() igual que pyme.ts.

// ─── Empleados ───────────────────────────────────────────────────────────────

export async function listEmpleados(
  workspaceId: string,
): Promise<PymeEmpleado[]> {
  const db = getDb();
  return db
    .select()
    .from(pymeEmpleados)
    .where(
      and(eq(pymeEmpleados.workspaceId, workspaceId), eq(pymeEmpleados.activo, true)),
    )
    .orderBy(desc(pymeEmpleados.createdAt));
}

export async function createEmpleado(
  input: NewPymeEmpleado,
): Promise<PymeEmpleado> {
  const db = getDb();
  const [created] = await db.insert(pymeEmpleados).values(input).returning();
  return created;
}

export async function updateEmpleado(
  id: string,
  workspaceId: string,
  patch: Partial<
    Pick<
      PymeEmpleado,
      'nombre' | 'tipo' | 'cargo' | 'tipoContrato' | 'salarioCop' | 'eps' | 'afp' | 'arl' | 'arlClase'
    >
  >,
): Promise<PymeEmpleado | null> {
  const db = getDb();
  const [updated] = await db
    .update(pymeEmpleados)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(pymeEmpleados.id, id), eq(pymeEmpleados.workspaceId, workspaceId)))
    .returning();
  return updated ?? null;
}

/** Retiro lógico (activo=false) — preserva el registro para trazabilidad. */
export async function deactivateEmpleado(
  id: string,
  workspaceId: string,
): Promise<boolean> {
  const db = getDb();
  const [updated] = await db
    .update(pymeEmpleados)
    .set({ activo: false, updatedAt: new Date() })
    .where(and(eq(pymeEmpleados.id, id), eq(pymeEmpleados.workspaceId, workspaceId)))
    .returning({ id: pymeEmpleados.id });
  return Boolean(updated);
}

// ─── Historial de la calculadora RST/Ordinario ───────────────────────────────

export async function saveTaxCalculation(
  input: NewPymeTaxCalculation,
): Promise<PymeTaxCalculation> {
  const db = getDb();
  const [created] = await db
    .insert(pymeTaxCalculations)
    .values(input)
    .returning();
  return created;
}

export async function getLatestTaxCalculation(
  workspaceId: string,
): Promise<PymeTaxCalculation | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(pymeTaxCalculations)
    .where(eq(pymeTaxCalculations.workspaceId, workspaceId))
    .orderBy(desc(pymeTaxCalculations.createdAt))
    .limit(1);
  return rows[0] ?? null;
}
