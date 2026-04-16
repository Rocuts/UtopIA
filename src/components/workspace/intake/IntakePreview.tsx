'use client';

import {
  CheckCircle,
  Clock,
  Cpu,
  Shield,
  Star,
  FileSpreadsheet,
  ArrowRight,
  Lock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CaseType, IntakeFormUnion, NiifReportIntake, NiifOutputOptions } from '@/types/platform';

// ─── Types ───────────────────────────────────────────────────────────────────

interface IntakePreviewProps {
  caseType: CaseType;
  data: Partial<IntakeFormUnion>;
  onBack: () => void;
  onSubmit: () => void;
  submitLabel?: string;
}

// ─── Label Maps ──────────────────────────────────────────────────────────────

const CASE_LABELS: Record<CaseType, string> = {
  general_chat: 'Chat General',
  dian_defense: 'Defensa DIAN',
  tax_refund: 'Devolución de Impuestos',
  due_diligence: 'Due Diligence',
  financial_intel: 'Inteligencia Financiera',
  niif_report: 'Reporte NIIF Integral',
  tax_planning: 'Planeación Tributaria',
  transfer_pricing: 'Precios de Transferencia',
  business_valuation: 'Valoración Empresarial',
  fiscal_audit_opinion: 'Dictamen de Revisoría Fiscal',
  tax_reconciliation: 'Conciliación Fiscal',
  feasibility_study: 'Estudio de Factibilidad',
};

const ACT_LABELS: Record<string, string> = {
  requerimiento_ordinario: 'Requerimiento Ordinario',
  requerimiento_especial: 'Requerimiento Especial',
  pliego_cargos: 'Pliego de Cargos',
  liquidacion_oficial: 'Liquidación Oficial',
  emplazamiento: 'Emplazamiento',
  otro: 'Otro',
};

const TAX_TYPE_LABELS: Record<string, string> = {
  iva: 'IVA saldo a favor',
  renta: 'Renta saldo a favor',
  retencion: 'Retención en la fuente',
};

const PURPOSE_LABELS: Record<string, string> = {
  credito: 'Solicitud de crédito',
  inversion: 'Atracción de inversión',
  venta: 'Venta de empresa',
  fusion: 'Fusión / Adquisición',
  otro: 'Otro propósito',
};

const ANALYSIS_LABELS: Record<string, string> = {
  cash_flow: 'Flujo de Caja',
  breakeven: 'Punto de Equilibrio',
  dcf_valuation: 'Valoración DCF',
  cost_structure: 'Estructura de Costos',
  profitability: 'Rentabilidad',
  tax_simulation: 'Simulación Tributaria',
  merger_scenario: 'Escenario de Fusión',
};

const OUTPUT_LABELS: Record<keyof NiifOutputOptions, string> = {
  financialStatements: 'Estados Financieros NIIF',
  kpiDashboard: 'Dashboard Estratégico',
  cashFlowProjection: 'Flujo de Caja Proyectado',
  breakevenAnalysis: 'Punto de Equilibrio',
  notesToFinancialStatements: '13 Notas a los EEFF',
  shareholdersMinutes: 'Acta de Asamblea',
  auditPipeline: 'Auditoría Especializada',
  metaAudit: 'Meta-auditoría de Calidad',
  excelExport: 'Exportación Excel',
  comparativeAnalysis: 'Análisis Comparativo',
};

function formatCOP(amount: number | undefined): string {
  if (!amount) return '-';
  return `$${amount.toLocaleString('es-CO')}`;
}

// ─── Summary Section Component ───────────────────────────────────────────────

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1.5 border-b border-[#f5f5f5] last:border-0">
      <span className="text-xs text-[#737373]">{label}</span>
      <span className="text-xs font-medium text-[#0a0a0a] text-right max-w-[60%]">{value}</span>
    </div>
  );
}

// ─── Pipeline Visualization ──────────────────────────────────────────────────

