'use client';

import { motion } from 'motion/react';
import { useReducedMotion } from 'motion/react';
import { SPRING, STARTER_PROMPTS } from './constants';

export function StarterChips({
  useCase,
  language,
  onPick,
}: {
  useCase: string;
  language: 'es' | 'en';
  onPick: (prompt: string) => void;
}) {
  const prefersReduced = useReducedMotion();
  const prompts = STARTER_PROMPTS[useCase] ?? STARTER_PROMPTS.default;
  const list = prompts[language];

  return (
    <div className="px-6 pb-6">
      <div className="max-w-[var(--chat-reading-width)] mx-auto w-full">
        <p className="text-xs-mono uppercase tracking-eyebrow text-n-500 mb-3 font-mono font-medium">
          {language === 'es' ? 'Sugerencias para empezar' : 'Suggestions to get started'}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {list.map((p, i) => (
            <motion.button
              key={p}
              type="button"
              onClick={() => onPick(p)}
              initial={prefersReduced ? undefined : { opacity: 0, y: 6 }}
              animate={prefersReduced ? undefined : { opacity: 1, y: 0 }}
              transition={{ type: 'spring', ...SPRING, delay: prefersReduced ? 0 : i * 0.03 }}
              whileHover={prefersReduced ? undefined : { y: -1 }}
              className="text-left text-sm text-n-900 bg-n-50 border border-n-200 rounded-lg px-3 py-2.5 hover:border-gold-500 hover:bg-gold-300/10 transition-colors"
            >
              {p}
            </motion.button>
          ))}
        </div>
      </div>
    </div>
  );
}
