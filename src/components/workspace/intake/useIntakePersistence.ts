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

  const setValues = useCallback(
    (updater: T | ((prev: T) => T)) => {
      setValuesInternal((prev) => {
        const next = typeof updater === 'function' ? (updater as (p: T) => T)(prev) : updater;

        // Debounced save to workspace context
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          setIntakeDraft(caseType, next as Partial<IntakeFormUnion>);
        }, 500);

        return next;
      });
    },
    [caseType, setIntakeDraft],
  );

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return [values, setValues];
}
