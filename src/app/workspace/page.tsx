'use client';

import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import {
  Shield,
  TrendingUp,
  FileSearch,
  BarChart3,
  MessageSquare,
  Clock,
  ArrowRight,
  Plus,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Badge } from '@/components/ui/Badge';
import { ChatThread } from '@/components/workspace/ChatThread';
import { useLanguage } from '@/context/LanguageContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import {
  listConversations,
  getConversationStats,
  type Conversation,
  type RiskLevel,
} from '@/lib/storage/conversation-history';
import type { RiskAssessmentData, UploadedDocument } from '@/components/workspace/types';

const NOVA_SPRING = { stiffness: 400, damping: 25 };

const RISK_COLORS: Record<RiskLevel, string> = {
  bajo: '#22c55e',
  medio: '#eab308',
  alto: '#f97316',
  critico: '#ef4444',
};

const USE_CASE_LABELS: Record<string, Record<string, string>> = {
  es: {
    'dian-defense': 'Defensa DIAN',
    'tax-refund': 'Devoluciones',
    'due-diligence': 'Due Diligence',
    'financial-intelligence': 'Inteligencia Financiera',
  },
  en: {
    'dian-defense': 'DIAN Defense',
    'tax-refund': 'Tax Refund',
    'due-diligence': 'Due Diligence',
    'financial-intelligence': 'Financial Intelligence',
  },
};

const USE_CASE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  'dian-defense': Shield,
  'tax-refund': TrendingUp,
  'due-diligence': FileSearch,
  'financial-intelligence': BarChart3,
};

interface QuickAction {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  labelEs: string;
  labelEn: string;
  descEs: string;
  descEn: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'dian-defense',
    icon: Shield,
    labelEs: 'Defensa DIAN',
    labelEn: 'DIAN Defense',
    descEs: 'Responda requerimientos con estrategia fundamentada',
    descEn: 'Respond to requirements with grounded strategy',
  },
  {
    id: 'tax-refund',
    icon: TrendingUp,
    labelEs: 'Devoluciones',
    labelEn: 'Tax Refund',
    descEs: 'Prepare expedientes de saldos a favor',
    descEn: 'Prepare refund technical files',
  },
  {
    id: 'due-diligence',
    icon: FileSearch,
    labelEs: 'Due Diligence',
    labelEn: 'Due Diligence',
    descEs: 'Audite para inversion, credito o venta',
    descEn: 'Audit for investment, credit or sale',
  },
  {
    id: 'financial-intelligence',
    icon: BarChart3,
    labelEs: 'Inteligencia Financiera',
    labelEn: 'Financial Intelligence',
    descEs: 'Convierta contabilidad en decisiones',
    descEn: 'Turn accounting into decisions',
  },
];

