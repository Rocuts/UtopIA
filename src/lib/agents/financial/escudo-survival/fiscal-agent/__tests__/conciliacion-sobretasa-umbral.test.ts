// ---------------------------------------------------------------------------
// tributario-modulos-21 — Conciliación (Módulo 2): sobretasas del Art. 240
// ---------------------------------------------------------------------------
// El prompt asignaba 38% a «hidroeléctrica / acueducto» y 40% a financieras sin
// el umbral de renta gravable, y el recomputo aceptaba la tarifa del modelo
// tal cual. Art. 240 E.T. (src/data/tax_docs/et_articulo_240_renta_juridica.md):
//   par. 2 — financieras: +5 pp (40%) AG 2023-2027, sólo con renta gravable
//            ≥ 120.000 UVT;
//   par. 4 — generación hidroeléctrica: +3 pp (38%) AG 2023-2026, sólo con
//            renta gravable ≥ 30.000 UVT. Los acueductos no tienen sobretasa.
// El sector no lo verifica el código (lo declara el modelo), pero el umbral y
// la vigencia sí: debajo del umbral la tarifa es la general (35%).
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  recomputeConciliacion,
  verificarSobretasaArt240,
} from '../tools/conciliacion-builder';
import { buildConciliacionPrompt } from '../prompts/conciliacion.prompt';
import type { FiscalAnchorBlock } from '../../fiscal-anchor/types';

const anchor = (f01Cents: string, periodo = '2025'): FiscalAnchorBlock =>
  ({ f01: f01Cents, f03: '0', fuente: { periodo, balanceHash: 'h' } }) as unknown as FiscalAnchorBlock;

// UVT 2025 = $49.799 (Res. DIAN 000193/2024).
//   120.000 UVT = $5.975.880.000 ; 30.000 UVT = $1.493.970.000
const UAI_BAJO = '100000000000'; // $1.000.000.000 — por debajo de ambos umbrales
const UAI_ALTO = '1000000000000'; // $10.000.000.000 — por encima de ambos

describe('verificarSobretasaArt240', () => {
  it('40% con renta gravable < 120.000 UVT ⇒ tarifa general 35% con aviso', () => {
    const v = verificarSobretasaArt240(40, BigInt(UAI_BAJO), '2025');
    expect(v.tarifaPct).toBe(35);
    expect(v.aviso).toMatch(/120\.000 UVT/);
    expect(v.aviso).toMatch(/par\. 2/);
  });

  it('40% con renta gravable ≥ 120.000 UVT se mantiene', () => {
    const v = verificarSobretasaArt240(40, BigInt(UAI_ALTO), '2025');
    expect(v.tarifaPct).toBe(40);
    expect(v.aviso).toBeNull();
  });

  it('el umbral se mide exactamente en 120.000 UVT del año gravable', () => {
    const umbral = BigInt(120_000 * 49_799) * BigInt(100);
    expect(verificarSobretasaArt240(40, umbral, '2025').tarifaPct).toBe(40);
    expect(verificarSobretasaArt240(40, umbral - BigInt(1), '2025').tarifaPct).toBe(35);
  });

  it('38% (hidroeléctrica) exige 30.000 UVT y vigencia 2023-2026', () => {
    expect(verificarSobretasaArt240(38, BigInt(UAI_BAJO), '2025').tarifaPct).toBe(35);
    expect(verificarSobretasaArt240(38, BigInt(UAI_ALTO), '2025').tarifaPct).toBe(38);
    const fuera = verificarSobretasaArt240(38, BigInt(UAI_ALTO), '2027');
    expect(fuera.tarifaPct).toBe(35);
    expect(fuera.aviso).toMatch(/2023-2026/);
  });

  it('sin año gravable identificable el umbral no se verifica: se conserva y se avisa', () => {
    const v = verificarSobretasaArt240(40, BigInt(UAI_ALTO), 'periodo actual');
    expect(v.tarifaPct).toBe(40);
    expect(v.aviso).toMatch(/no verificable/i);
  });

  it('35% y tarifas sin umbral de sobretasa no se tocan', () => {
    expect(verificarSobretasaArt240(35, BigInt(UAI_BAJO), '2025')).toEqual({ tarifaPct: 35, aviso: null });
    expect(verificarSobretasaArt240(20, BigInt(UAI_BAJO), '2025')).toEqual({ tarifaPct: 20, aviso: null });
  });
});

describe('recomputeConciliacion aplica el umbral de la sobretasa', () => {
  it('financiera pequeña: 40% del modelo ⇒ impuesto bruto al 35%', () => {
    const r = recomputeConciliacion(anchor(UAI_BAJO), [], 40);
    expect(r.tarifaPct).toBe(35);
    expect(r.impuestoBruto).toBe('35000000000');
    expect(r.avisoTarifa).toMatch(/120\.000 UVT/);
  });

  it('financiera grande: 40% se conserva', () => {
    const r = recomputeConciliacion(anchor(UAI_ALTO), [], 40);
    expect(r.tarifaPct).toBe(40);
    expect(r.impuestoBruto).toBe('400000000000');
    expect(r.avisoTarifa).toBeNull();
  });
});

describe('prompt de conciliación: condiciones de sobretasa idénticas a la cabecera', () => {
  // Sólo el cuerpo del módulo: la cabecera del Motor Normativo menciona los
  // acueductos precisamente para excluirlos de la sobretasa.
  const p = buildConciliacionPrompt('es').split('<task>')[1] ?? '';
  it('no asigna sobretasa a acueductos', () => {
    expect(p.length).toBeGreaterThan(0);
    expect(p).not.toMatch(/acueducto/i);
  });
  it('condiciona 40% a 120.000 UVT y 38% a 30.000 UVT', () => {
    expect(p).toMatch(/120\.000 UVT[^\n]*40|40[^\n]*120\.000 UVT/);
    expect(p).toMatch(/30\.000 UVT[^\n]*38|38[^\n]*30\.000 UVT/);
  });
  it('la identidad del impuesto neto aplica el tope del Art. 258', () => {
    expect(p).toMatch(/min\(Σ 255\/256\/257, 25% del impuesto/);
  });
});
