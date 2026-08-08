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
import { useLanguage } from '@/context/LanguageContext';
import { dict } from '@/lib/i18n/dictionaries';
import type { CaseType, IntakeFormUnion, NiifReportIntake, NiifOutputOptions } from '@/types/platform';

// ─── Types ───────────────────────────────────────────────────────────────────

interface IntakePreviewProps {
  caseType: CaseType;
  data: Partial<IntakeFormUnion>;
  onBack: () => void;
  onSubmit: () => void;
  submitLabel?: string;
}

/**
 * Vista previa: es el paso final de los 5 wizards, así que todo su copy (y los
 * mapas de etiquetas de enum) vive en `intake.preview` del diccionario. Los
 * mapas se leen por clave de enum; si el backend añade un valor nuevo el
 * fallback es la clave cruda, nunca `undefined` en pantalla.
 */
type PreviewDict = (typeof dict)['es']['intake']['preview'];

function formatCOP(amount: number | undefined): string {
  if (!amount) return '-';
  return `$${amount.toLocaleString('es-CO')}`;
}

// ─── Summary Section Component ───────────────────────────────────────────────

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1.5 border-b border-n-100 last:border-0">
      <span className="text-xs text-n-500">{label}</span>
      <span className="text-xs font-medium text-n-900 text-right max-w-[60%]">{value}</span>
    </div>
  );
}

// ─── Pipeline Visualization ──────────────────────────────────────────────────

function PipelineVisualization({ t }: { t: PreviewDict }) {
  const agents = [
    { label: t.agentNiif, sublabel: t.agentNiifSub },
    { label: t.agentStrategy, sublabel: t.agentStrategySub },
    { label: t.agentGovernance, sublabel: t.agentGovernanceSub },
  ];
  const auditors = [
    { label: t.auditorNiif, color: '#2563EB' },
    { label: t.auditorTax, color: '#D97706' },
    { label: t.auditorLegal, color: '#7C3AED' },
    { label: t.auditorFiscal, color: '#059669' },
  ];

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold text-n-600 uppercase tracking-wide">
        {t.pipelineTitle}
      </h4>

      {/* Sequential agents */}
      <div className="flex items-center gap-2">
        {agents.map((agent, i) => (
          <div key={agent.label} className="flex items-center gap-2 flex-1">
            <div className="flex-1 rounded-lg border border-n-200 p-2.5 bg-n-50">
              <div className="text-xs-mono font-semibold text-n-900">{agent.label}</div>
              <div className="text-2xs text-n-600">{agent.sublabel}</div>
            </div>
            {i < agents.length - 1 && (
              <ArrowRight className="w-3.5 h-3.5 text-n-500 shrink-0" aria-hidden="true" />
            )}
          </div>
        ))}
      </div>

      {/* Arrow down */}
      <div className="flex justify-center">
        <ArrowRight className="w-4 h-4 text-n-300 rotate-90" />
      </div>

      {/* Parallel auditors */}
      <div className="grid grid-cols-4 gap-2">
        {auditors.map((aud) => (
          <div
            key={aud.label}
            className="rounded-lg border border-n-200 p-2 text-center"
            style={{ borderTopColor: aud.color, borderTopWidth: 2 }}
          >
            <Shield className="w-3.5 h-3.5 mx-auto mb-1" style={{ color: aud.color }} />
            <div className="text-2xs font-medium text-n-600">{aud.label}</div>
          </div>
        ))}
      </div>

      {/* Arrow down */}
      <div className="flex justify-center">
        <ArrowRight className="w-4 h-4 text-n-300 rotate-90" />
      </div>

      {/* Meta-auditor */}
      <div className="rounded-lg border-2 border-gold-500 bg-gold-500/10 p-3 text-center">
        <Star className="w-4 h-4 mx-auto mb-1 text-gold-500" />
        <div className="text-xs font-semibold text-n-900">{t.metaAuditorTitle}</div>
        <div className="text-2xs text-n-500">{t.metaAuditorSub}</div>
      </div>
    </div>
  );
}

// ─── Chat Tier Info ──────────────────────────────────────────────────────────

