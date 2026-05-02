// ---------------------------------------------------------------------------
// Barrel — Server Actions del nucleo contable (Ola 1.F)
// ---------------------------------------------------------------------------
// Punto unico de import para Client Components que consumen las actions.
//
//   import {
//     createJournalEntryAction,
//     postJournalEntryAction,
//     reverseJournalEntryAction,
//     voidDraftEntryAction,
//     createPeriodAction,
//     closePeriodAction,
//     reopenPeriodAction,
//     lockPeriodAction,
//     createAccountAction,
//     updateAccountAction,
//     deactivateAccountAction,
//     seedPucAction,
//     importOpeningBalanceAction,
//   } from '@/lib/accounting/actions';
//
// Cada archivo re-exportado lleva su propio `'use server'` directive — el
// barrel mismo no necesita la directive (es solo re-exports).
// ---------------------------------------------------------------------------

export * from './journal-actions';
export * from './period-actions';
export * from './account-actions';
export * from './opening-balance-actions';
