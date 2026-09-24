// ratios-kpis-12 — kpis/mocks.ts era alcanzable en producción: /workspace/verdad
// mostraba mockCompliance (95/100, 'favorable') sin cookie de workspace o con la
// DB caída, y con workspace un proxy (asientos pyme confirmados copiados a los
// ejes NIIF/tributario/legal con 0 hallazgos ⇒ 25/100 sin asientos).
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC = resolve(__dirname, '../../..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === '__tests__' || name === '__fixtures__' || name === 'node_modules') continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

describe('KPIs de demostración fuera de producción', () => {
  it('kpis/mocks.ts ya no vive junto al código de producción', () => {
    expect(existsSync(join(SRC, 'lib/kpis/mocks.ts'))).toBe(false);
  });

  it('ningún módulo de producción importa fixtures de KPIs', () => {
    const offenders = walk(SRC).filter((f) => {
      const src = readFileSync(f, 'utf8');
      if (/kpis\/(mocks|__fixtures__)/.test(src)) return true;
      // Dentro de src/lib/kpis el import sería relativo.
      return f.includes(join('lib', 'kpis')) && /from '\.\/(mocks|__fixtures__)/.test(src);
    });
    expect(offenders.map((f) => relative(SRC, f))).toEqual([]);
  });

  it('/workspace/verdad no usa mockCompliance ni el proxy de asientos pyme', () => {
    const page = readFileSync(join(SRC, 'app/workspace/verdad/page.tsx'), 'utf8');
    expect(page).not.toMatch(/mockCompliance|kpis\/mocks|getCachedPillarKpis|documentsVerifiedPct/);
    expect(page).not.toMatch(/lastOpinion="favorable"/);
  });
});
