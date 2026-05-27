// ---------------------------------------------------------------------------
// Fiscal Anchor — Block Builder
// ---------------------------------------------------------------------------
// Ensambla el `FiscalAnchorBlock` final (string MoneyCop + porcentajes) y
// expone el renderer Markdown estilo banner `═══` análogo al Âncora NIIF.
// ---------------------------------------------------------------------------

import {
  formatCopFromCents,
  serializeMoneyCop,
} from '@/lib/agents/financial/contracts/money';
import { LEGAL_DISCLAIMER_F02_ES } from '../legal-strings';
import type { FiscalAnchorBlock } from './types';
import type { FiscalDerivedMetrics } from './internal-types';

export interface BuildFiscalAnchorBlockShellInput {
  metrics: FiscalDerivedMetrics;
  calendarioDian: FiscalAnchorBlock['calendarioDian'];
  alertas: FiscalAnchorBlock['alertas'];
  fuente: FiscalAnchorBlock['fuente'];
}

/**
 * Convierte los métricos BigInt a la representación pública (string MoneyCop)
 * y empaqueta el bloque público.
 */
export function buildFiscalAnchorBlockShell(
  input: BuildFiscalAnchorBlockShellInput,
): FiscalAnchorBlock {
  const { metrics, calendarioDian, alertas, fuente } = input;
  return {
    f01: serializeMoneyCop(metrics.f01Cents),
    f02: serializeMoneyCop(metrics.f02Cents),
    f03: serializeMoneyCop(metrics.f03Cents),
    f04: serializeMoneyCop(metrics.f04Cents),
    f05: serializeMoneyCop(metrics.f05Cents),
    f06: serializeMoneyCop(metrics.f06Cents),
    f07: serializeMoneyCop(metrics.f07Cents),
    f08: serializeMoneyCop(metrics.f08Cents),
    f09: metrics.f09Pct,
    f10: metrics.f10Pct,
    calendarioDian,
    alertas,
    fuente,
  };
}

// ---------------------------------------------------------------------------
// Markdown renderer — banner ═══ idéntico al estilo `buildBindingTotalsBlock`
// ---------------------------------------------------------------------------

function fmtPct(pct: number): string {
  return `${pct.toFixed(1).replace('.', ',')}%`;
}

export function buildFiscalAnchorBlockMarkdown(block: FiscalAnchorBlock): string {
  const lines: string[] = [];
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('## BLOQUE ÂNCORA FISCAL — F01..F10 (Capa 1 · El Escudo)');
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('');
  lines.push(`- F01 · UAI contable: ${formatCopFromCents(BigInt(block.f01))}`);
  lines.push(`- F02 · Impuesto referencia 35% (Art. 240 E.T.): ${formatCopFromCents(BigInt(block.f02))}`);
  lines.push(`- F03 · Retenciones a favor (Cta.1355 + Cta.1805): ${formatCopFromCents(BigInt(block.f03))}`);
  lines.push(`- F04 · Saldo neto (F02 − F03): ${formatCopFromCents(BigInt(block.f04))}  [positivo = a pagar; negativo = saldo a favor Art. 850 E.T.]`);
  lines.push(`- F05 · IVA por pagar (|Cta.2408|): ${formatCopFromCents(BigInt(block.f05))}`);
  lines.push(`- F06 · Retefuente por declarar (|Cta.2365|): ${formatCopFromCents(BigInt(block.f06))}`);
  lines.push(`- F07 · ICA por pagar (|Cta.2368|): ${formatCopFromCents(BigInt(block.f07))}`);
  lines.push(`- F08 · Total pasivos fiscales (|Grupo 24|): ${formatCopFromCents(BigInt(block.f08))}`);
  lines.push(`- F09 · Tasa efectiva tributación (Clase54 / F01): ${fmtPct(block.f09)}`);
  lines.push(`- F10 · Eficiencia fiscal (F03 / F02): ${fmtPct(block.f10)}`);
  lines.push('');
  lines.push('### Calendario DIAN');
  lines.push(`- NIT: ${block.calendarioDian.nit || '(no disponible)'} · último dígito: ${block.calendarioDian.ultimoDigito >= 0 ? block.calendarioDian.ultimoDigito : '(verificar)'} · periodo ${block.calendarioDian.periodo}`);
  for (const v of block.calendarioDian.vencimientos) {
    lines.push(
      `  - ${v.obligacion} (${v.frecuencia}) → ${v.proximoVencimiento} · ${v.diasRestantes} días · estado=${v.estado} · base=${v.baseCcv} · valor≈${formatCopFromCents(BigInt(v.valorEstimado))} · ${v.norma}`,
    );
  }

  if (block.alertas.length > 0) {
    lines.push('');
    lines.push('### Alertas');
    for (const a of block.alertas) {
      lines.push(`  - [${a.severidad.toUpperCase()} · ${a.codigo}] ${a.mensaje} (${a.norma})`);
    }
  }
  lines.push('');
  lines.push('### Aviso legal (defensa Art. 647 E.T.)');
  for (const paragraph of LEGAL_DISCLAIMER_F02_ES.split('\n')) {
    lines.push(`> ${paragraph}`);
  }
  lines.push('');
  lines.push(`Fuente: periodo=${block.fuente.periodo} · hash=${block.fuente.balanceHash}`);
  lines.push('═══════════════════════════════════════════════════════════════');
  return lines.join('\n');
}
