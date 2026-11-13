/**
 * A tiny ONNX graph, serialised by hand, for all-pairs CLIP similarity (RFD-002 §D):
 *
 *   A [rows, D] · Bᵀ [D, N] ─MatMul→ S [rows, N] ─TopK(K, axis=1, largest)→ values, indices
 *
 * Running it through ONNX Runtime uses its optimised GEMM instead of JS loops. The graph is small
 * enough that writing its protobuf directly (field numbers from onnx.proto3) is simpler than adding
 * a protobuf/ONNX builder dependency.
 */

const ONNX_FLOAT = 1;
const ONNX_INT64 = 7;
const ATTRIBUTE_INT = 2;

function varint(value: number): number[] {
  const bytes: number[] = [];
  let v = value;
  while (v > 0x7f) {
    bytes.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  bytes.push(v);
  return bytes;
}

/** Protobuf field helpers: varint (wire type 0) and length-delimited (wire type 2). */
const intField = (field: number, value: number) => [...varint(field << 3), ...varint(value)];
const bytesField = (field: number, payload: number[]) => [
  ...varint((field << 3) | 2),
  ...varint(payload.length),
  ...payload,
];
const stringField = (field: number, value: string) => bytesField(field, [...new TextEncoder().encode(value)]);

/** Dimension: a fixed size or a symbolic name. */
const dim = (d: number | string) => (typeof d === "number" ? intField(1, d) : stringField(2, d));

function valueInfo(name: string, elemType: number, shape: (number | string)[]): number[] {
  const tensorShape = shape.flatMap((d) => bytesField(1, dim(d)));
  const tensorType = [...intField(1, elemType), ...bytesField(2, tensorShape)];
  const type = bytesField(1, tensorType);
  return [...stringField(1, name), ...bytesField(2, type)];
}

function node(op: string, inputs: string[], outputs: string[], attributes: [string, number][] = []): number[] {
  return [
    ...inputs.flatMap((i) => stringField(1, i)),
    ...outputs.flatMap((o) => stringField(2, o)),
    ...stringField(3, op.toLowerCase()),
    ...stringField(4, op),
    ...attributes.flatMap(([name, value]) =>
      bytesField(5, [...stringField(1, name), ...intField(3, value), ...intField(20, ATTRIBUTE_INT)]),
    ),
  ];
}

/**
 * Model bytes. Inputs: `a` float [rows, D], `bt` float [D, n], `k` int64 [1].
 * Outputs: `values` float [rows, k] (dot products, descending), `indices` int64 [rows, k].
 */
export function buildMatMulTopKModel(dimensions: number): Uint8Array {
  const graph = [
    ...bytesField(1, node("MatMul", ["a", "bt"], ["s"])),
    ...bytesField(
      1,
      node(
        "TopK",
        ["s", "k"],
        ["values", "indices"],
        [
          ["axis", 1],
          ["largest", 1],
          ["sorted", 1],
        ],
      ),
    ),
    ...stringField(2, "clip_topk"),
    ...bytesField(11, valueInfo("a", ONNX_FLOAT, ["rows", dimensions])),
    ...bytesField(11, valueInfo("bt", ONNX_FLOAT, [dimensions, "n"])),
    ...bytesField(11, valueInfo("k", ONNX_INT64, [1])),
    ...bytesField(12, valueInfo("values", ONNX_FLOAT, ["rows", "kk"])),
    ...bytesField(12, valueInfo("indices", ONNX_INT64, ["rows", "kk"])),
  ];
  const model = [
    ...intField(1, 8), // ir_version
    ...stringField(2, "giggle-photos"),
    ...bytesField(7, graph),
    ...bytesField(8, [...stringField(1, ""), ...intField(2, 13)]), // opset_import: default domain, opset 13
  ];
  return new Uint8Array(model);
}
