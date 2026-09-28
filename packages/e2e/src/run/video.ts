/**
 * The runner's side of video: which attempts record and which recordings are
 * kept, from a `VideoMode` and the attempt's place in the retry loop, and the
 * step captions each kept recording gets beside it.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { VideoSegment } from '../engine/index.ts';
import type { VideoMode } from '../types.ts';
import type { StepRecord } from './steps.ts';

/** What one attempt records: which of its recordings are kept once its verdict is in. */
export interface AttemptVideo {
  readonly keep: 'always' | 'on-failure';
}

/** What an attempt at `attemptIndex` (0 for the first run, 1 for the first retry) records under `mode`; undefined records nothing. */
export function attemptVideo(mode: VideoMode, attemptIndex: number): AttemptVideo | undefined {
  switch (mode) {
    case 'off':
      return undefined;
    case 'on':
      return { keep: 'always' };
    case 'retain-on-failure':
      return { keep: 'on-failure' };
    case 'on-first-retry':
      return attemptIndex === 1 ? { keep: 'always' } : undefined;
  }
}

/** Whether any attempt of a test with `retries` records under `mode`: what the engine has to be able to honour before the run starts. */
export function recordsVideo(mode: VideoMode, retries: number): boolean {
  return mode === 'on-first-retry' ? retries >= 1 : mode !== 'off';
}

/** The steps a caption names, as the attempt recorded them. */
type CaptionedStep = Pick<StepRecord, 'index' | 'api' | 'label' | 'status' | 'startedAt' | 'durationMs'>;

/** Shortest time the last caption stays up, so a step that took a few milliseconds can still be read. */
const MIN_CAPTION_MS = 1_000;

/**
 * Writes the step captions of one kept recording as WebVTT, one cue per step
 * that ran while it recorded (`3. agent.act Sign in`, with `- failed` on a
 * step that did not pass), timed from the recording's start. A caption shows
 * the current step: it stays up until the next step starts, or as long as
 * the step ran if that is longer, and the last one at least a second. A
 * recording ends where the next one of the attempt starts. Returns the report-relative path
 * written, or undefined when no step falls inside the recording. Step labels
 * are the redacted ones the report carries, so a caption never shows a
 * secret the report does not.
 */
export function writeStepCaptions(
  dir: string,
  segment: VideoSegment,
  segmentIndex: number,
  nextStartedAt: string | undefined,
  steps: readonly CaptionedStep[],
): string | undefined {
  const start = Date.parse(segment.startedAt);
  const end = nextStartedAt === undefined ? Number.POSITIVE_INFINITY : Date.parse(nextStartedAt);
  const inside = steps
    .filter((step) => {
      const at = Date.parse(step.startedAt);
      return at >= start && at < end;
    })
    .toSorted((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  const cues = inside
    .map((step, index) => {
      const from = Date.parse(step.startedAt) - start;
      const next = inside[index + 1];
      const until = next === undefined ? from + MIN_CAPTION_MS : Date.parse(next.startedAt) - start;
      const to = Math.max(from + step.durationMs, until);
      const text = `${step.index + 1}. ${step.api} ${step.label}${step.status === 'passed' ? '' : ` - ${step.status}`}`;
      return `${cueTime(from)} --> ${cueTime(to)}\n${cueText(text)}`;
    });
  if (cues.length === 0) return undefined;
  const relative = 'path' in segment ? `${segment.path.replace(/\.[^./]+$/, '')}.steps.vtt` : path.posix.join('video', `recording-${segmentIndex + 1}.steps.vtt`);
  const absolute = path.join(dir, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, `WEBVTT\n\n${cues.join('\n\n')}\n`);
  return relative;
}

/** `hh:mm:ss.mmm`, the WebVTT timestamp of an offset in milliseconds. */
function cueTime(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/** One line of cue text: WebVTT's markup characters escaped, no line break or cue arrow that would end the cue. */
function cueText(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(/\s*\n\s*/g, ' ');
}
