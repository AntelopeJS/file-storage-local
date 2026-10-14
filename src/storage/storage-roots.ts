import { isAbsolute, relative, sep } from "node:path";

const ParentSegment = "..";

function contains(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  if (!path) return true;
  return (
    !isAbsolute(path) &&
    path !== ParentSegment &&
    !path.startsWith(`${ParentSegment}${sep}`)
  );
}

export function rootsOverlap(root: string, candidate: string): boolean {
  return contains(root, candidate) || contains(candidate, root);
}
