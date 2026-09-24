// TocAnchor.tsx — marca la página en la que empieza una sección del informe.
// ───────────────────────────────────────────────────────────────────────────
// Auditoría 2026-09-24 (reportes-export-21): la tabla de contenido no tenía
// números de página. react-pdf no expone la paginación antes de maquetar, así
// que `render.ts` maqueta el documento una vez con un recolector en
// `TocAnchorContext`, lee en qué página cayó cada ancla y vuelve a maquetar
// con los números en la tabla de contenido (`resolveTocEntries`).
//
// El ancla es un `<Text>` vacío, absoluto y sin tamaño: no mueve el layout.
// Su `render` prop recibe el número de página real al maquetar.
// ───────────────────────────────────────────────────────────────────────────

import * as React from 'react';
import { Text } from '@react-pdf/renderer';
import type { TocAnchorId } from '../types';

/** Recolector de anclas: `null` fuera de la pasada de medición. */
export type TocAnchorCollector = (anchor: TocAnchorId, pageNumber: number) => void;

export const TocAnchorContext = React.createContext<TocAnchorCollector | null>(null);

export interface TocAnchorProps {
  id: TocAnchorId;
}

/** Colóquese como PRIMER hijo de la `<Page>` que abre la sección. */
export function TocAnchor({ id }: TocAnchorProps): React.ReactElement {
  const collect = React.useContext(TocAnchorContext);
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
