// ---------------------------------------------------------------------------
// El Escudo — contenido bilingüe de fuentes de datos + zonas de capacidades.
// ---------------------------------------------------------------------------
// Co-localizado (no en dictionaries.ts) porque incluye iconos lucide. Consumido
// por EscudoArea vía DataSourceLadder + CapabilityZones.
// ---------------------------------------------------------------------------

import {
  FileSpreadsheet,
  ClipboardList,
  Plug,
  Landmark,
  Building2,
  FileText,
  ShieldCheck,
  Brain,
  Shield,
} from 'lucide-react';

import type { DataSourceItem, CapabilityZoneItem } from '../shared/types';

export function getEscudoSources(lang: 'es' | 'en'): DataSourceItem[] {
  const es = lang === 'es';
  return [
    { key: 'balance', name: es ? 'Balance de prueba' : 'Trial balance', icon: FileSpreadsheet, active: true, capabilities: 12, badgeSuffix: es ? 'activas' : 'active' },
    { key: 'auxiliares', name: es ? 'Auxiliares por tercero' : 'Subledgers by party', icon: ClipboardList, active: false, capabilities: 8, badgeSuffix: es ? 'se activan' : 'unlock' },
    { key: 'erp', name: es ? 'ERP en tiempo real' : 'Real-time ERP', icon: Plug, active: false, capabilities: 4, badgeSuffix: es ? 'en vivo' : 'live' },
    { key: 'apiDIAN', name: 'API DIAN', icon: Landmark, active: false, capabilities: 5, badgeSuffix: es ? 'en línea' : 'online' },
    { key: 'apiBanco', name: es ? 'API Bancaria' : 'Bank API', icon: Building2, active: false, capabilities: 2, badgeSuffix: es ? 'bancarias' : 'banking' },
  ];
}

