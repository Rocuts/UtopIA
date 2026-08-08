// ---------------------------------------------------------------------------
// Handoff /strategy y /governance — el body del cliente NO es autoritativo
// ---------------------------------------------------------------------------
// POR QUE ESTE TEST EXISTE (modo de fallo real):
// `/api/financial-report/{strategy,governance}` son stateless: el navegador
// reenvia el output de la fase anterior. Mientras `niifResult` /
// `strategyResult` se validaran con `z.object({ fullContent }).passthrough()`,
// CUALQUIER clave extra que mandara el cliente sobrevivia el parseo y llegaba
// al servidor, que la trataba como si la hubiera producido el pipeline.
//
// Dos consecuencias concretas:
//   1. Campos que el servidor NO produce en esta fase (`reconciliation`,
//      `json`) llegaban al handler indistinguibles de los que si produce el
//      pipeline. Hoy ninguna fase los lee; el riesgo es la fase de mañana que
//      empiece a leerlos creyendolos autoritativos.
//   2. `fullContent` y `bindingTotals` viajan CRUDOS al prompt del agente. Sin
//      cota de longitud, el handoff es un canal de prompt-stuffing ilimitado
//      (y de gasto de tokens ilimitado).
//
// ALCANCE (no inflar el titulo): esto NO vuelve autoritativo el sello "REPORTE
// CON SALVEDADES". El sello lo estampa `runNiifPhase` dentro de `fullContent`,
// que se conserva verbatim, y el bloqueo de descarga se decide en el navegador
// sobre su propio estado. Ver la nota en `src/lib/validation/schemas.ts`.
//
// El contrato que este test fija: shape explicito -> Zod ELIMINA lo desconocido,
// y todo string que llegue al prompt tiene techo.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  strategyPhaseRequestSchema,
  governancePhaseRequestSchema,
} from '../schemas';

const company = {
  name: 'Comercializadora Andina SAS',
  nit: '900123456',
  fiscalPeriod: '2025',
};

function strategyBody(extra: Record<string, unknown> = {}) {
  return {
    niifResult: {
      fullContent: '# Estados financieros NIIF\n\nActivo total: $1.000.000',
      balanceSheet: '## ESF',
      incomeStatement: '## ERI',
      cashFlowStatement: '## EFE',
      equityChangesStatement: '## ECP',
      technicalNotes: '## Notas',
      ...extra,
    },
    bindingTotals: '### TOTALES VINCULANTES\nActivo: 100000000',
    company,
  };
}

describe('strategyPhaseRequestSchema — handoff endurecido', () => {
  it('descarta claves desconocidas inyectadas por el cliente en niifResult', () => {
    const parsed = strategyPhaseRequestSchema.parse(
      strategyBody({ __inyectado: 'payload del atacante' }),
    );
    expect(parsed.niifResult).not.toHaveProperty('__inyectado');
  });

  it('descarta un veredicto de reconciliacion forjado por el cliente', () => {
    // `reconciliation` es un veredicto que produce el servidor en la fase 1.
    // Ninguna fase posterior lo lee hoy; el punto es que no pueda empezar a
    // leerse mañana con un valor que puso el navegador.
    const parsed = strategyPhaseRequestSchema.parse(
      strategyBody({ reconciliation: { clean: true, findings: [] } }),
    );
    expect(parsed.niifResult).not.toHaveProperty('reconciliation');
  });

  it('descarta un bloque `json` forjado (las cifras las deriva el servidor)', () => {
    const parsed = strategyPhaseRequestSchema.parse(
      strategyBody({ json: { balance: { activo_total_centavos: '999999999999' } } }),
    );
    expect(parsed.niifResult).not.toHaveProperty('json');
  });

  it('rechaza un fullContent sin techo (prompt-stuffing via handoff)', () => {
    const res = strategyPhaseRequestSchema.safeParse(
      strategyBody({ fullContent: 'A'.repeat(500_001) }),
    );
    expect(res.success).toBe(false);
  });

  it('rechaza bindingTotals sin techo', () => {
    const res = strategyPhaseRequestSchema.safeParse({
      ...strategyBody(),
      bindingTotals: 'B'.repeat(200_001),
    });
    expect(res.success).toBe(false);
  });

  it('sigue aceptando el handoff legitimo que emite /niif', () => {
    const res = strategyPhaseRequestSchema.safeParse(strategyBody());
    expect(res.success).toBe(true);
    expect(res.data?.niifResult.fullContent).toContain('Activo total');
  });
});

describe('governancePhaseRequestSchema — handoff endurecido', () => {
  function governanceBody(strategyExtra: Record<string, unknown> = {}) {
    return {
      ...strategyBody(),
      strategyResult: {
        fullContent: '# Analisis estrategico',
        kpiDashboard: '## KPIs',
        breakEvenAnalysis: '## Punto de equilibrio',
        projectedCashFlow: '## Flujo proyectado',
        strategicRecommendations: '## Recomendaciones',
        ...strategyExtra,
      },
    };
  }

  it('descarta claves desconocidas en strategyResult', () => {
    const parsed = governancePhaseRequestSchema.parse(
      governanceBody({ __inyectado: 'payload del atacante' }),
    );
    expect(parsed.strategyResult).not.toHaveProperty('__inyectado');
  });

  it('descarta un bloque `json` forjado en strategyResult', () => {
    const parsed = governancePhaseRequestSchema.parse(
      governanceBody({ json: { kpis: { roa: 9.9 } } }),
    );
    expect(parsed.strategyResult).not.toHaveProperty('json');
  });

  it('sigue aceptando el handoff legitimo de /strategy', () => {
    const res = governancePhaseRequestSchema.safeParse(governanceBody());
    expect(res.success).toBe(true);
  });
});
