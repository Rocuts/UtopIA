// contab-nomina-22 — src/modules/pyme no está montado en ninguna ruta: el
// cálculo de nómina de producción es src/lib/payroll. El módulo arrastra
// defectos conocidos (liquidación sobre toda la antigüedad, incapacidad sin
// piso, IBC sin factores salariales, sin FSP) declarados en la cabecera de
// data/calc.ts. Esta prueba falla si alguien lo importa fuera del módulo sin
// corregirlos primero, y fija la corrección de la hora extra de la pantalla
// «Liquidar el mes».
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { horaExtraDiurna, liquidarMes } from '../calc';
import { NORMATIVA_2026 as N } from '../normativa2026';

const RAIZ = path.resolve(process.cwd(), 'src');

function recorrer(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'graphify-out') continue;
      recorrer(p, acc);
    } else if (/\.(ts|tsx)$/.test(e.name)) {
      acc.push(p);
    }
  }
  return acc;
}

describe('contab-nomina-22 — módulo Pyme no montado', () => {
  it('ningún archivo de producción fuera de src/modules/pyme lo importa', () => {
    const modulo = path.join(RAIZ, 'modules', 'pyme') + path.sep;
    const importadores = recorrer(RAIZ)
      .filter((p) => !p.startsWith(modulo))
      .filter((p) => !p.includes(`${path.sep}__tests__${path.sep}`))
      .filter((p) => /from\s+['"][^'"]*modules\/pyme[^'"]*['"]/.test(fs.readFileSync(p, 'utf8')))
      .map((p) => path.relative(process.cwd(), p));
    expect(importadores).toEqual([]);
  });

  it('la cabecera de calc.ts declara que no es referencia normativa y lista los defectos', () => {
    const src = fs.readFileSync(path.join(RAIZ, 'modules', 'pyme', 'data', 'calc.ts'), 'utf8');
    expect(src).toMatch(/MÓDULO NO MONTADO/);
    expect(src).toMatch(/NO es\s+(?:\/\/\s*|\*\s*)?referencia normativa/);
  });

  it('«Liquidar el mes» valora la hora extra con el salario del empleado, no con el del SMMLV', () => {
    const salario = 5_000_000;
    const fecha = '2026-08-07';
    const r = liquidarMes({
      salario, diasTrabajados: 30, horasExtraDiurnas: 10, domingosTrabajados: 0, otrosDescuentos: 0, fecha,
    });
    expect(r.extras).toBeCloseTo(horaExtraDiurna(fecha, salario) * 10, 6);
    expect(r.extras).toBeGreaterThan(horaExtraDiurna(fecha, N.SMMLV) * 10);
  });
});
