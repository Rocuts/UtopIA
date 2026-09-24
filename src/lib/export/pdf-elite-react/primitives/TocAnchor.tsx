// TocAnchor.tsx — marca la página en la que empieza una sección del informe.
// ───────────────────────────────────────────────────────────────────────────
// Auditoría 2026-09-24 (reportes-export-21): la tabla de contenido no tenía
// números de página. react-pdf no expone la paginación antes de maquetar, así
// que `render.ts` maqueta el documento una vez con un recolector
// (`EditorialReport.tocCollector`), lee en qué página cayó cada ancla y vuelve
// a maquetar con los números en la tabla de contenido (`resolveTocEntries`).
// Sin contexto de React ni hooks: las rutas de Next empaquetan React con la
// condición `react-server`, que no expone `createContext`.
//
// El ancla es un `<Text>` vacío, absoluto y sin tamaño: no mueve el layout.
// Su `render` prop recibe el número de página real al maquetar.
// ───────────────────────────────────────────────────────────────────────────

import * as React from 'react';
import { Text } from '@react-pdf/renderer';
import type { TocAnchorCollector, TocAnchorId } from '../types';

export type { TocAnchorCollector } from '../types';

export interface TocAnchorProps {
  id: TocAnchorId;
  /** Recolector de la pasada de medición; ausente o `null` fuera de ella. */
  collect?: TocAnchorCollector | null;
}

/** Colóquese como PRIMER hijo de la `<Page>` que abre la sección. */
export function TocAnchor({ id, collect }: TocAnchorProps): React.ReactElement {
  return (
    <Text
      style={{ position: 'absolute', top: 0, left: 0, fontSize: 1, width: 1, height: 1 }}
      render={({ pageNumber }) => {
        collect?.(id, pageNumber);
        return '';
      }}
    />
  );
}
