// Browser-safe exports (no Node.js dependencies)
// These can be imported in webview/browser code

// Layout components
export { AppLayout } from "./layout/AppLayout";
export { Sidebar } from "./layout/Sidebar";
// Node.js-only exports (use in main process only, not in webview)
// Re-exported from main.ts which imports @core
export { initUI, shutdownUI } from "./main";
// State
export { currentView, type NavItem, navItems, navigateTo, type ViewName } from "./state/navigation";
export { FoldersView, initFoldersService } from "./views/FoldersView";
// Views
export { SettingsView } from "./views/SettingsView";
