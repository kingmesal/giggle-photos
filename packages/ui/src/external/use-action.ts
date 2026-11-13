/**
 * useAction — run a call a person triggers (save, delete, start) and track pending/failure.
 *
 * External system: the component's mounted lifetime. RPC calls cannot be cancelled, so the hook tracks
 * unmount and sets no state for answers that arrive afterwards. Excluded from the effect gate in
 * biome.jsonc for that reason.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface ActionState<A extends unknown[], T> {
  /** Run the action; resolves with its value, or undefined if it failed (see `failure`). */
  run: (...args: A) => Promise<T | undefined>;
  pending: boolean;
  failure: Error | null;
  /** Value of the last successful run. */
  value: T | undefined;
}

export function useAction<A extends unknown[], T>(action: (...args: A) => Promise<T>): ActionState<A, T> {
  const latest = useRef(action);
  latest.current = action;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [state, setState] = useState<{ pending: boolean; failure: Error | null; value: T | undefined }>({
    pending: false,
    failure: null,
    value: undefined,
  });

  const run = useCallback(async (...args: A) => {
    setState((s) => ({ ...s, pending: true, failure: null }));
    try {
      const value = await latest.current(...args);
      if (mounted.current) setState({ pending: false, failure: null, value });
      return value;
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      if (mounted.current) setState((s) => ({ ...s, pending: false, failure }));
      return undefined;
    }
  }, []);

  return { run, ...state };
}
