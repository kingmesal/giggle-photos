import { NewVideoMetadata, UpdateVideoMetadata, VideoMetadata, VideoMetadataRecord } from "../zod/video-metadata";
import type { DatabaseInstance } from "./schema";

/**
 * Video metadata access with Zod validation.
 * All video_metadata table access goes through this provider.
 */
export class VideoMetadataProvider {
  constructor(private db: DatabaseInstance) {}

  /**
   * Insert new video metadata.
   * Always validates with Zod before inserting.
   */
  async insertVideoMetadata(data: NewVideoMetadata): Promise<VideoMetadata> {
    const validatedInput = NewVideoMetadata.parse(data);

    const now = new Date();
    const metadataData = {
      ...validatedInput,
      createdAt: now,
      updatedAt: now,
    };

    const newRecord = VideoMetadataRecord.parse(metadataData);

    const row = await this.db.insertInto("videoMetadata").values(newRecord).returningAll().executeTakeFirst();

    if (!row) {
      throw new Error("Insert did not return a row");
    }

    return VideoMetadata.parse(row);
  }

  /**
   * Get all video metadata records.
   */
  async getAllVideoMetadata(): Promise<VideoMetadata[]> {
    const results = await this.db.selectFrom("videoMetadata").selectAll().orderBy("id", "asc").execute();

    return results.map((row) => VideoMetadata.parse(row));
  }

  /**
   * Get video metadata by ID.
   */
  async getVideoMetadataById(id: number): Promise<VideoMetadata | null> {
    const row = await this.db.selectFrom("videoMetadata").selectAll().where("id", "=", id).executeTakeFirst();

    if (!row) {
      return null;
    }

    return VideoMetadata.parse(row);
  }

  /**
   * Get video metadata for multiple media file IDs.
   */
  async getVideoMetadataByMediaFileIds(mediaFileIds: number[]): Promise<VideoMetadata[]> {
    if (mediaFileIds.length === 0) return [];

    const results = await this.db
      .selectFrom("videoMetadata")
      .selectAll()
      .where("mediaFileId", "in", mediaFileIds)
      .execute();

    return results.map((row) => VideoMetadata.parse(row));
  }

  /**
   * Get video metadata by media file ID.
   */
  async getVideoMetadataByMediaFileId(mediaFileId: number): Promise<VideoMetadata | null> {
    const row = await this.db
      .selectFrom("videoMetadata")
      .selectAll()
      .where("mediaFileId", "=", mediaFileId)
      .executeTakeFirst();

    if (!row) {
      return null;
    }

    return VideoMetadata.parse(row);
  }

  /**
   * Check if video metadata exists for a media file.
   */
  async hasMetadataForMediaFile(mediaFileId: number): Promise<boolean> {
    const row = await this.db
      .selectFrom("videoMetadata")
      .where("mediaFileId", "=", mediaFileId)
      .select("id")
      .executeTakeFirst();
    return row !== undefined;
  }

  /**
   * Get total count of video metadata records.
   */
  async getTotalCount(): Promise<number> {
    const result = await this.db
      .selectFrom("videoMetadata")
      .select((eb) => eb.fn.count("id").as("count"))
      .executeTakeFirst();

    return result ? Number(result.count) : 0;
  }

  /**
   * Throws if no video metadata exists with the given id.
   */
  async verifyRecordExists(id: number): Promise<void> {
    const row = await this.db.selectFrom("videoMetadata").where("id", "=", id).select("id").executeTakeFirst();
    if (!row) {
      throw new Error("No result");
    }
  }

  /**
   * Update video metadata.
   * Only the provided fields are updated. Throws if the metadata does not exist.
   */
  async updateVideoMetadata(data: UpdateVideoMetadata): Promise<void> {
    const validated = UpdateVideoMetadata.parse(data);
    const { id, ...updateData } = validated;
    await this.verifyRecordExists(id);

    const update = VideoMetadataRecord.partial().parse({ ...updateData, updatedAt: new Date() });
    await this.db.updateTable("videoMetadata").set(update).where("id", "=", id).execute();
  }

  /**
   * Delete video metadata by ID.
   */
  async deleteVideoMetadata(id: number): Promise<void> {
    await this.db.deleteFrom("videoMetadata").where("id", "=", id).execute();
  }

  /**
   * Delete video metadata by media file ID.
   */
  async deleteByMediaFileId(mediaFileId: number): Promise<void> {
    await this.db.deleteFrom("videoMetadata").where("mediaFileId", "=", mediaFileId).execute();
  }

  /**
   * Execute a transaction.
   */
  async transaction<T>(callback: (trx: VideoMetadataProvider) => Promise<T>): Promise<T> {
    return await this.db.transaction().execute(async (trx: DatabaseInstance) => {
      return await callback(new VideoMetadataProvider(trx));
    });
  }
}
