'use client';

/**
 * ChartOfAccountsTree — expandable PUC explorer.
 *
 * The Colombian PUC has 5 levels (1, 11, 1105, 110505, 11050501). We render
 * each as a row indented by `level * 16px`, with chevrons collapsing /
 * expanding the children. When the tree is empty (workspace just created),
 * we surface a single "Initialize PUC" CTA that POSTs to
 * `/api/accounting/accounts/seed`.
 *
 * Search is local — once the tree is loaded, filtering doesn't need a
 * round-trip. Match is case-insensitive against either `code` or `name`,
 * and we expand all ancestors of any match so the matched node is visible.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Loader2,
  Search,
  Sparkles,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────────

export type AccountType =
  | 'asset'
  | 'liability'
  | 'equity'
  | 'revenue'
  | 'expense'
  | 'contra';

interface AccountNode {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  parentId: string | null;
  level: number;
  isPostable: boolean;
  active: boolean;
  children: AccountNode[];
}

interface FlatAccount {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  parentId: string | null;
  level: number;
  isPostable: boolean;
  active: boolean;
}

const TYPE_BADGE: Record<AccountType, string> = {
  asset: 'bg-success/10 text-success border-success/30',
  liability: 'bg-danger/10 text-danger border-danger/30',
  equity: 'bg-gold-500/10 text-gold-600 border-gold-500/30',
  revenue: 'bg-success/10 text-success border-success/30',
  expense: 'bg-warning/10 text-warning border-warning/30',
  contra: 'bg-n-100 text-n-700 border-n-300',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildTree(flat: FlatAccount[]): AccountNode[] {
  const byId = new Map<string, AccountNode>();
  for (const a of flat) {
    byId.set(a.id, { ...a, children: [] });
  }
  const roots: AccountNode[] = [];
  // Stable sort by code so siblings appear in PUC numeric order.
  const sorted = [...flat].sort((a, b) => a.code.localeCompare(b.code, 'es'));
  for (const a of sorted) {
    const node = byId.get(a.id)!;
    if (a.parentId && byId.has(a.parentId)) {
      byId.get(a.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function collectAncestors(
  flat: FlatAccount[],
  matchedIds: Set<string>,
): Set<string> {
  const byId = new Map(flat.map((a) => [a.id, a] as const));
  const out = new Set<string>();
  for (const id of matchedIds) {
    let cur = byId.get(id);
    while (cur && cur.parentId) {
      out.add(cur.parentId);
      cur = byId.get(cur.parentId);
    }
  }
  return out;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ChartOfAccountsTree() {
  const { t, language } = useLanguage();
  const ac = t.accounting;

  const [accounts, setAccounts] = useState<FlatAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [seedMsg, setSeedMsg] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/accounting/accounts');
      if (!res.ok) throw new Error('load_failed');
      const json = (await res.json()) as
        | { ok: true; accounts: FlatAccount[] }
        | { ok: false }
        | FlatAccount[];
      const list: FlatAccount[] = Array.isArray(json)
        ? json
        : 'accounts' in json && Array.isArray(json.accounts)
          ? json.accounts
          : [];
      setAccounts(list);
      // Auto-expand the top level so users see something even on first load.
      const topLevel = list
        .filter((a) => a.level <= 1)
        .map((a) => a.id);
      setExpanded(new Set(topLevel));
    } catch {
      setError(ac.errorGeneric);
    } finally {
      setLoading(false);
    }
  }, [ac.errorGeneric]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  const tree = useMemo(() => buildTree(accounts), [accounts]);

  // Filter logic: when there is a query, expand every ancestor of every match.
  const { matchedIds, ancestorIds } = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return { matchedIds: null, ancestorIds: new Set<string>() };
    const matches = new Set<string>();
    for (const a of accounts) {
      if (
        a.code.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q)
      ) {
        matches.add(a.id);
      }
    }
    return {
      matchedIds: matches,
      ancestorIds: collectAncestors(accounts, matches),
    };
  }, [query, accounts]);

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSeed = useCallback(async () => {
    setSeeding(true);
    setSeedMsg(null);
    try {
      const res = await fetch('/api/accounting/accounts/seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error('seed_failed');
      setSeedMsg(ac.seedPucDone);
      await loadAccounts();
    } catch {
      setSeedMsg(ac.seedPucError);
    } finally {
      setSeeding(false);
    }
  }, [ac.seedPucDone, ac.seedPucError, loadAccounts]);

  if (loading) {
    return (
      <div
        role="status"
        aria-busy="true"
        className="flex items-center gap-2 px-4 py-12 text-n-500 justify-center"
      >
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        <span className="text-sm">{ac.loading}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className={cn(
          'rounded-md border border-danger/30 bg-danger/8 px-3 py-2',
          'text-sm text-danger flex items-center gap-2',
        )}
      >
        <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{error}</span>
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div
        className={cn(
          'rounded-xl border border-dashed border-gold-500/30 bg-n-0',
          'p-10 text-center flex flex-col items-center gap-4',
        )}
      >
        <span
          aria-hidden="true"
          className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-gold-500/10 text-gold-600"
        >
          <Sparkles className="h-6 w-6" />
        </span>
        <div>
          <h3 className="text-lg font-serif-elite text-n-1000 mb-1">
            {ac.seedPuc}
          </h3>
          <p className="text-sm text-n-700 max-w-md mx-auto">{ac.seedPucDesc}</p>
        </div>
        <button
          type="button"
          onClick={handleSeed}
          disabled={seeding}
          className={cn(
            'inline-flex items-center gap-2 px-4 py-2 rounded-md',
            'bg-gold-500 text-n-0 hover:bg-gold-600 transition-colors',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
            'focus-visible:ring-offset-2 focus-visible:ring-offset-n-0',
            'disabled:opacity-40 disabled:cursor-not-allowed',
            'text-sm font-semibold',
          )}
        >
          {seeding ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {ac.seedPuc}
        </button>
        {seedMsg && (
          <p
            className={cn(
              'text-xs',
              seedMsg === ac.seedPucDone ? 'text-success' : 'text-danger',
            )}
            role="status"
          >
            {seedMsg}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Search */}
      <div className="relative max-w-sm">
        <Search
          className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-n-500"
          aria-hidden="true"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            language === 'es'
              ? 'Buscar por código o nombre…'
              : 'Search by code or name…'
          }
          aria-label={
            language === 'es' ? 'Buscar cuenta' : 'Search account'
          }
          className={cn(
            'w-full pl-8 pr-3 h-9 rounded-md border bg-n-0',
            'border-gold-500/25 focus:border-gold-500/60 outline-none',
            'text-sm text-n-1000 placeholder:text-n-500',
            'focus-visible:ring-2 focus-visible:ring-gold-500',
          )}
        />
      </div>

      {/* Tree */}
      <div
        role="tree"
        aria-label={ac.chartOfAccounts}
        className={cn(
          'rounded-xl border border-gold-500/20 bg-n-0 overflow-hidden',
        )}
      >
        <ul role="group" className="divide-y divide-gold-500/10">
          {tree.map((node) => (
            <TreeRow
              key={node.id}
              node={node}
              expanded={expanded}
              onToggle={toggle}
              matchedIds={matchedIds}
              ancestorIds={ancestorIds}
              language={language}
              labels={{
                auxiliary: ac.auxiliary,
                heading: ac.heading,
                level: ac.level,
              }}
            />
          ))}
        </ul>
      </div>

      {seedMsg && (
        <p
          className={cn(
            'text-xs',
            seedMsg === ac.seedPucDone ? 'text-success' : 'text-danger',
          )}
          role="status"
        >
          {seedMsg}
        </p>
      )}
    </div>
  );
}