function PipelineVisualization() {
  const agents = [
    { label: 'Analista NIIF', sublabel: 'Clasificación y medición' },
    { label: 'Director Estrategia', sublabel: 'KPIs y proyecciones' },
    { label: 'Gobierno Corporativo', sublabel: 'Cumplimiento y actas' },
  ];
  const auditors = [
    { label: 'Auditor NIIF', color: '#2563EB' },
    { label: 'Auditor Tributario', color: '#D97706' },
    { label: 'Auditor Legal', color: '#7C3AED' },
    { label: 'Revisor Fiscal', color: '#059669' },
  ];

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold text-[#525252] uppercase tracking-wide">
        Pipeline de Procesamiento
      </h4>

      {/* Sequential agents */}
      <div className="flex items-center gap-2">
        {agents.map((agent, i) => (
          <div key={agent.label} className="flex items-center gap-2 flex-1">
            <div className="flex-1 rounded-lg border border-[#e5e5e5] p-2.5 bg-[#fafafa]">
              <div className="text-[11px] font-semibold text-[#0a0a0a]">{agent.label}</div>
              <div className="text-[10px] text-[#a3a3a3]">{agent.sublabel}</div>
            </div>
            {i < agents.length - 1 && (
              <ArrowRight className="w-3.5 h-3.5 text-[#d4d4d4] shrink-0" />
            )}
          </div>
        ))}
      </div>

      {/* Arrow down */}
      <div className="flex justify-center">
        <ArrowRight className="w-4 h-4 text-[#d4d4d4] rotate-90" />
      </div>

      {/* Parallel auditors */}
      <div className="grid grid-cols-4 gap-2">
        {auditors.map((aud) => (
          <div
            key={aud.label}
            className="rounded-lg border border-[#e5e5e5] p-2 text-center"
            style={{ borderTopColor: aud.color, borderTopWidth: 2 }}
          >
            <Shield className="w-3.5 h-3.5 mx-auto mb-1" style={{ color: aud.color }} />
            <div className="text-[10px] font-medium text-[#525252]">{aud.label}</div>
          </div>
        ))}
      </div>

      {/* Arrow down */}
      <div className="flex justify-center">
        <ArrowRight className="w-4 h-4 text-[#d4d4d4] rotate-90" />
      </div>

      {/* Meta-auditor */}
      <div className="rounded-lg border-2 border-[#D4A017] bg-[#FEF9EC] p-3 text-center">
        <Star className="w-4 h-4 mx-auto mb-1 text-[#D4A017]" />
        <div className="text-xs font-semibold text-[#0a0a0a]">Meta-Auditor de Calidad</div>
        <div className="text-[10px] text-[#737373]">12 dimensiones -- ISO 25012 / ISO 42001</div>
      </div>
    </div>
  );
}

// ─── Chat Tier Info ──────────────────────────────────────────────────────────

