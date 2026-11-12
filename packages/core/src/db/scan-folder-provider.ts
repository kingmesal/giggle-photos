import { NewScanFolder, ScanFolder, ScanFolderRecord, UpdateScanFolder } from "../zod/scan-folder";
import type { DatabaseInstance } from "./schema";

/**
 * Scan folder access with Zod validation.
 * All scan folder table access goes through this provider.
 */
export class ScanFolderProvider {
  constructor(private db: DatabaseInstance) {}

  /**
   * Insert a new scan folder
   * Always validates with Zod before inserting
   */
  async insertScanFolder(data: NewScanFolder): Promise<ScanFolder> {
    const validatedInput = NewScanFolder.parse(data);

    const now = new Date();
    const folderData = {
      ...validatedInput,
      createdAt: now,
      updatedAt: now,
    };

    const newRecord = ScanFolderRecord.parse(folderData);

    const row = await this.db.insertInto("scanFolders").values(newRecord).returningAll().executeTakeFirst();

    if (!row) {
      throw new Error("Insert did not return a row");
    }

    return ScanFolder.parse(row);
  }

  /**
   * Get all scan folders, ordered by priority (ascending, so 1 = highest priority first)
   */
  async getAllScanFolders(): Promise<ScanFolder[]> {
    const results = await this.db
      .selectFrom("scanFolders")
      .selectAll()
      .orderBy("priority", "asc")
      .orderBy("createdAt", "asc")
      .execute();

    return results.map((row) => ScanFolder.parse(row));
  }

  /**
   * Get a scan folder by ID
   */
  async getScanFolderById(id: number): Promise<ScanFolder | null> {
    const row = await this.db.selectFrom("scanFolders").selectAll().where("id", "=", id).executeTakeFirst();

    if (!row) {
      return null;
    }

    return ScanFolder.parse(row);
  }

  /**
   * Throws if no scan folder exists with the given id.
   */
  async verifyRecordExists(id: number): Promise<void> {
    const row = await this.db.selectFrom("scanFolders").where("id", "=", id).select("id").executeTakeFirst();
    if (!row) {
      throw new Error("No result");
    }
  }

  /**
   * Get a scan folder by path
   */
  async getScanFolderByPath(path: string): Promise<ScanFolder | null> {
    const result = await this.db.selectFrom("scanFolders").selectAll().where("path", "=", path).executeTakeFirst();

    if (!result) {
      return null;
    }

    return ScanFolder.parse(result);
  }

  /**
   * Update a scan folder
   * Only the provided fields are updated. Throws if the folder does not exist.
   */
  async updateScanFolder(data: UpdateScanFolder): Promise<void> {
    const validated = UpdateScanFolder.parse(data);
    const { id, ...updateData } = validated;
    await this.verifyRecordExists(id);

    // Only include keys explicitly provided in the input (plus updatedAt).
    // Zod .partial() on fields with .default() injects default values for absent keys,
    // which would overwrite existing DB values (e.g. imageCount: 0 overwrites real counts).
    const providedKeys = new Set(Object.keys(data).filter((k) => k !== "id"));
    const fullUpdate = ScanFolderRecord.partial().parse({ ...updateData, updatedAt: new Date() });
    const update: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fullUpdate)) {
      if (providedKeys.has(key) || key === "updatedAt") {
        update[key] = value;
      }
    }

    await this.db.updateTable("scanFolders").set(update).where("id", "=", id).execute();
  }

  /**
   * Delete a scan folder by ID
   */
  async deleteScanFolder(id: number): Promise<void> {
    await this.db.deleteFrom("scanFolders").where("id", "=", id).execute();
  }

  /**
   * Execute a transaction
   */
  async transaction<T>(callback: (trx: ScanFolderProvider) => Promise<T>): Promise<T> {
    return await this.db.transaction().execute(async (trx: DatabaseInstance) => {
      return await callback(new ScanFolderProvider(trx));
    });
  }
}
