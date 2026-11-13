import { CalendarClock, CircleCheck, Copy, Folders, Images, ListChecks, Moon, Settings, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { navItems, navigateTo, settingsNavItem, useCurrentView, type ViewName } from "../state/navigation";
import { toggleTheme, useThemeMode } from "../state/theme";

const NAV_ICONS: Record<ViewName, ReactNode> = {
  folders: <Folders size={18} />,
  processing: <ListChecks size={18} />,
  duplicates: <Copy size={18} />,
  dates: <CalendarClock size={18} />,
  settings: <Settings size={18} />,
};

const ACTIVE = "bg-blue-600/20 text-accent-blue border border-blue-500/30";
const INACTIVE = "text-fg-muted hover:bg-surface-hover hover:text-fg-2";

function NavLink({ id, label }: { id: ViewName; label: string }) {
  const active = useCurrentView() === id;
  return (
    <a
      href={`#${id}`}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors cursor-pointer ${active ? ACTIVE : INACTIVE}`}
      onClick={(e) => {
        e.preventDefault();
        navigateTo(id);
      }}
    >
      <span className="w-5 flex justify-center">{NAV_ICONS[id]}</span>
      {label}
    </a>
  );
}

function StatusFooter() {
  const active = useCurrentView() === settingsNavItem.id;
  const isDark = useThemeMode() === "dark";
  return (
    <div className="p-3 border-t border-edge space-y-2">
      <button
        type="button"
        className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer w-full text-sm ${active ? ACTIVE : INACTIVE}`}
        onClick={() => navigateTo(settingsNavItem.id)}
      >
        <span className="w-5 flex justify-center">{NAV_ICONS.settings}</span>
        Settings
      </button>
      <div className="flex items-center gap-2 px-3 py-2">
        <Sun size={16} className={isDark ? "text-fg-faint" : "text-amber-400"} />
        <button
          type="button"
          className={`relative w-10 h-5 rounded-full cursor-pointer ${isDark ? "bg-blue-500/40" : "bg-zinc-300/40 dark:bg-zinc-600/40"}`}
          onClick={() => toggleTheme()}
          title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
        >
          <span
            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm ${isDark ? "left-5" : "left-0.5"}`}
          />
        </button>
        <Moon size={16} className={isDark ? "text-blue-400" : "text-fg-faint"} />
      </div>
      <div className="-mx-3 border-t border-edge" />
      <div className="px-3 py-2 rounded-lg bg-zinc-100/50 dark:bg-zinc-800/50 text-xs">
        <div className="flex items-center justify-between text-fg-muted">
          <span>Database</span>
          <span className="flex items-center gap-1 text-accent-green">
            <CircleCheck size={12} />
            Connected
          </span>
        </div>
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="w-64 bg-surface-card border-r border-edge flex flex-col h-full">
      <div className="p-4 border-b border-edge">
        <h1 className="text-lg font-semibold flex items-center gap-2 text-fg">
          <Images size={20} className="text-blue-400" />
          Giggle Photos
        </h1>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {navItems.map((item) => (
          <NavLink key={item.id} id={item.id} label={item.label} />
        ))}
      </nav>
      <StatusFooter />
    </aside>
  );
}
