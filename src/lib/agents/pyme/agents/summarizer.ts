// ---------------------------------------------------------------------------
// Agente summarizer — narrative mensual + alertas para reportes de Pyme.
// ---------------------------------------------------------------------------
// El narrative es markdown libre escrito por el LLM (~150-300 palabras).
// Las alertas se calculan deterministicamente en JS desde el MonthlySummary
// para evitar que el modelo invente severidades — anti-alucinacion estricta.
// ---------------------------------------------------------------------------

import 'server-only';
import { generateText } from 'ai';
import { MODELS } from '@/lib/config/models';
import { buildSummarizerPrompt } from '@/lib/agents/pyme/prompts/summarizer.prompt';
import type { MonthlySummary } from '@/lib/db/pyme';

export interface SummaryAlert {
  severity: 'info' | 'warning' | 'critical';
  message: string;
}

export interface SummaryNarrative {
  narrative: string;
  alerts: SummaryAlert[];
}

interface SummarizerContext {
  language: 'es' | 'en';
  companyName?: string;
}

// ---------------------------------------------------------------------------
// Alertas deterministicas (no LLM)
// ---------------------------------------------------------------------------

/**
 * Calcula alertas a partir de los numeros agregados. Reglas:
 *  - margenPct < 0  -> critical (perdida del mes)
 *  - cambio en margen vs mes anterior > 20% (caida) -> critical
 *  - cambio en margen vs mes anterior 10-20% (caida o subida) -> warning
 *  - egresos suben >30% sin que ingresos suban -> warning
 *  - cambios <10% -> sin alerta (no agregamos info noise)
 *
 * Mensajes bilingues; numeros se formatean con `formatPesos`.
 */
function computeAlerts(data: MonthlySummary, language: 'es' | 'en'): SummaryAlert[] {
  const isEn = language === 'en';
  const alerts: SummaryAlert[] = [];
  const { ingresos, egresos, margen, margenPct } = data.totals;

  // Regla 1: perdida del mes.
  if (margenPct < 0) {
    alerts.push({
      severity: 'critical',
      message: isEn
        ? `Loss-making month: expenses (${formatPesos(egresos)}) exceeded income (${formatPesos(ingresos)}). Net loss of ${formatPesos(Math.abs(margen))}.`
        : `Mes en perdida: los egresos (${formatPesos(egresos)}) superaron los ingresos (${formatPesos(ingresos)}). Perdida neta de ${formatPesos(Math.abs(margen))}.`,
    });
  }

  const previous = data.previous;
  if (previous && previous.ingresos > 0) {
    // Variacion del margen
    const prevMargen = previous.margen;
    if (prevMargen !== 0) {
      const margenDeltaPct = (margen - prevMargen) / Math.abs(prevMargen);
      const absDeltaPct = Math.abs(margenDeltaPct);

      if (margenDeltaPct < -0.2) {
        alerts.push({
          severity: 'critical',
          message: isEn
            ? `Margin dropped ${(absDeltaPct * 100).toFixed(0)}% vs last month (${formatPesos(prevMargen)} -> ${formatPesos(margen)}).`
            : `El margen cayo ${(absDeltaPct * 100).toFixed(0)}% vs el mes anterior (${formatPesos(prevMargen)} -> ${formatPesos(margen)}).`,
        });
      } else if (absDeltaPct >= 0.1 && absDeltaPct <= 0.2) {
        const direction = margenDeltaPct > 0
          ? (isEn ? 'rose' : 'subio')
          : (isEn ? 'fell' : 'cayo');
        alerts.push({
          severity: 'warning',
          message: isEn
            ? `Margin ${direction} ${(absDeltaPct * 100).toFixed(0)}% vs last month (${formatPesos(prevMargen)} -> ${formatPesos(margen)}).`
            : `El margen ${direction} ${(absDeltaPct * 100).toFixed(0)}% vs el mes anterior (${formatPesos(prevMargen)} -> ${formatPesos(margen)}).`,
        });
      }
    }

    // Egresos suben >30% sin que ingresos suban.
    if (previous.egresos > 0) {
      const egresosDeltaPct = (egresos - previous.egresos) / previous.egresos;
      const ingresosDeltaPct = previous.ingresos > 0
        ? (ingresos - previous.ingresos) / previous.ingresos
        : 0;
      if (egresosDeltaPct > 0.3 && ingresosDeltaPct <= 0) {
        alerts.push({
          severity: 'warning',
          message: isEn
            ? `Expenses jumped ${(egresosDeltaPct * 100).toFixed(0)}% vs last month while income did not grow.`
            : `Los egresos subieron ${(egresosDeltaPct * 100).toFixed(0)}% vs el mes anterior y los ingresos no crecieron.`,
        });
      }
    }
  }

  return alerts;
}

/** Formatea un numero como pesos colombianos: $1.234.567 */
function formatPesos(value: number): string {
  if (!Number.isFinite(value)) return '$0';
  const rounded = Math.round(value);
  const sign = rounded < 0 ? '-' : '';
  const abs = Math.abs(rounded).toString();
  const withDots = abs.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}$${withDots}`;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function summarizeMonth(
  data: MonthlySummary,
  ctx: SummarizerContext,
): Promise<SummaryNarrative> {
  const systemPrompt = buildSummarizerPrompt({
    language: ctx.language,
    companyName: ctx.companyName,
  });

  // Le pasamos el JSON tal cual — el modelo se desempena mejor con datos
  // estructurados que con prosa parafraseada.
  const userContent =
    (ctx.language === 'en' ? 'Monthly data:\n' : 'Datos del mes:\n') +
    JSON.stringify(data, null, 2);

  const result = await generateText({
    model: MODELS.CHAT,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    temperature: 0.4,
    maxOutputTokens: 1024,
  });

  const narrative = (result.text || '').trim();
  const alerts = computeAlerts(data, ctx.language);

  return { narrative, alerts };
}
