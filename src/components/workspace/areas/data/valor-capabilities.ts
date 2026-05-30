// ---------------------------------------------------------------------------
// Valor — contenido bilingüe de fuentes de datos + zonas de capacidades.
// ---------------------------------------------------------------------------
// Co-localizado (no en dictionaries.ts) porque incluye iconos lucide. Consumido
// por ValorArea vía DataSourceLadder + CapabilityZones.
// ---------------------------------------------------------------------------

import {
  FileSpreadsheet,
  ClipboardList,
  Plug,
  Building2,
  CandlestickChart,
  Calculator,
  Building,
  FileCheck,
} from 'lucide-react';

import type { DataSourceItem, CapabilityZoneItem } from '../shared/types';

export function getValorSources(lang: 'es' | 'en'): DataSourceItem[] {
  const es = lang === 'es';
  return [
    { key: 'balance', name: es ? 'Balance de prueba' : 'Trial balance', icon: FileSpreadsheet, active: true, capabilities: 10, badgeSuffix: es ? 'activas' : 'active' },
    { key: 'auxiliares', name: es ? 'Auxiliares por tercero' : 'Subledgers by party', icon: ClipboardList, active: false, capabilities: 5, badgeSuffix: es ? 'se activan' : 'unlock' },
    { key: 'erp', name: es ? 'ERP en tiempo real' : 'Real-time ERP', icon: Plug, active: false, capabilities: 4, badgeSuffix: es ? 'en vivo' : 'live' },
    { key: 'apiDIAN', name: es ? 'Datos mercado BVC' : 'BVC market data', icon: Building2, active: false, capabilities: 3, badgeSuffix: es ? 'mercado' : 'market' },
    { key: 'apiBanco', name: 'Bloomberg · Reuters', icon: CandlestickChart, active: false, capabilities: 2, badgeSuffix: es ? 'globales' : 'global' },
  ];
}

export function getValorZones(lang: 'es' | 'en'): CapabilityZoneItem[] {
  const es = lang === 'es';
  return [
    {
      icon: Calculator,
      accent: 'gold',
      name: es ? 'Ingeniería del valor' : 'Value engineering',
      subtitle: es ? '5 metodologías · rango · sensibilidad' : '5 methodologies · range · sensitivity',
      count: es ? '6 análisis' : '6 analyses',
      capabilities: [
        { name: es ? 'DCF · Flujos descontados' : 'DCF · Discounted cash flows', desc: es ? 'Proyección 5-10 años · valor terminal · WACC.' : '5-10 year projection · terminal value · WACC.', source: 'balance' },
        { name: es ? 'Múltiplos de mercado' : 'Market multiples', desc: es ? 'EV/EBITDA · P/E · P/Ventas vs sector colombiano.' : 'EV/EBITDA · P/E · P/Sales vs Colombian sector.', source: 'balance' },
        { name: es ? 'Análisis de sensibilidad' : 'Sensitivity analysis', desc: es ? 'Tornado: cuál variable impacta más el valor.' : 'Tornado chart: which variable drives value most.', source: 'balance' },
        { name: es ? 'Rango M&A · negociación' : 'M&A range · negotiation', desc: es ? 'Precio mínimo · justo · máximo para compra/venta.' : 'Minimum · fair · maximum price for buy/sell.', source: 'balance' },
        { name: es ? 'EVA · Valor económico agregado' : 'EVA · Economic value added', desc: es ? 'Spread ROIC-WACC · generación real de valor.' : 'ROIC-WACC spread · real value creation.', source: 'balance' },
        { name: es ? 'Score atractivo inversión' : 'Investment attractiveness score', desc: es ? 'Índice 0-100 listo para fondos y banca.' : 'Index 0-100 ready for funds and banks.', source: 'balance' },
      ],
    },
    {
      icon: Building,
      accent: 'info',
      name: es ? 'Estructura de capital' : 'Capital structure',
      subtitle: es ? 'WACC · deuda · equity · dividendos' : 'WACC · debt · equity · dividends',
      count: es ? '4 análisis' : '4 analyses',
      capabilities: [
        { name: es ? 'WACC descompuesto' : 'Decomposed WACC', desc: es ? 'Kd · Ke · CAPM · beta sectorial · riesgo Colombia.' : 'Kd · Ke · CAPM · sector beta · Colombia risk premium.', source: 'balance' },
        { name: es ? 'Estructura óptima capital' : 'Optimal capital structure', desc: es ? 'Punto de mínimo WACC · deuda óptima · escudo fiscal.' : 'Minimum WACC point · optimal debt · tax shield.', source: 'balance' },
        { name: es ? 'Capacidad de dividendos' : 'Dividend capacity', desc: es ? 'Máximo distribuible sin comprometer solvencia.' : 'Maximum distributable without compromising solvency.', source: 'balance' },
        { name: es ? 'Cap table y dilución' : 'Cap table & dilution', desc: es ? 'Impacto de nuevas rondas en socios actuales.' : 'Impact of new funding rounds on existing shareholders.', source: 'auxiliares' },
      ],
    },
    {
      icon: FileCheck,
      accent: 'success',
      name: es ? 'Due Diligence e inteligencia financiera' : 'Due diligence & financial intelligence',
      subtitle: es ? 'M&A · inversión · adquisición · venta' : 'M&A · investment · acquisition · sale',
      count: es ? '5 análisis' : '5 analyses',
      capabilities: [
        { name: es ? 'Due Diligence financiero' : 'Financial due diligence', desc: es ? 'Checklist 120 puntos · semáforo de riesgos.' : '120-point checklist · risk traffic-light dashboard.', source: 'balance' },
        { name: es ? 'Quality of Earnings (QoE)' : 'Quality of Earnings (QoE)', desc: es ? 'Ajustes EBITDA · ingresos no recurrentes.' : 'EBITDA adjustments · non-recurring revenue items.', source: 'balance' },
        { name: es ? 'PPA · Purchase Price Allocation' : 'PPA · Purchase Price Allocation', desc: es ? 'Asignación del precio de compra a activos.' : 'Allocation of purchase price to acquired assets.', source: 'auxiliares' },
        { name: es ? 'ROIC vs costo de capital' : 'ROIC vs cost of capital', desc: es ? 'Generación por encima del costo de operar.' : 'Value creation above the cost of operating capital.', source: 'balance' },
        { name: es ? 'Inteligencia financiera IA' : 'AI financial intelligence', desc: es ? 'Flujo de caja predictivo · gestión tesorería.' : 'Predictive cash flow · treasury management.', source: 'balance' },
      ],
    },
  ];
}
