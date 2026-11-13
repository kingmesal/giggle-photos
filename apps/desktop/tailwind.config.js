/**
 * Tailwind v3, built at build time (scripts/build-css.ts) so the app renders styled offline.
 * Same configuration the runtime CDN script used to carry in index.html.
 * @type {import('tailwindcss').Config}
 */
export default {
  darkMode: "class",
  content: ["./src/views/**/*.{html,ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        fg: {
          DEFAULT: "var(--fg)",
          2: "var(--fg-2)",
          3: "var(--fg-3)",
          muted: "var(--fg-muted)",
          faint: "var(--fg-faint)",
        },
        surface: {
          DEFAULT: "var(--surface)",
          card: "var(--surface-card)",
          inset: "var(--surface-inset)",
          hover: "var(--surface-hover)",
          active: "var(--surface-active)",
        },
        edge: { DEFAULT: "var(--edge)" },
        accent: {
          green: "var(--accent-green)",
          blue: "var(--accent-blue)",
          amber: "var(--accent-amber)",
          red: "var(--accent-red)",
        },
      },
    },
  },
};
