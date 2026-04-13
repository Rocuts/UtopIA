'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import {
  LayoutDashboard,
  MessageSquare,
  TrendingUp,
  Shield,
  Clock,
  Trash2,
  FileDown,
  Plus,
  ArrowLeft,
  AlertTriangle,
  CheckCircle,
  BarChart3,
} from 'lucide-react';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { RiskGauge } from '@/components/ui/RiskGauge';
import { useLanguage } from '@/context/LanguageContext';
import {
  listConversations,
  deleteConversation,
  getConversationStats,
  type Conversation,
  type RiskLevel,
} from '@/lib/storage/conversation-history';
import { exportConversationPDF } from '@/lib/export/pdf-export';

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
    'tax-refund': 'Devolución de Saldos',
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

export default function DashboardPage() {
  const { language, t } = useLanguage();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [stats, setStats] = useState<ReturnType<typeof getConversationStats> | null>(null);

  useEffect(() => {
    setConversations(listConversations());
    setStats(getConversationStats());
  }, []);

  const handleDelete = (id: string) => {
    deleteConversation(id);
    setConversations(listConversations());
    setStats(getConversationStats());
  };

  const handleExport = (conv: Conversation) => {
    exportConversationPDF({
      title: conv.title,
      useCase: USE_CASE_LABELS[language]?.[conv.useCase] ?? conv.useCase,
      messages: conv.messages,
      language,
    });
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(
      language === 'es' ? 'es-CO' : 'en-US',
      { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    );
  };

  const dominantRisk: RiskLevel = stats
    ? (Object.entries(stats.riskCounts).sort((a, b) => b[1] - a[1])[0]?.[0] as RiskLevel) || 'bajo'
    : 'bajo';

  const riskScore: Record<RiskLevel, number> = { bajo: 20, medio: 45, alto: 70, critico: 90 };

  const d = t.dashboard;

  return (
    <div className="min-h-screen bg-white pt-24 pb-16">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-7xl">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-10">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="p-2 rounded-sm text-[#a3a3a3] hover:text-[#0a0a0a] hover:bg-[#fafafa] transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-[#0a0a0a] flex items-center gap-3">
                <LayoutDashboard className="w-6 h-6" />
                {d.title}
              </h1>
              <p className="text-sm text-[#a3a3a3] mt-1">{d.subtitle}</p>
            </div>
          </div>
          <Link href="/#ai-consult">
            <Button size="sm">
              <Plus className="w-4 h-4 mr-2" />
              {d.newConsultation}
            </Button>
          </Link>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-[#e5e5e5] border border-[#e5e5e5] rounded-sm overflow-hidden mb-10">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", ...NOVA_SPRING, delay: 0.05 }}
            className="bg-white"
          >
            <GlassPanel className="p-6 border-0 rounded-none" hoverEffect>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 rounded-sm bg-[#fafafa] border border-[#e5e5e5] flex items-center justify-center">
                  <MessageSquare className="w-4 h-4 text-[#0a0a0a]" />
                </div>
                <span className="text-sm text-[#a3a3a3]">{d.totalCases}</span>
              </div>
              <p className="text-3xl font-bold text-[#0a0a0a] font-[family-name:var(--font-geist-mono)]">{stats?.total ?? 0}</p>
            </GlassPanel>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", ...NOVA_SPRING, delay: 0.1 }}
            className="bg-white"
          >
            <GlassPanel className="p-6 border-0 rounded-none" hoverEffect>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 rounded-sm bg-[#f0fdf4] border border-[#e5e5e5] flex items-center justify-center">
                  <CheckCircle className="w-4 h-4 text-[#22c55e]" />
                </div>
                <span className="text-sm text-[#a3a3a3]">{d.lowRisk}</span>
              </div>
              <p className="text-3xl font-bold text-[#0a0a0a] font-[family-name:var(--font-geist-mono)]">{stats?.riskCounts.bajo ?? 0}</p>
            </GlassPanel>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", ...NOVA_SPRING, delay: 0.15 }}
            className="bg-white"
          >
            <GlassPanel className="p-6 border-0 rounded-none" hoverEffect>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 rounded-sm bg-[#fff7ed] border border-[#e5e5e5] flex items-center justify-center">
                  <AlertTriangle className="w-4 h-4 text-[#f97316]" />
                </div>
                <span className="text-sm text-[#a3a3a3]">{d.highRisk}</span>
              </div>
              <p className="text-3xl font-bold text-[#0a0a0a] font-[family-name:var(--font-geist-mono)]">
                {(stats?.riskCounts.alto ?? 0) + (stats?.riskCounts.critico ?? 0)}
              </p>
            </GlassPanel>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", ...NOVA_SPRING, delay: 0.2 }}
            className="bg-white"
          >
            <GlassPanel className="p-6 flex flex-col items-center justify-center border-0 rounded-none" hoverEffect>
              <RiskGauge
                level={dominantRisk}
                label={language === 'es' ? undefined : undefined}
                score={conversations.length > 0 ? riskScore[dominantRisk] : 0}
                className="scale-75 -my-2"
              />
              <span className="text-xs text-[#a3a3a3] mt-1">{d.riskOverview}</span>
            </GlassPanel>
          </motion.div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
          {[
            { icon: Shield, label: d.actionDian, href: '/#ai-consult' },
            { icon: TrendingUp, label: d.actionRefund, href: '/#ai-consult' },
            { icon: BarChart3, label: d.actionIntelligence, href: '/#ai-consult' },
          ].map((action, i) => (
            <motion.div
              key={action.label}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", ...NOVA_SPRING, delay: 0.25 + i * 0.05 }}
            >
              <Link href={action.href}>
                <GlassPanel className="p-5 flex items-center gap-4 cursor-pointer" hoverEffect>
                  <div className="w-10 h-10 rounded-sm flex items-center justify-center shrink-0 bg-[#fafafa] border border-[#e5e5e5]">
                    <action.icon className="w-5 h-5 text-[#0a0a0a]" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[#0a0a0a]">{action.label}</p>
                    <p className="text-xs text-[#a3a3a3]">{d.startNow}</p>
                  </div>
                </GlassPanel>
              </Link>
            </motion.div>
          ))}
        </div>

        {/* Conversation List */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-bold text-[#0a0a0a] flex items-center gap-2">
            <Clock className="w-4 h-4" />
            {d.recentCases}
          </h2>
        </div>

        {conversations.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <GlassPanel className="p-12 text-center">
              <MessageSquare className="w-10 h-10 text-[#d4d4d4] mx-auto mb-4" />
              <p className="text-[#a3a3a3] mb-4">{d.noCases}</p>
              <Link href="/#ai-consult">
                <Button size="sm">
                  <Plus className="w-4 h-4 mr-2" />
                  {d.newConsultation}
                </Button>
              </Link>
            </GlassPanel>
          </motion.div>
        ) : (
          <div className="border border-[#e5e5e5] rounded-sm overflow-hidden divide-y divide-[#e5e5e5]">
            <AnimatePresence>
              {conversations.map((conv, i) => (
                <motion.div
                  key={conv.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ type: "spring", ...NOVA_SPRING, delay: i * 0.03 }}
                  className="bg-white"
                >
                  <div className="p-5 hover:bg-[#fafafa] transition-colors">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                      <div
                        className="w-2 h-2 rounded-full shrink-0 hidden sm:block"
                        style={{ backgroundColor: RISK_COLORS[conv.riskLevel] }}
                      />

                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[#0a0a0a] truncate">
                          {conv.title}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 mt-1">
                          <Badge variant="muted" className="text-[10px]">
                            {USE_CASE_LABELS[language]?.[conv.useCase] ?? conv.useCase}
                          </Badge>
                          <span
                            className="text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-sm border font-[family-name:var(--font-geist-mono)]"
                            style={{
                              color: RISK_COLORS[conv.riskLevel],
                              borderColor: '#e5e5e5',
                              backgroundColor: '#fafafa',
                            }}
                          >
                            {conv.riskLevel.toUpperCase()}
                          </span>
                          <span className="text-xs text-[#a3a3a3] font-[family-name:var(--font-geist-mono)]">
                            {conv.messages.length} {d.messages}
                          </span>
                        </div>
                      </div>

                      <span className="text-xs text-[#a3a3a3] shrink-0 font-[family-name:var(--font-geist-mono)]">
                        {formatDate(conv.updatedAt)}
                      </span>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleExport(conv)}
                          className="p-2 rounded-sm text-[#a3a3a3] hover:text-[#0a0a0a] hover:bg-[#fafafa] transition-colors"
                          title={d.exportPdf}
                        >
                          <FileDown className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(conv.id)}
                          className="p-2 rounded-sm text-[#a3a3a3] hover:text-[#ef4444] hover:bg-[#fef2f2] transition-colors"
                          title={d.delete}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
