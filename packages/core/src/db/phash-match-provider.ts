import { NewPhashMatch, PhashMatch, PhashMatchRecord, UpdatePhashMatch } from "../zod/phash-match";
import type { DatabaseInstance } from "./schema";

/**
 * PhashMatch provider with Zod validation.
 * All phash_matches table access goes through this provider.
 */
export class PhashMatchProvider {
  constructor(private db: DatabaseInstance) {}

  /**
   * Insert a single pHash match.
   * Always validates with Zod before inserting.
   * Normalizes ordering so mediaFileId1 < mediaFileId2.
   */
  async insertPhashMatch(data: NewPhashMatch): Promise<PhashMatch> {
    const validatedInput = NewPhashMatch.parse(data);

    // Normalize ordering: mediaFileId1 < mediaFileId2
    const normalized = {
      mediaFileId1: Math.min(validatedInput.mediaFileId1, validatedInput.mediaFileId2),
      mediaFileId2: Math.max(validatedInput.mediaFileId1, validatedInput.mediaFileId2),
      distance: validatedInput.distance,
    };

    const now = new Date();
    const matchData = {
      ...normalized,
      createdAt: now,
    };

    const newRecord = PhashMatchRecord.parse(matchData);

    const row = await this.db.insertInto("phashMatches").values(newRecord).returningAll().executeTakeFirst();

    if (!row) {
      throw new Error("Insert did not return a row");
    }

    return PhashMatch.parse(row);
  }

  /**
   * Batch insert multiple pHash matches.
   * Normalizes ordering and validates each match.
   * Returns the number of rows inserted.
   */
  async insertPhashMatches(matches: NewPhashMatch[]): Promise<number> {
    if (matches.length === 0) {
      return 0;
    }

    const now = new Date();
    const records = matches.map((data) => {
      const validated = NewPhashMatch.parse(data);
      const normalized = {
        mediaFileId1: Math.min(validated.mediaFileId1, validated.mediaFileId2),
        mediaFileId2: Math.max(validated.mediaFileId1, validated.mediaFileId2),
        distance: validated.distance,
      };
      return PhashMatchRecord.parse({ ...normalized, createdAt: now });
    });

    await this.db.insertInto("phashMatches").values(records).execute();

    return records.length;
  }

  /**
   * Get all matches involving a specific media file (either position).
   */
  async getMatchesForFile(mediaFileId: number): Promise<PhashMatch[]> {
    const results = await this.db
      .selectFrom("phashMatches")
      .selectAll()
      .where((eb) => eb.or([eb("mediaFileId1", "=", mediaFileId), eb("mediaFileId2", "=", mediaFileId)]))
      .orderBy("distance", "asc")
      .execute();

    return results.map((row) => PhashMatch.parse(row));
  }

  /**
   * Get all matches with distance ≤ threshold.
   */
  async getMatchesByThreshold(threshold: number): Promise<PhashMatch[]> {
    const results = await this.db
      .selectFrom("phashMatches")
      .selectAll()
      .where("distance", "<=", threshold)
      .orderBy("distance", "asc")
      .execute();

    return results.map((row) => PhashMatch.parse(row));
  }

  /**
   * Get all matches involving any of the given file IDs, with distance ≤ threshold.
   * Single query replaces N individual getMatchesForFile() calls.
   */
  async getMatchesForFileIds(fileIds: number[], threshold: number): Promise<PhashMatch[]> {
    if (fileIds.length === 0) return [];

    const results = await this.db
      .selectFrom("phashMatches")
      .selectAll()
      .where((eb) =>
        eb.and([
          eb.or([eb("mediaFileId1", "in", fileIds), eb("mediaFileId2", "in", fileIds)]),
          eb("distance", "<=", threshold),
        ]),
      )
      .orderBy("distance", "asc")
      .execute();

    return results.map((row) => PhashMatch.parse(row));
  }

