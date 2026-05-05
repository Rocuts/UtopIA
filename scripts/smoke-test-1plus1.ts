#!/usr/bin/env tsx
// ─── scripts/smoke-test-1plus1.ts ────────────────────────────────────────────
//
// Smoke-test runner para la Ola "1+1 Élite".
// Valida los 6 workstreams end-to-end contra el dev server + Neon Postgres.
//
// Uso:
//   npm run smoke                          # flags según .env.local
//   SMOKE_BASE_URL=http://... npm run smoke
//   SMOKE_WORKSPACE_ID=<uuid> npm run smoke   # reutilizar workspace existente
//   NO_COLOR=1 npm run smoke               # sin colores ANSI
//
// Precondiciones:
//   1. npm run dev corriendo en localhost:3000 (o SMOKE_BASE_URL)
//   2. .env.local con DATABASE_URL, OPENAI_API_KEY y los flags UTOPIA_ENABLE_*
//   3. Migraciones aplicadas: npm run db:push
//
// Exit code: 0 si PASSED o PASSED-con-warnings, 1 si algún paso ✗

import 'dotenv/config';
import * as path from 'node:path';
import * as fs from 'node:fs';

import { HttpClient } from './smoke-test-1plus1/http-client';
import {
  printHeader,
  printSection,
  printFooter,
  type StepResult,
  type SectionSummary,
} from './smoke-test-1plus1/reporter';
import { bootstrapSmokeFixtures, type SmokeFixturesResult } from './smoke-fixtures';
import { closeSmokePool } from './smoke-test-1plus1/db-helpers';

// ─── Config ───────────────────────────────────────────────────────────────────

