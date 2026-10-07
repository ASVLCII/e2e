/**
 * `toHaveScreenshot`: the screen, or one locator's box on it, compared
 * against a PNG stored beside the test file. Pixels come from the engine's
 * observation (`observe({ pixels: true })`), so every engine that captures
 * pixels gets visual comparison with nothing of its own to implement.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { LocatorExpression } from '../engine/surface.ts';
import { writeFileAtomic } from '../internal/atomic-write.ts';
import { TestError } from '../internal/errors.ts';
import {
  clipBox,
  compareImages,
  cropImage,
  decodePng,
  encodePng,
  fillBoxes,
  resampleImage,
  type ImageBox,
  type ImageComparison,
  type ImageTolerance,
  type RgbaImage,
} from '../internal/image.ts';
import { isPlainObject, rejectUnknownOptions } from '../internal/options.ts';
import { pollCondition, type Deadline } from '../internal/time.ts';
import { isNodeVisible } from '../locator/engine.ts';
import { describeExpression } from '../locator/expression.ts';
import { locatorInternals, type ScreenContext } from '../locator/screen.ts';
import type { ArtifactSink } from '../run/fixtures.ts';
import type { ScreenExpectation, ScreenshotOptions } from '../types.ts';

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
  /** `--update-snapshots`: a stored screenshot that differs is rewritten. */
  readonly update: boolean;
  readonly artifacts: ArtifactSink;
  /** Whether a secret fill withholds pixels for the rest of the attempt. */
  withholdsPixels(): boolean;
}

