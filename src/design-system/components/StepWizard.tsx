'use client';

import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { ChevronLeft, ChevronRight, Rocket } from 'lucide-react';
import { cn } from '@/lib/utils';
import { tokens } from '../tokens';

export interface WizardStep {
  id: string;
  label: string;
  isValid: boolean;
  component: React.ReactNode;
}

interface StepWizardProps {
  steps: WizardStep[];
  currentStep: number;
  onNext: () => void;
  onBack: () => void;
  onSubmit: () => void;
  submitLabel?: string;
  className?: string;
}

export function StepWizard({
  steps,
  currentStep,
  onNext,
  onBack,
  onSubmit,
  submitLabel = 'Enviar',
  className,
}: StepWizardProps) {
  const prefersReduced = useReducedMotion();
  const isLast = currentStep === steps.length - 1;
  const isFirst = currentStep === 0;
  const current = steps[currentStep];

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Progress bar */}
      <div className="px-6 pt-6 pb-4 shrink-0">
        <nav aria-label="Pasos del formulario">
          <ol className="flex items-center gap-2 mb-3">
            {steps.map((step, i) => {
              const completionState =
                i < currentStep
                  ? 'completado'
                  : i === currentStep
                    ? 'actual'
                    : 'pendiente';
              return (
                <li
                  key={step.id}
                  className="flex items-center gap-2 flex-1"
                  aria-current={currentStep === i ? 'step' : undefined}
                  aria-label={`Paso ${i + 1}: ${step.label} (${completionState})`}
                >
                  <div className="flex items-center gap-2 flex-1">
                    <div
                      className={cn(
                        'w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 transition-colors',
                        i < currentStep && 'bg-[#0a0a0a] text-white',
                        i === currentStep && 'bg-[#D4A017] text-white',
                        i > currentStep && 'bg-[#f5f5f5] text-[#a3a3a3] border border-[#e5e5e5]',
                      )}
                    >
                      {i < currentStep ? '\u2713' : i + 1}
                    </div>
                    <span
                      className={cn(
                        'text-xs font-medium hidden sm:block truncate',
                        i === currentStep ? 'text-[#0a0a0a]' : 'text-[#a3a3a3]',
                      )}
                    >
                      {step.label}
                    </span>
                  </div>
                  {i < steps.length - 1 && (
                    <div
                      aria-hidden="true"
                      className={cn(
                        'h-px flex-1 min-w-[16px]',
                        i < currentStep ? 'bg-[#0a0a0a]' : 'bg-[#e5e5e5]',
                      )}
                    />
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      </div>

      {/* Step content */}
      {/* data-lenis-prevent: el wizard vive dentro de IntakeModal (fixed overlay).
          Lenis está en modo root y secuestra el wheel global; sin este atributo
          en el scrollable real, la rueda del mouse no llega a este contenedor
          y el contenido queda cortado abajo. Defensivo y siempre correcto. */}
      <div
        data-lenis-prevent
        className="flex-1 min-h-0 overflow-y-auto styled-scrollbar px-6"
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={current.id}
            initial={prefersReduced ? { opacity: 1 } : { opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={prefersReduced ? { opacity: 1 } : { opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            {current.component}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Navigation */}
      <div className="px-6 py-4 border-t border-[#e5e5e5] flex items-center justify-between shrink-0">
        <button
          type="button"
          onClick={onBack}
          disabled={isFirst}
          className={cn(
            'flex items-center gap-1.5 px-4 py-2 rounded text-sm font-medium transition-colors',
            isFirst
              ? 'text-[#d4d4d4] cursor-not-allowed'
              : 'text-[#525252] hover:bg-[#fafafa]',
          )}
        >
          <ChevronLeft className="w-4 h-4" />
          Anterior
        </button>

        {isLast ? (
          <button
            type="button"
            onClick={onSubmit}
            disabled={!current.isValid}
            className={cn(
              'flex items-center gap-1.5 px-6 py-2.5 rounded text-sm font-semibold transition-colors',
              current.isValid
                ? 'bg-[#D4A017] hover:bg-[#A87C10] text-white'
                : 'bg-[#e5e5e5] text-[#a3a3a3] cursor-not-allowed',
            )}
          >
            <Rocket className="w-4 h-4" />
            {submitLabel}
          </button>
        ) : (
          <button
            type="button"
            onClick={onNext}
            disabled={!current.isValid}
            className={cn(
              'flex items-center gap-1.5 px-5 py-2 rounded text-sm font-medium transition-colors',
              current.isValid
                ? 'bg-[#0a0a0a] hover:bg-[#262626] text-white'
                : 'bg-[#e5e5e5] text-[#a3a3a3] cursor-not-allowed',
            )}
          >
            Siguiente
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
