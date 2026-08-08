/**
 * Regresión — el contexto de telemetría llega desde el route handler hasta el
 * fondo del pipeline (Equipo B, 2026-08).
 *
 * QUÉ SE ROMPÍA
 * `persistAgentTelemetry` resolvía el tenant leyendo `cookies()` como último
 * recurso. Esa lectura ocurre dentro del callback de la `ReadableStream` SSE
 * (y bajo `waitUntil`), donde Next ya no expone el scope del request: `cookies()`
 * lanza, el workspaceId sale `null` y la fila se DESCARTABA. Medido en runtime
 * con el pipeline real:
 *
 *   [persistAgentTelemetry] sin workspaceId para "niif-analyst-pass1" — fila omitida.
 *
 * Resultado: `agent_telemetry` vacía y las alertas de docs/TELEMETRY.md
 * evaluándose sobre cero filas.
 *
 * CÓMO SE REPRODUCE AQUÍ
 * El mock de `@/lib/db/workspace` simula el ciclo de vida real: `getCurrentWorkspaceId()`
 * responde mientras el handler está en el scope del request y LANZA en cuanto el
 * pipeline pasa al callback del stream (`scope.open = false`). Con el código
 * viejo (sin `runWithTelemetryContext` en el route) no queda ninguna vía para
 * conocer el tenant y no se inserta nada; con el cableado nuevo el
 * AsyncLocalStorage abierto en el handler viaja con las continuaciones async.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const REPORT = '33333333-3333-4333-8333-333333333333';

// ---------------------------------------------------------------------------
// Estado compartido de los mocks
// ---------------------------------------------------------------------------

/**
 * `open` modela el scope de request de Next; `workspaceId` lo que devolvería la
 * cookie/sesión mientras ese scope existe.
 */
const scope = vi.hoisted(() => ({ open: true, workspaceId: null as string | null }));

const dbState = vi.hoisted(() => ({
  inserted: [] as Record<string, unknown>[],
  /** Filas que devuelve el `select` de `reports` (validación de propiedad). */
  ownedReports: [] as { id: string }[],
}));

vi.mock('@/lib/db/workspace', () => ({
  getCurrentWorkspaceId: async () => {
    if (!scope.open) {
      // Mismo mensaje que produce Next al llamar `cookies()` fuera de request.
      throw new Error('`cookies` was called outside a request scope.');
    }
    return scope.workspaceId;
  },
}));

vi.mock('@/lib/db/client', () => ({
  getDb: () => ({
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        dbState.inserted.push(row);
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => dbState.ownedReports }),
      }),
    }),
  }),
}));

// La bitácora de actividad comparte `getDb` — sin mockearla, sus inserts
// contaminarían las aserciones sobre `dbState.inserted`.
vi.mock('@/lib/db/activity-log', () => ({ logActivity: vi.fn() }));

vi.mock('@/lib/facts/report-facts', () => ({
  getHechosEmpresaBlock: async () => '',
}));

vi.mock('@/lib/preprocessing/trial-balance', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/preprocessing/trial-balance')>();
  return { ...original, parseTrialBalanceCSV: () => [], preprocessTrialBalance: () => undefined };
});

vi.mock('@/lib/agents/utils/gateway-errors', () => ({
  toFriendlyError: () => ({ message: 'Error de prueba.', code: 'pipeline_validation_failed' }),
}));

// ---------------------------------------------------------------------------
// Pipeline simulado — cada fase emite UNA medición desde donde la emitiría
// `callFinancialAgent`: ya fuera del scope de request y tras un await.
// ---------------------------------------------------------------------------

async function emitirTelemetriaDelAgente(agentName: string): Promise<void> {
  // A partir de aquí corre el callback del stream / la tarea de `waitUntil`.
  scope.open = false;
  // Continuación async: es justo lo que un `AsyncLocalStorage` debe atravesar.
  await new Promise((r) => setTimeout(r, 1));
  const { persistAgentTelemetry } = await import('@/lib/db/telemetry');
  await persistAgentTelemetry({
    agentName,
    modelId: 'gpt-5.6-sol',
    inputTokens: 1000,
    outputTokens: 200,
    elapsedMs: 1234,
    finishReason: 'stop',
    fallbackUsed: false,
  });
}

