// DTO serializable de un hecho para cruzar el borde RSC→Client (fechas como
// ISO strings, sin objetos Date ni tipos de Drizzle en el cliente).

import type { WorkspaceFact } from '@/lib/db/schema';
import type { FactKind } from '@/lib/facts/contracts';

export interface FactDTO {
  id: string;
  kind: FactKind;
  title: string;
  body: string;
  structured: Record<string, unknown> | null;
  fiscalPeriod: string | null;
  status: 'active' | 'revoked';
  supersededById: string | null;
  source: 'chat' | 'manual';
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
}

export function toFactDTO(fact: WorkspaceFact): FactDTO {
  return {
    id: fact.id,
    kind: fact.kind,
    title: fact.title,
    body: fact.body,
    structured: fact.structured ?? null,
    fiscalPeriod: fact.fiscalPeriod ?? null,
    status: fact.status,
    supersededById: fact.supersededById ?? null,
    source: fact.source,
    createdAt: fact.createdAt.toISOString(),
    updatedAt: fact.updatedAt.toISOString(),
    revokedAt: fact.revokedAt ? fact.revokedAt.toISOString() : null,
  };
}
