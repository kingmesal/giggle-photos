import { join } from "node:path";
import { config } from "@dotenvx/dotenvx";
import { z } from "zod";
import { getDefaultDatabasePath } from "./app-paths";

// PROJECT_ROOT is set by the npm scripts (e.g., PROJECT_ROOT=$PWD).
// It tells us where to find .env files and is available for variable
// expansion inside those files (e.g., APP_DATA_PATH=${PROJECT_ROOT}/.app-dev).
const root = process.env.PROJECT_ROOT || process.cwd();

// Build env file loading chain following the dotenvx "flow" convention:
//   .env.{DOTENV_ENV}.local → .env.{DOTENV_ENV} → .env.local → .env
// First file to set a var wins. dotenvx won't override already-set vars.
const envName = process.env.DOTENV_ENV;
const paths: string[] = [];
if (envName) {
  paths.push(join(root, `.env.${envName}.local`));
  paths.push(join(root, `.env.${envName}`));
}
paths.push(join(root, ".env.local"));
paths.push(join(root, ".env"));
config({ path: paths, ignore: ["MISSING_ENV_FILE"] });

const EnvSchema = z.object({
  APP_DATA_PATH: z.string().optional(),
  DATABASE_PATH: z.string().default(getDefaultDatabasePath()),
  LOG_LEVEL: z.enum(["off", "trace", "debug", "info", "warn", "error"]).default("info"),
  SCAN_BATCH_SIZE: z.coerce.number().int().positive().default(10),
  HASH_ALGORITHM: z.string().default("sha256"),
  /** Memory the image-analysis worker may hold in concurrent decodes (RFD-002). */
  DECODE_MEMORY_BUDGET_MB: z.coerce.number().int().positive().default(1024),
});

export const env = EnvSchema.parse(process.env);
