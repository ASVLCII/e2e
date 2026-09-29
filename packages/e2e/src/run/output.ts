/**
 * The layout of the output directory (`output`, `--output`): every result a
 * run, an exploration, or an `e2e mcp` session writes lives at a fixed name
 * under it, so nothing derives one location from another.
 */

import type { Dirent } from 'node:fs';
import { lstat, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { uuidv7Time } from '../internal/ids.ts';

/** The output directory when neither the config nor `--output` names one, from the project root. */
export const DEFAULT_OUTPUT = '.e2e';

/**
 * The file a run or a session leaves in an output directory other than the
 * default, so a later one knows the directory is e2e's to clear and write
 * over whatever else a reporter put there.
 */
export const OUTPUT_MARKER = '.e2e-output';

/** How long an `e2e mcp` session may live, whatever happens. */
export const SESSION_TTL_MS = 4 * 60 * 60 * 1000;
/** How long a session's attempt outlives its step, so a step that hit the TTL is still closed in order. */
export const SESSION_CLOSE_GRACE_MS = 60 * 1000;

/**
 * How long after its attempt id was minted an `e2e mcp` session may still be
 * writing: the TTL and its grace, plus an hour for the launch before the
 * clock starts and the close after it ends.
 */
const SESSION_RETENTION_MS = SESSION_TTL_MS + SESSION_CLOSE_GRACE_MS + 60 * 60 * 1000;

/** The directory under `<artifacts>/<target>/` that holds each `e2e mcp` session attempt's artifacts. */
export const SESSION_ARTIFACTS = 'sessions';

/** The directories under the output that a run, a reporter, or a session clears or owns, which nothing else may live in. */
export const OUTPUT_OWNED_DIRS = ['artifacts', 'failures', 'sessions', 'videos'] as const;

export interface OutputLayout {
  /** The canonical `report.json`; the file reporters write beside it too (`junit.xml`, `summary.md`). */
  readonly report: string;
  /** The `--ai-trace` recording, `ai-trace.json`. */
  readonly aiTrace: string;
  /**
   * The artifact tree the report's paths are relative to; a run with
   * something to run clears it when it starts (`clearArtifacts`). An `e2e
   * mcp` session writes under `<target>/sessions/<attempt>/` in it.
   */
  readonly artifacts: string;
  /** The per-run encrypted session stores. */
  readonly sessions: string;
  /** Where `e2e mcp` saves one session's recordings. */
  readonly videos: (sessionId: string) => string;
}

/** The fixed paths under the absolute output directory `output`. */
export function outputLayout(output: string): OutputLayout {
  return {
    report: path.join(output, 'report.json'),
    aiTrace: path.join(output, 'ai-trace.json'),
    artifacts: path.join(output, 'artifacts'),
    sessions: path.join(output, 'sessions'),
    videos: (sessionId) => path.join(output, 'videos', sessionId),
  };
}

/**
 * Creates the output directory and marks it as e2e's, before a run or a
 * session writes anything there. The default `.e2e` is e2e's by name and
 * gets no marker, so a project's `.gitignore` entries for it stay complete.
 */
export async function claimOutput(output: string, projectRoot: string): Promise<void> {
  await mkdir(output, { recursive: true });
  if (output === path.join(projectRoot, DEFAULT_OUTPUT)) return;
  try {
    await writeFile(path.join(output, OUTPUT_MARKER), 'e2e writes its results here: a run clears artifacts/ and writes over report.json.\n', {
      flag: 'wx',
    });
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause;
  }
}

/**
 * Empties the artifact tree for a run, keeping what a live `e2e mcp` session
 * may still be writing: `<target>/sessions/<attempt>/` whose attempt id, a
 * UUIDv7, was minted within the longest a session can live. An older one,
 * or one whose name carries no time, belonged to a session that has ended.
 * Symlinks are removed, never followed, so a link in the tree cannot reach
 * files outside it.
 */
export async function clearArtifacts(artifacts: string, now: number = Date.now()): Promise<void> {
  const remove = (entry: string): Promise<void> => rm(entry, { recursive: true, force: true });
  if (!(await isDirectory(artifacts))) return remove(artifacts);
  for (const target of await entriesOf(artifacts)) {
    const targetDir = path.join(artifacts, target.name);
    if (!target.isDirectory()) {
      await remove(targetDir);
      continue;
    }
    for (const entry of await entriesOf(targetDir)) {
      const entryPath = path.join(targetDir, entry.name);
      if (entry.name !== SESSION_ARTIFACTS || !entry.isDirectory()) {
        await remove(entryPath);
        continue;
      }
      for (const attempt of await entriesOf(entryPath)) {
        const minted = uuidv7Time(attempt.name);
        if (minted === undefined || now - minted > SESSION_RETENTION_MS) await remove(path.join(entryPath, attempt.name));
      }
    }
  }
}

/** Whether `target` is itself a directory, not a symlink to one; false when it is anything else or missing. */
async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await lstat(target)).isDirectory();
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw cause;
  }
}

/** The entries of `dir`, none when it does not exist. */
async function entriesOf(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw cause;
  }
}
