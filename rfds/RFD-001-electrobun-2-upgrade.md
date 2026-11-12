# RFD-001: Upgrade Electrobun 1.12.3 → 2.0.6

## Status
Draft — 2026-11-12 (revised 2026-11-12 after implementation audit; see "Findings")

## Problem

`apps/desktop` pins `electrobun@1.12.3`. The latest stable release is **2.0.6**
(published 2026-11-04); `2.0.7-beta.*` builds also exist. RFD-004 rewrites the UI in
React, and that work should be built against the runtime we intend to ship rather
than ported across a major version afterwards.

Electrobun's GitHub releases do not carry a curated changelog — release bodies are
the same "Getting Started / Artifact Reference" boilerplate for every version — and
the documentation moved from `blackboard.sh/electrobun/docs` to
`docs.electrobun.dev/electrobun` (`docs.electrobunny.ai` does not resolve). Breaking changes therefore have to be found by
reading the current docs and type definitions, not a migration guide.

## Proposed Solution

Do the upgrade as its own branch and PR, **before** any RFD-004 work starts, with no
feature changes mixed in.

1. Pin the exact version: `"electrobun": "2.0.6"` (no caret). Stay off `2.0.7-beta.*`.
2. Audit every Electrobun touchpoint against the 2.x SDK sources in the Hutch devkit
   (`apps/desktop/.hutch/devkit/api/**`; the npm package contains no SDK, see Findings)
   and the current docs:

   | File | What to check |
   |---|---|
   | `apps/desktop/electrobun.config.ts` | `ElectrobunConfig` shape: `build.{mac,win,linux}.bundleCEF`, `icons`/`icon`, `bun.external`, `views`, `copy`, `release.baseUrl` |
   | `apps/desktop/src/bun/window.ts` | `BrowserWindow` construction and options |
   | `apps/desktop/src/bun/rpc.ts`, `rpc-types.ts` | RPC definition/typing API (request + message schemas) |
   | `apps/desktop/src/bun/updater.ts` | Updater API and the artifact/URL format it expects |
   | `apps/desktop/src/bun/file-server.ts` | Any custom protocol / view-URL behaviour it relies on |
   | `apps/desktop/src/views/*` | Browser-side Electrobun imports (`electrobun/view`) |
   | `.github/` workflows | Build/release commands and artifact names |
3. Update the docs link in `electrobun.config.ts` (it still points at `blackboard.sh`).
4. Keep `bundleCEF: true` on all platforms. The app relies on bundled Chromium, and the
   sharp/libvips child-process isolation (see `sharp-worker.ts` header comment: GLib
   ref-counting races with Chromium) must keep working.

## Findings (implementation audit, 2026-11-12)

The original draft assumed a normal npm version bump. It is not:

- **The `electrobun@2.0.6` npm package is a bootstrap with no SDK.** Every import
  (`electrobun/bun`, `electrobun/view`, …) resolves to `lib/moved.cjs`, which throws. On first
  use the bootstrap downloads the **Hutch** toolchain (SHA-256 verified) into `~/.hutch` and
  projects the SDK into `apps/desktop/.hutch/devkit` (generated, gitignored). Migration guide:
  `docs.electrobun.dev/electrobun/guides/migrating-to-v2`.
- **TypeScript:** `apps/desktop/tsconfig.json` extends both `tsconfig.base.json` and
  `.hutch/devkit/tsconfig.json` (paths map `electrobun/*` into the devkit). `typecheck` runs
  `electrobun prepare` first so a fresh clone works. Plain `bun run` (outside an Electrobun
  build) still resolves the throwing stub.
- **Pinning:** a root `hutch.config.ts` pins `electrobun.version: "2.0.6"`, Hutch CLI 0.29.0 and
  Cottontail 0.7.3, and sets `packageManager: "bun"` so `bun.lock` stays the only lockfile.
  Electrobun 2.0.6 ships its own app runtime **Bun 1.4.4** (dev machine is on 1.4.3).
- **Config:** the existing `electrobun.config.ts` validates unchanged; added the now-required
  explicit `build.mainProcess: "bun"`, and resolve `package.json` from `import.meta.url`
  (Hutch loads the config from another cwd).
- **API audit:** `BrowserWindow`, `BrowserView.defineRPC`/`Electroview.defineRPC`
  (incl. `maxRequestTime`), `RPCSchema`, `Updater`, `Utils.openFileDialog` are unchanged.
  `Utils.quit` now returns `boolean` and shuts down natively with a 5 s grace period. Window
  events are additive (`will-close`, `blur`, `keyDown`, `keyUp`).
- **Cross-compilation is gone.** Hutch builds for the host only and **silently ignores
  `--targets`** (verified: `--targets=linux-x64` on arm64 produced arm64 artifacts). The release
  workflow becomes one native runner per target; the `build:*:all` scripts are removed.
- **Native externals are not bundled** (`build.bun.external` is passed to the bundler only, in
  1.12.3 and 2.0.6 alike). Dev builds inside the repo find `sharp` by walking up to the repo's
  `node_modules`; a distributed build would not. Pre-existing, but RFD-002's plan to "add
  `onnxruntime-node` to `build.bun.external`" is not sufficient on its own for a shipped app.
- **Updater bridge:** 1.x → 2.x auto-update works only from installed **1.18.1+** (same
  `app.name`, `app.identifier`, `release.baseUrl`; `--env=stable`; publish both `*-update.json`
  and `*-update-v2.json`). We are on 1.12.3, and no release or tag has ever been published.

## Acceptance Criteria

- `bun run typecheck`, `bun run lint`, `bun run test`, `bun run test:e2e` pass.
- `bun run start` launches on each platform we release for, and a full scan → hash →
  detect → review → dry-run apply cycle works on a sample folder.
- The sharp worker still starts in its child process (`{ type: "ready", sharp: true, phash: true }`).
- **Updater:** decide and document one of:
  - a 1.12.3 build auto-updates to the 2.0.6 build (tested end-to-end), or
  - 2.x requires a manual reinstall (documented in the README and release notes).

## Alternatives Considered

- **Stay on 1.x until after the React rewrite.** Rejected: we'd port the new UI across a
  major version later, and debug two sets of changes at once.
- **Track the 2.0.7 betas.** Rejected: no reason to take beta risk for a UI rewrite.
- **Move to Electron or Tauri.** Rejected (see RFD-004): Electron means leaving Bun
  (`bun:sqlite`, Bun workers); Tauri means rewriting `packages/core` in Rust.

## Decision
Pending review.

## Implementation Notes

- Branch: `chore/electrobun-2`. Biome 2.3.14 → 2.5.8 rides in the same branch as its own commit.
- Also add the native modules from RFD-002 to `build.bun.external` when they land
  (`onnxruntime-node`), not in this PR.

## References

- npm: `electrobun` — latest stable 2.0.6
- https://github.com/blackboardsh/electrobun/releases
- https://docs.electrobun.dev/electrobun/guides/migrating-to-v2
- https://docs.electrobun.dev/electrobun/guides/hutch/
- RFD-004 (depends on this RFD)
