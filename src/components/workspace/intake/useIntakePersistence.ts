'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useWorkspace } from '@/context/WorkspaceContext';
import type { CaseType, IntakeFormUnion } from '@/types/platform';

export function useIntakePersistence<T extends Partial<IntakeFormUnion>>(
  caseType: CaseType,
  initialValues: T,
): [T, (updater: T | ((prev: T) => T)) => void] {
  const { intakeDrafts, setIntakeDraft } = useWorkspace();

  const draft = intakeDrafts[caseType] as T | undefined;
  const [values, setValuesInternal] = useState<T>(draft ?? initialValues);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Why: the latest typed value lives only in local state until the 500ms
  // debounce fires. If the modal unmounts inside that window (Escape, route
  // change, accidental close), the cleanup below must flush it to context so
  // the user does not lose 500ms of work on remount.
  const pendingRef = useRef<T | null>(null);
  const setIntakeDraftRef = useRef(setIntakeDraft);
  useEffect(() => {
    setIntakeDraftRef.current = setIntakeDraft;
  }, [setIntakeDraft]);

  const setValues = useCallback(
    (updater: T | ((prev: T) => T)) => {
      setValuesInternal((prev) => {
        const next = typeof updater === 'function' ? (updater as (p: T) => T)(prev) : updater;

        // Debounced save to workspace context
        if (debounceRef.current) clearTimeout(debounceRef.current);
        pendingRef.current = next;
        debounceRef.current = setTimeout(() => {
          pendingRef.current = null;
          setIntakeDraft(caseType, next as Partial<IntakeFormUnion>);
        }, 500);

        return next;
      });
    },
    [caseType, setIntakeDraft],
  );

  // Flush any pending debounced value on unmount so in-flight typing survives.
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      const pending = pendingRef.current;
      if (pending !== null) {
        pendingRef.current = null;
        setIntakeDraftRef.current(caseType, pending as Partial<IntakeFormUnion>);
      }
    };
  }, [caseType]);

  return [values, setValues];
}
