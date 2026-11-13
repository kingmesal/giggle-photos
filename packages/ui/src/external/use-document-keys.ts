/**
 * useDocumentKeys — keyboard shortcuts on the whole document while `enabled` (review screens).
 *
 * External system: keydown listeners on `document`. Excluded from the effect gate in biome.jsonc.
 * Typing in an input, textarea or select is ignored.
 */
import { useEffect, useRef } from "react";

export function useDocumentKeys(onKey: (event: KeyboardEvent) => void, enabled = true): void {
  const latest = useRef(onKey);
  latest.current = onKey;
  useEffect(() => {
    if (!enabled) return;
    const listener = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      latest.current(event);
    };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [enabled]);
}
