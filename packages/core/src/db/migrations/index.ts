import type { Migration } from "kysely";
import * as m0001 from "./0001_initial";
import * as m0002 from "./0002_media_files";
import * as m0003 from "./0003_image_metadata";
import * as m0004 from "./0004_video_metadata";
import * as m0005 from "./0005_phash_matches";
import * as m0006 from "./0006_file_decisions";
import * as m0007 from "./0007_phash_group_members";

/**
 * All migrations exported in one place so the client can import them and the
 * bundler includes them (with kysely resolved). Add new migrations here.
 */
export const migrations: Record<string, Migration> = {
  "0001_initial": { up: m0001.up, down: m0001.down },
  "0002_media_files": { up: m0002.up, down: m0002.down },
  "0003_image_metadata": { up: m0003.up, down: m0003.down },
  "0004_video_metadata": { up: m0004.up, down: m0004.down },
  "0005_phash_matches": { up: m0005.up, down: m0005.down },
  "0006_file_decisions": { up: m0006.up, down: m0006.down },
  "0007_phash_group_members": { up: m0007.up, down: m0007.down },
};
