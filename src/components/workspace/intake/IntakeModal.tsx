'use client';

import { useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { useWorkspace } from '@/context/WorkspaceContext';
import { DianDefenseIntake } from './DianDefenseIntake';
import { TaxRefundIntake } from './TaxRefundIntake';
import { DueDiligenceIntake } from './DueDiligenceIntake';
import { FinancialIntelIntake } from './FinancialIntelIntake';
import { NiifReportIntake } from './NiifReportIntake';
import { GenericPipelineIntake } from './GenericPipelineIntake';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import type { CaseType } from '@/types/platform';

// ─── Case Type Titles ────────────────────────────────────────────────────────

const TITLES: Record<CaseType, string> = {
  general_chat: 'Chat General',
  dian_defense: 'Nueva Defensa DIAN',
  tax_refund: 'Nueva Devolución de Impuestos',
  due_diligence: 'Nuevo Due Diligence',
  financial_intel: 'Nueva Inteligencia Financiera',
  niif_report: 'Nuevo Reporte NIIF Integral',
  tax_planning: 'Nueva Planeación Tributaria',
  transfer_pricing: 'Nuevo Estudio de Precios de Transferencia',
  business_valuation: 'Nueva Valoración Empresarial',
  fiscal_audit_opinion: 'Nuevo Dictamen de Revisoría Fiscal',
  tax_reconciliation: 'Nueva Conciliación Fiscal',
  feasibility_study: 'Nuevo Estudio de Factibilidad',
};

// ─── Component ───────────────────────────────────────────────────────────────

export function IntakeModal() {
  const { intakeModalOpen, setIntakeModalOpen, activeCaseType } = useWorkspace();
  const modalRef = useRef<HTMLDivElement>(null);

  const handleClose = useCallback(() => {
    setIntakeModalOpen(false);
  }, [setIntakeModalOpen]);

  useFocusTrap(modalRef, intakeModalOpen, handleClose);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (intakeModalOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [intakeModalOpen]);

  const renderIntakeForm = () => {
    switch (activeCaseType) {
      case 'general_chat':
        return null; // General chat skips intake
      case 'dian_defense':
        return <DianDefenseIntake />;
      case 'tax_refund':
        return <TaxRefundIntake />;
      case 'due_diligence':
        return <DueDiligenceIntake />;
      case 'financial_intel':
        return <FinancialIntelIntake />;
      case 'niif_report':
        return <NiifReportIntake />;
      case 'tax_planning':
        return <GenericPipelineIntake caseType="tax_planning" useCase="tax-planning" title="Planeación Tributaria" subtitle="Optimice la carga fiscal de su empresa con estrategias legales basadas en el E.T. 2026" agents={['Optimizador Tributario', 'Analista Impacto NIIF', 'Validador de Cumplimiento']} />;
      case 'transfer_pricing':
        return <GenericPipelineIntake caseType="transfer_pricing" useCase="transfer-pricing" title="Precios de Transferencia" subtitle="Documentación comprobatoria y análisis de plena competencia (Arts. 260-1 a 260-11 E.T.)" agents={['Analista TP', 'Análisis de Comparables', 'Documentación DIAN']} />;
      case 'business_valuation':
        return <GenericPipelineIntake caseType="business_valuation" useCase="business-valuation" title="Valoración Empresarial" subtitle="Valoración profesional por DCF, multiplos de mercado y activos netos ajustados (NIIF 13)" agents={['Modelador DCF', 'Comparables de Mercado', 'Sintetizador de Valoración']} />;
      case 'fiscal_audit_opinion':
        return <GenericPipelineIntake caseType="fiscal_audit_opinion" useCase="fiscal-audit-opinion" title="Dictamen de Revisoría Fiscal" subtitle="Opinión formal tipo NIA 700 con evaluación de empresa en marcha, errores materiales y cumplimiento" agents={['Evaluador Empresa en Marcha', 'Revisor de Errores Materiales', 'Verificador de Cumplimiento', 'Redactor de Dictamen']} />;
      case 'tax_reconciliation':
        return <GenericPipelineIntake caseType="tax_reconciliation" useCase="tax-reconciliation" title="Conciliación Fiscal" subtitle="Conciliación NIIF-fiscal con cálculo de impuesto diferido (Art. 772-1 E.T., Formato 2516)" agents={['Identificador de Diferencias', 'Calculador de Impuesto Diferido']} />;
      case 'feasibility_study':
        return <GenericPipelineIntake caseType="feasibility_study" useCase="feasibility-study" title="Estudio de Factibilidad" subtitle="Estudio de mercado, modelo financiero (VPN, TIR, WACC) y análisis de riesgo para proyectos colombianos" agents={['Analista de Mercado', 'Modelador Financiero', 'Evaluador de Riesgo']} />;
      default:
        return null;
    }
  };

  return (
    <AnimatePresence>
      {intakeModalOpen && activeCaseType && activeCaseType !== 'general_chat' && (
        <motion.div
          key="intake-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-n-1000/50 backdrop-blur-sm"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) handleClose();
          }}
        >
          <motion.div
            key="intake-container"
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="intake-modal-title"
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            className="relative w-[min(920px,calc(100vw-32px))] max-h-[min(880px,92vh)] bg-n-0 rounded-xl shadow-e5 flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-n-200 shrink-0">
              <h2 id="intake-modal-title" className="text-base font-semibold text-n-900">
                {TITLES[activeCaseType]}
              </h2>
              <button
                type="button"
                onClick={handleClose}
                className="p-1.5 rounded-lg text-n-400 hover:text-n-600 hover:bg-n-100 transition-colors"
                aria-label="Cerrar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form Content — wheel events go to inner scrollable via data-lenis-prevent */}
            <div className="flex-1 min-h-0 overflow-hidden" data-lenis-prevent>
              {renderIntakeForm()}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
