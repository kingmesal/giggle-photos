import type { FileDecisionAction, FileDecisionMethod } from "../zod/file-decision";
import { FileDecision, FileDecisionRecord, NewFileDecision, UpdateFileDecision } from "../zod/file-decision";
import type { DatabaseInstance } from "./schema";

/**
 * File decision access with Zod validation.
 * All file_decisions table access goes through this provider.
 */
export class FileDecisionProvider {
  constructor(private db: DatabaseInstance) {}

  /**
   * Insert a new file decision.
   * Always validates with Zod before inserting.
   */
  async insertFileDecision(data: NewFileDecision): Promise<FileDecision> {
    const validatedInput = NewFileDecision.parse(data);

    const now = new Date();
    const decisionData = {
      ...validatedInput,
      createdAt: now,
    };

    const newRecord = FileDecisionRecord.parse(decisionData);

    const row = await this.db.insertInto("fileDecisions").values(newRecord).returningAll().executeTakeFirst();

    if (!row) {
      throw new Error("Insert did not return a row");
    }

    return FileDecision.parse(row);
  }

  /**
   * Batch insert multiple file decisions.
   * More efficient than individual inserts for "confirm review" operations.
   */
  async insertFileDecisions(decisions: NewFileDecision[]): Promise<number> {
    if (decisions.length === 0) return 0;

    const now = new Date();
    const records = decisions.map((data) => {
      const validated = NewFileDecision.parse(data);
      return FileDecisionRecord.parse({ ...validated, createdAt: now });
    });

    const result = await this.db.insertInto("fileDecisions").values(records).execute();
    // result is an array of InsertResult; for a batch INSERT, there's typically 1 entry
    // with numInsertedOrUpdatedRows containing the actual count
    let totalInserted = 0;
    for (const r of result) {
      totalInserted += Number(r.numInsertedOrUpdatedRows ?? 0);
    }
    return totalInserted || records.length;
  }

  /**
   * Get a single decision by its ID.
   */
  async getFileDecisionById(id: number): Promise<FileDecision | null> {
    const row = await this.db.selectFrom("fileDecisions").selectAll().where("id", "=", id).executeTakeFirst();

    if (!row) {
      return null;
    }

    return FileDecision.parse(row);
  }

  /**
   * Get all decisions for a specific media file across all groups.
   */
  async getDecisionsByMediaFileId(mediaFileId: number): Promise<FileDecision[]> {
    const results = await this.db
      .selectFrom("fileDecisions")
      .selectAll()
      .where("mediaFileId", "=", mediaFileId)
      .orderBy("createdAt", "desc")
      .execute();

    return results.map((row) => FileDecision.parse(row));
  }

  /**
   * Get a single decision for a specific file within a specific group.
   */
  async getDecisionByMediaFileIdAndGroupKey(mediaFileId: number, reviewGroupKey: string): Promise<FileDecision | null> {
    const row = await this.db
      .selectFrom("fileDecisions")
      .selectAll()
      .where("mediaFileId", "=", mediaFileId)
      .where("reviewGroupKey", "=", reviewGroupKey)
      .executeTakeFirst();

    if (!row) {
      return null;
    }

    return FileDecision.parse(row);
  }

  /**
   * Get all decisions with a specific action.
   */
  async getDecisionsByAction(action: FileDecisionAction): Promise<FileDecision[]> {
    const results = await this.db
      .selectFrom("fileDecisions")
      .selectAll()
      .where("action", "=", action)
      .orderBy("createdAt", "desc")
      .execute();

    return results.map((row) => FileDecision.parse(row));
  }

  /**
   * Get all decisions for a specific group key and set of file IDs.
   */
  async getDecisionsByGroupKeyAndFileIds(reviewGroupKey: string, fileIds: number[]): Promise<FileDecision[]> {
    if (fileIds.length === 0) return [];

    const results = await this.db
      .selectFrom("fileDecisions")
      .selectAll()
      .where("reviewGroupKey", "=", reviewGroupKey)
      .where("mediaFileId", "in", fileIds)
      .execute();

    return results.map((row) => FileDecision.parse(row));
  }

  /**
   * Get all decisions for a specific review group key.
   */
  async getDecisionsByReviewGroupKey(reviewGroupKey: string): Promise<FileDecision[]> {
    const results = await this.db
      .selectFrom("fileDecisions")
      .selectAll()
      .where("reviewGroupKey", "=", reviewGroupKey)
      .orderBy("createdAt", "desc")
      .execute();

    return results.map((row) => FileDecision.parse(row));
  }

  /**
   * Get all media file IDs that have been marked for deletion.
   * Returns a Set for efficient lookup in cross-group queries.
   */
  async getDeletedFileIds(): Promise<Set<number>> {
    const results = await this.db
      .selectFrom("fileDecisions")
      .select("mediaFileId")
      .where("action", "=", "delete")
      .execute();

    return new Set(results.map((row) => row.mediaFileId));
  }

  /**
   * Check if a decision exists for a specific file + group.
   */
  async hasDecisionForFile(mediaFileId: number, reviewGroupKey: string): Promise<boolean> {
    const row = await this.db
      .selectFrom("fileDecisions")
      .select("id")
      .where("mediaFileId", "=", mediaFileId)
      .where("reviewGroupKey", "=", reviewGroupKey)
      .executeTakeFirst();

    return row !== undefined;
  }

