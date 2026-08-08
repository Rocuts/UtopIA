// ---------------------------------------------------------------------------
// Regresión — documento RAG del calendario tributario 2026
// ---------------------------------------------------------------------------
// `resolucion_dian_188_2024_calendario_2026.md` está indexado en el RAG: lo que
// diga es lo que el agente le responde al contribuyente. Tenía varias tablas
// invertidas o con fechas POSTERIORES al plazo legal, que es lo que produce la
// sanción (Art. 641 E.T. renta/retención, Art. 651 E.T. exógena).
//
// Fuentes verificadas (2026-08-07):
//   - Decreto 2229 de 2023 (DUR 1625 de 2016, arts. 1.6.1.13.2.x):
//     https://normograma.dian.gov.co/dian/compilacion/docs/decreto_2229_2023.htm
//   - Resolución Única DIAN 000227 de 2025, Título 3 (exógena AG 2025):
//     https://actualicese.com/plazos-para-reportar-informacion-exogena-en-2026/
//   - Tablas 2026 por dígito de NIT:
//     https://www.enlegislacion.com/calendario-tributario/13-calendario-tributario-2026
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const DOC = readFileSync(
  join(__dirname, '..', 'resolucion_dian_188_2024_calendario_2026.md'),
  'utf-8',
);

/** Extrae las filas `| clave | valor |` que siguen a un encabezado. */
function filasBajo(encabezado: string): Array<[string, string]> {
  const idx = DOC.indexOf(encabezado);
  expect(idx, `no encontré la sección "${encabezado}"`).toBeGreaterThan(-1);
  const resto = DOC.slice(idx + encabezado.length);
  const filas: Array<[string, string]> = [];
  for (const linea of resto.split('\n')) {
    const m = linea.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/);
    if (!m) {
      if (filas.length > 0) break; // se acabó la tabla
      continue;
    }
    if (/^-+$/.test(m[1]) || /dígito|Bimestre|Cuatrimestre|Período|Cuota|Documento/i.test(m[1])) {
      continue;
    }
    filas.push([m[1], m[2]]);
  }
  return filas;
}

const MESES: Record<string, number> = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
  jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12,
};

/** "12-jun-2026" → "2026-06-12" (ordenable lexicográficamente). */
function aIso(fecha: string): string {
  const m = fecha.match(/(\d{1,2})-([a-z]{3})-(\d{4})/i);
  expect(m, `fecha no parseable: "${fecha}"`).not.toBeNull();
  const [, d, mes, y] = m!;
  return `${y}-${String(MESES[mes.toLowerCase()]).padStart(2, '0')}-${d.padStart(2, '0')}`;
}

describe('documento RAG — información exógena PJ/PN', () => {
  const filas = filasBajo('### 4.2 Personas Jurídicas y Naturales');

  it('tiene los 20 grupos de dos dígitos', () => {
    expect(filas.length).toBe(20);
  });

  it('el grupo 01-05 vence PRIMERO (14-may) y el 96-00 ÚLTIMO (12-jun)', () => {
    // Estaba invertida: un NIT terminado en 01-05 recibía el 12-jun cuando su
    // plazo real era el 14-may. 29 días de extemporaneidad, Art. 651 E.T.
    expect(filas[0][0]).toBe('01-05');
    expect(aIso(filas[0][1])).toBe('2026-05-14');
    expect(filas[19][0]).toBe('96-00');
    expect(aIso(filas[19][1])).toBe('2026-06-12');
  });

  it('las fechas van en orden estrictamente ascendente', () => {
    const isos = filas.map(([, f]) => aIso(f));
    expect(isos).toEqual([...isos].sort());
  });
});

describe('documento RAG — renta personas naturales', () => {
  const filas = filasBajo('## 3. Renta Personas Naturales');

  it('01-02 vence el 12-ago-2026 y 99-00 el 26-oct-2026, en orden ascendente', () => {
    expect(aIso(filas[0][1])).toBe('2026-08-12');
    expect(aIso(filas[filas.length - 1][1])).toBe('2026-10-26');
    const isos = filas.map(([, f]) => aIso(f));
    expect(isos).toEqual([...isos].sort());
  });

  it('ninguna fecha cae en festivo (17-ago ni 12-oct de 2026)', () => {
    const isos = filas.map(([, f]) => aIso(f));
    expect(isos).not.toContain('2026-08-17');
    expect(isos).not.toContain('2026-10-12');
  });

  it('ninguna fecha cae en sábado ni domingo', () => {
    for (const [rango, f] of filas) {
      const dow = new Date(`${aIso(f)}T12:00:00Z`).getUTCDay();
      expect(dow, `${rango} → ${f} cae en fin de semana`).not.toBe(0);
      expect(dow, `${rango} → ${f} cae en fin de semana`).not.toBe(6);
    }
  });
});

describe('documento RAG — renta personas jurídicas (no grandes contribuyentes)', () => {
  it('se indexa por el ÚLTIMO dígito, no por los dos últimos', () => {
    const filas = filasBajo('#### Declaración + 1ª cuota (mayo 2026)');
    expect(filas.length).toBe(10);
    expect(filas.map(([d]) => d)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']);
  });

  it('la 1ª cuota va del 12-may al 26-may-2026 y no se desborda a junio', () => {
    const filas = filasBajo('#### Declaración + 1ª cuota (mayo 2026)');
    expect(aIso(filas[0][1])).toBe('2026-05-12');
    expect(aIso(filas[9][1])).toBe('2026-05-26');
    for (const [, f] of filas) expect(aIso(f) <= '2026-05-26').toBe(true);
  });

  it('la 2ª cuota va del 9-jul al 23-jul-2026 y no se desborda a agosto', () => {
    const filas = filasBajo('#### 2ª cuota (julio 2026)');
    expect(aIso(filas[0][1])).toBe('2026-07-09');
    expect(aIso(filas[9][1])).toBe('2026-07-23');
    for (const [, f] of filas) expect(aIso(f) <= '2026-07-23').toBe(true);
  });
});

describe('documento RAG — retención en la fuente', () => {
  it('no enuncia la regla equivocada de "10 primeros días hábiles"', () => {
    expect(DOC).not.toMatch(/10 primeros días hábiles/i);
    expect(DOC).toMatch(/7º al 16º día hábil/);
  });

  it('el período septiembre 2026 termina el 23-oct, no el 26-oct', () => {
    expect(DOC).toContain('| Septiembre 2026 | 9-oct a 23-oct-2026 |');
  });

  it('el período agosto 2026 termina el 22-sep, no el 23-sep', () => {
    expect(DOC).toContain('| Agosto 2026 | 9-sep a 22-sep-2026 |');
  });
});

describe('documento RAG — Régimen Simple y día cívico', () => {
  it('la declaración anual del SIMPLE es en abril, no en junio', () => {
    expect(DOC).not.toMatch(/26-jun-2026 a 25-jun-2026/);
    expect(DOC).toContain('| 1 y 2 | 20-abr-2026 |');
    expect(DOC).toContain('| 9 y 0 | 24-abr-2026 |');
  });

  it('los anticipos bimestrales del SIMPLE no se declaran iguales al IVA bimestral', () => {
    expect(DOC).not.toMatch(/mismas fechas IVA bimestral/i);
  });

  it('registra el 17-abr-2026 como día no hábil (Decreto 500 de 2024)', () => {
    expect(DOC).toContain('Decreto 500 de 2024');
    expect(DOC).toMatch(/17 de abril de 2026 (es|no)/);
  });
});