// ─── Tree row ────────────────────────────────────────────────────────────────

interface TreeRowProps {
  node: AccountNode;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  matchedIds: Set<string> | null;
  ancestorIds: Set<string>;
  language: 'es' | 'en';
  labels: {
    auxiliary: string;
    heading: string;
    level: string;
  };
}

function TreeRow({
  node,
  expanded,
  onToggle,
  matchedIds,
  ancestorIds,
  language,
  labels,
}: TreeRowProps) {
  // While searching, hide nodes that are neither matches nor ancestors of one.
  const filtering = matchedIds !== null;
  const isMatch = filtering ? matchedIds.has(node.id) : true;
  const isAncestor = filtering ? ancestorIds.has(node.id) : false;
  if (filtering && !isMatch && !isAncestor) return null;

  const hasChildren = node.children.length > 0;
  const isOpen = filtering ? true : expanded.has(node.id);
  const indentPx = (node.level - 1) * 16;

  return (
    <li
      role="treeitem"
      aria-expanded={hasChildren ? isOpen : undefined}
      aria-selected={isMatch && filtering ? true : false}
    >
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-2 transition-colors',
          'even:bg-n-50 hover:bg-gold-500/8',
          isMatch && filtering ? 'bg-gold-500/10' : '',
        )}
        style={{ paddingLeft: `calc(0.75rem + ${indentPx}px)` }}
      >
        <button
          type="button"
          onClick={() => hasChildren && onToggle(node.id)}
          disabled={!hasChildren}
          className={cn(
            'p-0.5 rounded text-n-500 shrink-0',
            hasChildren
              ? 'hover:bg-gold-500/10 hover:text-n-1000 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500'
              : 'opacity-40 cursor-default',
          )}
          aria-label={
            hasChildren
              ? language === 'es'
                ? isOpen
                  ? 'Colapsar'
                  : 'Expandir'
                : isOpen
                  ? 'Collapse'
                  : 'Expand'
              : undefined
          }
          tabIndex={hasChildren ? 0 : -1}
        >
          {hasChildren ? (
            isOpen ? (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            )
          ) : (
            <span aria-hidden="true" className="inline-block w-3.5 h-3.5" />
          )}
        </button>

        <span className="font-mono text-xs-mono tabular-nums text-n-1000 shrink-0 w-24">
          {node.code}
        </span>

        <span className="flex-1 min-w-0 text-sm text-n-700 truncate">
          {node.name}
        </span>

        <span
          className={cn(
            'shrink-0 text-[10px] font-mono uppercase tracking-eyebrow',
            'rounded border px-1.5 py-0.5',
            TYPE_BADGE[node.type] ?? 'bg-n-100 text-n-700 border-n-300',
          )}
        >
          {node.type}
        </span>

        {node.isPostable ? (
          <span
            className={cn(
              'shrink-0 text-[10px] font-mono uppercase tracking-eyebrow',
              'rounded border px-1.5 py-0.5',
              'bg-gold-500/10 text-gold-600 border-gold-500/30',
            )}
          >
            {labels.auxiliary}
          </span>
        ) : null}
      </div>

      {hasChildren && isOpen && (
        <ul role="group" className="divide-y divide-gold-500/10">
          {node.children.map((child) => (
            <TreeRow
              key={child.id}
              node={child}
              expanded={expanded}
              onToggle={onToggle}
              matchedIds={matchedIds}
              ancestorIds={ancestorIds}
              language={language}
              labels={labels}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export default ChartOfAccountsTree;
