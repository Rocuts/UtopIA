/**
 * Regresión tributario-calc-11 — "Régimen Ordinario" en la balanza SIMPLE vs
 * Ordinario (/workspace/pyme/pagos).
 *
 * Defecto: computeOrdinario aplicaba un ÚNICO tramo del 19 % del Art. 241 E.T.
 * sobre (utilidad − 1.090 UVT), con un margen supuesto del 35 %, y sólo para
 * persona natural. Con ventas de $100 M/mes (utilidad $420 M = 8.019,25 UVT)
 * mostraba $68.953.345 frente a $109.008.690 con la tabla completa y
 * $147.000.000 si el contribuyente es persona jurídica (35 %, Art. 240).
 *
 * Tabla Art. 241 (mod. art. 34 Ley 2010/2019): tarifas marginales 0/19/28/33/
 * 35/37/39 % en 1.090/1.700/4.100/8.670/18.970/31.000 UVT
 * (src/data/tax_docs/estatuto_tributario_resumen_2026.md); los valores fijos
 * 116/788/2.296/5.901/10.352 UVT son la acumulación de los tramos anteriores.
 */

import { describe, expect, it } from 'vitest';
import {
  ART_241_TRAMOS,
  compare,
  computeOrdinario,
  impuestoArt241,
  UVT_2026,
} from '../taxCalculator';

const VENTAS_ANUALES = 100_000_000 * 12;

describe('Art. 241 — tabla completa para personas naturales', () => {
  it('$420 M de utilidad (8.019,25 UVT) → $109.008.690, no $68.953.345', () => {
    const r = computeOrdinario(VENTAS_ANUALES, { margin: 0.35, icaRate: 0.0069 });
    expect(Math.round(r.renta)).toBe(109_008_690);
    expect(r.tipoContribuyente).toBe('persona_natural');
    expect(r.baseLegalRenta).toMatch(/Art\. 241/);
  });

  it('los valores fijos de cada tramo son la acumulación de los tramos anteriores', () => {
    for (let i = 1; i < ART_241_TRAMOS.length; i++) {
      const prev = ART_241_TRAMOS[i - 1]!;
      const t = ART_241_TRAMOS[i]!;
      const acumulado = prev.baseUvt + (prev.hastaUvt - prev.desdeUvt) * prev.tarifa;
      expect(Math.abs(t.baseUvt - acumulado)).toBeLessThan(1);
    }
  });

  it('continuidad en los límites de tramo', () => {
    for (const t of ART_241_TRAMOS.slice(1, -1)) {
      const justoAntes = impuestoArt241((t.hastaUvt - 0.0001) * UVT_2026);
      const justoDespues = impuestoArt241((t.hastaUvt + 0.0001) * UVT_2026);
      expect(Math.abs(justoDespues - justoAntes)).toBeLessThan(UVT_2026);
    }
  });
});

describe('Art. 240 — persona jurídica al 35 %, rotulado', () => {
  it('$420 M de utilidad → $147.000.000', () => {
    const r = computeOrdinario(VENTAS_ANUALES, {
      margin: 0.35,
      icaRate: 0.0069,
      tipoContribuyente: 'persona_juridica',
    });
    expect(r.renta).toBe(147_000_000);
    expect(r.baseLegalRenta).toMatch(/Art\. 240/);
    expect(r.baseLegalRenta).toMatch(/35/);
  });
});

describe('cifra ordinaria no disponible sin margen ni ICA del usuario', () => {
  it('sin margen confirmado: ordinarioDisponible = false con motivo, y no recomienda', () => {
    const r = compare(VENTAS_ANUALES, { group: 'tiendas', icaRate: 0.0069 });
    expect(r.ordinarioDisponible).toBe(false);
    expect(r.ordinarioMotivoND).toMatch(/margen/i);
    expect(r.recommended).toBeNull();
  });

  it('sin ICA municipal: ordinarioDisponible = false con motivo', () => {
    const r = compare(VENTAS_ANUALES, { group: 'tiendas', margin: 0.2 });
    expect(r.ordinarioDisponible).toBe(false);
    expect(r.ordinarioMotivoND).toMatch(/ICA/);
  });

  it('con margen e ICA del usuario la cifra está disponible y rotula la tarifa aplicada', () => {
    const r = compare(VENTAS_ANUALES, { group: 'tiendas', margin: 0.2, icaRate: 0.0069 });
    expect(r.ordinarioDisponible).toBe(true);
    expect(r.ordinarioMotivoND).toBeNull();
    expect(r.ordinarioBaseLegal).toMatch(/Art\. 241/);
  });
});