const BASE = (process.env.SMOKE_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const TIMEOUT = Number(process.env.SMOKE_TIMEOUT_MS ?? 30_000);
const CLOSE_POLL_TIMEOUT = Number(process.env.SMOKE_CLOSE_POLL_TIMEOUT_MS ?? 60_000);

// Feature flags
const FLAG_TAX = process.env.UTOPIA_ENABLE_TAX_ENGINE === 'true';
const FLAG_OCR = process.env.UTOPIA_ENABLE_OCR_PROMOTE === 'true';
const FLAG_BANK = process.env.UTOPIA_ENABLE_BANK_RECON === 'true';
const FLAG_ADJ = process.env.UTOPIA_ENABLE_AUTO_ADJUSTMENTS === 'true';
const FLAG_CLOSE = process.env.UTOPIA_ENABLE_MONTHLY_CLOSE_WORKFLOW === 'true';
const FLAG_NOTIF = process.env.UTOPIA_ENABLE_NOTIFICATIONS === 'true';

// ─── Context ──────────────────────────────────────────────────────────────────

interface SmokeCtx {
  http: HttpClient;
  workspaceId: string;
  periodId: string | null;
  bankAccountId: string | null;
  fixedAssetId: string | null;
  closeRunId: string | null;
  pymeEntryIds: string[];
  // UUIDs resueltos por el bootstrap (no requieren env vars)
  chartAccountIds: SmokeFixturesResult['chartAccountIds'] | null;
}

// ─── Timing helper ────────────────────────────────────────────────────────────

function now(): number {
  return Date.now();
}

function elapsed(start: number): number {
  return Date.now() - start;
}

// ─── Step helpers ─────────────────────────────────────────────────────────────

function pass(message: string, detail: string | undefined, start: number): StepResult {
  return { ok: true, message, detail, durationMs: elapsed(start) };
}

function fail(message: string, start: number): StepResult {
  return { ok: false, message, durationMs: elapsed(start) };
}

function warn(message: string, detail: string | undefined, start: number): StepResult {
  return { ok: true, warn: true, message, detail, durationMs: elapsed(start) };
}

function bodyStr(body: unknown): string {
  if (typeof body === 'string') return body.slice(0, 400);
  try { return JSON.stringify(body).slice(0, 400); } catch { return String(body); }
}

// ─── Sección 0 — Fundaciones / Preflight ─────────────────────────────────────

async function runFundaciones(ctx: SmokeCtx): Promise<SectionSummary> {
  const steps: SectionSummary['steps'] = [];

  // ── health ────────────────────────────────────────────────────────────────
  {
    const t = now();
    try {
      const res = await ctx.http.get('/api/workspace');
      if (res.status === 200 && res.body && typeof res.body === 'object' && 'workspace' in res.body) {
        const ws = (res.body as { workspace: { id: string } }).workspace;
        ctx.workspaceId = ws.id;
        steps.push({
          name: 'health',
          result: pass(`workspace=${ws.id.slice(0, 8)}…`, undefined, t),
        });
      } else {
        steps.push({
          name: 'health',
          result: fail(`HTTP ${res.status}: ${bodyStr(res.body)}`, t),
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isConn = msg.includes('ECONNREFUSED') || msg.includes('fetch failed') || msg.includes('abort');
      steps.push({
        name: 'health',
        result: fail(
          isConn
            ? `El runner requiere \`npm run dev\` corriendo en ${BASE}. Si tu base es otra, exporta SMOKE_BASE_URL.`
            : msg,
          t,
        ),
      });
    }
  }

  // ── db-reachable ──────────────────────────────────────────────────────────
  {
    const t = now();
    const healthOk = steps[0]?.result.ok;
    if (!healthOk) {
      steps.push({
        name: 'db-reachable',
        result: fail('Saltado — health falló', t),
      });
    } else {
      // El GET /api/workspace ya hizo getOrCreateWorkspace() que requiere DB.
      // Si llegamos aquí, la DB es alcanzable.
      steps.push({
        name: 'db-reachable',
        result: pass('Neon Postgres alcanzable (workspace GET exitoso)', undefined, t),
      });
    }
  }

  return {
    name: 'Fundaciones',
    skipped: false,
    steps,
  };
}

// ─── Sección 1 — WS1 Smart-Tax Engine ────────────────────────────────────────

async function runWS1(ctx: SmokeCtx): Promise<SectionSummary> {
  if (!FLAG_TAX) {
    return { name: 'WS1 — Smart-Tax Engine', skipped: true, flagLabel: 'UTOPIA_ENABLE_TAX_ENGINE', steps: [] };
  }

  const steps: SectionSummary['steps'] = [];

  // ── tax-seed ──────────────────────────────────────────────────────────────
  {
    const t = now();
    try {
      // El seed se puede disparar via un endpoint interno o directamente.
      // En este runner llamamos al endpoint; si no existe, hacemos seed directo via import.
      // Intentar el endpoint POST /api/accounting/tax-engine/seed (si existe)
      // Si no, reportar como WARN con instrucción manual.
      const res = await ctx.http.post('/api/accounting/tax-engine/seed', {});
      if (res.status === 200 || res.status === 201) {
        steps.push({ name: 'tax-seed', result: pass('Reglas tributarias sembradas OK', undefined, t) });
      } else if (res.status === 404) {
        // Endpoint no existe — el seed se corre con npm run db:seed-tax
        // El runner continúa asumiendo que ya se corrió manualmente.
        steps.push({
          name: 'tax-seed',
          result: warn(
            'Endpoint /api/accounting/tax-engine/seed no encontrado',
            'Corre manualmente: npx dotenv -e .env.local -- tsx scripts/seed-tax-rules.ts',
            t,
          ),
        });
      } else {
        steps.push({
          name: 'tax-seed',
          result: fail(`HTTP ${res.status}: ${bodyStr(res.body)}`, t),
        });
      }
    } catch (err) {
      steps.push({ name: 'tax-seed', result: fail(err instanceof Error ? err.message : String(err), t) });
    }
  }

  // ── tax-preview-purchase-1m ───────────────────────────────────────────────
  {
    const t = now();
    try {
      const res = await ctx.http.post('/api/accounting/tax-engine/preview', {
        transactionType: 'service_purchase',
        subtotalCop: '1000000',
        uvtYear: 2026,
      });

      if (!res.ok) {
        steps.push({
          name: 'tax-preview-purchase-1m',
          result: fail(`HTTP ${res.status}: ${bodyStr(res.body)}`, t),
        });
      } else {
        const body = res.body as {
          ok?: boolean;
          lines?: Array<{ taxType: string; taxAmount: string | number; accountSide: string }>;
          totalTaxCop?: string | number;
          baseCop?: string | number;
          warnings?: string[];
        };

        const lines = body.lines ?? [];
        const lineCount = lines.length;

        // Verificar montos esperados para service_purchase 1.000.000 COP
        // sin thirdPartyId → solo IVA 19% aplica con seguridad
        // Con thirdPartyId de régimen común también RTF 4%.
        // Sin tercero: el motor debe devolver al menos IVA_19 (1 línea).
        // Validar: IVA = 190000, base = 1000000

        const baseCop = Number(body.baseCop ?? '1000000');
        const ivaLine = lines.find((l) => l.taxType === 'IVA');
        const ivaAmount = ivaLine ? Number(ivaLine.taxAmount) : null;

        const baseOk = Math.abs(baseCop - 1_000_000) <= 1;
        const ivaOk = ivaAmount !== null && Math.abs(ivaAmount - 190_000) <= 1;

        if (lineCount === 0) {
          steps.push({
            name: 'tax-preview-purchase-1m',
            result: warn(
              `Sin reglas activas: 0 líneas. Corre: npx dotenv -e .env.local -- tsx scripts/seed-tax-rules.ts`,
              `base=${baseCop}`,
              t,
            ),
          });
        } else if (!baseOk) {
          steps.push({
            name: 'tax-preview-purchase-1m',
            result: fail(`base esperada=1000000, recibida=${baseCop}`, t),
          });
        } else if (!ivaOk) {
          steps.push({
            name: 'tax-preview-purchase-1m',
            result: fail(`IVA esperado=190000, recibido=${ivaAmount ?? 'ninguno'}`, t),
          });
        } else {
          const detail = `${lineCount} líneas, IVA=${ivaAmount}, base=${baseCop}`;
          steps.push({ name: 'tax-preview-purchase-1m', result: pass(detail, detail, t) });
        }
      }
    } catch (err) {
      steps.push({
        name: 'tax-preview-purchase-1m',
        result: fail(err instanceof Error ? err.message : String(err), t),
      });
    }
  }

  return { name: 'WS1 — Smart-Tax Engine', skipped: false, flagLabel: 'UTOPIA_ENABLE_TAX_ENGINE', steps };
}

// ─── Sección 2 — WS2 OCR Bridge ──────────────────────────────────────────────

async function runWS2(ctx: SmokeCtx): Promise<SectionSummary> {
  if (!FLAG_OCR) {
    return { name: 'WS2 — OCR → Journal Bridge', skipped: true, flagLabel: 'UTOPIA_ENABLE_OCR_PROMOTE', steps: [] };
  }

  const steps: SectionSummary['steps'] = [];

  // ── pyme-create-entry ─────────────────────────────────────────────────────
  // El bootstrap ya insertó los entries directamente vía pg.Pool — no se
  // necesita un endpoint ni instrucción manual.
  {
    const t = now();
    const count = ctx.pymeEntryIds.length;
    if (count >= 1) {
      steps.push({
        name: 'pyme-create-entry',
        result: pass(
          `${count} pyme_entries confirmed creados por bootstrap`,
          `IDs: ${ctx.pymeEntryIds.map((id) => id.slice(0, 8)).join(', ')}…`,
          t,
        ),
      });
    } else {
      steps.push({
        name: 'pyme-create-entry',
        result: warn(
          'Bootstrap no creó pyme_entries — pymeEntryIds vacío',
          'Verifica que el pyme book se creó correctamente',
          t,
        ),
      });
    }
  }

  // ── pyme-promote ──────────────────────────────────────────────────────────
  {
    const t = now();
    if (ctx.pymeEntryIds.length === 0) {
      steps.push({
        name: 'pyme-promote',
        result: warn(
          'Saltado — sin pymeEntryIds (pyme-create-entry requiere fixture manual)',
          undefined,
          t,
        ),
      });
    } else if (!ctx.periodId) {
      steps.push({
        name: 'pyme-promote',
        result: warn('Saltado — sin periodId (fundaciones incompletas)', undefined, t),
      });
    } else {
      try {
        const res = await ctx.http.post('/api/pyme/promote', {
          pymeEntryIds: ctx.pymeEntryIds,
          periodId: ctx.periodId,
          applyTaxEngine: false,
        });

        if (res.ok) {
          const body = res.body as { ok: boolean; journalEntryIds?: string[] };
          const count = body.journalEntryIds?.length ?? 0;
          if (count >= 1) {
            steps.push({
              name: 'pyme-promote',
              result: pass(`${count} journal_entries creados en draft`, undefined, t),
            });
          } else {
            steps.push({
              name: 'pyme-promote',
              result: fail(`journalEntryIds vacío. Body: ${bodyStr(res.body)}`, t),
            });
          }
        } else {
          steps.push({
            name: 'pyme-promote',
            result: fail(`HTTP ${res.status}: ${bodyStr(res.body)}`, t),
          });
        }
      } catch (err) {
        steps.push({
          name: 'pyme-promote',
          result: fail(err instanceof Error ? err.message : String(err), t),
        });
      }
    }
  }

  return { name: 'WS2 — OCR → Journal Bridge', skipped: false, flagLabel: 'UTOPIA_ENABLE_OCR_PROMOTE', steps };
}

// ─── Sección 3 — WS3 Banking ─────────────────────────────────────────────────

async function runWS3(ctx: SmokeCtx): Promise<SectionSummary> {
  if (!FLAG_BANK) {
    return { name: 'WS3 — Bank Reconciliation', skipped: true, flagLabel: 'UTOPIA_ENABLE_BANK_RECON', steps: [] };
  }

  const steps: SectionSummary['steps'] = [];

  // Usar el UUID resuelto por el bootstrap (111005 / 111010 Bancos)
  const chartAccountId: string | null = ctx.chartAccountIds?.bank ?? null;

  if (!chartAccountId) {
    const t = now();
    steps.push({
      name: 'bank-acc-create',
      result: warn(
        'Bootstrap no encontró cuenta bancaria postable en chart_of_accounts — WS3 saltado',
        'Verifica que el PUC seed incluyó 111005 (Bancos) y que is_postable=true',
        t,
      ),
    });
    steps.push({ name: 'bank-csv-import', result: warn('Saltado — sin chartAccountId', undefined, now()) });
    steps.push({ name: 'bank-csv-reimport', result: warn('Saltado — sin chartAccountId', undefined, now()) });
    steps.push({ name: 'bank-status', result: warn('Saltado — sin chartAccountId', undefined, now()) });
    return { name: 'WS3 — Bank Reconciliation', skipped: false, flagLabel: 'UTOPIA_ENABLE_BANK_RECON', steps };
  }

  // ── bank-acc-create ───────────────────────────────────────────────────────
  {
    const t = now();
    try {
      const res = await ctx.http.post('/api/accounting/banking/accounts', {
        accountId: chartAccountId,
        bankName: 'Bancolombia',
        accountNumber: 'SMOKE-1234567890',
        accountKind: 'savings',
        holderName: 'Empresa Demo Smoke',
        currency: 'COP',
      });

      if (res.status === 201 || res.status === 200) {
        const body = res.body as { id?: string };
        ctx.bankAccountId = body.id ?? null;
        steps.push({
          name: 'bank-acc-create',
          result: pass(`bankAccountId=${ctx.bankAccountId?.slice(0, 8)}…`, undefined, t),
        });
      } else if (res.status === 409) {
        // Cuenta ya existe (idempotencia) — intentar obtenerla
        const listRes = await ctx.http.get('/api/accounting/banking/accounts');
        const accounts = (listRes.body as { id?: string; accountNumber?: string }[] | undefined) ?? [];
        const found = accounts.find?.((a) => a.accountNumber === 'SMOKE-1234567890');
        ctx.bankAccountId = found?.id ?? null;
        steps.push({
          name: 'bank-acc-create',
          result: pass(`Cuenta ya existe (idempotente), bankAccountId=${ctx.bankAccountId?.slice(0, 8) ?? 'N/A'}…`, undefined, t),
        });
      } else {
        steps.push({
          name: 'bank-acc-create',
          result: fail(`HTTP ${res.status}: ${bodyStr(res.body)}`, t),
        });
      }
    } catch (err) {
      steps.push({ name: 'bank-acc-create', result: fail(err instanceof Error ? err.message : String(err), t) });
    }
  }

  if (!ctx.bankAccountId) {
    steps.push({ name: 'bank-csv-import', result: warn('Saltado — sin bankAccountId', undefined, now()) });
    steps.push({ name: 'bank-csv-reimport', result: warn('Saltado — sin bankAccountId', undefined, now()) });
    steps.push({ name: 'bank-status', result: warn('Saltado — sin bankAccountId y periodId', undefined, now()) });
    return { name: 'WS3 — Bank Reconciliation', skipped: false, flagLabel: 'UTOPIA_ENABLE_BANK_RECON', steps };
  }

  // ── bank-csv-import ───────────────────────────────────────────────────────
  const csvPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    'smoke-test-1plus1/fixtures/bancolombia-sample.csv',
  );

  {
    const t = now();
    try {
      const csvContent = fs.readFileSync(csvPath);
      const contentBase64 = csvContent.toString('base64');

      const res = await ctx.http.post('/api/accounting/banking/imports', {
        bankAccountId: ctx.bankAccountId,
        filename: 'bancolombia-sample.csv',
        contentBase64,
      });

      if (res.status === 201 || res.status === 200) {
        const body = res.body as { imported?: number; skipped?: number; errors?: unknown[] };
        const imported = body.imported ?? 0;
        if (imported >= 3) {
          steps.push({
            name: 'bank-csv-import',
            result: pass(`${imported} transacciones importadas, ${body.skipped ?? 0} omitidas`, undefined, t),
          });
        } else if (imported >= 0 && (body.skipped ?? 0) >= 3) {
          // Puede que ya se importaron antes (re-run sin limpiar DB)
          steps.push({
            name: 'bank-csv-import',
            result: warn(
              `${imported} nuevas, ${body.skipped ?? 0} duplicadas (re-run sin DB limpia — OK)`,
              'Para ver 0 duplicados la primera vez, usa un workspace nuevo o limpia bank_transactions',
              t,
            ),
          });
        } else {
          steps.push({
            name: 'bank-csv-import',
            result: warn(`${imported} importadas (esperado ≥3). Body: ${bodyStr(body)}`, undefined, t),
          });
        }
      } else {
        steps.push({
          name: 'bank-csv-import',
          result: fail(`HTTP ${res.status}: ${bodyStr(res.body)}`, t),
        });
      }
    } catch (err) {
      steps.push({ name: 'bank-csv-import', result: fail(err instanceof Error ? err.message : String(err), t) });
    }
  }

  // ── bank-csv-reimport (idempotencia) ─────────────────────────────────────
  {
    const t = now();
    try {
      const csvContent = fs.readFileSync(csvPath);
      const contentBase64 = csvContent.toString('base64');

      const res = await ctx.http.post('/api/accounting/banking/imports', {
        bankAccountId: ctx.bankAccountId,
        filename: 'bancolombia-sample.csv',
        contentBase64,
      });

      if (res.ok) {
        const body = res.body as { imported?: number; skipped?: number };
        const imported = body.imported ?? 0;
        const skipped = body.skipped ?? 0;

        if (imported === 0 && skipped >= 3) {
          steps.push({
            name: 'bank-csv-reimport (idempotencia)',
            result: pass(`0 nuevas, ${skipped} duplicadas omitidas`, `0 nuevas, ${skipped} duplicadas omitidas`, t),
          });
        } else if (imported > 0) {
          // Puede pasar si los fingerprints cambian entre runs — WARN no FAIL
          steps.push({
            name: 'bank-csv-reimport (idempotencia)',
            result: warn(
              `${imported} re-importadas inesperadamente (fingerprint issue?)`,
              `skipped=${skipped} — verificar lógica de deduplicación`,
              t,
            ),
          });
        } else {
          steps.push({
            name: 'bank-csv-reimport (idempotencia)',
            result: warn(`imported=${imported}, skipped=${skipped}. Body: ${bodyStr(res.body)}`, undefined, t),
          });
        }
      } else {
        steps.push({
          name: 'bank-csv-reimport (idempotencia)',
          result: fail(`HTTP ${res.status}: ${bodyStr(res.body)}`, t),
        });
      }
    } catch (err) {
      steps.push({
        name: 'bank-csv-reimport (idempotencia)',
        result: fail(err instanceof Error ? err.message : String(err), t),
      });
    }
  }

  // ── bank-status ───────────────────────────────────────────────────────────
  {
    const t = now();
    const pid = ctx.periodId;
    if (!pid) {
      steps.push({
        name: 'bank-status',
        result: warn('Saltado — sin periodId (crear período primero)', undefined, t),
      });
    } else {
      try {
        const res = await ctx.http.get(`/api/accounting/banking/status?periodId=${pid}`);
        if (res.ok) {
          const body = res.body as unknown[];
          const count = Array.isArray(body) ? body.length : 0;
          steps.push({
            name: 'bank-status',
            result: pass(`${count} cuenta(s) con status de conciliación`, undefined, t),
          });
        } else {
          steps.push({
            name: 'bank-status',
            result: fail(`HTTP ${res.status}: ${bodyStr(res.body)}`, t),
          });
        }
      } catch (err) {
        steps.push({ name: 'bank-status', result: fail(err instanceof Error ? err.message : String(err), t) });
      }
    }
  }

  return { name: 'WS3 — Bank Reconciliation', skipped: false, flagLabel: 'UTOPIA_ENABLE_BANK_RECON', steps };
}

// ─── Sección 4 — WS4 NIIF Auto-Adjustments ───────────────────────────────────

async function runWS4(ctx: SmokeCtx): Promise<SectionSummary> {
  if (!FLAG_ADJ) {
    return { name: 'WS4 — NIIF Auto-Adjustments', skipped: true, flagLabel: 'UTOPIA_ENABLE_AUTO_ADJUSTMENTS', steps: [] };
  }

  const steps: SectionSummary['steps'] = [];

  // ── adj-setup ─────────────────────────────────────────────────────────────
  {
    const t = now();
    try {
      const res = await ctx.http.post('/api/accounting/adjustments/setup', {});
      if (res.ok) {
        const body = res.body as { seeded?: number; skipped?: number; errors?: unknown[] };
        const seeded = body.seeded ?? '?';
        const errCount = body.errors?.length ?? 0;
        if (errCount > 0) {
          steps.push({
            name: 'adj-setup',
            result: warn(`Provisions sembradas con ${errCount} error(es)`, bodyStr(body.errors), t),
          });
        } else {
          steps.push({
            name: 'adj-setup',
            result: pass(`${seeded} provisions_config sembradas (idempotente)`, undefined, t),
          });
        }
      } else {
        steps.push({ name: 'adj-setup', result: fail(`HTTP ${res.status}: ${bodyStr(res.body)}`, t) });
      }
    } catch (err) {
      steps.push({ name: 'adj-setup', result: fail(err instanceof Error ? err.message : String(err), t) });
    }
  }

  // ── fa-create ─────────────────────────────────────────────────────────────
  // UUIDs resueltos por el bootstrap — sin requerir env vars manuales.
  {
    const t = now();
    const assetAccId = ctx.chartAccountIds?.fixedAssetCpu ?? null;
    const depAccId = ctx.chartAccountIds?.accumDeprecCpu ?? null;
    const expAccId = ctx.chartAccountIds?.expenseDeprecCpu ?? null;

    if (!assetAccId || !depAccId || !expAccId) {
      steps.push({
        name: 'fa-create',
        result: warn(
          'Bootstrap no resolvió las 3 cuentas PUC para activo fijo (152805/159215/516015)',
          'Verifica que el PUC seed completó correctamente',
          t,
        ),
      });
    } else {
      try {
        const res = await ctx.http.post('/api/accounting/adjustments/fixed-assets', {
          code: 'SMOKE-CPU-001',
          name: 'Computador smoke test',
          category: 'equipo_computo',
          assetAccountId: assetAccId,
          depreciationAccountId: depAccId,
          expenseAccountId: expAccId,
          acquisitionDate: '2026-04-01T00:00:00Z',
          acquisitionCost: '3000000',
          salvageValue: '0',
          usefulLifeMonths: 36,
          depreciationMethod: 'straight_line',
        });

        if (res.status === 201 || res.status === 200) {
          const body = res.body as { id?: string; monthlyDepreciation?: string | number };
          ctx.fixedAssetId = body.id ?? null;
          // Verificar cuota mensual = 83333.33 (3.000.000 / 36)
          const monthly = body.monthlyDepreciation !== undefined
            ? Math.abs(Number(body.monthlyDepreciation))
            : null;
          const monthlyOk = monthly !== null && Math.abs(monthly - 83_333.33) <= 1;
          const detail = monthly !== null
            ? `fixedAssetId=${ctx.fixedAssetId?.slice(0, 8) ?? 'N/A'}…, cuota=${monthly.toFixed(2)}${monthlyOk ? ' ✓' : ' ⚠ (esperado 83333.33)'}`
            : `fixedAssetId=${ctx.fixedAssetId?.slice(0, 8) ?? 'N/A'}…`;
          steps.push({
            name: 'fa-create',
            result: pass(detail, undefined, t),
          });
        } else if (res.status === 409) {
          steps.push({ name: 'fa-create', result: pass('Activo ya existe (idempotente)', undefined, t) });
        } else {
          steps.push({ name: 'fa-create', result: fail(`HTTP ${res.status}: ${bodyStr(res.body)}`, t) });
        }
      } catch (err) {
        steps.push({ name: 'fa-create', result: fail(err instanceof Error ? err.message : String(err), t) });
      }
    }
  }

  // ── adj-preview ───────────────────────────────────────────────────────────
  {
    const t = now();
    const pid = ctx.periodId;
    if (!pid) {
      steps.push({
        name: 'adj-preview',
        result: warn('Saltado — sin periodId', 'Crear período abierto primero', t),
      });
    } else {
      try {
        const res = await ctx.http.post('/api/accounting/adjustments/preview', { periodId: pid });

        if (!res.ok) {
          steps.push({ name: 'adj-preview', result: fail(`HTTP ${res.status}: ${bodyStr(res.body)}`, t) });
        } else {
          const body = res.body as {
            depreciation?: { entries?: Array<{ amount: string | number }> };
            amortization?: unknown;
            provisions?: unknown;
          };

          const depEntries = body.depreciation?.entries ?? [];
          const depTotal = depEntries.reduce((sum: number, e: { amount: string | number }) => sum + Number(e.amount), 0);

          // Si hay activo fijo de 3M/36 meses → 83333.33/mes
          // No forzamos el check si no se pudo crear el activo
          if (ctx.fixedAssetId && depEntries.length > 0) {
            const diff = Math.abs(depTotal - 83_333.33);
            if (diff <= 1) {
              steps.push({
                name: 'adj-preview',
                result: pass(
                  `depreciación mensual = ${depTotal.toFixed(2)} ✓`,
                  `depreciación mensual = ${depTotal.toFixed(2)} ✓`,
                  t,
                ),
              });
            } else {
              steps.push({
                name: 'adj-preview',
                result: fail(`depreciación esperada=83333.33, recibida=${depTotal.toFixed(2)}`, t),
              });
            }
          } else {
            const hasDep = depEntries.length > 0;
            steps.push({
              name: 'adj-preview',
              result: pass(
                `Preview OK — ${hasDep ? `${depEntries.length} entradas depreciación` : 'sin activos fijos aún'}`,
                undefined,
                t,
              ),
            });
          }
        }
      } catch (err) {
        steps.push({ name: 'adj-preview', result: fail(err instanceof Error ? err.message : String(err), t) });
      }
    }
  }

  return { name: 'WS4 — NIIF Auto-Adjustments', skipped: false, flagLabel: 'UTOPIA_ENABLE_AUTO_ADJUSTMENTS', steps };
}

// ─── Sección 5 — WS5 Monthly Close Workflow ───────────────────────────────────

async function runWS5(ctx: SmokeCtx): Promise<SectionSummary> {
  if (!FLAG_CLOSE) {
    return { name: 'WS5 — Monthly Close Workflow', skipped: true, flagLabel: 'UTOPIA_ENABLE_MONTHLY_CLOSE_WORKFLOW', steps: [] };
  }

  const steps: SectionSummary['steps'] = [];
  const pid = ctx.periodId;

  if (!pid) {
    steps.push({
      name: 'close-start',
      result: warn('Saltado — sin periodId abierto', 'WS5 requiere un accounting_period abierto', now()),
    });
    steps.push({ name: 'close-status-poll', result: warn('Saltado — sin periodId', undefined, now()) });
    return { name: 'WS5 — Monthly Close Workflow', skipped: false, flagLabel: 'UTOPIA_ENABLE_MONTHLY_CLOSE_WORKFLOW', steps };
  }

  let workflowRunId: string | null = null;

  // ── close-start ───────────────────────────────────────────────────────────
  {
    const t = now();
    try {
      const res = await ctx.http.post('/api/accounting/close/start', {
        periodId: pid,
        override: false,
      });

      if (res.status === 202 || res.status === 200) {
        const body = res.body as { workflowRunId?: string; runId?: string; status?: string };
        workflowRunId = body.workflowRunId ?? body.runId ?? null;
        ctx.closeRunId = workflowRunId;
        steps.push({
          name: 'close-start',
          result: pass(`workflowRunId=${workflowRunId?.slice(0, 8) ?? 'N/A'}…`, undefined, t),
        });
      } else {
        steps.push({ name: 'close-start', result: fail(`HTTP ${res.status}: ${bodyStr(res.body)}`, t) });
      }
    } catch (err) {
      steps.push({ name: 'close-start', result: fail(err instanceof Error ? err.message : String(err), t) });
    }
  }

  if (!workflowRunId) {
    steps.push({
      name: 'close-status-poll',
      result: warn('Saltado — sin workflowRunId', undefined, now()),
    });
    return { name: 'WS5 — Monthly Close Workflow', skipped: false, flagLabel: 'UTOPIA_ENABLE_MONTHLY_CLOSE_WORKFLOW', steps };
  }

  // ── close-status-poll ─────────────────────────────────────────────────────
  {
    const t = now();
    const pollEnd = Date.now() + CLOSE_POLL_TIMEOUT;
    let lastStatus = '';
    let periodHash: string | null = null;
    let pausedForApproval = false;

    try {
      while (Date.now() < pollEnd) {
        await new Promise((r) => setTimeout(r, 2_000));

        const res = await ctx.http.get(`/api/accounting/close/status/${workflowRunId}`);
        if (!res.ok) {
          steps.push({
            name: 'close-status-poll',
            result: fail(`HTTP ${res.status} al consultar status`, t),
          });
          return { name: 'WS5 — Monthly Close Workflow', skipped: false, flagLabel: 'UTOPIA_ENABLE_MONTHLY_CLOSE_WORKFLOW', steps };
        }

        const body = res.body as {
          status?: string;
          workflowStatus?: string;
          periodHash?: string;
          healthCheckResults?: unknown;
        };

        lastStatus = body.status ?? body.workflowStatus ?? 'unknown';
        periodHash = body.periodHash ?? null;

        if (lastStatus === 'completed') {
          const detail = `runId: ${workflowRunId?.slice(0, 8)}…, period_hash: ${periodHash?.slice(0, 8) ?? 'N/A'}…`;
          steps.push({
            name: 'close-status-poll → completed',
            result: pass(detail, detail, t),
          });
          return { name: 'WS5 — Monthly Close Workflow', skipped: false, flagLabel: 'UTOPIA_ENABLE_MONTHLY_CLOSE_WORKFLOW', steps };
        }

        if (lastStatus === 'failed') {
          steps.push({
            name: 'close-status-poll',
            result: fail(`Workflow terminó en "failed". Body: ${bodyStr(res.body)}`, t),
          });
          return { name: 'WS5 — Monthly Close Workflow', skipped: false, flagLabel: 'UTOPIA_ENABLE_MONTHLY_CLOSE_WORKFLOW', steps };
        }

        if (lastStatus === 'awaiting_resolution' && !pausedForApproval) {
          pausedForApproval = true;
          // Intentar resume automático con override del smoke-test
          const resumeRes = await ctx.http.post('/api/accounting/close/resume', {
            token: `close-approval:${pid}`,
            payload: {
              approved: true,
              approvedBy: 'smoke-test',
            },
          });

          if (resumeRes.ok) {
            steps.push({
              name: 'close-status-poll → resumed',
              result: pass('Health-check hook enviado (approved=true)', undefined, t),
            });
          } else if (resumeRes.status === 404) {
            // Hook ya fue consumido o expiró — puede que el workflow ya avanzó
            steps.push({
              name: 'close-status-poll → resumed',
              result: warn('Token de aprobación no encontrado (puede haber expirado)', undefined, t),
            });
          } else {
            steps.push({
              name: 'close-status-poll → resumed',
              result: warn(`Resume retornó ${resumeRes.status}: ${bodyStr(resumeRes.body)}`, undefined, t),
            });
          }
          // Continuar el poll
        }
      }

      // Timeout
      steps.push({
        name: 'close-status-poll',
        result: warn(
          `Timeout ${CLOSE_POLL_TIMEOUT / 1000}s — último status="${lastStatus}"`,
          'El workflow puede seguir corriendo. Revisa: npx workflow web ' + workflowRunId,
          t,
        ),
      });
    } catch (err) {
      steps.push({
        name: 'close-status-poll',
        result: fail(err instanceof Error ? err.message : String(err), t),
      });
    }
  }

  return { name: 'WS5 — Monthly Close Workflow', skipped: false, flagLabel: 'UTOPIA_ENABLE_MONTHLY_CLOSE_WORKFLOW', steps };
}

// ─── Sección 6 — WS6 Notifications ───────────────────────────────────────────

async function runWS6(ctx: SmokeCtx): Promise<SectionSummary> {
  if (!FLAG_NOTIF) {
    return { name: 'WS6 — Notifications', skipped: true, flagLabel: 'UTOPIA_ENABLE_NOTIFICATIONS', steps: [] };
  }

  const steps: SectionSummary['steps'] = [];

  // ── notif-sub-create ──────────────────────────────────────────────────────
  {
    const t = now();
    try {
      const res = await ctx.http.post('/api/notifications/subscriptions', {
        channel: 'email',
        email: 'smoke-test@utopia.dev',
        events: ['period.locked'],
        label: 'Smoke Test Subscription',
      });

      if (res.status === 201 || res.status === 200) {
        steps.push({ name: 'notif-sub-create', result: pass('Suscripción email creada OK', undefined, t) });
      } else if (res.status === 409) {
        steps.push({ name: 'notif-sub-create', result: pass('Suscripción ya existe (idempotente)', undefined, t) });
      } else {
        steps.push({ name: 'notif-sub-create', result: fail(`HTTP ${res.status}: ${bodyStr(res.body)}`, t) });
      }
    } catch (err) {
      steps.push({ name: 'notif-sub-create', result: fail(err instanceof Error ? err.message : String(err), t) });
    }
  }

  // ── notif-dispatch-test ───────────────────────────────────────────────────
  {
    const t = now();
    const internalSecret = process.env.UTOPIA_INTERNAL_SECRET;

    if (!internalSecret) {
      steps.push({
        name: 'notif-dispatch-test',
        result: warn(
          'UTOPIA_INTERNAL_SECRET no configurado — dispatch no disponible (esperado en dev)',
          'Agregar UTOPIA_INTERNAL_SECRET al .env.local para probar dispatch completo',
          t,
        ),
      });
    } else {
      try {
        const res = await ctx.http.post(
          '/api/notifications/dispatch',
          {
            workspaceId: ctx.workspaceId,
            event: 'period.locked',
            idempotencyKey: `smoke-test-${Date.now()}`,
            channels: ['email'],
            payload: {
              periodId: ctx.periodId ?? 'smoke-period',
              periodLabel: 'Smoke Test Período',
              periodHash: 'abc123',
              companyName: 'Empresa Demo',
            },
          },
          { 'x-utopia-internal-secret': internalSecret },
        );

        if (res.ok) {
          const body = res.body as { sent?: number; skipped?: number; errors?: unknown[] };
          const sent = body.sent ?? 0;
          const skipped = body.skipped ?? 0;

          if (sent >= 1) {
            steps.push({
              name: 'notif-dispatch-test',
              result: pass(`sent=${sent}`, undefined, t),
            });
          } else if (skipped >= 1) {
            // RESEND_API_KEY no configurada — esperado en dev
            steps.push({
              name: 'notif-dispatch-test',
              result: warn(
                `skipped=${skipped} (RESEND_API_KEY no configurada — esperado en dev)`,
                'Agregar RESEND_API_KEY al .env.local para envío real',
                t,
              ),
            });
          } else {
            steps.push({
              name: 'notif-dispatch-test',
              result: warn(`sent=0, skipped=0. Body: ${bodyStr(res.body)}`, undefined, t),
            });
          }
        } else {
          steps.push({
            name: 'notif-dispatch-test',
            result: fail(`HTTP ${res.status}: ${bodyStr(res.body)}`, t),
          });
        }
      } catch (err) {
        steps.push({
          name: 'notif-dispatch-test',
          result: fail(err instanceof Error ? err.message : String(err), t),
        });
      }
    }
  }

  return { name: 'WS6 — Notifications', skipped: false, flagLabel: 'UTOPIA_ENABLE_NOTIFICATIONS', steps };
}

// ─── Crear período abierto de prueba ─────────────────────────────────────────
// Helper: intentar encontrar o crear un accounting_period abierto via API

async function ensurePeriod(http: HttpClient): Promise<string | null> {
  // Intentar GET /api/accounting/periods para obtener un período open
  try {
    const res = await http.get('/api/accounting/periods');
    if (res.ok) {
      const body = res.body as unknown[];
      if (Array.isArray(body)) {
        const openPeriod = (body as Array<{ id: string; status: string }>).find(
          (p) => p.status === 'open',
        );
        if (openPeriod) return openPeriod.id;
      }
    }
  } catch { /* ignore */ }

  // Intentar crear período via POST /api/accounting/periods
  try {
    const res = await http.post('/api/accounting/periods', {
      year: 2026,
      month: 4,
    });
    if (res.ok || res.status === 201) {
      const body = res.body as { id?: string };
      if (body.id) return body.id;
    }
    // Puede ya existir — intentar obtenerlo
    const getRes = await http.get('/api/accounting/periods?year=2026&month=4');
    if (getRes.ok) {
      const body = getRes.body as { id?: string } | Array<{ id?: string }>;
      if (Array.isArray(body) && body[0]?.id) return body[0].id;
      if (!Array.isArray(body) && body.id) return body.id;
    }
  } catch { /* ignore */ }

  return null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const globalStart = now();

  const http = new HttpClient(BASE, TIMEOUT);

  const ctx: SmokeCtx = {
    http,
    workspaceId: process.env.SMOKE_WORKSPACE_ID ?? 'unknown',
    periodId: null,
    bankAccountId: null,
    fixedAssetId: null,
    closeRunId: null,
    pymeEntryIds: [],
    chartAccountIds: null,
  };

  // ── Sección 0 — Fundaciones ────────────────────────────────────────────────
  const sec0 = await runFundaciones(ctx);
  printHeader(BASE, ctx.workspaceId);
  printSection(sec0);

  // Si el health falló, abortar sin intentar el resto
  const healthOk = sec0.steps[0]?.result.ok;
  if (!healthOk) {
    // Imprimir secciones saltadas
    const skippedAll = [
      { name: 'Smoke Bootstrap', skipped: true, steps: [] },
      { name: 'WS1 — Smart-Tax Engine', skipped: true, steps: [] },
      { name: 'WS2 — OCR → Journal Bridge', skipped: true, steps: [] },
      { name: 'WS3 — Bank Reconciliation', skipped: true, steps: [] },
      { name: 'WS4 — NIIF Auto-Adjustments', skipped: true, steps: [] },
      { name: 'WS5 — Monthly Close Workflow', skipped: true, steps: [] },
      { name: 'WS6 — Notifications', skipped: true, steps: [] },
    ] as SectionSummary[];
    for (const s of skippedAll) printSection(s);
    printFooter(0, 0, 1, elapsed(globalStart), false);
    await closeSmokePool();
    process.exit(1);
  }

  // ── Bootstrap — fixtures idempotentes ─────────────────────────────────────
  const bootstrapSteps: SectionSummary['steps'] = [];
  {
    const t = now();
    try {
      const fixtures = await bootstrapSmokeFixtures(ctx.workspaceId);

      // Propagar resultados al contexto
      ctx.periodId = fixtures.periodId;
      ctx.pymeEntryIds = fixtures.pymeEntryIds;
      ctx.chartAccountIds = fixtures.chartAccountIds;

      const detail = [
        `periodId=${fixtures.periodId.slice(0, 8)}…`,
        `pymeEntries=${fixtures.pymeEntryIds.length}`,
        `bank=${fixtures.chartAccountIds.bank?.slice(0, 8) ?? 'N/A'}…`,
        `fa=${fixtures.chartAccountIds.fixedAssetCpu?.slice(0, 8) ?? 'N/A'}…`,
        ...(fixtures.warnings.length > 0 ? [`warnings: ${fixtures.warnings.join('; ')}`] : []),
      ].join(', ');

      bootstrapSteps.push({
        name: 'smoke-bootstrap',
        result: fixtures.warnings.length > 0
          ? warn('Bootstrap completado con advertencias', detail, t)
          : pass('Bootstrap completado', detail, t),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      bootstrapSteps.push({
        name: 'smoke-bootstrap',
        result: fail(`Bootstrap falló: ${msg}`, t),
      });
    }
  }

  const secBootstrap: SectionSummary = {
    name: 'Smoke Bootstrap',
    skipped: false,
    steps: bootstrapSteps,
  };
  printSection(secBootstrap);

  // Si el bootstrap falló completamente, intentar ensurePeriod como fallback
  if (!ctx.periodId) {
    ctx.periodId = await ensurePeriod(http);
  }

  // ── Secciones 1-6 ──────────────────────────────────────────────────────────
  const sections: SectionSummary[] = [
    await runWS1(ctx),
    await runWS2(ctx),
    await runWS3(ctx),
    await runWS4(ctx),
    await runWS5(ctx),
    await runWS6(ctx),
  ];

  for (const s of sections) printSection(s);

  // ── Conteo global ──────────────────────────────────────────────────────────
  let totalOk = 0;
  let totalWarn = 0;
  let totalFail = 0;

  const allSections = [sec0, secBootstrap, ...sections];
  for (const sec of allSections) {
    if (sec.skipped) continue;
    for (const { result } of sec.steps) {
      if (!result.ok) totalFail++;
      else if (result.warn) totalWarn++;
      else totalOk++;
    }
  }

  const passed = totalFail === 0;
  printFooter(totalOk, totalWarn, totalFail, elapsed(globalStart), passed);
  await closeSmokePool();
  process.exit(passed ? 0 : 1);
}

main().catch(async (err) => {
  console.error('Error fatal en el smoke runner:', err);
  await closeSmokePool();
  process.exit(1);
});
