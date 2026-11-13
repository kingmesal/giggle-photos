import { describe, expect, test } from "bun:test";
import { formatLogArgs } from "./logger";

describe("file log line", () => {
  test("keeps the error after the message (it used to be dropped)", () => {
    const error = Object.assign(new Error("i/o error, read"), { code: "EIO" });
    expect(formatLogArgs({ 0: "Failed to extract metadata for /p/a.jpg:", 1: error })).toBe(
      "Failed to extract metadata for /p/a.jpg: Error EIO: i/o error, read",
    );
  });

  test("context objects are JSON, nested errors readable", () => {
    expect(formatLogArgs({ 0: "Quarantine restored", 1: { restored: 3, problems: 0 } })).toBe(
      'Quarantine restored {"restored":3,"problems":0}',
    );
    expect(formatLogArgs({ 0: "Failed", 1: { error: new TypeError("bad") } })).toBe(
      'Failed {"error":"TypeError: bad"}',
    );
  });

  test("a plain message is unchanged", () => {
    expect(formatLogArgs({ 0: "Pipeline Stage 3: Hash Computation" })).toBe("Pipeline Stage 3: Hash Computation");
  });
});
