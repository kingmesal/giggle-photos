# RFD-004: Rewrite the UI in React (on Electrobun 2.x), Without `useEffect`

## Status
Implemented 2026-11-13: all screens in React, Sigment removed. RFD-002/003 screens beyond parity
(CLIP review groups, quarantine restore, immich-go report, setup screen) remain.

## Problem

`packages/ui` (about 7.9k lines of TypeScript including tests) is built on **Sigment**, which the
maintainer wants to move away from because it isn't an open framework with a broad
ecosystem. RFD-002 and RFD-003 also add substantial new UI (CLIP groups, album/sidecar
badges, motion-photo pairs, quarantine and validation reports), which is a natural point to
rebuild instead of extending.

## Proposed Solution

### Platform: stay on Electrobun

- The app is a **thick client**: heavy filesystem work, SQLite, native modules (sharp,
  onnxruntime-node) and child-process workers. All of that lives in the Bun main process and
  `packages/core`, which Electrobun keeps intact.
- The app already sets **`bundleCEF: true`** on every platform, so the UI renders in bundled
  Chromium, consistent across OSes.
- Upgrade to Electrobun 2.0.6 first (**RFD-001**, prerequisite).
- Rejected alternatives: Electron (leave Bun for Node: lose `bun:sqlite`, Bun workers, the
  current build); Tauri (rewrite `packages/core` in Rust).

### Stack

| Concern | Choice |
|---|---|
| UI | React 19 + TypeScript (TSX bundled by Electrobun/Bun) |
| Styling | Tailwind CSS (kept) |
| Reads / calls over RPC | In-house `useRead` / `useAction` hooks (`packages/ui/src/data/`), small and fully tested, with the contract described below |
| Push events (scan/hash progress, logs) | `useSyncExternalStore` over an RPC-message store |
| Large grids/lists | TanStack Virtual (review groups can hold thousands of thumbnails) |
| Navigation | Small typed state machine (few screens); no router unless needed |
| Icons | Lucide via `lucide-react` (ISC). Font Awesome Pro was removed when the repo went public; the interim `icon-shim.ts` renders legacy `fa-*` markup until the Sigment views are gone |
| Tests | `bun:test` + React Testing Library (happy-dom); Playwright E2E kept |

### Architecture

- `packages/core` is unchanged. `apps/desktop/src/bun/rpc-types.ts` is the contract.
- `packages/ui/src/rpc/`: one typed hook per RPC method
  (`useScanFolders()`, `useApplyDecisions()`, …) built on `useRead` / `useAction`, with Zod
  parsing at the boundary.
- `packages/ui/src/external/`: the **only** place stores for external push sources are
  written (see rules below).
- **Media display:** the UI never decodes originals. The Bun side (`file-server.ts`) serves
  generated JPEG/WebP previews and video poster frames from a cache. Chromium can't display
  HEIC, and decoding 40 MP originals in the renderer would be slow. Thumbnails come from
  the same single-pass decode as RFD-002.

### Rule: no `useEffect`

Effects cause most UI state bugs (stale closures, double-fetching, sync loops). The rule for
this codebase:

| Need | Do this instead of `useEffect` |
|---|---|
| Value derived from props/state | Compute during render (`useMemo` only if measured slow) |
| Respond to a user action | Do it in the event handler |
| Load data over RPC | `useRead` (keys the read, discards superseded/late answers, returns `{ value, loading, failure, refresh }`) |
| Run an RPC call a person triggers | `useAction` (returns `{ run, pending, failure, value }`, sets nothing after unmount) |
| Subscribe to push events from Bun | `useSyncExternalStore` with a store in `src/external/` |
| Reset state when an entity changes | Remount with `key={entityId}` |
| Notify a parent of a change | Call the parent's callback in the same event handler |
| Focus/measure a DOM node | Ref callback (`ref={node => …}`) |

`useEffect` / `useLayoutEffect` are allowed **only** to synchronize with an external
system that has no better primitive. They must live in `packages/ui/src/external/` with a
comment explaining why.

**Enforced, not just documented.**

- A **Biome GritQL plugin**, `plugins/no-raw-use-effect.grit`. It matches **calls**, not imports:
  `useEffect(…)`, `useEffect<T>(…)`, `useLayoutEffect(…)` and the member forms
  `X.useEffect(…)` / `X.useLayoutEffect(…)`. It reports: *"A raw effect. Load data with
  useRead, run a call with useAction … An effect that syncs with something outside React goes
  in a hook named for it, in its own file, excluded in biome.jsonc."* `bunx biome check .`
  fails on any match.
