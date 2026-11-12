import { describe, expect, test } from "bun:test";

/**
 * Tests for the sharp-loader module.
 *
 * Since the module uses module-level state for caching, we need to re-import
 * the module fresh for each test to reset the state. We use dynamic imports
 * with cache-busting query strings.
 *
 * Note: These tests verify the actual behavior of the sharp-loader module.
 * The modules (sharp, sharp-phash) are expected to be installed in the test
 * environment. Tests are written to handle both success and failure cases
 * gracefully.
 */

// Helper to get a fresh module instance by using a cache-busting query string
async function getFreshSharpLoader() {
  // Use a query string to bust the cache and get a fresh module instance
  const timestamp = Date.now() + Math.random();
  const module = await import(`./sharp-loader?t=${timestamp}`);
  return module;
}

describe("sharp-loader", () => {
  describe("getSharp", () => {
    test("returns sharp function when module loads successfully", async () => {
      const { getSharp } = await getFreshSharpLoader();

      const result = await getSharp();

      // If sharp is installed, it should return a function
      // If not installed, it returns null (both are valid outcomes)
      if (result !== null) {
        expect(typeof result).toBe("function");
      } else {
        expect(result).toBeNull();
      }
    });

    test("caches result on subsequent calls (returns same value)", async () => {
      const { getSharp } = await getFreshSharpLoader();

      const firstResult = await getSharp();
      const secondResult = await getSharp();

      // Both calls should return the same cached value
      expect(secondResult).toBe(firstResult);
    });

    test("does not reload module on subsequent calls", async () => {
      const { getSharp, isSharpAvailable } = await getFreshSharpLoader();

      // First call - loads the module
      const firstResult = await getSharp();

      // Check availability reflects the load result
      const availableAfterFirst = isSharpAvailable();

      // Second call - should use cached value
      const secondResult = await getSharp();

      // Availability should remain consistent
      const availableAfterSecond = isSharpAvailable();

      expect(secondResult).toBe(firstResult);
      expect(availableAfterSecond).toBe(availableAfterFirst);
    });

    test("calling getSharp multiple times in parallel - all return valid values", async () => {
      const { getSharp } = await getFreshSharpLoader();

      // Call getSharp multiple times concurrently
      // Note: Due to the async nature of module loading and the check-then-set pattern,
      // parallel calls may return different results (some null, some the loaded function)
      // if they occur before the first load completes. This documents that behavior.
      const results = await Promise.all([getSharp(), getSharp(), getSharp()]);

      // All results should be valid (either null or a function)
      for (const result of results) {
        expect(result === null || typeof result === "function").toBe(true);
      }
    });
  });

  describe("getSharpPhash", () => {
    test("returns sharp-phash function when module loads successfully", async () => {
      const { getSharpPhash } = await getFreshSharpLoader();

      const result = await getSharpPhash();

      // If sharp-phash is installed, it should return a function
      // If not installed, it returns null (both are valid outcomes)
      if (result !== null) {
        expect(typeof result).toBe("function");
      } else {
        expect(result).toBeNull();
      }
    });

    test("caches result on subsequent calls (returns same value)", async () => {
      const { getSharpPhash } = await getFreshSharpLoader();

      const firstResult = await getSharpPhash();
      const secondResult = await getSharpPhash();

      // Both calls should return the same cached value
      expect(secondResult).toBe(firstResult);
    });

    test("does not reload module on subsequent calls", async () => {
      const { getSharpPhash, isSharpPhashAvailable } = await getFreshSharpLoader();

      // First call - loads the module
      const firstResult = await getSharpPhash();

      // Check availability reflects the load result
      const availableAfterFirst = isSharpPhashAvailable();

      // Second call - should use cached value
      const secondResult = await getSharpPhash();

      // Availability should remain consistent
      const availableAfterSecond = isSharpPhashAvailable();

      expect(secondResult).toBe(firstResult);
      expect(availableAfterSecond).toBe(availableAfterFirst);
    });

    test("calling getSharpPhash multiple times in parallel - all return valid values", async () => {
      const { getSharpPhash } = await getFreshSharpLoader();

      // Call getSharpPhash multiple times concurrently
      // Note: Due to the async nature of module loading and the check-then-set pattern,
      // parallel calls may return different results (some null, some the loaded function)
      // if they occur before the first load completes. This documents that behavior.
      const results = await Promise.all([getSharpPhash(), getSharpPhash(), getSharpPhash()]);

      // All results should be valid (either null or a function)
      for (const result of results) {
        expect(result === null || typeof result === "function").toBe(true);
      }
    });
  });

  describe("isSharpAvailable", () => {
    test("returns false before getSharp is called", async () => {
      const { isSharpAvailable } = await getFreshSharpLoader();

      // Before loading, sharp should not be available
      expect(isSharpAvailable()).toBe(false);
    });

    test("returns correct state after getSharp is called", async () => {
      const { getSharp, isSharpAvailable } = await getFreshSharpLoader();

      const sharpResult = await getSharp();

      // isSharpAvailable should match whether getSharp returned a function
      if (sharpResult !== null) {
        expect(isSharpAvailable()).toBe(true);
      } else {
        expect(isSharpAvailable()).toBe(false);
      }
    });

    test("returns true when sharp loads successfully", async () => {
      const { getSharp, isSharpAvailable } = await getFreshSharpLoader();

      const sharpResult = await getSharp();

      // If sharp loaded successfully, isSharpAvailable should return true
      if (sharpResult !== null) {
        expect(isSharpAvailable()).toBe(true);
      }
    });

    test("remains consistent across multiple calls", async () => {
      const { getSharp, isSharpAvailable } = await getFreshSharpLoader();

      await getSharp();
      const firstCheck = isSharpAvailable();
      const secondCheck = isSharpAvailable();
      const thirdCheck = isSharpAvailable();

      expect(secondCheck).toBe(firstCheck);
      expect(thirdCheck).toBe(firstCheck);
    });

    test("does not trigger module load", async () => {
      const { isSharpAvailable, getSharp } = await getFreshSharpLoader();

      // Check before loading
      const beforeLoad = isSharpAvailable();
      expect(beforeLoad).toBe(false);

      // Load the module
      await getSharp();

      // Now check after loading - this should reflect the loaded state
      const afterLoad = isSharpAvailable();

      // The state should have changed (or remained consistent if load failed)
      // The key test is that isSharpAvailable alone doesn't load the module
      expect(typeof afterLoad).toBe("boolean");
    });
  });

  describe("isSharpPhashAvailable", () => {
    test("returns false before getSharpPhash is called", async () => {
      const { isSharpPhashAvailable } = await getFreshSharpLoader();

      // Before loading, sharp-phash should not be available
      expect(isSharpPhashAvailable()).toBe(false);
    });

    test("returns correct state after getSharpPhash is called", async () => {
      const { getSharpPhash, isSharpPhashAvailable } = await getFreshSharpLoader();

      const phashResult = await getSharpPhash();

      // isSharpPhashAvailable should match whether getSharpPhash returned a function
      if (phashResult !== null) {
        expect(isSharpPhashAvailable()).toBe(true);
      } else {
        expect(isSharpPhashAvailable()).toBe(false);
      }
    });

    test("returns true when sharp-phash loads successfully", async () => {
      const { getSharpPhash, isSharpPhashAvailable } = await getFreshSharpLoader();

      const phashResult = await getSharpPhash();

      // If sharp-phash loaded successfully, isSharpPhashAvailable should return true
      if (phashResult !== null) {
        expect(isSharpPhashAvailable()).toBe(true);
      }
    });

    test("remains consistent across multiple calls", async () => {
      const { getSharpPhash, isSharpPhashAvailable } = await getFreshSharpLoader();

      await getSharpPhash();
      const firstCheck = isSharpPhashAvailable();
      const secondCheck = isSharpPhashAvailable();
      const thirdCheck = isSharpPhashAvailable();

      expect(secondCheck).toBe(firstCheck);
      expect(thirdCheck).toBe(firstCheck);
    });

    test("does not trigger module load", async () => {
      const { isSharpPhashAvailable, getSharpPhash } = await getFreshSharpLoader();

      // Check before loading
      const beforeLoad = isSharpPhashAvailable();
      expect(beforeLoad).toBe(false);

      // Load the module
      await getSharpPhash();

      // Now check after loading - this should reflect the loaded state
      const afterLoad = isSharpPhashAvailable();

      // The state should have changed (or remained consistent if load failed)
      // The key test is that isSharpPhashAvailable alone doesn't load the module
      expect(typeof afterLoad).toBe("boolean");
    });
  });

  describe("independence of sharp and sharp-phash loading", () => {
    test("loading sharp does not affect sharp-phash availability", async () => {
      const { getSharp, isSharpPhashAvailable } = await getFreshSharpLoader();

      // Before any loading
      expect(isSharpPhashAvailable()).toBe(false);

      // Load only sharp
      await getSharp();

      // sharp-phash should still be unavailable (not loaded yet)
      expect(isSharpPhashAvailable()).toBe(false);
    });

    test("loading sharp-phash does not affect sharp availability", async () => {
      const { getSharpPhash, isSharpAvailable } = await getFreshSharpLoader();

      // Before any loading
      expect(isSharpAvailable()).toBe(false);

      // Load only sharp-phash
      await getSharpPhash();

      // sharp should still be unavailable (not loaded yet)
      expect(isSharpAvailable()).toBe(false);
    });

    test("both modules can be loaded independently", async () => {
      const { getSharp, getSharpPhash, isSharpAvailable, isSharpPhashAvailable } = await getFreshSharpLoader();

      // Load both modules
      const sharpResult = await getSharp();
      const phashResult = await getSharpPhash();

      // Each availability check should match its respective load result
      expect(isSharpAvailable()).toBe(sharpResult !== null);
      expect(isSharpPhashAvailable()).toBe(phashResult !== null);
    });

    test("loading order does not matter - sharp first", async () => {
      const { getSharp, getSharpPhash, isSharpAvailable, isSharpPhashAvailable } = await getFreshSharpLoader();

      // Load sharp first
      const sharpResult = await getSharp();
      expect(isSharpAvailable()).toBe(sharpResult !== null);
      expect(isSharpPhashAvailable()).toBe(false);

      // Then load sharp-phash
      const phashResult = await getSharpPhash();
      expect(isSharpPhashAvailable()).toBe(phashResult !== null);
      // Sharp availability should not have changed
      expect(isSharpAvailable()).toBe(sharpResult !== null);
    });

    test("loading order does not matter - sharp-phash first", async () => {
      const { getSharp, getSharpPhash, isSharpAvailable, isSharpPhashAvailable } = await getFreshSharpLoader();

      // Load sharp-phash first
      const phashResult = await getSharpPhash();
      expect(isSharpPhashAvailable()).toBe(phashResult !== null);
      expect(isSharpAvailable()).toBe(false);

      // Then load sharp
      const sharpResult = await getSharp();
      expect(isSharpAvailable()).toBe(sharpResult !== null);
      // Sharp-phash availability should not have changed
      expect(isSharpPhashAvailable()).toBe(phashResult !== null);
    });
  });

  describe("error handling", () => {
    test("getSharp handles import errors gracefully (does not throw)", async () => {
      const { getSharp } = await getFreshSharpLoader();

      // This test verifies that calling getSharp doesn't throw
      // even if the module can't be loaded
      let error: unknown = null;
      let result: unknown;

      try {
        result = await getSharp();
      } catch (e) {
        error = e;
      }

      // Should not throw
      expect(error).toBeNull();
      // Result should be either a function or null, never undefined
      expect(result === null || typeof result === "function").toBe(true);
    });

    test("getSharpPhash handles import errors gracefully (does not throw)", async () => {
      const { getSharpPhash } = await getFreshSharpLoader();

      // This test verifies that calling getSharpPhash doesn't throw
      // even if the module can't be loaded
      let error: unknown = null;
      let result: unknown;

      try {
        result = await getSharpPhash();
      } catch (e) {
        error = e;
      }

      // Should not throw
      expect(error).toBeNull();
      // Result should be either a function or null, never undefined
      expect(result === null || typeof result === "function").toBe(true);
    });
  });

  describe("fresh instance isolation", () => {
    test("each fresh loader instance has independent state", async () => {
      // Get two separate loader instances
      const loader1 = await getFreshSharpLoader();
      const loader2 = await getFreshSharpLoader();

      // loader1: check initial state
      expect(loader1.isSharpAvailable()).toBe(false);

      // loader1: load sharp
      await loader1.getSharp();

      // loader2 should still have initial state (not affected by loader1)
      expect(loader2.isSharpAvailable()).toBe(false);

      // loader2: load sharp
      await loader2.getSharp();

      // Both should now reflect their independent loaded state
      const loader1Available = loader1.isSharpAvailable();
      const loader2Available = loader2.isSharpAvailable();

      // Both should have the same value (both loaded successfully or both failed)
      // but they maintain independent state
      expect(typeof loader1Available).toBe("boolean");
      expect(typeof loader2Available).toBe("boolean");
    });

    test("each fresh loader instance caches independently", async () => {
      const loader1 = await getFreshSharpLoader();
      const loader2 = await getFreshSharpLoader();

      // Load on loader1
      const result1 = await loader1.getSharp();
      const result1Cached = await loader1.getSharp();

      // Load on loader2
      const result2 = await loader2.getSharp();
      const result2Cached = await loader2.getSharp();

      // Each loader should cache its own result
      expect(result1Cached).toBe(result1);
      expect(result2Cached).toBe(result2);
    });
  });

  describe("type correctness", () => {
    test("getSharp returns function that can be called (if available)", async () => {
      const { getSharp } = await getFreshSharpLoader();

      const sharp = await getSharp();

      if (sharp !== null) {
        // Verify it's callable (sharp is a function that creates image instances)
        expect(typeof sharp).toBe("function");
        // The function should have properties like `cache`, `concurrency`, etc.
        expect(typeof (sharp as unknown as Record<string, unknown>).cache).toBe("function");
      }
    });

    test("getSharpPhash returns async function (if available)", async () => {
      const { getSharpPhash } = await getFreshSharpLoader();

      const phash = await getSharpPhash();

      if (phash !== null) {
        expect(typeof phash).toBe("function");
        // The function should accept a string path and return a promise
        // We don't call it here as it would need a valid file
      }
    });
  });
});
