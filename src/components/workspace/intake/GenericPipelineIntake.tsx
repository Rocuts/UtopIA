'use client';

import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Building2, ChevronRight, Upload, CheckCircle, AlertCircle, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/context/WorkspaceContext';
import { StepWizard } from '@/design-system/components/StepWizard';
import { FileUploadZone } from '@/design-system/components/FileUploadZone';
import type { WizardStep } from '@/design-system/components/StepWizard';
import type { CaseType } from '@/types/platform';
import { useDocumentExtraction, type FieldConfidence } from './useDocumentExtraction';

interface GenericPipelineIntakeProps {
  caseType: CaseType;
  useCase: string;
  title: string;
  subtitle: string;
  agents: string[];
}

function formatNit(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function ConfidenceDot({ level }: { level?: FieldConfidence }) {
  if (!level || level === 'none') return null;
  return (
    <span
      className={cn('inline-block w-1.5 h-1.5 rounded-full ml-1', level === 'high' ? 'bg-[#22C55E]' : 'bg-[#F59E0B]')}
      title={level === 'high' ? 'Auto-detectado' : 'Inferido — verificar'}
    />
  );
}

export function GenericPipelineIntake({ caseType, useCase, title, subtitle, agents }: GenericPipelineIntakeProps) {
  const { startNewConsultation, setIntakeModalOpen } = useWorkspace();
  const { state: extractionState, uploadAndExtract, reset: resetExtraction } = useDocumentExtraction();
  const [currentStep, setCurrentStep] = useState(0);
  const [skippedUpload, setSkippedUpload] = useState(false);
  const [company, setCompany] = useState({
    name: '',
    nit: '',
    entityType: 'SAS',
    sector: '',
    city: '',
    legalRepresentative: '',
    accountant: '',
  });
  const [period, setPeriod] = useState('2025');
  const [instructions, setInstructions] = useState('');

  // Pre-fill from extraction
  useEffect(() => {
    if (extractionState.status === 'done' && extractionState.extracted) {
      const ext = extractionState.extracted;
      setCompany(prev => ({
        ...prev,
        name: ext.company.name || prev.name,
        nit: ext.company.nit || prev.nit,
        entityType: ext.company.entityType || prev.entityType,
        city: ext.company.city || prev.city,
        legalRepresentative: ext.company.legalRepresentative || prev.legalRepresentative,
        accountant: ext.company.accountant || prev.accountant,
        sector: ext.company.sector || prev.sector,
      }));
      if (ext.fiscalPeriod) setPeriod(ext.fiscalPeriod);
      // Auto-advance to review step
      const timer = setTimeout(() => setCurrentStep(1), 800);
      return () => clearTimeout(timer);
    }
  }, [extractionState.status, extractionState.extracted]);

  const handleSubmit = () => {
    startNewConsultation(useCase);
    setIntakeModalOpen(false);
  };

  const confidence = extractionState.extracted?.confidence ?? {};
  const detected = Object.values(confidence).filter(c => c === 'high' || c === 'medium').length;
  const totalFields = 7;

  const steps: WizardStep[] = [
    // Step 1: Upload Document
    {
      id: 'upload',
      label: 'Documento',
      isValid: extractionState.status === 'done' || skippedUpload,
      component: (
        <div className="space-y-4 pb-6">
          <div>
            <h3 className="text-base font-semibold text-[#0a0a0a] mb-1">Cargue su documento</h3>
            <p className="text-xs text-[#a3a3a3]">
              1+1 extrae automáticamente los datos de su archivo y pre-llena el formulario
            </p>
          </div>

          {extractionState.status === 'done' && extractionState.extracted ? (
            <div className="space-y-3">
              {/* Success card */}
              <div className="border border-[#22C55E]/30 bg-[#F0FDF4] rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="w-4 h-4 text-[#22C55E]" />
                  <span className="text-sm font-semibold text-[#16A34A]">{extractionState.fileName}</span>
                </div>
                <p className="text-xs text-[#16A34A]/80">
                  {detected} de {totalFields} campos detectados automáticamente
                </p>
                {extractionState.extracted.isTrialBalance && (
                  <div className="mt-2 pt-2 border-t border-[#22C55E]/20 text-xs text-[#16A34A]/80 space-y-0.5">
                    {extractionState.extracted.accountsDetected && <p>Cuentas detectadas: {extractionState.extracted.accountsDetected}</p>}
                    {extractionState.extracted.equationValid !== undefined && (
                      <p>Ecuación patrimonial: {extractionState.extracted.equationValid ? 'Válida' : 'Con discrepancias'}</p>
                    )}
                  </div>
                )}
              </div>
              <button type="button" onClick={() => { resetExtraction(); }} className="text-xs text-[#a3a3a3] hover:text-[#525252] transition-colors">
                Subir otro archivo
              </button>
            </div>
          ) : extractionState.status === 'uploading' || extractionState.status === 'extracting' ? (
            <div className="border border-[#D4A017]/30 bg-[#FEF9EC] rounded-xl p-6 text-center">
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
                <Upload className="w-6 h-6 text-[#D4A017] mx-auto" />
              </motion.div>
              <p className="text-sm text-[#7D5B0C] mt-2 font-medium">
                {extractionState.status === 'uploading' ? 'Subiendo archivo...' : 'Extrayendo datos...'}
              </p>
              <div className="w-48 h-1.5 bg-[#D4A017]/20 rounded-full overflow-hidden mx-auto mt-3">
                <motion.div className="h-full bg-[#D4A017] rounded-full" animate={{ width: `${extractionState.progress}%` }} />
              </div>
            </div>
          ) : extractionState.status === 'error' ? (
            <div className="border border-[#EF4444]/30 bg-[#FEF2F2] rounded-xl p-4">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-[#EF4444]" />
                <span className="text-sm text-[#DC2626]">{extractionState.error}</span>
              </div>
              <button type="button" onClick={resetExtraction} className="text-xs text-[#DC2626] hover:underline mt-2">Intentar de nuevo</button>
            </div>
          ) : (
            <FileUploadZone
              accept=".csv,.xlsx,.xls,.pdf,.docx,.doc,.jpg,.jpeg,.png"
              onUpload={uploadAndExtract}
              maxSizeMB={25}
              label="Arrastre su archivo aquí"
              sublabel="Balance de prueba, estados financieros, acto administrativo, declaraciones"
            />
          )}

          {extractionState.status === 'idle' && (
            <button
              type="button"
              onClick={() => { setSkippedUpload(true); setCurrentStep(1); }}
              className="text-xs text-[#a3a3a3] hover:text-[#525252] transition-colors block mx-auto"
            >
              Llenar manualmente sin documento
            </button>
          )}
        </div>
      ),
    },

    // Step 2: Review + Complete Data
    {
      id: 'review',
      label: 'Datos',
      isValid: company.name.length > 0 && company.nit.length > 5,
      component: (
        <div className="space-y-4 pb-6">
          <div>
            <h3 className="text-base font-semibold text-[#0a0a0a] mb-1">Verifique los datos</h3>
            {detected > 0 && (
              <div className="flex items-center gap-2 mt-1.5 px-3 py-1.5 bg-[#F0FDF4] border border-[#BBF7D0] rounded-lg">
                <CheckCircle className="w-3.5 h-3.5 text-[#22C55E]" />
                <span className="text-xs text-[#16A34A] font-medium">
                  {detected} de {totalFields} campos auto-detectados
                </span>
                <span className="text-[10px] text-[#16A34A]/60 ml-auto flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E]" /> alta
                  <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B] ml-1" /> inferido
                </span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-[#525252] flex items-center gap-0.5 mb-1">
                Razón Social * <ConfidenceDot level={confidence.name} />
              </label>
              <input type="text" value={company.name} onChange={e => setCompany(c => ({ ...c, name: e.target.value }))}
                className={cn('w-full border rounded-lg px-3 py-2 text-sm text-[#0a0a0a] focus:border-[#0a0a0a] focus:outline-none transition-colors',
                  !company.name && !skippedUpload && extractionState.status === 'done' ? 'border-[#EF4444]/50' : 'border-[#e5e5e5]')}
                placeholder="Nombre de la empresa" />
            </div>
            <div>
              <label className="text-xs font-medium text-[#525252] flex items-center gap-0.5 mb-1">
                NIT * <ConfidenceDot level={confidence.nit} />
              </label>
              <input type="text" value={company.nit} onChange={e => setCompany(c => ({ ...c, nit: formatNit(e.target.value) }))}
                className={cn('w-full border rounded-lg px-3 py-2 text-sm text-[#0a0a0a] font-[family-name:var(--font-geist-mono)] focus:border-[#0a0a0a] focus:outline-none transition-colors',
                  !company.nit && !skippedUpload && extractionState.status === 'done' ? 'border-[#EF4444]/50' : 'border-[#e5e5e5]')}
                placeholder="XXX.XXX.XXX-X" />
            </div>
            <div>
              <label className="text-xs font-medium text-[#525252] flex items-center gap-0.5 mb-1">
                Tipo Entidad <ConfidenceDot level={confidence.entityType} />
              </label>
              <div className="flex gap-1.5 flex-wrap">
                {['SAS', 'SA', 'LTDA', 'SCS', 'Otro'].map(t => (
                  <button key={t} type="button" onClick={() => setCompany(c => ({ ...c, entityType: t }))}
                    className={cn('px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                      company.entityType === t ? 'border-[#D4A017] bg-[#FEF9EC] text-[#7D5B0C]' : 'border-[#e5e5e5] text-[#525252] hover:border-[#D4A017]')}
                  >{t}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-[#525252] flex items-center gap-0.5 mb-1">
                Periodo Fiscal <ConfidenceDot level={confidence.fiscalPeriod} />
              </label>
              <input type="text" value={period} onChange={e => setPeriod(e.target.value)}
                className="w-full border border-[#e5e5e5] rounded-lg px-3 py-2 text-sm text-[#0a0a0a] font-[family-name:var(--font-geist-mono)] focus:border-[#0a0a0a] focus:outline-none transition-colors"
                placeholder="2025" />
            </div>
            <div>
              <label className="text-xs font-medium text-[#525252] flex items-center gap-0.5 mb-1">
                Ciudad <ConfidenceDot level={confidence.city} />
              </label>
              <input type="text" value={company.city} onChange={e => setCompany(c => ({ ...c, city: e.target.value }))}
                className="w-full border border-[#e5e5e5] rounded-lg px-3 py-2 text-sm text-[#0a0a0a] focus:border-[#0a0a0a] focus:outline-none transition-colors"
                placeholder="Bogotá" />
            </div>
            <div>
              <label className="text-xs font-medium text-[#525252] flex items-center gap-0.5 mb-1">
                Sector
              </label>
              <input type="text" value={company.sector} onChange={e => setCompany(c => ({ ...c, sector: e.target.value }))}
                className="w-full border border-[#e5e5e5] rounded-lg px-3 py-2 text-sm text-[#0a0a0a] focus:border-[#0a0a0a] focus:outline-none transition-colors"
                placeholder="Ej: Tecnología, Comercio" />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-[#525252] mb-1 block">Instrucciones Especiales</label>
            <textarea value={instructions} onChange={e => setInstructions(e.target.value)} maxLength={1000} rows={2}
              className="w-full border border-[#e5e5e5] rounded-lg px-3 py-2 text-sm text-[#0a0a0a] placeholder:text-[#a3a3a3] focus:border-[#0a0a0a] focus:outline-none transition-colors resize-none"
              placeholder="Contexto adicional para los agentes..." />
          </div>
        </div>
      ),
    },

    // Step 3: Preview + Launch
    {
      id: 'preview',
      label: 'Confirmar',
      isValid: true,
      component: (
        <div className="space-y-5 pb-6">
          <div>
            <h3 className="text-base font-semibold text-[#0a0a0a] mb-1">{title}</h3>
            <p className="text-xs text-[#a3a3a3]">{subtitle}</p>
          </div>

          {/* Company summary */}
          <div className="bg-[#fafafa] border border-[#e5e5e5] rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Building2 className="w-4 h-4 text-[#525252]" />
              <span className="text-xs font-semibold text-[#0a0a0a] uppercase tracking-wider">Empresa</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5 text-xs">
              <div><span className="text-[#a3a3a3]">Razón Social:</span> <span className="text-[#0a0a0a] font-medium">{company.name || '—'}</span></div>
              <div><span className="text-[#a3a3a3]">NIT:</span> <span className="text-[#0a0a0a] font-[family-name:var(--font-geist-mono)]">{company.nit || '—'}</span></div>
              <div><span className="text-[#a3a3a3]">Tipo:</span> <span className="text-[#0a0a0a]">{company.entityType}</span></div>
              <div><span className="text-[#a3a3a3]">Periodo:</span> <span className="text-[#0a0a0a] font-[family-name:var(--font-geist-mono)]">{period}</span></div>
            </div>
          </div>

          {/* Pipeline */}
          <div className="bg-white border border-[#e5e5e5] rounded-xl p-4">
            <span className="text-[10px] font-bold text-[#a3a3a3] uppercase tracking-wider font-[family-name:var(--font-geist-mono)]">
              Pipeline que se ejecutará
            </span>
            <div className="flex items-center gap-2 mt-3 overflow-x-auto styled-scrollbar pb-2">
              {agents.map((agent, i) => (
                <div key={i} className="flex items-center">
                  <div className="rounded-lg border-2 border-[#D4A017]/30 bg-[#FEF9EC] px-3 py-2 min-w-[110px] text-center">
                    <p className="text-[10px] font-bold text-[#D4A017] font-[family-name:var(--font-geist-mono)]">Agente {i + 1}</p>
                    <p className="text-xs font-medium text-[#7D5B0C] mt-0.5">{agent}</p>
                  </div>
                  {i < agents.length - 1 && <ChevronRight className="w-4 h-4 text-[#d4d4d4] mx-1 shrink-0" />}
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3 text-[10px] text-[#a3a3a3]">
            <span>Modelo: GPT-5.4 mini · 400K contexto</span>
            <span>·</span>
            <span>~3-5 min</span>
          </div>
          <p className="text-[10px] text-[#a3a3a3]">
            Su información es redactada (PII) antes de enviarse al LLM
          </p>
        </div>
      ),
    },
  ];

  return (
    <StepWizard
      steps={steps}
      currentStep={currentStep}
      onNext={() => setCurrentStep(s => Math.min(s + 1, steps.length - 1))}
      onBack={() => setCurrentStep(s => Math.max(s - 1, 0))}
      onSubmit={handleSubmit}
      submitLabel={`Generar ${title}`}
    />
  );
}
