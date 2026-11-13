# _FRAGILE.md — Danger Zones

Review before modifying any code listed here.

## Critical (Red)

### File Deletion — `packages/core/src/actions/applyDecisions.ts`

**Risk**: Permanent data loss, no undo

**Safety measures implemented**:
- Always verify keepFileId before deletion (never delete the file marked to keep)
- Check file exists on disk before attempting deletion
- Log all operations with timestamps
- Support dryRun=true to verify behavior before actual deletion
- Support moveToTrash option (falls back to permanent delete if trash unavailable)
- Database records removed only after successful file deletion

**Before touching**:
- Test with locked files, read-only dirs, permission errors
- Use transactions for related DB updates
- Verify comprehensive error logging
- Run with dryRun=true first to verify expected behavior

---

### Database Schema — `packages/core/src/db/schema.ts`

**Risk**: Data corruption, silent type mismatches

**Before touching**:
- Ensure Zod schemas match Kysely definitions
- Parse Zod before all writes (missing validation = silent corruption)
- Test migrations with existing data
- Verify indexes exist for frequent queries

---

### Database Wrapper — `packages/core/src/db/wrapper.ts`

**Risk**: Invalid data, bypassed validation

**Before touching**:
- All writes must parse Zod first
- Code cannot bypass wrapper to access tables
- Each table links to its Zod schema

## Moderate (Yellow)

### Hashing / image analysis — `packages/core/src/scan/`

Files: `image-analysis.ts` (read once → SHA-256, EXIF, full decode → contentHash, reduced decode →
pHash), `hash-phash.ts` (in-house DCT pHash + Hamming distance), `byte-budget.ts`,
`sharp-worker.ts` / `sharp-process.ts` (worker process + IPC, `analysis-protocol.ts`),
`hash-unified.ts` + `store-analysis.ts` (analysis stage, persistence, error counts),
`duplicate-detector.ts` (pairwise pHash distances).

**Risk**: Wrong duplicates, silently missed files, memory exhaustion, Chromium crashes

**Before touching**:
- **Hash definitions are data contracts.** `contentHash` = SHA-256 of the *stored* (un-oriented)
  decoded pixels; `perceptualHash` = the documented algorithm in `hash-phash.ts` (16 hex chars)
  on the EXIF-oriented image. Changing either changes every stored value: needs a migration or
  recompute plan, and the golden tests in `hash-phash.test.ts` must be updated deliberately.
- **sharp/libvips never runs in the main process** (GLib races with Chromium). All decoding goes
  through the worker; the worker is bundled by `apps/desktop/scripts/build-worker.ts`.
- **Failures are counted, never skipped**: every read/decode failure becomes a `HashError`
  category in `errorBreakdown` and marks the file `error` (`store-analysis.ts`).
- **Memory**: concurrent decodes are bounded inside the worker by `DECODE_MEMORY_BUDGET_MB`
  (`byte-budget.ts`). Videos are hashed by streaming, never loaded whole.
- Test: empty, truncated, unsupported (e.g. HEIC), 16-bit, alpha, EXIF-rotated, very large files.
- Benchmark before/after with `packages/core/src/bench/` (see RFD-002).

---

### Google Takeout linking — `packages/core/src/takeout/`

**Risk**: A photo loses its album, date or location on import; the wrong copy gets deleted

**Before touching**:
- `sidecar-match.ts` rules run in a fixed order and the duplicate counter must always agree
  (`IMG.jpg` and `IMG(1).jpg` share one title). Add a fixture to `fixtures/synthetic-takeout.ts`
  for every new filename pattern before changing a rule.
- Album membership has two forms (physical album copy; album-only sidecar → `album_reference`);
  preselection must honour both.
- Never move or rename files inside a Takeout tree: immich-go reads the layout as-is.

---

### RPC — `apps/desktop/src/bun/rpc.ts`

**Risk**: Runtime type errors, inconsistent UI state

**Before touching**:
- All methods have Zod validation
- Errors logged but not exposed to users
- UI handles all error states

---

### Scanner — `packages/core/src/scan/file-scanner.ts`

**Risk**: Infinite loops, memory exhaustion, partial failures

**Before touching**:
- Test symlink handling
- Test permission errors, locked files, network drives
- Verify streaming doesn't exhaust memory

## Adding Fragile Areas

When discovering fragile code:

1. Document here with location and risk
2. Add code comment: `// ⚠️ FRAGILE: See _FRAGILE.md`
3. Update before making changes
