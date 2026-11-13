/**
 * ONNX Runtime session for the CLIP visual model (RFD-002 §C), with an execution-provider setting
 * and automatic fallback to CPU. Runs in the analysis worker process.
 */
import type * as Ort from "onnxruntime-node";
import type { ClipModelManifest } from "./model-manifest";

export type ExecutionProvider = "cpu" | "coreml" | "dml" | "cuda";

export interface ClipSession {
  session: Ort.InferenceSession;
  /** Provider actually in use (CPU when the requested one could not start). */
  provider: ExecutionProvider;
  /** Why the requested provider was not used, if it fell back. */
  fallbackReason?: string;
}

/** Create a session, trying `provider` first and falling back to CPU. */
export async function createClipSession(
  ort: typeof Ort,
  modelPath: string,
  options: { provider?: ExecutionProvider; threads?: number } = {},
): Promise<ClipSession> {
  const provider = options.provider ?? "cpu";
  // 4 intra-op threads by default: the default of "all cores" spins and oversubscribes when several
  // images are embedded concurrently (measured ~10× CPU per image; RFD-002).
  const base = {
    intraOpNumThreads: options.threads || 4,
    interOpNumThreads: 1,
    graphOptimizationLevel: "all" as const,
  };
  if (provider !== "cpu") {
    try {
      const session = await ort.InferenceSession.create(modelPath, { ...base, executionProviders: [provider] });
      return { session, provider };
    } catch (error) {
      const fallbackReason = error instanceof Error ? error.message : String(error);
      const session = await ort.InferenceSession.create(modelPath, { ...base, executionProviders: ["cpu"] });
      return { session, provider: "cpu", fallbackReason };
    }
  }
  return { session: await ort.InferenceSession.create(modelPath, { ...base, executionProviders: ["cpu"] }), provider };
}

/** In-place L2 normalisation; returns the input. */
export function l2Normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += (v[i] as number) ** 2;
  const norm = Math.sqrt(sum) || 1;
  for (let i = 0; i < v.length; i++) v[i] = (v[i] as number) / norm;
  return v;
}

/** Embed one preprocessed image: an L2-normalised vector of `manifest.dimensions` floats. */
export async function embedImage(
  ort: typeof Ort,
  clip: ClipSession,
  manifest: ClipModelManifest,
  input: Float32Array,
): Promise<Float32Array> {
  const size = manifest.inputSize;
  const tensor = new ort.Tensor("float32", input, [1, 3, size, size]);
  const output = await clip.session.run({ [manifest.inputName]: tensor });
  const data = output[manifest.outputName]?.data;
  if (!(data instanceof Float32Array) || data.length !== manifest.dimensions) {
    throw new Error(`Unexpected CLIP output (${data?.length ?? "none"} values)`);
  }
  return l2Normalize(new Float32Array(data));
}

/** Cosine distance (1 − dot) of two L2-normalised vectors. */
export function cosineDistance(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += (a[i] as number) * (b[i] as number);
  return 1 - dot;
}
