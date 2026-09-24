import 'server-only';
import { eq } from 'drizzle-orm';
import { getDb } from './client';
import { workspaces } from './schema';

// Condición del empleador frente al Art. 114-1 E.T. (exoneración de salud del
// empleador, SENA e ICBF por trabajadores < 10 SMMLV). La consumen la nómina
// Pyme (src/lib/payroll) y las provisiones automáticas. null = no declarada:
// ningún cálculo asume la exoneración (auditoría contab-nomina-07 / -19).

/** true beneficiario · false no beneficiario · null no declarado. */
export async function getEmpleador114_1(workspaceId: string): Promise<boolean | null> {
  const db = getDb();
  const rows = await db
    .select({ v: workspaces.empleadorBeneficiario114_1 })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  const v = rows[0]?.v;
  return v === true || v === false ? v : null;
}

export async function setEmpleador114_1(
  workspaceId: string,
  value: boolean | null,
): Promise<boolean | null> {
  const db = getDb();
  const [row] = await db
    .update(workspaces)
    .set({ empleadorBeneficiario114_1: value, updatedAt: new Date() })
    .where(eq(workspaces.id, workspaceId))
    .returning({ v: workspaces.empleadorBeneficiario114_1 });
  const v = row?.v;
  return v === true || v === false ? v : null;
}
