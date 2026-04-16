'use client';

import { useState, useCallback, useRef } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'motion/react';
import {
  Shield,
  TrendingUp,
  FileSearch,
  BarChart3,
  Sparkles,
  Calculator,
  Globe,
  DollarSign,
  ClipboardCheck,
  GitCompareArrows,
  Lightbulb,
  Upload,
  ArrowRight,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useLanguage } from '@/context/LanguageContext';
import type { CaseType } from '@/types/platform';

// ─── Animation config ────────────────────────────────────────────────────────

const SPRING = { stiffness: 400, damping: 25 };

// ─── Data ────────────────────────────────────────────────────────────────────

interface ServiceItem {
  id: CaseType;
  icon: React.ComponentType<{ className?: string }>;
  labelEs: string;
  labelEn: string;
}

interface ServiceCategory {
  roleEs: string;
  roleEn: string;
  icon: React.ComponentType<{ className?: string }>;
  items: ServiceItem[];
}

const CATEGORIES: ServiceCategory[] = [
  {
    roleEs: 'Tributarista',
    roleEn: 'Tax Specialist',
    icon: Shield,
    items: [
      { id: 'dian_defense', icon: Shield, labelEs: 'Defensa DIAN', labelEn: 'DIAN Defense' },
      { id: 'tax_refund', icon: TrendingUp, labelEs: 'Devoluciones', labelEn: 'Tax Refunds' },
      { id: 'tax_planning', icon: Calculator, labelEs: 'Planeacion Tributaria', labelEn: 'Tax Planning' },
      { id: 'transfer_pricing', icon: Globe, labelEs: 'Precios de Transferencia', labelEn: 'Transfer Pricing' },
    ],
  },
  {
    roleEs: 'Contador',
    roleEn: 'Accountant',
    icon: ClipboardCheck,
    items: [
      { id: 'fiscal_audit_opinion', icon: ClipboardCheck, labelEs: 'Dictamen Revisoria Fiscal', labelEn: 'Fiscal Audit Opinion' },
      { id: 'tax_reconciliation', icon: GitCompareArrows, labelEs: 'Conciliacion Fiscal', labelEn: 'Tax Reconciliation' },
    ],
  },
  {
    roleEs: 'Analista Financiero',
    roleEn: 'Financial Analyst',
    icon: BarChart3,
    items: [
      { id: 'financial_intel', icon: BarChart3, labelEs: 'Inteligencia Financiera', labelEn: 'Financial Intelligence' },
      { id: 'business_valuation', icon: DollarSign, labelEs: 'Valoracion Empresarial', labelEn: 'Business Valuation' },
      { id: 'due_diligence', icon: FileSearch, labelEs: 'Due Diligence Financiero', labelEn: 'Financial Due Diligence' },
    ],
  },
  {
    roleEs: 'Economista',
    roleEn: 'Economist',
    icon: Lightbulb,
    items: [
      { id: 'feasibility_study', icon: Lightbulb, labelEs: 'Estudio de Factibilidad', labelEn: 'Feasibility Study' },
    ],
  },
];

const ACCEPTED_EXTENSIONS = ['.csv', '.xlsx', '.xls', '.pdf', '.docx', '.png', '.jpg', '.jpeg'];
const ACCEPTED_MIME_TYPES = [
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png',
  'image/jpeg',
];

// ─── Component ───────────────────────────────────────────────────────────────

