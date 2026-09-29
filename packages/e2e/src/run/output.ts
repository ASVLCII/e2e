/**
 * The layout of the output directory (`output`, `--output`): every result a
 * run, an exploration, or an `e2e mcp` session writes lives at a fixed name
 * under it, so nothing derives one location from another.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** The output directory when neither the config nor `--output` names one, from the project root. */
export const DEFAULT_OUTPUT = '.e2e';

/**
 * The file a run or a session leaves in an output directory other than the
 * default, so a later one knows the directory is e2e's to clear and write
 * over whatever else a reporter put there.
 */
export const OUTPUT_MARKER = '.e2e-output';

/** The directories under the output that a run, a reporter, or a session clears or owns, which nothing else may live in. */
export const OUTPUT_OWNED_DIRS = ['artifacts', 'failures', 'mcp', 'sessions', 'videos'] as const;

/** Every name a run, a built-in reporter, or a session writes directly under the output. */
export const OUTPUT_ENTRIES: ReadonlySet<string> = new Set([
  ...OUTPUT_OWNED_DIRS,
  'report.json',
  'ai-trace.json',
  'junit.xml',
  'summary.md',
  OUTPUT_MARKER,
]);

export interface OutputLayout {
  /** The canonical `report.json`; the file reporters write beside it too (`junit.xml`, `summary.md`). */
  readonly report: string;
  /** The `--ai-trace` recording, `ai-trace.json`. */
  readonly aiTrace: string;
  /** The artifact tree the report's paths are relative to; a run with something to run clears it when it starts. */
  readonly artifacts: string;
  /** Where each `e2e mcp` session's attempt writes its artifacts, outside the tree a run clears. */
  readonly sessionArtifacts: string;
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
    sessionArtifacts: path.join(output, 'mcp'),
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
