// ---------------------------------------------------------------------------
// Futuro — contenido bilingüe de fuentes de datos + zonas de capacidades.
// ---------------------------------------------------------------------------
// Co-localizado (no en dictionaries.ts) porque incluye iconos lucide. Consumido
// por FuturoArea vía DataSourceLadder + CapabilityZones.
// ---------------------------------------------------------------------------

import {
  FileSpreadsheet,
  ClipboardList,
  Plug,
  Globe,
  CandlestickChart,
  Atom,
  Leaf,
} from 'lucide-react';

import type { DataSourceItem, CapabilityZoneItem } from '../shared/types';

export function getFuturoSources(lang: 'es' | 'en'): DataSourceItem[] {
  const es = lang === 'es';
  return [
    { key: 'balance', name: es ? 'Balance de prueba' : 'Trial balance', icon: FileSpreadsheet, active: true, capabilities: 10, badgeSuffix: es ? 'activas' : 'active' },
    { key: 'auxiliares', name: es ? 'Auxiliares por tercero' : 'Subledgers by party', icon: ClipboardList, active: false, capabilities: 4, badgeSuffix: es ? 'se activan' : 'unlock' },
    { key: 'erp', name: es ? 'ERP tiempo real' : 'Real-time ERP', icon: Plug, active: false, capabilities: 5, badgeSuffix: es ? 'en vivo' : 'live' },
    { key: 'apiDIAN', name: es ? 'API Banrep · DANE' : 'Banrep · DANE API', icon: Globe, active: false, capabilities: 4, badgeSuffix: es ? 'macro' : 'macro' },
    { key: 'apiBanco', name: es ? 'Bloomberg · BVC' : 'Bloomberg · BVC', icon: CandlestickChart, active: false, capabilities: 3, badgeSuffix: es ? 'globales' : 'global' },
  ];
}

export function getFuturoZones(lang: 'es' | 'en'): CapabilityZoneItem[] {
  const es = lang === 'es';
  return [
    {
      icon: Atom,
      accent: 'futuro',
      name: es ? 'Modelado cuantitativo avanzado' : 'Advanced quantitative modeling',
      subtitle: es ? 'Monte Carlo · opciones reales · stress testing' : 'Monte Carlo · real options · stress testing',
      count: es ? '5 modelos' : '5 models',
      capabilities: [
        { name: es ? 'Monte Carlo 10.000 escenarios' : 'Monte Carlo 10,000 scenarios', desc: es ? 'Distribución probabilidad · P10, P50, P90 · confianza.' : 'Probability distribution · P10, P50, P90 · confidence.', source: 'balance' },
        { name: es ? 'Opciones reales (ROV)' : 'Real options (ROV)', desc: es ? 'Valor de opción de expandir · diferir · abandonar.' : 'Option value to expand · defer · abandon.', source: 'balance' },
        { name: es ? 'Stress testing financiero' : 'Financial stress testing', desc: es ? 'Escenarios de choque · impacto en solvencia.' : 'Shock scenarios · impact on solvency.', source: 'balance' },
        { name: es ? 'Proyecciones 3 escenarios' : '3-scenario projections', desc: es ? 'Conservador · base · agresivo año por año.' : 'Conservative · base · aggressive year by year.', source: 'balance' },
        { name: es ? 'Roadmap Capex · TIR · VPN' : 'Capex roadmap · IRR · NPV', desc: es ? 'Priorización inversiones · período de recuperación.' : 'Investment prioritization · payback period.', source: 'balance' },
      ],
    },
    {
      icon: Globe,
      accent: 'info',
      name: es ? 'Inteligencia estratégica y de mercado' : 'Strategic & market intelligence',
      subtitle: es ? 'BCG · Porter · TAM/SAM/SOM · posicionamiento' : 'BCG · Porter · TAM/SAM/SOM · positioning',
      count: es ? '6 análisis' : '6 analyses',
      capabilities: [
        { name: es ? 'BCG Matrix posicionamiento' : 'BCG Matrix positioning', desc: es ? 'Estrella · vaca · interrogante · perro.' : 'Star · cash cow · question mark · dog.', source: 'balance' },
        { name: es ? 'Porter 5 fuerzas scoring' : 'Porter 5 forces scoring', desc: es ? 'Cuantificación cada fuerza · atractivo sector 0-10.' : 'Quantification of each force · sector attractiveness 0-10.', source: 'balance' },
        { name: es ? 'TAM · SAM · SOM' : 'TAM · SAM · SOM', desc: es ? 'Tamaño total del mercado · alcanzable · objetivo.' : 'Total addressable market · serviceable · obtainable.', source: 'balance' },
        { name: es ? 'OKRs y KPIs cascade' : 'OKRs & KPIs cascade', desc: es ? 'Objetivos estratégicos · resultados clave · semáforo.' : 'Strategic objectives · key results · traffic light.', source: 'balance' },
        { name: es ? 'IPO Readiness Score' : 'IPO Readiness Score', desc: es ? 'Qué tan lista está la empresa para bolsa · 0-100.' : 'How ready the company is for the stock market · 0-100.', source: 'balance' },
        { name: es ? 'Macro Colombia · PIB · TRM · IBR' : 'Colombia macro · GDP · TRM · IBR', desc: es ? 'Proyecciones Banrep + DANE integradas.' : 'Banrep + DANE integrated projections.', source: 'apiDIAN' },
      ],
    },
    {
      icon: Leaf,
      accent: 'success',
      name: es ? 'Sostenibilidad y futuro del negocio' : 'Sustainability & business future',
      subtitle: es ? 'ESG · GRI · working capital · factibilidad' : 'ESG · GRI · working capital · feasibility',
      count: es ? '5 análisis' : '5 analyses',
      capabilities: [
        { name: es ? 'Proyecciones ESG · GRI' : 'ESG · GRI projections', desc: es ? 'Ambiental · social · gobernanza · reporte integrado.' : 'Environmental · social · governance · integrated report.', source: 'balance' },
        { name: es ? 'Working capital optimization' : 'Working capital optimization', desc: es ? 'Ciclo de caja óptimo · liberación capital trabajo.' : 'Optimal cash cycle · working capital release.', source: 'balance' },
        { name: es ? 'Estudios de factibilidad IA' : 'AI feasibility studies', desc: es ? 'Técnica · financiera · mercado · legal · ambiental.' : 'Technical · financial · market · legal · environmental.', source: 'balance' },
        { name: es ? 'Balanced Scorecard' : 'Balanced Scorecard', desc: es ? '4 perspectivas · indicadores · semáforo ejecutivo.' : '4 perspectives · indicators · executive traffic light.', source: 'balance' },
        { name: es ? 'Análisis macro-sector' : 'Macro-sector analysis', desc: es ? 'Ciclo económico · correlación sector vs macro.' : 'Economic cycle · sector vs macro correlation.', source: 'erp' },
      ],
    },
  ];
}
