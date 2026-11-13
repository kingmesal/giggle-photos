/**
 * The CLIP model the app downloads at first-run setup (RFD-002 §C). Pinned: a revision, never
 * `main`, with sizes and SHA-256 hashes measured from that revision. Changing the model (e.g. to an
 * Apache-2.0 SigLIP export) is one edit here plus a re-embedding pass keyed by `id`.
 *
 * License note (RFD-002 §C): the Hugging Face repo declares no license; the weights are OpenAI's
 * MIT-licensed CLIP ViT-B/32. The app downloads the file at runtime and never redistributes it.
 * Before shipping release builds to others, export our own ONNX from the MIT weights (with
 * attribution) or switch to an Apache-2.0 model, and re-calibrate the thresholds.
 */

export interface ModelFile {
  /** File name on disk inside the model directory. */
  name: string;
  /** Path inside the repository. */
  repoPath: string;
  bytes: number;
  sha256: string;
  /** Required for the model to be "ready". Optional files are fetched best-effort. */
  required: boolean;
}

export interface ClipModelManifest {
  /** Stored with every embedding; embeddings from another model id are never compared. */
  id: string;
  repo: string;
  revision: string;
  files: ModelFile[];
  /** ONNX graph input/output names and shapes. */
  inputName: string;
  outputName: string;
  inputSize: number;
  dimensions: number;
  mean: [number, number, number];
  std: [number, number, number];
}

const REVISION = "a857c8de2c07bbcfa6646adfcf31b798845afa1e";

export const CLIP_MODEL: ClipModelManifest = {
  id: `ViT-B-32__openai@${REVISION}`,
  repo: "immich-app/ViT-B-32__openai",
  revision: REVISION,
  files: [
    {
      name: "model.onnx",
      repoPath: "visual/model.onnx",
      bytes: 351_613_724,
      sha256: "33a3df41ceef21acdf371af00f6dd0456ec1f9eba24d03a7720f9c3734e40859",
      required: true,
    },
    {
      name: "preprocess_cfg.json",
      repoPath: "visual/preprocess_cfg.json",
      bytes: 197,
      sha256: "c4fd008cd177c58a8fe107b099bac98913eaa6be6114dd59a4b45145c3c7673f",
      // Reference copy of the preprocessing (its values are in this manifest); not needed to run.
      required: false,
    },
  ],
  inputName: "image",
  outputName: "embedding",
  inputSize: 224,
  dimensions: 512,
  mean: [0.48145466, 0.4578275, 0.40821073],
  std: [0.26862954, 0.26130258, 0.27577711],
};

/** Download URL of one model file at the pinned revision. */
export function modelFileUrl(manifest: ClipModelManifest, file: ModelFile): string {
  return `https://huggingface.co/${manifest.repo}/resolve/${manifest.revision}/${file.repoPath}`;
}

/** Directory name for a model id (safe on every filesystem). */
export function modelDirName(manifest: ClipModelManifest): string {
  return manifest.id.replace(/[^A-Za-z0-9._-]/g, "_");
}

/** The ONNX model file entry (the large one). */
export function onnxFile(manifest: ClipModelManifest): ModelFile {
  const file = manifest.files.find((f) => f.name.endsWith(".onnx"));
  if (!file) throw new Error(`Manifest ${manifest.id} has no .onnx file`);
  return file;
}
