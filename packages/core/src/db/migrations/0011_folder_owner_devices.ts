import type { Kysely } from "kysely";

/** Cameras owned by a scan folder's owner (RFD-005). */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("folderOwnerDevices")
    .ifNotExists()
    .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
    .addColumn("scanFolderId", "integer", (col) => col.notNull().references("scanFolders.id").onDelete("cascade"))
    .addColumn("cameraMake", "text")
    .addColumn("cameraModel", "text", (col) => col.notNull())
    .addColumn("createdAt", "integer", (col) => col.notNull())
    .addUniqueConstraint("uqFolderOwnerDevice", ["scanFolderId", "cameraMake", "cameraModel"])
    .execute();
  await db.schema
    .createIndex("idxFolderOwnerDevicesScanFolderId")
    .ifNotExists()
    .on("folderOwnerDevices")
    .column("scanFolderId")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("folderOwnerDevices").ifExists().execute();
}
