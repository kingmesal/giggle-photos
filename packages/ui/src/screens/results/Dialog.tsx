/** Modal dialog shell: dimmed backdrop (click closes), card, and an icon header. */
import type { ReactNode } from "react";

export interface DialogProps {
  onClose: () => void;
  /** Card classes (width, layout). */
  cardClass?: string;
  children: ReactNode;
}

export function Dialog({ onClose, cardClass = "max-w-md w-full", children }: DialogProps): ReactNode {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click closes, as in the old views
    // biome-ignore lint/a11y/useKeyWithClickEvents: Cancel/Close buttons provide keyboard access
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`bg-surface-card rounded-xl border border-edge shadow-2xl ${cardClass}`}
      >
        {children}
      </div>
    </div>
  );
}

export interface DialogHeaderProps {
  icon: ReactNode;
  iconClass: string;
  title: string;
  subtitle: string;
  className?: string;
}

export function DialogHeader({ icon, iconClass, title, subtitle, className = "" }: DialogHeaderProps): ReactNode {
  return (
    <div className={`px-6 py-4 border-b border-edge ${className}`}>
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl ${iconClass}`}>{icon}</div>
        <div>
          <h3 className="text-lg font-semibold text-fg">{title}</h3>
          <p className="text-sm text-fg-muted mt-0.5">{subtitle}</p>
        </div>
      </div>
    </div>
  );
}

export const CANCEL_BUTTON =
  "px-4 py-2 rounded-lg text-sm font-medium bg-surface-inset hover:bg-surface-active text-fg-3";
