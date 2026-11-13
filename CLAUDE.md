# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Giggle Photos App — A local-only, cross-platform desktop application for detecting duplicate and near-duplicate images/videos.

## Tech Stack

| Layer      | Technology                                      |
| ---------- | ----------------------------------------------- |
| Runtime    | Bun (>=1.0.0)                                   |
| Desktop    | Electrobun                                      |
| UI         | React 19 + Tailwind CSS (lucide-react icons)    |
| Database   | SQLite (bun:sqlite) + Kysely ORM                |
| Validation | Zod (schema source of truth)                    |
| Testing    | Bun (unit), Playwright (E2E)                    |
| Tooling    | Biome (lint/format), Turborepo                  |

## Common Commands

```bash
bun install              # Install dependencies
bun run dev              # Dev mode (core logic testing, no window)
bun run start            # Build & launch desktop app

bun run build            # Build all packages
bun run typecheck        # Type-check all packages
bun run lint             # Lint with Biome
bun run format           # Auto-format with Biome

bun run test             # Run unit tests
bun run test:e2e         # Run Playwright E2E tests
bun run test:all         # Run all tests
bun run clean            # Clean build artifacts
```

## Monorepo Structure

```
apps/desktop/           # Electrobun app entry, RPC handlers
  src/bun/              # RPC setup and handlers
  src/views/            # HTML entry points

packages/core/          # Business logic, DB, schemas (no UI deps)
  src/zod/              # Zod schemas (source of truth)
  src/db/               # Kysely client, migrations, providers
  src/scan/             # Filesystem scanning, hashing
  src/config/           # Settings, environment, app paths

packages/ui/            # React UI (RPC-only coupling to core)
  src/app/              # Root: mountApp, screen registry
  src/screens/          # Screens: folders, processing, results, settings
  src/layout/           # AppLayout, Sidebar
  src/external/         # The only hooks allowed to use useEffect (see below)
  src/services/         # RPC client wrappers (with no-RPC fallbacks for E2E)
  src/state/            # Cross-screen stores (navigation, theme, review events)

tests/e2e/              # Playwright and Bun E2E tests
```

## Architecture Principles

**Schema-First Design**: Zod schemas define domain entities → TypeScript types inferred via `z.infer<>` → Kysely types linked to Zod → RPC validation uses Zod.

**Layer Separation**:
- `packages/core/` — Domain logic, DB access, no UI dependencies
- `packages/ui/` — Components, signals, communicates with core only via RPC
- `apps/desktop/` — Orchestration, RPC wiring, Electrobun integration

**Import Aliases**:
```typescript
import { MediaFile } from '@core/zod/file';
import { Button } from '@ui/components/button';
```

## Zod Schema Pattern (Required for All Tables)

Every database table requires 5 schemas. Reference: `packages/core/src/zod/scan-folder.ts`

```typescript
// 1. Domain Model - JS types (Date, boolean)
export const Entity = z.object({ id, ..., createdAt: DateSchema, updatedAt: DateSchema });
export type Entity = z.infer<typeof Entity>;

// 2. Internal helper
const EntityNoId = Entity.omit({ id: true });

// 3. Database Record - SQLite types (integers), with Generated<number> id
export const EntityRecord = EntityNoId.omit({ createdAt: true, updatedAt: true })
  .extend({ createdAt: SQLDate, updatedAt: SQLDate });
export type EntityRecord = z.infer<typeof EntityRecord> & { id: Generated<number> };

// 4. New Record - for inserts (use z.input for defaults)
export const NewEntity = EntityNoId.omit({ createdAt: true, updatedAt: true });
export type NewEntity = z.input<typeof NewEntity>;

// 5. Update Record - partial with required id
export const UpdateEntity = Entity.omit({ createdAt: true, updatedAt: true })
  .partial().required({ id: true });
export type UpdateEntity = z.infer<typeof UpdateEntity>;
```

Type helpers from `util.ts`: `DateSchema`/`SQLDate`, `BooleanSchema`/`SQLBoolean`

## Database Access Pattern

```typescript
import { DatabaseProvider } from "@giggle-photos/core/db/database-provider";
const db = DatabaseProvider.getInstance();
const scanFolders = db.getScanFolderProvider();
```

