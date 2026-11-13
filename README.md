# Giggle Photos

A local-only, cross-platform desktop application for scanning folders, detecting duplicate and near-duplicate images/videos, and preparing assets for import into tools like Immich.

## How this application works

Allow a user to select folders that they want to process.

After a folder is selected, perform a quick scan for how many images and videos are in that folder and get the total sizes.

After the user has selected folders, in the processing screen they must click the process to start.

The first thing to do is to create a table of all the files we are going to process. We want this in our database so we can know how to restart the process and where to pick up from where it left off.

For each folder, create an entry in files table including whether the file is a video or image.

After that table has all the files we can multi-thread work to be done. We should keep track of where we are in each folders process as we should only perform this scanning process once. Only new folders would need to be scanned.

After we get a complete list of all the files into our database, we should move on to metadata extraction. We should store image and video metadata in two separate tables as they have different shapes. This information could be used in determining whether an image is duplicate or which to keep.

After that, for each file, we want to start processing the images. We have a few different ways to differentiate duplicates and we should store these values on the file record:

* first is the simplest, fastest and most accurate. SHA-256 the files. If the 2 files are the same, we have 100% confidence they are duplicates.
* second is a perceptual hash. this library is already installed. we should calculate a phash for every image and store is on the file.
* third is hash of the bytes of the image without any metadata. This is more interesting because sometimes metadata gets changed, causing the images to not hash the same.

Then we need a table to keep track of which images are duplicates and what they are a duplicate of, that is, which image is being kept and via which duplication method was it flagged? ie. was it the sha-256, was it the sha-256 without metadata or was it phash (distance 0, 1, etc..)

We also need to keep track of which images have been marked as NOT duplicates, and which method they were stated as being the same. This way we can simplify the user interface for the user when selecting items to keep or delete.

## How to prompt the application

First line is required. Depending on usage the following lines are added.

Read CLAUDE.md. MEMORY.md. Read _FRAGILE.md. Read _NEXT_SESSION_MEMO.md.
We’re working on RFD_0172.
You’re role/SECURITY.
Your only write permission is to a timestamped SECURITY_REPORT.

## Install

