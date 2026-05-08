'use client';

/**
 * PresumedCostWarning — callout R7 del Curator NIIF.
 * Advierte cuando el margen bruto observado supera el umbral y el costo de
 * ventas reportado parece subestimado. Vive en el Pilar Valor porque es un
 * indicador de valoración.
 *
 * Estilo: Glass Card — replica el patrón de ValorMicroDashboard / _alerts-list.
 * Paleta: área `valor`, ink `text-n-1000` sobre fondo glass.
 */

import { AlertTriangle } from 'lucide-react';

import { Card } from '@/components/ui/Card';
import { useLanguage } from '@/context/LanguageContext';
import type { PresumedCostWarning as PresumedCostWarningData } from '@/lib/preprocessing/curator-rules/types';

// ---------------------------------------------------------------------------
// Helpers de formato colombiano
// ---------------------------------------------------------------------------

function formatCOP(value: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPct(value: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PresumedCostWarningProps {
  warning: PresumedCostWarningData;
  density?: 'comfortable' | 'compact';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PresumedCostWarning({ warning, density = 'comfortable' }: PresumedCostWarningProps) {
  const { language } = useLanguage();
  const isEs = language === 'es';

  const labels = {
    observedMargin: isEs ? 'Margen bruto observado:' : 'Observed gross margin:',
    reportedCogs: isEs ? 'Costo de Ventas reportado:' : 'Reported Cost of Sales:',
    presumedCogs: isEs ? 'Costo de Ventas presunto:' : 'Presumed Cost of Sales:',
    closingInventory: isEs ? 'Inventario al cierre:' : 'Closing inventory:',
  };

  const metrics: Array<{ label: string; value: string }> = [
    { label: labels.observedMargin, value: formatPct(warning.observedGrossMargin) },
    { label: labels.reportedCogs, value: formatCOP(warning.reportedCogsCop) },
    { label: labels.presumedCogs, value: formatCOP(warning.presumedCogsCop) },
    { label: labels.closingInventory, value: formatCOP(warning.inventoryCop) },
  ];

  return (
    <Card variant="glass" padding={density === 'compact' ? 'sm' : 'md'}>
      {/* Header */}
      <div className="flex items-start gap-2.5 mb-3">
        <AlertTriangle
          className="h-5 w-5 shrink-0 mt-0.5 text-warning"
          aria-hidden="true"
        />
        <h3 className="font-serif-elite text-base font-semibold text-n-1000 leading-snug">
          {warning.calloutTitle}
        </h3>
      </div>

      {/* Body */}
      <p className="text-sm text-n-700 leading-relaxed mb-4">
        {warning.calloutBody}
      </p>

      {/* Cifras clave */}
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 border-t border-n-200 pt-3">
        {metrics.map(({ label, value }) => (
          <div key={label} className="flex items-baseline justify-between gap-2">
            <dt className="text-xs text-n-600 leading-relaxed">{label}</dt>
            <dd className="text-xs-mono font-medium text-n-1000 tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

export default PresumedCostWarning;