function ChatTierInfo({ caseType }: { caseType: CaseType }) {
  const tierInfo: Record<
    string,
    { tier: string; tools: string[]; time: string; description: string }
  > = {
    dian_defense: {
      tier: 'T3 Multi-Experto',
      tools: ['search_docs', 'search_web', 'calculate_sanction', 'draft_dian_response', 'assess_risk'],
      time: '30-60 segundos',
      description: 'Consulta paralela con especialistas tributario, contable y de documentos, con síntesis final.',
    },
    tax_refund: {
      tier: 'T2 Especializado',
      tools: ['search_docs', 'search_web', 'calculate_sanction'],
      time: '15-30 segundos',
      description: 'Especialista tributario con acceso a normativa DIAN actualizada.',
    },
    due_diligence: {
      tier: 'T3 Multi-Experto',
      tools: ['search_docs', 'search_web', 'analyze_document', 'assess_risk'],
      time: '45-90 segundos',
      description: 'Análisis paralelo contable, tributario y estratégico con evaluación de riesgo.',
    },
    financial_intel: {
      tier: 'T2 Especializado',
      tools: ['search_docs', 'analyze_document', 'assess_risk'],
      time: '20-40 segundos',
      description: 'Análisis financiero especializado con herramientas de cálculo.',
    },
  };

  const info = tierInfo[caseType] ?? tierInfo.dian_defense;

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold text-[#525252] uppercase tracking-wide">
        Configuración del Agente
      </h4>
      <div className="rounded-lg border border-[#e5e5e5] p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4 text-[#D4A017]" />
          <span className="text-sm font-semibold text-[#0a0a0a]">{info.tier}</span>
        </div>
        <p className="text-xs text-[#737373]">{info.description}</p>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {info.tools.map((tool) => (
            <span
              key={tool}
              className="px-2 py-0.5 bg-[#f5f5f5] border border-[#e5e5e5] rounded text-[10px] font-mono text-[#525252]"
            >
              {tool}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1.5 pt-1 text-xs text-[#737373]">
          <Clock className="w-3.5 h-3.5" />
          Tiempo estimado: {info.time}
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function IntakePreview({ caseType, data, onSubmit, submitLabel }: IntakePreviewProps) {
  const isNiif = caseType === 'niif_report';

  return (
    <div className="space-y-5 pb-4">
      {/* Header */}
      <div className="rounded-lg border border-[#e5e5e5] bg-[#fafafa] p-4">
        <h3 className="text-base font-semibold text-[#0a0a0a] mb-1">{CASE_LABELS[caseType]}</h3>
        <p className="text-xs text-[#737373]">
          Revise la información antes de iniciar. Puede volver a pasos anteriores para editar.
        </p>
      </div>

      {/* Case-specific summary */}
      <div className="rounded-lg border border-[#e5e5e5] p-4 space-y-1">
        <h4 className="text-xs font-semibold text-[#525252] uppercase tracking-wide mb-2">
          Resumen del Caso
        </h4>

        {caseType === 'dian_defense' && 'actType' in data && (
          <>
            <SummaryRow label="Tipo de Acto" value={ACT_LABELS[(data as { actType: string }).actType] ?? '-'} />
            {'taxes' in data && (
              <SummaryRow
                label="Impuestos"
                value={(data as { taxes: string[] }).taxes.map((t) => t.toUpperCase()).join(', ') || '-'}
              />
            )}
            {'periodStart' in data && 'periodEnd' in data && (
              <SummaryRow
                label="Periodo"
                value={`${(data as { periodStart: string }).periodStart} - ${(data as { periodEnd: string }).periodEnd}`}
              />
            )}
            {'disputedAmount' in data && (
              <SummaryRow label="Monto en Disputa" value={formatCOP((data as { disputedAmount?: number }).disputedAmount)} />
            )}
            {'responseDeadline' in data && (
              <SummaryRow label="Fecha Limite" value={(data as { responseDeadline: string }).responseDeadline} />
            )}
          </>
        )}

        {caseType === 'tax_refund' && 'taxType' in data && (
          <>
            <SummaryRow label="Tipo" value={TAX_TYPE_LABELS[(data as { taxType: string }).taxType] ?? '-'} />
            {'period' in data && <SummaryRow label="Periodo" value={(data as { period: string }).period} />}
            {'approximateAmount' in data && (
              <SummaryRow label="Monto Aprox." value={formatCOP((data as { approximateAmount?: number }).approximateAmount)} />
            )}
            {'alreadyFiled' in data && (
              <SummaryRow label="Ya radicado" value={(data as { alreadyFiled: boolean }).alreadyFiled ? 'Si' : 'No'} />
            )}
          </>
        )}

        {caseType === 'due_diligence' && 'purpose' in data && (
          <>
            <SummaryRow label="Propósito" value={PURPOSE_LABELS[(data as { purpose: string }).purpose] ?? '-'} />
            {'companyName' in data && <SummaryRow label="Razón Social" value={(data as { companyName: string }).companyName} />}
            {'nit' in data && <SummaryRow label="NIT" value={(data as { nit: string }).nit} />}
            {'entityType' in data && <SummaryRow label="Tipo Sociedad" value={(data as { entityType: string }).entityType} />}
            {'niifGroup' in data && <SummaryRow label="Grupo NIIF" value={`Grupo ${(data as { niifGroup: number }).niifGroup}`} />}
          </>
        )}

        {caseType === 'financial_intel' && 'analyses' in data && (
          <>
            <SummaryRow
              label="Análisis"
              value={(data as { analyses: string[] }).analyses.map((a) => ANALYSIS_LABELS[a] ?? a).join(', ')}
            />
            {'period' in data && <SummaryRow label="Periodo" value={(data as { period: string }).period} />}
            {'specificQuestion' in data && (data as { specificQuestion?: string }).specificQuestion && (
              <SummaryRow label="Pregunta" value={(data as { specificQuestion: string }).specificQuestion} />
            )}
          </>
        )}

        {caseType === 'niif_report' && 'company' in data && (
          <>
            {(() => {
              const d = data as Partial<NiifReportIntake>;
              return (
                <>
                  <SummaryRow label="Razón Social" value={d.company?.name ?? '-'} />
                  <SummaryRow label="NIT" value={d.company?.nit ?? '-'} />
                  <SummaryRow label="Tipo Sociedad" value={d.company?.entityType ?? '-'} />
                  {d.company?.sector && <SummaryRow label="Sector" value={d.company.sector} />}
                  {d.company?.city && <SummaryRow label="Ciudad" value={d.company.city} />}
                  <SummaryRow label="Grupo NIIF" value={d.niifGroup ? `Grupo ${d.niifGroup}` : '-'} />
                  <SummaryRow label="Periodo Fiscal" value={d.fiscalPeriod ?? '-'} />
                  {d.comparativePeriod && <SummaryRow label="Periodo Comparativo" value={d.comparativePeriod} />}
                </>
              );
            })()}
          </>
        )}
      </div>

      {/* Pipeline visualization or chat tier */}
      {isNiif ? <PipelineVisualization /> : <ChatTierInfo caseType={caseType} />}

      {/* Output checklist for NIIF */}
      {isNiif && 'outputOptions' in data && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-[#525252] uppercase tracking-wide">
            Entregables
          </h4>
          <div className="grid grid-cols-2 gap-1.5">
            {Object.entries((data as Partial<NiifReportIntake>).outputOptions ?? {}).map(([key, enabled]) => (
              <div key={key} className="flex items-center gap-1.5">
                <CheckCircle
                  className={cn('w-3.5 h-3.5 shrink-0', enabled ? 'text-[#22C55E]' : 'text-[#d4d4d4]')}
                />
                <span className={cn('text-xs', enabled ? 'text-[#0a0a0a]' : 'text-[#a3a3a3] line-through')}>
                  {OUTPUT_LABELS[key as keyof NiifOutputOptions] ?? key}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Model info for NIIF */}
      {isNiif && (
        <div className="rounded-lg border border-[#e5e5e5] p-3 space-y-2">
          <h4 className="text-xs font-semibold text-[#525252] uppercase tracking-wide">
            Información del Modelo
          </h4>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-2">
              <Cpu className="w-3.5 h-3.5 text-[#D4A017]" />
              <span className="text-xs text-[#525252]">GPT-5.4 mini (400K contexto)</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-[#737373]" />
              <span className="text-xs text-[#525252]">3-5 minutos estimados</span>
            </div>
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="w-3.5 h-3.5 text-[#737373]" />
              <span className="text-xs text-[#525252]">3 agentes + 4 auditores + meta</span>
            </div>
          </div>
        </div>
      )}

      {/* PII Notice */}
      <div className="flex items-start gap-2 rounded-lg bg-[#f5f5f5] p-3">
        <Lock className="w-3.5 h-3.5 text-[#737373] mt-0.5 shrink-0" />
        <p className="text-[11px] text-[#737373] leading-relaxed">
          Su información será procesada de forma segura. Datos sensibles como NIT, cédula y correos
          son redactados automáticamente antes del envío al modelo de IA.
        </p>
      </div>
    </div>
  );
}
