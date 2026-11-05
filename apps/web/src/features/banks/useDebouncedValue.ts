import { useEffect, useState } from 'react';

// Keep text input immediate while batching requests during ordinary typing.
export function useDebouncedValue<T>(value: T) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), 300);
    return () => window.clearTimeout(timer);
  }, [value]);
  return settled;
}
