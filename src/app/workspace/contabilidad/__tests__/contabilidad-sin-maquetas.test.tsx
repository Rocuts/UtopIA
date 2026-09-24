// ---------------------------------------------------------------------------
// /workspace/contabilidad — sin maquetas con cifras de demostración
// ---------------------------------------------------------------------------
// Integración IW5b (auditoría 2026-09-24), hallazgo nuevo: todas las páginas
// del módulo eran maquetas con cifras literales presentadas como del cliente
// (asientos DEMO_ENTRIES, saldo libro $12.400.000, «Período actual: Junio
// 2026», 412 cuentas cargadas…), y dos flujos simulaban acciones con
// setTimeout (cerrar período, cargar saldos iniciales). Los componentes reales
// existían sin montar. Política del coordinador (misma de WP07): montar el
// componente real si funciona; si no, «Módulo en preparación — sin datos de
// su empresa», nunca números inventados.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as fs from 'node:fs';
import path from 'node:path';
import type { ReactNode } from 'react';

const langRef = vi.hoisted(() => ({ value: 'es' as 'es' | 'en' }));

vi.mock('@/context/LanguageContext', async () => {
  const { dict } = await vi.importActual<typeof import('@/lib/i18n/dictionaries')>(
    '@/lib/i18n/dictionaries',
  );
  return {
    useLanguage: () => ({ language: langRef.value, t: dict[langRef.value], setLanguage: () => {} }),
  };
});
vi.mock('@/design-system/components/Toast', () => ({ useToast: () => ({ toast: () => {} }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import Hub from '../page';
import Asientos from '../asientos/page';
import NuevoAsiento from '../asientos/nuevo/page';
import Mayor from '../mayor/page';
import Periodos from '../periodos/page';
import Conciliacion from '../conciliacion/page';
import Cuentas from '../cuentas/page';
import Apertura from '../apertura/page';

const PAGES: Array<[string, () => ReactNode]> = [
  ['page.tsx', Hub],
  ['asientos/page.tsx', Asientos],
  ['asientos/nuevo/page.tsx', NuevoAsiento],
  ['mayor/page.tsx', Mayor],
  ['periodos/page.tsx', Periodos],
  ['conciliacion/page.tsx', Conciliacion],
  ['cuentas/page.tsx', Cuentas],
  ['apertura/page.tsx', Apertura],
];

function visibleText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ');
}

const MONEY = /\$\s?\d/;
const DEMO_LITERALS = /Junio 2026|Ene 2026|12\.400\.000|12\.680\.000|Cheque 0451|412 cuentas|Saldos de demostración/;

describe('páginas de contabilidad sin cifras de maqueta', () => {
  for (const [name, Page] of PAGES) {
    for (const lang of ['es', 'en'] as const) {
      it(`${name} (${lang}): sin montos ni literales de demostración`, () => {
        langRef.value = lang;
        const text = visibleText(renderToStaticMarkup(<Page />));
        expect(text).not.toMatch(MONEY);
        expect(text).not.toMatch(DEMO_LITERALS);
      });
    }
  }

  it('el listado de asientos se declara «en preparación» con rótulo visible', () => {
    langRef.value = 'es';
    expect(visibleText(renderToStaticMarkup(<Asientos />))).toContain(
      'Módulo en preparación — sin datos de su empresa',
    );
    langRef.value = 'en';
    expect(visibleText(renderToStaticMarkup(<Asientos />))).toContain(
      'Module in preparation — no data from your company',
    );
  });

  // W3-C: la API ya expone ?view=ledger (líneas con saldo por cuenta calculado
  // en el servidor), así que el mayor monta el componente real. Antes esta
  // prueba exigía «en preparación» porque la API sólo listaba asientos.
  it('libro mayor monta LedgerView (vista de mayor de la API), sin rótulo de maqueta', () => {
    langRef.value = 'es';
    const text = visibleText(renderToStaticMarkup(<Mayor />));
    expect(text).toContain('Libro mayor');
    expect(text).not.toContain('Módulo en preparación');
    const page = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/workspace/contabilidad/mayor/page.tsx'),
      'utf8',
    );
    expect(page).toMatch(/<LedgerView \/>/);
    const view = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/workspace/accounting/LedgerView.tsx'),
      'utf8',
    );
    expect(view).toContain("params.set('view', 'ledger')");
    // El saldo viene del servidor (por cuenta, centavos exactos): nada de
    // acumular Number() en el cliente mezclando cuentas.
    expect(view).not.toMatch(/running \+=/);
  });

  it('periodos monta el gestor real y ofrece el cierre anual del período 13', () => {
    langRef.value = 'es';
    const text = visibleText(renderToStaticMarkup(<Periodos />));
    expect(text).toContain('período 13');
    expect(text).toContain('Abrir nuevo periodo');
  });

  it('nuevo asiento monta el formulario real (payload de /api/accounting/journal)', () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/workspace/contabilidad/asientos/nuevo/page.tsx'),
      'utf8',
    );
    expect(src).toMatch(/NewEntryWorkspace/);
    expect(src).not.toMatch(/cuenta:\s*l\.cuenta/);
  });

  it('ninguna página simula acciones con setTimeout ni guarda datos DEMO', () => {
    for (const [name] of PAGES) {
      const src = fs
        .readFileSync(path.resolve(process.cwd(), 'src/app/workspace/contabilidad', name), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(src, name).not.toMatch(/setTimeout\(/);
      expect(src, name).not.toMatch(/DEMO_|RECENT_ENTRIES|PREVIEW_ROWS|SALDO_LIBRO/);
    }
  });
});
