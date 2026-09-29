/**
 * Paths resolved through the filesystem, for the checks that decide whether
 * a write stays inside the project.
 */

import { realpathSync } from 'node:fs';
import path from 'node:path';

/**
 * `target` with the symlinks of its deepest existing ancestor resolved and the
 * missing tail appended as written. A log file usually does not exist yet,
 * but the directory a symlink points at does, so this is what the runner
 * would actually open. The resolved part is spelled the way the filesystem
 * stores it, so on one that ignores case `TESTS` comes back as `tests`.
 */
export function realpathOfExisting(target: string): string {
  const tail: string[] = [];
  let current = target;
  for (;;) {
    try {
      return path.join(realpathSync.native(current), ...tail);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return target;
      tail.unshift(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Whether the filesystem holding `target`'s deepest existing ancestor ignores
 * case in names, as macOS and Windows do by default: that ancestor, spelled
 * in the other case, resolves back to itself.
 */
export function ignoresCase(target: string): boolean {
  let current = target;
  for (;;) {
    let real: string;
    try {
      real = realpathSync.native(current);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return false;
      current = parent;
      continue;
    }
    const upper = real.toUpperCase();
    const other = upper === real ? real.toLowerCase() : upper;
    if (other === real) return false;
    try {
      return realpathSync.native(other) === real;
    } catch {
      return false;
    }
  }
}

/**
 * Whether `inner` is `outer` or a path below it, compared as written. A name
 * that merely starts with `..` (`..results`) is an ordinary entry below.
 */
export function isWithin(inner: string, outer: string): boolean {
  const relative = path.relative(outer, inner);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/**
 * `target` relative to the project root once both are resolved through the
 * filesystem, or undefined when it is not strictly below the root: an
 * in-project symlink pointing outside is refused, a symlinked project root
 * still counts as the root, and a name that merely starts with `..`
 * (`..logs/out.log`) is an ordinary entry.
 */
export function relativeToProjectRoot(projectRoot: string, target: string): string | undefined {
  const root = realpathOfExisting(projectRoot);
  const real = realpathOfExisting(target);
  const relative = path.relative(root, real);
  return relative !== '' && isWithin(real, root) ? relative : undefined;
}

/** Whether `target` is a path strictly below the project root; see `relativeToProjectRoot`. */
export function insideProjectRoot(projectRoot: string, target: string): boolean {
  return relativeToProjectRoot(projectRoot, target) !== undefined;
}
