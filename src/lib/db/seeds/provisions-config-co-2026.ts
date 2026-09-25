// ─── WS4 — Seed idempotente de provisions_config Colombia 2026 ───────────────
//
// Inserta (o ignora si ya existe) las provisiones estándar para un workspace.
// Idempotente: ON CONFLICT DO NOTHING sobre (workspace_id, provision_type).
//
// Uso desde endpoint /api/accounting/adjustments/setup (POST sin body):
//   import { seedProvisionsForWorkspace } from '@/lib/db/seeds/provisions-config-co-2026'
//   await seedProvisionsForWorkspace(workspaceId)
//
// Auditoría contab-nomina-06/-07/-08 — el seed anterior no era coherente con
// el PUC sembrado del propio repo: base 510505/510510 inexistente (las ocho
// provisiones laborales daban 0), pasivos reutilizados por código con otro
// significado (renta → 240405 "IVA generado", prima → 261005 "Cesantías") y
// gastos en cuentas ajenas (510515 horas extras, 510568/510569 invertidas).
// Ahora TODAS las cuentas salen del PUC sembrado (`PUC_PYME_COLOMBIA`,
// Decreto 2650/1993) y el seed FALLA con error explícito si una cuenta falta
// o existe con otro nombre/tipo, en vez de reutilizarla o crearla huérfana.
//
// Cuentas (Decreto 2650/1993):
//   Prima:               510536 Prima de servicios        / 261020 Prima de servicios
//   Cesantías:           510530 Cesantías                  / 261005 Cesantías
//   Intereses cesantías: 510533 Intereses sobre cesantías  / 261010 Intereses sobre cesantías
//   Vacaciones:          510539 Vacaciones                 / 261015 Vacaciones
//   Salud:               510569 Aportes EPS                / 237005 Aportes EPS
//   Pensión:             510570 Aportes fondos pensiones   / 238030 Fondos de cesantías y/o pensiones
//   ARL:                 510568 Aportes ARL                / 237006 Aportes ARL
//   Caja:                510572 Aportes cajas compensación / 237010 Aportes ICBF, SENA y cajas
//   SENA:                510578 Aportes SENA               / 237010
//   ICBF:                510575 Aportes ICBF               / 237010
//   Renta:               540505 Impuesto de renta          / 240405 Renta — vigencia fiscal corriente
//
// Bases (prefijos PUC; administración 5105 y ventas 5205 — el gasto de la
// provisión se registra en 5105):
//   Salario (IBC):   sueldos, jornales, horas extras y recargos, comisiones.
//   Prima/cesantías/intereses: salario + auxilio de transporte (Art. 7 Ley 1/1963).
//   Vacaciones:      salario ordinario (sin horas extras — Art. 192 CST).
//   Aportes (salud, pensión, ARL, caja, SENA, ICBF): salario SIN auxilio de
//   transporte (no es salario para aportes).
//   Salario integral (510503) no causa prima ni cesantías y aporta sobre el
//   70 %: no se provisiona automáticamente.
//
// Intereses sobre cesantías (contab-nomina-08): 12 % anual sobre las
// cesantías (Ley 52/1975). Provisión mensual = 12 % × cesantía causada del
// mes = 1 % de la MISMA base de cesantías. Antes la base era el pasivo 261020
// (saldo crédito → base 0) con 1 % "mensual sobre el acumulado".
//
// Salud, SENA e ICBF son exonerables por el Art. 114-1 E.T. según la
// condición del empleador (ver adjustments/provisions/calculator.ts).

import 'server-only';

import { and, eq } from 'drizzle-orm';

import { getDb } from '@/lib/db/client';
import { provisionsConfig, chartOfAccounts } from '../schema';
import { PUC_PYME_COLOMBIA } from './puc-pyme-colombia';

// ---------------------------------------------------------------------------
// Definición de las provisiones
// ---------------------------------------------------------------------------

export interface ProvisionDef {
  provisionType: string;
  rate: string; // numeric string con 6 decimales
  baseAccountCodes: string[]; // prefijos PUC para la base
  expenseCode: string;
  liabilityCode: string;
}

const SALARIO = ['510506', '510512', '510515', '510518', '520506', '520512', '520515', '520518'];
const SALARIO_ORDINARIO = ['510506', '510512', '510518', '520506', '520512', '520518'];
const SALARIO_MAS_AUXILIO = [...SALARIO, '510527', '520527'];

