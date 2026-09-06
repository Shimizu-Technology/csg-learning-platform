import { useCallback, useRef, useState } from 'react';

export function useAsyncOperationGuard() {
  const generation = useRef(0);
  const [pending, setPending] = useState(false);

  const begin = useCallback((showPending = false) => {
    const next = ++generation.current;
    if (showPending) setPending(true);
    return next;
  }, []);

  const finish = useCallback((operation: number) => {
    if (generation.current !== operation) return false;
    setPending(false);
    return true;
  }, []);

  const invalidate = useCallback(() => {
    generation.current += 1;
    setPending(false);
  }, []);

  return { pending, begin, finish, invalidate };
}
