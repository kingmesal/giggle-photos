/** Lucide icons for the Processing screen, sized 1em so text-* classes size them like the old font icons. */
import { CircleCheck, Copy, Database, Fingerprint, FolderOpen, type LucideIcon } from "lucide-react";
import type { StepIcon } from "./pipeline-logic";

/** Icon inline with text (Tailwind preflight makes svg block-level). */
export const INLINE_ICON = "inline-block align-[-0.125em]";

export const STEP_ICONS: Record<StepIcon, LucideIcon> = {
  "folder-open": FolderOpen,
  database: Database,
  fingerprint: Fingerprint,
  clone: Copy,
  "circle-check": CircleCheck,
};
