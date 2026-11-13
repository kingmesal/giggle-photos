/**
 * CLIP image preprocessing (RFD-002 §C), from the model's preprocess_cfg.json: RGB; resize the
 * shortest side to 224 (bicubic); center-crop 224×224; scale to [0, 1]; normalize with the
 * manifest's mean/std; NCHW float32.
 *
 * Uses a reduced decode of the file bytes already in memory (JPEG shrink-on-load), EXIF-oriented
 * like the pHash, so a rotated copy embeds like its original.
 */
import type SharpType from "sharp";
import type { ClipModelManifest } from "./model-manifest";

type Sharp = typeof SharpType;

/** Model input tensor data, length 3 × size × size, channel-major. */
export async function clipInputFromBytes(
  sharp: Sharp,
  bytes: Uint8Array,
  manifest: ClipModelManifest,
): Promise<Float32Array> {
  const size = manifest.inputSize;
  const rgb = await sharp(bytes)
    .rotate()
    .removeAlpha()
    .toColourspace("srgb")
    .resize(size, size, { fit: "cover", position: "centre", kernel: "cubic" })
    .raw({ depth: "uchar" })
    .toBuffer();
  const plane = size * size;
  if (rgb.length !== plane * 3) throw new Error(`Expected ${plane * 3} RGB bytes, got ${rgb.length}`);
  const out = new Float32Array(3 * plane);
  for (let c = 0; c < 3; c++) {
    const mean = manifest.mean[c] as number;
    const std = manifest.std[c] as number;
    for (let p = 0; p < plane; p++) out[c * plane + p] = ((rgb[p * 3 + c] as number) / 255 - mean) / std;
  }
  return out;
}
