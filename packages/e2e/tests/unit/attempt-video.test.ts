/** Which attempts record and keep a video under each mode, and the WebVTT step captions a kept recording gets. */

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { attemptVideo, recordsVideo, writeStepCaptions } from '../../src/run/video.ts';

describe('attemptVideo', () => {
  it('records every attempt for on and retain-on-failure, keeping all or only failures', () => {
    expect([0, 1, 2].map((index) => attemptVideo('on', index))).toEqual([{ keep: 'always' }, { keep: 'always' }, { keep: 'always' }]);
    expect(attemptVideo('retain-on-failure', 0)).toEqual({ keep: 'on-failure' });
    expect(attemptVideo('retain-on-failure', 3)).toEqual({ keep: 'on-failure' });
  });

  it('records nothing for off, and only the first retry for on-first-retry', () => {
    expect(attemptVideo('off', 0)).toBeUndefined();
    expect([0, 1, 2].map((index) => attemptVideo('on-first-retry', index))).toEqual([undefined, { keep: 'always' }, undefined]);
  });
});

describe('recordsVideo', () => {
  it('asks the engine for video only when some attempt records', () => {
    expect(recordsVideo('off', 3)).toBe(false);
    expect(recordsVideo('on', 0)).toBe(true);
    expect(recordsVideo('retain-on-failure', 0)).toBe(true);
    expect(recordsVideo('on-first-retry', 0)).toBe(false);
    expect(recordsVideo('on-first-retry', 1)).toBe(true);
  });
});

describe('writeStepCaptions', () => {
  let dir: string;
  const setup = () => {
    dir = mkdtempSync(path.join(tmpdir(), 'e2e-captions-'));
    mkdirSync(path.join(dir, 'video'));
    return dir;
  };
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const step = (index: number, startedAt: string, durationMs: number, extra: { api?: string; label?: string; status?: 'passed' | 'failed' } = {}) => ({
    index,
    api: extra.api ?? 'tap',
    label: extra.label ?? `getByRole('button', { name: 'Step ${index}' })`,
    status: extra.status ?? ('passed' as const),
    startedAt,
    durationMs,
  });

  it('writes one cue per step, timed from the recording start, each up until the next step starts, beside the video file', () => {
    setup();
    const segment = { path: 'video/video.webm', startedAt: '2026-09-28T10:00:00.000Z' };
    const relative = writeStepCaptions(dir, segment, 0, undefined, [
      step(0, '2026-09-28T10:00:01.500Z', 2_250, { api: 'agent.act', label: 'Sign in as <admin> & continue' }),
      step(1, '2026-09-28T10:01:02.000Z', 10, { status: 'failed' }),
    ]);
    expect(relative).toBe('video/video.steps.vtt');
    expect(readFileSync(path.join(dir, relative!), 'utf8')).toBe(
      [
        'WEBVTT',
        '',
        '00:00:01.500 --> 00:01:02.000',
        '1. agent.act Sign in as &lt;admin&gt; &amp; continue',
        '',
        '00:01:02.000 --> 00:01:03.000',
        "2. tap getByRole('button', { name: 'Step 1' }) - failed",
        '',
      ].join('\n'),
    );
  });

  it('keeps a step to the recording it ran in, ending one recording where the next begins, and a long step up for its whole run', () => {
    setup();
    const first = { path: 'video/video.webm', startedAt: '2026-09-28T10:00:00.000Z' };
    const steps = [step(0, '2026-09-28T10:00:01.000Z', 100), step(1, '2026-09-28T10:00:05.000Z', 100)];
    writeStepCaptions(dir, first, 0, '2026-09-28T10:00:04.000Z', steps);
    const text = readFileSync(path.join(dir, 'video/video.steps.vtt'), 'utf8');
    expect(text).toContain('1. tap');
    expect(text).not.toContain('2. tap');
    writeStepCaptions(dir, first, 0, undefined, [step(0, '2026-09-28T10:00:01.000Z', 5_000), step(1, '2026-09-28T10:00:02.000Z', 100)]);
    expect(readFileSync(path.join(dir, 'video/video.steps.vtt'), 'utf8')).toContain('00:00:01.000 --> 00:00:06.000\n1. tap');
  });

  it('names a link recording by its place in the attempt, and writes nothing without a step inside it', () => {
    setup();
    const link = { url: 'https://recordings.example/r.mp4', mediaType: 'video/mp4', startedAt: '2026-09-28T10:00:00.000Z' };
    expect(writeStepCaptions(dir, link, 1, undefined, [step(0, '2026-09-28T10:00:01.000Z', 5)])).toBe('video/recording-2.steps.vtt');
    expect(writeStepCaptions(dir, link, 0, undefined, [step(0, '2026-09-28T09:59:59.000Z', 5)])).toBeUndefined();
  });
});
