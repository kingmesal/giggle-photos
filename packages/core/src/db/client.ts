import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { Database as SqliteDatabase } from "bun:sqlite";
import { CamelCasePlugin, Kysely, Migrator } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import { getDefaultDatabasePath } from "../config/app-paths";
import { env } from "../config/env";
import { ensureAppDataDir } from "../config/user-config";
import { getLogger } from "../logging/logger";
import { DatabaseProvider } from "./database-provider";
import { migrations } from "./migrations";
import type { DatabaseInstance, DatabaseSchema } from "./schema";

const log = getLogger("core:db");

/**
 * True if the error is a Kysely migration lock conflict (kysely_migration_lock table).
 */
function isMigrationLockError(err: unknown): boolean {
  if (err == null || typeof err !== "object") return false;
  const o = err as { code?: string; message?: string; errno?: number };
  const code = o.code;
  const message = String(o.message ?? "");
  const errno = o.errno;
  const isLockTable = message.includes("kysely_migration_lock");
  const isPkConflict = code === "SQLITE_CONSTRAINT_PRIMARYKEY" || errno === 1555;
  const isUniqueConflict = message.includes("UNIQUE constraint failed") && isLockTable;
  return isLockTable && (isPkConflict || isUniqueConflict);
}

/** Log a migration error with message and stack so it appears in logs (Error objects often serialize as {}). */
function logMigrationError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  log.error("Migrations failed", { message, stack });
}

/**
 * Run database migrations (TypeScript files in db/migrations/ with up/down).
 * Exported for testing.
 */
export async function initializeDatabase(db: Kysely<DatabaseSchema>, dbPath: string): Promise<void> {
  const migrationNames = Object.keys(migrations);
  if (migrationNames.length === 0) {
    log.error("No migrations loaded; migration bundle may be incomplete.");
    throw new Error("No migrations loaded. Database cannot be initialized.");
  }
  log.info("Opening and validating database.", { path: dbPath, migrationCount: migrationNames.length });

  const migrator = new Migrator({
    db,
    provider: { getMigrations: () => Promise.resolve(migrations) },
  });

  try {
    const { error, results } = await migrator.migrateToLatest();
    const applied = results?.filter((it) => it.status === "Success") ?? [];
    const failed = results?.filter((it) => it.status === "Error") ?? [];
    const skipped = results?.filter((it) => it.status === "NotExecuted") ?? [];
    for (const it of failed) log.error(`Migration failed: ${it.migrationName}`);
    for (const it of applied) log.info(`Migration applied: ${it.migrationName}`);
    for (const it of skipped) log.debug(`Migration skipped: ${it.migrationName}`);

    if (error) {
      if (isMigrationLockError(error)) {
        logMigrationError(error);
        throw new Error(
          "Migration lock error (kysely_migration_lock). Run migrations with a Kysely instance that does not use CamelCasePlugin so the lock table is queried with standard names.",
        );
      }
      logMigrationError(error);
      throw error;
    }

    if (applied.length > 0) {
      log.info("Database migrations complete.", {
        applied: applied.length,
        names: applied.map((r) => r.migrationName),
      });
    } else {
      log.info("Database ready (migrations already up to date).");
    }
  } catch (err) {
    if (isMigrationLockError(err)) {
      logMigrationError(err);
      throw new Error(
        "Migration lock error (kysely_migration_lock). Run migrations with a Kysely instance that does not use CamelCasePlugin so the lock table is queried with standard names.",
      );
    }
    logMigrationError(err);
    throw err;
  }
}

/**
 * Create a Kysely instance with BunSqliteDialect.
 */
function createKyselyInstance(dbPath: string): { db: Kysely<DatabaseSchema>; sqlite: SqliteDatabase } {
  const sqlite = new SqliteDatabase(dbPath);
  // Enable foreign key enforcement — required for ON DELETE CASCADE to work.
  // SQLite disables foreign keys by default; must be enabled per connection.
  sqlite.run("PRAGMA foreign_keys = ON");
  const db = new Kysely<DatabaseSchema>({
    dialect: new BunSqliteDialect({ database: sqlite }),
    plugins: [new CamelCasePlugin()],
  });
  return { db, sqlite };
}

/**
 * Run migrations using a Kysely instance with CamelCasePlugin, then close the connection.
 */
async function runMigrations(dbPath: string): Promise<void> {
  const { db, sqlite } = createKyselyInstance(dbPath);
  try {
    await initializeDatabase(db, dbPath);
  } finally {
    sqlite.close();
  }
}

/**
 * Manages the SQLite/Kysely connection and migrations.
 * Created and held by DatabaseProvider; get a handle via DatabaseProvider.getInstance().getClient().
 */
export class DatabaseClient {
  private db: DatabaseInstance | null = null;
  private sqlite: SqliteDatabase | null = null;

  /**
   * Open the database connection and run migrations. Idempotent.
   */
  async open(): Promise<DatabaseInstance> {
    if (this.db) {
      return this.db;
    }

    ensureAppDataDir();
    const dbPath = env.DATABASE_PATH || getDefaultDatabasePath();
    const dbDir = path.dirname(dbPath);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    await runMigrations(dbPath);

    const { db, sqlite } = createKyselyInstance(dbPath);
    this.db = db;
    this.sqlite = sqlite;
    return this.db;
  }

  /**
   * Return the open Kysely instance. Throws if not open.
   */
  getDb(): DatabaseInstance {
    if (!this.db) {
      throw new Error("Database not open; call open() first");
    }
    return this.db;
  }

  /**
   * Drop all tables (except sqlite_*), close the connection, clear provider cache.
   * Next DatabaseProvider.getInstance() will create a new client and open it.
   */
  async resetDatabase(): Promise<void> {
    const db = this.getDb();

    const tables = await db.introspection.getTables();
    for (const table of tables) {
      if (table.name.startsWith("sqlite_")) {
        continue;
      }
      await db.schema.dropTable(table.name).ifExists().execute();
    }
    // Use raw SQL to drop Kysely's internal tables
    this.sqlite?.run("DROP TABLE IF EXISTS kysely_migration");
    this.sqlite?.run("DROP TABLE IF EXISTS kysely_migration_lock");

    this.close();
    // Next getInstance() + open() will re-open and run migrations
  }

  /**
   * Close the connection and clear provider cache. Idempotent.
   */
  close(): void {
    if (this.db) {
      this.sqlite?.close();
      this.sqlite = null;
      DatabaseProvider.clearInstance();
      this.db = null;
      log.debug("Database connection closed");
    }
  }
}
