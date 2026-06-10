'use client';

import { motion } from 'motion/react';
import { SPRING } from './constants';
import { formatTime } from './utils';
import type { ChatMessage } from '../types';

export function UserMessage({ message }: { message: ChatMessage }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', ...SPRING }}
      className="border-b border-n-200/40 px-6 py-6"
    >
      <div className="max-w-[var(--chat-reading-width)] mx-auto w-full">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-medium text-n-600">Usted</span>
          <time
            dateTime={message.timestamp}
            className="text-xs text-n-600 font-mono"
          >
            {formatTime(message.timestamp)}
          </time>
        </div>
        <p className="text-md text-n-900 leading-relaxed whitespace-pre-wrap">{message.content ?? ''}</p>
      </div>
    </motion.div>
  );
}
