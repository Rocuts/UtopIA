'use client';

/**
 * /workspace/contabilidad/mayor — Libro Mayor (General Ledger).
 *
 * Self-contained client page.
 * Features:
 *   - Account selector (code + name) and period filter.
 *   - T-account display with running-balance column for account 1105 · Caja.
 *   - Summary footer: total débito / crédito / saldo.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, BookOpen, TrendingUp, TrendingDown, Scale } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCOP, formatPesos } from '@/lib/format/cop';

// ─── Static demo data ────────────────────────────────────────────────────────

interface LedgerEntry {
  id: string;
  date: string;        // DD/MM
  ref: string;
  description: string;
  debit: number;       // 0 if credit-only row
  credit: number;      // 0 if debit-only row
}

const ACCOUNTS = [
  { code: '1105', name: 'Caja' },
  { code: '1110', name: 'Bancos' },
  { code: '1305', name: 'Clientes' },
  { code: '2205', name: 'Proveedores nacionales' },
  { code: '4135', name: 'Comercio al por menor' },
];

const PERIODS = [
  { value: '2026-06', label: 'Junio 2026' },
  { value: '2026-05', label: 'Mayo 2026' },
  { value: '2026-04', label: 'Abril 2026' },
];

// Demo entries for 1105 · Caja  (period 2026-06)
const ENTRIES_1105: LedgerEntry[] = [
  { id: 'e1',  date: '01/06', ref: 'AS-001', description: 'Saldo inicial', debit: 1_500_000, credit: 0 },
  { id: 'e2',  date: '02/06', ref: 'AS-002', description: 'Cobro factura F-2210',     debit: 1_200_000, credit: 0 },
  { id: 'e3',  date: '04/06', ref: 'AS-003', description: 'Venta de mercancía',       debit: 2_800_000, credit: 0 },
  { id: 'e4',  date: '05/06', ref: 'AS-004', description: 'Recaudo cartera cliente',  debit: 1_700_000, credit: 0 },
  { id: 'e5',  date: '07/06', ref: 'AS-005', description: 'Ingreso misceláneos',      debit: 1_000_000, credit: 0 },
  { id: 'e6',  date: '03/06', ref: 'AS-006', description: 'Pago arriendo oficina',    debit: 0, credit: 2_100_000 },
  { id: 'e7',  date: '06/06', ref: 'AS-007', description: 'Pago proveedor insumos',   debit: 0, credit: 2_400_000 },
  { id: 'e8',  date: '08/06', ref: 'AS-008', description: 'Gastos de viaje',          debit: 0, credit: 1_300_000 },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function LibroMayorPage() {
  const [accountCode, setAccountCode] = useState<string>('1105');
  const [period, setPeriod]           = useState<string>('2026-06');

  const account = ACCOUNTS.find((a) => a.code === accountCode) ?? ACCOUNTS[0];

  // Sort: debits first (original order), then credits — to show T-shape clearly
  const sorted = useMemo((): LedgerEntry[] => {
    return [...ENTRIES_1105].sort((a, b) => {
      // chronological within each side
      return a.date.localeCompare(b.date);
    });
  }, []);

  // Running balance (debit positive convention)
  const rows = useMemo(() => {
    let running = 0;
    return sorted.map((e) => {
      running += e.debit - e.credit;
      return { ...e, balance: running };
    });
  }, [sorted]);

  const totalDebit  = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
  const saldoFinal  = totalDebit - totalCredit;

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-8 md:py-10">
      {/* Back link */}
      <Link
        href="/workspace/contabilidad"
        className="inline-flex items-center gap-1.5 text-xs-mono uppercase tracking-eyebrow text-n-700 hover:text-n-1000 mb-6 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 rounded"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Contabilidad
      </Link>

      {/* Page header */}
      <header className="mb-8 flex items-start gap-4">
        <div
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
          style={{ background: 'rgba(184,147,74,0.12)' }}
          aria-hidden="true"
        >
          <BookOpen className="h-6 w-6" style={{ color: '#B8934A' }} />
        </div>
        <div>
          <p
            className="font-mono text-xs-mono uppercase tracking-eyebrow font-medium"
            style={{ color: '#B8934A' }}
          >
            Contabilidad
          </p>
          <h1 className="mt-0.5 font-serif-elite text-3xl text-n-1000 tracking-tight">
            Libro Mayor
          </h1>
          <p className="mt-1.5 text-sm text-n-700 max-w-2xl">
            Movimientos y saldo acumulado de cada cuenta a lo largo del período.
          </p>
        </div>
      </header>

      {/* Filters */}
      <section
        aria-label="Filtros de libro mayor"
        className={cn(
          'mb-6 rounded-xl border bg-n-0 p-4',
          'grid grid-cols-1 sm:grid-cols-2 gap-4',
        )}
        style={{ borderColor: 'rgba(184,147,74,0.20)' }}
      >
        <div>
          <label
            htmlFor="mayor-account"
            className="block text-xs-mono uppercase tracking-eyebrow text-n-700 font-medium mb-1.5"
          >
            Cuenta
          </label>
          <select
            id="mayor-account"
            value={accountCode}
            onChange={(e) => setAccountCode(e.target.value)}
            className={cn(
              'w-full h-10 px-3 rounded-md border bg-n-0',
              'text-sm text-n-1000 outline-none',
              'focus-visible:ring-2 focus-visible:ring-gold-500',
            )}
            style={{ borderColor: 'rgba(184,147,74,0.30)' }}
          >
            {ACCOUNTS.map((a) => (
              <option key={a.code} value={a.code}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="mayor-period"
            className="block text-xs-mono uppercase tracking-eyebrow text-n-700 font-medium mb-1.5"
          >
            Período
          </label>
          <select
            id="mayor-period"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className={cn(
              'w-full h-10 px-3 rounded-md border bg-n-0',
              'text-sm text-n-1000 outline-none',
              'focus-visible:ring-2 focus-visible:ring-gold-500',
            )}
            style={{ borderColor: 'rgba(184,147,74,0.30)' }}
          >
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* T-Account section */}
      <section
        aria-label={`Movimientos cuenta ${account.code}`}
        className="rounded-xl border bg-n-0 overflow-hidden"
        style={{ borderColor: 'rgba(184,147,74,0.20)' }}
      >
        {/* Section header */}
        <div
          className="flex items-center justify-between px-5 py-3 border-b"
          style={{ borderColor: 'rgba(184,147,74,0.15)', background: 'rgba(184,147,74,0.05)' }}
        >
          <div>
            <span
              className="font-mono font-semibold text-sm"
              style={{ color: '#B8934A' }}
            >
              {account.code}
            </span>
            <span className="ml-2 text-sm font-semibold text-n-1000">
              {account.name}
            </span>
          </div>
          <span className="text-xs-mono uppercase tracking-eyebrow text-n-600 font-medium">
            {PERIODS.find((p) => p.value === period)?.label ?? period}
          </span>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm" aria-label={`Libro mayor ${account.code} ${account.name}`}>
            <thead
              className="border-b"
              style={{ borderColor: 'rgba(184,147,74,0.12)' }}
            >
              <tr className="bg-n-50">
                <th
                  scope="col"
                  className="px-4 py-2.5 text-left text-xs-mono uppercase tracking-eyebrow font-semibold text-n-600 w-16"
                >
                  Fecha
                </th>
                <th
                  scope="col"
                  className="px-4 py-2.5 text-left text-xs-mono uppercase tracking-eyebrow font-semibold text-n-600 w-24"
                >
                  Ref.
                </th>
                <th
                  scope="col"
                  className="px-4 py-2.5 text-left text-xs-mono uppercase tracking-eyebrow font-semibold text-n-600"
                >
                  Concepto
                </th>
                <th
                  scope="col"
                  className="px-4 py-2.5 text-right text-xs-mono uppercase tracking-eyebrow font-semibold text-n-600 w-36"
                  style={{ borderLeft: '2px solid rgba(184,147,74,0.25)' }}
                >
                  Débito
                </th>
                <th
                  scope="col"
                  className="px-4 py-2.5 text-right text-xs-mono uppercase tracking-eyebrow font-semibold text-n-600 w-36"
                  style={{ borderLeft: '1px solid rgba(184,147,74,0.15)' }}
                >
                  Crédito
                </th>
                <th
                  scope="col"
                  className="px-4 py-2.5 text-right text-xs-mono uppercase tracking-eyebrow font-semibold text-n-600 w-36"
                  style={{ borderLeft: '2px solid rgba(184,147,74,0.25)' }}
                >
                  Saldo
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={row.id}
                  className={cn(
                    'border-b last:border-b-0 transition-colors',
                    i % 2 === 1 ? 'bg-n-50' : 'bg-n-0',
                    'hover:bg-gold-500/5',
                  )}
                  style={{ borderColor: 'rgba(184,147,74,0.08)' }}
                >
                  <td className="px-4 py-2.5 font-mono text-xs tabular-nums text-n-1000 whitespace-nowrap font-semibold">
                    {row.date}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs tabular-nums text-n-700 whitespace-nowrap">
                    {row.ref}
                  </td>
                  <td className="px-4 py-2.5 text-n-800">
                    {row.description}
                  </td>
                  {/* DÉBITO column — T-account left side */}
                  <td
                    className={cn(
                      'px-4 py-2.5 text-right tabular-nums font-mono text-sm',
                      row.debit > 0 ? 'text-n-1000 font-medium' : 'text-n-400',
                    )}
                    style={{ borderLeft: '2px solid rgba(184,147,74,0.25)' }}
                  >
                    {row.debit > 0 ? formatPesos(row.debit) : '—'}
                  </td>
                  {/* CRÉDITO column — T-account right side */}
                  <td
                    className={cn(
                      'px-4 py-2.5 text-right tabular-nums font-mono text-sm',
                      row.credit > 0 ? 'text-n-1000 font-medium' : 'text-n-400',
                    )}
                    style={{ borderLeft: '1px solid rgba(184,147,74,0.15)' }}
                  >
                    {row.credit > 0 ? formatPesos(row.credit) : '—'}
                  </td>
                  {/* SALDO column — running balance */}
                  <td
                    className={cn(
                      'px-4 py-2.5 text-right tabular-nums font-mono text-sm font-semibold',
                      row.balance >= 0 ? 'text-emerald-600' : 'text-red-500',
                    )}
                    style={{ borderLeft: '2px solid rgba(184,147,74,0.25)' }}
                  >
                    {formatPesos(row.balance)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Summary footer */}
        <div
          className="border-t px-5 py-4 grid grid-cols-3 gap-4"
          style={{ borderColor: 'rgba(184,147,74,0.20)', background: 'rgba(184,147,74,0.04)' }}
        >
          {/* Total débito */}
          <div className="flex items-center gap-3">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
              style={{ background: 'rgba(16,185,129,0.10)' }}
              aria-hidden="true"
            >
              <TrendingUp className="h-4 w-4 text-emerald-600" />
            </div>
            <div>
              <p className="text-xs-mono uppercase tracking-eyebrow text-n-600 font-medium">
                Total Débito
              </p>
              <p className="mt-0.5 font-mono font-semibold text-n-1000 tabular-nums">
                {formatCOP(totalDebit)}
              </p>
            </div>
          </div>

          {/* Total crédito */}
          <div className="flex items-center gap-3">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
              style={{ background: 'rgba(239,68,68,0.10)' }}
              aria-hidden="true"
            >
              <TrendingDown className="h-4 w-4 text-red-500" />
            </div>
            <div>
              <p className="text-xs-mono uppercase tracking-eyebrow text-n-600 font-medium">
                Total Crédito
              </p>
              <p className="mt-0.5 font-mono font-semibold text-n-1000 tabular-nums">
                {formatCOP(totalCredit)}
              </p>
            </div>
          </div>

          {/* Saldo final */}
          <div className="flex items-center gap-3">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
              style={{ background: 'rgba(184,147,74,0.15)' }}
              aria-hidden="true"
            >
              <Scale className="h-4 w-4" style={{ color: '#B8934A' }} />
            </div>
            <div>
              <p className="text-xs-mono uppercase tracking-eyebrow text-n-600 font-medium">
                Saldo Final
              </p>
              <p
                className="mt-0.5 font-mono font-semibold tabular-nums"
                style={{ color: saldoFinal >= 0 ? '#059669' : '#ef4444' }}
              >
                {formatCOP(saldoFinal)}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Nota de cierre */}
      <div
        className="mt-4 rounded-lg border px-4 py-3 flex items-start gap-3"
        style={{ borderColor: 'rgba(184,147,74,0.20)', background: 'rgba(184,147,74,0.04)' }}
        role="note"
        aria-label="Nota de saldo"
      >
        <BookOpen
          className="h-4 w-4 shrink-0 mt-0.5"
          style={{ color: '#B8934A' }}
          aria-hidden="true"
        />
        <p className="text-sm text-n-700">
          La cuenta{' '}
          <span className="font-semibold text-n-1000">
            {account.code} · {account.name}
          </span>{' '}
          cierra{' '}
          {PERIODS.find((p) => p.value === period)?.label ?? period} con saldo{' '}
          <span
            className="font-mono font-semibold"
            style={{ color: '#B8934A' }}
          >
            {formatCOP(saldoFinal)}
          </span>{' '}
          tras {rows.filter((r) => r.debit > 0).length} movimientos al débito y{' '}
          {rows.filter((r) => r.credit > 0).length} al crédito.
        </p>
      </div>
    </div>
  );
}