export const PROVISIONS_CO_2026: ProvisionDef[] = [
  { provisionType: 'prima', rate: '0.083333', baseAccountCodes: SALARIO_MAS_AUXILIO, expenseCode: '510536', liabilityCode: '261020' },
  { provisionType: 'cesantias', rate: '0.083333', baseAccountCodes: SALARIO_MAS_AUXILIO, expenseCode: '510530', liabilityCode: '261005' },
  { provisionType: 'intereses_cesantias', rate: '0.010000', baseAccountCodes: SALARIO_MAS_AUXILIO, expenseCode: '510533', liabilityCode: '261010' },
  { provisionType: 'vacaciones', rate: '0.041667', baseAccountCodes: SALARIO_ORDINARIO, expenseCode: '510539', liabilityCode: '261015' },
  { provisionType: 'salud', rate: '0.085000', baseAccountCodes: SALARIO, expenseCode: '510569', liabilityCode: '237005' },
  { provisionType: 'pension', rate: '0.120000', baseAccountCodes: SALARIO, expenseCode: '510570', liabilityCode: '238030' },
  // 0,522 % = tarifa inicial Clase de Riesgo I (Decreto 1772/1994 art. 13).
  { provisionType: 'arl', rate: '0.005220', baseAccountCodes: SALARIO, expenseCode: '510568', liabilityCode: '237006' },
  { provisionType: 'caja', rate: '0.040000', baseAccountCodes: SALARIO, expenseCode: '510572', liabilityCode: '237010' },
  { provisionType: 'sena', rate: '0.020000', baseAccountCodes: SALARIO, expenseCode: '510578', liabilityCode: '237010' },
  { provisionType: 'icbf', rate: '0.030000', baseAccountCodes: SALARIO, expenseCode: '510575', liabilityCode: '237010' },
  // Base calculada dinámicamente (utilidad antes de impuestos). 35 % Art. 240 E.T.
  { provisionType: 'income_tax', rate: '0.350000', baseAccountCodes: [], expenseCode: '540505', liabilityCode: '240405' },
];

/**
 * Valores por defecto del seed ANTERIOR. Una fila existente que aún los
 * conserva (nadie la personalizó) se actualiza al esquema nuevo; la fila
 * legado 'parafiscales' se desactiva (Caja/SENA/ICBF quedan separadas).
 */
const LEGACY_DEFAULT_BASES: Record<string, string[]> = {
  prima: ['510505', '510510'],
  cesantias: ['510505', '510510'],
  intereses_cesantias: ['261020'],
  vacaciones: ['510505', '510510'],
  salud: ['510505', '510510'],
  pension: ['510505', '510510'],
  arl: ['510505', '510510'],
  parafiscales: ['510505', '510510'],
};

// ---------------------------------------------------------------------------
// Resolución estricta de cuentas contra el PUC sembrado
// ---------------------------------------------------------------------------

function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const PUC_BY_CODE = new Map(PUC_PYME_COLOMBIA.map((a) => [a.code, a]));

type AccountRow = typeof chartOfAccounts.$inferSelect;

/**
 * Valida que `row` sea la cuenta del PUC sembrado para `code`: mismo tipo y
 * mismo nombre (sin tildes/mayúsculas) y postable. Devuelve el motivo de
 * rechazo o null si es válida.
 */
export function accountMismatch(code: string, row: Pick<AccountRow, 'name' | 'type' | 'isPostable'> | undefined): string | null {
  const expected = PUC_BY_CODE.get(code);
  if (!expected) return `la cuenta ${code} no está en el PUC sembrado (definición inválida)`;
  if (!row) return `la cuenta ${code} (${expected.name}) no existe en el plan de cuentas del workspace; siembre el PUC`;
  if (row.type !== expected.type) {
    return `la cuenta ${code} existe con tipo ${row.type} (esperado ${expected.type})`;
  }
  if (normalizeName(row.name) !== normalizeName(expected.name)) {
    return `la cuenta ${code} existe como "${row.name}" (esperado "${expected.name}"); no se reutiliza una cuenta con otro significado`;
  }
  if (!row.isPostable) return `la cuenta ${code} no es postable`;
  return null;
}

