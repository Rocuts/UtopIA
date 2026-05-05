// ─── WS4 — Seed idempotente de provisions_config Colombia 2026 ───────────────
//
// Inserta (o ignora si ya existe) las 9 provisiones estándar para un workspace.
// Idempotente: usa ON CONFLICT DO NOTHING sobre (workspace_id, provision_type).
//
// Uso desde endpoint /api/accounting/adjustments/setup (POST sin body):
//   import { seedProvisionsForWorkspace } from '@/lib/db/seeds/provisions-config-co-2026'
//   await seedProvisionsForWorkspace(workspaceId)
//
// Cuentas PUC PYMES (Decreto 2706/2012 + 2650/1993):
//   Prima:               510515 (Gasto Prima Servicios)  / 261005 (Prima de Servicios por pagar)
//   Cesantías:           510510 (Gasto Cesantías)        / 261020 (Cesantías por pagar)
//   Intereses cesantías: 510515 (Gasto Prima Servicios)  / 261025 (Int. cesantías por pagar)
//   Vacaciones:          510520 (Gasto Vacaciones)       / 261015 (Vacaciones por pagar)
//   Salud:               510568 (Seguridad Social — emp.) / 237005 (SGSSS por pagar — emp.)
//   Pensión:             510570 (Pensiones — empleador)  / 237006 (Pensiones AFP por pagar)
//   ARL:                 510569 (ARL — empleador)        / 237010 (ARL por pagar)
//   Parafiscales:        510575 (Parafiscales)           / 237025 (Parafiscales por pagar)
//   Income tax:          540505 (Gasto Imp. Renta y CIA) / 240405 (Imp. Renta CIA por pagar)
//
// base_account_codes para provisiones laborales:
//   Salarios y nómina: prefijo "510505" y "510510" cubren Sueldos y Aux. transporte.
//   Para un cálculo simple se usa "51" (toda la clase de gastos de personal).
//   El administrador puede ajustar los prefijos en provisions_config via la UI.

import 'server-only';

import { getDb } from '@/lib/db/client';
import { provisionsConfig, chartOfAccounts } from '../schema';
import { upsertAccountByCode } from '@/lib/accounting/adjustments/repository';
import { eq, and } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Definición de las 9 provisiones
// ---------------------------------------------------------------------------

interface ProvisionDef {
  provisionType: string;
  rate: string; // numeric string con 6 decimales
  baseAccountCodes: string[]; // prefijos PUC para la base
  expenseCode: string;
  expenseName: string;
  expenseType: 'GASTO';
  liabilityCode: string;
  liabilityName: string;
  liabilityType: 'PASIVO';
}