function DashboardOverview() {
  const { language, t } = useLanguage();
  const { setActiveUseCase, setActiveCase } = useWorkspace();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [stats, setStats] = useState<ReturnType<typeof getConversationStats> | null>(null);

  useEffect(() => {
    setConversations(listConversations());
    setStats(getConversationStats());
  }, []);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(
      language === 'es' ? 'es-CO' : 'en-US',
      { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
    );
  };

  const handleQuickAction = (useCaseId: string) => {
    setActiveUseCase(useCaseId);
    // In the future, this would also create a new conversation
    // and set it as active. For now we just set the use case.
  };

  const wt = t.workspace;
  const d = t.dashboard;

  return (
    <div className="h-full overflow-y-auto styled-scrollbar">
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Welcome */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', ...NOVA_SPRING }}
          className="mb-8"
        >
          <h1 className="text-2xl font-bold text-[#0a0a0a] tracking-tight mb-1">
            {wt.title}
          </h1>
          <p className="text-sm text-[#a3a3a3]">{d.subtitle}</p>
        </motion.div>

        {/* Stats Row */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', ...NOVA_SPRING, delay: 0.05 }}
          className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-[#e5e5e5] border border-[#e5e5e5] rounded-sm overflow-hidden mb-8"
        >
          <div className="bg-white p-4">
            <div className="flex items-center gap-2 mb-2">
              <MessageSquare className="w-3.5 h-3.5 text-[#a3a3a3]" />
              <span className="text-[10px] text-[#a3a3a3] uppercase tracking-wider font-[family-name:var(--font-geist-mono)]">
                {d.totalCases}
              </span>
            </div>
            <p className="text-2xl font-bold text-[#0a0a0a] font-[family-name:var(--font-geist-mono)]">
              {stats?.total ?? 0}
            </p>
          </div>
          <div className="bg-white p-4">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="w-3.5 h-3.5 text-[#22c55e]" />
              <span className="text-[10px] text-[#a3a3a3] uppercase tracking-wider font-[family-name:var(--font-geist-mono)]">
                {d.lowRisk}
              </span>
            </div>
            <p className="text-2xl font-bold text-[#0a0a0a] font-[family-name:var(--font-geist-mono)]">
              {stats?.riskCounts.bajo ?? 0}
            </p>
          </div>
          <div className="bg-white p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-3.5 h-3.5 text-[#f97316]" />
              <span className="text-[10px] text-[#a3a3a3] uppercase tracking-wider font-[family-name:var(--font-geist-mono)]">
                {d.highRisk}
              </span>
            </div>
            <p className="text-2xl font-bold text-[#0a0a0a] font-[family-name:var(--font-geist-mono)]">
              {(stats?.riskCounts.alto ?? 0) + (stats?.riskCounts.critico ?? 0)}
            </p>
          </div>
          <div className="bg-white p-4">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-3.5 h-3.5 text-[#a3a3a3]" />
              <span className="text-[10px] text-[#a3a3a3] uppercase tracking-wider font-[family-name:var(--font-geist-mono)]">
                {d.riskOverview}
              </span>
            </div>
            <p className="text-2xl font-bold text-[#0a0a0a] font-[family-name:var(--font-geist-mono)]">
              {stats?.riskCounts.medio ?? 0}
            </p>
          </div>
        </motion.div>

        {/* Quick Actions */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', ...NOVA_SPRING, delay: 0.1 }}
          className="mb-8"
        >
          <h2 className="text-xs font-medium text-[#a3a3a3] uppercase tracking-wider mb-3 font-[family-name:var(--font-geist-mono)]">
            {wt.quickActions}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {QUICK_ACTIONS.map((action, i) => {
              const Icon = action.icon;
              return (
                <motion.button
                  key={action.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: 'spring', ...NOVA_SPRING, delay: 0.12 + i * 0.03 }}
                  onClick={() => handleQuickAction(action.id)}
                  className="text-left"
                >
                  <GlassPanel className="p-4 flex items-center gap-4 cursor-pointer group" hoverEffect>
                    <div className="w-10 h-10 rounded-sm flex items-center justify-center shrink-0 bg-[#fafafa] border border-[#e5e5e5] group-hover:bg-[#0a0a0a] group-hover:border-[#0a0a0a] transition-colors">
                      <Icon className="w-5 h-5 text-[#0a0a0a] group-hover:text-white transition-colors" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#0a0a0a]">
                        {language === 'es' ? action.labelEs : action.labelEn}
                      </p>
                      <p className="text-xs text-[#a3a3a3] mt-0.5 truncate">
                        {language === 'es' ? action.descEs : action.descEn}
                      </p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-[#d4d4d4] group-hover:text-[#0a0a0a] transition-colors shrink-0" />
                  </GlassPanel>
                </motion.button>
              );
            })}
          </div>
        </motion.div>

        {/* Recent Cases */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', ...NOVA_SPRING, delay: 0.2 }}
        >
          <h2 className="text-xs font-medium text-[#a3a3a3] uppercase tracking-wider mb-3 font-[family-name:var(--font-geist-mono)]">
            {wt.recentCases}
          </h2>
          {conversations.length === 0 ? (
            <GlassPanel className="p-10 text-center">
              <MessageSquare className="w-8 h-8 text-[#d4d4d4] mx-auto mb-3" />
              <p className="text-sm text-[#a3a3a3] mb-4">{wt.noCases}</p>
              <button
                onClick={() => setActiveCase(null)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-sm text-sm font-medium bg-[#d4a017] hover:bg-[#b8901a] text-white transition-colors"
              >
                <Plus className="w-4 h-4" />
                {wt.newConsultation}
              </button>
            </GlassPanel>
          ) : (
            <div className="border border-[#e5e5e5] rounded-sm overflow-hidden divide-y divide-[#e5e5e5]">
              {conversations.slice(0, 8).map((conv, i) => {
                const Icon = USE_CASE_ICONS[conv.useCase] ?? MessageSquare;
                return (
                  <motion.button
                    key={conv.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ type: 'spring', ...NOVA_SPRING, delay: 0.22 + i * 0.02 }}
                    onClick={() => setActiveCase(conv.id)}
                    className="w-full p-4 bg-white hover:bg-[#fafafa] transition-colors flex items-center gap-3 text-left"
                  >
                    <div
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: RISK_COLORS[conv.riskLevel] }}
                    />
                    <Icon className="w-4 h-4 text-[#a3a3a3] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[#0a0a0a] truncate">{conv.title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="muted" className="text-[10px]">
                          {USE_CASE_LABELS[language]?.[conv.useCase] ?? conv.useCase}
                        </Badge>
                        <span className="text-[10px] text-[#a3a3a3] font-[family-name:var(--font-geist-mono)]">
                          {conv.messages.length} {d.messages}
                        </span>
                      </div>
                    </div>
                    <span className="text-xs text-[#a3a3a3] shrink-0 font-[family-name:var(--font-geist-mono)]">
                      {formatDate(conv.updatedAt)}
                    </span>
                  </motion.button>
                );
              })}
            </div>
          )}
        </motion.div>

        {/* Upcoming Deadlines Placeholder */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', ...NOVA_SPRING, delay: 0.3 }}
          className="mt-8"
        >
          <h2 className="text-xs font-medium text-[#a3a3a3] uppercase tracking-wider mb-3 font-[family-name:var(--font-geist-mono)]">
            {language === 'es' ? 'Calendario Tributario' : 'Tax Calendar'}
          </h2>
          <GlassPanel className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-sm bg-[#fafafa] border border-[#e5e5e5] flex items-center justify-center shrink-0">
                <Clock className="w-5 h-5 text-[#a3a3a3]" />
              </div>
              <div>
                <p className="text-sm text-[#525252]">
                  {language === 'es'
                    ? 'Proximamente: fechas clave del calendario tributario DIAN integradas automaticamente.'
                    : 'Coming soon: key DIAN tax calendar dates integrated automatically.'}
                </p>
              </div>
            </div>
          </GlassPanel>
        </motion.div>
      </div>
    </div>
  );
}

export default function WorkspacePage() {
  const { language } = useLanguage();
  const { activeCase, activeUseCase, setRiskAssessment, addDocument } = useWorkspace();

  const handleRiskAssessment = (data: RiskAssessmentData) => {
    setRiskAssessment(data);
  };

  const handleDocumentUploaded = (doc: UploadedDocument) => {
    addDocument({
      id: `doc-${Date.now()}`,
      name: doc.filename,
      type: 'document',
      size: doc.size,
      status: doc.chunks > 0 ? 'ready' : 'processing',
      uploadedAt: doc.uploadedAt,
    });
  };

  return activeCase ? (
    <ChatThread
      conversationId={activeCase}
      useCase={activeUseCase}
      language={language}
      onRiskAssessment={handleRiskAssessment}
      onDocumentUploaded={handleDocumentUploaded}
    />
  ) : (
    <DashboardOverview />
  );
}