// ---------------------------------------------------------------------------
// seedProvisionsForWorkspace
// ---------------------------------------------------------------------------

export interface SeedResult {
  workspaceId: string;
  provisionsInserted: number;
  provisionsSkipped: number;
  /** Filas con los valores por defecto del seed anterior actualizadas. */
  provisionsUpgraded: string[];
  /** Se conserva por compatibilidad del contrato; el seed ya no crea cuentas. */
  accountsCreated: string[];
  errors: string[];
}

export async function seedProvisionsForWorkspace(
  workspaceId: string,
): Promise<SeedResult> {
  const db = getDb();
  const result: SeedResult = {
    workspaceId,
    provisionsInserted: 0,
    provisionsSkipped: 0,
    provisionsUpgraded: [],
    accountsCreated: [],
    errors: [],
  };

  const accounts = await db
    .select()
    .from(chartOfAccounts)
    .where(eq(chartOfAccounts.workspaceId, workspaceId));
  const byCode = new Map(accounts.map((a) => [a.code, a]));

  for (const def of PROVISIONS_CO_2026) {
    try {
      const expRow = byCode.get(def.expenseCode);
      const liabRow = byCode.get(def.liabilityCode);
      const problems = [
        accountMismatch(def.expenseCode, expRow),
        accountMismatch(def.liabilityCode, liabRow),
      ].filter((p): p is string => p !== null);
      if (problems.length > 0 || !expRow || !liabRow) {
        result.errors.push(`${def.provisionType}: ${problems.join('; ')}`);
        continue;
      }

      const inserted = await db
        .insert(provisionsConfig)
        .values({
          workspaceId,
          provisionType: def.provisionType,
          rate: def.rate,
          baseAccountCodes: def.baseAccountCodes,
          expenseAccountId: expRow.id,
          liabilityAccountId: liabRow.id,
          cadence: 'monthly',
          active: true,
        })
        .onConflictDoNothing()
        .returning();

      if (inserted.length > 0) {
        result.provisionsInserted++;
        continue;
      }

      // Ya existía: si conserva los valores por defecto del seed anterior,
      // se actualiza al esquema corregido (no se tocan filas personalizadas).
      const [existing] = await db
        .select()
        .from(provisionsConfig)
        .where(
          and(
            eq(provisionsConfig.workspaceId, workspaceId),
            eq(provisionsConfig.provisionType, def.provisionType),
          ),
        )
        .limit(1);
      const legacy = LEGACY_DEFAULT_BASES[def.provisionType];
      const isLegacyDefault =
        existing !== undefined &&
        legacy !== undefined &&
        JSON.stringify(existing.baseAccountCodes ?? []) === JSON.stringify(legacy);
      if (existing && isLegacyDefault) {
        await db
          .update(provisionsConfig)
          .set({
            rate: def.rate,
            baseAccountCodes: def.baseAccountCodes,
            expenseAccountId: expRow.id,
            liabilityAccountId: liabRow.id,
            updatedAt: new Date(),
          })
          .where(eq(provisionsConfig.id, existing.id));
        result.provisionsUpgraded.push(def.provisionType);
      } else {
        result.provisionsSkipped++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`${def.provisionType}: ${msg}`);
    }
  }

  // Config legado 'parafiscales' (Caja+SENA+ICBF al 9 %): se desactiva si
  // conserva los valores por defecto y las nuevas filas quedaron sembradas.
  const [legacyParafiscales] = await db
    .select()
    .from(provisionsConfig)
    .where(
      and(
        eq(provisionsConfig.workspaceId, workspaceId),
        eq(provisionsConfig.provisionType, 'parafiscales'),
        eq(provisionsConfig.active, true),
      ),
    )
    .limit(1);
  if (
    legacyParafiscales &&
    JSON.stringify(legacyParafiscales.baseAccountCodes ?? []) ===
      JSON.stringify(LEGACY_DEFAULT_BASES.parafiscales) &&
    !result.errors.some((e) => /^(caja|sena|icbf):/.test(e))
  ) {
    await db
      .update(provisionsConfig)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(provisionsConfig.id, legacyParafiscales.id));
    result.provisionsUpgraded.push('parafiscales→caja/sena/icbf');
  }

  return result;
}