const MOCK_NIIF = {
  balanceSheet: '## Balance',
  incomeStatement: '## P&L',
  cashFlowStatement: '## EFE',
  equityChangesStatement: '## ECP',
  technicalNotes: 'Notas. Art. 647 E.T.',
  fullContent: '## Reporte NIIF\nActivo = Pasivo + Patrimonio.',
};

const MOCK_CONTEXT = {
  bindingTotalsBlock: '## TOTALES VINCULANTES',
  ppForAgents: undefined,
  effectiveCompany: { name: 'Empresa Test SAS', nit: '900123456-1', fiscalPeriod: '2025' },
};

vi.mock('@/lib/agents/financial/orchestrator', () => ({
  BalanceValidationError: class BalanceValidationError extends Error {},
  runNiifPhase: async () => {
    await emitirTelemetriaDelAgente('niif-analyst-pass1');
    return { niif: MOCK_NIIF, context: MOCK_CONTEXT };
  },
  runStrategyPhase: async () => {
    await emitirTelemetriaDelAgente('strategy-director');
    return { fullContent: '## Estrategia' };
  },
  runGovernancePhase: async () => {
    await emitirTelemetriaDelAgente('governance-specialist');
    return { fullContent: '## Gobierno' };
  },
}));

vi.mock('@/lib/agents/financial/agents/html-editor', () => ({
  runHtmlEditor: async () => {
    await emitirTelemetriaDelAgente('html-editor');
    return {
      html: '<html></html>',
      emittable: true,
      checklistFailures: [],
      metadata: { entityNit: '900123456-1', periodEnd: '2025-12-31' },
    };
  },
}));

vi.mock('@/lib/agents/financial/contracts/html-editor', () => ({
  HtmlEditorInputSchema: {
    safeParse: (body: Record<string, unknown>) => ({ success: true, data: body }),
  },
}));

// ---------------------------------------------------------------------------
// Handlers — importados DESPUÉS de los mocks
// ---------------------------------------------------------------------------

const { POST: postNiif } = await import('../niif/route.js');
const { POST: postStrategy } = await import('../strategy/route.js');
const { POST: postGovernance } = await import('../governance/route.js');
const { POST: postHtml } = await import('../html/route.js');
const { getOrphanTelemetryRows, __resetTelemetryLogDedupeForTests } = await import(
  '@/lib/db/telemetry'
);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const COMPANY = { name: 'Empresa Test SAS', nit: '900123456-1', fiscalPeriod: '2025' };
const NIIF_RESULT = { ...MOCK_NIIF };
const BINDING = '## TOTALES VINCULANTES\nActivo: $1.000.000';

