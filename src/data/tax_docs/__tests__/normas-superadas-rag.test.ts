// ---------------------------------------------------------------------------
// NM-10 (re-auditoría normativa-metricas, 2026-09-24) — resúmenes curados del
// corpus RAG con normas superadas (el chat los cita textualmente).
// ---------------------------------------------------------------------------
// Fuentes primarias DEL REPO (no se usa texto externo):
//   · decreto_0572_2025.md: bases mínimas de retención 2 UVT (servicios) y
//     10 UVT (compras y demás), restablecidas desde el 01-jul-2026
//     (decreto_572_2025_autorretenciones.md, matriz_retenciones_2026.md).
//   · ley_2277_2022.md / estatuto_tributario_completo.md: Art. 206 num. 10
//     «limitada anualmente a setecientos noventa (790) UVT»; Art. 336 num. 3
//     «no puede exceder de mil trescientas cuarenta (1.340) UVT anuales».
//   · ley_1819_2016.md Art. 237: ZOMAC micro/pequeñas 2025-2027 = 50 % de la
//     tarifa general; medianas/grandes 2022-2027 = 75 %.
//   · estatuto_tributario_completo.md Art. 240: par. 1 (9 %), par. 2
//     (financieras 40 %), par. 4 (hidroeléctricas 38 %), par. 5 (hoteles
//     15 %), par. 6 (TTD = ID / UD; IA = UD × 15 % − ID); Art. 240-1 (zona
//     franca: 20 % sólo sobre la proporción de exportación).
//   · estatuto_tributario_completo.md: Art. 36-3 derogado por el art. 96 de la
//     Ley 2277 de 2022; Art. 647 par. 2 = interpretación razonable; Art. 647-1
//     = rechazo o disminución de pérdidas.
// ---------------------------------------------------------------------------

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const DIR = join(__dirname, '..');
const read = (f: string) => readFileSync(join(DIR, f), 'utf-8');

describe('resolucion_dian_238_2025_uvt_2026.md — bases y renta exenta vigentes', () => {
  const t = read('resolucion_dian_238_2025_uvt_2026.md');

  it('bases de retención de compras 10 UVT y servicios 2 UVT desde el 01-jul-2026 (Decreto 0572/2025)', () => {
    expect(t).not.toContain('| Compras a declarantes | 2,5% | 27 UVT |');
    expect(t).not.toContain('| Servicios generales (declarantes) | 4% | 4 UVT |');
    expect(t).toContain('| Compras a declarantes | 2,5% | 10 UVT |');
    expect(t).toContain('| Servicios generales (declarantes) | 4% | 2 UVT |');
    expect(t).toMatch(/Decreto 0572 de 2025/);
    expect(t).toMatch(/01-jul-2026/);
  });

  it('honorarios de personas naturales: 10 % / 11 % por el umbral de 3.300 UVT, no por la condición de declarante', () => {
    expect(t).not.toMatch(/Honorarios y comisiones \(PN (no )?declarante\)/);
    expect(t).toMatch(/3\.300 UVT/);
  });

  it('renta exenta laboral según Ley 2277: 790 UVT anuales y límite global 40 % / 1.340 UVT anuales', () => {
    expect(t).not.toMatch(/240 UVT mensuales/);
    expect(t).not.toMatch(/2\.880 UVT/);
    expect(t).toMatch(/790 UVT anuales/);
    expect(t).toMatch(/1\.340 UVT anuales/);
    expect(t).toContain('$41.375.460');
    expect(Math.round(790 * 52_374)).toBe(41_375_460);
  });
});