export function WelcomeScreen() {
  const { language } = useLanguage();
  const { openIntakeForType } = useWorkspace();
  const prefersReduced = useReducedMotion();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [uploadFileName, setUploadFileName] = useState('');

  const es = language === 'es';

  // ─── File handling ───────────────────────────────────────────────────────

  const handleFile = useCallback(async (file: File) => {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    const isAccepted = ACCEPTED_EXTENSIONS.includes(ext) || ACCEPTED_MIME_TYPES.includes(file.type);
    if (!isAccepted) {
      setUploadState('error');
      setUploadFileName(file.name);
      setTimeout(() => setUploadState('idle'), 3000);
      return;
    }

    setUploadState('uploading');
    setUploadFileName(file.name);

    // Detect trial balance files and route to NIIF pipeline
    const isTrialBalance =
      (ext === '.csv' || ext === '.xlsx' || ext === '.xls') &&
      /balance|balanza|comprobacion|trial|puc/i.test(file.name);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('context', file.name);
      const response = await fetch('/api/upload', { method: 'POST', body: formData });
      if (!response.ok) throw new Error('Upload failed');

      setUploadState('success');

      // Auto-route: trial balance files go to NIIF Report pipeline
      if (isTrialBalance) {
        setTimeout(() => {
          openIntakeForType('niif_report');
          setUploadState('idle');
        }, 800);
      } else {
        setTimeout(() => setUploadState('idle'), 2000);
      }
    } catch {
      setUploadState('error');
      setTimeout(() => setUploadState('idle'), 3000);
    }
  }, [openIntakeForType]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const onDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await handleFile(file);
  }, [handleFile]);

  const onFileInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await handleFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [handleFile]);

  // ─── Animation helpers ─────────────────────────────────────────────────

  const fadeUp = (delay: number) =>
    prefersReduced
      ? {}
      : {
          initial: { opacity: 0, y: 10 },
          animate: { opacity: 1, y: 0 },
          transition: { type: 'spring' as const, ...SPRING, delay },
        };

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <div className="h-full overflow-y-auto styled-scrollbar">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 flex flex-col gap-5">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <motion.div
          {...fadeUp(0)}
          className="flex items-center gap-2.5"
        >
          <img
            src="/logo-modern.png"
            alt="UtopIA"
            className="w-8 h-8 rounded-lg object-cover invert hue-rotate-180"
          />
          <span className="text-lg font-bold tracking-tight text-[#0a0a0a]">
            UtopIA.
          </span>
          <span className="text-xs text-[#a3a3a3] ml-1 hidden sm:inline">
            {es
              ? 'Su firma contable, potenciada por IA'
              : 'Your accounting firm, powered by AI'}
          </span>
        </motion.div>

        {/* ── Section 1: Smart Drop Zone ─────────────────────────────── */}
        <motion.div {...fadeUp(0.05)}>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept={ACCEPTED_EXTENSIONS.join(',')}
            onChange={onFileInputChange}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className={cn(
              'w-full rounded-lg border-2 border-dashed p-5 sm:p-6 transition-all duration-200 cursor-pointer',
              'flex flex-col items-center justify-center gap-2 text-center',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4A017]/50 focus-visible:ring-offset-2',
              isDragOver
                ? 'border-[#D4A017] bg-[#FEF9EC] shadow-[0_0_0_3px_rgba(212,160,23,0.1)]'
                : 'border-[#e5e5e5] bg-[#fafafa] hover:border-[#D4A017]/40 hover:bg-[#FEF9EC]/30',
            )}
          >
            <AnimatePresence mode="wait">
              {uploadState === 'idle' && (
                <motion.div
                  key="idle"
                  initial={false}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center gap-2"
                >
                  <div className={cn(
                    'w-10 h-10 rounded-full flex items-center justify-center transition-colors',
                    isDragOver ? 'bg-[#D4A017]/15 text-[#D4A017]' : 'bg-[#e5e5e5]/60 text-[#737373]',
                  )}>
                    <Upload className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#0a0a0a]">
                      {es
                        ? 'Suelte su archivo aqui — UtopIA detecta automaticamente que hacer'
                        : 'Drop your file here — UtopIA auto-detects what to do'}
                    </p>
                    <p className="text-xs text-[#a3a3a3] mt-1">
                      CSV, XLSX, PDF, DOCX, PNG, JPG
                    </p>
                  </div>
                </motion.div>
              )}
              {uploadState === 'uploading' && (
                <motion.div
                  key="uploading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-3"
                >
                  <div className="w-4 h-4 border-2 border-[#D4A017] border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm text-[#525252]">
                    {es ? 'Procesando' : 'Processing'} {uploadFileName}...
                  </span>
                </motion.div>
              )}
              {uploadState === 'success' && (
                <motion.div
                  key="success"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-2 text-emerald-600"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-sm font-medium">
                    {es ? 'Archivo procesado' : 'File processed'}: {uploadFileName}
                  </span>
                </motion.div>
              )}
              {uploadState === 'error' && (
                <motion.div
                  key="error"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-2 text-red-500"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  <span className="text-sm font-medium">
                    {es ? 'Error al procesar' : 'Processing error'}: {uploadFileName}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </button>
        </motion.div>

        {/* ── Section 2: NIIF Elite Hero Card ────────────────────────── */}
        <motion.button
          {...fadeUp(0.1)}
          type="button"
          onClick={() => openIntakeForType('niif_report')}
          className={cn(
            'w-full rounded-lg border p-5 sm:p-6 text-left transition-all group',
            'bg-gradient-to-r from-[#FEF9EC] via-[#FDF0C4]/50 to-[#FEF9EC]',
            'border-[#D4A017]/30 hover:border-[#D4A017] hover:shadow-[0_0_12px_rgba(212,160,23,0.12)]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4A017]/50 focus-visible:ring-offset-2',
          )}
        >
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
            {/* Left: Copy */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5">
                <Sparkles className="w-4 h-4 text-[#D4A017]" />
                <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-[#D4A017]/15 text-[#D4A017] uppercase tracking-wider">
                  ELITE
                </span>
              </div>
              <h2 className="text-base font-bold text-[#7D5B0C] mb-1">
                {es ? 'Reporte NIIF Elite' : 'NIIF Elite Report'}
              </h2>
              <p className="text-xs text-[#7D5B0C]/70 leading-relaxed">
                {es
                  ? 'Reporte financiero corporativo completo con auditoria regulatoria y meta-auditoria de calidad.'
                  : 'Complete corporate financial report with regulatory audit and quality meta-audit.'}
              </p>
              <p className="text-[10px] font-[family-name:var(--font-geist-mono)] text-[#D4A017]/80 mt-2">
                3 {es ? 'agentes' : 'agents'} + 4 {es ? 'auditores' : 'auditors'} + meta-auditor
              </p>
            </div>

            {/* Right: Pipeline visualization */}
            <div className="flex items-center gap-2 sm:gap-3 shrink-0" aria-hidden="true">
              {/* 3 Agent circles */}
              <div className="flex items-center">
                {[0, 1, 2].map((i) => (
                  <div
                    key={`agent-${i}`}
                    className="w-6 h-6 rounded-full border-2 border-[#D4A017]/40 bg-[#D4A017]/10 flex items-center justify-center -ml-1.5 first:ml-0"
                  >
                    <span className="text-[8px] font-bold text-[#D4A017]">A</span>
                  </div>
                ))}
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-[#D4A017]/40" />
              {/* 4 Auditor circles */}
              <div className="flex items-center">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={`auditor-${i}`}
                    className="w-6 h-6 rounded-full border-2 border-[#D4A017]/40 bg-[#D4A017]/10 flex items-center justify-center -ml-1.5 first:ml-0"
                  >
                    <span className="text-[8px] font-bold text-[#D4A017]">R</span>
                  </div>
                ))}
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-[#D4A017]/40" />
              {/* 1 Meta-auditor circle */}
              <div className="w-7 h-7 rounded-full border-2 border-[#D4A017] bg-[#D4A017]/20 flex items-center justify-center">
                <Sparkles className="w-3.5 h-3.5 text-[#D4A017]" />
              </div>

              {/* CTA arrow */}
              <div className="w-8 h-8 rounded-full bg-[#D4A017] flex items-center justify-center ml-1 group-hover:bg-[#b8880f] transition-colors">
                <ArrowRight className="w-4 h-4 text-white" />
              </div>
            </div>
          </div>
        </motion.button>

        {/* ── Section 3: Service Categories Grid ─────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {CATEGORIES.map((category, catIndex) => {
            const CatIcon = category.icon;
            return (
              <motion.div
                key={category.roleEs}
                {...fadeUp(0.15 + catIndex * 0.04)}
                className="rounded-lg border border-[#e5e5e5] bg-white"
              >
                {/* Category header */}
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#f5f5f5]">
                  <div className="w-6 h-6 rounded flex items-center justify-center bg-[#fafafa] text-[#525252]">
                    <CatIcon className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-xs font-semibold text-[#0a0a0a] uppercase tracking-wide">
                    {es ? category.roleEs : category.roleEn}
                  </span>
                </div>

                {/* Service items */}
                <div className="px-1.5 py-1.5">
                  {category.items.map((item) => {
                    const ItemIcon = item.icon;
                    const isEliteLink = item.id === 'niif_report';

                    // Skip rendering NIIF in the Contador category since it has its own hero card
                    // but we keep any elite link reference
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => openIntakeForType(item.id)}
                        className={cn(
                          'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-left transition-colors group/item',
                          'hover:bg-[#fafafa] focus-visible:outline-none focus-visible:bg-[#fafafa] focus-visible:ring-1 focus-visible:ring-[#e5e5e5]',
                        )}
                      >
                        <ItemIcon className="w-3.5 h-3.5 text-[#a3a3a3] group-hover/item:text-[#525252] transition-colors shrink-0" />
                        <span className="text-sm text-[#525252] group-hover/item:text-[#0a0a0a] transition-colors truncate">
                          {es ? item.labelEs : item.labelEn}
                        </span>
                        {isEliteLink && (
                          <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-[#D4A017]/10 text-[#D4A017] ml-auto shrink-0">
                            ELITE
                          </span>
                        )}
                        <ChevronRight className="w-3 h-3 text-[#d4d4d4] group-hover/item:text-[#a3a3a3] transition-colors ml-auto shrink-0" />
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            );
          })}
        </div>

      </div>
    </div>
  );
}
