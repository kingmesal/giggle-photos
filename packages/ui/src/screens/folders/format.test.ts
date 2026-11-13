import { describe, expect, test } from "bun:test";
import type { ScanFolder } from "../../services/folders-service";
import { formatApprox, formatBytes, nextSort, sortFolders } from "./format";

const f = (id: number, path: string, priority: number) => ({ id, path, priority }) as ScanFolder;

describe("format", () => {
  test("formatBytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  test("formatApprox", () => {
    expect(formatApprox(0)).toBe("0");
    expect(formatApprox(999)).toBe("999");
    expect(formatApprox(1234)).toBe("~1.2k");
  });

  test("sortFolders by priority breaks ties by path; by name honours direction", () => {
    const folders = [f(1, "/c", 2), f(2, "/b", 1), f(3, "/a", 2)];
    expect(sortFolders(folders, { by: "priority", direction: "asc" }).map((x) => x.id)).toEqual([2, 3, 1]);
    expect(sortFolders(folders, { by: "priority", direction: "desc" }).map((x) => x.id)).toEqual([3, 1, 2]);
    expect(sortFolders(folders, { by: "name", direction: "desc" }).map((x) => x.id)).toEqual([1, 2, 3]);
  });

  test("nextSort toggles the active key and resets to asc on a new key", () => {
    expect(nextSort({ by: "name", direction: "asc" }, "name")).toEqual({ by: "name", direction: "desc" });
    expect(nextSort({ by: "name", direction: "desc" }, "priority")).toEqual({ by: "priority", direction: "asc" });
  });
});
