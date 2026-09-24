// ratios-kpis-08 — El correo de cierre enviaba los 4 KPIs de pilares como 0
// literales ('Provisión Impuestos 0', 'EBITDA 0', 'Docs Verificados 0.0%',
// 'Free Cash Flow 0'). Además el puerto se cargaba con
// `import(/* webpackIgnore: true */ '@/lib/notifications')`, que en runtime
// no resuelve el alias '@/': el correo no salía (vitest sí lo resuelve).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dispatch = vi.hoisted(() => vi.fn(async () => ({ sent: 1 })));
const docsPct = vi.hoisted(() => ({ value: 87 as number | null }));

vi.mock('@/lib/notifications', () => ({ notificationsPort: { dispatch } }));
vi.mock('../repository', () => ({
  getPeriodById: vi.fn(async () => ({ id: 'p1', year: 2026, month: 8 })),
  getWorkspaceName: vi.fn(async () => 'Empresa Demo'),
}));
vi.mock('@/lib/db/client', () => ({ getDb: () => ({}) }));
vi.mock('@/lib/kpis/pillar-view', () => ({
  queryDocumentsVerifiedPct: vi.fn(async () => docsPct.value),
}));

import { sendLockNotification } from '../steps/notify';

const input = {
  workspaceId: 'ws',
  periodId: 'p1',
  runId: 'r1',
  hash: 'h',
  withWarnings: false,
  pdfUrl: null,
} as unknown as Parameters<typeof sendLockNotification>[0];

beforeEach(() => {
  dispatch.mockClear();
  process.env.UTOPIA_ENABLE_NOTIFICATIONS = 'true';
});

describe('correo de cierre — KPIs de pilares', () => {
  it('no envía ceros: montos sin base verificada van como N/D y % documentos real', async () => {
    docsPct.value = 87;
    const res = await sendLockNotification(input);
    expect(res.sent).toBe(true);
    const payload = (dispatch.mock.calls[0] as unknown as [{ payload: { pillars: Record<string, Record<string, unknown>> } }])[0].payload;
    expect(payload.pillars.resiliencia.totalProvisionTaxesCop).toBe('N/D');
    expect(payload.pillars.valor.ebitdaCop).toBe('N/D');
    expect(payload.pillars.futuro.freeCashFlowProjectedCop).toBe('N/D');
    expect(payload.pillars.verdad.documentsVerifiedPct).toBe(87);
    expect(JSON.stringify(payload.pillars)).not.toMatch(/"0"|:0[,}]/);
  });

  it('sin documentos verificables no inventa 0 %: omite el envío y lo explica', async () => {
    docsPct.value = null;
    const res = await sendLockNotification(input);
    expect(res.sent).toBe(false);
    expect(res.error).toMatch(/N\/D/);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('el puerto se importa con un especificador que el bundler resuelve (sin webpackIgnore)', () => {
    const src = readFileSync(resolve(__dirname, '../steps/notify.ts'), 'utf8');
    expect(src).not.toMatch(/webpackIgnore/);
    expect(src).toMatch(/import\('@\/lib\/notifications'\)/);
  });
});
