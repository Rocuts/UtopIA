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

const RISK_COLORS: Record<RiskLevel, string> = {
  bajo: '#10b981',
  medio: '#f59e0b',
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

  // Determine the dominant risk level for the gauge
  const dominantRisk: RiskLevel = stats
    ? (Object.entries(stats.riskCounts).sort((a, b) => b[1] - a[1])[0]?.[0] as RiskLevel) || 'bajo'
    : 'bajo';

  const riskScore: Record<RiskLevel, number> = { bajo: 20, medio: 45, alto: 70, critico: 90 };

  const d = t.dashboard;

  return (
    <div className="min-h-screen bg-[var(--background)] pt-24 pb-16">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-7xl">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-10">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="p-2 rounded-xl text-foreground/50 hover:text-[#d4a017] hover:bg-[#d4a017]/10 transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-foreground flex items-center gap-3">
                <LayoutDashboard className="w-7 h-7 text-[#d4a017]" />
                {d.title}
              </h1>
              <p className="text-sm text-foreground/50 mt-1">{d.subtitle}</p>
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <GlassPanel className="p-6" hoverEffect>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-[#d4a017]/10 border border-[#d4a017]/20 flex items-center justify-center">
                  <MessageSquare className="w-5 h-5 text-[#d4a017]" />
                </div>
                <span className="text-sm text-foreground/60">{d.totalCases}</span>
              </div>
              <p className="text-3xl font-bold text-foreground">{stats?.total ?? 0}</p>
            </GlassPanel>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <GlassPanel className="p-6" hoverEffect>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-[#10b981]/10 border border-[#10b981]/20 flex items-center justify-center">
                  <CheckCircle className="w-5 h-5 text-[#10b981]" />
                </div>
                <span className="text-sm text-foreground/60">{d.lowRisk}</span>
              </div>
              <p className="text-3xl font-bold text-foreground">{stats?.riskCounts.bajo ?? 0}</p>
            </GlassPanel>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <GlassPanel className="p-6" hoverEffect>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-[#f97316]/10 border border-[#f97316]/20 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-[#f97316]" />
                </div>
                <span className="text-sm text-foreground/60">{d.highRisk}</span>
              </div>
              <p className="text-3xl font-bold text-foreground">
                {(stats?.riskCounts.alto ?? 0) + (stats?.riskCounts.critico ?? 0)}
              </p>
            </GlassPanel>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
          >
            <GlassPanel className="p-6 flex flex-col items-center justify-center" hoverEffect>
              <RiskGauge
                level={dominantRisk}
                label={language === 'es' ? undefined : undefined}
                score={conversations.length > 0 ? riskScore[dominantRisk] : 0}
                className="scale-75 -my-2"
              />
              <span className="text-xs text-foreground/50 mt-1">{d.riskOverview}</span>
            </GlassPanel>
          </motion.div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
          {[
            { icon: Shield, label: d.actionDian, href: '/#ai-consult', color: '#1e3a5f' },
            { icon: TrendingUp, label: d.actionRefund, href: '/#ai-consult', color: '#10b981' },
            { icon: BarChart3, label: d.actionIntelligence, href: '/#ai-consult', color: '#d4a017' },
          ].map((action, i) => (
            <motion.div
              key={action.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 + i * 0.1 }}
            >
              <Link href={action.href}>
                <GlassPanel
                  className="p-5 flex items-center gap-4 cursor-pointer"
                  hoverEffect
                >
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `${action.color}15`, border: `1px solid ${action.color}30` }}
                  >
                    <action.icon className="w-6 h-6" style={{ color: action.color }} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{action.label}</p>
                    <p className="text-xs text-foreground/50">{d.startNow}</p>
                  </div>
                </GlassPanel>
              </Link>
            </motion.div>
          ))}
        </div>

        {/* Conversation List */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Clock className="w-5 h-5 text-[#d4a017]" />
            {d.recentCases}
          </h2>
        </div>

        {conversations.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <GlassPanel className="p-12 text-center">
              <MessageSquare className="w-12 h-12 text-foreground/20 mx-auto mb-4" />
              <p className="text-foreground/50 mb-4">{d.noCases}</p>
              <Link href="/#ai-consult">
                <Button size="sm">
                  <Plus className="w-4 h-4 mr-2" />
                  {d.newConsultation}
                </Button>
              </Link>
            </GlassPanel>
          </motion.div>
        ) : (
          <div className="space-y-3">
            <AnimatePresence>
              {conversations.map((conv, i) => (
                <motion.div
                  key={conv.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <GlassPanel className="p-5" hoverEffect>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                      {/* Risk indicator */}
                      <div
                        className="w-2 h-2 rounded-full shrink-0 hidden sm:block"
                        style={{
                          backgroundColor: RISK_COLORS[conv.riskLevel],
                          boxShadow: `0 0 8px ${RISK_COLORS[conv.riskLevel]}`,
                        }}
                      />

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">
                          {conv.title}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 mt-1">
                          <Badge variant="accent" className="text-[10px]">
                            {USE_CASE_LABELS[language]?.[conv.useCase] ?? conv.useCase}
                          </Badge>
                          <span
                            className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border"
                            style={{
                              color: RISK_COLORS[conv.riskLevel],
                              borderColor: `${RISK_COLORS[conv.riskLevel]}50`,
                              backgroundColor: `${RISK_COLORS[conv.riskLevel]}10`,
                            }}
                          >
                            {conv.riskLevel.toUpperCase()}
                          </span>
                          <span className="text-xs text-foreground/40">
                            {conv.messages.length} {d.messages}
                          </span>
                        </div>
                      </div>

                      {/* Date */}
                      <span className="text-xs text-foreground/40 shrink-0">
                        {formatDate(conv.updatedAt)}
                      </span>

                      {/* Actions */}
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleExport(conv)}
                          className="p-2 rounded-lg text-foreground/40 hover:text-[#d4a017] hover:bg-[#d4a017]/10 transition-colors"
                          title={d.exportPdf}
                        >
                          <FileDown className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(conv.id)}
                          className="p-2 rounded-lg text-foreground/40 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                          title={d.delete}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </GlassPanel>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
