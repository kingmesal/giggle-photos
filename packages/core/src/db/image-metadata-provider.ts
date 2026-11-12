import { ImageMetadata, ImageMetadataRecord, NewImageMetadata, UpdateImageMetadata } from "../zod/image-metadata";
import type { DatabaseInstance } from "./schema";

/**
 * Image metadata access with Zod validation.
 * All image_metadata table access goes through this provider.
 */
export class ImageMetadataProvider {
  constructor(private db: DatabaseInstance) {}

  /**
   * Insert new image metadata.
   * Always validates with Zod before inserting.
   */
  async insertImageMetadata(data: NewImageMetadata): Promise<ImageMetadata> {
    const validatedInput = NewImageMetadata.parse(data);

    const now = new Date();
    const metadataData = {
      ...validatedInput,
      createdAt: now,
      updatedAt: now,
    };

    const newRecord = ImageMetadataRecord.parse(metadataData);

    const row = await this.db.insertInto("imageMetadata").values(newRecord).returningAll().executeTakeFirst();

    if (!row) {
      throw new Error("Insert did not return a row");
    }

    return ImageMetadata.parse(row);
  }

  /**
   * Insert multiple image metadata records in a batch.
   * More efficient than individual inserts for large scans.
   */
  async insertImageMetadataBatch(records: NewImageMetadata[]): Promise<number> {
    if (records.length === 0) return 0;

    const now = new Date();
    const parsedRecords = records.map((record) => {
      const validated = NewImageMetadata.parse(record);
      return ImageMetadataRecord.parse({
        ...validated,
        createdAt: now,
        updatedAt: now,
      });
    });

    const result = await this.db.insertInto("imageMetadata").values(parsedRecords).execute();
    return result.length;
  }

  /**
   * Get all image metadata records, ordered by id.
   */
  async getAllImageMetadata(): Promise<ImageMetadata[]> {
    const results = await this.db.selectFrom("imageMetadata").selectAll().orderBy("id", "asc").execute();

    return results.map((row) => ImageMetadata.parse(row));
  }

  /**
   * Get image metadata by ID.
   */
  async getImageMetadataById(id: number): Promise<ImageMetadata | null> {
    const row = await this.db.selectFrom("imageMetadata").selectAll().where("id", "=", id).executeTakeFirst();

    if (!row) {
      return null;
    }

    return ImageMetadata.parse(row);
  }

  /**
   * Get image metadata by media file ID.
   * Returns null if no metadata exists for the file.
   */
  async getByMediaFileId(mediaFileId: number): Promise<ImageMetadata | null> {
    const row = await this.db
      .selectFrom("imageMetadata")
      .selectAll()
      .where("mediaFileId", "=", mediaFileId)
      .executeTakeFirst();

    if (!row) {
      return null;
    }

    return ImageMetadata.parse(row);
  }

  /**
   * Get image metadata for multiple media file IDs.
   */
  async getByMediaFileIds(mediaFileIds: number[]): Promise<ImageMetadata[]> {
    if (mediaFileIds.length === 0) return [];

    const results = await this.db
      .selectFrom("imageMetadata")
      .selectAll()
      .where("mediaFileId", "in", mediaFileIds)
      .execute();

    return results.map((row) => ImageMetadata.parse(row));
  }

  /**
   * Get image metadata by format.
   */
  async getByFormat(format: string): Promise<ImageMetadata[]> {
    const results = await this.db
      .selectFrom("imageMetadata")
      .selectAll()
      .where("format", "=", format)
      .orderBy("id", "asc")
      .execute();

    return results.map((row) => ImageMetadata.parse(row));
  }

  /**
   * Get image metadata by dimensions.
   */
  async getByDimensions(width: number, height: number): Promise<ImageMetadata[]> {
    const results = await this.db
      .selectFrom("imageMetadata")
      .selectAll()
      .where("width", "=", width)
      .where("height", "=", height)
      .orderBy("id", "asc")
      .execute();

    return results.map((row) => ImageMetadata.parse(row));
  }

