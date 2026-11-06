import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useInitialPageLoading, withMinimumPageLoading } from '../lib/pageLoading';

afterEach(() => vi.useRealTimers());

it('keeps a fast initial load visible for one animation cycle', () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook(({ pending }) => useInitialPageLoading(pending), { initialProps: { pending: true } });
  rerender({ pending: false });
  act(() => vi.advanceTimersByTime(1299));
  expect(result.current).toBe(true);
  act(() => vi.advanceTimersByTime(1));
  expect(result.current).toBe(false);
});

it('waits for real loading without adding another delay afterward', () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook(({ pending }) => useInitialPageLoading(pending), { initialProps: { pending: true } });
  act(() => vi.advanceTimersByTime(4000));
  expect(result.current).toBe(true);
  rerender({ pending: false });
  expect(result.current).toBe(false);
});

it('does not delay already available pages', () => {
  expect(renderHook(() => useInitialPageLoading(false)).result.current).toBe(false);
});

it('cleans up the display timer on unmount', () => {
  vi.useFakeTimers();
  const { unmount } = renderHook(() => useInitialPageLoading(true));
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it('keeps fast route imports pending for the minimum duration', async () => {
  vi.useFakeTimers();
  let finished = false;
  const promise = withMinimumPageLoading(Promise.resolve('ready')).then(value => { finished = true; return value; });
  await vi.advanceTimersByTimeAsync(1299);
  expect(finished).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(await promise).toBe('ready');
});

it('releases a slow route immediately when it becomes ready', async () => {
  vi.useFakeTimers();
  let ready!: (value: string) => void;
  const promise = withMinimumPageLoading(new Promise<string>(resolve => { ready = resolve; }));
  await vi.advanceTimersByTimeAsync(4000);
  ready('ready');
  expect(await promise).toBe('ready');
});