export function getEscudoZones(lang: 'es' | 'en'): CapabilityZoneItem[] {
  const es = lang === 'es';
  return [
    {
      icon: FileText,
      accent: 'wine',
      name: es ? 'Declaraciones tributarias' : 'Tax filings',
      subtitle: es ? 'Borradores automáticos listos para revisar y presentar' : 'Auto-drafts ready to review and file',
      count: es ? '6 formularios' : '6 forms',
      capabilities: [
        { name: es ? 'Renta · Formulario 110' : 'Income tax · Form 110', desc: es ? 'Borrador con conciliación fiscal y papeles de trabajo.' : 'Draft with tax reconciliation and working papers.', source: 'auxiliares' },
        { name: es ? 'IVA · Formulario 300' : 'VAT · Form 300', desc: es ? 'IVA generado vs descontable · saldo a pagar.' : 'Output vs input VAT · balance due.', source: 'auxiliares' },
        { name: es ? 'Retención · Formulario 350' : 'Withholding · Form 350', desc: es ? 'Por concepto, base mínima y tarifa según RUT.' : 'By concept, minimum base and rate per RUT.', source: 'auxiliares' },
        { name: es ? 'ICA y ReteICA municipal' : 'Municipal ICA & ReteICA', desc: es ? 'Clasificación CIIU · preliquidación automática.' : 'CIIU classification · auto pre-assessment.', source: 'auxiliares' },
        { name: es ? 'RST · Simulador comparativo' : 'RST · Comparative simulator', desc: es ? 'Anticipo bimestral + comparación RST vs ordinario.' : 'Bi-monthly advance + RST vs ordinary comparison.', source: 'balance' },
        { name: es ? 'Medios magnéticos · Exógena' : 'Information returns · Exógena', desc: es ? 'XML/CSV listo para MUISCA · resolución DIAN vigente.' : 'XML/CSV ready for MUISCA · current DIAN resolution.', source: 'auxiliares' },
      ],
    },
    {
      icon: ShieldCheck,
      accent: 'info',
      name: es ? 'Blindaje y validación en tiempo real' : 'Real-time shielding & validation',
      subtitle: es ? 'Prevención de errores antes de que ocurran' : 'Error prevention before it happens',
      count: es ? '6 validadores' : '6 validators',
      capabilities: [
        { name: es ? 'Auditoría facturación electrónica' : 'E-invoicing audit', desc: es ? 'Valida CUFE y requisitos DIAN antes de contabilizar.' : 'Validates CUFE and DIAN requirements before posting.', source: 'apiDIAN' },
        { name: es ? 'Alertas topes de IVA' : 'VAT threshold alerts', desc: es ? 'Monitoreo ventas acumuladas vs umbral responsable.' : 'Monitors cumulative sales vs liability threshold.', source: 'balance' },
        { name: es ? 'Control retenciones automático' : 'Automatic withholding control', desc: es ? 'Cálculo por concepto y tarifa según RUT proveedor.' : 'Computes by concept and rate per supplier RUT.', source: 'balance' },
        { name: es ? 'Detección proveedores riesgosos' : 'Risky supplier detection', desc: es ? 'Cruza NITs con listado DIAN régimen evasor.' : 'Cross-checks NITs against DIAN evader list.', source: 'apiDIAN' },
        { name: es ? 'Documento soporte electrónico' : 'Electronic supporting document', desc: es ? 'Detecta egresos sin factura · alerta antes de perder.' : 'Flags expenses without invoice · alerts before loss.', source: 'auxiliares' },
        { name: es ? 'Ineficacia F350 · alerta bancaria' : 'F350 ineffectiveness · bank alert', desc: es ? 'Verifica saldo disponible antes del vencimiento.' : 'Checks available balance before the deadline.', source: 'apiBanco' },
      ],
    },
    {
      icon: Brain,
      accent: 'info',
      name: es ? 'Inteligencia fiscal' : 'Tax intelligence',
      subtitle: es ? 'Optimización y análisis con IA' : 'AI-driven optimization & analysis',
      count: es ? '6 análisis' : '6 analyses',
      capabilities: [
        { name: es ? 'Planeación tributaria 3 escenarios' : 'Tax planning · 3 scenarios', desc: es ? 'Conservador, base y agresivo · ahorro en pesos.' : 'Conservative, base and aggressive · savings in pesos.', source: 'balance' },
        { name: es ? 'Optimización deducciones' : 'Deduction optimization', desc: es ? 'Analiza gastos · garantiza soporte y deducibilidad.' : 'Analyzes expenses · ensures support and deductibility.', source: 'balance' },
        { name: es ? 'Tasa mínima · Ley 2277/2022' : 'Minimum rate · Law 2277/2022', desc: es ? 'Calcula si aplica impuesto adicional al 15%.' : 'Computes whether the 15% top-up tax applies.', source: 'balance' },
        { name: es ? 'Precios de transferencia' : 'Transfer pricing', desc: es ? 'Operaciones vinculadas bajo directrices OCDE.' : 'Related-party operations under OECD guidelines.', source: 'balance' },
        { name: es ? 'Límite bancarización Art. 771-5' : 'Cash-payment limit · Art. 771-5', desc: es ? 'Taxímetro de pagos en efectivo vs deducibilidad.' : 'Cash-payment meter vs deductibility.', source: 'balance' },
        { name: es ? 'ICUI/IBU · bebidas y ultraprocesados' : 'ICUI/IBU · beverages & ultra-processed', desc: es ? 'Liquidación monofásica por gramo/ml.' : 'Single-phase assessment per gram/ml.', source: 'auxiliares' },
      ],
    },
    {
      icon: Shield,
      accent: 'wine',
      name: es ? 'Defensa DIAN y cumplimiento' : 'DIAN defense & compliance',
      subtitle: es ? 'Protección activa frente a requerimientos' : 'Active protection against audits',
      count: es ? '6 herramientas' : '6 tools',
      capabilities: [
        { name: es ? 'Score de riesgo DIAN 0-100' : 'DIAN risk score 0-100', desc: es ? 'Indicador automático con factores y plan de acción.' : 'Automatic indicator with factors and action plan.', source: 'balance' },
        { name: es ? 'Respuestas a requerimientos' : 'Audit-notice responses', desc: es ? 'Borradores para radicar con citas E.T. exactas.' : 'Filing-ready drafts with exact tax-code citations.', source: 'balance' },
        { name: es ? 'Expediente probatorio' : 'Evidentiary file', desc: es ? 'Checklist y organización · Art. 742 E.T.' : 'Checklist and organization · Art. 742 tax code.', source: 'balance' },
        { name: es ? 'Modo supervivencia élite' : 'Elite survival mode', desc: es ? 'Crisis fiscal · plan inmediato / 5 días / 10 días.' : 'Tax crisis · immediate / 5-day / 10-day plan.', source: 'balance' },
        { name: es ? 'Termómetro de firmeza' : 'Statute-of-limitations meter', desc: es ? 'Fecha exacta en que cada declaración queda en firme.' : 'Exact date each return becomes final.', source: 'balance' },
        { name: es ? 'Conciliación DIAN vs contabilidad' : 'DIAN vs books reconciliation', desc: es ? 'Descarga XMLs · cruza facturas vs contabilizadas.' : 'Downloads XMLs · matches invoices vs posted.', source: 'apiDIAN' },
      ],
    },
  ];
}
