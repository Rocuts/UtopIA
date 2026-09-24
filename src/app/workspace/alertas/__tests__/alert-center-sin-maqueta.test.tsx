// e2e-niif-15 (re-auditoría, 2026-09-24) — /workspace/alertas (enlazado desde
// la Bandeja Insight del header) mostraba siempre 6 alertas fijas «detectadas
// por la IA» con cifras presentadas como datos del cliente ($1.240M en saldos
// a favor, tasa efectiva 28,4 %, TRM $4.300, «NIT dígito 7 · vence en 6
// días»). Ahora lista las alertas reales del Centinela (/api/sentinel/alerts)
// o un estado vacío/errores rotulados; las suscripciones (que no persistían)
// quedan rotuladas «Módulo en preparación».
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const state = vi.hoisted(() => ({ lang: 'es' as 'es' | 'en' }));

vi.mock('@/context/LanguageContext', async () => {
  const { dict } = await vi.importActual<typeof import('@/lib/i18n/dictionaries')>('@/lib/i18n/dictionaries');
  return { useLanguage: () => ({ language: state.lang, t: dict[state.lang], setLanguage: () => {} }) };
});

import AlertasPage from '../page';
import { AlertCenterView, type AlertCenterItem } from '../AlertCenterView';

const text = (html: string) =>
  html.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ');

const CIFRAS_MAQUETA = [/1\.240M/, /28,4\s?%/, /4\.300/, /NIT dígito 7/, /detectados por la IA/i, /28 a 24 meses/];

const ALERTA: AlertCenterItem = {
  id: 'a-1',
  pillar: 'escudo',
  severity: 'informativo',
  status: 'pending',
  subject: 'Sin gasto de renta causado — requiere depuración fiscal',
  hallazgo: 'escudo.fiscal.alert.a5_sin_provision',
  createdAt: '2026-09-20T10:00:00.000Z',
};

describe('/workspace/alertas — sin alertas de maqueta', () => {
  it('el código de la página no contiene las cifras literales de la maqueta', () => {
    const src = readFileSync(join(__dirname, '..', 'page.tsx'), 'utf-8');
    for (const re of CIFRAS_MAQUETA) expect(src).not.toMatch(re);
    expect(src).toContain('/api/sentinel/alerts');
  });

  it('render inicial (cargando): ninguna alerta fija ni cifra de maqueta; suscripciones rotuladas en preparación', () => {
    state.lang = 'es';
    const html = text(renderToStaticMarkup(<AlertasPage />));
    for (const re of CIFRAS_MAQUETA) expect(html).not.toMatch(re);
    expect(html).toContain('Centro de Alertas');
    expect(html).toContain('Módulo en preparación');
    expect(html).not.toMatch(/Renta Grandes Contribuyentes|Saldo a favor IVA sin radicar/);
  });

  it('estado vacío: rótulo visible y sin cifras', () => {
    const html = text(
      renderToStaticMarkup(
        <AlertCenterView status="ready" alerts={[]} filter="todas" onFilter={() => {}} />,
      ),
    );
    expect(html).toContain('Sin alertas activas');
    expect(html).not.toMatch(/\d{1,3}(\.\d{3})+/);
  });

  it('error de carga: mensaje explícito, no una lista inventada', () => {
    const html = text(
      renderToStaticMarkup(<AlertCenterView status="error" alerts={[]} filter="todas" onFilter={() => {}} />),
    );
    expect(html).toContain('No fue posible cargar las alertas');
  });

  it('alertas reales del Centinela: muestra el asunto y oculta claves i18n crudas', () => {
    const html = text(
      renderToStaticMarkup(
        <AlertCenterView status="ready" alerts={[ALERTA]} filter="todas" onFilter={() => {}} />,
      ),
    );
    expect(html).toContain('Sin gasto de renta causado — requiere depuración fiscal');
    expect(html).not.toContain('escudo.fiscal.alert.a5_sin_provision');
    expect(html).toMatch(/Informativa/);
  });

  it('inglés: textos traducidos', () => {
    state.lang = 'en';
    const html = text(
      renderToStaticMarkup(<AlertCenterView status="ready" alerts={[]} filter="todas" onFilter={() => {}} />),
    );
    expect(html).toContain('Alert Center');
    expect(html).toContain('No active alerts');
    state.lang = 'es';
  });
});
