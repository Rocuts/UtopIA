/**
 * Vercel project configuration (Ola 0.F migration).
 *
 * This file REPLACES vercel.json. The two cannot coexist — Vercel chooses
 * one and ignores the other. See:
 *   https://vercel.com/docs/project-configuration/vercel-ts
 *
 * Why migrate:
 *  - Type-checked config (catches typos in cron paths, function globs, etc.).
 *  - Per-route maxDuration becomes self-documenting and version-controlled.
 *  - We can compute config dynamically from environment vars later (e.g.
 *    different cron schedules per environment).
 */

import { type VercelConfig } from '@vercel/config/v1';

export const config: VercelConfig = {
  framework: 'nextjs',

  // Fluid Compute is enabled by default for new projects (since April 2025).
  // We declare it explicitly so the intent is reviewable and so a project
  // recreate doesn't silently fall back to legacy serverless.
  fluid: true,

  // Per-function configuration. Keys are globs relative to repo root.
  //
  // maxDuration rationale:
  //   300s — multi-agent LLM pipelines (financial / audit / planning) that
  //          fan out to several gpt-4o-mini calls and stream SSE.
  //   120s — single-agent LLM calls (quality, repair-chat) and OCR pipelines
  //          (upload, pyme uploads) where gpt-4o vision can run long on
  //          dense scanned PDFs.
  //   default (Pro plan) — everything else. CRUD / cron / lightweight
  //          orchestrations don't need an override.
  //
  // memory is intentionally NOT set here. With Fluid Compute enabled,
  // memory must be configured in the project dashboard (vercel.ts memory
  // settings are ignored when fluid: true).
  functions: {
    // Multi-agent financial / advisory pipelines (sequential or parallel
    // chains of generateText calls).
    'src/app/api/financial-report/route.ts': { maxDuration: 300 },
    'src/app/api/financial-report/export/route.ts': { maxDuration: 300 },
    'src/app/api/financial-audit/route.ts': { maxDuration: 300 },
    'src/app/api/tax-planning/route.ts': { maxDuration: 300 },
    'src/app/api/transfer-pricing/route.ts': { maxDuration: 300 },
    'src/app/api/business-valuation/route.ts': { maxDuration: 300 },
    'src/app/api/fiscal-audit-opinion/route.ts': { maxDuration: 300 },
    'src/app/api/tax-reconciliation/route.ts': { maxDuration: 300 },
    'src/app/api/feasibility-study/route.ts': { maxDuration: 300 },

    // Single-agent meta auditors and repair / debug flows.
    'src/app/api/financial-quality/route.ts': { maxDuration: 120 },
    'src/app/api/repair-chat/route.ts': { maxDuration: 120 },

    // OCR / document ingestion (gpt-4o vision is the slow path).
    'src/app/api/upload/route.ts': { maxDuration: 120 },
    'src/app/api/pyme/uploads/route.ts': { maxDuration: 120 },
    'src/app/api/pyme/reports/monthly/route.ts': { maxDuration: 120 },

    // Future Ola 1 (núcleo contable). Listed pre-emptively so when the
    // route ships it already has an explicit budget.
    'src/app/api/accounting/opening-balance/route.ts': { maxDuration: 120 },
  },

  // Cron jobs (production deployment only). Migrated verbatim from the
  // previous vercel.json. Endpoints under /api/cron/* are exempted from
  // the proxy CSRF check (see src/proxy.ts CSRF_ALLOWLIST).
  crons: [
    { path: '/api/cron/calendar-sync', schedule: '0 11 * * *' },
  ],
};
