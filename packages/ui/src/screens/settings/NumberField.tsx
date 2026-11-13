/**
 * Integer input clamped to [min, max]. Keeps its own text so a half-typed value ("", "1") does not
 * fight the draft; valid values commit as you type, and blur snaps the text back to the committed value.
 */
import { type ReactNode, useState } from "react";

export function clampInt(raw: string, min: number, max: number): number | null {
  if (!/^\s*\d+\s*$/.test(raw)) return null;
  return Math.min(max, Math.max(min, Number.parseInt(raw, 10)));
}

export function NumberField({
  value,
  onChange,
  min,
  max,
  label,
}: {
  value: number;
  onChange: (next: number) => void;
  min: number;
  max: number;
  label: string;
}): ReactNode {
  const [text, setText] = useState(String(value));
  return (
    <input
      type="number"
      inputMode="numeric"
      aria-label={label}
      min={min}
      max={max}
      step={1}
      value={text}
      className="w-24 px-3 py-2 rounded-lg bg-surface-inset border border-zinc-300 dark:border-zinc-600 text-sm text-fg-2 text-right focus:outline-none focus:border-blue-500"
      onChange={(e) => {
        setText(e.target.value);
        const next = clampInt(e.target.value, min, max);
        if (next !== null && next !== value) onChange(next);
      }}
      onBlur={() => {
        const next = clampInt(text, min, max) ?? value;
        setText(String(next));
        if (next !== value) onChange(next);
      }}
    />
  );
}
