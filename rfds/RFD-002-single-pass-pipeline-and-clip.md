# RFD-002: Single-Pass Analysis Pipeline + CLIP Similarity Method

## Status
Draft — 2026-11-12

## Problem

### 1. Every image is read twice and decoded twice

Current flow per image (`scan/hash-unified.ts`, `scan/sharp-worker.ts`):

| Step | Where | Reads file | Full decode |
|---|---|---|---|
| SHA-256 | main process, `hash-sha256.ts` (`Bun.file`) | #1 | — |
| Content hash | sharp worker: `sharp(fileBytes).raw()` → SHA-256 of pixels | #2 | #1 |
| pHash | sharp worker: `sharp-phash(fileBytes)` (decodes internally again) | (same bytes) | #2 |

Decode dominates cost (roughly 50–100 ms of CPU for a 12 MP JPEG). Adding a CLIP
method the same way would add a **third** full decode.

### 2. HEIC images are not analysed at all (low priority for this library)

The bundled sharp (0.35.5, libvips 8.18.7) reports `heif.input.fileSuffix = [".avif"]`:
the prebuilt binaries decode AVIF but **not HEVC-coded HEIC**. Today `contentHash` and
`perceptualHash` silently become `null` ("unsupported format") for every `.heic`; only exact
SHA-256 duplicates are found for those files.

The maintainer's library contains no iPhone photos, so this is **not on the critical path**.
It stays in scope only as: count and surface unsupported files (section B), so any stray HEIC
(e.g. from a Samsung set to HEIF, or photos shared by others) is visible, not silently skipped.

### 3. No visual-similarity method

SHA-256, content hash and pHash miss near-duplicates that differ by re-encoding
(Google "Storage saver"), resizing, cropping, filters or screenshots-of-photos. CLIP image
embeddings catch these. Immich uses the same technique for its duplicate detection, so
using the same model keeps thresholds meaningful after import.

## Proposed Solution

### A. One read, one decode, many derivatives

Move all per-image work into the existing child-process worker (keeping the
libvips/Chromium isolation):

```
read bytes once ─┬─ SHA-256(bytes)                         → sha256
                 └─ decode once → raw RGB(A) pixels
                       ├─ SHA-256(raw pixels)              → contentHash   (semantics unchanged)
                       ├─ orient → 32×32 grey → DCT        → perceptualHash
                       └─ orient → 224 crop → normalize    → CLIP embedding (ONNX Runtime)
```

- SHA-256 moves from the main process into the worker; the main process receives it in
  `SharpResponse`. Videos keep streaming SHA-256 (never load whole videos into memory).
- Derivatives are made with `sharp(raw, { raw: { width, height, channels } })`, which is
  cheap compared to a decode.
- **Orientation:** `contentHash` keeps hashing stored pixels (unchanged semantics). pHash and
  CLIP use the EXIF-oriented image, so a physically rotated copy matches an EXIF-rotated
  one. Orientation comes from `imageMetadata` (already extracted by `metadata-image.ts`).
- **pHash in-house:** replace the `sharp-phash` dependency with our own implementation in
  `hash-phash.ts` that accepts raw pixels (32×32 greyscale → 2-D DCT → top-left 8×8 →
  median threshold → 64-bit hex). It must have golden-value tests. Because the real run
  starts from a fresh Takeout and a fresh DB (RFD-003), old pHash values need not stay
  compatible, but the algorithm must be documented in the code.
- **Memory-bounded concurrency:** a 50 MP decode is about 150 MB of raw pixels. Limit
  in-flight work by a pixel-byte budget (configurable, default about 1.5 GB), not just by
  worker count.

### B. HEIC support (deferred)

Required now: count unsupported files per format and show them in the UI. A decoder is
deferred until a real library needs it; when it does, pick one in a spike:

1. A libvips/sharp build with libde265 (HEVC) — fastest, but means shipping a custom
   sharp binary on every platform.
2. **ffmpeg** (already a runtime dependency for `ffprobe`): decode the HEIC primary image to
   raw RGB, then feed the same derivative path. *(Leaning this way; ffmpeg ≥ 7 handles HEIF
   tiled images. Verify grid/tile and orientation handling.)*
