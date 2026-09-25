// ---------------------------------------------------------------------------
// W4-C (re-auditoría 2026-09-24) — Âncora NIIF con las definiciones canónicas
// del preprocesador (NM-12 / recalculo-final-06, decisión §7):
//   - X01/X02 ganancia bruta = ancla UB (41 − 4175 − costos 6 + 7), sin 42.
//   - margen operacional = EBIT / ingresos operacionales netos (X05).
//   - cartera (A17) = clientes netos 1305 + 1310 − |1399| (no el grupo 13).
//   - crecimiento de ingresos sólo entre periodos de igual duración.
// ---------------------------------------------------------------------------
import { describe, expect, it } from 'vitest';

import { buildNiifAncora } from '../build-ancora';
import { renderNiifAncoraBlock } from '../render-ancora';
import { deriveAncoraView } from '@/lib/ancora/derive-ancora-view';
import { CSV_NM_ANUAL, csvNmConPeriodo, preNm } from '@/lib/pillars/__tests__/_fixture-nm';

const COMPANY = { name: 'Demo SAS', nit: '900123456-7' } as never;

describe('Âncora NIIF — definiciones canónicas (NM-12 / recalculo-final-06)', () => {
  const pp = preNm(CSV_NM_ANUAL);
  const ct = pp.primary.controlTotals;
  const ctC = pp.comparative!.controlTotals;
  const ancora = buildNiifAncora(pp, COMPANY);
  const v = deriveAncoraView(ancora, null);

  it('X01/X02 = utilidad bruta del preprocesador (sin grupo 42)', () => {
    expect(ct.utilidadBruta).toBe(600_000_000);
    expect(ancora.ccvNiif.X01).toBe('60000000000');
    expect(ancora.ccvNiif.X02).toBe(String(Math.round(ctC.utilidadBruta! * 100)));
    expect(v.niif.gananciaBruta).toBe(600_000_000);
  });

  it('margen operacional = EBIT / ingresos operacionales netos = ct.margenOperativo (6,32 %)', () => {
    expect(ancora.ccvNiif.X05).toBe('190000000000');
    expect(v.derived.margenOperacionalPct).toBe(Math.round(ct.margenOperativo! * 100) / 100);
    expect(v.derived.margenOperacionalPct).toBe(6.32);
  });

  it('cartera = clientes netos (350 M), sin anticipos de impuestos 1355', () => {
    expect(ct.clientesNetos).toBe(350_000_000);
    expect(ancora.ccvNiif.A17).toBe('35000000000');
    expect(v.niif.cartera).toBe(350_000_000);
    expect(v.derived.oportunidades.liberacionCartera).toBe(350_000_000);
  });

  it('margen neto = UN / ingresos netos (igual que el preprocesador)', () => {
    expect(v.derived.margenNetoPct).toBe(Math.round(ct.margenNeto! * 100) / 100);
  });

  it('el bloque renderizado rotula la cartera comercial neta y los ingresos operacionales', () => {
    const txt = renderNiifAncoraBlock(ancora);
    expect(txt).toContain('A17 (Cartera comercial neta 2025) = $350.000.000,00');
    expect(txt).toContain('X05 (Ingresos operacionales netos 2025) = $1.900.000.000,00');
  });

  it('sin cuentas de clientes la cartera es N/D (null), no $0 ni el grupo 13', () => {
    const sinClientes = CSV_NM_ANUAL.split('\n')
      .filter((l) => !l.startsWith('130505') && !l.startsWith('139905'))
      .join('\n');
    const a = buildNiifAncora(preNm(sinClientes), COMPANY);
    expect(a.ccvNiif.A17).toBeNull();
    expect(deriveAncoraView(a, null).niif.cartera).toBeNull();
    expect(renderNiifAncoraBlock(a)).toContain('A17 (Cartera comercial neta 2025) = N/D');
  });
});

describe('Âncora NIIF — crecimiento sólo entre periodos comparables', () => {
  it('corte "2025-06" contra el año 2024: crecimiento N/D (no +6,08 %)', () => {
    const v = deriveAncoraView(buildNiifAncora(preNm(csvNmConPeriodo('2025-06')), COMPANY), null);
    expect(v.derived.crecimientoIngresosPct).toBeNull();
    expect(v.derived.oportunidades.expansionIngresos).toBeNull();
  });

  it('año contra año sí publica el crecimiento de ingresos netos', () => {
    const v = deriveAncoraView(buildNiifAncora(preNm(CSV_NM_ANUAL), COMPANY), null);
    // Ingresos netos 1.920 M vs 1.810 M.
    expect(v.derived.crecimientoIngresosPct).toBe(6.08);
  });

  it('Âncora persistido sin X05 (versión previa): margen operacional N/D, nunca sobre ingresos con 42', () => {
    const a = buildNiifAncora(preNm(CSV_NM_ANUAL), COMPANY);
    const { X05: _omit, ...viejo } = a.ccvNiif;
    void _omit;
    const v = deriveAncoraView({ ...a, ccvNiif: viejo as typeof a.ccvNiif }, null);
    expect(v.derived.margenOperacionalPct).toBeNull();
    expect(v.hasData).toBe(true);
  });
});
