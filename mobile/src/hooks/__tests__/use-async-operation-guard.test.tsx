import { act, renderHook } from '@testing-library/react-native';

import { useAsyncOperationGuard } from '../use-async-operation-guard';

it('clears a pending retry on blur and ignores its stale completion after refocus', () => {
  const { result } = renderHook(() => useAsyncOperationGuard());
  let staleOperation = 0;

  act(() => { staleOperation = result.current.begin(true); });
  expect(result.current.pending).toBe(true);

  act(() => { result.current.invalidate(); });
  expect(result.current.pending).toBe(false);

  expect(result.current.finish(staleOperation)).toBe(false);
  expect(result.current.pending).toBe(false);

  let currentOperation = 0;
  act(() => { currentOperation = result.current.begin(true); });
  expect(result.current.pending).toBe(true);

  act(() => { expect(result.current.finish(currentOperation)).toBe(true); });
  expect(result.current.pending).toBe(false);
});
