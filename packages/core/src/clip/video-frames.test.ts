import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { embedVideoFrames, frameArgs, frameTimestamps } from "./video-frames";

describe("frame positions", () => {
  test("10/30/50/70/90% of the duration", () => {
    expect(frameTimestamps(10)).toEqual([1, 3, 5, 7, 9]);
    expect(frameTimestamps(2.5)).toEqual([0.25, 0.75, 1.25, 1.75, 2.25]);
  });

  test("ffmpeg writes one scaled PNG frame to stdout", () => {
    expect(frameArgs("ffmpeg", "/v.mp4", 3)).toEqual([
      "ffmpeg",
      "-v",
      "error",
      "-nostdin",
      "-ss",
      "3",
      "-i",
      "/v.mp4",
      "-frames:v",
      "1",
      "-vf",
      "scale=448:-2",
      "-f",
      "image2pipe",
      "-vcodec",
      "png",
      "-",
    ]);
  });
});

const ffmpeg = Bun.which("ffmpeg");
const PNG = [0x89, 0x50, 0x4e, 0x47];

describe.skipIf(!ffmpeg)("embedVideoFrames with ffmpeg", () => {
  let dir: string;
  let video: string;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "frames-"));
    video = join(dir, "test.mp4");
    const make = Bun.spawn(
      [
        ffmpeg as string,
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc=duration=4:size=320x240:rate=10",
        "-pix_fmt",
        "yuv420p",
        video,
      ],
      { stdout: "ignore", stderr: "pipe" },
    );
    expect(await make.exited).toBe(0);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("embeds 5 PNG frames, in position order", async () => {
    const seen: number[] = [];
    const result = await embedVideoFrames(
      video,
      4,
      async (bytes) => {
        expect([...bytes.slice(0, 4)]).toEqual(PNG);
        seen.push(bytes.length);
        return [seen.length, 0];
      },
      ffmpeg as string,
    );
    expect(result.clipError).toBeUndefined();
    expect(result.clipFrames).toEqual([
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
      [5, 0],
    ]);
  });

  test("an unreadable file fails the whole video with ffmpeg's reason", async () => {
    const result = await embedVideoFrames(join(dir, "missing.mp4"), 4, async () => [1], ffmpeg as string);
    expect(result.clipFrames).toBeUndefined();
    expect(result.clipError).toMatch(/ffmpeg could not read a frame/);
  });

  test("unknown duration is refused without running ffmpeg", async () => {
    expect((await embedVideoFrames(video, 0, async () => [1])).clipError).toBe("Unknown video duration");
  });
});
