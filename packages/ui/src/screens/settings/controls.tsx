/**
 * Small building blocks shared by the settings sections: section card, label/control row, toggle switch,
 * dialog shell.
 */
import type { ReactNode } from "react";

/** Card with an icon header; `children` are the rows. */
export function SettingsSection({
  icon,
  iconColor,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  iconColor: string;
  title: string;
  description: string;
  children: ReactNode;
}): ReactNode {
  return (
    <section className="bg-surface-card rounded-xl border border-edge overflow-hidden mb-6">
      <div className="px-5 py-4 border-b border-edge">
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-lg ${iconColor} flex items-center justify-center`}>{icon}</div>
          <div>
            <h3 className="font-medium text-fg">{title}</h3>
            <p className="text-xs text-fg-muted">{description}</p>
          </div>
        </div>
      </div>
      <div className="p-5 space-y-5">{children}</div>
    </section>
  );
}

/** Label and description on the left, a control on the right. */
export function SettingsRow({
  label,
  description,
  control,
}: {
  label: string;
  description: ReactNode;
  control: ReactNode;
}): ReactNode {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex-1">
        <p className="text-sm text-fg-2">{label}</p>
        <p className="text-xs text-fg-faint">{description}</p>
      </div>
      {control}
    </div>
  );
}

/** On/off switch (role="switch"). */
export function Toggle({
  value,
  onChange,
  label,
  disabled = false,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  disabled?: boolean;
}): ReactNode {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={label}
      disabled={disabled}
      className={`relative w-12 h-6 flex-shrink-0 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-zinc-50 dark:focus:ring-offset-zinc-800 focus:ring-blue-500/50 ${value ? "bg-blue-500/40" : "bg-zinc-300/40 dark:bg-zinc-600/40"} ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
      onClick={() => onChange(!value)}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${value ? "translate-x-6" : "translate-x-0"}`}
      />
    </button>
  );
}

/** Modal overlay; clicking the backdrop calls `onBackdrop` (when given). */
export function DialogShell({
  maxWidth,
  onBackdrop,
  children,
}: {
  maxWidth: "max-w-md" | "max-w-lg";
  onBackdrop?: () => void;
  children: ReactNode;
}): ReactNode {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click closes, as in the old view
    // biome-ignore lint/a11y/useKeyWithClickEvents: the dialog's own buttons are the keyboard path
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onBackdrop?.();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`bg-surface-card rounded-xl border border-edge shadow-2xl ${maxWidth} w-full`}
      >
        {children}
      </div>
    </div>
  );
}

/** Dialog header: coloured icon tile, title, subtitle. */
export function DialogHeader({
  icon,
  iconColor,
  title,
  subtitle,
}: {
  icon: ReactNode;
  iconColor: string;
  title: string;
  subtitle: string;
}): ReactNode {
  return (
    <div className="px-6 py-4 border-b border-edge">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg ${iconColor} flex items-center justify-center`}>{icon}</div>
        <div>
          <h3 className="text-lg font-semibold text-fg">{title}</h3>
          <p className="text-sm text-fg-muted mt-0.5">{subtitle}</p>
        </div>
      </div>
    </div>
  );
}

export const SECONDARY_BUTTON =
  "px-3 py-1.5 rounded-lg bg-surface-inset hover:bg-surface-active text-fg-3 text-sm transition-colors flex items-center gap-2";

export const DIALOG_BUTTON =
  "px-4 py-2 rounded-lg bg-surface-inset hover:bg-surface-active text-fg-3 text-sm font-medium transition-colors";