const PROVISIONS_CO_2026: ProvisionDef[] = [
  {
    provisionType: 'prima',
    rate: '0.083300',
    baseAccountCodes: ['510505', '510510'], // Sueldos + Aux transporte
    expenseCode: '510515',
    expenseName: 'Gasto Prima de Servicios',
    expenseType: 'GASTO',
    liabilityCode: '261005',
    liabilityName: 'Prima de Servicios por pagar',
    liabilityType: 'PASIVO',
  },
  {
    provisionType: 'cesantias',
    rate: '0.083300',
    baseAccountCodes: ['510505', '510510'],
    expenseCode: '510510',
    expenseName: 'Gasto Cesantías',
    expenseType: 'GASTO',
    liabilityCode: '261020',
    liabilityName: 'Cesantías consolidadas por pagar',
    liabilityType: 'PASIVO',
  },
  {
    provisionType: 'intereses_cesantias',
    rate: '0.010000', // 1% mensual sobre cesantías acumuladas (12% anual / 12)
    baseAccountCodes: ['261020'], // base = saldo de cesantías acumuladas
    expenseCode: '510515',
    expenseName: 'Gasto Intereses sobre Cesantías',
    expenseType: 'GASTO',
    liabilityCode: '261025',
    liabilityName: 'Intereses sobre Cesantías por pagar',
    liabilityType: 'PASIVO',
  },
  {
    provisionType: 'vacaciones',
    rate: '0.041700',
    baseAccountCodes: ['510505', '510510'],
    expenseCode: '510520',
    expenseName: 'Gasto Vacaciones',
    expenseType: 'GASTO',
    liabilityCode: '261015',
    liabilityName: 'Vacaciones por pagar',
    liabilityType: 'PASIVO',
  },
  {
    provisionType: 'salud',
    rate: '0.085000', // 8.5% empleador (Ley 100/1993)
    baseAccountCodes: ['510505', '510510'],
    expenseCode: '510568',
    expenseName: 'Gasto Seguridad Social en Salud — Empleador',
    expenseType: 'GASTO',
    liabilityCode: '237005',
    liabilityName: 'SGSSS por pagar — Empleador',
    liabilityType: 'PASIVO',
  },
  {
    provisionType: 'pension',
    rate: '0.120000', // 12% empleador (Ley 100/1993)
    baseAccountCodes: ['510505', '510510'],
    expenseCode: '510570',
    expenseName: 'Gasto Pensiones — Empleador',
    expenseType: 'GASTO',
    liabilityCode: '237006',
    liabilityName: 'Pensiones AFP por pagar',
    liabilityType: 'PASIVO',
  },
  {
    provisionType: 'arl',
    rate: '0.005220', // 0.522% Clase de Riesgo I (Decreto 1295/1994)
    baseAccountCodes: ['510505', '510510'],
    expenseCode: '510569',
    expenseName: 'Gasto ARL — Empleador',
    expenseType: 'GASTO',
    liabilityCode: '237010',
    liabilityName: 'ARL por pagar',
    liabilityType: 'PASIVO',
  },
  {
    provisionType: 'parafiscales',
    rate: '0.090000', // 9% = 4% Caja + 3% ICBF + 2% SENA (Ley 21/1982)
    baseAccountCodes: ['510505', '510510'],
    expenseCode: '510575',
    expenseName: 'Gasto Parafiscales',
    expenseType: 'GASTO',
    liabilityCode: '237025',
    liabilityName: 'Parafiscales por pagar',
    liabilityType: 'PASIVO',
  },
  {
    provisionType: 'income_tax',
    rate: '0.350000', // 35% Art. 240 E.T. 2026
    baseAccountCodes: [], // base calculada dinámicamente (utilidad antes de impuestos)
    expenseCode: '540505',
    expenseName: 'Gasto Impuesto de Renta y Complementarios',
    expenseType: 'GASTO',
    liabilityCode: '240405',
    liabilityName: 'Impuesto sobre la Renta y CIA por pagar',
    liabilityType: 'PASIVO',
  },
];

// ---------------------------------------------------------------------------
// seedProvisionsForWorkspace
// ---------------------------------------------------------------------------

export interface SeedResult {
  workspaceId: string;
  provisionsInserted: number;
  provisionsSkipped: number;
  accountsCreated: string[]; // códigos PUC que se crearon en este seed
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
    accountsCreated: [],
    errors: [],
  };

  for (const def of PROVISIONS_CO_2026) {
    try {
      // 1. Asegurar que las cuentas PUC existen.
      const expAcc = await upsertAccountByCode(
        workspaceId,
        def.expenseCode,
        def.expenseName,
        def.expenseType,
      );
      if (expAcc.created) result.accountsCreated.push(def.expenseCode);

      const liabAcc = await upsertAccountByCode(
        workspaceId,
        def.liabilityCode,
        def.liabilityName,
        def.liabilityType,
      );
      if (liabAcc.created) result.accountsCreated.push(def.liabilityCode);

      // 2. Insertar provisions_config — idempotente ON CONFLICT DO NOTHING.
      const inserted = await db
        .insert(provisionsConfig)
        .values({
          workspaceId,
          provisionType: def.provisionType,
          rate: def.rate,
          baseAccountCodes: def.baseAccountCodes,
          expenseAccountId: expAcc.id,
          liabilityAccountId: liabAcc.id,
          cadence: 'monthly',
          active: true,
        })
        .onConflictDoNothing()
        .returning();

      if (inserted.length > 0) {
        result.provisionsInserted++;
      } else {
        result.provisionsSkipped++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`${def.provisionType}: ${msg}`);
    }
  }

  return result;
}
