import type { Kysely } from "kysely";
import type { FileDecisionRecord } from "../zod/file-decision";
import type { ImageMetadataRecord } from "../zod/image-metadata";
import type { MediaFileRecord } from "../zod/media-file";
import type { PhashGroupMemberRecord } from "../zod/phash-group-member";
import type { PhashMatchRecord } from "../zod/phash-match";
import type { ScanFolderRecord } from "../zod/scan-folder";
import type { VideoMetadataRecord } from "../zod/video-metadata";

/**
 * Database schema types for Kysely
 * Uses the same structure as Zod schema - single source of truth
 * camelCase table and column names match the domain model exactly
 * CamelCasePlugin automatically converts between camelCase (TypeScript) and snake_case (database)
 * id is optional so inserts can omit it (auto-increment).
 * scanSubdirectories is stored as INTEGER (0/1) in SQLite, not boolean.
 */
export type DatabaseSchema = {
  scanFolders: ScanFolderRecord;
  mediaFiles: MediaFileRecord;
  imageMetadata: ImageMetadataRecord;
  videoMetadata: VideoMetadataRecord;
  phashMatches: PhashMatchRecord;
  phashGroupMembers: PhashGroupMemberRecord;
  fileDecisions: FileDecisionRecord;
};

/**
 * Database instance type for Kysely
 */
export type DatabaseInstance = Kysely<DatabaseSchema>;
