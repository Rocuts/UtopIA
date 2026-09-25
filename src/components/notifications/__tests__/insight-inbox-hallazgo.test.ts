// W5-8 (e2e-niif-15) — la Bandeja Insight pintaba cruda la clave i18n que las
// alertas del Escudo persisten como `hallazgo` («escudo.fiscal.alert.
// a5_sin_provision»). Se resuelve con el rótulo del diccionario por
// `vars.codigo`; sin rótulo, no se pinta (mismo criterio que AlertCenterView).
import { describe, expect, it } from 'vitest';

import { dict } from '@/lib/i18n/dictionaries';
import { hallazgoLegible } from '../InsightInbox';

const ALERTA_A5 = {
  hallazgo: 'escudo.fiscal.alert.a5_sin_provision',
  vars: { codigo: 'A5_SIN_PROVISION', mensaje: 'escudo.fiscal.alert.a5_sin_provision' },
};

describe('W5-8 — hallazgo legible en la Bandeja Insight', () => {
  it('resuelve la clave del Escudo con el rótulo del diccionario (es / en)', () => {
    const es = hallazgoLegible(ALERTA_A5, dict.es.elite.areas.escudo.fiscalAnchor.alertas);
    const en = hallazgoLegible(ALERTA_A5, dict.en.elite.areas.escudo.fiscalAnchor.alertas);
    expect(es).toBe(dict.es.elite.areas.escudo.fiscalAnchor.alertas.A5_SIN_PROVISION);
    expect(en).toBe(dict.en.elite.areas.escudo.fiscalAnchor.alertas.A5_SIN_PROVISION);
    expect(es).not.toContain('escudo.fiscal.alert');
    expect(en).not.toContain('escudo.fiscal.alert');
  });

  it('clave sin código resoluble ⇒ no se pinta (null)', () => {
    const alertas = dict.es.elite.areas.escudo.fiscalAnchor.alertas;
    expect(hallazgoLegible({ hallazgo: 'escudo.fiscal.alert.desconocida', vars: {} }, alertas)).toBeNull();
    expect(
      hallazgoLegible({ hallazgo: 'escudo.fiscal.alert.x', vars: { codigo: 'NO_EXISTE' } }, alertas),
    ).toBeNull();
  });

  it('un hallazgo en prosa se muestra tal cual; vacío ⇒ null', () => {
    const alertas = dict.es.elite.areas.escudo.fiscalAnchor.alertas;
    expect(hallazgoLegible({ hallazgo: 'Caja por debajo de 30 días de egresos.' }, alertas)).toBe(
      'Caja por debajo de 30 días de egresos.',
    );
    expect(hallazgoLegible({ hallazgo: '' }, alertas)).toBeNull();
    expect(hallazgoLegible({}, alertas)).toBeNull();
  });
});
