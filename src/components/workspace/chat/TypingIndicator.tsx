'use client';

import { motion } from 'motion/react';
import { SPRING } from './constants';

export function TypingIndicator({ language, progressStatus }: { language: 'es' | 'en'; progressStatus?: string }) {
  const labels: Record<string, Record<string, string>> = {
    classifying: { es: 'Clasificando su consulta...', en: 'Classifying your query...' },
    enhancing: { es: 'Mejorando su pregunta...', en: 'Enhancing your question...' },
    routing: { es: 'Consultando agentes especializados...', en: 'Consulting specialized agents...' },
    agent_working: { es: 'Investigando...', en: 'Researching...' },
    synthesizing: { es: 'Sintetizando respuesta...', en: 'Synthesizing response...' },
  };

  const label = progressStatus && labels[progressStatus]
    ? labels[progressStatus][language]
    : (language === 'es' ? 'Analizando su consulta...' : 'Analyzing your consultation...');

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ type: 'spring', ...SPRING }}
      className="px-6 py-4"
    >
      <div className="flex items-center gap-3">
        <motion.div
          className="h-[2px] bg-gradient-to-r from-gold-500 via-n-900 to-transparent flex-1 max-w-[200px] rounded-full"
          animate={{ scaleX: [0, 1, 0], x: ['-100%', '0%', '100%'] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          style={{ transformOrigin: 'left' }}
        />
        <span className="text-xs text-n-600 font-mono">{label}</span>
      </div>
    </motion.div>
  );
}
