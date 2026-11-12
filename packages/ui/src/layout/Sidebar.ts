/**
 * Sidebar navigation component
 * Note: HTML element functions (aside, div, h1, etc.) are globals provided by Sigment
 */
import { currentView, navItems, navigateTo, settingsNavItem, type ViewName } from "../state/navigation";
import { getThemeMode, toggleTheme } from "../state/theme";

/** Create a navigation link */
function NavLink({ id, label, icon }: { id: ViewName; label: string; icon: string }) {
  return () => {
    const isActive = currentView() === id;
    const baseClasses = "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors cursor-pointer";
    const activeClasses = "bg-blue-600/20 text-accent-blue border border-blue-500/30";
    const inactiveClasses = "text-fg-muted hover:bg-surface-hover hover:text-fg-2";

    return a(
      {
        class: `${baseClasses} ${isActive ? activeClasses : inactiveClasses}`,
        onclick: (e: Event) => {
          e.preventDefault();
          navigateTo(id);
        },
      },
      i({ class: `fadr ${icon} w-5 text-center` }),
      label,
    );
  };
}

/** Status footer with settings button and database status */
function StatusFooter() {
  return div(
    { class: "p-3 border-t border-edge space-y-2" },
    // Settings button — full-width, labeled
    () => {
      const isActive = currentView() === settingsNavItem.id;
      const baseClasses = "flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer w-full text-sm";
      const activeClasses = "bg-blue-600/20 text-accent-blue border border-blue-500/30";
      const inactiveClasses = "text-fg-muted hover:bg-surface-hover hover:text-fg-2";

      return button(
        {
          class: `${baseClasses} ${isActive ? activeClasses : inactiveClasses}`,
          onclick: () => navigateTo(settingsNavItem.id),
        },
        i({ class: `fadr ${settingsNavItem.icon} w-5 text-center` }),
        "Settings",
      );
    },
    // Theme toggle slider
    () => {
      const isDark = getThemeMode() === "dark";
      return div(
        { class: "flex items-center gap-2 px-3 py-2" },
        i({ class: `fadr fa-sun-bright w-5 text-center ${isDark ? "text-fg-faint" : "text-amber-400"}` }),
        button(
          {
            class: `relative w-10 h-5 rounded-full cursor-pointer ${isDark ? "bg-blue-500/40" : "bg-zinc-300/40 dark:bg-zinc-600/40"}`,
            onclick: () => toggleTheme(),
            title: isDark ? "Switch to Light Mode" : "Switch to Dark Mode",
          },
          span({
            class: `absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm ${isDark ? "left-5" : "left-0.5"}`,
          }),
        ),
        i({ class: `fadr fa-moon w-5 text-center ${isDark ? "text-blue-400" : "text-fg-faint"}` }),
      );
    },
    // Separator
    div({ class: "-mx-3 border-t border-edge" }),
    // Database status
    div(
      { class: "px-3 py-2 rounded-lg bg-zinc-100/50 dark:bg-zinc-800/50 text-xs" },
      div(
        { class: "flex items-center justify-between text-fg-muted" },
        span({}, "Database"),
        span({ class: "flex items-center gap-1 text-accent-green" }, i({ class: "fadr fa-circle-check" }), "Connected"),
      ),
    ),
  );
}

/** Main sidebar component */
export function Sidebar() {
  return aside(
    { class: "w-64 bg-surface-card border-r border-edge flex flex-col h-full" },
    // Logo/App Name
    div(
      { class: "p-4 border-b border-edge" },
      h1(
        { class: "text-lg font-semibold flex items-center gap-2 text-fg" },
        i({ class: "fadr fa-images text-blue-400 fa-icon-secondary" }),
        "Giggle Photos",
      ),
    ),
    // Navigation
    nav({ class: "flex-1 p-3 space-y-1" }, ...navItems.map((item) => NavLink(item))),
    // Status Footer (includes settings gear)
    StatusFooter(),
  );
}
