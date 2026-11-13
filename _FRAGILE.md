# _FRAGILE.md — Danger Zones

Review before modifying any code listed here.

## Critical (Red)

### File Deletion — `packages/core/src/actions/`

Files: `applyDecisions.ts` (orchestrates), `deletion-plan.ts` (pure safety rules),
`plan-loader.ts` (loads decisions, current group members, pairs, sidecars), `quarantine.ts`,
`file-removal.ts` (trash / permanent delete). Preselection: `review/preselect.ts`.

**Risk**: Permanent data loss; photos losing their album or JSON on import

**Safety measures implemented** (each has a test in `deletion-plan.test.ts` /
`applyDecisions.test.ts`):
- A file is removed only with a delete decision and no keep decision in any group
- Never the last copy: every group keeps at least one survivor (also across motion pairs: a
  partner that is the last copy of its own content is spared, and so is its still)
- Motion pairs move together; if the partner is kept, neither is removed (never split a pair)
- A file's own sidecars go with it, unless a remaining edited copy / motion video inherits them
- Files missing on disk are skipped, never "removed"
- Dry run returns the full plan (what, how, and every refusal with its reason); the UI shows it
  before the confirm button is enabled
- Quarantine (default) moves files to `<quarantine>/<path below the scan folder>`, never
  overwrites, logs to `quarantine-manifest.jsonl`; `restoreQuarantine` undoes it
- Database records removed only after the file was removed

**Before touching**:
- Add a test for any rule you change, in the pure planner first
- Test with read-only folders, missing files, cross-device moves
- Run with dryRun=true first to verify expected behavior

---

### Database Schema — `packages/core/src/db/schema.ts`

**Risk**: Data corruption, silent type mismatches

**Before touching**:
- Ensure Zod schemas match Kysely definitions
- Parse Zod before all writes (missing validation = silent corruption)
- Test migrations with existing data
- Verify indexes exist for frequent queries
- SQLite cannot alter a CHECK constraint: widening one means a table rebuild (copy rows, drop,
  rename, recreate indexes), as `migrations/0010_decision_method_clip.ts` does for `fileDecisions`.
  Test it on rows written by the previous migration (see its test).

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

### CLIP — `packages/core/src/clip/`

**Risk**: Wrong near-duplicate candidates, a tampered or wrong model, runaway CPU

**Before touching**:
- `model-manifest.ts` pins revision + SHA-256; never point it at `main`. A model change needs a new
  `id` (embeddings are keyed by it) and threshold re-calibration.
- Embeddings are L2-normalised; `match.ts` relies on dot product = cosine similarity, and on TopK
  output being sorted. CLIP pairs are review-only, never preselected for deletion.
- Review groups (`review/clip-groups.ts`) skip pairs already grouped by SHA-256, content hash or
  pHash. The deletion planner treats a `clip:` group as only its decided files, which keeps
  "never the last copy" stricter, not looser.
- Keep ONNX intra-op threads bounded (default 4): "all cores" spins and costs ~10× CPU.
- Real-model tests need `GIGGLE_TEST_CLIP_MODEL=/path/to/model.onnx`; run them after changes here.

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
