'use client';

/**
 * /workspace/contabilidad/cuentas — Plan de Cuentas (PUC Colombia).
 *
 * Self-contained Client Component with:
 *   - Back link + heading
 *   - Search bar (code or name, case-insensitive) + "Nueva cuenta" CTA
 *   - Expandable / collapsible 3-level PUC tree (static demo data)
 *   - Amounts right-aligned in monospace, COP formatting
 *
 * Design system: Tailwind v4, neutral n-scale, area accent #B8934A (gold-500).
 */

import { useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Plus,
  Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PucNode {
  id: string;
  code: string;
  name: string;
  balance: number;
  level: 1 | 2 | 3;
  children: PucNode[];
}

// ─── Static demo data (Decreto 2650) ─────────────────────────────────────────

const PUC_DATA: PucNode[] = [
  {
    id: '1',
    code: '1',
    name: 'ACTIVO',
    balance: 84_200_000,
    level: 1,
    children: [
      {
        id: '11',
        code: '11',
        name: 'Efectivo y equivalentes',
        balance: 12_400_000,
        level: 2,
        children: [
          { id: '1105', code: '1105', name: 'Caja', balance: 2_400_000, level: 3, children: [] },
          { id: '1110', code: '1110', name: 'Bancos', balance: 10_000_000, level: 3, children: [] },
        ],
      },
      {
        id: '13',
        code: '13',
        name: 'Deudores',
        balance: 38_200_000,
        level: 2,
        children: [
          { id: '1305', code: '1305', name: 'Clientes', balance: 38_200_000, level: 3, children: [] },
        ],
      },
      {
        id: '14',
        code: '14',
        name: 'Inventarios',
        balance: 33_600_000,
        level: 2,
        children: [
          { id: '1435', code: '1435', name: 'Mercancías no fabricadas por la empresa', balance: 33_600_000, level: 3, children: [] },
        ],
      },
    ],
  },
  {
    id: '2',
    code: '2',
    name: 'PASIVO',
    balance: 52_800_000,
    level: 1,
    children: [
      {
        id: '21',
        code: '21',
        name: 'Obligaciones financieras',
        balance: 28_400_000,
        level: 2,
        children: [
          { id: '2105', code: '2105', name: 'Bancos nacionales', balance: 28_400_000, level: 3, children: [] },
        ],
      },
      {
        id: '22',
        code: '22',
        name: 'Proveedores',
        balance: 16_280_000,
        level: 2,
        children: [
          { id: '2205', code: '2205', name: 'Proveedores nacionales', balance: 16_280_000, level: 3, children: [] },
        ],
      },
      {
        id: '24',
        code: '24',
        name: 'Impuestos, gravámenes y tasas',
        balance: 8_120_000,
        level: 2,
        children: [
          { id: '2408', code: '2408', name: 'IVA por pagar', balance: 4_840_000, level: 3, children: [] },
          { id: '2404', code: '2404', name: 'Retención en la fuente', balance: 3_280_000, level: 3, children: [] },
        ],
      },
    ],
  },
  {
    id: '3',
    code: '3',
    name: 'PATRIMONIO',
    balance: 31_400_000,
    level: 1,
    children: [
      {
        id: '31',
        code: '31',
        name: 'Capital social',
        balance: 25_000_000,
        level: 2,
        children: [
          { id: '3105', code: '3105', name: 'Capital suscrito y pagado', balance: 25_000_000, level: 3, children: [] },
        ],
      },
      {
        id: '33',
        code: '33',
        name: 'Reservas',
        balance: 6_400_000,
        level: 2,
        children: [
          { id: '3305', code: '3305', name: 'Reserva legal', balance: 6_400_000, level: 3, children: [] },
        ],
      },
    ],
  },
  {
    id: '4',
    code: '4',
    name: 'INGRESOS',
    balance: 58_600_000,
    level: 1,
    children: [
      {
        id: '41',
        code: '41',
        name: 'Operacionales de comercio',
        balance: 54_200_000,
        level: 2,
        children: [
          { id: '4135', code: '4135', name: 'Comercio al por mayor y al por menor', balance: 54_200_000, level: 3, children: [] },
        ],
      },
      {
        id: '42',
        code: '42',
        name: 'No operacionales',
        balance: 4_400_000,
        level: 2,
        children: [
          { id: '4210', code: '4210', name: 'Financieros', balance: 4_400_000, level: 3, children: [] },
        ],
      },
    ],
  },
  {
    id: '5',
    code: '5',
    name: 'GASTOS',
    balance: 41_800_000,
    level: 1,
    children: [
      {
        id: '51',
        code: '51',
        name: 'Operacionales de administración',
        balance: 29_600_000,
        level: 2,
        children: [
          { id: '5105', code: '5105', name: 'Sueldos y salarios', balance: 18_400_000, level: 3, children: [] },
          { id: '5110', code: '5110', name: 'Gastos de personal', balance: 11_200_000, level: 3, children: [] },
        ],
      },
      {
        id: '52',
        code: '52',
        name: 'Operacionales de ventas',
        balance: 12_200_000,
        level: 2,
        children: [
          { id: '5205', code: '5205', name: 'Publicidad y propaganda', balance: 5_800_000, level: 3, children: [] },
          { id: '5210', code: '5210', name: 'Comisiones', balance: 6_400_000, level: 3, children: [] },
        ],
      },
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCOP(amount: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function flattenNodes(nodes: PucNode[]): PucNode[] {
  const out: PucNode[] = [];
  function walk(list: PucNode[]) {
    for (const n of list) {
      out.push(n);
      if (n.children.length) walk(n.children);
    }
  }
  walk(nodes);
  return out;
}

function collectAncestorIds(
  all: PucNode[],
  matchedIds: Set<string>,
): Set<string> {
  // Build parent map
  const parentOf = new Map<string, string>();
  function walk(nodes: PucNode[], parentId: string | null) {
    for (const n of nodes) {
      if (parentId) parentOf.set(n.id, parentId);
      walk(n.children, n.id);
    }
  }
  walk(all, null);
  const ancestors = new Set<string>();
  for (const id of matchedIds) {
    let cur = parentOf.get(id);
    while (cur) {
      ancestors.add(cur);
      cur = parentOf.get(cur);
    }
  }
  return ancestors;
}

// ─── PUC Row ──────────────────────────────────────────────────────────────────

interface RowProps {
  node: PucNode;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  matchedIds: Set<string> | null;
  ancestorIds: Set<string>;
}

function PucRow({ node, expanded, onToggle, matchedIds, ancestorIds }: RowProps) {
  const filtering = matchedIds !== null;
  const isMatch = filtering ? matchedIds.has(node.id) : true;
  const isAncestor = filtering ? ancestorIds.has(node.id) : false;
  if (filtering && !isMatch && !isAncestor) return null;

  const hasChildren = node.children.length > 0;
  const isOpen = filtering ? true : expanded.has(node.id);

  const indentPx = (node.level - 1) * 20;

  // Level-specific visual weight
  const isL1 = node.level === 1;
  const isL3 = node.level === 3;

  return (
    <>
      <tr
        className={cn(
          'group transition-colors',
          isL1
            ? 'bg-n-50 dark:bg-n-100/50'
            : 'hover:bg-gold-500/5',
          isMatch && filtering ? 'bg-gold-500/10' : '',
        )}
      >
        {/* Code */}
        <td
          className={cn(
            'py-2.5 pr-3 font-mono text-xs-mono tabular-nums whitespace-nowrap',
            isL1 ? 'text-[#B8934A] font-bold text-sm' : 'text-n-700',
            isL3 ? 'text-n-600 text-xs' : '',
          )}
          style={{ paddingLeft: `calc(0.75rem + ${indentPx}px)` }}
        >
          <div className="flex items-center gap-1.5">
            {hasChildren ? (
              <button
                type="button"
                onClick={() => onToggle(node.id)}
                aria-label={isOpen ? 'Colapsar' : 'Expandir'}
                className={cn(
                  'shrink-0 rounded p-0.5 text-n-500 transition-colors',
                  'hover:bg-gold-500/15 hover:text-n-1000',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
                )}
              >
                {isOpen ? (
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                )}
              </button>
            ) : (
              <span className="inline-block w-5 shrink-0" aria-hidden="true" />
            )}
            <span>{node.code}</span>
          </div>
        </td>

        {/* Name */}
        <td
          className={cn(
            'py-2.5 px-3 text-sm w-full',
            isL1 ? 'font-bold text-n-1000' : 'text-n-800',
            isL3 ? 'text-n-700 font-normal text-xs' : '',
          )}
        >
          {node.name}
        </td>

        {/* Balance */}
        <td
          className={cn(
            'py-2.5 pl-3 pr-4 text-right font-mono text-xs-mono tabular-nums whitespace-nowrap',
            isL1 ? 'font-bold text-n-1000' : 'text-n-700',
            isL3 ? 'text-n-600 text-xs' : '',
          )}
        >
          {formatCOP(node.balance)}
        </td>
      </tr>

      {/* Children */}
      {hasChildren && isOpen &&
        node.children.map((child) => (
          <PucRow
            key={child.id}
            node={child}
            expanded={expanded}
            onToggle={onToggle}
            matchedIds={matchedIds}
            ancestorIds={ancestorIds}
          />
        ))}
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ChartOfAccountsPage() {
  const [expanded, setExpanded] = useState<Set<string>>(
    // Start with level-1 nodes open
    () => new Set(PUC_DATA.map((n) => n.id)),
  );
  const [query, setQuery] = useState('');

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allNodes = useMemo(() => flattenNodes(PUC_DATA), []);

  const { matchedIds, ancestorIds } = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return { matchedIds: null, ancestorIds: new Set<string>() };
    const matches = new Set<string>();
    for (const n of allNodes) {
      if (n.code.toLowerCase().includes(q) || n.name.toLowerCase().includes(q)) {
        matches.add(n.id);
      }
    }
    return { matchedIds: matches, ancestorIds: collectAncestorIds(PUC_DATA, matches) };
  }, [query, allNodes]);

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8 md:py-10">

      {/* Back link */}
      <Link
        href="/workspace/contabilidad"
        className={cn(
          'inline-flex items-center gap-1.5 mb-6',
          'text-xs font-mono uppercase tracking-widest text-n-700',
          'hover:text-n-1000 transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B8934A] rounded',
        )}
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Contabilidad
      </Link>

      {/* Heading */}
      <header className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <BookOpen className="h-4 w-4 text-[#B8934A]" aria-hidden="true" />
          <p className="font-mono text-xs uppercase tracking-widest text-[#B8934A] font-semibold">
            Plan Único de Cuentas · Decreto 2650
          </p>
        </div>
        <h1 className="font-serif text-3xl font-bold text-n-1000 tracking-tight">
          Plan de Cuentas — PUC Colombia
        </h1>
        <p className="mt-1.5 text-sm text-n-700 max-w-2xl">
          Árbol del Plan Único de Cuentas colombiano con los saldos del período actual.
          Expande o colapsa cada clase para navegar la jerarquía.
        </p>
      </header>

      {/* Toolbar: search + action */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-n-500 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por código o nombre…"
            aria-label="Buscar cuenta en el PUC"
            className={cn(
              'w-full h-10 pl-9 pr-3 rounded-lg border bg-n-0',
              'border-n-200 text-sm text-n-1000 placeholder:text-n-500',
              'focus:outline-none focus:border-[#B8934A]/60',
              'focus-visible:ring-2 focus-visible:ring-[#B8934A]/40',
              'transition-colors',
            )}
          />
        </div>

        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1.5 h-10 px-4 rounded-lg',
            'bg-[#B8934A] text-white text-sm font-semibold',
            'hover:bg-[#a07a38] transition-colors',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B8934A]',
            'focus-visible:ring-offset-2 focus-visible:ring-offset-n-0',
            'whitespace-nowrap',
          )}
          aria-label="Crear nueva cuenta contable"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Nueva cuenta
        </button>
      </div>

      {/* PUC tree table */}
      <div className="rounded-xl border border-n-200 overflow-hidden bg-n-0">
        <table className="w-full border-collapse text-sm" role="treegrid" aria-label="Plan Único de Cuentas">
          {/* Column headers */}
          <thead>
            <tr className="border-b border-n-200 bg-n-50">
              <th
                scope="col"
                className="py-2.5 pl-3 pr-3 text-left text-xs font-semibold uppercase tracking-widest text-n-500 font-mono whitespace-nowrap w-40"
              >
                Código
              </th>
              <th
                scope="col"
                className="py-2.5 px-3 text-left text-xs font-semibold uppercase tracking-widest text-n-500"
              >
                Nombre de la cuenta
              </th>
              <th
                scope="col"
                className="py-2.5 pl-3 pr-4 text-right text-xs font-semibold uppercase tracking-widest text-n-500 font-mono whitespace-nowrap w-44"
              >
                Saldo período
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-n-100">
            {PUC_DATA.map((node) => (
              <PucRow
                key={node.id}
                node={node}
                expanded={expanded}
                onToggle={toggle}
                matchedIds={matchedIds}
                ancestorIds={ancestorIds}
              />
            ))}
          </tbody>
        </table>

        {/* Empty search state */}
        {matchedIds !== null && matchedIds.size === 0 && (
          <div className="py-12 text-center text-sm text-n-500">
            No se encontraron cuentas para{' '}
            <span className="font-mono text-n-700">&quot;{query}&quot;</span>.
          </div>
        )}
      </div>

      {/* Footer note */}
      <p className="mt-3 text-xs text-n-500 text-right">
        Saldos de demostración — Decreto 2650 · PUC Colombia
      </p>
    </div>
  );
}
