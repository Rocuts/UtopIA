#!/usr/bin/env tsx
// ─── CLI: cierre mensual manual ──────────────────────────────────────────────
// Uso: tsx scripts/close-month-cli.ts <workspaceId> <YYYY-MM> [--override] [--reason "texto"]
//
// Requiere .env.local con DATABASE_URL y UTOPIA_ENABLE_MONTHLY_CLOSE_WORKFLOW=true.
// Ejemplo:
//   tsx scripts/close-month-cli.ts 550e8400-e29b-41d4-a716-446655440000 2026-04
//   tsx scripts/close-month-cli.ts 550e8400-e29b-41d4-a716-446655440000 2026-04 --override --reason "Auditor aprobó"

import 'dotenv/config';
import { start } from 'workflow/api';
import { eq, and } from 'drizzle-orm';

// Carga env vars desde .env.local si no están en el entorno
if (!process.env.DATABASE_URL) {
  try {
    const { config } = await import('dotenv');
    config({ path: '.env.local' });
  } catch {
    // dotenv puede no estar disponible
  }
}

const args = process.argv.slice(2);

function printUsage() {
  console.error(`
Uso: tsx scripts/close-month-cli.ts <workspaceId> <YYYY-MM> [--override] [--reason "texto"]

Ejemplos:
  tsx scripts/close-month-cli.ts 550e8400-e29b-41d4-a716-446655440000 2026-04
  tsx scripts/close-month-cli.ts 550e8400-e29b-41d4-a716-446655440000 2026-04 --override --reason "Auditor lo aprobó"

Monitorear el run:
  npx workflow web <runId>
  npx workflow inspect run <runId>
`);
}

if (args.length < 2) {
  printUsage();
  process.exit(1);
}

const [workspaceId, periodStr] = args;

// Parsear YYYY-MM
const periodMatch = periodStr?.match(/^(\d{4})-(\d{2})$/);
if (!periodMatch) {
  console.error(`ERROR: Formato de período inválido. Use YYYY-MM. Recibido: ${periodStr}`);
  printUsage();
  process.exit(1);
}

const year = parseInt(periodMatch[1], 10);
const month = parseInt(periodMatch[2], 10);

if (month < 1 || month > 12) {
  console.error(`ERROR: Mes inválido: ${month}. Debe ser 1-12.`);
  process.exit(1);
}

// Parsear flags
let override = false;
let overrideReason: string | undefined;

for (let i = 2; i < args.length; i++) {
  if (args[i] === '--override') {
    override = true;
  }
  if (args[i] === '--reason' && args[i + 1]) {
    overrideReason = args[i + 1];
    i++;
  }
}

// Verificar flags de entorno
if (process.env.UTOPIA_ENABLE_MONTHLY_CLOSE_WORKFLOW !== 'true') {
  console.warn('AVISO: UTOPIA_ENABLE_MONTHLY_CLOSE_WORKFLOW no está en "true". El workflow correrá pero el feature flag no está activo.');
}

// Buscar período en DB
console.log(`\nBuscando período ${year}-${String(month).padStart(2, '0')} en workspace ${workspaceId}...`);

let periodId: string;
try {
  const { getDb } = await import('../src/lib/db/client');
  const { accountingPeriods } = await import('../src/lib/db/schema');

  const db = getDb();
  const rows = await db
    .select({ id: accountingPeriods.id, status: accountingPeriods.status })
    .from(accountingPeriods)
    .where(
      and(
        eq(accountingPeriods.workspaceId, workspaceId),
        eq(accountingPeriods.year, year),
        eq(accountingPeriods.month, month),
      ),
    )
    .limit(1);

  if (rows.length === 0) {
    console.error(`ERROR: No se encontró el período ${year}-${String(month).padStart(2, '0')} para el workspace ${workspaceId}.`);
    console.error('Verifique que el workspace existe y el período ha sido creado.');
    process.exit(1);
  }

  const period = rows[0];
  periodId = period.id;

  console.log(`  Período encontrado: ${periodId} (status: ${period.status})`);

  if (period.status === 'locked') {
    console.error(`ERROR: El período ya está bloqueado (locked). No se puede re-cerrar.`);
    process.exit(1);
  }
} catch (err) {
  console.error('ERROR al conectar a la base de datos:', err);
  console.error('Verifique que DATABASE_URL está configurado en .env.local');
  process.exit(1);
}

// Verificar idempotencia
try {
  const { getRunByPeriodId } = await import('../src/lib/workflows/monthly-close/repository');
  const existingRun = await getRunByPeriodId(periodId);

  if (existingRun && existingRun.status !== 'cancelled' && existingRun.status !== 'completed') {
    console.warn(`\nAVISO: Ya existe un run activo para este período:`);
    console.warn(`  ID DB: ${existingRun.id}`);
    console.warn(`  Workflow Run ID: ${existingRun.workflowRunId ?? 'N/A'}`);
    console.warn(`  Status: ${existingRun.status}`);
    console.warn(`\nUse: npx workflow web ${existingRun.workflowRunId ?? ''}`);
    process.exit(0);
  }
} catch (err) {
  console.warn('No se pudo verificar idempotencia (continuando):', err);
}

// Importar workflow y arrancar
console.log(`\nArrancando workflow de cierre mensual...`);
console.log(`  Workspace:       ${workspaceId}`);
console.log(`  Período:         ${year}-${String(month).padStart(2, '0')} (${periodId})`);
console.log(`  Override:        ${override}`);
if (overrideReason) console.log(`  Razón override:  ${overrideReason}`);
console.log('');

try {
  const { closeMonthWorkflow } = await import('../src/lib/workflows/monthly-close');
  const { upsertCloseRun } = await import('../src/lib/workflows/monthly-close/repository');

  const input = {
    workspaceId,
    periodId,
    override,
    overrideReason,
    triggeredBy: undefined as string | undefined,
  };

  const run = await start(closeMonthWorkflow, [input]);

  // Registrar en DB
  await upsertCloseRun({
    workspaceId,
    periodId,
    status: 'running',
    workflowRunId: run.runId,
  });

  console.log(`✓ Workflow iniciado exitosamente`);
  console.log(`  Workflow Run ID: ${run.runId}`);
  console.log('');
  console.log(`Para monitorear:`);
  console.log(`  npx workflow web ${run.runId}`);
  console.log(`  npx workflow inspect run ${run.runId}`);
  console.log('');
  console.log(`Estado vía API:`);
  console.log(`  GET /api/accounting/close/status/${run.runId}`);

  if (!override) {
    console.log('');
    console.log(`Si el health-check detecta problemas, el workflow esperará aprobación.`);
    console.log(`Para aprobar (desde el revisor fiscal):`);
    console.log(`  POST /api/accounting/close/resume`);
    console.log(`  Body: { "token": "close-approval:${periodId}", "payload": { "approved": true, "approvedBy": "nombre" } }`);
  }
} catch (err) {
  console.error('ERROR al iniciar el workflow:', err);
  process.exit(1);
}

process.exit(0);
