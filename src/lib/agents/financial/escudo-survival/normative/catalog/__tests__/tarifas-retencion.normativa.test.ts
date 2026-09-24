// tarifas-retencion.normativa.test.ts — Regresiones de la auditoría normativa
// 2026-08 sobre el catálogo de tarifas de retención del Motor Normativo.
//
// Este catálogo se inyecta literalmente en el prompt del Motor Normativo
// (renderTarifasRetencion en prompts/motor-normativo.prompt.ts) y de ahí pasa a
// los dictámenes del Escudo que el cliente firma ante la DIAN. Un número mal
// puesto aquí es un número mal puesto en un documento firmado.

import { describe, it, expect } from 'vitest';
import { TARIFAS_RETENCION } from '../tarifas-retencion';

function entry(id: string) {
  const found = TARIFAS_RETENCION.find((t) => t.id === id);
  if (!found) throw new Error(`Entrada ${id} no está en el catálogo`);
  return found;
}

describe('RTF_HONORARIOS_PN — DUR 1625/2016 Art. 1.2.4.3.1 y Art. 392 E.T.', () => {
  const e = entry('RTF_HONORARIOS_PN');

  // Auditoría 2026-09 (tributario-calc-09): la versión anterior de estas
  // pruebas exigía "declarante 11 % / no declarante 10 %". El DUR 1.2.4.3.1
  // distingue a las personas naturales por el MONTO (contrato o pagos del año
  // > 3.300 UVT ⇒ 11 %; demás, 10 %), no por la condición de declarante: un
  // declarante con contrato pequeño retiene 10 %.
  it('la tarifa general de la persona natural es 10 % y sube a 11 % por el umbral de 3.300 UVT', () => {
    expect(e.tarifaDeclarante).toMatch(/^10%/);
    expect(e.tarifaDeclarante).toMatch(/11%/);
    expect(e.tarifaDeclarante).toMatch(/3\.300 UVT/);
    // 3.300 UVT x $52.374 (UVT 2026) = $172.834.200.
    expect(3300 * 52_374).toBe(172_834_200);
    expect(e.tarifaDeclarante).toMatch(/172\.834\.200/);
    expect(e.tarifaDeclarante).toMatch(/contrato/);
  });

  it('no usa la condición de declarante como criterio del 10 % / 11 %', () => {
    expect(e.tarifaDeclarante).not.toMatch(/^11%/);
    expect(e.tarifaDeclarante).toMatch(/declarante no define la tarifa/);
  });

  it('el no obligado a declarar retiene 10 % (Art. 392 E.T.)', () => {
    expect(e.tarifaNoDeclarante).toMatch(/^10%/);
    expect(e.tarifaNoDeclarante).toMatch(/392/);
  });

  it('advierte la tabla del Art. 383 para rentas de trabajo no laborales (Decreto 2231/2023)', () => {
    expect(e.tarifaDeclarante).toMatch(/Art\. 383/);
    expect(e.normaRef).toMatch(/1\.2\.4\.1\.17/);
    expect(e.normaRef).toMatch(/2231\/2023/);
  });

  it('cita el Art. 392 E.T. y el DUR 1.2.4.3.1 como fundamento', () => {
    expect(e.normaRef).toMatch(/392/);
    expect(e.normaRef).toMatch(/1\.2\.4\.3\.1/);
  });
});

describe('RTF_HONORARIOS — personas jurídicas (DUR 1.2.4.3.1 inc. 1)', () => {
  const e = entry('RTF_HONORARIOS');

  it('11 % para personas jurídicas, sin distinguir declarante', () => {
    expect(e.tarifaDeclarante).toBe('11%');
    expect(e.tarifaNoDeclarante).toBeNull();
    expect(e.concepto).not.toMatch(/declarantes/);
    expect(e.normaRef).toMatch(/1\.2\.4\.3\.1/);
  });
});

