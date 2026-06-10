'use client';

import { useState, useRef, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export function CodeBlockPre({ children, className }: { children?: React.ReactNode; className?: string }) {
  const [copied, setCopied] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);

  const handleCopy = useCallback(async () => {
    const text = preRef.current?.innerText ?? '';
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }, []);

  return (
    <div className="group/code relative my-2">
      <pre
        ref={preRef}
        className={cn(
          'bg-n-900 text-n-200 rounded-lg p-3 overflow-x-auto text-xs font-mono leading-relaxed',
          className,
        )}
      >
        {children}
      </pre>
      <button
        type="button"
        onClick={handleCopy}
        className="absolute top-2 right-2 p-1.5 rounded bg-n-700 text-n-400 hover:text-n-0 hover:bg-n-600 opacity-0 group-hover/code:opacity-100 focus:opacity-100 transition-opacity"
        aria-label={copied ? 'Copiado' : 'Copiar código'}
        title={copied ? 'Copiado' : 'Copiar código'}
      >
        {copied ? <Check className="w-3.5 h-3.5 text-gold-500" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}
