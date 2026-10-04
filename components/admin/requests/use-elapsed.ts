"use client";

import React from "react";

/**
 * Milliseconds elapsed since this page's data was rendered, ticking every `intervalMs`. Added to the SERVER's `server_time` it gives
 * "now" on the server's clock without ever trusting the operator's own clock (a skewed laptop must not make a request look expired).
 * Starts at 0 on the server and on the first client render, so there is no hydration mismatch; the first tick happens after mount.
 * `resetKey` restarts the count when new data arrives (a refresh re-renders the page with a newer `server_time`).
 */
export function useElapsed(resetKey: string, intervalMs = 1000): number {
  const [state, setState] = React.useState({ key: resetKey, elapsed: 0 });
  const startedAt = React.useRef<number | null>(null);

  React.useEffect(() => {
    const started = performance.now();
    startedAt.current = started;
    const timer = window.setInterval(() => setState({ key: resetKey, elapsed: performance.now() - started }), intervalMs);
    return () => window.clearInterval(timer);
  }, [resetKey, intervalMs]);

  // Data from before the reset is never mixed with the new server time.
  return state.key === resetKey ? state.elapsed : 0;
}
