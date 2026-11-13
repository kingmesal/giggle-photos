/**
 * Custom dropdown (a native <select> misbehaves in the webview). The menu is portaled to <body> with
 * fixed positioning so section cards cannot clip it.
 *
 * Closing without document listeners: while open, a transparent full-screen backdrop sits under the
 * menu; a press or wheel on it closes the menu (which also covers "another dropdown was clicked").
 * The menu takes focus when it appears, so Escape closes it.
 */
import { ChevronDown } from "lucide-react";
import { type ReactNode, useState } from "react";
import { createPortal } from "react-dom";

export interface SelectOption {
  value: string;
  label: string;
}

interface MenuPosition {
  top: number;
  left: number;
  minWidth: number;
}

export function SelectDropdown({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  options: SelectOption[];
  /** Accessible name for the trigger. */
  label?: string;
}): ReactNode {
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const close = () => setPosition(null);
  const currentLabel = options.find((o) => o.value === value)?.label ?? value;

  return (
    <>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={position !== null}
        aria-label={label}
        className="px-3 py-2 rounded-lg bg-surface-inset border border-zinc-300 dark:border-zinc-600 text-sm text-fg-2 focus:outline-none focus:border-blue-500 min-w-[160px] text-left flex items-center justify-between gap-2"
        onClick={(e) => {
          if (position) return close();
          const rect = e.currentTarget.getBoundingClientRect();
          setPosition({ top: rect.bottom + 2, left: rect.left, minWidth: rect.width });
        }}
      >
        <span className="truncate">{currentLabel}</span>
        <ChevronDown size={12} className="text-fg-muted" />
      </button>
      {position &&
        createPortal(
          <>
            <div
              aria-hidden="true"
              data-testid="dropdown-backdrop"
              className="fixed inset-0 z-[9998]"
              onMouseDown={close}
              onWheel={close}
            />
            <div
              role="listbox"
              tabIndex={-1}
              ref={(el) => el?.focus({ preventScroll: true })}
              className="fixed z-[9999] bg-surface-card border border-edge rounded-lg shadow-xl py-1 max-h-48 overflow-y-auto focus:outline-none"
              style={{ top: position.top, left: position.left, minWidth: position.minWidth }}
              onKeyDown={(e) => {
                if (e.key === "Escape") close();
              }}
            >
              {options.map((opt) => (
                <div
                  key={opt.value}
                  role="option"
                  aria-selected={opt.value === value}
                  tabIndex={-1}
                  className={
                    opt.value === value
                      ? "px-3 py-1.5 text-sm cursor-pointer text-accent-blue bg-blue-500/10 font-medium"
                      : "px-3 py-1.5 text-sm cursor-pointer text-fg-2 hover:bg-surface-active"
                  }
                  onClick={() => {
                    close();
                    onChange(opt.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      close();
                      onChange(opt.value);
                    }
                  }}
                >
                  {opt.label}
                </div>
              ))}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
