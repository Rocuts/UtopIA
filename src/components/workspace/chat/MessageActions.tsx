'use client';

import { useState, useCallback, useMemo } from 'react';
import { Copy, Check, RefreshCw, ThumbsUp, ThumbsDown, Download } from 'lucide-react';
import { useToast } from '@/design-system/components/Toast';
import { exportConversationPDF } from '@/lib/export/pdf-export';
import { inferTitle } from '@/lib/storage/conversation-history';
import { cn } from '@/lib/utils';
import { loadFeedback, saveFeedback, type FeedbackValue } from './utils';
import type { ChatMessage } from '../types';

interface MessageActionsProps {
  message: ChatMessage;
  language: 'es' | 'en';
  useCase: string;
  canRegenerate: boolean;
  onRegenerate: () => void;
}

export function MessageActions({
  message,
  language,
  useCase,
  canRegenerate,
  onRegenerate,
}: MessageActionsProps) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackValue>(() => loadFeedback(message.id));

  const labels = useMemo(() => ({
    copy: language === 'es' ? 'Copiar' : 'Copy',
    regen: language === 'es' ? 'Regenerar' : 'Regenerate',
    up: language === 'es' ? 'Buena respuesta' : 'Good response',
    down: language === 'es' ? 'Mala respuesta' : 'Bad response',
    exp: language === 'es' ? 'Exportar PDF' : 'Export PDF',
    copied: language === 'es' ? 'Copiado' : 'Copied',
    thanksUp: language === 'es' ? '¡Gracias por el feedback!' : 'Thanks for the feedback!',
    thanksDown: language === 'es' ? 'Feedback registrado' : 'Feedback recorded',
    exported: language === 'es' ? 'PDF exportado' : 'PDF exported',
    copyFailed: language === 'es' ? 'No se pudo copiar' : 'Could not copy',
    exportFailed: language === 'es' ? 'No se pudo exportar' : 'Could not export',
  }), [language]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      toast('success', labels.copied);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast('error', labels.copyFailed);
    }
  }, [message.content, toast, labels.copied, labels.copyFailed]);

  const handleFeedback = useCallback((value: 'up' | 'down') => {
    const next: FeedbackValue = feedback === value ? null : value;
    setFeedback(next);
    saveFeedback(message.id, next);
    if (next) toast('success', next === 'up' ? labels.thanksUp : labels.thanksDown);
  }, [feedback, message.id, toast, labels.thanksUp, labels.thanksDown]);

  const handleExport = useCallback(() => {
    try {
      exportConversationPDF({
        title: inferTitle([{ id: message.id, role: 'assistant', content: message.content }]),
        useCase,
        messages: [{ id: message.id, role: 'assistant', content: message.content }],
        language,
      });
      toast('success', labels.exported);
    } catch {
      toast('error', labels.exportFailed);
    }
  }, [message.id, message.content, useCase, language, toast, labels.exported, labels.exportFailed]);

  return (
    <div
      className="mt-3 flex items-center gap-1 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 opacity-100 transition-opacity"
      role="toolbar"
      aria-label={language === 'es' ? 'Acciones del mensaje' : 'Message actions'}
    >
      <button
        type="button"
        onClick={handleCopy}
        className="flex items-center gap-1 px-2 py-1 rounded text-xs-mono text-n-600 hover:text-n-900 hover:bg-n-100 transition-colors"
        title={labels.copy}
        aria-label={labels.copy}
      >
        {copied ? <Check className="w-3 h-3 text-gold-500" /> : <Copy className="w-3 h-3" />}
        <span className="hidden sm:inline">{copied ? labels.copied : labels.copy}</span>
      </button>
      {canRegenerate && (
        <button
          type="button"
          onClick={onRegenerate}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs-mono text-n-600 hover:text-n-900 hover:bg-n-100 transition-colors"
          title={labels.regen}
          aria-label={labels.regen}
        >
          <RefreshCw className="w-3 h-3" />
          <span className="hidden sm:inline">{labels.regen}</span>
        </button>
      )}
      <button
        type="button"
        onClick={() => handleFeedback('up')}
        className={cn(
          'flex items-center gap-1 px-2 py-1 rounded text-xs-mono transition-colors',
          feedback === 'up'
            ? 'text-gold-500 bg-gold-300/10'
            : 'text-n-600 hover:text-n-900 hover:bg-n-100',
        )}
        title={labels.up}
        aria-label={labels.up}
        aria-pressed={feedback === 'up'}
      >
        <ThumbsUp className="w-3 h-3" />
      </button>
      <button
        type="button"
        onClick={() => handleFeedback('down')}
        className={cn(
          'flex items-center gap-1 px-2 py-1 rounded text-xs-mono transition-colors',
          feedback === 'down'
            ? 'text-danger bg-danger/10'
            : 'text-n-600 hover:text-n-900 hover:bg-n-100',
        )}
        title={labels.down}
        aria-label={labels.down}
        aria-pressed={feedback === 'down'}
      >
        <ThumbsDown className="w-3 h-3" />
      </button>
      <button
        type="button"
        onClick={handleExport}
        className="flex items-center gap-1 px-2 py-1 rounded text-xs-mono text-n-600 hover:text-n-900 hover:bg-n-100 transition-colors ml-auto"
        title={labels.exp}
        aria-label={labels.exp}
      >
        <Download className="w-3 h-3" />
        <span className="hidden sm:inline">{labels.exp}</span>
      </button>
    </div>
  );
}
