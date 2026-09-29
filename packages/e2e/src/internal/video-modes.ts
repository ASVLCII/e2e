/** The video modes, in one place for every check that reads a `video` value: the config, a target, a test, and `--video`. */

import type { VideoMode } from '../types.ts';

export const VIDEO_MODES: readonly VideoMode[] = ['off', 'on', 'retain-on-failure', 'on-first-retry'];

/** Whether `value` is one of `VIDEO_MODES`. */
export function isVideoMode(value: unknown): value is VideoMode {
  return (VIDEO_MODES as readonly unknown[]).includes(value);
}
