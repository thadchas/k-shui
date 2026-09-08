import { useEffect, useState } from 'react';

/** Keep expiry and observation age truthful even while the operator is idle. */
export function useAgentClock() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
