import type { Transaction } from "kysely";
import { MediaPair, MediaPairRecord, type NewMediaPair } from "../zod/media-pair";
import { type NewSidecar, Sidecar, SidecarRecord } from "../zod/sidecar";
import { type NewTakeoutFolder, TakeoutFolder, TakeoutFolderRecord } from "../zod/takeout-folder";
import type { DatabaseInstance, DatabaseSchema } from "./schema";

/** One indexing run's results for a scan folder; folder rows are referenced by `key`. */
export interface TakeoutIndexInput {
  folders: { key: string; folder: Omit<NewTakeoutFolder, "scanFolderId">; mediaFileIds: number[] }[];
  sidecars: (Omit<NewSidecar, "scanFolderId" | "takeoutFolderId"> & { folderKey: string | null })[];
  pairs: NewMediaPair[];
}

export interface PreselectContext {
  folderKind: "year" | "album" | "special" | null;
  albumReferenced: boolean;
  hasSidecar: boolean;
  motionPartnerId: number | null;
  editedPartnerId: number | null;
}

export interface TakeoutSummary {
  folders: { year: number; album: number; special: number };
  sidecars: { media: number; album_metadata: number; other: number; unparseable: number };
  mediaSidecarsMatched: number;
  mediaSidecarsUnmatched: number;
  byMethod: Record<string, number>;
  mediaWithoutSidecar: number;
  pairs: { motion: number; edited: number };
}

const CHUNK = 500;
const chunks = <T>(items: T[]): T[][] =>
  Array.from({ length: Math.ceil(items.length / CHUNK) }, (_, i) => items.slice(i * CHUNK, (i + 1) * CHUNK));

/**
 * Provider for the Google Takeout tables (takeoutFolders, sidecars, mediaPairs) and
 * mediaFiles.takeoutFolderId. All writes are Zod-validated. ⚠️ FRAGILE: See _FRAGILE.md
 */
export class TakeoutProvider {
  constructor(private db: DatabaseInstance) {}

