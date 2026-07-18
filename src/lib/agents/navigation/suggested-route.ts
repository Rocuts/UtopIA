// Chip de navegación contextual. Rescata domains/intent del classifier y
// sugiere UNA ruta del workspace. STUB de Ola 0: retorna null. El Equipo B
// (Ola 1) llena la tabla de mapeo determinista AQUÍ — sin tocar orchestrator.ts.
//
// El anti-ruido "no sugerir la ruta que ya estás viendo" se resuelve
// client-side en ChatSidebar (que conoce el pathname); esta función solo
// mapea señal→ruta y aplica el umbral de confianza.

import type { AgentDomain, SuggestedRoute } from '../types';

export function computeSuggestedRoute(_input: {
  domains: AgentDomain[];
  intent: string;
  confidence: number;
}): SuggestedRoute | null {
  // TODO(Equipo B, Ola 1): tabla de mapeo domain/intent → ruta + umbral confianza.
  return null;
}
