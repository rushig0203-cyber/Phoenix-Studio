import path from "node:path";
import fs from "node:fs/promises";
import { reviewRoot } from "./reviewFiles";

/** Paths are relative to Review Files. IDs, not rank/display order, own artifacts. */
export type ReviewArtifacts = {
  version: 1;
  renderRevision: string;
  finalVideo: string;
  editing: { video: string; offsetSeconds: number; captionsBaked: boolean; replacementAudio?: string };
  captions?: string;
  narration?: string;
  music?: string;
  original?: string;
};

export function artifactReference(filename: string) {
  const relative = path.relative(path.resolve(reviewRoot()), path.resolve(filename));
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) throw new Error("Artifact must be inside Phoenix Studio Review Files.");
  return relative.split(path.sep).join("/");
}

export async function resolveArtifact(reference: string) {
  if (typeof reference !== "string" || !reference || reference.includes("\\") || reference.includes(":") || reference.split("/").some(part => !part || part === "." || part === "..")) throw new Error("Invalid saved artifact reference.");
  const candidate = path.resolve(reviewRoot(), reference);
  artifactReference(candidate);
  // Check real paths as well, so a symlink/junction cannot expose arbitrary files.
  const [root, actual] = await Promise.all([fs.realpath(reviewRoot()), fs.realpath(candidate)]);
  const relative = path.relative(root, actual);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !(await fs.stat(actual)).isFile()) throw new Error("Saved artifact is outside the review folder or is not a file.");
  return actual;
}