  /**
   * Get image metadata by camera make and model.
   */
  async getByCamera(cameraMake: string, cameraModel?: string): Promise<ImageMetadata[]> {
    let query = this.db.selectFrom("imageMetadata").selectAll().where("cameraMake", "=", cameraMake);

    if (cameraModel !== undefined) {
      query = query.where("cameraModel", "=", cameraModel);
    }

    const results = await query.orderBy("id", "asc").execute();

    return results.map((row) => ImageMetadata.parse(row));
  }

  /**
   * Get images with GPS coordinates.
   */
  async getWithGpsCoordinates(): Promise<ImageMetadata[]> {
    const results = await this.db
      .selectFrom("imageMetadata")
      .selectAll()
      .where("gpsLatitude", "is not", null)
      .where("gpsLongitude", "is not", null)
      .orderBy("id", "asc")
      .execute();

    return results.map((row) => ImageMetadata.parse(row));
  }

  /**
   * Get images with alpha channel.
   */
  async getWithAlpha(): Promise<ImageMetadata[]> {
    const results = await this.db
      .selectFrom("imageMetadata")
      .selectAll()
      .where("hasAlpha", "=", 1)
      .orderBy("id", "asc")
      .execute();

    return results.map((row) => ImageMetadata.parse(row));
  }

  /**
   * Get total count of image metadata records.
   */
  async getTotalCount(): Promise<number> {
    const result = await this.db
      .selectFrom("imageMetadata")
      .select((eb) => eb.fn.count("id").as("count"))
      .executeTakeFirst();

    return result ? Number(result.count) : 0;
  }

  /**
   * Get count by format.
   */
  async getCountByFormat(): Promise<Record<string, number>> {
    const results = await this.db
      .selectFrom("imageMetadata")
      .select(["format"])
      .select((eb) => eb.fn.count("id").as("count"))
      .groupBy("format")
      .execute();

    const counts: Record<string, number> = {};
    for (const row of results) {
      counts[row.format] = Number(row.count);
    }

    return counts;
  }

  /**
   * Throws if no image metadata exists with the given id.
   */
  async verifyRecordExists(id: number): Promise<void> {
    const row = await this.db.selectFrom("imageMetadata").where("id", "=", id).select("id").executeTakeFirst();
    if (!row) {
      throw new Error("No result");
    }
  }

  /**
   * Update image metadata.
   * Only the provided fields are updated. Throws if the record does not exist.
   */
  async updateImageMetadata(data: UpdateImageMetadata): Promise<void> {
    const validated = UpdateImageMetadata.parse(data);
    const { id, ...updateData } = validated;
    await this.verifyRecordExists(id);

    const update = ImageMetadataRecord.partial().parse({ ...updateData, updatedAt: new Date() });
    await this.db.updateTable("imageMetadata").set(update).where("id", "=", id).execute();
  }

  /**
   * Delete image metadata by ID.
   */
  async deleteImageMetadata(id: number): Promise<void> {
    await this.db.deleteFrom("imageMetadata").where("id", "=", id).execute();
  }

  /**
   * Delete image metadata by media file ID.
   */
  async deleteByMediaFileId(mediaFileId: number): Promise<void> {
    await this.db.deleteFrom("imageMetadata").where("mediaFileId", "=", mediaFileId).execute();
  }

  /**
   * Check if metadata exists for a media file.
   */
  async existsForMediaFile(mediaFileId: number): Promise<boolean> {
    const row = await this.db
      .selectFrom("imageMetadata")
      .where("mediaFileId", "=", mediaFileId)
      .select("id")
      .executeTakeFirst();
    return row !== undefined;
  }

  /**
   * Execute a transaction.
   */
  async transaction<T>(callback: (trx: ImageMetadataProvider) => Promise<T>): Promise<T> {
    return await this.db.transaction().execute(async (trx: DatabaseInstance) => {
      return await callback(new ImageMetadataProvider(trx));
    });
  }
}
