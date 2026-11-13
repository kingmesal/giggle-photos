/**
 * useRead — load data for a screen and keep only the answer to the question still being asked.
 *
 * External system: an AbortController per request. `key` names the request; a new key (or `refresh`)
 * supersedes the read in flight, which is aborted, and its late answer is dropped. The read receives
 * the AbortSignal. Excluded from the effect gate in biome.jsonc for that reason.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface ReadState<T> {
  /** Last answer; kept while a newer read is in flight and after a failure. */
  value: T | undefined;
  /** A read for the current key (or refresh) has not answered yet. */
  loading: boolean;
  /** Why the current key's read failed, or null. */
  failure: Error | null;
  /** Read again with the same key. */
  refresh: () => void;
}

const asError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));

export function useRead<T>(
  key: string,
  read: (signal: AbortSignal) => Promise<T>,
  options: { skip?: boolean } = {},
): ReadState<T> {
  const skip = options.skip ?? false;
  const latestRead = useRef(read);
  latestRead.current = read;
  const [round, setRound] = useState(0);
  const request = `${round}\u0000${key}`;
  const [state, setState] = useState<{ request: string | null; value: T | undefined; failure: Error | null }>({
    request: null,
    value: undefined,
    failure: null,
  });

  useEffect(() => {
    if (skip) return;
    const controller = new AbortController();
    latestRead.current(controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setState({ request, value, failure: null });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState((prev) => ({ request, value: prev.value, failure: asError(error) }));
      },
    );
    return () => controller.abort();
  }, [request, skip]);

  const refresh = useCallback(() => setRound((r) => r + 1), []);
  const answered = state.request === request;
  return { value: state.value, loading: !skip && !answered, failure: answered ? state.failure : null, refresh };
}
