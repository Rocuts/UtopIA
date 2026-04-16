'use client';

import { useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { useWorkspace } from '@/context/WorkspaceContext';
import { DianDefenseIntake } from './DianDefenseIntake';
import { TaxRefundIntake } from './TaxRefundIntake';
import { DueDiligenceIntake } from './DueDiligenceIntake';
import { FinancialIntelIntake } from './FinancialIntelIntake';
import { NiifReportIntake } from './NiifReportIntake';
import type { CaseType } from '@/types/platform';

// ─── Case Type Titles ────────────────────────────────────────────────────────

const TITLES: Record<CaseType, string> = {
  dian_defense: 'Nueva Defensa DIAN',
  tax_refund: 'Nueva Devolucion de Impuestos',
  due_diligence: 'Nuevo Due Diligence',
  financial_intel: 'Nueva Inteligencia Financiera',
  niif_report: 'Nuevo Reporte NIIF Integral',
};

// ─── Component ───────────────────────────────────────────────────────────────

export function IntakeModal() {
  const { intakeModalOpen, setIntakeModalOpen, activeCaseType } = useWorkspace();

  const handleClose = useCallback(() => {
    setIntakeModalOpen(false);
  }, [setIntakeModalOpen]);

  // Close on Escape key
  useEffect(() => {
    if (!intakeModalOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        handleClose();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [intakeModalOpen, handleClose]);

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
      default:
        return null;
    }
  };

  return (
    <AnimatePresence>
      {intakeModalOpen && activeCaseType && (
        <motion.div
          key="intake-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
          onClick={(e) => {
            if (e.target === e.currentTarget) handleClose();
          }}
        >
          <motion.div
            key="intake-container"
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            className="relative w-full max-w-3xl h-[85vh] bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden mx-4"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#e5e5e5] shrink-0">
              <h2 className="text-base font-semibold text-[#0a0a0a]">
                {TITLES[activeCaseType]}
              </h2>
              <button
                onClick={handleClose}
                className="p-1.5 rounded-lg text-[#a3a3a3] hover:text-[#525252] hover:bg-[#f5f5f5] transition-colors"
                aria-label="Cerrar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form Content */}
            <div className="flex-1 min-h-0 overflow-hidden">
              {renderIntakeForm()}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