const TIER_TOOLS: Record<string, string[]> = {
  dian_defense: [
    'search_docs',
    'search_web',
    'calculate_sanction',
    'draft_dian_response',
    'assess_risk',
  ],
  tax_refund: ['search_docs', 'search_web', 'calculate_sanction'],
  due_diligence: ['search_docs', 'search_web', 'analyze_document', 'assess_risk'],
  financial_intel: ['search_docs', 'analyze_document', 'assess_risk'],
};

function ChatTierInfo({ caseType, t }: { caseType: CaseType; t: PreviewDict }) {
  const tiers = t.tiers as Record<string, { tier: string; time: string; description: string }>;
  const info = tiers[caseType] ?? tiers.dian_defense;
  const tools = TIER_TOOLS[caseType] ?? TIER_TOOLS.dian_defense;

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold text-n-600 uppercase tracking-wide">
        {t.agentConfigTitle}
      </h4>
      <div className="rounded-lg border border-n-200 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4 text-gold-500" />
          <span className="text-sm font-semibold text-n-900">{info.tier}</span>
        </div>
        <p className="text-xs text-n-500">{info.description}</p>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {tools.map((tool) => (
            <span
              key={tool}
              className="px-2 py-0.5 bg-n-100 border border-n-200 rounded text-2xs font-mono text-n-600"
            >
              {tool}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1.5 pt-1 text-xs text-n-500">
          <Clock className="w-3.5 h-3.5" />
          {t.estimatedTime.replace('{t}', info.time)}
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function IntakePreview({ caseType, data }: IntakePreviewProps) {
  const { language } = useLanguage();
  const t = dict[language].intake.preview;
  const c = dict[language].intake.common;
  const isNiif = caseType === 'niif_report';

  const actLabels = t.actLabels as Record<string, string>;
  const taxTypeLabels = t.taxTypeLabels as Record<string, string>;
  const purposeLabels = t.purposeLabels as Record<string, string>;
  const analysisLabels = t.analysisLabels as Record<string, string>;
  const outputLabels = t.outputLabels as Record<string, string>;

  return (
    <div className="space-y-5 pb-4">
      {/* Header */}
      <div className="rounded-lg border border-n-200 bg-n-50 p-4">
        <h3 className="text-base font-semibold text-n-900 mb-1">{t.caseLabels[caseType]}</h3>
        <p className="text-xs text-n-500">{t.reviewHint}</p>
      </div>

      {/* Case-specific summary */}
      <div className="rounded-lg border border-n-200 p-4 space-y-1">
        <h4 className="text-xs font-semibold text-n-600 uppercase tracking-wide mb-2">
          {t.summaryTitle}
        </h4>

        {caseType === 'dian_defense' && 'actType' in data && (
          <>
            <SummaryRow
              label={t.rowActType}
              value={actLabels[(data as { actType: string }).actType] ?? '-'}
            />
            {'taxes' in data && (
              <SummaryRow
                label={t.rowTaxes}
                value={(data as { taxes: string[] }).taxes.map((x) => x.toUpperCase()).join(', ') || '-'}
              />
            )}
            {'periodStart' in data && 'periodEnd' in data && (
              <SummaryRow
                label={c.period}
                value={`${(data as { periodStart: string }).periodStart} - ${(data as { periodEnd: string }).periodEnd}`}
              />
            )}
            {'disputedAmount' in data && (
              <SummaryRow label={t.rowDisputedAmount} value={formatCOP((data as { disputedAmount?: number }).disputedAmount)} />
            )}
            {'responseDeadline' in data && (
              <SummaryRow label={t.rowDeadline} value={(data as { responseDeadline: string }).responseDeadline} />
            )}
          </>
        )}

        {caseType === 'tax_refund' && 'taxType' in data && (
          <>
            <SummaryRow label={c.stepType} value={taxTypeLabels[(data as { taxType: string }).taxType] ?? '-'} />
            {'period' in data && <SummaryRow label={c.period} value={(data as { period: string }).period} />}
            {'approximateAmount' in data && (
              <SummaryRow label={t.rowApproxAmount} value={formatCOP((data as { approximateAmount?: number }).approximateAmount)} />
            )}
            {'alreadyFiled' in data && (
              <SummaryRow label={t.rowAlreadyFiled} value={(data as { alreadyFiled: boolean }).alreadyFiled ? c.yes : c.no} />
            )}
          </>
        )}

        {caseType === 'due_diligence' && 'purpose' in data && (
          <>
            <SummaryRow label={t.rowPurpose} value={purposeLabels[(data as { purpose: string }).purpose] ?? '-'} />
            {'companyName' in data && <SummaryRow label={c.companyName} value={(data as { companyName: string }).companyName} />}
            {'nit' in data && <SummaryRow label={c.nit} value={(data as { nit: string }).nit} />}
            {'entityType' in data && <SummaryRow label={c.entityType} value={(data as { entityType: string }).entityType} />}
            {'niifGroup' in data && (
              <SummaryRow
                label={c.niifGroup}
                value={c.niifGroupValue.replace('{n}', String((data as { niifGroup: number }).niifGroup))}
              />
            )}
          </>
        )}

        {caseType === 'financial_intel' && 'analyses' in data && (
          <>
            <SummaryRow
              label={t.rowAnalyses}
              value={(data as { analyses: string[] }).analyses.map((a) => analysisLabels[a] ?? a).join(', ')}
            />
            {'period' in data && <SummaryRow label={c.period} value={(data as { period: string }).period} />}
            {'specificQuestion' in data && (data as { specificQuestion?: string }).specificQuestion && (
              <SummaryRow label={t.rowQuestion} value={(data as { specificQuestion: string }).specificQuestion} />
            )}
          </>
        )}

        {caseType === 'niif_report' && 'company' in data && (
          <>
            {(() => {
              const d = data as Partial<NiifReportIntake>;
              return (
                <>
                  <SummaryRow label={c.companyName} value={d.company?.name ?? '-'} />
                  <SummaryRow label={c.nit} value={d.company?.nit ?? '-'} />
                  <SummaryRow label={c.entityType} value={d.company?.entityType ?? '-'} />
                  {d.company?.sector && <SummaryRow label={c.sector} value={d.company.sector} />}
                  {d.company?.city && <SummaryRow label={c.city} value={d.company.city} />}
                  <SummaryRow
                    label={c.niifGroup}
                    value={d.niifGroup ? c.niifGroupValue.replace('{n}', String(d.niifGroup)) : '-'}
                  />
                  <SummaryRow label={t.rowFiscalPeriod} value={d.fiscalPeriod ?? '-'} />
                  {d.comparativePeriod && <SummaryRow label={t.rowComparativePeriod} value={d.comparativePeriod} />}
                </>
              );
            })()}
          </>
        )}
      </div>

      {/* Pipeline visualization or chat tier */}
      {isNiif ? <PipelineVisualization t={t} /> : <ChatTierInfo caseType={caseType} t={t} />}

      {/* Output checklist for NIIF */}
      {isNiif && 'outputOptions' in data && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-n-600 uppercase tracking-wide">
            {t.deliverablesTitle}
          </h4>
          <div className="grid grid-cols-2 gap-1.5">
            {Object.entries((data as Partial<NiifReportIntake>).outputOptions ?? {}).map(([key, enabled]) => (
              <div key={key} className="flex items-center gap-1.5">
                <CheckCircle
                  className={cn('w-3.5 h-3.5 shrink-0', enabled ? 'text-success' : 'text-n-300')}
                />
                <span className={cn('text-xs', enabled ? 'text-n-900' : 'text-n-500 line-through')}>
                  {outputLabels[key as keyof NiifOutputOptions] ?? key}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Model info for NIIF */}
      {isNiif && (
        <div className="rounded-lg border border-n-200 p-3 space-y-2">
          <h4 className="text-xs font-semibold text-n-600 uppercase tracking-wide">
            {t.modelInfoTitle}
          </h4>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-2">
              <Cpu className="w-3.5 h-3.5 text-gold-500" />
              <span className="text-xs text-n-600">{t.modelName}</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-n-500" />
              <span className="text-xs text-n-600">{t.modelTime}</span>
            </div>
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="w-3.5 h-3.5 text-n-500" />
              <span className="text-xs text-n-600">{t.modelAgents}</span>
            </div>
          </div>
        </div>
      )}

      {/* PII Notice */}
      <div className="flex items-start gap-2 rounded-lg bg-n-100 p-3">
        <Lock className="w-3.5 h-3.5 text-n-500 mt-0.5 shrink-0" />
        <p className="text-xs-mono text-n-500 leading-relaxed">{t.piiNotice}</p>
      </div>
    </div>
  );
}
