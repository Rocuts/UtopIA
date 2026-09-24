// ─── ingesta-18: SyncModal ↔ /api/erp/sync ───────────────────────────────────
// Antes la UI enviaba {provider, options, year}, el endpoint exigía
// credentials + syncType y respondía 400 siempre; además prometía "Datos
// importados" y "Crear Reporte NIIF con estos datos" aunque nada se guarda.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

  it('no afirma que los datos se importaron ni ofrece un reporte con ellos', () => {
    expect(syncModal).not.toMatch(/Datos importados exitosamente/);
    expect(syncModal).not.toMatch(/Crear Reporte NIIF con estos datos/);
    expect(syncModal).toMatch(/todavía no se guardan/);
  });

  it('muestra el motivo cuando el balance leído no es completo', () => {
    expect(syncModal).toMatch(/balanceStatus !== 'complete'/);
    expect(syncModal).toMatch(/trialBalanceNote/);
  });
});
