/**
 * Interim icon shim: renders Lucide icons into the legacy Font Awesome markup
 * (`i({ class: "fadr fa-trash …" })`) used by the Sigment views.
 *
 * Font Awesome Pro cannot ship in this public repo, and RFD-004 rewrites every
 * view in React with Lucide components. Rather than edit ~150 call sites in
 * code that is about to be deleted, this shim does what the Font Awesome
 * script did: watch the DOM and fill matching <i> elements with an SVG.
 *
 * Delete this file (and its startIconShim call sites) with Sigment in RFD-004.
 */
import {
  ArrowDown01,
  ArrowDownAZ,
  ArrowLeftRight,
  ArrowRight,
  ArrowUp01,
  ArrowUpAZ,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  CirclePlay,
  CirclePlus,
  CircleQuestionMark,
  Clock,
  Copy,
  Cpu,
  Crosshair,
  createElement,
  Database,
  Eye,
  File,
  Files,
  Film,
  Fingerprint,
  Flag,
  Folder,
  FolderOpen,
  FolderPlus,
  Folders,
  FolderX,
  HardDrive,
  type IconNode,
  Image,
  Images,
  Info,
  List,
  ListChecks,
  LoaderCircle,
  Moon,
  MousePointer2,
  PartyPopper,
  Pause,
  Play,
  RefreshCw,
  Save,
  Settings,
  SkipBack,
  SkipForward,
  Star,
  Sun,
  Terminal,
  Trash2,
  TriangleAlert,
  Undo2,
  X,
} from "lucide";

/** Legacy Font Awesome icon class → Lucide icon. */
export const ICON_MAP: Readonly<Record<string, IconNode>> = {
  "fa-arrow-down-1-9": ArrowDown01,
  "fa-arrow-down-a-z": ArrowDownAZ,
  "fa-arrow-pointer": MousePointer2,
  "fa-arrow-right": ArrowRight,
  "fa-arrow-up-1-9": ArrowUp01,
  "fa-arrow-up-a-z": ArrowUpAZ,
  "fa-arrows-rotate": RefreshCw,
  "fa-backward-fast": ChevronsLeft,
  "fa-backward-step": SkipBack,
  "fa-check": Check,
  "fa-check-circle": CircleCheck,
  "fa-chevron-down": ChevronDown,
  "fa-chevron-left": ChevronLeft,
  "fa-chevron-right": ChevronRight,
  "fa-chevron-up": ChevronUp,
  "fa-circle-check": CircleCheck,
  "fa-circle-exclamation": CircleAlert,
  "fa-circle-info": Info,
  "fa-circle-play": CirclePlay,
  "fa-circle-plus": CirclePlus,
  "fa-clock": Clock,
  "fa-clone": Copy,
  "fa-crosshairs": Crosshair,
  "fa-database": Database,
  "fa-exclamation-circle": CircleAlert,
  "fa-exclamation-triangle": TriangleAlert,
  "fa-eye": Eye,
  "fa-file": File,
  "fa-files": Files,
  "fa-film": Film,
  "fa-fingerprint": Fingerprint,
  "fa-flag-swallowtail": Flag,
  "fa-floppy-disk": Save,
  "fa-folder": Folder,
  "fa-folder-open": FolderOpen,
  "fa-folder-plus": FolderPlus,
  "fa-folder-xmark": FolderX,
  "fa-folders": Folders,
  "fa-forward-fast": ChevronsRight,
  "fa-forward-step": SkipForward,
  "fa-gear": Settings,
  "fa-hard-drive": HardDrive,
  "fa-image": Image,
  "fa-images": Images,
  "fa-info-circle": Info,
  "fa-list": List,
  "fa-list-check": ListChecks,
  "fa-microchip": Cpu,
  "fa-moon": Moon,
  "fa-party-horn": PartyPopper,
  "fa-pause": Pause,
  "fa-play": Play,
  "fa-question": CircleQuestionMark,
  "fa-right-left": ArrowLeftRight,
  "fa-spinner": LoaderCircle,
  "fa-star": Star,
  "fa-sun-bright": Sun,
  "fa-terminal": Terminal,
  "fa-trash": Trash2,
  "fa-trash-undo": Undo2,
  "fa-triangle-exclamation": TriangleAlert,
  "fa-xmark": X,
};

/** Font Awesome animation/style modifiers → Tailwind classes. Others are ignored. */
export const MODIFIER_MAP: Readonly<Record<string, string>> = {
  "fa-spin": "animate-spin",
  "fa-beat-fade": "animate-pulse",
};

const STYLE_ID = "icon-shim-style";
const STYLE_RULES =
  "i.fadr{display:inline-block;line-height:1;vertical-align:-0.125em}" +
  "i.fadr>svg{display:block;width:1em;height:1em}";

/** The mapped Font Awesome class on an element, or null. */
export function resolveIconClass(classList: Iterable<string>): string | null {
  for (const name of classList) {
    if (name in ICON_MAP) return name;
  }
  return null;
}

function renderIcon(el: HTMLElement): void {
  for (const [fa, tailwind] of Object.entries(MODIFIER_MAP)) {
    // toggle(force) does not mutate when already in the requested state, so no observer loop.
    el.classList.toggle(tailwind, el.classList.contains(fa));
  }
  const name = resolveIconClass(Array.from(el.classList)) ?? "";
  if (el.dataset.icon === name && (name === "" || el.firstElementChild)) return;
  el.dataset.icon = name;
  const icon = ICON_MAP[name];
  el.replaceChildren(...(icon ? [createElement(icon, { "aria-hidden": "true" })] : []));
}

function renderTree(node: Node): void {
  if (!(node instanceof HTMLElement)) return;
  if (node.tagName === "I" && node.classList.contains("fadr")) renderIcon(node);
  for (const el of Array.from(node.querySelectorAll<HTMLElement>("i.fadr"))) renderIcon(el);
}

let observer: MutationObserver | null = null;

/** Render existing icons under `root` and keep rendering as the DOM changes. Idempotent. */
export function startIconShim(root: HTMLElement = document.body): void {
  if (observer) return;
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = STYLE_RULES;
    document.head.append(style);
  }
  renderTree(root);
  observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes") renderTree(record.target);
      for (const added of Array.from(record.addedNodes)) renderTree(added);
    }
  });
  observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
}
