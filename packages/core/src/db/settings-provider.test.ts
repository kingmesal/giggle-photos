import { describe, expect, test } from "bun:test";
import { SettingsProvider } from "./settings-provider";

describe("SettingsProvider", () => {
  describe("formatFileSize", () => {
    test("formats 24576 bytes as '24 KB' (whole number)", () => {
      expect(SettingsProvider.formatFileSize(24576)).toBe("24 KB");
    });

    test("formats 32864323 bytes as '31.3 MB' (decimal)", () => {
      expect(SettingsProvider.formatFileSize(32864323)).toBe("31.3 MB");
    });

    test("formats 1024 bytes as '1 KB'", () => {
      expect(SettingsProvider.formatFileSize(1024)).toBe("1 KB");
    });

    test("formats 1023 bytes as '1023 B' (less than 1 KB)", () => {
      expect(SettingsProvider.formatFileSize(1023)).toBe("1023 B");
    });

    test("formats 0 bytes as '0 B'", () => {
      expect(SettingsProvider.formatFileSize(0)).toBe("0 B");
    });

    test("formats 1073741824 bytes as '1 GB' (exactly 1 GB, whole number)", () => {
      expect(SettingsProvider.formatFileSize(1073741824)).toBe("1 GB");
    });

    test("formats 1048576 bytes as '1 MB' (exactly 1 MB, whole number)", () => {
      expect(SettingsProvider.formatFileSize(1048576)).toBe("1 MB");
    });

    test("formats 1536 bytes as '1.5 KB' (decimal KB)", () => {
      expect(SettingsProvider.formatFileSize(1536)).toBe("1.5 KB");
    });

    test("formats 1572864 bytes as '1.5 MB' (decimal MB)", () => {
      expect(SettingsProvider.formatFileSize(1572864)).toBe("1.5 MB");
    });

    test("formats 1099511627776 bytes as '1 TB' (exactly 1 TB, whole number)", () => {
      expect(SettingsProvider.formatFileSize(1099511627776)).toBe("1 TB");
    });

    test("formats 512 bytes as '512 B'", () => {
      expect(SettingsProvider.formatFileSize(512)).toBe("512 B");
    });

    test("formats 2048 bytes as '2 KB' (exactly 2 KB)", () => {
      expect(SettingsProvider.formatFileSize(2048)).toBe("2 KB");
    });

    test("formats 2097152 bytes as '2 MB' (exactly 2 MB, whole number)", () => {
      expect(SettingsProvider.formatFileSize(2097152)).toBe("2 MB");
    });
  });
});
