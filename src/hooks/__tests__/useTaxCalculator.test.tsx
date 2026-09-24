// Auditoría 2026-09 (tributario-calc-11, integración IW5b). El hook no aceptaba
// icaRate ni tipoContribuyente y no exponía ordinarioDisponible /
// ordinarioMotivoND / ordinarioBaseLegal: la UI no podía mostrar N/D ni rotular
// la tarifa de renta aplicada (Art. 241 PN / Art. 240 PJ).
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as fs from 'node:fs';
import path from 'node:path';

import { useTaxCalculator, type UseTaxCalculatorOptions, type UseTaxCalculatorReturn } from '../useTaxCalculator';

function Probe({ annual, opts }: { annual: number; opts: UseTaxCalculatorOptions }) {
  const r = useTaxCalculator(annual, opts);
  return <pre>{JSON.stringify(r)}</pre>;
}

/** Renderiza el hook y devuelve su resultado serializado. */
function run(annual: number, opts: UseTaxCalculatorOptions): UseTaxCalculatorReturn {
  const html = renderToStaticMarkup(<Probe annual={annual} opts={opts} />);
  const json = html
    .replace(/^<pre>|<\/pre>$/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
  return JSON.parse(json) as UseTaxCalculatorReturn;
}

describe('useTaxCalculator', () => {
  it('sin margen ni ICA la cifra ordinaria no está disponible y trae el motivo', () => {
    const r = run(120_000_000, { group: 'tiendas' });
    expect(r.ordinarioDisponible).toBe(false);
    expect(r.ordinarioMotivoND).toMatch(/margen de utilidad/);
    expect(r.ordinarioMotivoND).toMatch(/ICA/);
    expect(r.recommended).toBeNull();
  });

  it('reenvía icaRate, margin y tipoContribuyente al calculador', () => {
    const pn = run(120_000_000, { group: 'tiendas', margin: 0.2, icaRate: 0.00966 });
    expect(pn.ordinarioDisponible).toBe(true);
    expect(pn.ordinarioMotivoND).toBeNull();
    expect(pn.ordinarioBaseLegal).toMatch(/Art\. 241/);

    const pj = run(120_000_000, {
      group: 'tiendas',
      margin: 0.2,
      icaRate: 0.00966,
      tipoContribuyente: 'persona_juridica',
    });
    expect(pj.ordinarioBaseLegal).toMatch(/Art\. 240/);
    expect(pj.ordinario).toBeGreaterThan(pn.ordinario);
  });

  it('la docstring no llama «tope» del SIMPLE al umbral de IVA de 3.500 UVT', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/hooks/useTaxCalculator.ts'), 'utf8');
    expect(src).not.toMatch(/183\.309\.000 de tope/);
    expect(src).not.toMatch(/rst ≈ 1\.842\.250/);
  });
});
