/**
 * The attempt's video as its browser provider records it: one recording of
 * the browser for the whole attempt, whichever pages open and close in it,
 * ended by `stopProviderRecording` into the attempt's one segment, a file in
 * its `video` directory or a link.
 */

import type { Page } from 'playwright';
import { stopProviderRecording, type VideoSegment } from 'e2e/engine';
import { connectionAbort } from './operation-budget.ts';
import type { LeaseRecording } from './provider.ts';
import type { AttemptVideo } from './video.ts';

/** How long a recording that started after its attempt gave up gets to stop. */
const LATE_STOP_MS = 10_000;

export class ProviderVideo implements AttemptVideo {
  /** The recording covers the browser, so no page starts a segment of its own. */
  readonly isArmed = false;
  /** The provider records the browser from outside; the page's screencast stays the trace's. */
  readonly startsScreencast = false;
  private started: LeaseRecording | undefined;

  constructor(
    private readonly record: (signal: AbortSignal) => Promise<LeaseRecording>,
    private readonly artifactsDir: string,
  ) {}

  /** Starts the provider's recording; one that arrives once `signal` aborted is stopped at once, never kept. */
  async arm(_page: Page, signal: AbortSignal): Promise<void> {
    this.started = await this.record(signal);
    if (!signal.aborted) return;
    await this.abandon(AbortSignal.timeout(LATE_STOP_MS));
    throw connectionAbort(signal, 'video');
  }

  /** Pages come and go under one recording of the browser. */
  async pageOpened(): Promise<void> {}

  /** Pages come and go under one recording of the browser. */
  async pageClosing(): Promise<void> {}

  /**
   * Stops the recording as the attempt's one segment; nothing when none was
   * started. A stop that failed keeps the recording, so the attempt's close
   * tries once more instead of leaving it running on a browser later
   * attempts share.
   */
  async stop(signal: AbortSignal): Promise<readonly VideoSegment[]> {
    const started = this.started;
    if (started === undefined) return [];
    const segment = await stopProviderRecording(started.recording, {
      artifactsDir: this.artifactsDir,
      provider: started.provider,
      leaseId: started.leaseId,
      signal,
    });
    this.started = undefined;
    return [segment];
  }

  /** Stops a recording the attempt never collected, best effort and once: the attempt keeps nothing of it. */
  async abandon(signal: AbortSignal): Promise<void> {
    await this.stop(signal).catch(() => undefined);
    this.started = undefined;
  }
}
