/** Where an attempt's `toHaveScreenshot` calls keep their screenshots, and what the run has written so far. */

import path from 'node:path';
import type { ArtifactSink } from './fixtures.ts';

/** Where one attempt keeps its screenshots, and how it names them. */
export interface ScreenshotContext {
  /** The project root; stored screenshots are reported relative to it. */
  readonly projectRoot: string;
  /** Absolute directory of the test file's stored screenshots, `<test file>-snapshots`. */
  readonly directory: string;
  /** Appended to every name so each target and operating system keeps its own: `-<target>-<os>`. */
  readonly suffix: string;
  /** The test's title path, which names a screenshot the test does not name. */
  readonly titlePath: readonly string[];
  /** `--update-snapshots`: a missing or different stored screenshot is written, and the matcher passes. */
  readonly update: boolean;
  /** A CI run never writes into the project: a missing screenshot is only attached to the results. */
  readonly ci: boolean;
  /**
   * Stored screenshots this run wrote, by absolute path. A retry compares
   * against what its first attempt wrote; that file is unreviewed, so it
   * fails the comparison rather than passing it.
   */
  readonly written: Set<string>;
  readonly artifacts: ArtifactSink;
  /** Whether a secret fill withholds pixels for the rest of the attempt. */
  withholdsPixels(): boolean;
}

/** What `createScreenshotContext` reads about the attempt. */
export interface ScreenshotContextOptions {
  readonly projectRoot: string;
  readonly ci: boolean;
  readonly update: boolean;
  readonly targetName: string;
  /** The test file, project-relative with `/` separators. */
  readonly file: string;
  readonly titlePath: readonly string[];
  readonly written: Set<string>;
  readonly artifacts: ArtifactSink;
  withholdsPixels(): boolean;
}

/** The screenshot context of one attempt: beside the test file, one file per target and operating system. */
export function createScreenshotContext(options: ScreenshotContextOptions): ScreenshotContext {
  return {
    projectRoot: options.projectRoot,
    directory: path.join(options.projectRoot, `${options.file}-snapshots`),
    suffix: `-${options.targetName}-${process.platform}`,
    titlePath: options.titlePath,
    update: options.update,
    ci: options.ci,
    written: options.written,
    artifacts: options.artifacts,
    withholdsPixels: options.withholdsPixels,
  };
}
