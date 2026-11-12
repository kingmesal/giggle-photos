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

### Hashing — `packages/core/src/scan/hasher.ts`, `grouping.ts`

**Risk**: Wrong duplicates, performance issues, memory exhaustion

**Before touching**:
- Don't change hash algorithms without migration plan
- Test: empty files, corrupted files, very large files
- Verify batch processing doesn't exhaust memory

---

### RPC — `apps/desktop/src/rpc.ts`

**Risk**: Runtime type errors, inconsistent UI state

**Before touching**:
- All methods have Zod validation
- Errors logged but not exposed to users
- UI handles all error states

---

### Scanner — `packages/core/src/scan/scanner.ts`

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
