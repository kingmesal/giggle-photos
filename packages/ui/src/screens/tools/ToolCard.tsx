/** A Library Tools card: title, what it does, a few counts, and its Run button. */
import { LoaderCircle, Play } from "lucide-react";
import type { ReactNode } from "react";

export function Stat({ label, value }: { label: string; value: number }): ReactNode {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-fg-3">{label}</span>
      <span className="font-mono">{value.toLocaleString()}</span>
    </div>
  );
}

export function ToolCard({
  icon,
  title,
  description,
  stats,
  children,
  runLabel,
  disabled,
  running,
  onRun,
}: {
  icon: ReactNode;
  title: string;
  description: ReactNode;
  stats: ReactNode;
  children?: ReactNode;
  runLabel: string;
  disabled: boolean;
  running: boolean;
  onRun: () => void;
}): ReactNode {
  return (
    <section className="bg-surface-card rounded-lg border border-edge p-5 flex flex-col gap-3" aria-label={title}>
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-violet-500/20 text-violet-700 dark:text-violet-400 flex items-center justify-center">
          {icon}
        </div>
        <h3 className="text-base font-semibold text-fg">{title}</h3>
      </div>
      <div className="text-sm text-fg-muted">{description}</div>
      <div className="space-y-1">{stats}</div>
      {children}
      <button
        type="button"
        className={`mt-auto px-4 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 ${
          disabled
            ? "bg-violet-600/30 text-violet-800 dark:text-violet-200 cursor-not-allowed"
            : "bg-violet-600 hover:bg-violet-500 text-white"
        }`}
        disabled={disabled}
        onClick={onRun}
      >
        {running ? <LoaderCircle size="1em" className="animate-spin" /> : <Play size="1em" />}
        {runLabel}
      </button>
    </section>
  );
}
