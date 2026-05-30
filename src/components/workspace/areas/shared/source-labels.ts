// ---------------------------------------------------------------------------
// Etiquetas bilingües de las fuentes de datos — compartidas por las 4 áreas.
// ---------------------------------------------------------------------------

import type { SourceKey } from './types';

export function getSourceLabels(lang: 'es' | 'en'): Record<SourceKey, string> {
  return lang === 'es'
    ? {
        balance: 'Balance',
        auxiliares: 'Auxiliares',
        erp: 'ERP',
        apiDIAN: 'API DIAN',
        apiBanco: 'API Banco',
        pronto: 'Próximamente',
      }
    : {
        balance: 'Trial balance',
        auxiliares: 'Subledgers',
        erp: 'ERP',
        apiDIAN: 'DIAN API',
        apiBanco: 'Bank API',
        pronto: 'Coming soon',
      };
}
