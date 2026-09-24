// ---------------------------------------------------------------------------
// F04 = F02 − F03 es una estimación contable, no un saldo a favor
// ---------------------------------------------------------------------------
// Auditoría 2026-09 (tributario-modulos-02). F04 parte de la UAI contable (no
// de la renta líquida depurada, Art. 26 E.T.), no resta descuentos ni suma el
// anticipo del año siguiente (Art. 807 E.T.). Antes, con F04 < 0 se publicaba
// «Saldo a favor identificado» con impacto monetario y la acción «Solicitar
// devolución o compensación», el analizador de devoluciones daba viabilidad
// media/alta y el Score DIAN sumaba 10 puntos. Riesgo Art. 670 E.T.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import { buildFiscalAnchor } from '../index';
import { fiscalAlertaToInsight } from '../alert-mapping';
import { buildFiscalAnchorBlockMarkdown } from '../block-builder';
import { analyzeRefund } from '../../fiscal-agent/tools/refund-analyzer';
import { computeRiskScore } from '../../fiscal-agent/tools/risk-score-calculator';

// UAI = 1.240M − 760M − 158M − 222M = 100M ⇒ F02 = 35M; F03 = 135515 50M ⇒ F04 = −15M.
const CSV = `codigo,nombre,nivel,transaccional,Saldo 2025
110505,Caja general,Auxiliar,1,18000000
111005,Bancos cuenta corriente,Auxiliar,1,157000000
130505,Clientes nacionales,Auxiliar,1,260000000
135515,Retencion en la fuente,Auxiliar,1,50000000
143505,Mercancias no fabricadas por la empresa,Auxiliar,1,165000000
220505,Proveedores nacionales,Auxiliar,1,310000000
240805,Impuesto sobre las ventas por pagar,Auxiliar,1,44000000
240405,Impuesto de renta y complementarios,Auxiliar,1,30000000
310505,Capital suscrito y pagado,Auxiliar,1,150000000
330505,Reserva legal,Auxiliar,1,26000000
360505,Utilidad o perdida del ejercicio,Auxiliar,1,70000000
370505,Resultados de ejercicios anteriores,Auxiliar,1,20000000
413550,Comercio al por mayor y al por menor,Auxiliar,1,1240000000
613550,Costo de venta de mercancias,Auxiliar,1,760000000
510506,Sueldos de personal administrativo,Auxiliar,1,158000000
529505,Gastos de venta comisiones,Auxiliar,1,222000000
540505,Impuesto de renta y complementarios,Auxiliar,1,30000000
`;

const pre = preprocessTrialBalance(parseTrialBalanceCSV(CSV));
const anchor = buildFiscalAnchor({
  preprocessed: pre,
  company: { name: 'PYME SAS', nit: '900123456-1' },
  hoy: new Date('2026-09-23T12:00:00Z'),
});

describe('F04 negativo — posible saldo a favor como estimación contable', () => {
  it('F04 = F02 − F03 = −15M', () => {
    expect(anchor.f02).toBe('3500000000');
    expect(anchor.f03).toBe('5000000000');
    expect(anchor.f04).toBe('-1500000000');
  });

  it('la alerta se rotula como estimación contable, no como saldo a favor identificado', () => {
    const a = anchor.alertas.find((x) => x.codigo === 'SALDO_A_FAVOR');
    expect(a).toBeDefined();
    expect(a!.mensaje).toBe('escudo.fiscal.alert.posible_saldo_a_favor_estimacion');
    expect(a!.norma).toMatch(/Estimación contable/);
  });

  it('el Insight persistido no lleva impacto monetario ni acción de devolución', () => {
    const a = anchor.alertas.find((x) => x.codigo === 'SALDO_A_FAVOR')!;
    const ins = fiscalAlertaToInsight(a, anchor, '2025', 'ws1', '2026-09-23T00:00:00Z');
    expect(ins.impacto).toBe('');
    expect(ins.subject).toMatch(/estimación contable/i);
    expect(ins.accionRecomendada.label).not.toMatch(/devoluci/i);
    expect(ins.vars).not.toHaveProperty('impacto');
  });

  it('el analizador de devoluciones es N/D sin el saldo declarado', () => {
    const r = analyzeRefund(anchor);
    expect(r.saldoAFavor).toBeNull();
    expect(r.viabilidad).toBe('no_determinable');
    expect(r.posibleSaldoContable).toBe('1500000000');
    expect(r.pasosBase.join(' ')).not.toMatch(/Formulario 010/);
  });

  it('con saldo declarado: plazos Art. 855 y garantía Art. 860 (entidad bancaria o aseguradora)', () => {
    const r = analyzeRefund(anchor, { saldoAFavorDeclaradoCents: '2000000000' });
    expect(r.saldoAFavor).toBe('2000000000');
    expect(r.viabilidad).toBe('media');
    expect(r.plazoConGarantia).toMatch(/Art\. 860/);
    expect(r.plazoConGarantia).toMatch(/compañía de seguros/);
    expect(r.plazoConGarantia).not.toMatch(/personal/);
  });

  it('el Score DIAN no suma puntos por «saldo a favor sin solicitar»', () => {
    const risk = computeRiskScore({ anchor, preprocessed: pre });
    const f = risk.factores.find((x) => x.factor === 'saldo_favor_sin_solicitar')!;
    expect(f.puntos).toBe(0);
    expect(f.detalle).toMatch(/estimación contable/);
  });

  it('el bloque Markdown rotula F04 como posición de referencia contable', () => {
    const md = buildFiscalAnchorBlockMarkdown(anchor);
    expect(md).toMatch(/F04 · Posición de referencia contable/);
    expect(md).not.toMatch(/negativo = saldo a favor Art\. 850/);
  });
});
