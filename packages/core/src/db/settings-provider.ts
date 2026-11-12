import { existsSync, statSync } from "node:fs";
import { getDefaultDatabasePath } from "../config/app-paths";
import { env } from "../config/env";
import type { DatabaseInstance } from "./schema";

/**
 * Settings / database info and folder stats.
 * Uses the db handle for folder stats; env/fs for database info; reset callback for clearDatabase.
 */
export class SettingsProvider {
  constructor(
    private readonly db: DatabaseInstance,
    private readonly resetDatabase: () => Promise<void>,
  ) {}

  /**
   * Get folder statistics (total folders, images, videos, size)
   */
  async getFolderStats(): Promise<{
    folderCount: number;
    totalImages: number;
    totalVideos: number;
    totalSize: number;
  }> {
    const folders = await this.db.selectFrom("scanFolders").select(["imageCount", "videoCount", "totalSize"]).execute();

    return {
      folderCount: folders.length,
      totalImages: folders.reduce((sum, f) => sum + f.imageCount, 0),
      totalVideos: folders.reduce((sum, f) => sum + f.videoCount, 0),
      totalSize: folders.reduce((sum, f) => sum + f.totalSize, 0),
    };
  }

  /**
   * Get database file information (path and size)
   */
  async getDatabaseInfo(): Promise<{
    path: string;
    size: number;
    sizeFormatted: string;
  }> {
    const dbPath = env.DATABASE_PATH || getDefaultDatabasePath();
    let size = 0;
    let sizeFormatted = "0 B";

    if (existsSync(dbPath)) {
      const stats = statSync(dbPath);
      size = stats.size;
      sizeFormatted = SettingsProvider.formatFileSize(size);
    }

    return {
      path: dbPath,
      size,
      sizeFormatted,
    };
  }

  /**
   * Reset the database: drop all tables, re-run migrations.
   */
  async clearDatabase(): Promise<void> {
    await this.resetDatabase();
  }

  /**
   * Format file size in bytes to human-readable format
   */
  static formatFileSize(size: number): string {
    if (size === 0) {
      return "0 B";
    }

    const units = ["B", "KB", "MB", "GB", "TB"];
    let unitIndex = 0;
    let formattedSize = size;

    while (formattedSize >= 1024 && unitIndex < units.length - 1) {
      formattedSize /= 1024;
      unitIndex++;
    }

    if (formattedSize % 1 === 0) {
      return `${Math.round(formattedSize)} ${units[unitIndex]}`;
    }
    return `${formattedSize.toFixed(1)} ${units[unitIndex]}`;
  }
}
