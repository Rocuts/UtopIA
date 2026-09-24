// V7a-extra-01 / valoracion-03 — Las subpáginas de área eran maquetas con
// cifras literales (saldo a favor $1.240M, ahorro proyectado $420M, TEF 28,4 %,
// tasa de éxito 92 %, valor de salida $4.820M, WACC 13,2 %…) sin rótulo de
// demostración. Deben mostrar el rótulo "Módulo en preparación — sin datos de
// su empresa" y ninguna cifra presentada como dato del cliente.
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
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
vi.mock('@/context/WorkspaceContext', () => ({
  useWorkspace: () => ({ openIntakeForType: () => {} }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import AgenteFiscal from '../escudo/agente-fiscal/page';
import DefensaDian from '../escudo/defensa-dian/page';
import Devoluciones from '../escudo/devoluciones/page';
import Planeacion from '../escudo/planeacion-tributaria/page';
import Precios from '../escudo/precios-transferencia/page';
import Supervivencia from '../escudo/supervivencia/page';
import DueDiligence from '../valor/due-diligence/page';
import InteligenciaFinanciera from '../valor/inteligencia-financiera/page';
import Valoracion from '../valor/valoracion/page';
import ConciliacionFiscal from '../verdad/conciliacion-fiscal/page';
import Dictamenes from '../verdad/dictamenes/page';
import RevisoriaFiscal from '../verdad/revisoria-fiscal/page';

const PAGES: Array<[string, () => ReactNode]> = [
  ['escudo/agente-fiscal', AgenteFiscal],
  ['escudo/defensa-dian', DefensaDian],
  ['escudo/devoluciones', Devoluciones],
  ['escudo/planeacion-tributaria', Planeacion],
  ['escudo/precios-transferencia', Precios],
  ['escudo/supervivencia', Supervivencia],
  ['valor/due-diligence', DueDiligence],
  ['valor/inteligencia-financiera', InteligenciaFinanciera],
  ['valor/valoracion', Valoracion],
  ['verdad/conciliacion-fiscal', ConciliacionFiscal],
  ['verdad/dictamenes', Dictamenes],
  ['verdad/revisoria-fiscal', RevisoriaFiscal],
];

/** Texto visible (sin etiquetas ni atributos). */
function visibleText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ');
}

// Montos ($1.240M, $890.000.000), porcentajes (92%, 24,0 %, 28.4%) y cuentas de
// casos ("2 en curso", "14") presentados como dato.
const MONEY = /\$\s?\d/;
const PERCENT = /\d+(?:[.,]\d+)?\s?%/;

describe('Subpáginas de área sin cifras literales', () => {
  for (const [name, Page] of PAGES) {
    it(`${name}: rótulo visible y sin montos/porcentajes (es)`, () => {
      langRef.value = 'es';
      const text = visibleText(renderToStaticMarkup(<Page />));
      expect(text).toContain('Módulo en preparación — sin datos de su empresa');
      expect(text).not.toMatch(MONEY);
      expect(text).not.toMatch(PERCENT);
      expect(text).not.toMatch(/Grupo 2tres/i);
    });

    it(`${name}: rótulo visible (en)`, () => {
      langRef.value = 'en';
      const text = visibleText(renderToStaticMarkup(<Page />));
      expect(text).toContain('Module in preparation — no data from your company');
      expect(text).not.toMatch(MONEY);
      expect(text).not.toMatch(PERCENT);
    });
  }
});
