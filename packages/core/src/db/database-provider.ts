import { DatabaseClient } from "./client";
import { FileDecisionProvider } from "./file-decision-provider";
import { ImageMetadataProvider } from "./image-metadata-provider";
import { MediaFileProvider } from "./media-file-provider";
import { PhashGroupProvider } from "./phash-group-provider";
import { PhashMatchProvider } from "./phash-match-provider";
import { ScanFolderProvider } from "./scan-folder-provider";
import { SettingsProvider } from "./settings-provider";
import { VideoMetadataProvider } from "./video-metadata-provider";

/**
 * Holds the database client and singleton instances of providers.
 * Use getInstance() then getClient() for the Kysely handle, or get*Provider() for specific providers.
 */
export class DatabaseProvider {
  private static instance: DatabaseProvider | null = null;

  /** Single initialization promise so concurrent getInstance() calls don't run migrations twice. */
  private static initPromise: Promise<DatabaseProvider> | null = null;

  private scanFolderProvider: ScanFolderProvider | null = null;
  private mediaFileProvider: MediaFileProvider | null = null;
  private imageMetadataProvider: ImageMetadataProvider | null = null;
  private videoMetadataProvider: VideoMetadataProvider | null = null;
  private phashMatchProvider: PhashMatchProvider | null = null;
  private phashGroupProvider: PhashGroupProvider | null = null;
  private fileDecisionProvider: FileDecisionProvider | null = null;
  private settingsProvider: SettingsProvider | null = null;

  private constructor(private readonly dbClient: DatabaseClient) {}

  /**
   * Get or create the singleton DatabaseProvider (creates DatabaseClient and opens it when creating).
   * Safe for concurrent callers: they all await the same open() and only one migration runs.
   */
  static async getInstance(): Promise<DatabaseProvider> {
    if (DatabaseProvider.instance) {
      return DatabaseProvider.instance;
    }
    if (!DatabaseProvider.initPromise) {
      DatabaseProvider.initPromise = (async () => {
        const client = new DatabaseClient();
        await client.open();
        const provider = new DatabaseProvider(client);
        DatabaseProvider.instance = provider;
        DatabaseProvider.initPromise = null;
        return provider;
      })();
    }
    return DatabaseProvider.initPromise;
  }

  /**
   * Database client (connection + migrations + reset). Exposed directly for callers that need it.
   */
  getClient(): DatabaseClient {
    if (!this.dbClient) {
      throw new Error("DatabaseProvider not initialized");
    }
    return this.dbClient;
  }

  /**
   * Get or create the singleton ScanFolderProvider.
   */
  getScanFolderProvider(): ScanFolderProvider {
    if (!this.scanFolderProvider) {
      this.scanFolderProvider = new ScanFolderProvider(this.getClient().getDb());
    }
    return this.scanFolderProvider;
  }

  /**
   * Get or create the singleton MediaFileProvider.
   */
  getMediaFileProvider(): MediaFileProvider {
    if (!this.mediaFileProvider) {
      this.mediaFileProvider = new MediaFileProvider(this.getClient().getDb());
    }
    return this.mediaFileProvider;
  }

  /**
   * Get or create the singleton ImageMetadataProvider.
   */
  getImageMetadataProvider(): ImageMetadataProvider {
    if (!this.imageMetadataProvider) {
      this.imageMetadataProvider = new ImageMetadataProvider(this.getClient().getDb());
    }
    return this.imageMetadataProvider;
  }

  /**
   * Get or create the singleton VideoMetadataProvider.
   */
  getVideoMetadataProvider(): VideoMetadataProvider {
    if (!this.videoMetadataProvider) {
      this.videoMetadataProvider = new VideoMetadataProvider(this.getClient().getDb());
    }
    return this.videoMetadataProvider;
  }

  /**
   * Get or create the singleton PhashMatchProvider.
   */
  getPhashMatchProvider(): PhashMatchProvider {
    if (!this.phashMatchProvider) {
      this.phashMatchProvider = new PhashMatchProvider(this.getClient().getDb());
    }
    return this.phashMatchProvider;
  }

  /**
   * Get or create the singleton PhashGroupProvider.
   */
  getPhashGroupProvider(): PhashGroupProvider {
    if (!this.phashGroupProvider) {
      this.phashGroupProvider = new PhashGroupProvider(this.getClient().getDb());
    }
    return this.phashGroupProvider;
  }

  /**
   * Get or create the singleton FileDecisionProvider.
   */
  getFileDecisionProvider(): FileDecisionProvider {
    if (!this.fileDecisionProvider) {
      this.fileDecisionProvider = new FileDecisionProvider(this.getClient().getDb());
    }
    return this.fileDecisionProvider;
  }

  /**
   * Get or create the singleton SettingsProvider.
   */
  getSettingsProvider(): SettingsProvider {
    if (!this.settingsProvider) {
      this.settingsProvider = new SettingsProvider(this.getClient().getDb(), () => this.getClient().resetDatabase());
    }
    return this.settingsProvider;
  }

  /**
   * Clear cached providers. Must be called when the client is closed (e.g. after resetDatabase).
   */
  clear(): void {
    this.scanFolderProvider = null;
    this.mediaFileProvider = null;
    this.imageMetadataProvider = null;
    this.videoMetadataProvider = null;
    this.phashMatchProvider = null;
    this.phashGroupProvider = null;
    this.fileDecisionProvider = null;
    this.settingsProvider = null;
  }

  /**
   * Clear the singleton and its cached providers. Called by DatabaseClient.close().
   */
  static clearInstance(): void {
    DatabaseProvider.initPromise = null;
    if (DatabaseProvider.instance) {
      DatabaseProvider.instance.clear();
      DatabaseProvider.instance = null;
    }
  }
}