const OPTION_KEYS = ['threshold', 'maxDiffPixels', 'maxDiffPixelRatio', 'mask', 'maskColor', 'timeout'] as const;
const DEFAULT_THRESHOLD = 0.2;
const DEFAULT_MASK_COLOR: readonly [number, number, number] = [255, 0, 255];
/** Characters a stored screenshot's name may not hold: path separators, controls, and what Windows refuses in a file name. */
const UNSAFE_NAME = /[\\/<>:"|?*\p{Cc}]/u;
const MAX_TITLE_NAME_CHARS = 100;

/** One parsed call. */
interface ScreenshotCall {
  readonly api: string;
  /** The stored screenshot's name without its suffix and extension. */
  readonly stem: string;
  readonly tolerance: ImageTolerance;
  readonly masks: readonly LocatorExpression[];
  readonly maskColor: readonly [number, number, number];
  readonly timeout: number | undefined;
}

/** One capture, or why there is none yet. */
type Capture = { readonly image: RgbaImage } | { readonly missing: string };

/** Unnamed calls per attempt, keyed by the attempt's screenshot context, so names count from 1 in each attempt. */
const unnamedCalls = new WeakMap<ScreenshotContext, number>();

/** The `expect(screen)` surface. */
export function createScreenExpectation(context: ScreenContext, negated = false): ScreenExpectation {
  return {
    get not() {
      return createScreenExpectation(context, !negated);
    },
    toHaveScreenshot: (nameOrOptions?: string | ScreenshotOptions, options?: ScreenshotOptions) =>
      expectScreenshot(context, undefined, negated, nameOrOptions, options),
  };
}

/**
 * Runs one `toHaveScreenshot` call as an assertion step: of the whole screen
 * when `subject` is undefined, else of the one node it matches.
 */
export async function expectScreenshot(
  context: ScreenContext,
  subject: LocatorExpression | undefined,
  negated: boolean,
  nameOrOptions: string | ScreenshotOptions | undefined,
  maybeOptions: ScreenshotOptions | undefined,
): Promise<void> {
  const api = `expect.${negated ? 'not.' : ''}toHaveScreenshot`;
  const store = context.screenshots;
  if (store === undefined) {
    throw new TestError('UNSUPPORTED_CAPABILITY', `${api} keeps screenshots beside a test file, so it runs only inside a test`);
  }
  const call = parseCall(api, store, nameOrOptions, maybeOptions);
  const file = path.join(store.directory, `${call.stem}${store.suffix}.png`);
  const shown = path.relative(store.projectRoot, file).split(path.sep).join('/');
  const label = `${subject === undefined ? 'screen' : describeExpression(subject)} vs ${call.stem}.png`;
  await context.steps.run('assertion', api, label, async () => {
    if (store.withholdsPixels()) {
      throw new TestError('POLICY_DENIED', `${api} is denied after a secret fill because the app may display the secret outside a secure field`);
    }
    const { engine } = context;
    const deadline = engine.deadline(call.timeout ?? engine.assertionTimeout);
    if (subject !== undefined && engine.session.actions.has('scrollIntoView')) {
      await engine.performUntil(subject, { kind: 'scrollIntoView' }, deadline);
    }
    const stored = existsSync(file) ? readStored(api, file, shown) : undefined;
    if (negated && stored === undefined) {
      throw new TestError('ASSERTION_FAILED', `${api} failed\nno stored screenshot at ${shown} to differ from`, {
        details: { expected: shown },
      });
    }
    const capture = (): Promise<Capture> => captureOnce(context, api, subject, call, deadline);

    if (stored !== undefined && (negated || !store.update)) {
      let last: Capture | undefined;
      let comparison: ImageComparison | undefined;
      await pollCondition({
        deadline,
        signal: engine.signal,
        negated,
        evaluate: async () => {
          last = await capture();
          if (!('image' in last)) return undefined;
          comparison = compareImages(stored, last.image, call.tolerance);
          return comparison.kind === 'match';
        },
        onTimeout: (cause) => {
          if (negated) return failure(api, `the screen still matches ${shown}`, shown, 'matching', cause);
          if (last === undefined || !('image' in last) || comparison === undefined) {
            return failure(api, last !== undefined && 'missing' in last ? last.missing : 'no screenshot was captured', shown, 'no screenshot', cause);
          }
          return mismatch(context, store, api, call.stem, shown, stored, last.image, comparison, cause);
        },
      });
      return;
    }

    // No stored screenshot, or one to update: wait for the screen to hold
    // still, two captures in a row the same within `threshold`, and keep that.
    let previous: RgbaImage | undefined;
    let last: Capture | undefined;
    let captures = 0;
    const steady: ImageTolerance = { threshold: call.tolerance.threshold, maxDiffPixels: 0, maxDiffPixelRatio: undefined };
    const outcome: { settled?: RgbaImage; unsettled?: { previous: RgbaImage; current: RgbaImage } } = {};
    await pollCondition({
      deadline,
      signal: engine.signal,
      negated: false,
      evaluate: async () => {
        last = await capture();
        if (!('image' in last)) return undefined;
        captures += 1;
        const current = last.image;
        if (stored !== undefined && compareImages(stored, current, call.tolerance).kind === 'match') return true;
        const still = previous !== undefined && compareImages(previous, current, steady).kind === 'match';
        if (still) outcome.settled = current;
        else if (previous !== undefined) outcome.unsettled = { previous, current };
        previous = current;
        return still;
      },
      onTimeout: (cause) => {
        if (last !== undefined && 'missing' in last) return failure(api, last.missing, shown, 'no screenshot', cause);
        const { unsettled } = outcome;
        if (unsettled !== undefined) {
          attach(context, store, `${call.stem}-previous`, unsettled.previous);
          attach(context, store, `${call.stem}-actual`, unsettled.current);
          const between = compareImages(unsettled.previous, unsettled.current, { threshold: 0, maxDiffPixels: 0, maxDiffPixelRatio: undefined });
          if (between.kind === 'pixels') attach(context, store, `${call.stem}-diff`, between.diff);
        }
        const message =
          captures < 2
            ? `took ${captures} screenshot${captures === 1 ? '' : 's'} before the timeout and needs two the same; give it a longer timeout`
            : `the screen never held still: no two of ${captures} screenshots in a row were the same`;
        return failure(api, message, shown, 'no stable screenshot', cause);
      },
    });
    const { settled } = outcome;
    if (settled === undefined) return;
    mkdirSync(path.dirname(file), { recursive: true });
    await writeFileAtomic(file, encodePng(settled));
    if (stored !== undefined) return;
    attach(context, store, `${call.stem}-actual`, settled);
    throw new TestError(
      'ASSERTION_FAILED',
      `${api} failed\nno stored screenshot at ${shown}; wrote this run's there. Review it, commit it, and run again`,
      { details: { expected: shown, observed: 'no stored screenshot' } },
    );
  }, { verifies: true });
}

/** Validates the arguments and names the screenshot, before anything is read. */
function parseCall(
  api: string,
  store: ScreenshotContext,
  nameOrOptions: string | ScreenshotOptions | undefined,
  maybeOptions: ScreenshotOptions | undefined,
): ScreenshotCall {
  const named = typeof nameOrOptions === 'string';
  if (!named && nameOrOptions !== undefined && !isPlainObject(nameOrOptions)) {
    throw new TestError('INVALID_ARGUMENT', `${api} takes a name, options, or both`);
  }
  const options: ScreenshotOptions | undefined = named ? maybeOptions : (nameOrOptions ?? maybeOptions);
  rejectUnknownOptions(api, options, OPTION_KEYS);
  const threshold = fraction(api, 'threshold', options?.threshold) ?? DEFAULT_THRESHOLD;
  const maxDiffPixelRatio = fraction(api, 'maxDiffPixelRatio', options?.maxDiffPixelRatio);
  const maxDiffPixels: unknown = options?.maxDiffPixels;
  if (maxDiffPixels !== undefined && !(typeof maxDiffPixels === 'number' && Number.isInteger(maxDiffPixels) && maxDiffPixels >= 0)) {
    throw new TestError('INVALID_ARGUMENT', `${api} option maxDiffPixels must be a whole number of pixels, 0 or more`);
  }
  const timeout: unknown = options?.timeout;
  if (timeout !== undefined && !(typeof timeout === 'number' && Number.isFinite(timeout) && timeout > 0)) {
    throw new TestError('INVALID_ARGUMENT', `${api} option timeout must be a positive number of milliseconds`);
  }
  return {
    api,
    stem: named ? namedStem(api, nameOrOptions) : unnamedStem(store),
    tolerance: { threshold, maxDiffPixels, maxDiffPixelRatio },
    masks: maskExpressions(api, options?.mask),
    maskColor: options?.maskColor === undefined ? DEFAULT_MASK_COLOR : parseColor(api, options.maskColor),
    timeout,
  };
}

/** A number option from 0 to 1. */
function fraction(api: string, option: string, value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number' && value >= 0 && value <= 1) return value;
  throw new TestError('INVALID_ARGUMENT', `${api} option ${option} must be a number from 0 to 1`);
}

/** The stem of a name the test gave: `.png` dropped, anything that could leave the directory refused. */
function namedStem(api: string, name: string): string {
  const stem = name.toLowerCase().endsWith('.png') ? name.slice(0, -'.png'.length) : name;
  if (stem.trim() === '' || stem === '.' || stem === '..' || UNSAFE_NAME.test(stem)) {
    throw new TestError('INVALID_ARGUMENT', `${api} name must be a file name with no path separators, got ${JSON.stringify(name)}`);
  }
  return stem;
}

/** A name for an unnamed call: the test's title path and a count, `checkout-pays-by-card-1`. */
function unnamedStem(store: ScreenshotContext): string {
  const count = (unnamedCalls.get(store) ?? 0) + 1;
  unnamedCalls.set(store, count);
  const title = store.titlePath
    .join(' ')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_TITLE_NAME_CHARS);
  return `${title === '' ? 'screenshot' : title}-${count}`;
}

