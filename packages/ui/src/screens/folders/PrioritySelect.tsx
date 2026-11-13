/**
 * Priority dropdown: a custom button menu, not a native <select>, because Electrobun's CEF webview makes
 * native <select> non-interactive after RPC calls. The menu is portalled to document.body (so the list's
 * overflow does not clip it), positioned under the trigger, and closes on any click outside.
 */
import { Check, ChevronDown } from "lucide-react";
import { type ReactElement, type MouseEvent as ReactMouseEvent, useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ICON } from "./format";

export const PRIORITY_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: "1 - Highest" },
  { value: 2, label: "2 - High" },
  { value: 3, label: "3 - Medium" },
  { value: 4, label: "4 - Low" },
  { value: 5, label: "5 - Lowest" },
];

interface MenuPosition {
  top: number;
  left: number;
  width: number;
}

export function PrioritySelect({
  priority,
  onChange,
}: {
  priority: number;
  onChange: (priority: number) => void;
}): ReactElement {
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const isOpen = position !== null;
  const selectedLabel = PRIORITY_OPTIONS.find((o) => o.value === priority)?.label ?? `${priority}`;

  // Outside-click listener lives exactly as long as the menu is mounted (ref callback with cleanup).
  const menuRef = useCallback((menu: HTMLDivElement | null) => {
    if (!menu) return;
    const onDocumentClick = (e: MouseEvent): void => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menu.contains(target)) return;
      setPosition(null);
    };
    document.addEventListener("click", onDocumentClick, true);
    return () => document.removeEventListener("click", onDocumentClick, true);
  }, []);

  const toggle = (e: ReactMouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation();
    if (isOpen) {
      setPosition(null);
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    setPosition({ top: r.bottom + 2, left: r.left, width: r.width });
  };

  const choose = (value: number): void => {
    setPosition(null);
    if (value !== priority) onChange(value);
  };

  return (
    <div className="relative">
      <button
        type="button"
        ref={triggerRef}
        className="w-full px-2 py-1.5 rounded-lg bg-surface-inset border border-zinc-300 dark:border-zinc-600 text-xs text-fg-2 flex items-center justify-between gap-1 cursor-pointer hover:bg-surface-hover"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span>{selectedLabel}</span>
        <ChevronDown size="1em" className={`${ICON} text-fg-faint text-[10px] ${isOpen ? "rotate-180" : ""}`} />
      </button>
      {position &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            className="fixed z-[100] bg-surface-card border border-edge rounded-lg shadow-xl py-1 min-w-[8rem]"
            style={{ top: position.top, left: position.left, width: position.width }}
          >
            {PRIORITY_OPTIONS.map((opt) => {
              const selected = opt.value === priority;
              return (
                <button
                  type="button"
                  key={opt.value}
                  role="option"
                  aria-selected={selected}
                  className={`w-full px-3 py-1.5 text-xs text-left flex items-center gap-2 ${
                    selected ? "bg-blue-600/20 text-accent-blue font-medium" : "text-fg-3 hover:bg-surface-hover"
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    choose(opt.value);
                  }}
                >
                  {selected ? <Check size="1em" className={`${ICON} text-[10px]`} /> : <span className="w-3" />}
                  {opt.label}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
