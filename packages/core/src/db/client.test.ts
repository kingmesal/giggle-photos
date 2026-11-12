import { Database as SqliteDatabase } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CamelCasePlugin, Kysely } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import { initializeDatabase } from "./client";
import { migrations } from "./migrations";
import type { DatabaseSchema } from "./schema";

/**
 * Test helper to create an in-memory database with CamelCasePlugin enabled
 */
function createTestDb(): { kysely: Kysely<DatabaseSchema>; rawDb: SqliteDatabase } {
  const sqliteDb = new SqliteDatabase(":memory:");
  const kysely = new Kysely<DatabaseSchema>({
    dialect: new BunSqliteDialect({ database: sqliteDb }),
    plugins: [new CamelCasePlugin()],
  });
  return { kysely, rawDb: sqliteDb };
}

describe("Database Client with CamelCasePlugin", () => {
  let db: Kysely<DatabaseSchema>;
  let rawDb: SqliteDatabase;

  beforeEach(() => {
    const dbResult = createTestDb();
    db = dbResult.kysely;
    rawDb = dbResult.rawDb;
  });

  afterEach(() => {
    if (rawDb) rawDb.close();
    db = null as unknown as Kysely<DatabaseSchema>;
  });

  test("initializeSchema creates tables with snake_case columns in database", async () => {
    await initializeDatabase(db, ":memory:");

    // Verify table exists with snake_case columns (plugin converts camelCase to snake_case)
    // Use raw database connection to query pragma (bypasses plugin transformation)
    const tableInfo = rawDb
      .prepare("SELECT name, type FROM pragma_table_info('scan_folders') ORDER BY name")
      .all() as Array<{ name: string; type: string }>;

    // Verify table was created and has columns
    expect(tableInfo.length).toBeGreaterThan(0);

    const columnNames = tableInfo.map((row) => row.name);
    expect(columnNames).toContain("scan_subdirectories");
    expect(columnNames).toContain("image_count");
    expect(columnNames).toContain("video_count");
    expect(columnNames).toContain("total_size");
    expect(columnNames).toContain("created_at");
    expect(columnNames).toContain("updated_at");
  });

  test("initializeSchema works correctly with CamelCasePlugin", async () => {
    // This test validates that initializeSchema successfully creates tables
    // with camelCase names that are converted to snake_case in the database
    await initializeDatabase(db, ":memory:");

    // Verify the table was created by checking raw database
    const tables = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='scan_folders'").all();
    expect(tables.length).toBe(1);
    expect((tables[0] as { name: string }).name).toBe("scan_folders");

    // Verify indexes were created
    const indexes = rawDb
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_scan_folders%'")
      .all();
    expect(indexes.length).toBeGreaterThan(0);
  });

  test("initializeSchema runs migrations and table is queryable", async () => {
    await initializeDatabase(db, ":memory:");

    // Verify table works
    const result = await db.selectFrom("scanFolders").selectAll().execute();
    expect(result).toBeArray();
  });

  test("migrations run once and are recorded in kysely_migration", async () => {
    await initializeDatabase(db, ":memory:");
    const rows = rawDb.prepare("SELECT name FROM kysely_migration ORDER BY name").all() as Array<{ name: string }>;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]?.name).toBe("0001_initial");
  });

  test("all migrations pass and are recorded in kysely_migration", async () => {
    const expectedNames = Object.keys(migrations).sort();
    expect(expectedNames.length).toBeGreaterThan(0);

    await initializeDatabase(db, ":memory:");
    const rows = rawDb.prepare("SELECT name FROM kysely_migration ORDER BY name").all() as Array<{ name: string }>;
    const appliedNames = rows.map((r) => r.name);

    expect(appliedNames).toEqual(expectedNames);
  });

  test("all migration tables exist after migrations", async () => {
    await initializeDatabase(db, ":memory:");
    const tables = rawDb
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'kysely_%' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name);

    const expectedTables = [
      "scan_folders",
      "media_files",
      "image_metadata",
      "video_metadata",
      "file_decisions",
      "phash_matches",
    ];
    for (const name of expectedTables) {
      expect(tableNames).toContain(name);
    }
  });
});
