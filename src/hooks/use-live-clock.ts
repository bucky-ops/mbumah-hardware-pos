'use client';

import { useState, useEffect } from 'react';

/** Returns a Date that updates every second, for live clock displays. */
export function useLiveClock() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return now;
}
