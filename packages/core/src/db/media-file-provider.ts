import type { FileStatus, FileType } from "../zod/media-file";
import { MediaFile, MediaFileRecord, NewMediaFile, UpdateMediaFile } from "../zod/media-file";
import type { DatabaseInstance } from "./schema";

/**
 * Media file access with Zod validation.
 * All media_files table access goes through this provider.
 */
export class MediaFileProvider {
  constructor(private db: DatabaseInstance) {}

  /**
   * Insert a new media file.
   * Always validates with Zod before inserting.
   */
  async insertMediaFile(data: NewMediaFile): Promise<MediaFile> {
    const validatedInput = NewMediaFile.parse(data);

    const now = new Date();
    const fileData = {
      ...validatedInput,
      createdAt: now,
      updatedAt: now,
    };

    const newRecord = MediaFileRecord.parse(fileData);

    const row = await this.db.insertInto("mediaFiles").values(newRecord).returningAll().executeTakeFirst();

    if (!row) {
      throw new Error("Insert did not return a row");
    }

    return MediaFile.parse(row);
  }

  /**
   * Insert multiple media files in a batch.
   * More efficient than individual inserts for large scans.
   */
  async insertMediaFiles(files: NewMediaFile[]): Promise<number> {
    if (files.length === 0) return 0;

    const now = new Date();
    const records = files.map((file) => {
      const validated = NewMediaFile.parse(file);
      return MediaFileRecord.parse({
        ...validated,
        createdAt: now,
        updatedAt: now,
      });
    });

    const result = await this.db.insertInto("mediaFiles").values(records).execute();
    return result.length;
  }

  /**
   * Get all media files, ordered by path.
   */
  async getAllMediaFiles(): Promise<MediaFile[]> {
    const results = await this.db.selectFrom("mediaFiles").selectAll().orderBy("path", "asc").execute();

    return results.map((row) => MediaFile.parse(row));
  }

  /**
   * Get multiple media files by their IDs.
   */
  async getMediaFilesByIds(ids: number[]): Promise<MediaFile[]> {
    if (ids.length === 0) return [];

    const results = await this.db.selectFrom("mediaFiles").selectAll().where("id", "in", ids).execute();

    return results.map((row) => MediaFile.parse(row));
  }

  /**
   * Get a media file by ID.
   */
  async getMediaFileById(id: number): Promise<MediaFile | null> {
    const row = await this.db.selectFrom("mediaFiles").selectAll().where("id", "=", id).executeTakeFirst();

    if (!row) {
      return null;
    }

    return MediaFile.parse(row);
  }

  /**
   * Get a media file by path.
   */
  async getMediaFileByPath(path: string): Promise<MediaFile | null> {
    const row = await this.db.selectFrom("mediaFiles").selectAll().where("path", "=", path).executeTakeFirst();

    if (!row) {
      return null;
    }

    return MediaFile.parse(row);
  }

  /**
   * Get all media files for a specific scan folder.
   */
  async getMediaFilesByFolderId(scanFolderId: number): Promise<MediaFile[]> {
    const results = await this.db
      .selectFrom("mediaFiles")
      .selectAll()
      .where("scanFolderId", "=", scanFolderId)
      .orderBy("path", "asc")
      .execute();

    return results.map((row) => MediaFile.parse(row));
  }

  /**
   * Get media files by status (for batch processing).
   */
  async getMediaFilesByStatus(status: FileStatus, limit?: number): Promise<MediaFile[]> {
    let query = this.db.selectFrom("mediaFiles").selectAll().where("status", "=", status).orderBy("id", "asc");

    if (limit !== undefined) {
      query = query.limit(limit);
    }

    const results = await query.execute();
    return results.map((row) => MediaFile.parse(row));
  }

  /**
   * Get media files by type and status (e.g., pending images).
   */
  async getMediaFilesByTypeAndStatus(fileType: FileType, status: FileStatus, limit?: number): Promise<MediaFile[]> {
    let query = this.db
      .selectFrom("mediaFiles")
      .selectAll()
      .where("fileType", "=", fileType)
      .where("status", "=", status)
      .orderBy("id", "asc");

    if (limit !== undefined) {
      query = query.limit(limit);
    }

    const results = await query.execute();
    return results.map((row) => MediaFile.parse(row));
  }

  /**
   * Get files ready for the analysis (hashing) stage. Ordered by id for deterministic processing.
   * - Images: status 'pending' — the single-pass worker extracts metadata and hashes together
   *   (RFD-002). 'metadata' is also accepted for databases from before that change.
   * - Videos: status 'metadata' — video metadata (ffprobe) is still its own stage.
   */
  async getFilesNeedingHashing(limit?: number): Promise<MediaFile[]> {
    let images = this.db
      .selectFrom("mediaFiles")
      .selectAll()
      .where("fileType", "=", "image")
      .where("status", "in", ["pending", "metadata"])
      .orderBy("id", "asc");
    let videos = this.db
      .selectFrom("mediaFiles")
      .selectAll()
      .where("fileType", "=", "video")
      .where("status", "=", "metadata")
      .orderBy("id", "asc");
    if (limit !== undefined) {
      images = images.limit(limit);
      videos = videos.limit(limit);
    }

    const [imageRows, videoRows] = await Promise.all([images.execute(), videos.execute()]);
    const merged = [...imageRows, ...videoRows].sort((a, b) => Number(a.id) - Number(b.id));
    return (limit === undefined ? merged : merged.slice(0, limit)).map((row) => MediaFile.parse(row));
  }

