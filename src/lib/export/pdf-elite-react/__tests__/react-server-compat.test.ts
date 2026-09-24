// Integración fase 2 (2026-09-24): `npm run build` fallaba al recolectar
// /api/financial-report/export con "createContext is not a function".
// Las rutas de Next empaquetan React con la condición `react-server`, que no
// expone `createContext` ni los hooks de estado/efecto; el índice numerado del
// PDF (reportes-export-21) había introducido un contexto de React. Vitest corre
// en Node con el React completo y no lo detecta, así que esta guarda estática
// impide que el árbol del PDF Élite vuelva a depender de esas APIs.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');

const REACT_SERVER_MISSING =
  /\b(?:createContext|useContext|useState|useReducer|useEffect|useLayoutEffect|useInsertionEffect|useRef|useSyncExternalStore|useTransition|useDeferredValue|useImperativeHandle|useOptimistic|useActionState)\s*[<(]/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('PDF Élite compatible con la condición react-server de las rutas de Next', () => {
  it('ningún módulo del árbol usa contexto ni hooks de estado/efecto de React', () => {
    const offenders = sourceFiles(ROOT)
      .filter((file) => REACT_SERVER_MISSING.test(withoutComments(readFileSync(file, 'utf8'))))
      .map((file) => path.relative(ROOT, file));
    expect(offenders).toEqual([]);
  });

  it('el recolector de la tabla de contenido viaja en el IR, no en un contexto', () => {
    const anchor = readFileSync(path.join(ROOT, 'primitives/TocAnchor.tsx'), 'utf8');
    expect(anchor).toMatch(/collect\?: TocAnchorCollector \| null/);
  });
});