/** The `mask` option's locators as expressions. */
function maskExpressions(api: string, mask: unknown): readonly LocatorExpression[] {
  if (mask === undefined) return [];
  if (!Array.isArray(mask)) throw new TestError('INVALID_ARGUMENT', `${api} option mask must be an array of locators`);
  return mask.map((entry: unknown) => {
    const internals = locatorInternals(entry);
    if (internals === undefined) throw new TestError('INVALID_ARGUMENT', `${api} option mask must be an array of locators`);
    return internals.expression;
  });
}

/** `#rrggbb` as its three channels. */
function parseColor(api: string, color: unknown): readonly [number, number, number] {
  if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) {
    throw new TestError('INVALID_ARGUMENT', `${api} option maskColor must be a color written #rrggbb`);
  }
  return [Number.parseInt(color.slice(1, 3), 16), Number.parseInt(color.slice(3, 5), 16), Number.parseInt(color.slice(5, 7), 16)];
}

/** Reads a stored screenshot; one that is not a PNG fails the call. */
function readStored(api: string, file: string, shown: string): RgbaImage {
  try {
    return decodePng(readFileSync(file));
  } catch (cause) {
    throw new TestError('INVALID_ARGUMENT', `${api} could not read the stored screenshot ${shown} as a PNG; delete it or run with --update-snapshots`, { cause });
  }
}

/**
 * One capture at one CSS pixel per image pixel, so a screenshot is the same
 * size on every device density: cut to the subject's box when there is one,
 * the masks painted over.
 */
