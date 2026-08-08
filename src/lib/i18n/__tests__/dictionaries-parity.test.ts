import { describe, it, expect } from 'vitest';
import { dict } from '../dictionaries';

/**
 * `export type Dictionary = typeof dict.en` obliga a que `en` sea la forma
 * canónica, pero NADA obliga a que `es` la iguale: se puede añadir una clave a
 * un solo idioma y el build pasa; en runtime el usuario ve `undefined`.
 * Este guard cierra ese hueco (relevante ahora que `niifIntake` aporta el copy
 * del bloqueante duro del wizard NIIF).
 */

type Nodo = Record<string, unknown>;

function rutas(o: Nodo, prefijo = ''): string[] {
  const salida: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    const ruta = prefijo ? `${prefijo}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      salida.push(...rutas(v as Nodo, ruta));
    } else {
      salida.push(ruta);
    }
  }
  return salida;
}

describe('dictionaries — paridad es/en', () => {
  const es = rutas(dict.es as unknown as Nodo);
  const en = rutas(dict.en as unknown as Nodo);

  it('no hay claves presentes solo en español', () => {
    expect(es.filter((k) => !en.includes(k))).toEqual([]);
  });

  it('no hay claves presentes solo en inglés', () => {
    expect(en.filter((k) => !es.includes(k))).toEqual([]);
  });

  it('ninguna cadena queda vacía en ninguno de los dos idiomas', () => {
    for (const idioma of ['es', 'en'] as const) {
      const vacias = rutas(dict[idioma] as unknown as Nodo).filter((ruta) => {
        const valor = ruta
          .split('.')
          .reduce<unknown>((acc, k) => (acc as Nodo)?.[k], dict[idioma]);
        return typeof valor === 'string' && valor.trim() === '';
      });
      expect(vacias, `claves vacías en "${idioma}"`).toEqual([]);
    }
  });

  it('niifIntake expone el copy del balance obligatorio en ambos idiomas', () => {
    for (const idioma of ['es', 'en'] as const) {
      const n = dict[idioma].niifIntake;
      expect(n.rawDataTitle.length).toBeGreaterThan(0);
      expect(n.rawDataHint.length).toBeGreaterThan(0);
      expect(n.rawDataMissing.length).toBeGreaterThan(0);
    }
    // El copy debe estar realmente traducido, no duplicado.
    expect(dict.es.niifIntake.rawDataMissing).not.toBe(dict.en.niifIntake.rawDataMissing);
  });
});
