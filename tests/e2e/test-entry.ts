/**
 * Test entry point for E2E tests.
 * Mounts the UI without Electrobun — services gracefully degrade
 * (logger → console, settings → localStorage, others → error states).
 */
import {
  AppLayout,
  FoldersView,
  ProcessingView,
  ResultsView,
  SettingsView,
  startIconShim,
} from "../../packages/ui/src/browser";
import { mount } from "../../packages/ui/node_modules/sigment/dist/index.js";

document.addEventListener("DOMContentLoaded", () => {
  startIconShim();
  const container = document.getElementById("app");
  if (container) {
    mount(
      container,
      AppLayout({
        settings: SettingsView,
        folders: FoldersView,
        processing: ProcessingView,
        duplicates: ResultsView,
      }),
    );
  }
});