describe('et_articulo_240_renta_juridica.md — parágrafos, TTD, ZOMAC y zona franca', () => {
  const t = read('et_articulo_240_renta_juridica.md');

  it('TTD = ID / UD con impuesto a adicionar; no «IMR ... el mayor» sobre utilidad contable', () => {
    expect(t).not.toMatch(/El mayor entre IMR/);
    expect(t).not.toMatch(/\bIMR\b/);
    expect(t).toContain('TTD = ID / UD');
    expect(t).toContain('IA = UD × 15% − ID');
  });

  it('ZOMAC según el Art. 237 de la Ley 1819/2016: 17,5 % (micro/pequeñas) y 26,25 % (medianas/grandes) en 2026', () => {
    expect(t).not.toMatch(/0%\/12,5%\/25%/);
    expect(t).toMatch(/Art\. 237 de la Ley 1819/);
    expect(t).toContain('17,5%');
    expect(t).toContain('26,25%');
  });

  it('zona franca: 20 % sólo sobre la renta líquida proporcional a exportaciones (Art. 240-1, Ley 2277)', () => {
    expect(t).not.toContain('Zonas Francas (Art. 240-1) — tarifa 20% para usuarios industriales.');
    expect(t).toMatch(/240-1[^\n]*export/);
  });

  it('numeración de parágrafos del texto vigente: financieras = par. 2, hidroeléctricas = par. 4, hoteles = par. 5', () => {
    expect(t).toMatch(/\*\*Parágrafo 2\.\*\*[^\n]*instituciones financieras/);
    expect(t).toMatch(/\*\*Parágrafo 4\.\*\*[^\n]*hídricos/);
    expect(t).toMatch(/\*\*Parágrafo 5\.\*\*[^\n]*hotel/);
    expect(t).not.toMatch(/\*\*Parágrafo 1\.\*\*[^\n]*instituciones financieras/);
  });
});

describe('decreto_624_1989.md — Art. 36-3 con nota de derogatoria', () => {
  it('el texto del Art. 36-3 lleva la nota de derogatoria (Ley 2277/2022 art. 96)', () => {
    const t = read('decreto_624_1989.md');
    const i = t.indexOf('Artículo 36-3. Capitalizaciones no gravadas');
    const j = t.indexOf('Artículo 36-4', i);
    expect(i).toBeGreaterThan(0);
    const bloque = t.slice(i, j);
    expect(bloque).toMatch(/DEROGADO/);
    expect(bloque).toMatch(/art(ículo|\.) 96 de la Ley 2277 de 2022/);
  });
});

describe('Art. 647 par. 2 vs Art. 647-1', () => {
  const curados = readdirSync(DIR).filter(
    (f) =>
      f.endsWith('.md') &&
      !/^(estatuto_tributario_completo|decreto_624_1989|decreto_1625_2016|ley_\d+_\d+)\.md$/.test(f),
  );

  it('ningún resumen curado atribuye la «diferencia de criterio(s)» al Art. 647-1', () => {
    const malos: string[] = [];
    for (const f of curados) {
      for (const linea of read(f).split('\n')) {
        if (/647-1/.test(linea) && /diferencia(s)? de criterio/i.test(linea)) malos.push(`${f}: ${linea.slice(0, 120)}`);
      }
    }
    expect(malos).toEqual([]);
    expect(curados).not.toContain('et_articulo_647_1_diferencia_criterios.md');
  });

  it('el resumen de la interpretación razonable cita el parágrafo 2 del Art. 647 y aclara qué es el 647-1', () => {
    const t = read('et_articulo_647_par2_interpretacion_razonable.md');
    expect(t).toMatch(/normCode: "ET Art\. 647 par\. 2"/);
    expect(t).toMatch(/parágrafo 2 del Art\. 647/i);
    expect(t).toMatch(/hechos y cifras denunciados sean completos y verdaderos/);
    expect(t).toMatch(/Art\. 647-1[^\n]*[Rr]echazo o disminución de pérdidas/);
  });

  it('el resumen del Art. 647 remite la defensa al parágrafo 2', () => {
    const t = read('et_articulo_647_sancion_inexactitud.md');
    expect(t).toMatch(/Art\. 647 par\. 2/);
  });
});

describe('decreto_2706_2012_grupo3_micro.md — topes con el SMMLV 2026 del repo', () => {
  it('usa SMMLV 2026 = $1.750.905 (constante SMMLV_2026), no $1.300.000', () => {
    const t = read('decreto_2706_2012_grupo3_micro.md');
    expect(t).not.toMatch(/SMMLV = \$1\.300\.000/);
    expect(t).toContain('$1.750.905');
    expect(500 * 1_750_905).toBe(875_452_500);
    expect(6_000 * 1_750_905).toBe(10_505_430_000);
    expect(t).toContain('$875.452.500');
    expect(t).toContain('$10.505.430.000');
  });
});