- **Scoped in `biome.jsonc`** via the plugin entry's `includes`: `packages/ui/src/**`, minus
  tests, minus **one exclusion per external-sync hook file**, each with a comment naming
  the system it syncs with. Expected exclusions: `useRead`'s AbortController and deadline
  timer, and `useAction`'s in-flight abort.
- **A lint fixture** (`lint-fixtures/no-raw-use-effect.tsx`, excluded from normal linting)
  documents what matches and what doesn't, and a test asserts the plugin still flags it,
  so the rule can't silently stop working.
- Requires Biome 2.5+ for plugin `includes` scoping (the repo is on 2.5.8).
- `CLAUDE.md`: replace the "Sigment UI Patterns" section with these rules and a short example,
  so agents follow them by default.

### Screens (parity first, then new)

Parity with today: Folders, Processing, Results, DuplicateGroupReview, ComparisonModal,
Settings, plus layout (Sidebar/AppLayout), theme, logs and system health.

New, from RFD-002/003:
- Method badges per group (sha256 / content_hash / phash / **clip** with distance).
- Album and sidecar badges per file; motion-photo pairs shown as one tile.
- Unsupported/unmatched counts with drill-down (HEIC failures, unmatched sidecars).
- Quarantine summary and the `immich-go --dry-run` validation report.
- Keyboard-driven review (next group, keep/delete, accept preselection).
- First-run setup screen: automatic CLIP model download with progress, retry and
  "import model file" fallback (RFD-002). Execution-provider selection in Settings.

## Migration Plan

1. RFD-001 lands (Electrobun 2.0.6).
2. Scaffold React in `packages/ui` next to the Sigment code; switch the view entrypoint
   (`apps/desktop/src/views/mainview.ts`) behind a dev flag.
3. Port screens to parity; Playwright E2E tests become the parity checklist.
4. Delete Sigment, its type shims (`sigment.d.ts`), the interim `icons/icon-shim.ts` and the
   `sigment` / `lucide` dependencies; update `CLAUDE.md`.
5. Build the RFD-002/003 screens on the new foundation.

## Implementation notes (2026-11-13)

- Migration path as planned: a React shell first, old screens bridged, then one screen at a time,
  E2E green after each step; then Sigment, its type shims, the icon shim and the vanilla `lucide`
  package deleted.
- Effect gate: `plugins/no-raw-use-effect.grit` (adapted for this project), scoped in `biome.jsonc`;
  `lint-fixtures/no-raw-use-effect.tsx` + `packages/ui/src/lint-gate.test.ts` pin it (7 findings).
- In-house `useRead` / `useAction` / `useInterval` / `useDocumentKeys` and a `useSyncExternalStore`
  store in `packages/ui/src/external/`, the only files allowed to call `useEffect`.
- Routing: a navigation store (no router). Large review groups use TanStack Virtual (> 120 files).
- Tailwind (v3.4, same utilities the old CDN script provided) is compiled at build time by
  `apps/desktop/scripts/build-css.ts` (Electrobun preBuild and the E2E server), so the app renders
  styled offline. Config: `apps/desktop/tailwind.config.js`.

## Alternatives Considered

- **Keep Sigment.** Rejected by maintainer.
- **Solid / Svelte.** Viable signal-based options, but React has the widest ecosystem
  (Query, Virtual, Testing Library) and is most familiar to contributors and agents.
- **Allow `useEffect` with lint warnings only.** Rejected: warnings get ignored; the rule
  has to fail the build.
- **TanStack Query instead of `useRead` / `useAction`.** Viable, but it's a second data-loading
  idiom and dependency, and its cache is more than a single-user desktop app
  needs. Revisit if cross-screen caching becomes a real need.
- **Ban `useEffect` imports with Biome `noRestrictedImports`.** Weaker than a GritQL
  plugin: it misses `React.useEffect(…)` through a namespace import.

## Decision
Pending review.

## Implementation Notes

- 300-line file limit and no barrel exports still apply.
- Named exports; default export only where a framework requires it.
- The RPC layer stays the only coupling between `packages/ui` and `packages/core`.

## References

- https://react.dev/learn/you-might-not-need-an-effect
- https://react.dev/reference/react/useSyncExternalStore
- https://tanstack.com/virtual
- https://biomejs.dev/reference/plugins/ (GritQL plugins)
- RFD-001 (prerequisite), RFD-002, RFD-003
