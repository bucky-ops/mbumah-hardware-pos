'use client';

/**
 * useDebounce — debounce a rapidly-changing value.
 *
 * Returns a debounced copy of `value` that only updates after `delay` ms have
 * elapsed without changes. Useful for search inputs where you don't want to
 * trigger a network request on every keystroke.
 */

import { useEffect, useState } from 'react';

export function useDebounce<T>(value: T, delay: number = 300): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handle);
  }, [value, delay]);

  return debounced;
}

export default useDebounce;