async function captureOnce(
  context: ScreenContext,
  api: string,
  subject: LocatorExpression | undefined,
  call: ScreenshotCall,
  deadline: Deadline,
): Promise<Capture> {
  const { engine } = context;
  let box: ImageBox | undefined;
  if (subject !== undefined) {
    const { node } = await engine.tryRead(subject, deadline);
    if (node === null) return { missing: `no node matches ${describeExpression(subject)}` };
    if (!isNodeVisible(node) || node.rect === undefined) return { missing: `${describeExpression(subject)} is not visible` };
    box = node.rect;
  }
  const observation = await engine.session.observe(engine.operationWithin(deadline), { pixels: true, comparable: true });
  if (observation.pixels === undefined) return { missing: 'the engine returned no screenshot' };
  if (observation.redaction.maskedRegionCount < observation.redaction.secureNodeCount) {
    throw new TestError('POLICY_DENIED', `${api} could not prove every secure field on screen was masked, so the screenshot is not kept`);
  }
  const { pixels } = observation;
  const raw = decodePng(pixels.data);
  const scale = pixels.scale > 0 ? pixels.scale : 1;
  let image = resampleImage(raw, Math.max(1, Math.round(raw.width / scale)), Math.max(1, Math.round(raw.height / scale)));
  let origin = { x: 0, y: 0 };
  if (box !== undefined) {
    const clipped = clipBox(image, box);
    if (clipped === undefined) return { missing: `${describeExpression(subject!)} is outside the viewport` };
    image = cropImage(image, clipped);
    origin = clipped;
  } else if (image === raw) {
    image = { ...raw, data: raw.data.slice() };
  }
  if (call.masks.length > 0) {
    const boxes: ImageBox[] = [];
    for (const mask of call.masks) {
      for (const node of await engine.readAllNow(mask)) {
        if (isNodeVisible(node) && node.rect !== undefined) {
          boxes.push({ ...node.rect, x: node.rect.x - origin.x, y: node.rect.y - origin.y });
        }
      }
    }
    fillBoxes(image, boxes, call.maskColor);
  }
  return { image };
}

/** The failure of a comparison that never matched, the stored, actual, and diff images attached. */
function mismatch(
  context: ScreenContext,
  store: ScreenshotContext,
  api: string,
  stem: string,
  shown: string,
  stored: RgbaImage,
  actual: RgbaImage,
  comparison: ImageComparison,
  cause: unknown,
): TestError {
  attach(context, store, `${stem}-expected`, stored);
  attach(context, store, `${stem}-actual`, actual);
  if (comparison.kind === 'pixels') attach(context, store, `${stem}-diff`, comparison.diff);
  const observed =
    comparison.kind === 'size'
      ? `a ${comparison.actual.width}x${comparison.actual.height} screenshot where ${shown} is ${comparison.expected.width}x${comparison.expected.height}`
      : comparison.kind === 'pixels'
        ? `${comparison.diffPixels} pixels (${formatRatio(comparison.ratio)} of the image) differ from ${shown}`
        : `matches ${shown}`;
  return failure(api, `${observed}; run with --update-snapshots to keep this run's`, shown, observed, cause);
}

/** An assertion failure naming the stored screenshot. */
function failure(api: string, message: string, shown: string, observed: string, cause: unknown): TestError {
  return new TestError('ASSERTION_FAILED', `${api} failed\n${message}`, {
    details: { expected: shown, observed },
    ...(cause === undefined ? {} : { cause }),
  });
}

/** A share as a percentage with two significant decimals at most: `0.04%`, `12.5%`. */
function formatRatio(ratio: number): string {
  return `${Number((ratio * 100).toPrecision(2))}%`;
}

/** Writes an image under the attempt's `screenshots/` and attaches it to the running step. */
function attach(context: ScreenContext, store: ScreenshotContext, name: string, image: RgbaImage): void {
  const directory = path.join(store.artifacts.dir, 'screenshots');
  mkdirSync(directory, { recursive: true });
  let relative = path.join('screenshots', `${name}.png`);
  for (let n = 2; existsSync(path.join(store.artifacts.dir, relative)); n += 1) {
    relative = path.join('screenshots', `${name}-${n}.png`);
  }
  writeFileSync(path.join(store.artifacts.dir, relative), encodePng(image));
  context.steps.attachArtifact(store.artifacts.register('screenshot', relative));
}
