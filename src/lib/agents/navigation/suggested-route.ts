// Chip de navegación contextual. Rescata domains/intent del classifier y
// sugiere UNA ruta del workspace. Tabla de mapeo DETERMINISTA (no LLM) +
// umbral de confianza. El Equipo B (Ola 1) llenó este stub SIN tocar
// orchestrator.ts — sus dos call-sites ya pasan {domains, intent, confidence}.
//
// El anti-ruido "no sugerir la ruta que ya estás viendo" se resuelve
// client-side en ChatSidebar (que conoce el pathname); esta función solo
// mapea señal→ruta y aplica el umbral de confianza.
//
// IMPORTANTE: el `intent` del classifier es snake_case en INGLÉS
// (tax_planning, requerimiento_response, risk_assessment, …; ver
// classifier.prompt.ts). El match es por substring accent-insensitive para
// tolerar tanto inglés como variantes en español.

import type { AgentDomain, SuggestedRoute } from '../types';

// Umbral conservador (§3 spec: "empezar conservador/alto"). Por debajo NO se
// sugiere ruta. El classifier_error_fallback (confidence 0.3) queda excluido.
const CONFIDENCE_THRESHOLD = 0.75;

// minúsculas + sin diacríticos → substring-match robusto.
function normalizeIntent(intent: string): string {
  return intent
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

interface RouteRule {
  moduleKey: string;
  href: string;
  /** Etiqueta ES canónica; ChatSidebar antepone el prefijo localizado. */
  label: string;
  match: (domains: Set<AgentDomain>, intent: string) => boolean;
}

// PRIMER match gana. El orden ES la precedencia: litigio (un acto DIAN ya
// emitido) es la señal más específica y de mayor riesgo → va primero.
const ROUTE_RULES: readonly RouteRule[] = [
  {
    moduleKey: 'defensa-dian',
    href: '/workspace/escudo/defensa-dian',
    label: 'Defensa DIAN',
    match: (d, i) =>
      d.has('litigation') ||
      /dian|requerimiento|pliego|liquidacion|emplazamiento|reconsideracion|recurso|descargos|impugn|procedural_nullity|diferencia_criterio|647|appeal|defense/.test(
        i,
      ),
  },
  {
    moduleKey: 'precios-transferencia',
    href: '/workspace/escudo/precios-transferencia',
    label: 'Precios de Transferencia',
    match: (d, i) => d.has('tax') && /transferencia|precios|transfer_pric|transfer pricing/.test(i),
  },
  {
    moduleKey: 'planeacion-tributaria',
    href: '/workspace/escudo/planeacion-tributaria',
    label: 'Planeación Tributaria',
    match: (d, i) =>
      (d.has('tax') || d.has('strategy')) &&
      /planeacion|planning|optimiz|refund|devolucion|action_plan|tax_planning|refund_strategy/.test(i),
  },
  {
    moduleKey: 'valor',
    href: '/workspace/valor',
    label: 'Valor',
    match: (d, i) => d.has('strategy') && /valoracion|valuation|due.?diligence|due_diligence/.test(i),
  },
  {
    moduleKey: 'verdad',
    href: '/workspace/verdad',
    label: 'Verdad',
    match: (d, i) =>
      d.has('accounting') && /dictamen|revisoria|revisor|audit|conciliacion_fiscal|conciliacion fiscal/.test(i),
  },
  {
    moduleKey: 'futuro',
    href: '/workspace/futuro',
    label: 'Futuro',
    match: (d, i) =>
      d.has('strategy') &&
      /factibilidad|feasibility|escenario|scenario|macro|proyeccion|projection|budget_projection/.test(i),
  },
];

export function computeSuggestedRoute(input: {
  domains: AgentDomain[];
  intent: string;
  confidence: number;
}): SuggestedRoute | null {
  if (input.confidence < CONFIDENCE_THRESHOLD) return null;
  if (input.domains.length === 0) return null;

  const domains = new Set(input.domains);
  const intent = normalizeIntent(input.intent);

  for (const rule of ROUTE_RULES) {
    if (rule.match(domains, intent)) {
      return { label: rule.label, href: rule.href, moduleKey: rule.moduleKey };
    }
  }
  return null;
}
