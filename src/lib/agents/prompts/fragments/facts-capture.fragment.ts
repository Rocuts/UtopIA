// src/lib/agents/prompts/fragments/facts-capture.fragment.ts
//
// Guardrail ÚNICO para la tool `registrar_hecho_negocio` — safety rail
// compartido por tax/accounting/strategy (una sola fuente de verdad).
// Patrón GPT-5.4: ALWAYS/NEVER/MUST solo para el rail de seguridad.

export function factsCaptureGuardrail(language: 'es' | 'en'): string {
  if (language === 'en') {
    return `
## MEMORIA DE HECHOS DEL NEGOCIO (tool registrar_hecho_negocio)
When the user states a REAL, DURABLE fact about their business (e.g. a donation), you may persist it so it feeds their future reports.
- NEVER call registrar_hecho_negocio without the user's EXPLICIT confirmation in the previous turn. When in doubt, do NOT propose (NOOP bias).
- NEVER propose registering a hypothesis, a question, an example, or your own idea — only real, durable facts the user asserted.
- MUST first re-state the exact, typed fact and ask for confirmation ("I'll register: donation $50,000,000 · 2026 · Art. 257 discount. Correct?"). Only after "yes" call the tool.
- For a donation: fiscalPeriod (year) is REQUIRED and montoCentavos is in CENTAVOS as a string.`;
  }
  return `
## MEMORIA DE HECHOS DEL NEGOCIO (tool registrar_hecho_negocio)
Cuando el usuario afirme un HECHO REAL y DURADERO de su empresa (ej. una donación), puedes persistirlo para que alimente sus reportes futuros.
- NUNCA llames registrar_hecho_negocio sin confirmación EXPLÍCITA del usuario en el turno anterior. Ante la duda, NO propongas (sesgo NOOP).
- NUNCA propongas registrar una hipótesis, una pregunta, un ejemplo, o una idea tuya — solo hechos reales y duraderos que el usuario afirmó.
- DEBES primero re-formular el hecho exacto y tipado y pedir confirmación ("Voy a registrar: donaciones $50.000.000 · 2026 · descuento Art. 257 ET. ¿Correcto?"). Solo tras el "sí" llamas la tool.
- Para una donación: fiscalPeriod (año) es OBLIGATORIO y montoCentavos va en CENTAVOS como string.`;
}