  /** Replace everything indexed for a scan folder, atomically (re-indexing is idempotent). */
  async replaceIndex(scanFolderId: number, input: TakeoutIndexInput): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await this.clear(trx, scanFolderId);
      const now = new Date();
      const folderIds = new Map<string, number>();
      for (const { key, folder, mediaFileIds } of input.folders) {
        const record = TakeoutFolderRecord.parse({ ...folder, scanFolderId, createdAt: now, updatedAt: now });
        const row = await trx.insertInto("takeoutFolders").values(record).returning("id").executeTakeFirstOrThrow();
        const id = Number(row.id);
        folderIds.set(key, id);
        for (const ids of chunks(mediaFileIds)) {
          await trx.updateTable("mediaFiles").set({ takeoutFolderId: id }).where("id", "in", ids).execute();
        }
      }
      const sidecarRecords = input.sidecars.map(({ folderKey, ...sidecar }) => {
        const valid = Sidecar.omit({ id: true, createdAt: true, updatedAt: true }).parse({
          ...sidecar,
          scanFolderId,
          takeoutFolderId: folderKey === null ? null : (folderIds.get(folderKey) ?? null),
        });
        return SidecarRecord.parse({ ...valid, people: JSON.stringify(valid.people), createdAt: now, updatedAt: now });
      });
      for (const batch of chunks(sidecarRecords)) await trx.insertInto("sidecars").values(batch).execute();
      const pairRecords = input.pairs.map((p) => MediaPairRecord.parse({ ...p, createdAt: now }));
      for (const batch of chunks(pairRecords)) await trx.insertInto("mediaPairs").values(batch).execute();
    });
  }

  private async clear(trx: Transaction<DatabaseSchema>, scanFolderId: number): Promise<void> {
    const mediaOfFolder = trx.selectFrom("mediaFiles").select("id").where("scanFolderId", "=", scanFolderId);
    await trx.deleteFrom("mediaPairs").where("primaryFileId", "in", mediaOfFolder).execute();
    await trx.deleteFrom("sidecars").where("scanFolderId", "=", scanFolderId).execute();
    await trx
      .updateTable("mediaFiles")
      .set({ takeoutFolderId: null })
      .where("scanFolderId", "=", scanFolderId)
      .execute();
    await trx.deleteFrom("takeoutFolders").where("scanFolderId", "=", scanFolderId).execute();
  }

  async getFolders(): Promise<TakeoutFolder[]> {
    const rows = await this.db.selectFrom("takeoutFolders").selectAll().orderBy("path").execute();
    return rows.map((row) => TakeoutFolder.parse(row));
  }

  async getSidecarsForMedia(mediaFileId: number): Promise<Sidecar[]> {
    const rows = await this.db.selectFrom("sidecars").selectAll().where("mediaFileId", "=", mediaFileId).execute();
    return rows.map((row) => Sidecar.parse({ ...row, people: JSON.parse(row.people) }));
  }

  /** Remove sidecar rows whose files were removed with their media (quarantine/delete). */
  async deleteSidecars(ids: number[]): Promise<void> {
    for (const batch of chunks(ids)) await this.db.deleteFrom("sidecars").where("id", "in", batch).execute();
  }

  async getPairsForMedia(mediaFileId: number): Promise<MediaPair[]> {
    const rows = await this.db
      .selectFrom("mediaPairs")
      .selectAll()
      .where((eb) => eb.or([eb("primaryFileId", "=", mediaFileId), eb("secondaryFileId", "=", mediaFileId)]))
      .execute();
    return rows.map((row) => MediaPair.parse(row));
  }

  /**
   * Per-file Takeout context for preselection (RFD-003 §E): folder kind, album membership by
   * reference, sidecar (own or inherited through a pair), and pair partners. Files outside a
   * Takeout get folderKind null.
   */
  async getPreselectContext(mediaFileIds: number[]): Promise<Map<number, PreselectContext>> {
    const out = new Map<number, PreselectContext>();
    if (mediaFileIds.length === 0) return out;
    const folders = await this.db
      .selectFrom("mediaFiles as m")
      .leftJoin("takeoutFolders as f", "f.id", "m.takeoutFolderId")
      .select(["m.id", "f.kind"])
      .where("m.id", "in", mediaFileIds)
      .execute();
    const pairs = await this.db
      .selectFrom("mediaPairs")
      .select(["kind", "primaryFileId", "secondaryFileId"])
      .where((eb) => eb.or([eb("primaryFileId", "in", mediaFileIds), eb("secondaryFileId", "in", mediaFileIds)]))
      .execute();
    const related = [
      ...new Set([...mediaFileIds, ...pairs.flatMap((p) => [Number(p.primaryFileId), Number(p.secondaryFileId)])]),
    ];
    const sidecars = await this.db
      .selectFrom("sidecars")
      .select(["mediaFileId", "matchMethod"])
      .where("mediaFileId", "in", related)
      .execute();
    const ownSidecar = new Set(
      sidecars.filter((s) => s.matchMethod !== "album_reference").map((s) => Number(s.mediaFileId)),
    );
    const albumReferenced = new Set(
      sidecars.filter((s) => s.matchMethod === "album_reference").map((s) => Number(s.mediaFileId)),
    );

    for (const row of folders) {
      const id = Number(row.id);
      const kind = row.kind === "year" || row.kind === "album" || row.kind === "special" ? row.kind : null;
      out.set(id, {
        folderKind: kind,
        albumReferenced: albumReferenced.has(id),
        hasSidecar: ownSidecar.has(id),
        motionPartnerId: null,
        editedPartnerId: null,
      });
    }
    for (const p of pairs) {
      const primary = Number(p.primaryFileId);
      const secondary = Number(p.secondaryFileId);
      const field = p.kind === "motion" ? "motionPartnerId" : "editedPartnerId";
      const a = out.get(primary);
      const b = out.get(secondary);
      if (a) a[field] = secondary;
      if (b) {
        b[field] = primary;
        if (ownSidecar.has(primary)) b.hasSidecar = true; // inherits the primary's JSON
      }
    }
    return out;
  }

  /** Media in Takeout folders with no sidecar of their own and none inherited through a pair. */
  private mediaWithoutSidecarQuery() {
    return this.db
      .selectFrom("mediaFiles as m")
      .innerJoin("takeoutFolders as f", "f.id", "m.takeoutFolderId")
      .where("f.kind", "!=", "non_takeout")
      .where(({ not, exists, selectFrom }) =>
        not(exists(selectFrom("sidecars as s").select("s.id").whereRef("s.mediaFileId", "=", "m.id"))),
      )
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom("mediaPairs as p")
              .innerJoin("sidecars as ps", "ps.mediaFileId", "p.primaryFileId")
              .select("p.id")
              .whereRef("p.secondaryFileId", "=", "m.id"),
          ),
        ),
      );
  }

  async listMediaWithoutSidecar(limit = 200): Promise<{ id: number; path: string }[]> {
    const rows = await this.mediaWithoutSidecarQuery()
      .select(["m.id", "m.path"])
      .orderBy("m.path")
      .limit(limit)
      .execute();
    return rows.map((r) => ({ id: Number(r.id), path: r.path }));
  }

  async listUnmatchedSidecars(limit = 200): Promise<{ id: number; path: string; title: string | null }[]> {
    const rows = await this.db
      .selectFrom("sidecars")
      .select(["id", "path", "title"])
      .where("kind", "=", "media")
      .where("mediaFileId", "is", null)
      .orderBy("path")
      .limit(limit)
      .execute();
    return rows.map((r) => ({ id: Number(r.id), path: r.path, title: r.title }));
  }

  async getSummary(): Promise<TakeoutSummary> {
    const count = (n: unknown) => Number(n ?? 0);
    const folderRows = await this.db
      .selectFrom("takeoutFolders")
      .select(["kind", (eb) => eb.fn.countAll().as("n")])
      .groupBy("kind")
      .execute();
    const sidecarRows = await this.db
      .selectFrom("sidecars")
      .select(["kind", (eb) => eb.fn.countAll().as("n")])
      .groupBy("kind")
      .execute();
    // Matched = still linked to a media file (the link is nulled if that file is deleted).
    const methodRows = await this.db
      .selectFrom("sidecars")
      .select(["matchMethod", (eb) => eb.fn.countAll().as("n")])
      .where("kind", "=", "media")
      .where("mediaFileId", "is not", null)
      .groupBy("matchMethod")
      .execute();
    const pairRows = await this.db
      .selectFrom("mediaPairs")
      .select(["kind", (eb) => eb.fn.countAll().as("n")])
      .groupBy("kind")
      .execute();
    const without = await this.mediaWithoutSidecarQuery()
      .select((eb) => eb.fn.countAll().as("n"))
      .executeTakeFirst();

    const summary: TakeoutSummary = {
      folders: { year: 0, album: 0, special: 0 },
      sidecars: { media: 0, album_metadata: 0, other: 0, unparseable: 0 },
      mediaSidecarsMatched: 0,
      mediaSidecarsUnmatched: 0,
      byMethod: {},
      mediaWithoutSidecar: count(without?.n),
      pairs: { motion: 0, edited: 0 },
    };
    for (const r of folderRows) if (r.kind in summary.folders) summary.folders[r.kind as "year"] += count(r.n);
    for (const r of sidecarRows) summary.sidecars[r.kind] += count(r.n);
    for (const r of methodRows) {
      summary.mediaSidecarsMatched += count(r.n);
      const method = r.matchMethod ?? "unknown";
      summary.byMethod[method] = (summary.byMethod[method] ?? 0) + count(r.n);
    }
    summary.mediaSidecarsUnmatched = summary.sidecars.media - summary.mediaSidecarsMatched;
    for (const r of pairRows) summary.pairs[r.kind] += count(r.n);
    return summary;
  }
}