Download the package for your computer from the
[latest release](https://github.com/kingmesal/giggle-photos/releases/latest):

| System | File | How |
|---|---|---|
| macOS (Apple silicon) | `macos-arm64-GigglePhotos.dmg` | Open the DMG and drag Giggle Photos to Applications. The app is not signed yet: the first time, right-click it → **Open** (or run `xattr -dr com.apple.quarantine "/Applications/Giggle Photos.app"`). |
| Windows | `win-x64-GigglePhotos-Setup.zip` | Unzip and run the setup program. Windows SmartScreen warns about an unsigned app: **More info → Run anyway**. |
| Linux (x64 / arm64) | `linux-x64-GigglePhotos-Setup.tar.gz` / `linux-arm64-…` | `tar xzf linux-*-GigglePhotos-Setup.tar.gz` and run `./installer`. Needs WebKitGTK and GTK 3 (`sudo apt install libwebkit2gtk-4.1-0 libgtk-3-0`). |

Intel Macs are not supported: ONNX Runtime, which runs the visual similarity model, no longer
ships an Intel macOS build.

Also install **ffmpeg** (`brew install ffmpeg`, `winget install ffmpeg`, or `sudo apt install
ffmpeg`): it reads video metadata and video frames for visual matching. Everything else works
without it.

Linux and macOS also need `perl` (macOS ships it; on Linux it is usually installed) for writing
capture dates into files with ExifTool.

On first launch the app downloads the visual similarity (CLIP) model (about 335 MB, verified by
its SHA-256). You can keep working while it downloads.

Releases are built by `.github/workflows/release.yml` when a `v*` tag is pushed (draft release;
publish it on GitHub). To build a package yourself: `bun install && bun run build:stable`; the
files land in `apps/desktop/artifacts/`.

## Quick Start

```bash
# Install dependencies
bun install

# Run the application
bun run dev

# Run tests
bun test
```

## Tech Stack

- **Runtime**: Bun
- **Desktop Shell**: Electrobun
- **UI Framework**: Sigment
- **Database**: SQLite + Kysely
- **Validation**: Zod
- **Styling**: Tailwind CSS
- **Testing**: Bun test runner + Playwright
- **Tooling**: Biome, Turborepo

## Project Structure

```
project-root/
  apps/
    desktop/          # Electrobun entrypoint
  packages/
    core/             # Business logic, schemas, database
    ui/               # Sigment UI components
  tests/
    e2e/              # Playwright E2E tests
```

## Getting Started

### Prerequisites

- **Bun** >= 1.0.0 ([Install Bun](https://bun.sh/docs/installation))
- **Linux (system GTK)**: If the desktop app uses system GTK (`bundleCEF: false` in `apps/desktop/electrobun.config.ts`), install GTK and WebKitGTK, e.g. on Debian/Ubuntu: `sudo apt install libgtk-3-0 libwebkit2gtk-4.1-0`. A `Gdk-CRITICAL **: gdk_device_get_state` message may appear (harmless GTK bug); running with X11 (`bun run dev:x11` in `apps/desktop`) sometimes helps. For a quiet console, set `bundleCEF: true` in `electrobun.config.ts` to use bundled CEF.

### Installation

```bash
# Install all dependencies
bun install
```

### Running the Application

```bash
# Start with full Electrobun window (builds and launches desktop app)
bun run start

# Start in dev mode (no window, for testing core logic without GUI)
bun run dev

# Or run dev directly from the desktop app
cd apps/desktop && bun run dev
```

**Note:** `bun run start` uses Electrobun's build system which will automatically download required binaries on first run (it checks if they exist and won't re-download). The app will build and launch a desktop window. Use `bun run dev` for a simpler development mode without the desktop window.

**Electrobun 2.x / Hutch:** Electrobun 2.x ships its SDK through the Hutch toolchain, not
`node_modules`. The `electrobun` npm package is only a bootstrap: on first use it downloads
Hutch (verified by SHA-256) into `~/.hutch` and projects the SDK into
`apps/desktop/.hutch/devkit` (generated, gitignored). Versions are pinned exactly in
`hutch.config.ts`. `bun run typecheck` runs `electrobun prepare` first, so a fresh clone
needs network access once. Code that imports `electrobun/bun` or `electrobun/view` only runs
inside an Electrobun build; plain `bun run` resolves those imports to a stub that throws.

**Release builds are host-only:** Electrobun 2.x cannot cross-compile, and it silently
ignores `--targets`. Build each platform on that platform (CI uses one native runner per
target, see `.github/workflows/release.yml`).

The application will:
- Load environment variables from `.env` (if present)
- Initialize the UI
- Display startup logs
- Run continuously until receiving a shutdown signal (SIGTERM, SIGINT, or SIGHUP)
- Shut down gracefully, cleaning up all resources

### Running Tests

```bash
# Run all unit/integration tests (Bun test runner)
bun test

# Run E2E tests (Playwright)
bun run test:e2e

# Run tests for a specific package
cd apps/desktop && bun test
cd packages/core && bun test
cd packages/ui && bun test
```

**Test Structure:**
- Unit/integration tests: `*.test.ts` files live side-by-side with source files
- E2E tests: `*.test.ts` files in `tests/e2e/` directory (Bun test runner for app lifecycle)
- Playwright E2E tests: `*.spec.ts` files in `tests/e2e/` directory (for future web UI testing)

### Development Commands

```bash
# Lint code
bun run lint

# Format code
bun run format

# Check formatting without changes
bun run format:check

# Build all packages
bun run build

# Type check all packages
bun run typecheck
```

## Documentation

This project uses a layered documentation system for agent collaboration:

- **[CLAUDE.md](./CLAUDE.md)** — Project overview, architecture and code standards
- **[_FRAGILE.md](./_FRAGILE.md)** — Danger zones (read before touching fragile code)
- **[rfds/](./rfds/)** — Request for Discussion documents (major technical decisions)

## License

[MIT](./LICENSE). Icons are [Lucide](https://lucide.dev) (ISC).
