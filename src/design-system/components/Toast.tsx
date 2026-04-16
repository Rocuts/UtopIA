'use client';

import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type ToastVariant = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: string;
  variant: ToastVariant;
  message: string;
  duration?: number;
}

interface ToastContextValue {
  toast: (variant: ToastVariant, message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

const ICONS: Record<ToastVariant, React.ComponentType<{ className?: string }>> = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const STYLES: Record<ToastVariant, string> = {
  success: 'bg-[#F0FDF4] border-[#BBF7D0] text-[#16A34A]',
  error: 'bg-[#FEF2F2] border-[#FECACA] text-[#DC2626]',
  warning: 'bg-[#FFFBEB] border-[#FDE68A] text-[#D97706]',
  info: 'bg-[#EFF6FF] border-[#BFDBFE] text-[#2563EB]',
};

function ToastNotification({ item, onDismiss }: { item: ToastItem; onDismiss: (id: string) => void }) {
  const Icon = ICONS[item.variant];

  useEffect(() => {
    const duration = item.duration ?? 4000;
    const timer = setTimeout(() => onDismiss(item.id), duration);
    return () => clearTimeout(timer);
  }, [item, onDismiss]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 50, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 50, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className={cn('flex items-center gap-2 px-4 py-3 rounded-lg border shadow-md min-w-[280px] max-w-[400px]', STYLES[item.variant])}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className="text-sm flex-1">{item.message}</span>
      <button
        onClick={() => onDismiss(item.id)}
        className="p-0.5 opacity-60 hover:opacity-100 transition-opacity shrink-0"
        aria-label="Cerrar"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </motion.div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = useCallback((variant: ToastVariant, message: string, duration?: number) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts(prev => [...prev, { id, variant, message, duration }]);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 items-end pointer-events-none">
        <AnimatePresence>
          {toasts.map(t => (
            <div key={t.id} className="pointer-events-auto">
              <ToastNotification item={t} onDismiss={dismiss} />
            </div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
