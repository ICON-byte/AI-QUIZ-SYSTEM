import { useEffect, useState } from 'react';

const MINIMUM_PAGE_LOADING_MS = 1300;

// Only hold an initial pending page; cached navigation needs no artificial delay.
export function useInitialPageLoading(pending: boolean) {
  const [minimumElapsed, setMinimumElapsed] = useState(!pending);
  useEffect(() => {
    if (minimumElapsed) return;
    const timer = window.setTimeout(() => setMinimumElapsed(true), MINIMUM_PAGE_LOADING_MS);
    return () => window.clearTimeout(timer);
  }, [minimumElapsed]);
  return pending || !minimumElapsed;
}

export function withMinimumPageLoading<T>(work: Promise<T>) {
  return Promise.all([
    work,
    new Promise<void>(resolve => window.setTimeout(resolve, MINIMUM_PAGE_LOADING_MS)),
  ]).then(([result]) => result);
}
