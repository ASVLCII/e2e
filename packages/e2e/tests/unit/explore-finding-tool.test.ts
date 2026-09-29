import { describe, expect, it } from 'vitest';
import type { ExecutorObservation, StepExecutorContext } from '../../src/agent/executor.ts';
import { ScreenPresenter } from '../../src/agent/screen-update.ts';
import { createFindingTools, FINDING_TOOL_NAME } from '../../src/explore/finding-tool.ts';
import { ExploreState } from '../../src/explore/state.ts';
import { fakeExecutorContext } from '../helpers/fake-executor-context.ts';

const LOADING = ['#root document "Saved tests"', ' #n2 status "Loading test…"'];
const LOADED = ['#root document "Saved tests"', ' #n3 heading "Checkout smoke"'];

const FINDING = {
  title: 'Opening Checkout smoke lands on an empty test page',
  kind: 'issue',
  severity: 4,
  expected: 'The saved test shows its steps',
  actual: 'The page shows only "Loading test…"',
  reproduction: ['Open Checkout smoke'],
} as const;

function screen(revision: string, lines: readonly string[]): ExecutorObservation {
  return { revision, text: lines.join('\n'), truncated: false, viewport: { width: 1280, height: 720 }, path: '/saved-tests' };
}

/**
 * A step whose model holds the loading screen while the app has already
 * rendered the test: every observe after the report reads the loaded screen.
 */
function reportOnLoading(options: { remainingMs: number; signal?: AbortSignal }) {
  const state = new ExploreState('Find bugs', { maxSteps: 1, timeoutMs: 180_000 });
  const presenter = new ScreenPresenter();
  presenter.initial(screen('b1', LOADING));
  let revision = 1;
  const observed: string[] = [];
  const base = fakeExecutorContext().context;
  const context: StepExecutorContext = {
    ...base,
    signal: options.signal ?? base.signal,
    budgets: { ...base.budgets, remainingMs: () => options.remainingMs },
    observe: async () => {
      revision += 1;
      observed.push(`b${String(revision)}`);
      return screen(`b${String(revision)}`, LOADED);
    },
  };
  const tool = createFindingTools(state)(context, presenter)[FINDING_TOOL_NAME]!;
  const run = async (): Promise<unknown> => (tool.execute as (input: unknown, options: object) => Promise<unknown>)(FINDING, { toolCallId: 'call', messages: [] });
  return { state, observed, run };
}

describe('report_finding', () => {
  it('records at once, on the evidence as reported, when the step has too little time left to look again', async () => {
    const { state, observed, run } = reportOnLoading({ remainingMs: 3_000 });
    const started = Date.now();
    expect(await run()).toMatch(/^Finding 1 recorded/);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(observed).toEqual(['b2']);
    expect(state.findings.map((finding) => finding.observationRevision)).toEqual(['b2']);
  });

  it('records the finding when the wait is cut short, rather than losing it to the hard stop', async () => {
    const controller = new AbortController();
    const { state, run } = reportOnLoading({ remainingMs: 60_000, signal: controller.signal });
    const answer = run();
    setTimeout(() => controller.abort(), 100);
    expect(await answer).toMatch(/^Finding 1 recorded/);
    expect(state.findings).toHaveLength(1);
  });

  it('holds back a report whose screen changed, then records the next report on the new screen at once', async () => {
    const { state, observed, run } = reportOnLoading({ remainingMs: 60_000 });
    const answer = String(await run());
    expect(answer).toMatch(/^Not recorded: the screen changed after revision b1/);
    expect(answer).toContain('#n3 heading "Checkout smoke"');
    expect(state.findings).toEqual([]);
    const started = Date.now();
    expect(await run()).toMatch(/^Finding 1 recorded/);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(observed).toHaveLength(3);
  });
});
