import { Database as SqliteDatabase } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CamelCasePlugin, Kysely } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import { initializeDatabase } from "./client";
import { FolderOwnerDeviceProvider } from "./folder-owner-device-provider";
import { ImageMetadataProvider } from "./image-metadata-provider";
import { MediaFileProvider } from "./media-file-provider";
import { ScanFolderProvider } from "./scan-folder-provider";
import type { DatabaseSchema } from "./schema";

let raw: SqliteDatabase;
let k: Kysely<DatabaseSchema>;
let owners: FolderOwnerDeviceProvider;
let jim: number;
let heather: number;
const PIXEL8 = { cameraMake: "Google", cameraModel: "Pixel 8" };
const PIXEL8PRO = { cameraMake: "Google", cameraModel: "Pixel 8 Pro" };

async function photo(
  scanFolderId: number,
  name: string,
  camera: { cameraMake: string | null; cameraModel: string | null },
) {
  const file = await new MediaFileProvider(k).insertMediaFile({
    scanFolderId,
    path: `/${scanFolderId}/${name}`,
    filename: name,
    extension: "jpg",
    fileType: "image",
    size: 1,
    status: "processed",
  });
  await new ImageMetadataProvider(k).insertImageMetadata({
    mediaFileId: file.id,
    width: 4,
    height: 3,
    format: "jpeg",
    hasAlpha: false,
    ...camera,
  });
  return file.id;
}

beforeEach(async () => {
  raw = new SqliteDatabase(":memory:");
  raw.run("PRAGMA foreign_keys = ON");
  k = new Kysely<DatabaseSchema>({
    dialect: new BunSqliteDialect({ database: raw }),
    plugins: [new CamelCasePlugin()],
  });
  await initializeDatabase(k, ":memory:");
  const scan = new ScanFolderProvider(k);
  jim = (await scan.insertScanFolder({ path: "/jim" })).id;
  heather = (await scan.insertScanFolder({ path: "/heather" })).id;
  owners = new FolderOwnerDeviceProvider(k);
});
afterEach(() => raw.close());

describe("FolderOwnerDeviceProvider", () => {
  test("lists the cameras in a folder's photos, most used first, with owned flags", async () => {
    await photo(heather, "a.jpg", PIXEL8);
    await photo(heather, "b.jpg", PIXEL8);
    await photo(heather, "c.jpg", PIXEL8PRO);
    await photo(heather, "d.jpg", { cameraMake: null, cameraModel: null });
    await photo(jim, "e.jpg", PIXEL8PRO);
    await owners.setOwnerDevices(heather, [PIXEL8]);
    expect(await owners.listFolderDevices(heather)).toEqual([
      { ...PIXEL8, photos: 2, owned: true },
      { ...PIXEL8PRO, photos: 1, owned: false },
    ]);
  });

  test("set replaces and de-duplicates; owned devices without photos stay listed", async () => {
    await owners.setOwnerDevices(jim, [PIXEL8, PIXEL8]);
    await owners.setOwnerDevices(jim, [PIXEL8PRO, PIXEL8PRO]);
    expect(await owners.getOwnerDevices(jim)).toEqual([PIXEL8PRO]);
    expect(await owners.listFolderDevices(jim)).toEqual([{ ...PIXEL8PRO, photos: 0, owned: true }]);
    await owners.setOwnerDevices(jim, []);
    expect(await owners.getOwnerDevices(jim)).toEqual([]);
  });

  test("refuses a device without a model", async () => {
    await expect(owners.setOwnerDevices(jim, [{ cameraMake: "Google", cameraModel: "" }])).rejects.toThrow();
  });

  test("owned files: taken with a device their OWN folder owns (make and model exact)", async () => {
    const heatherCopy = await photo(heather, "x.jpg", PIXEL8);
    const jimCopy = await photo(jim, "x.jpg", PIXEL8);
    const jimOwn = await photo(jim, "y.jpg", PIXEL8PRO);
    const otherMake = await photo(heather, "z.jpg", { cameraMake: "Other", cameraModel: "Pixel 8" });
    await owners.setOwnerDevices(heather, [PIXEL8]);
    await owners.setOwnerDevices(jim, [PIXEL8PRO]);
    const owned = await owners.getOwnedFileIds([heatherCopy, jimCopy, jimOwn, otherMake]);
    expect([...owned].sort()).toEqual([heatherCopy, jimOwn].sort());
  });

  test("removing a folder removes its devices", async () => {
    await owners.setOwnerDevices(jim, [PIXEL8]);
    await new ScanFolderProvider(k).deleteScanFolder(jim);
    expect(await owners.getOwnerDevices(jim)).toEqual([]);
  });
});
