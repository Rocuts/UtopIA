// IW4 (ratios-kpis-08) — La plantilla del correo de cierre exigía los 4 KPIs
// como cifras (y `documentsVerifiedPct.toFixed` fallaba con null): el paso
// notify tenía que omitir el correo o enviar ceros. Ahora un KPI sin base
// verificada (null) se muestra "N/D".
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { PeriodLockedEmail } from '../email/templates/period-locked';
import type { PeriodLockedPayload } from '../types';

const base: PeriodLockedPayload = {
  workspaceName: 'Empresa Demo',
  periodLabel: '2026-08',
  periodHash: 'abcdef0123456789abcdef',
  withWarnings: false,
  pillars: {
    resiliencia: { totalProvisionTaxesCop: null },
    valor: { ebitdaCop: null },
    verdad: { documentsVerifiedPct: null },
    futuro: { freeCashFlowProjectedCop: null },
  },
  links: { viewReportUrl: 'https://x/r', shareReportUrl: 'https://x/s', viewAnomaliesUrl: 'https://x/a' },
};

describe('correo period.locked — KPIs N/D', () => {
  it('KPIs null se pintan "N/D", nunca 0 ni 0.0%', () => {
    const html = renderToStaticMarkup(PeriodLockedEmail({ payload: base, unsubscribeUrl: 'https://x/u' }));
    expect(html.match(/N\/D/g)?.length).toBe(4);
    expect(html).not.toMatch(/>0(\.0)?%?</);
  });

  it('un % real se sigue mostrando con un decimal', () => {
    const html = renderToStaticMarkup(
      PeriodLockedEmail({
        payload: { ...base, pillars: { ...base.pillars, verdad: { documentsVerifiedPct: 87 } } },
        unsubscribeUrl: 'https://x/u',
      }),
    );
    expect(html).toContain('87.0%');
    expect(html.match(/N\/D/g)?.length).toBe(3);
  });
});
