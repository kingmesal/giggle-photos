/**
 * useInterval — call `callback` every `ms` milliseconds while `ms` is not null (polling).
 *
 * External system: a browser timer (setInterval). Excluded from the effect gate in biome.jsonc.
 */
import { useEffect, useRef } from "react";

export function useInterval(callback: () => void, ms: number | null): void {
  const latest = useRef(callback);
  latest.current = callback;
  useEffect(() => {
    if (ms === null) return;
    const id = setInterval(() => latest.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}