3. `libheif` compiled to WASM (e.g. `heic-decode`) — portable, slower.

Whatever is chosen, unsupported files must be **counted and shown in the UI**, never
silently ignored.

### C. CLIP embeddings in-app (no external service)

- **Model:** Immich's export of OpenAI CLIP **ViT-B-32**, Hugging Face repo
  `immich-app/ViT-B-32__openai`, file `visual/model.onnx` (about 352 MB, fp32). Input is
  `[1,3,224,224]` (fixed batch of 1), output a 512-float embedding.
- **Preprocessing** (from the repo's `visual/preprocess_cfg.json`): RGB; resize shortest side
  to 224 (bicubic); center-crop 224×224; scale to [0,1]; normalize with
  mean `[0.48145466, 0.4578275, 0.40821073]`, std `[0.26862954, 0.26130258, 0.27577711]`;
  NCHW float32. L2-normalize the output before storing.
- **License (checked 2026-11-12):**
  - The Hugging Face repo `immich-app/ViT-B-32__openai` declares **no license**. Its card
    only says it holds ONNX exports of the OpenCLIP model.
  - The weights are OpenAI's CLIP ViT-B/32, released under the **MIT License**
    (`openai/CLIP` LICENSE). The OpenCLIP code is also MIT.
  - OpenAI's model card says "any deployed use case of the model — whether commercial or
    not — is currently out of scope". That is usage guidance, not a license term, and it is
    aimed at zero-shot classification. Local duplicate detection is the same use Immich ships.
  - **Decision:** fine for personal use. Downloading at runtime means the app doesn't
    redistribute the file. **Before distributing the app to others**, either export our own
    ONNX from the MIT-licensed OpenAI weights (with attribution in the app's About/licenses
    screen), or switch to an Apache-2.0 model such as SigLIP (Immich also publishes
    `ViT-B-16-SigLIP__webli`), and re-calibrate thresholds (section D).
- **Distribution: downloaded automatically as part of setup, never bundled.** The app's
  release artifacts never contain the model, so we never redistribute it. Instead, the app
  fetches it itself:
  - **When:** a first-run setup step runs on launch whenever the model is missing or fails
    verification: after a fresh install, after an app-data reset, or after a model version
    bump in an update. Electrobun has no cross-platform post-install hook, so first-run setup
    is the reliable "install-time" moment on macOS, Windows and Linux. It runs automatically,
    with a progress screen; scanning can start meanwhile (CLIP stages wait for the model).
  - **What:** a pinned revision, never `main`:

    | File | Source | SHA-256 |
    |---|---|---|
    | `visual/model.onnx` (351,613,724 bytes) | `huggingface.co/immich-app/ViT-B-32__openai` @ `a857c8de2c07bbcfa6646adfcf31b798845afa1e` | `33a3df41ceef21acdf371af00f6dd0456ec1f9eba24d03a7720f9c3734e40859` |
    | `visual/preprocess_cfg.json` | same revision | `c4fd008cd177c58a8fe107b099bac98913eaa6be6114dd59a4b45145c3c7673f` |

    (Hashes measured 2026-11-12 from the file at that revision; re-verify when pinning.)
  - **How:** stream to `<app-data>/models/<modelId>/<file>.partial`, resume on retry (HTTP `Range`),
    verify the SHA-256, then atomically rename into place. A failed hash deletes the file and
    retries; repeated failure shows an error with a retry button. The rest of the app keeps
    working without CLIP.
  - **Offline/air-gapped:** Settings → "Import model file…" accepts a manually downloaded file,
    verified against the same hash.
  - The pinned URL and hashes live in one constants file (`clip/model-manifest.ts`), so a model
    change (e.g. SigLIP) is one edit plus a re-embedding pass keyed by `modelId`.
- **Runtime:** `onnxruntime-node` inside the worker (add it to `build.bun.external`).
  Verified working under Bun 1.4.3 on linux-arm64 (`onnxruntime-node` 1.31.1, CPU backend).
- **Execution provider setting:** `cpu` (default, all platforms), plus optional `coreml`
  (macOS), `dml` (Windows) and `cuda` (Linux x64 only). Fall back to CPU automatically
  and show which provider is active.

#### Measured cost (reference machine: 20-core Arm workstation, under load ~13)

| Path | Throughput | 100k images |
|---|---|---|
| Bun + onnxruntime-node, CPU, 1 session × 4 threads | 42 img/s | about 40 min |
| Python ORT, CPU, 4 sessions × 4 threads | 80 img/s | about 21 min |
| Python ORT, CUDA (workstation GPU) | 342 img/s | about 5 min |

Desktop CPUs will differ. The point is that CPU-only is acceptable as a one-time cost,
because embeddings are stored.

### D. Comparing embeddings

Same pattern as pHash (stored per file, pairwise comparison), but it's floating point:

- Similarity = dot product of L2-normalized vectors; distance = `1 − similarity`.
- All-pairs in blocks (e.g. 2,048 rows × all) with a **tiny ONNX graph (MatMul + TopK)**
  run through the same ONNX Runtime session factory. That uses ORT's optimized GEMM instead
  of JS loops. Reference: NumPy/BLAS did 20k × 20k in 0.73 s on the reference machine (about 20 s
  projected for 100k).
- Keep only pairs under the threshold (and top-K per row) in a `clipMatches` table.
- **Thresholds.** Measured on the reference machine with this exact model and preprocessing. Five stock
  photographs (scikit-image samples) with synthetic edits; pHash column from a standard
  64-bit DCT pHash (`imagehash`, close to but not identical to sharp-phash):

  | Transform | CLIP cosine distance (min / median / max) | pHash bits (min / median / max) |
  |---|---|---|
  | JPEG q=30 recompress | 0.032 / 0.052 / 0.058 | 0 / 0 / 0 |
  | Resize to 25% | 0.019 / 0.030 / 0.045 | 0 / 0 / 0 |
  | Brightness +25% | 0.002 / 0.004 / 0.026 | 0 / 2 / 2 |
  | Grayscale | 0.031 / 0.079 / 0.100 | 0 / 0 / 0 |
  | Crop 10% | 0.006 / 0.017 / 0.032 | 8 / 12 / 18 |
  | Burst-like (shift 5%, crop 10%, +5% bright) | 0.006 / 0.016 / 0.028 | 10 / 14 / 22 |
  | Crop 25% | 0.014 / 0.039 / 0.061 | 18 / 22 / 26 |
  | Mirror | 0.002 / 0.003 / 0.017 | 30 / 32 / 32 |
  | Letterboxed / padded | 0.000 / 0.001 / 0.031 | 14 / 20 / 24 |
  | Rotated 90° (orientation lost) | 0.021 / 0.080 / 0.299 | 24 / 32 / 38 |
  | Same scene, different camera position (stereo pair) | 0.025 | 4 |
  | Unrelated photos (21 pairs) | min 0.30, median 0.51 | min 24, median 32 |

  What this means:
  - **The two methods complement each other.** pHash is near-perfect for re-encodes, resizes
    and colour changes (0–2 bits) but breaks on any geometric change (crop, mirror,
    letterbox, rotation). CLIP is the reverse: geometric edits stay small, while heavy
    recompression and grayscale cost 0.03–0.10.
  - **CLIP can't tell "same photo, edited" from "next frame of the same moment".** A different
    shot of the same scene (0.025) falls in the same range as edits. So CLIP groups are
    review-only (section G), and recompression duplicates should be caught by pHash first.
  - **Immich's default (`maxDistance` 0.01, Immich v3.4.1) is very conservative.** It would
    miss most edits above.

  Proposed bands (cosine distance), shown as a Settings slider:

  | Band | Range | Meaning | Default |
  |---|---|---|---|
  | Strong | ≤ 0.02 | Same photo: crop / mirror / brightness / letterbox | shown |
  | Probable | 0.02 – 0.06 | Heavier edit **or** burst / next frame | shown (review default cutoff **0.06**) |
  | Similar | 0.06 – 0.12 | Same subject/scene, grayscale or rotated edits, photo series | off; opt-in "similar shots" mode |
  | Unrelated | ≥ 0.30 | — | never |

  Store every pair ≤ 0.12 in `clipMatches`, so moving the slider never needs a recompute.
  Calibrate the bands on a hand-labelled sample of 200–300 real pairs before the full run:
  the numbers above come from five stock photos, not your library. Because RFD-002
  applies EXIF orientation before embedding, the rotation row should rarely occur in practice.
- **Alternative if needed:** `sqlite-vec` for KNN inside SQLite.

### E. Videos

- SHA-256 streamed (unchanged).
- CLIP: extract 5 frames at 10/30/50/70/90% of the duration with ffmpeg (already a
  dependency) straight to raw RGB → same preprocessing → store per-frame embeddings.
- Video pair candidates: durations within about 1 s (or about 1%) **and** median per-frame
  best-match distance under the video threshold.

### F. Data model

New migrations (and update `packages/core/er-diagram.html`, per `CLAUDE.md`):

- `clipEmbeddings`: `mediaFileId` (FK), `frameIndex` (0 for images), `modelId`
  (e.g. `ViT-B-32__openai@<revision>`), `embedding` BLOB (512 × float32 = 2,048 bytes),
  `createdAt`. Unique `(mediaFileId, frameIndex, modelId)`. About 200 MB per 100k images.
- `clipMatches`: `mediaFileId1`, `mediaFileId2`, `distance`, mirroring `phashMatches`.
- `FileDecisionMethod` gains `"clip"`; `reviewGroupKey` format `clip:{anchorFileId}`.
- `mediaFiles` gains `sha256` population from the worker, plus an `analysisVersion` integer
  so future algorithm changes can recompute selectively.

All five Zod schemas per table, as required by `CLAUDE.md`.

### G. Review rules

- `clip` matches are **review-only**: never pre-selected for deletion. Bursts and edits look
  alike to CLIP, and some of them are wanted.
- Group display order stays: sha256 → content_hash → phash → clip.

## Benchmarks Required (before merge)

Using the existing `StageTimer` / per-stage `*Ms` timings on a fixed sample (about 2,000 mixed
files including HEIC and video), report:

- old pipeline vs. new pipeline without CLIP (expect a large drop in decode time);
- marginal cost of enabling CLIP;
- peak RSS of the worker.

## Alternatives Considered

- **Call Immich's ML container (`/predict`) for embeddings.** Rejected: the app must work
  on its own, on a desktop, before Immich exists.
- **Python sidecar with ONNX Runtime.** Rejected: a second runtime to ship for a model that
  `onnxruntime-node` runs fine.
- **Keep sharp-phash and add a third decode for CLIP.** Rejected: wastes the dominant cost.
- **Compute CLIP only for files that survive exact matching.** Possible later
  optimization; in a single pass the decode is already paid for, so the marginal
  inference cost is all that's saved.

## Decision
Pending review.

## Implementation Notes

- Touches FRAGILE areas: hashing and DB schema. Update `_FRAGILE.md` (its hashing entry
  still names `hasher.ts` / `grouping.ts` and `scanner.ts`, which no longer exist; the
  current files are `hash-unified.ts`, `sharp-worker.ts`, `duplicate-detector.ts`,
  `file-scanner.ts`).
- Order: (1) single-pass refactor + in-house pHash + benchmarks + unsupported-format counts;
  (2) CLIP embeddings; (3) CLIP matching + review integration + threshold calibration;
  (4) video frames. (HEIC decoder deferred.)
- Respect the 300-line file limit: `clip/preprocess.ts`, `clip/session.ts`,
  `clip/model-download.ts`, `clip/model-manifest.ts`, `clip/match.ts`.

## References

- https://huggingface.co/immich-app/ViT-B-32__openai
- https://onnxruntime.ai/docs/get-started/with-javascript/node.html
- https://docs.immich.app/features/duplicates-utility
- RFD-003 (Takeout handling; fresh run), RFD-004 (review UI)
