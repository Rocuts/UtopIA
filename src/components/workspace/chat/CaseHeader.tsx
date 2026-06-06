'use client';

export function CaseHeader({
  useCase,
  caseId,
}: {
  useCase: string;
  caseId: string;
  language: 'es' | 'en';
}) {
  const labels: Record<string, string> = {
    'general': 'Chat General',
    'dian-defense': 'Defensa DIAN',
    'tax-refund': 'Devoluciones',
    'due-diligence': 'Due Diligence',
    'financial-intelligence': 'Inteligencia Financiera',
    'tax-planning': 'Planeación Tributaria',
    'transfer-pricing': 'Precios de Transferencia',
    'business-valuation': 'Valoración Empresarial',
    'fiscal-audit-opinion': 'Dictamen Rev. Fiscal',
    'tax-reconciliation': 'Conciliación Fiscal',
    'feasibility-study': 'Estudio de Factibilidad',
  };
  const icons: Record<string, string> = {
    'general': '💬',
    'dian-defense': '⚖️',
    'tax-refund': '🔄',
    'due-diligence': '🔍',
    'financial-intelligence': '📊',
    'tax-planning': '🧮',
    'transfer-pricing': '🌐',
    'business-valuation': '💰',
    'fiscal-audit-opinion': '📋',
    'tax-reconciliation': '🔀',
    'feasibility-study': '💡',
  };

  return (
    <div className="px-6 py-3 border-b border-n-200 bg-n-50/60 backdrop-blur-sm flex items-center gap-3 sticky top-0 z-10">
      <span className="text-lg">{icons[useCase] ?? '📋'}</span>
      <div className="flex-1 min-w-0">
        <span className="text-sm font-semibold text-n-900">
          {labels[useCase] ?? useCase}
        </span>
      </div>
      <span className="text-xs-mono text-n-600 font-mono num">
        TC-{caseId.slice(5, 13)}
      </span>
    </div>
  );
}
