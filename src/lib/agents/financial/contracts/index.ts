// ---------------------------------------------------------------------------
// Barrel de contratos JSON-strict para los pipelines financieros (GPT-5.4)
// ---------------------------------------------------------------------------
// Cada pipeline tiene su schema Zod en un archivo dedicado. Los building
// blocks comunes viven en `base.ts`. Los helpers de centavos en `money.ts`.
//
// Consolidado tras Fase 2 (refactor outcome-first GPT-5.4) — los 10 pipelines
// del módulo financiero exponen sus contratos a través de este barrel.
// ---------------------------------------------------------------------------

// -- Building blocks ---------------------------------------------------------
export * from './base';
export * from './money';

// -- Pipeline financiero base (NIIF -> Strategy -> Governance) ---------------
export * from './niif-report';
export * from './strategy-report';
export * from './governance-report';

// -- Auditoría especializada + meta-auditoría de calidad ---------------------
export * from './audit-report';
export * from './quality-report';

// -- Tax planning + reconciliación contable-fiscal ---------------------------
export * from './tax-planning';
export * from './tax-reconciliation';

// -- Transfer pricing + valoración -------------------------------------------
export * from './transfer-pricing';
export * from './valuation';

// -- Dictamen fiscal + estudio de factibilidad + escudo de supervivencia -----
export * from './fiscal-opinion';
export * from './feasibility';
export * from './escudo-survival';