- Use Kysely only (never raw SQL)
- Always parse Zod before writes
- Access tables through providers only
- Prefer explicit column selects over `selectAll()`

## React UI Patterns (RFD-004)

**No raw `useEffect` / `useLayoutEffect`.** A Biome GritQL plugin (`plugins/no-raw-use-effect.grit`,
scoped in `biome.jsonc`) fails the build on any call in `packages/ui/src`, except the files under
`src/external/` that genuinely sync with something outside React (each excluded with a comment).

| Need | Do this |
|---|---|
| Value derived from props/state | Compute during render (`useMemo` only if measured slow) |
| Respond to a user action | Do it in the event handler |
| Load data over RPC | `useRead(key, read)` from `src/external/use-read.ts` (key it; change the key to re-read) |
| Run an RPC call a person triggers | `useAction(fn)` from `src/external/use-action.ts` |
| Polling / timers / document keys | `useInterval`, `useDocumentKeys` from `src/external/` |
| State shared across screens | A store from `src/external/store.ts` (`createStore` + `useStore`) |
| Reset state when an entity changes | Remount with `key={entityId}` |
| Focus/measure a DOM node | Ref callback |

```tsx
import { useAction } from "../external/use-action";
import { useRead } from "../external/use-read";

export function FolderCount({ version }: { version: number }) {
  const folders = useRead(`folders:${version}`, () => listFolders());
  const rescan = useAction((id: number) => scanFolderQuick(id));
  if (folders.loading) return <span>Loading…</span>;
  return <button type="button" onClick={() => rescan.run(1)}>{folders.value?.length ?? 0} folders</button>;
}
```

`packages/ui/src/lint-gate.test.ts` runs the rule over `lint-fixtures/` so it cannot silently stop
working. Icons: import Lucide components from `lucide-react` directly.

## Code Standards

- **300 line limit** per file
- **No barrel exports**: Use `export { name } from './module'` not `export *`
- **Named exports preferred** (default only when framework requires)
- **Explicit types** for public APIs
- Logger wrapper only (never `console.log`)
- Biome formatting: `bun run format`

## Error Handling

- Throw domain errors (`ScanError`, `HashError`)
- Catch at RPC boundary, return user-friendly messages
- Never swallow errors

## Testing

- Unit tests: Side-by-side (`scanner.test.ts` next to `scanner.ts`)
- E2E tests: `tests/e2e/` directory
- Use in-memory SQLite for DB tests
- Import from `bun:test`: `import { test, expect, describe } from 'bun:test'`
- Run: `bun test`, `bun run test:e2e`

## Git Workflow

**Branching**: Always feature branches, never direct to `main`. Naming: `feat/`, `fix/`, `chore/`

**Commits** (conventional): `feat:`, `fix:`, `refactor:`, `chore:`, `test:`

Small, coherent commits. Squash merge to `main`.

## Performance

- Streaming/iterators for large directories
- Parallel batches for hashing
- Database indexes for frequent queries
- Efficient signal usage in UI

## Related Documentation

| File        | Purpose                               |
| ----------- | ------------------------------------- |
| _FRAGILE.md | Danger zones requiring careful review |

## Critical Code Areas

Before modifying these files, review `_FRAGILE.md`:
- `packages/core/src/actions/applyDecisions.ts` — File deletion (permanent data loss risk)
- `packages/core/src/dates/capture-date-writer.ts` — Writes capture dates into original files, no backup
- `packages/core/src/db/schema.ts` — Database schema (data corruption risk)
- `packages/core/src/db/wrapper.ts` — Database wrapper (validation bypass risk)

## ER Diagram Maintenance

The file `packages/core/er-diagram.html` contains a Mermaid-based entity relationship diagram of the database schema. **Before committing**, if any migration files in `packages/core/src/db/migrations/` have been added or modified, you MUST update the ER diagram in `packages/core/er-diagram.html` to reflect the new or changed tables, columns, constraints, and relationships.

## Icons

Icons are [Lucide](https://lucide.dev) (ISC), imported from `lucide-react`. This is a public repo:
never add commercially licensed assets (e.g. Font Awesome Pro).