  /**
   * Find files with matching SHA-256 hash (exact duplicates).
   */
  async findBySha256Hash(hash: string): Promise<MediaFile[]> {
    const results = await this.db
      .selectFrom("mediaFiles")
      .selectAll()
      .where("sha256Hash", "=", hash)
      .orderBy("id", "asc")
      .execute();

    return results.map((row) => MediaFile.parse(row));
  }

  /**
   * Find files with matching content hash.
   */
  async findByContentHash(hash: string): Promise<MediaFile[]> {
    const results = await this.db
      .selectFrom("mediaFiles")
      .selectAll()
      .where("contentHash", "=", hash)
      .orderBy("id", "asc")
      .execute();

    return results.map((row) => MediaFile.parse(row));
  }

  /**
   * Get count of files by status.
   */
  async getCountByStatus(): Promise<Record<FileStatus, number>> {
    const results = await this.db
      .selectFrom("mediaFiles")
      .select(["status"])
      .select((eb) => eb.fn.count("id").as("count"))
      .groupBy("status")
      .execute();

    const counts: Record<FileStatus, number> = {
      pending: 0,
      metadata: 0,
      hashed: 0,
      processed: 0,
      error: 0,
    };

    for (const row of results) {
      counts[row.status as FileStatus] = Number(row.count);
    }

    return counts;
  }

  /**
   * Get total count of media files.
   */
  async getTotalCount(): Promise<number> {
    const result = await this.db
      .selectFrom("mediaFiles")
      .select((eb) => eb.fn.count("id").as("count"))
      .executeTakeFirst();

    return result ? Number(result.count) : 0;
  }

  /**
   * Throws if no media file exists with the given id.
   */
  async verifyRecordExists(id: number): Promise<void> {
    const row = await this.db.selectFrom("mediaFiles").where("id", "=", id).select("id").executeTakeFirst();
    if (!row) {
      throw new Error("No result");
    }
  }

  /**
   * Update a media file.
   * Only the provided fields are updated. Throws if the file does not exist.
   */
  async updateMediaFile(data: UpdateMediaFile): Promise<void> {
    const validated = UpdateMediaFile.parse(data);
    const { id } = validated;
    await this.verifyRecordExists(id);

    // Determine which fields were explicitly provided (not filled by Zod defaults).
    // MediaFileRecord.partial().parse() applies .default(null) to nullable fields,
    // which would overwrite existing DB values. Only include fields from the original input.
    const explicitKeys = new Set(Object.keys(data));
    explicitKeys.delete("id");

    const fullUpdate = MediaFileRecord.partial().parse({ ...validated, updatedAt: new Date() });

    const update: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fullUpdate)) {
      if (key === "updatedAt" || explicitKeys.has(key)) {
        update[key] = value;
      }
    }

    await this.db.updateTable("mediaFiles").set(update).where("id", "=", id).execute();
  }

  /**
   * Batch update status for multiple files.
   */
  async updateStatusBatch(ids: number[], status: FileStatus): Promise<void> {
    if (ids.length === 0) return;

    // Only set the explicitly provided fields (status + updatedAt).
    // Do NOT use MediaFileRecord.partial().parse() on the full record,
    // as Zod defaults would overwrite hash columns with null.
    const now = Date.now();
    await this.db.updateTable("mediaFiles").set({ status, updatedAt: now }).where("id", "in", ids).execute();
  }

  /**
   * Delete a media file by ID.
   */
  async deleteMediaFile(id: number): Promise<void> {
    await this.db.deleteFrom("mediaFiles").where("id", "=", id).execute();
  }

  /**
   * Delete all video media files for a scan folder.
   * Cascades handle related records (fileDecisions, phashMatches, etc.).
   */
  async deleteVideosByFolderId(scanFolderId: number): Promise<number> {
    const result = await this.db
      .deleteFrom("mediaFiles")
      .where("scanFolderId", "=", scanFolderId)
      .where("fileType", "=", "video")
      .execute();
    return result.length;
  }

  /**
   * Delete all media files for a scan folder.
   */
  async deleteByFolderId(scanFolderId: number): Promise<number> {
    const result = await this.db.deleteFrom("mediaFiles").where("scanFolderId", "=", scanFolderId).execute();
    return result.length;
  }

  /**
   * Check if a file path already exists in the database.
   */
  async pathExists(path: string): Promise<boolean> {
    const row = await this.db.selectFrom("mediaFiles").where("path", "=", path).select("id").executeTakeFirst();
    return row !== undefined;
  }

  /**
   * Execute a transaction.
   */
  async transaction<T>(callback: (trx: MediaFileProvider) => Promise<T>): Promise<T> {
    return await this.db.transaction().execute(async (trx: DatabaseInstance) => {
      return await callback(new MediaFileProvider(trx));
    });
  }
}
