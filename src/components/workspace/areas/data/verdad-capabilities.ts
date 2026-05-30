// ---------------------------------------------------------------------------
// La Verdad — contenido bilingüe de fuentes de datos + zonas de capacidades.
// ---------------------------------------------------------------------------
// Co-localizado (no en dictionaries.ts) porque incluye iconos lucide. Consumido
// por VerdadArea vía DataSourceLadder + CapabilityZones.
// ---------------------------------------------------------------------------

import {
  FileSpreadsheet,
  ClipboardList,
  Plug,
  Landmark,
  Building2,
  Sigma,
  ShieldCheck,
  FileBadge,
} from 'lucide-react';

import type { DataSourceItem, CapabilityZoneItem } from '../shared/types';

export function getVerdadSources(lang: 'es' | 'en'): DataSourceItem[] {
  const es = lang === 'es';
  return [
    { key: 'balance', name: es ? 'Balance de prueba' : 'Trial balance', icon: FileSpreadsheet, active: true, capabilities: 12, badgeSuffix: es ? 'activas' : 'active' },
    { key: 'auxiliares', name: es ? 'Auxiliares por tercero' : 'Subledgers by party', icon: ClipboardList, active: false, capabilities: 6, badgeSuffix: es ? 'se activan' : 'unlock' },
    { key: 'erp', name: es ? 'ERP en tiempo real' : 'Real-time ERP', icon: Plug, active: false, capabilities: 3, badgeSuffix: es ? 'continuo' : 'continuous' },
    { key: 'apiDIAN', name: 'API DIAN', icon: Landmark, active: false, capabilities: 3, badgeSuffix: es ? 'validados' : 'validated' },
    { key: 'apiBanco', name: es ? 'Registro Cámara' : 'Chamber registry', icon: Building2, active: false, capabilities: 2, badgeSuffix: es ? 'legales' : 'legal' },
  ];
}

export function getVerdadZones(lang: 'es' | 'en'): CapabilityZoneItem[] {
  const es = lang === 'es';
  return [
    {
      icon: Sigma,
      accent: 'info',
      name: es ? 'Detección avanzada de irregularidades' : 'Advanced irregularity detection',
      subtitle: es ? 'Estadística · IA · patrones anómalos' : 'Statistics · AI · anomaly patterns',
      count: es ? '5 análisis' : '5 analyses',
      capabilities: [
        { name: 'Ley de Benford', desc: es ? 'Análisis estadístico de primer dígito · fraude contable.' : 'First-digit statistical analysis · accounting fraud.', source: 'balance' },
        { name: es ? 'Triángulo del fraude' : 'Fraud triangle', desc: es ? 'Presión + oportunidad + racionalización.' : 'Pressure + opportunity + rationalization.', source: 'balance' },
        { name: es ? 'Procedimientos analíticos IA' : 'AI analytical procedures', desc: es ? 'Regresión y tendencias · desviaciones significativas.' : 'Regression and trends · significant deviations.', source: 'balance' },
        { name: 'Altman Z-Score going concern', desc: es ? 'Probabilidad de quiebra · continuidad del negocio.' : 'Bankruptcy probability · business continuity.', source: 'balance' },
        { name: es ? 'Partes relacionadas IA' : 'AI related parties', desc: es ? 'Detecta transacciones inusuales con vinculados.' : 'Detects unusual transactions with related parties.', source: 'auxiliares' },
      ],
    },
    {
      icon: ShieldCheck,
      accent: 'success',
      name: es ? 'Control interno y gobierno' : 'Internal control & governance',
      subtitle: es ? 'COSO 2013 · 5 componentes · 17 principios' : 'COSO 2013 · 5 components · 17 principles',
      count: es ? '5 análisis' : '5 analyses',
      capabilities: [
        { name: es ? 'COSO Framework completo' : 'Full COSO Framework', desc: es ? '5 componentes · 17 principios · madurez 0-5.' : '5 components · 17 principles · maturity 0-5.', source: 'balance' },
        { name: es ? 'Matriz de riesgo residual' : 'Residual risk matrix', desc: es ? 'Inherente vs. residual · mapa de calor.' : 'Inherent vs. residual · heat map.', source: 'balance' },
        { name: es ? 'Materialidad automática' : 'Automatic materiality', desc: es ? 'Umbral calculado por benchmark sectorial.' : 'Threshold calculated by sector benchmark.', source: 'balance' },
        { name: es ? 'Independencia del auditor' : 'Auditor independence', desc: es ? 'Checklist NIA 200 · conflictos de interés.' : 'ISA 200 checklist · conflicts of interest.', source: 'balance' },
        { name: es ? 'ISO 25012 · calidad de datos' : 'ISO 25012 · data quality', desc: es ? '15 características · completitud · consistencia.' : '15 characteristics · completeness · consistency.', source: 'balance' },
      ],
    },
    {
      icon: FileBadge,
      accent: 'gold',
      name: es ? 'Dictámenes y aseguramiento formal' : 'Opinions & formal assurance',
      subtitle: es ? 'NIA 700/705/706 · Management Letter' : 'ISA 700/705/706 · Management Letter',
      count: es ? '4 documentos' : '4 documents',
      capabilities: [
        { name: es ? 'Dictamen automatizado IA' : 'AI automated opinion', desc: es ? 'Sin salvedades · con salvedades · adverso · abstención.' : 'Unqualified · qualified · adverse · disclaimer.', source: 'balance' },
        { name: 'Management letter', desc: es ? 'Carta de recomendaciones lista para firmar.' : 'Recommendations letter ready to sign.', source: 'balance' },
        { name: es ? 'Conciliación fiscal IA' : 'AI tax reconciliation', desc: es ? 'UAI → renta líquida → impuesto · diferencias.' : 'PBT → taxable income → tax · differences.', source: 'balance' },
        { name: es ? 'Dictámenes especiales' : 'Special-purpose opinions', desc: es ? 'Uso específico · AML · forensic accounting.' : 'Specific use · AML · forensic accounting.', source: 'balance' },
      ],
    },
  ];
}
