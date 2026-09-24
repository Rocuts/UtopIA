// ─── ingesta-18: SyncModal ↔ /api/erp/sync ───────────────────────────────────
// Antes la UI enviaba {provider, options, year}, el endpoint exigía
// credentials + syncType y respondía 400 siempre; además prometía "Datos
// importados" y "Crear Reporte NIIF con estos datos" aunque nada se guarda.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { dict } from '@/lib/i18n/dictionaries';

const src = readFileSync(resolve(__dirname, '../ERPConnector.tsx'), 'utf8');
const syncModal = src.slice(src.indexOf('function SyncModal('), src.indexOf('// ─── Format helpers'));

describe('SyncModal — contrato con /api/erp/sync', () => {
  it('envía provider, syncTypes y period (credenciales resueltas en el servidor)', () => {
    const body = syncModal.slice(syncModal.indexOf("fetch('/api/erp/sync'"), syncModal.indexOf('const data = await response.json()'));
    expect(body).toMatch(/provider: provider\.id/);
    expect(body).toMatch(/\bsyncTypes\b/);
    expect(body).toMatch(/period: String\(year\)/);
    expect(body).not.toMatch(/\boptions:/);
    expect(body).not.toMatch(/credentials/);
  });

  // W3-C: el aviso pasó al diccionario (t.erp.notPersistedNote, es/en); la
  // prueba verifica la clave y su texto en vez del literal en el componente.
  it('no afirma que los datos se importaron ni ofrece un reporte con ellos', () => {
    expect(syncModal).not.toMatch(/Datos importados exitosamente/);
    expect(syncModal).not.toMatch(/Crear Reporte NIIF con estos datos/);
    expect(syncModal).toMatch(/t\.erp\.notPersistedNote/);
    expect(dict.es.erp.notPersistedNote).toMatch(/todavía no se guardan/);
    expect(dict.en.erp.notPersistedNote).toMatch(/not stored or used in reports yet/);
  });

  it('usa las claves t.erp (es/en) en lugar de español literal (ingesta-18)', () => {
    expect(syncModal).toMatch(/t\.erp\.recordsRead/);
    expect(syncModal).not.toMatch(/registros leídos desde/);
    expect(syncModal).toMatch(/\{t\.erp\.close\}/);
    expect(syncModal).not.toMatch(/>\s*Cerrar\s*</);
    expect(src).not.toMatch(/aria-label="Cerrar"/);
    expect(src).not.toMatch(/Última lectura:/);
    expect(src).toMatch(/t\.erp\.lastRead/);
  });

  it('muestra el motivo cuando el balance leído no es completo', () => {
    expect(syncModal).toMatch(/balanceStatus !== 'complete'/);
    expect(syncModal).toMatch(/trialBalanceNote/);
  });
});