  /**
   * Check if a match exists for a pair of files.
   * Normalizes ordering automatically.
   */
  async hasMatch(fileId1: number, fileId2: number): Promise<boolean> {
    const id1 = Math.min(fileId1, fileId2);
    const id2 = Math.max(fileId1, fileId2);

    const row = await this.db
      .selectFrom("phashMatches")
      .select("id")
      .where("mediaFileId1", "=", id1)
      .where("mediaFileId2", "=", id2)
      .executeTakeFirst();

    return row !== undefined;
  }

  /**
   * Get the match record for a specific pair.
   * Normalizes ordering automatically.
   */
  async getMatchForPair(fileId1: number, fileId2: number): Promise<PhashMatch | null> {
    const id1 = Math.min(fileId1, fileId2);
    const id2 = Math.max(fileId1, fileId2);

    const row = await this.db
      .selectFrom("phashMatches")
      .selectAll()
      .where("mediaFileId1", "=", id1)
      .where("mediaFileId2", "=", id2)
      .executeTakeFirst();

    if (!row) {
      return null;
    }

    return PhashMatch.parse(row);
  }

  /**
   * Get all stored pair keys as "id1:id2" strings for efficient lookup.
   * Used to skip already-computed pairs during detection.
   */
  async getAllPairKeys(): Promise<Set<string>> {
    const results = await this.db.selectFrom("phashMatches").select(["mediaFileId1", "mediaFileId2"]).execute();

    const keys = new Set<string>();
    for (const row of results) {
      keys.add(`${row.mediaFileId1}:${row.mediaFileId2}`);
    }
    return keys;
  }

  /**
   * Delete all pHash matches.
   */
  async deleteAll(): Promise<void> {
    await this.db.deleteFrom("phashMatches").execute();
  }

  /**
   * Delete all matches involving a specific media file.
   */
  async deleteByMediaFileId(mediaFileId: number): Promise<number> {
    const result = await this.db
      .deleteFrom("phashMatches")
      .where((eb) => eb.or([eb("mediaFileId1", "=", mediaFileId), eb("mediaFileId2", "=", mediaFileId)]))
      .execute();
    return result.length;
  }

  /**
   * Throws if no pHash match exists with the given id.
   */
  async verifyRecordExists(id: number): Promise<void> {
    const row = await this.db.selectFrom("phashMatches").where("id", "=", id).select("id").executeTakeFirst();
    if (!row) {
      throw new Error("No result");
    }
  }

  /**
   * Update a pHash match.
   * Only the provided fields are updated. Throws if the match does not exist.
   */
  async updatePhashMatch(data: UpdatePhashMatch): Promise<void> {
    const validated = UpdatePhashMatch.parse(data);
    const { id, ...updateData } = validated;
    await this.verifyRecordExists(id);

    const update = PhashMatchRecord.partial().parse(updateData);
    await this.db.updateTable("phashMatches").set(update).where("id", "=", id).execute();
  }

  /**
   * Count match rows with distance <= maxDistance.
   */
  async getCountByMaxDistance(maxDistance: number): Promise<number> {
    const result = await this.db
      .selectFrom("phashMatches")
      .select((eb) => eb.fn.count("id").as("count"))
      .where("distance", "<=", maxDistance)
      .executeTakeFirst();

    return result ? Number(result.count) : 0;
  }

  /**
   * Get total count of pHash matches.
   */
  async getTotalCount(): Promise<number> {
    const result = await this.db
      .selectFrom("phashMatches")
      .select((eb) => eb.fn.count("id").as("count"))
      .executeTakeFirst();

    return result ? Number(result.count) : 0;
  }

  /**
   * Execute a transaction.
   */
  async transaction<T>(callback: (trx: PhashMatchProvider) => Promise<T>): Promise<T> {
    return await this.db.transaction().execute(async (trx: DatabaseInstance) => {
      return await callback(new PhashMatchProvider(trx));
    });
  }
}
