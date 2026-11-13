/** Review categories (the tabs) and how each maps to the review RPC. */
import type { FileDecisionMethod } from "../../services/processing";

export type ReviewCategory = "sha256" | "content_hash" | "phash_identical" | "phash_similar";

export const CATEGORIES: readonly ReviewCategory[] = ["sha256", "content_hash", "phash_identical", "phash_similar"];

/** The RPC FileDecisionMethod for a category. */
export function categoryToMethod(cat: ReviewCategory): FileDecisionMethod {
  if (cat === "sha256") return "sha256";
  if (cat === "content_hash") return "content_hash";
  return "phash";
}

/** The backend phashCategory filter for a category. */
export function categoryToPhashFilter(cat: ReviewCategory): "identical" | "similar" | undefined {
  if (cat === "phash_identical") return "identical";
  if (cat === "phash_similar") return "similar";
  return undefined;
}

const LABELS: Record<ReviewCategory, string> = {
  sha256: "Exact Duplicates",
  content_hash: "Same Content",
  phash_identical: "Perceptually Identical",
  phash_similar: "Perceptually Similar",
};

/** Human-readable label for a category. */
export function categoryLabel(cat: ReviewCategory): string {
  return LABELS[cat];
}

/** Active tab colours. */
export function categoryActiveColor(cat: ReviewCategory): string {
  if (cat === "sha256") return "bg-blue-600 text-white";
  if (cat === "content_hash") return "bg-purple-600 text-white";
  return "bg-orange-600 text-white";
}

/** Count badge colours on the active tab. */
export function categoryBadgeActiveColor(cat: ReviewCategory): string {
  if (cat === "sha256") return "bg-blue-500 text-white";
  if (cat === "content_hash") return "bg-purple-500 text-white";
  return "bg-orange-500 text-white";
}
