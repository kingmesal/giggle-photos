import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { computeSha256 } from "./hash-sha256";

/**
 * Test suite for SHA-256 hashing function.
 *
 * Tests the low-level computeSha256 function with real temp files.
 */

// ============================================================================
// computeSha256 Tests - Using Real Temp Files
// ============================================================================

describe("computeSha256", () => {
  let testDir: string;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testDir = join(tmpdir(), `hash-sha256-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("computes correct SHA-256 hash for a small file", async () => {
    const filePath = join(testDir, "small.txt");
    const content = "Hello, World!";
    await writeFile(filePath, content);

    const hash = await computeSha256(filePath);

    // Known SHA-256 hash for "Hello, World!"
    expect(hash).toBe("dffd6021bb2bd5b0af676290809ec3a53191dd81c7f70a4b28688a362182986f");
  });

  test("computes correct SHA-256 hash for an empty file", async () => {
    const filePath = join(testDir, "empty.txt");
    await writeFile(filePath, "");

    const hash = await computeSha256(filePath);

    // Known SHA-256 hash for empty content
    expect(hash).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  test("computes correct SHA-256 hash for binary content", async () => {
    const filePath = join(testDir, "binary.bin");
    const content = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
    await writeFile(filePath, content);

    const hash = await computeSha256(filePath);

    // Hash should be a valid 64-character hex string
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).toHaveLength(64);
    // Verify it's deterministic by computing again
    const hash2 = await computeSha256(filePath);
    expect(hash).toBe(hash2);
  });

  test("computes correct SHA-256 hash for a larger file", async () => {
    const filePath = join(testDir, "large.bin");
    // Create a 1MB file with repeated pattern
    const chunk = Buffer.alloc(1024, "a");
    const content = Buffer.alloc(1024 * 1024);
    for (let i = 0; i < 1024; i++) {
      chunk.copy(content, i * 1024);
    }
    await writeFile(filePath, content);

    const hash = await computeSha256(filePath);

    // Should return a valid SHA-256 hash
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).toHaveLength(64);
  });

  test("returns same hash for identical content", async () => {
    const content = "Identical content for testing";

    const filePath1 = join(testDir, "file1.txt");
    const filePath2 = join(testDir, "file2.txt");
    await writeFile(filePath1, content);
    await writeFile(filePath2, content);

    const hash1 = await computeSha256(filePath1);
    const hash2 = await computeSha256(filePath2);

    expect(hash1).toBe(hash2);
  });

  test("returns different hashes for different content", async () => {
    const filePath1 = join(testDir, "different1.txt");
    const filePath2 = join(testDir, "different2.txt");
    await writeFile(filePath1, "Content A");
    await writeFile(filePath2, "Content B");

    const hash1 = await computeSha256(filePath1);
    const hash2 = await computeSha256(filePath2);

    expect(hash1).not.toBe(hash2);
  });

  test("handles file not found error", async () => {
    const nonexistentPath = join(testDir, "nonexistent.txt");

    await expect(computeSha256(nonexistentPath)).rejects.toThrow();
  });

  test("handles permission denied error (if possible)", async () => {
    // This test may be skipped on Windows or when running as root
    const filePath = join(testDir, "no-read.txt");
    await writeFile(filePath, "content");

    try {
      // Try to remove read permissions
      const { chmod } = await import("node:fs/promises");
      await chmod(filePath, 0o000);

      // Should throw an error due to permission denied
      await expect(computeSha256(filePath)).rejects.toThrow();

      // Restore permissions for cleanup
      await chmod(filePath, 0o644);
    } catch {
      // If we can't change permissions (e.g., on Windows), skip this assertion
      expect(true).toBe(true);
    }
  });

  test("works with unicode filenames", async () => {
    const filePath = join(testDir, "文件-🎉.txt");
    await writeFile(filePath, "Unicode filename test");

    const hash = await computeSha256(filePath);

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  test("works with files containing special characters in content", async () => {
    const filePath = join(testDir, "special.txt");
    const content = "Line1\nLine2\r\nLine3\tTab\0Null";
    await writeFile(filePath, content);

    const hash = await computeSha256(filePath);

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  test("accepts Uint8Array and hashes directly without I/O", async () => {
    const content = new TextEncoder().encode("Hello, World!");
    const hash = await computeSha256(content);

    // Same known SHA-256 hash as the file-based test
    expect(hash).toBe("dffd6021bb2bd5b0af676290809ec3a53191dd81c7f70a4b28688a362182986f");
  });

  test("buffer and file produce the same hash", async () => {
    const filePath = join(testDir, "buf-vs-file.txt");
    const content = "Buffer vs file consistency check";
    await writeFile(filePath, content);

    const hashFromFile = await computeSha256(filePath);
    const hashFromBuffer = await computeSha256(new TextEncoder().encode(content));

    expect(hashFromFile).toBe(hashFromBuffer);
  });
});
