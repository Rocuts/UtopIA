'use client';

// ---------------------------------------------------------------------------
// BankAccountForm — create / edit a bank_account row.
//
// Requires:
//   - accountId: UUID from chart_of_accounts (e.g. cuenta 1110 Bancolombia).
//   - bankName, accountNumber, accountKind, holderName (optional).
//
// On submit calls onSave(data) — the parent decides whether to POST or PATCH.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { cn } from '@/lib/utils';

export interface BankAccountFormData {
  accountId: string;
  bankName: string;
  accountNumber: string;
  accountKind: 'savings' | 'checking' | 'fiduciary' | 'other';
  holderName?: string;
  currency: string;
}

interface Props {
  initial?: Partial<BankAccountFormData>;
  onSave: (data: BankAccountFormData) => Promise<void>;
  onCancel: () => void;
  loading?: boolean;
}

const BANKS_CO = [
  'Bancolombia',
  'Banco de Bogotá',
  'Davivienda',
  'BBVA Colombia',
  'Banco Popular',
  'Banco Caja Social',
  'Banco AV Villas',
  'Bancoomeva',
  'Nequi',
  'Daviplata',
  'Otro',
];

const KIND_LABELS: Record<string, string> = {
  savings: 'Ahorros',
  checking: 'Corriente',
  fiduciary: 'Fiduciaria',
  other: 'Otro',
};

export function BankAccountForm({ initial, onSave, onCancel, loading }: Props) {
  const { language } = useLanguage();
  const es = language !== 'en';

  const [accountId, setAccountId] = useState(initial?.accountId ?? '');
  const [bankName, setBankName] = useState(initial?.bankName ?? '');
  const [accountNumber, setAccountNumber] = useState(initial?.accountNumber ?? '');
  const [accountKind, setAccountKind] = useState<BankAccountFormData['accountKind']>(
    initial?.accountKind ?? 'savings',
  );
  const [holderName, setHolderName] = useState(initial?.holderName ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!accountId.trim()) {
      setError(es ? 'La cuenta PUC es requerida.' : 'PUC account is required.');
      return;
    }
    if (!bankName.trim()) {
      setError(es ? 'El nombre del banco es requerido.' : 'Bank name is required.');
      return;
    }
    if (!accountNumber.trim()) {
      setError(es ? 'El número de cuenta es requerido.' : 'Account number is required.');
      return;
    }

    setSaving(true);
    try {
      await onSave({
        accountId: accountId.trim(),
        bankName: bankName.trim(),
        accountNumber: accountNumber.trim(),
        accountKind,
        holderName: holderName.trim() || undefined,
        currency: 'COP',
      });
    } catch (err) {
      setError((err as Error).message ?? (es ? 'Error al guardar.' : 'Save error.'));
    } finally {
      setSaving(false);
    }
  }

  const fieldClass =
    'w-full rounded-lg border border-n-200 bg-n-50 px-3 py-2 text-sm text-n-900 placeholder:text-n-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 dark:border-n-700 dark:bg-n-800 dark:text-n-100';
  const labelClass = 'block text-xs font-medium text-n-600 dark:text-n-300 mb-1';

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* PUC Account ID */}
      <div>
        <label className={labelClass}>
          {es ? 'Cuenta PUC (ID)' : 'PUC Account (ID)'}
          <span className="text-danger ml-1">*</span>
        </label>
        <input
          type="text"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          placeholder={es ? 'UUID de chart_of_accounts' : 'chart_of_accounts UUID'}
          className={fieldClass}
          required
        />
        <p className="mt-1 text-xs text-n-400">
          {es
            ? 'Usa el autocomplete del PUC para buscar la cuenta 1110 / 1120 correspondiente.'
            : 'Use the PUC autocomplete to find the corresponding 1110/1120 account.'}
        </p>
      </div>

      {/* Bank name */}
      <div>
        <label className={labelClass}>
          {es ? 'Banco' : 'Bank'}
          <span className="text-danger ml-1">*</span>
        </label>
        <input
          type="text"
          list="banks-co"
          value={bankName}
          onChange={(e) => setBankName(e.target.value)}
          placeholder="Bancolombia"
          className={fieldClass}
          required
        />
        <datalist id="banks-co">
          {BANKS_CO.map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
      </div>

      {/* Account number + kind */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>
            {es ? 'Número de cuenta' : 'Account number'}
            <span className="text-danger ml-1">*</span>
          </label>
          <input
            type="text"
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            placeholder="123-456789-00"
            className={fieldClass}
            required
          />
        </div>
        <div>
          <label className={labelClass}>{es ? 'Tipo' : 'Kind'}</label>
          <select
            value={accountKind}
            onChange={(e) =>
              setAccountKind(e.target.value as BankAccountFormData['accountKind'])
            }
            className={fieldClass}
          >
            {Object.entries(KIND_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Holder name (optional) */}
      <div>
        <label className={labelClass}>{es ? 'Titular (opcional)' : 'Holder (optional)'}</label>
        <input
          type="text"
          value={holderName}
          onChange={(e) => setHolderName(e.target.value)}
          placeholder={es ? 'Nombre del titular' : 'Account holder name'}
          className={fieldClass}
        />
      </div>

      {error && (
        <p className="rounded-md bg-danger/10 px-3 py-2 text-xs text-danger border border-danger/20">
          {error}
        </p>
      )}

      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          disabled={saving || loading}
          className={cn(
            'flex-1 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white',
            'hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors',
          )}
        >
          {saving ? (es ? 'Guardando…' : 'Saving…') : es ? 'Guardar cuenta' : 'Save account'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-n-200 px-4 py-2 text-sm text-n-600 hover:bg-n-100 transition-colors dark:border-n-700 dark:text-n-400 dark:hover:bg-n-800"
        >
          {es ? 'Cancelar' : 'Cancel'}
        </button>
      </div>
    </form>
  );
}
