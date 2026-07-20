// /workspace/contexto — Panel "Contexto de la empresa" (Hechos del negocio, Ola 1D).
// Server Component: resuelve el workspace del cookie, lee los hechos y los pasa
// (mapeados a DTO serializable) al panel cliente. Fallback vacío si algo falla
// server-side (patrón de comando/page.tsx — nunca pantalla blanca).

import { getOrCreateWorkspace } from '@/lib/db/workspace';
import { listFacts } from '@/lib/db/facts';
import { toFactDTO } from '@/lib/facts/dto';
import { ContextoPanel } from '@/components/workspace/contexto/ContextoPanel';

export const dynamic = 'force-dynamic'; // el cookie de workspace obliga SSR per request

export default async function ContextoPage() {
  try {
    const ws = await getOrCreateWorkspace();
    const facts = await listFacts(ws.id);
    return <ContextoPanel facts={facts.map(toFactDTO)} />;
  } catch (err) {
    console.warn('[/workspace/contexto] fallback vacío:', err);
    return <ContextoPanel facts={[]} />;
  }
}