function sse(url: string, body: unknown): Request {
  return new Request(`http://localhost/api/financial-report/${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-stream': 'true' },
    body: JSON.stringify(body),
  });
}

const RUTAS = [
  {
    nombre: 'niif',
    agente: 'niif-analyst-pass1',
    post: postNiif,
    body: (extra: Record<string, unknown> = {}) => ({
      rawData: 'cuenta,debito,credito\n1105,1000000,0',
      company: COMPANY,
      language: 'es',
      ...extra,
    }),
  },
  {
    nombre: 'strategy',
    agente: 'strategy-director',
    post: postStrategy,
    body: (extra: Record<string, unknown> = {}) => ({
      niifResult: NIIF_RESULT,
      bindingTotals: BINDING,
      company: COMPANY,
      language: 'es',
      ...extra,
    }),
  },
  {
    nombre: 'governance',
    agente: 'governance-specialist',
    post: postGovernance,
    body: (extra: Record<string, unknown> = {}) => ({
      niifResult: NIIF_RESULT,
      strategyResult: { fullContent: '## Estrategia' },
      bindingTotals: BINDING,
      company: COMPANY,
      language: 'es',
      ...extra,
    }),
  },
  {
    nombre: 'html',
    agente: 'html-editor',
    post: postHtml,
    body: (extra: Record<string, unknown> = {}) => ({
      niifReport: NIIF_RESULT,
      strategyReport: { fullContent: '## Estrategia' },
      governanceReport: { fullContent: '## Gobierno' },
      metadata: { entityNit: '900123456-1' },
      company: COMPANY,
      language: 'es',
      ...extra,
    }),
  },
] as const;

// ---------------------------------------------------------------------------

beforeEach(() => {
  scope.open = true;
  scope.workspaceId = WORKSPACE;
  dbState.inserted.length = 0;
  dbState.ownedReports.length = 0;
  __resetTelemetryLogDedupeForTests();
  process.env.DATABASE_URL = 'postgres://fake/fake';
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.DATABASE_URL;
  vi.restoreAllMocks();
});

describe('contexto de telemetría en los 4 endpoints del pipeline financiero', () => {
  it.each(RUTAS)(
    '/$nombre persiste la medición con el workspaceId aunque el stream SSE ya no vea la cookie',
    async ({ post, body, agente }) => {
      const res = await post(sse('x', body()));
      expect(res.status).toBe(200);
      await res.text(); // drena el stream — el pipeline corre dentro de `start`

      expect(dbState.inserted).toHaveLength(1);
      expect(dbState.inserted[0]!.workspaceId).toBe(WORKSPACE);
      expect(dbState.inserted[0]!.agentName).toBe(agente);
      // Y no quedó ninguna medición huérfana.
      expect(getOrphanTelemetryRows()).toHaveLength(0);
    },
  );

  it('/niif propaga el reportId del body cuando pertenece al workspace', async () => {
    dbState.ownedReports.push({ id: REPORT });

    const res = await postNiif(sse('niif', RUTAS[0].body({ reportId: REPORT })));
    await res.text();

    expect(dbState.inserted).toHaveLength(1);
    expect(dbState.inserted[0]!.reportId).toBe(REPORT);
  });

  it('/niif descarta un reportId ajeno al workspace en vez de arriesgar la FK', async () => {
    // `select` no devuelve nada => el reporte no es de este tenant (o no existe).
    // Si se propagara igual, el INSERT moriría por violación de FK y se
    // perderían TODAS las mediciones de la corrida.
    const res = await postNiif(
      sse('niif', RUTAS[0].body({ reportId: '44444444-4444-4444-8444-444444444444' })),
    );
    await res.text();

    expect(dbState.inserted).toHaveLength(1);
    expect(dbState.inserted[0]!.reportId).toBeNull();
  });

  it('sin tenant la medición se registra DEGRADADA, no se descarta', async () => {
    scope.workspaceId = null;

    const res = await postNiif(sse('niif', RUTAS[0].body()));
    await res.text();

    expect(dbState.inserted).toHaveLength(0);
    const huerfanas = getOrphanTelemetryRows();
    expect(huerfanas).toHaveLength(1);
    expect(huerfanas[0]!.reason).toBe('sin-workspace');
    expect(huerfanas[0]!.row.agentName).toBe('niif-analyst-pass1');
    // El costo/elapsed sobreviven: la medición existe aunque no tenga tenant.
    expect(huerfanas[0]!.row.elapsedMs).toBe(1234);
  });

  it('una cookie de workspace con formato inválido no llega al INSERT', async () => {
    // `getCurrentWorkspaceId()` devuelve la cookie tal cual en el camino
    // anónimo (src/lib/db/workspace.ts:155; `requireWorkspace()` sí valida
    // contra `UUID_V4_RE` en la 159). Sin el filtro de `persistAgentTelemetry`,
    // ese valor llegaría al INSERT y Postgres abortaría con `invalid input
    // syntax for type uuid`: la medición se perdería con un error opaco en vez
    // de quedar registrada como huérfana.
    scope.workspaceId = 'no-es-un-uuid';

    const res = await postNiif(sse('niif', RUTAS[0].body()));
    await res.text();

    expect(dbState.inserted).toHaveLength(0);
    expect(getOrphanTelemetryRows()).toHaveLength(1);
    expect(getOrphanTelemetryRows()[0]!.row.agentName).toBe('niif-analyst-pass1');
    // Y la razón debe DISTINGUIR el modo de fallo: una cookie corrupta no es lo
    // mismo que un route handler sin contexto. Si el route filtrara el uuid
    // antes de meterlo en el contexto, `persistAgentTelemetry` ya no vería el
    // valor malo, caería al fallback de cookie (que dentro del stream SSE
    // lanza) y registraría `sin-workspace`: el operador buscaría un cableado
    // roto en vez de una cookie corrupta, que es el bug real.
    expect(getOrphanTelemetryRows()[0]!.reason).toBe('workspace-no-uuid');
  });
});
