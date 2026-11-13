/**
 * Test entry point for E2E tests.
 * Mounts the UI without Electrobun — services gracefully degrade
 * (logger → console, settings → localStorage, others → error states).
 */
import { mountApp } from "../../packages/ui/src/browser";

document.addEventListener("DOMContentLoaded", () => {
  const container = document.getElementById("app");
  if (container) mountApp(container);
});
