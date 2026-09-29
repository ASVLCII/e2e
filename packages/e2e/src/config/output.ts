/**
 * The output directory (`output`, `--output`): where it resolves, and the
 * checks that keep a run from clearing or writing over anything that is not
 * e2e's. Every check reads the paths the filesystem would open, symlinks
 * resolved and case folded where the filesystem ignores it, since that is
 * where the run's `rm` lands.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { ConfigurationError, errorMessage } from '../internal/errors.ts';
import { compileGlob, literalPrefix, scansDirectory } from '../internal/globs.ts';
import { ignoresCase, isWithin, realpathOfExisting } from '../internal/paths.ts';
import { toPosixPath } from '../report/write.ts';
import { DEFAULT_OUTPUT, OUTPUT_ENTRIES, OUTPUT_MARKER, OUTPUT_OWNED_DIRS } from '../run/output.ts';
import { describeValue } from './validate.ts';

/** Whether `file` is a report-1 document, which only e2e writes. */
function isReport(file: string): boolean {
  try {
    return (JSON.parse(readFileSync(file, 'utf8')) as { schemaVersion?: unknown } | null)?.schemaVersion === 'report-1';
  } catch {
    return false;
  }
}

/** How many foreign entries a refusal names before it counts the rest. */
const NAMED_ENTRIES = 3;

/**
 * Resolves the results directory, `--output` over the config's `output`,
 * from the project root. A run clears `<output>/artifacts` and writes over
 * its reports, so the directory must be one it can own: inside the project
 * root and not the root itself, not the cache directory or inside it, not
 * wrapping the cache in a directory the run clears or owns, not holding or
 * inside a directory a tests glob scans, and e2e's own (see `ownershipProblem`).
 */
export function resolveOutput(
  configured: unknown,
  flag: string | undefined,
  projectRoot: string,
  cacheDir: string,
  tests: readonly string[],
): string {
  const where = flag === undefined ? 'output' : '--output';
  const value: unknown = flag ?? configured;
  if (value !== undefined && (typeof value !== 'string' || value.trim() === '')) {
    throw new ConfigurationError('INVALID_CONFIG', `${where} must be a non-empty path relative to the project root, got ${describeValue(value)}`);
  }
  const output = path.resolve(projectRoot, (value as string | undefined) ?? DEFAULT_OUTPUT);
  const refuse = (reason: string): never => {
    throw new ConfigurationError('INVALID_CONFIG', `${where} ${JSON.stringify(value)} ${reason}`);
  };
  const fold = ignoresCase(projectRoot);
  /** A path as the filesystem opens it, in the one case a filesystem that ignores case compares in. */
  const key = (target: string): string => (fold ? realpathOfExisting(target).toLowerCase() : realpathOfExisting(target));
  const root = key(projectRoot);
  const out = key(output);
  const cache = key(cacheDir);
  if (out === root) refuse("is the project root; the run clears <output>/artifacts, so name a directory of its own, such as '.e2e'");
  if (!isWithin(out, root)) refuse(`is outside the project root ${projectRoot}; name a directory inside it`);
  if (isWithin(out, cache)) refuse(`is the cache directory ${path.relative(projectRoot, cacheDir)} or inside it; keep results and the replay cache apart`);
  for (const owned of OUTPUT_OWNED_DIRS) {
    if (isWithin(cache, path.join(out, owned))) {
      refuse(`would hold cache.dir ${path.relative(projectRoot, cacheDir)} under ${owned}/, which the run owns; move cache.dir or the output`);
    }
  }
  const exclusions = tests.filter((pattern) => pattern.startsWith('!'));
  // Globs match names as written, so the scan is judged on the real path in its stored case.
  const scanned = toPosixPath(path.relative(realpathOfExisting(projectRoot), realpathOfExisting(output)));
  for (const pattern of tests) {
    if (pattern.startsWith('!')) continue;
    const glob = compileGlob(pattern);
    const names = literalPrefix(glob);
    const globRoot = path.join(projectRoot, ...(names.length === glob.segments.length ? names.slice(0, -1) : names));
    if (isWithin(key(globRoot), out)) {
      refuse(`holds ${path.relative(projectRoot, globRoot) || '.'}, where the tests glob ${JSON.stringify(pattern)} finds test files; name a directory outside it`);
    }
    if (scansDirectory([pattern, ...exclusions], scanned)) {
      refuse(
        `is scanned by the tests glob ${JSON.stringify(pattern)}, so a file a run writes there could be collected as a test; name a directory the globs do not reach, such as '${DEFAULT_OUTPUT}', or add '!${scanned}/**' to tests`,
      );
    }
  }
  // The default, however it was spelled (`.E2E` where case is ignored, a symlink to it), is e2e's by name.
  const defaultOutput = path.join(projectRoot, DEFAULT_OUTPUT);
  if (out === key(defaultOutput)) return defaultOutput;
  const problem = ownershipProblem(realpathOfExisting(output), realpathOfExisting(cacheDir), fold);
  if (problem !== undefined) refuse(problem);
  return output;
}

/**
 * Why an existing directory is not e2e's to clear and write over, or
 * undefined when it is: it does not exist yet, carries the marker a run or a
 * session leaves (`claimOutput`), holds a report e2e wrote (an output from
 * before the marker, with a reporter's own files beside it), or holds
 * nothing but names e2e writes there and the cache directory. The default
 * `.e2e` is e2e's by name and never comes here. Both paths come resolved
 * through the filesystem, so a cache spelled in another case still matches.
 */
function ownershipProblem(output: string, cacheDir: string, fold: boolean): string | undefined {
  let entries: string[];
  try {
    if (!statSync(output).isDirectory()) return 'is a file, not a directory; name a directory for the results';
    entries = readdirSync(output);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    return `could not be read: ${errorMessage(cause)}`;
  }
  if (entries.includes(OUTPUT_MARKER) || isReport(path.join(output, 'report.json'))) return undefined;
  const cacheRelative = path.relative(output, cacheDir);
  const cacheEntry = isWithin(cacheDir, output) && cacheRelative !== '' ? cacheRelative.split(path.sep)[0] : undefined;
  const same = (a: string, b: string | undefined): boolean => b !== undefined && (fold ? a.toLowerCase() === b.toLowerCase() : a === b);
  const foreign = entries.filter((name) => !OUTPUT_ENTRIES.has(name) && !same(name, cacheEntry)).toSorted();
  if (foreign.length === 0) return undefined;
  const named = foreign.slice(0, NAMED_ENTRIES).join(', ');
  const more = foreign.length > NAMED_ENTRIES ? ` and ${foreign.length - NAMED_ENTRIES} more` : '';
  return (
    `holds ${named}${more}, which e2e did not write; a run clears <output>/artifacts and writes over report.json there, ` +
    `so name a new or empty directory, or create ${OUTPUT_MARKER} in it if the directory is e2e's`
  );
}
