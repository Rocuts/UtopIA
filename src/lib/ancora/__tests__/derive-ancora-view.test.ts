// ---------------------------------------------------------------------------
// Validators Elite Protocol — deriveAncoraView (3 capas).
// ---------------------------------------------------------------------------
//  Capa 1 · Integridad Aritmética   — centavos→pesos exactos, márgenes, round2.
//  Capa 2 · Lógica de Negocio       — null cuando el input falta/≤0; valoración.
//  Capa 3 · Defensa Tributaria      — Altman=null justificado, Art. 36-3 40%,
//                                     rúbrica scoreNiif sobre checks reales.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';

import { deriveAncoraView } from '../derive-ancora-view';
import { makeAncora, makeFiscalSnapshot } from './ancora.fixture';

describe('deriveAncoraView · Capa 1 — Integridad Aritmética', () => {
  it('convierte centavos → pesos al peso exacto', () => {
    const v = deriveAncoraView(makeAncora(), null);
    expect(v.niif.activos).toBe(1_000_000_000);
    expect(v.niif.pasivos).toBe(400_000_000);
    expect(v.niif.patrimonio).toBe(600_000_000);
    expect(v.niif.ingresos).toBe(500_000_000);
    expect(v.niif.ebitOperacional).toBe(100_000_000);
    expect(v.niif.utilidadNeta).toBe(50_000_000);
    expect(v.niif.variacionCaja).toBe(20_000_000);
    expect(v.niif.cartera).toBe(80_000_000);
  });

  it('calcula márgenes y crecimiento con redondeo a 2 decimales', () => {
    const v = deriveAncoraView(makeAncora(), null);
    expect(v.derived.crecimientoIngresosPct).toBe(25); // (500-400)/400
    expect(v.derived.margenNetoPct).toBe(10); // 50/500
    expect(v.derived.margenOperacionalPct).toBe(20); // 100/500
    expect(v.derived.deRatio).toBe(0.67); // 400/600 = 0.6666… → round2
  });

  it('lee F10 (porcentaje) desde el ccvFiscal cuando no hay snapshot', () => {
    const v = deriveAncoraView(makeAncora(), null);
    expect(v.fiscal.f10).toBe(28.57);
    expect(v.fiscal.scoreRiesgoDIAN).toBeNull();
  });

  it('prefiere el FiscalSnapshot.anchor para los F-fields + Score DIAN', () => {
    const v = deriveAncoraView(makeAncora(), makeFiscalSnapshot());
    expect(v.fiscal.f01).toBe(50_000_000);
    expect(v.fiscal.f09).toBe(5.9);
    expect(v.fiscal.scoreRiesgoDIAN).toBe(68);
    expect(v.fiscal.nivelRiesgo).toBe('muy_alto');
  });
});

describe('deriveAncoraView · Capa 2 — Lógica de Negocio', () => {
  it('sin Âncora ⇒ hasData:false y todo en null', () => {
    const v = deriveAncoraView(null, null, { name: 'ACME', nit: '900-1' });
    expect(v.hasData).toBe(false);
    expect(v.niif.activos).toBeNull();
    expect(v.derived.scoreNiif).toBeNull();
    expect(v.derived.valoracion.ponderado).toBeNull();
    expect(v.meta.empresa).toBe('ACME');
  });

  it('crecimiento = null cuando no hay período comparativo (ingresosPrev ≤ 0)', () => {
    const v = deriveAncoraView(
      makeAncora({
        ccvNiif: { ...makeAncora().ccvNiif, A08: '0' },
      }),
      null,
    );
    expect(v.derived.crecimientoIngresosPct).toBeNull();
    expect(v.derived.oportunidades.expansionIngresos).toBeNull();
  });

  it('deRatio = null cuando patrimonio ≤ 0 (no divide por cero)', () => {
    const v = deriveAncoraView(
      makeAncora({ ccvNiif: { ...makeAncora().ccvNiif, A05: '0' } }),
      null,
    );
    expect(v.derived.deRatio).toBeNull();
  });

  it('EV/EBIT solo aplica si EBIT > 0; ponderado promedia los disponibles', () => {
    const sano = deriveAncoraView(makeAncora(), null);
    expect(sano.derived.valoracion.evEbit).toBe(600_000_000); // 100M × 6
    expect(sano.derived.valoracion.liquidacion).toBe(600_000_000); // patrimonio
    expect(sano.derived.valoracion.ponderado).toBe(600_000_000); // (600+600)/2

    const ebitNeg = deriveAncoraView(
      makeAncora({ ccvNiif: { ...makeAncora().ccvNiif, A09: '-5000000000' } }),
      null,
    );
    expect(ebitNeg.derived.valoracion.evEbit).toBeNull(); // EBIT<0 ⇒ no aplica
    // sólo queda liquidación ⇒ ponderado = liquidación
    expect(ebitNeg.derived.valoracion.ponderado).toBe(600_000_000);
  });

  it('métodos que requieren WACC/BVC siempre son null (faltaWacc:true)', () => {
    const v = deriveAncoraView(makeAncora(), null);
    expect(v.derived.valoracion.dcf).toBeNull();
    expect(v.derived.valoracion.gordon).toBeNull();
    expect(v.derived.valoracion.transacciones).toBeNull();
    expect(v.derived.valoracion.faltaWacc).toBe(true);
  });
});

describe('deriveAncoraView · Capa 3 — Defensa Tributaria', () => {
  it('Altman Z = null SIEMPRE con razón citada (no inventar sin RE)', () => {
    const v = deriveAncoraView(makeAncora(), null);
    expect(v.derived.altmanZ).toBeNull();
    expect(v.derived.altmanRazon).toMatch(/[Uu]tilidades [Rr]etenidas|RE/);
  });

  it('capitalización Art. 36-3 = utilidadNeta × 0.40 (heurístico)', () => {
    const v = deriveAncoraView(makeAncora(), null);
    expect(v.derived.oportunidades.capitalizacion36_3).toBe(20_000_000); // 50M×0.4
  });

  it('capitalización = null si utilidad neta ≤ 0', () => {
    const v = deriveAncoraView(
      makeAncora({ ccvNiif: { ...makeAncora().ccvNiif, A11: '0' } }),
      null,
    );
    expect(v.derived.oportunidades.capitalizacion36_3).toBeNull();
  });

  it('scoreNiif = 100 cuando todos los checks pasan', () => {
    const v = deriveAncoraView(makeAncora(), null);
    expect(v.derived.scoreNiif).toBe(100);
  });

  it('rúbrica scoreNiif resta por cada check fallido', () => {
    // EFE no concilia (−20) + alerta A5 activa (−10) ⇒ 70
    const v = deriveAncoraView(
      makeAncora({
        checks: {
          patrimonioDelta2025: '0',
          patrimonioDelta2024: '0',
          efeReconcilia: 'error',
          alertaA5: 'activa',
          alertaDev: 'inactiva',
        },
      }),
      null,
    );
    expect(v.derived.scoreNiif).toBe(70);
  });

  it('ecuación patrimonial descuadrada penaliza 40 pts (actual)', () => {
    const v = deriveAncoraView(
      makeAncora({
        checks: {
          patrimonioDelta2025: '15000', // ≠ '0'
          patrimonioDelta2024: '0',
          efeReconcilia: 'ok',
          alertaA5: 'inactiva',
          alertaDev: 'inactiva',
        },
      }),
      null,
    );
    expect(v.derived.scoreNiif).toBe(60); // 100 − 40
  });
});
