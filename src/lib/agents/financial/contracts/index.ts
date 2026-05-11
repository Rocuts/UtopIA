// ---------------------------------------------------------------------------
// Barrel de contratos JSON-strict para los pipelines financieros (GPT-5.4)
// ---------------------------------------------------------------------------
// Cada pipeline tiene su schema Zod en un archivo dedicado. Los building
// blocks comunes viven en `base.ts`. Los helpers de centavos en `money.ts`.
//
// Los pipelines restantes (audit, quality, tax-planning, tax-reconciliation,
// transfer-pricing, valuation, fiscal-opinion, feasibility, escudo-survival)
// añaden sus schemas en sus respectivas Fases 2.B–E.
// ---------------------------------------------------------------------------

export * from './base';
export * from './money';
export * from './niif-report';
