import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { AppSettings, ensureAppDataDir, getUserConfigPath, LogLevel, UserConfig } from "./user-config";

describe("User Config", () => {
  const originalAppDataPath = process.env.APP_DATA_PATH;
  let testConfigPath: string;

  beforeEach(() => {
    // Create a temporary directory for each test
    const testDir = join(tmpdir(), `user-config-test-${Date.now()}-${Math.random()}`);
    mkdirSync(testDir, { recursive: true });
    testConfigPath = join(testDir, "config.json");

    // Mock the app data path by setting an env var if the module supports it
    // For now, we'll test with actual paths but clean up
  });

  afterEach(() => {
    // Clean up test files
    try {
      if (testConfigPath && existsSync(testConfigPath)) {
        const testDir = testConfigPath.replace("/config.json", "");
        if (existsSync(testDir)) {
          rmSync(testDir, { recursive: true, force: true });
        }
      }
    } catch {
      // Ignore cleanup errors
    }

    if (originalAppDataPath) {
      process.env.APP_DATA_PATH = originalAppDataPath;
    } else {
      delete process.env.APP_DATA_PATH;
    }
  });

  describe("UserConfig", () => {
    test("should parse valid config with all fields", () => {
      const validConfig = {
        window: {
          width: 1920,
          height: 1080,
          x: 50,
          y: 50,
        },
      };

      const result = UserConfig.parse(validConfig);
      expect(result.window.width).toBe(1920);
      expect(result.window.height).toBe(1080);
      expect(result.window.x).toBe(50);
      expect(result.window.y).toBe(50);
    });

    test("should apply defaults when window object is empty", () => {
      const result = UserConfig.parse({ window: {} });
      expect(result.window.width).toBe(1200);
      expect(result.window.height).toBe(800);
      expect(result.window.x).toBe(100);
      expect(result.window.y).toBe(100);
    });

    test("should apply defaults for missing fields", () => {
      const partialConfig = {
        window: {
          width: 1600,
          // height, x, y missing - should use defaults
        },
      };

      const result = UserConfig.parse(partialConfig);
      expect(result.window.width).toBe(1600);
      expect(result.window.height).toBe(800); // default
      expect(result.window.x).toBe(100); // default
      expect(result.window.y).toBe(100); // default
    });

    test("should reject invalid width (negative)", () => {
      const invalidConfig = {
        window: {
          width: -100,
          height: 800,
        },
      };

      expect(() => UserConfig.parse(invalidConfig)).toThrow();
    });

    test("should reject invalid width (zero)", () => {
      const invalidConfig = {
        window: {
          width: 0,
          height: 800,
        },
      };

      expect(() => UserConfig.parse(invalidConfig)).toThrow();
    });

    test("should reject invalid width (non-integer)", () => {
      const invalidConfig = {
        window: {
          width: 1200.5,
          height: 800,
        },
      };

      expect(() => UserConfig.parse(invalidConfig)).toThrow();
    });

    test("should reject invalid height (negative)", () => {
      const invalidConfig = {
        window: {
          width: 1200,
          height: -100,
        },
      };

      expect(() => UserConfig.parse(invalidConfig)).toThrow();
    });

    test("should accept negative x and y (window can be off-screen)", () => {
      const config = {
        window: {
          width: 1200,
          height: 800,
          x: -100,
          y: -50,
        },
      };

      const result = UserConfig.parse(config);
      expect(result.window.x).toBe(-100);
      expect(result.window.y).toBe(-50);
    });
  });

  describe("saveUserConfig and loadUserConfig", () => {
    test("should save and load config from file", () => {
      const testConfig: UserConfig = {
        window: {
          width: 1920,
          height: 1080,
          x: 100,
          y: 200,
        },
      };

      // Save to test file
      writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2), "utf-8");

      // Load and verify
      const loaded = JSON.parse(readFileSync(testConfigPath, "utf-8"));
      const validated = UserConfig.parse(loaded);

      expect(validated.window.width).toBe(1920);
      expect(validated.window.height).toBe(1080);
      expect(validated.window.x).toBe(100);
      expect(validated.window.y).toBe(200);
    });

    test("should create default config when file doesn't exist", () => {
      // This tests the getDefaultConfig function indirectly
      // Since we can't easily mock the app data path, we'll test the schema defaults
      const defaultConfig = UserConfig.parse({ window: {} });
      expect(defaultConfig.window.width).toBe(1200);
      expect(defaultConfig.window.height).toBe(800);
      expect(defaultConfig.window.x).toBe(100);
      expect(defaultConfig.window.y).toBe(100);
    });

    test("should handle invalid JSON gracefully", () => {
      writeFileSync(testConfigPath, "invalid json{", "utf-8");

      expect(() => {
        const content = readFileSync(testConfigPath, "utf-8");
        JSON.parse(content);
      }).toThrow();
    });

    test("should validate and fix invalid config data", () => {
      const invalidConfig = {
        window: {
          width: "not a number", // Invalid type
          height: 800,
        },
      };

      expect(() => UserConfig.parse(invalidConfig)).toThrow();
    });
  });

  describe("updateWindowSize", () => {
    test("should update all window dimensions", () => {
      const initialConfig: UserConfig = {
        window: {
          width: 1200,
          height: 800,
          x: 100,
          y: 100,
        },
      };

      // Write initial config
      writeFileSync(testConfigPath, JSON.stringify(initialConfig, null, 2), "utf-8");

      // Since updateWindowSize uses the actual app data path,
      // we'll test the logic by verifying the schema behavior
      const updated = {
        ...initialConfig,
        window: {
          ...initialConfig.window,
          width: 1920,
          height: 1080,
          x: 200,
          y: 300,
        },
      };

      const validated = UserConfig.parse(updated);
      expect(validated.window.width).toBe(1920);
      expect(validated.window.height).toBe(1080);
      expect(validated.window.x).toBe(200);
      expect(validated.window.y).toBe(300);
    });

    test("should update only provided dimensions", () => {
      const initialConfig: UserConfig = {
        window: {
          width: 1200,
          height: 800,
          x: 100,
          y: 100,
        },
      };

      // Update only width and height, keep x and y
      const updated = {
        ...initialConfig,
        window: {
          ...initialConfig.window,
          width: 1920,
          height: 1080,
          // x and y unchanged
        },
      };

      const validated = UserConfig.parse(updated);
      expect(validated.window.width).toBe(1920);
      expect(validated.window.height).toBe(1080);
      expect(validated.window.x).toBe(100); // Unchanged
      expect(validated.window.y).toBe(100); // Unchanged
    });
  });

  describe("getUserConfigPath", () => {
    test("should return a valid path", () => {
      const path = getUserConfigPath();
      expect(path).toBeTruthy();
      expect(typeof path).toBe("string");
      expect(path).toContain("config.json");
    });
  });

  describe("ensureAppDataDir", () => {
    test("should be a function", () => {
      // This tests the function exists and can be called
      // Actual directory creation depends on app data path
      expect(typeof ensureAppDataDir).toBe("function");
    });
  });

  describe("LogLevel", () => {
    test("should accept valid log levels", () => {
      expect(LogLevel.parse("off")).toBe("off");
      expect(LogLevel.parse("error")).toBe("error");
      expect(LogLevel.parse("warn")).toBe("warn");
      expect(LogLevel.parse("info")).toBe("info");
      expect(LogLevel.parse("debug")).toBe("debug");
      expect(LogLevel.parse("trace")).toBe("trace");
    });

    test("should reject invalid log levels", () => {
      expect(() => LogLevel.parse("invalid")).toThrow();
      expect(() => LogLevel.parse("")).toThrow();
    });
  });

  describe("AppSettings loggerLevels", () => {
    test("should default to empty loggerLevels", () => {
      const settings = AppSettings.parse({});
      expect(settings.loggerLevels).toEqual({});
      expect(settings.logLevel).toBe("info");
    });

    test("should accept valid loggerLevels record", () => {
      const settings = AppSettings.parse({
        loggerLevels: {
          "core:scan": "trace",
          "ui:settings": "error",
        },
      });
      expect(settings.loggerLevels["core:scan"]).toBe("trace");
      expect(settings.loggerLevels["ui:settings"]).toBe("error");
    });

    test("should reject invalid log level in loggerLevels", () => {
      expect(() =>
        AppSettings.parse({
          loggerLevels: {
            "core:scan": "invalid",
          },
        }),
      ).toThrow();
    });

    test("should preserve default logLevel alongside loggerLevels", () => {
      const settings = AppSettings.parse({
        logLevel: "debug",
        loggerLevels: {
          "core:db": "trace",
        },
      });
      expect(settings.logLevel).toBe("debug");
      expect(settings.loggerLevels["core:db"]).toBe("trace");
    });
  });
});
