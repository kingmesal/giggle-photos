/**
 * "Review data changed" signal between screens: e.g. the Folders screen removed a folder, so cached
 * review groups are stale. Writers call notifyReviewDataChanged(); readers key their reads on
 * useReviewDataVersion() so they re-read.
 */
import { createStore, useStore } from "../external/store";

const version = createStore(0);

export function notifyReviewDataChanged(): void {
  version.set((v) => v + 1);
}

export function getReviewDataVersion(): number {
  return version.get();
}

export function useReviewDataVersion(): number {
  return useStore(version);
}