  /**
   * Delete a decision for a specific file + group key.
   * Used for "undo" operations.
   */
  async deleteByMediaFileIdAndGroupKey(mediaFileId: number, reviewGroupKey: string): Promise<void> {
    await this.db
      .deleteFrom("fileDecisions")
      .where("mediaFileId", "=", mediaFileId)
      .where("reviewGroupKey", "=", reviewGroupKey)
      .execute();
  }

  /**
   * Delete all decisions for a specific media file.
   */
  async deleteByMediaFileId(mediaFileId: number): Promise<number> {
    // Count matching rows first
    const existing = await this.getDecisionsByMediaFileId(mediaFileId);
    const count = existing.length;

    if (count > 0) {
      await this.db.deleteFrom("fileDecisions").where("mediaFileId", "=", mediaFileId).execute();
    }

    return count;
  }

  /**
   * Delete all file decisions (reset).
   */
  async deleteAll(): Promise<void> {
    await this.db.deleteFrom("fileDecisions").execute();
  }

  /**
   * Get count of decisions grouped by action.
   */
  async getCountByAction(): Promise<Record<FileDecisionAction, number>> {
    const results = await this.db
      .selectFrom("fileDecisions")
      .select(["action"])
      .select((eb) => eb.fn.count("id").as("count"))
      .groupBy("action")
      .execute();

    const counts: Record<FileDecisionAction, number> = {
      keep: 0,
      delete: 0,
    };

    for (const row of results) {
      counts[row.action as FileDecisionAction] = Number(row.count);
    }

    return counts;
  }

  /**
   * Get total count of file decisions.
   */
  async getTotalCount(): Promise<number> {
    const result = await this.db
      .selectFrom("fileDecisions")
      .select((eb) => eb.fn.count("id").as("count"))
      .executeTakeFirst();

    return result ? Number(result.count) : 0;
  }

  /**
   * Throws if no file decision exists with the given id.
   */
  async verifyRecordExists(id: number): Promise<void> {
    const row = await this.db.selectFrom("fileDecisions").where("id", "=", id).select("id").executeTakeFirst();
    if (!row) {
      throw new Error("No result");
    }
  }

  /**
   * Update a file decision.
   * Only the provided fields are updated. Throws if the decision does not exist.
   */
  async updateFileDecision(data: UpdateFileDecision): Promise<void> {
    const validated = UpdateFileDecision.parse(data);
    const { id, ...updateData } = validated;
    await this.verifyRecordExists(id);

    const update = FileDecisionRecord.partial().parse(updateData);
    await this.db.updateTable("fileDecisions").set(update).where("id", "=", id).execute();
  }

  /**
   * Delete a file decision by ID.
   */
  async deleteFileDecision(id: number): Promise<void> {
    await this.db.deleteFrom("fileDecisions").where("id", "=", id).execute();
  }

  /**
   * Get files that have conflicting decisions (both "keep" and "delete" across different groups).
   * Returns mediaFileIds with their conflicting group keys and actions.
   */
  async getConflictingFiles(): Promise<
    Array<{
      mediaFileId: number;
      decisions: Array<{ reviewGroupKey: string; action: "keep" | "delete" }>;
    }>
  > {
    // Get all decisions, group by mediaFileId
    const allDecisions = await this.db
      .selectFrom("fileDecisions")
      .select(["mediaFileId", "reviewGroupKey", "action"])
      .orderBy("mediaFileId", "asc")
      .execute();

    // Group by mediaFileId
    const byFile = new Map<number, Array<{ reviewGroupKey: string; action: string }>>();
    for (const d of allDecisions) {
      const id = d.mediaFileId as number;
      if (!byFile.has(id)) byFile.set(id, []);
      (byFile.get(id) as Array<{ reviewGroupKey: string; action: string }>).push({
        reviewGroupKey: d.reviewGroupKey as string,
        action: d.action as string,
      });
    }

    // Filter to files with both keep and delete decisions
    const conflicts: Array<{
      mediaFileId: number;
      decisions: Array<{ reviewGroupKey: string; action: "keep" | "delete" }>;
    }> = [];

    for (const [mediaFileId, decisions] of byFile) {
      const hasKeep = decisions.some((d) => d.action === "keep");
      const hasDelete = decisions.some((d) => d.action === "delete");
      if (hasKeep && hasDelete) {
        conflicts.push({
          mediaFileId,
          decisions: decisions as Array<{ reviewGroupKey: string; action: "keep" | "delete" }>,
        });
      }
    }

    return conflicts;
  }

  /**
   * Resolve a conflict for a specific file by updating all decisions to the chosen action.
   */
  async resolveConflict(mediaFileId: number, action: "keep" | "delete"): Promise<void> {
    await this.db.updateTable("fileDecisions").set({ action }).where("mediaFileId", "=", mediaFileId).execute();
  }

  /**
   * Get decisions by method.
   */
  async getDecisionsByMethod(method: FileDecisionMethod): Promise<FileDecision[]> {
    const results = await this.db
      .selectFrom("fileDecisions")
      .selectAll()
      .where("method", "=", method)
      .orderBy("createdAt", "desc")
      .execute();

    return results.map((row) => FileDecision.parse(row));
  }

  /**
   * Execute a transaction.
   */
  async transaction<T>(callback: (trx: FileDecisionProvider) => Promise<T>): Promise<T> {
    return await this.db.transaction().execute(async (trx: DatabaseInstance) => {
      return await callback(new FileDecisionProvider(trx));
    });
  }
}
