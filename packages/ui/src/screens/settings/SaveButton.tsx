/**
 * Header Save button: label, colour and icon follow the save status; enabled when there are unsaved
 * changes, or to retry after an error.
 */
import { Check, LoaderCircle, Save, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

export type SaveStatus = "loading" | "idle" | "saving" | "saved" | "error";

interface Look {
  text: string;
  className: string;
  icon: ReactNode;
  disabled: boolean;
}

function look(status: SaveStatus, dirty: boolean): Look {
  const spinner = <LoaderCircle size={14} className="animate-spin" />;
  switch (status) {
    case "loading":
      return {
        text: "Loading...",
        className: "bg-zinc-300 dark:bg-zinc-600 cursor-wait",
        icon: spinner,
        disabled: true,
      };
    case "saving":
      return { text: "Saving...", className: "bg-blue-600 opacity-75 cursor-wait", icon: spinner, disabled: true };
    case "saved":
      return { text: "Saved!", className: "bg-emerald-600", icon: <Check size={14} />, disabled: true };
    case "error":
      return {
        text: "Error - Retry",
        className: "bg-red-600 hover:bg-red-500",
        icon: <TriangleAlert size={14} />,
        disabled: false,
      };
    default:
      return dirty
        ? {
            text: "Save Changes",
            className: "bg-blue-600 hover:bg-blue-500",
            icon: <Save size={14} />,
            disabled: false,
          }
        : {
            text: "Save Changes",
            className: "bg-zinc-300 dark:bg-zinc-600 cursor-not-allowed opacity-50",
            icon: <Save size={14} />,
            disabled: true,
          };
  }
}

export function SaveButton({
  status,
  dirty,
  onSave,
}: {
  status: SaveStatus;
  dirty: boolean;
  onSave: () => void;
}): ReactNode {
  const { text, className, icon, disabled } = look(status, dirty);
  return (
    <button
      type="button"
      className={`px-4 py-2 rounded-lg ${className} text-white text-sm font-medium transition-colors flex items-center gap-2`}
      disabled={disabled}
      onClick={onSave}
    >
      {icon}
      {text}
    </button>
  );
}
