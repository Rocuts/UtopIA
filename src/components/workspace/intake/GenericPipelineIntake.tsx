'use client';

import { useState } from 'react';
import { motion } from 'motion/react';
import { Building2, ChevronRight, Rocket, Upload, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/context/WorkspaceContext';
import { StepWizard } from '@/design-system/components/StepWizard';
import { FileUploadZone } from '@/design-system/components/FileUploadZone';
import type { WizardStep } from '@/design-system/components/StepWizard';
import type { CaseType } from '@/types/platform';

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

export function GenericPipelineIntake({ caseType, useCase, title, subtitle, agents }: GenericPipelineIntakeProps) {
  const { startNewConsultation, setIntakeModalOpen } = useWorkspace();
  const [currentStep, setCurrentStep] = useState(0);
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

  const handleSubmit = () => {
    startNewConsultation(useCase);
    setIntakeModalOpen(false);
  };

  const steps: WizardStep[] = [
    {
      id: 'company',
      label: 'Empresa',
      isValid: company.name.length > 0 && company.nit.length > 5,
      component: (
        <div className="space-y-4 pb-6">
          <div>
            <h3 className="text-base font-semibold text-[#0a0a0a] mb-1">Datos de la Empresa</h3>
            <p className="text-xs text-[#a3a3a3]">Identifique la empresa para personalizar el analisis</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-[#525252] mb-1">Razon Social *</label>
              <input
                type="text"
                value={company.name}
                onChange={e => setCompany(c => ({ ...c, name: e.target.value }))}
                className="w-full border border-[#e5e5e5] rounded-lg px-3 py-2 text-sm text-[#0a0a0a] focus:border-[#0a0a0a] focus:outline-none transition-colors"
                placeholder="Nombre de la empresa"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#525252] mb-1">NIT *</label>
              <input
                type="text"
                value={company.nit}
                onChange={e => setCompany(c => ({ ...c, nit: formatNit(e.target.value) }))}
                className="w-full border border-[#e5e5e5] rounded-lg px-3 py-2 text-sm text-[#0a0a0a] font-[family-name:var(--font-geist-mono)] focus:border-[#0a0a0a] focus:outline-none transition-colors"
                placeholder="XXX.XXX.XXX-X"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#525252] mb-1">Tipo de Entidad</label>
              <div className="flex gap-1.5 flex-wrap">
                {['SAS', 'SA', 'LTDA', 'SCS', 'Otro'].map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setCompany(c => ({ ...c, entityType: t }))}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                      company.entityType === t
                        ? 'border-[#D4A017] bg-[#FEF9EC] text-[#7D5B0C]'
                        : 'border-[#e5e5e5] text-[#525252] hover:border-[#D4A017]',
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#525252] mb-1">Sector Economico</label>
              <input
                type="text"
                value={company.sector}
                onChange={e => setCompany(c => ({ ...c, sector: e.target.value }))}
                className="w-full border border-[#e5e5e5] rounded-lg px-3 py-2 text-sm text-[#0a0a0a] focus:border-[#0a0a0a] focus:outline-none transition-colors"
                placeholder="Ej: Tecnologia, Manufactura"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#525252] mb-1">Ciudad</label>
              <input
                type="text"
                value={company.city}
                onChange={e => setCompany(c => ({ ...c, city: e.target.value }))}
                className="w-full border border-[#e5e5e5] rounded-lg px-3 py-2 text-sm text-[#0a0a0a] focus:border-[#0a0a0a] focus:outline-none transition-colors"
                placeholder="Bogota"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#525252] mb-1">Periodo Fiscal</label>
              <input
                type="text"
                value={period}
                onChange={e => setPeriod(e.target.value)}
                className="w-full border border-[#e5e5e5] rounded-lg px-3 py-2 text-sm text-[#0a0a0a] font-[family-name:var(--font-geist-mono)] focus:border-[#0a0a0a] focus:outline-none transition-colors"
                placeholder="2025"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#525252] mb-1">Representante Legal</label>
              <input
                type="text"
                value={company.legalRepresentative}
                onChange={e => setCompany(c => ({ ...c, legalRepresentative: e.target.value }))}
                className="w-full border border-[#e5e5e5] rounded-lg px-3 py-2 text-sm text-[#0a0a0a] focus:border-[#0a0a0a] focus:outline-none transition-colors"
              />
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'documents',
      label: 'Documentos',
      isValid: true,
      component: (
        <div className="space-y-4 pb-6">
          <div>
            <h3 className="text-base font-semibold text-[#0a0a0a] mb-1">Documentos de Soporte</h3>
            <p className="text-xs text-[#a3a3a3]">Cargue los documentos relevantes para el analisis (opcional pero recomendado)</p>
          </div>
          <FileUploadZone
            accept=".pdf,.xlsx,.xls,.csv,.docx,.doc,.jpg,.jpeg,.png"
            onUpload={async (file) => {
              const formData = new FormData();
              formData.append('file', file);
              formData.append('context', file.name);
              await fetch('/api/upload', { method: 'POST', body: formData });
            }}
            label="Arrastre sus documentos aqui"
            sublabel="PDF, Excel, CSV, Word, imagenes"
          />
          <div className="mt-3">
            <label className="block text-xs font-medium text-[#525252] mb-1">Instrucciones Especiales (Opcional)</label>
            <textarea
              value={instructions}
              onChange={e => setInstructions(e.target.value)}
              maxLength={1000}
              rows={3}
              className="w-full border border-[#e5e5e5] rounded-lg px-3 py-2 text-sm text-[#0a0a0a] placeholder:text-[#a3a3a3] focus:border-[#0a0a0a] focus:outline-none transition-colors resize-none"
              placeholder="Ej: Enfocarse en el sector tecnologico y los beneficios de economia naranja..."
            />
            <span className="text-[10px] text-[#a3a3a3] font-[family-name:var(--font-geist-mono)]">
              {instructions.length}/1000
            </span>
          </div>
        </div>
      ),
    },
    {
      id: 'preview',
      label: 'Vista Previa',
      isValid: true,
      component: (
        <div className="space-y-6 pb-6">
          <div>
            <h3 className="text-base font-semibold text-[#0a0a0a] mb-1">{title}</h3>
            <p className="text-xs text-[#a3a3a3]">{subtitle}</p>
          </div>

          {/* Company summary */}
          <div className="bg-[#fafafa] border border-[#e5e5e5] rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Building2 className="w-4 h-4 text-[#525252]" />
              <span className="text-xs font-semibold text-[#0a0a0a] uppercase tracking-wider">Empresa</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div><span className="text-[#a3a3a3]">Razon Social:</span> <span className="text-[#0a0a0a] font-medium">{company.name || '—'}</span></div>
              <div><span className="text-[#a3a3a3]">NIT:</span> <span className="text-[#0a0a0a] font-[family-name:var(--font-geist-mono)]">{company.nit || '—'}</span></div>
              <div><span className="text-[#a3a3a3]">Tipo:</span> <span className="text-[#0a0a0a]">{company.entityType}</span></div>
              <div><span className="text-[#a3a3a3]">Periodo:</span> <span className="text-[#0a0a0a] font-[family-name:var(--font-geist-mono)]">{period}</span></div>
            </div>
          </div>

          {/* Pipeline */}
          <div className="bg-white border border-[#e5e5e5] rounded-xl p-4">
            <span className="text-[10px] font-bold text-[#a3a3a3] uppercase tracking-wider font-[family-name:var(--font-geist-mono)]">
              Pipeline que se ejecutara
            </span>
            <div className="flex items-center gap-2 mt-3 overflow-x-auto styled-scrollbar pb-2">
              {agents.map((agent, i) => (
                <div key={i} className="flex items-center">
                  <div className="rounded-lg border-2 border-[#D4A017]/30 bg-[#FEF9EC] px-3 py-2 min-w-[120px] text-center">
                    <p className="text-[10px] font-bold text-[#D4A017] font-[family-name:var(--font-geist-mono)]">Agente {i + 1}</p>
                    <p className="text-xs font-medium text-[#7D5B0C] mt-0.5">{agent}</p>
                  </div>
                  {i < agents.length - 1 && <ChevronRight className="w-4 h-4 text-[#d4d4d4] mx-1 shrink-0" />}
                </div>
              ))}
            </div>
          </div>

          {/* Info */}
          <div className="flex items-center gap-3 text-xs text-[#a3a3a3]">
            <div className="flex items-center gap-1">
              <span className="font-[family-name:var(--font-geist-mono)]">Modelo:</span>
              <span className="text-[#525252]">GPT-5.4 mini · 400K contexto</span>
            </div>
            <span>·</span>
            <div className="flex items-center gap-1">
              <span className="font-[family-name:var(--font-geist-mono)]">Tiempo:</span>
              <span className="text-[#525252]">~3-5 min</span>
            </div>
          </div>
          <p className="text-[10px] text-[#a3a3a3] flex items-center gap-1">
            <span>🔒</span> Su informacion es redactada (PII) antes de enviarse al LLM
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