describe('RTF_AUTORETENCIONES_ESPECIALES_CIIU — Decreto 0572/2025 art. 8', () => {
  const e = entry('RTF_AUTORETENCIONES_ESPECIALES_CIIU');

  it('no conserva la combinación "0.4% / 1.1% / 1.6%", que no es de ninguna versión de la norma', () => {
    // "0,4 / 0,8 / 1,6" fue el Decreto 2201/2016 (derogado); "0,55 / 1,1 / 2,2"
    // los Decretos 0261/2023 y 242/2024. La terna del repo no existió nunca.
    expect(e.tarifaDeclarante).not.toMatch(/0\.4%/);
    expect(e.tarifaDeclarante).not.toMatch(/1\.6%/);
  });

  it('reproduce el escalonamiento vigente desde el 01-jul-2026 (0,55% a 4,50%)', () => {
    for (const tarifa of ['0,55%', '1,10%', '1,20%', '1,70%', '2,20%', '3,50%', '4,50%']) {
      expect(e.tarifaDeclarante).toContain(tarifa);
    }
  });

  it('cita el Decreto 0572/2025 y el artículo sustituido del DUR', () => {
    // El normaRef anterior sólo mencionaba "Arts. 1.2.6.6 a 1.2.6.11" del DUR,
    // omitiendo la norma que sustituyó el Art. 1.2.6.8: el dictamen citaba una
    // redacción ya sustituida.
    expect(e.normaRef).toMatch(/0572\/2025|572 de 2025/);
    expect(e.normaRef).toMatch(/1\.2\.6\.8/);
  });

  it('modela la ventana de suspensión (08-may a 30-jun-2026) en vez de colapsarla', () => {
    expect(e.tarifaDeclarante).toMatch(/08-may-2026/);
    expect(e.tarifaDeclarante).toMatch(/30-jun-2026/);
    expect(e.normaRef).toMatch(/30229|01-jul-2026/);
  });

  it('instruye a leer la tarifa del CIIU y no a inferirla del sector', () => {
    expect(e.tarifaDeclarante).toMatch(/NO se infiere/i);
  });
});

describe('RTF_DIVIDENDOS_PN_RESIDENTE — Arts. 240 y 242 E.T. + Decreto 1103 de 2023', () => {
  const e = entry('RTF_DIVIDENDOS_PN_RESIDENTE');

  it('los dividendos gravados van al Art. 240 E.T., NO a la tarifa marginal del Art. 241', () => {
    // Art. 242 inc. 2 E.T.: los gravados se someten primero a la tarifa del
    // Art. 240 E.T. y sólo el remanente, disminuido ese impuesto, entra al
    // régimen del Art. 242. Enviar al agente al Art. 241 subestima la retención
    // y expone a la sociedad como agente retenedor (Art. 370 E.T.).
    expect(e.tarifaDeclarante).toMatch(/240/);
    expect(e.tarifaDeclarante).not.toMatch(/tarifa marginal Art\. 241/);
  });

  it('no describe el Art. 242 como "tabla progresiva"', () => {
    // Tras el Art. 3 de la Ley 2277/2022 es un escalón único: 0% hasta 1.090 UVT
    // y 15% sobre el exceso.
    expect(e.tarifaDeclarante).not.toMatch(/[Tt]abla progresiva/);
    expect(e.tarifaDeclarante).toMatch(/1\.090 UVT/);
    expect(e.tarifaDeclarante).toMatch(/15%/);
  });

  it('cita la Ley 2277/2022 y el Decreto 1103 de 2023', () => {
    expect(e.normaRef).toMatch(/2277/);
    expect(e.normaRef).toMatch(/1103/);
  });

  it('deja de estar en estado MODIFICADO sin fecha de corte: la norma está vigente', () => {
    expect(e.estado).toBe('VIGENTE_2026');
  });
});

describe('invariantes del catálogo', () => {
  it('no hay ids duplicados', () => {
    const ids = TARIFAS_RETENCION.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('toda entrada declara norma de respaldo y estado', () => {
    for (const t of TARIFAS_RETENCION) {
      expect(t.normaRef.length).toBeGreaterThan(0);
      expect(['VIGENTE_2026', 'MODIFICADO', 'DEROGADO']).toContain(t.estado);
    }
  });
});
