'use client';

import { useState, useMemo } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Column<T> {
  key: keyof T & string;
  label: string;
  width?: string;
  align?: 'left' | 'center' | 'right';
  formatter?: (value: T[keyof T], row: T) => React.ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  sortable?: boolean;
  className?: string;
  emptyMessage?: string;
}

export function copFormatter(value: number): string {
  return `$${value.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  rows,
  sortable = false,
  className,
  emptyMessage = 'Sin datos',
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const handleSort = (key: string) => {
    if (!sortable) return;
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    return [...rows].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null || bv == null) return 0;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sortKey, sortDir]);

  if (rows.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-[#a3a3a3]">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className={cn('w-full overflow-x-auto', className)}>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-[#e5e5e5]">
            {columns.map(col => (
              <th
                key={col.key}
                className={cn(
                  'px-3 py-2 text-[10px] font-medium text-[#a3a3a3] uppercase tracking-wider font-[family-name:var(--font-geist-mono)]',
                  col.align === 'right' && 'text-right',
                  col.align === 'center' && 'text-center',
                  sortable && 'cursor-pointer hover:text-[#525252] select-none',
                )}
                style={col.width ? { width: col.width } : undefined}
                onClick={() => handleSort(col.key)}
              >
                <span className="inline-flex items-center gap-1">
                  {col.label}
                  {sortable && sortKey === col.key ? (
                    sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                  ) : sortable ? (
                    <ArrowUpDown className="w-3 h-3 opacity-30" />
                  ) : null}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr
              key={i}
              className="border-b border-[#f5f5f5] hover:bg-[#fafafa] transition-colors"
            >
              {columns.map(col => (
                <td
                  key={col.key}
                  className={cn(
                    'px-3 py-2 text-[#0a0a0a]',
                    col.align === 'right' && 'text-right font-[family-name:var(--font-geist-mono)]',
                    col.align === 'center' && 'text-center',
                  )}
                >
                  {col.formatter ? col.formatter(row[col.key], row) : String(row[col.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
