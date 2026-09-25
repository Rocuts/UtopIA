// NM-05 (re-auditoría normativa-metricas, 2026-09-24) — sin grupo 54 el Escudo
// persistía en sentinel_alerts una alerta CRÍTICA «Provisionar impuesto de
// renta» con impacto = F02 = 35 % × UAI. La UAI contable no es base fiscal
// (Art. 26 E.T.): sin depuración no hay cifra de impuesto que publicar. El
// curator (CUR-R4) ya lo trata como hallazgo INFORMATIVO sin monto; el Âncora
// Fiscal debe decir lo mismo en la alerta, en el texto legal y en la UI.
import { describe, expect, it } from 'vitest';

import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import { buildFiscalAnchor } from '@/lib/agents/financial/escudo-survival/fiscal-anchor';
import { fiscalAlertaToInsight } from '@/lib/agents/financial/escudo-survival/fiscal-anchor/alert-mapping';
import {
  A5_SIN_PROVISION_BODY_EN,
  A5_SIN_PROVISION_BODY_ES,
  a5SinProvisionBody,
} from '@/lib/agents/financial/escudo-survival/legal-strings';
import { dict } from '@/lib/i18n/dictionaries';

// UAI 100 M sin grupo 54 (mismo balance de la re-auditoría sin 540505).
const CSV_SIN_54 = [
  'codigo,nombre,nivel,transaccional,Saldo 2024,Saldo 2025',
  '110505,Caja general,Auxiliar,1,50000000,80000000',
  '111005,Bancos cuenta corriente,Auxiliar,1,150000000,120000000',
  '130505,Clientes nacionales,Auxiliar,1,300000000,360000000',
  '135515,Retencion en la fuente,Auxiliar,1,20000000,25000000',
  '143505,Mercancias no fabricadas,Auxiliar,1,200000000,250000000',
  '152405,Maquinaria y equipo,Auxiliar,1,500000000,500000000',
  '159205,Depreciacion acumulada maquinaria,Auxiliar,1,-100000000,-150000000',
  '210505,Bancos nacionales,Auxiliar,1,200000000,180000000',
  '220505,Proveedores nacionales,Auxiliar,1,150000000,170000000',
  '240405,Impuesto de renta vigencia corriente,Auxiliar,1,40000000,60000000',
  '310505,Capital suscrito y pagado,Auxiliar,1,300000000,300000000',
  '370505,Resultados de ejercicios anteriores,Auxiliar,1,180000000,315000000',
  '413550,Comercio al por mayor y menor,Auxiliar,1,1800000000,2000000000',
  '417505,Devoluciones en ventas,Auxiliar,1,0,100000000',
  '421005,Intereses financieros,Auxiliar,1,10000000,20000000',
  '510506,Sueldos administracion,Auxiliar,1,300000000,320000000',
  '516005,Depreciacion edificios admin,Auxiliar,1,30000000,30000000',
  '526005,Depreciacion ventas,Auxiliar,1,20000000,20000000',
  '529505,Comisiones ventas,Auxiliar,1,100000000,110000000',
  '530520,Intereses bancarios,Auxiliar,1,25000000,30000000',
  '531520,Gastos extraordinarios,Auxiliar,1,0,10000000',
  '613550,Costo de venta de mercancias,Auxiliar,1,1100000000,1200000000',
  '720505,Mano de obra directa,Auxiliar,1,0,100000000',
].join('\n');

function anchorSin54() {
  const pp = preprocessTrialBalance(parseTrialBalanceCSV(CSV_SIN_54));
  const fa = buildFiscalAnchor({
    preprocessed: pp,
    company: { name: 'Demo SAS', nit: '900123456-7' },
    hoy: new Date('2026-09-24'),
  });
  return { pp, fa };
}

describe('NM-05 — utilidad sin gasto de renta: hallazgo informativo sin cifra (como CUR-R4)', () => {
  it('el balance de prueba tiene UAI 100 M, sin grupo 54, y CUR-R4 es informativo', () => {
    const { pp, fa } = anchorSin54();
    expect(pp.primary.controlTotals.cents?.utilidadAntesImpuestos).toBe(BigInt(10_000_000_000));
    const r4 = (pp.primary.curator?.findings ?? []).find((f) => f.code === 'CUR-R4');
    expect(r4?.severity).toBe('informativo');
    expect(fa.alertas.some((a) => a.codigo === 'A5_SIN_PROVISION')).toBe(true);
  });

  it('la alerta del Âncora es informativa y cita la depuración (Art. 26 E.T.), no el Art. 647', () => {
    const { fa } = anchorSin54();
    const a5 = fa.alertas.find((a) => a.codigo === 'A5_SIN_PROVISION')!;
    expect(a5.severidad).toBe('info');
    expect(a5.norma).toMatch(/Art\. 26 E\.T\./);
    expect(a5.norma).not.toMatch(/647/);
  });

  it('el Insight persistido es informativo, sin impacto monetario y sin orden de provisionar', () => {
    const { fa } = anchorSin54();
    const a5 = fa.alertas.find((a) => a.codigo === 'A5_SIN_PROVISION')!;
    const ins = fiscalAlertaToInsight(a5, fa, '2025', 'ws', '2026-09-24T00:00:00Z');
    expect(ins.severity).toBe('informativo');
    expect(ins.impacto).toBe('');
    expect(ins.vars).not.toHaveProperty('impacto');
    expect(ins.accionRecomendada.label).not.toMatch(/Provisionar/i);
    expect(ins.accionRecomendada.label).toMatch(/contador/i);
    expect(ins.subject).toMatch(/depuraci[oó]n fiscal/i);
    // F02 (35 % × UAI) no viaja en ningún campo del Insight.
    expect(JSON.stringify(ins)).not.toContain(fa.f02);
  });

  it('el texto legal A5 no presenta una provisión estimada ni la «diferencia de criterio» como defensa', () => {
    for (const body of [A5_SIN_PROVISION_BODY_ES, A5_SIN_PROVISION_BODY_EN]) {
      expect(body).not.toMatch(/\{\{PROVISION\}\}/);
      expect(body).not.toMatch(/Provisi[oó]n estimada|Estimated provision/i);
      expect(body).not.toMatch(/diferencia de criterio|criterion-difference/i);
      expect(body).toMatch(/Art\. 26/);
    }
    const txt = a5SinProvisionBody('es', { uai: '$100.000.000' });
    expect(txt).toContain('$100.000.000');
    expect(txt).toMatch(/no es base fiscal/i);
  });

  it('la etiqueta de la UI no anuncia «riesgo Art. 647» por la falta de gasto 54', () => {
    const es = dict.es.elite.areas.escudo.fiscalAnchor.alertas.A5_SIN_PROVISION;
    const en = dict.en.elite.areas.escudo.fiscalAnchor.alertas.A5_SIN_PROVISION;
    expect(es).not.toMatch(/647|sin provisionar/i);
    expect(en).not.toMatch(/647|not provisioned/i);
    expect(es).toMatch(/depuraci[oó]n fiscal/i);
    expect(en).toMatch(/tax reconciliation/i);
  });
});
