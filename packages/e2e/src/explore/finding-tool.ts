/**
 * `report_finding`, the one tool the explorer adds to the project's
 * vocabulary. A host tool (`createHostedAgent`): it reads the screen the
 * model holds, so a finding made on a screen that was still loading is held
 * back until the model has seen the screen it became.
 */

import type { Tool, ToolSet } from 'ai';
import { z } from 'zod';
import type { HostTools } from '../agent/default-agent.ts';
import type { ExecutorObservation, StepExecutorContext } from '../agent/executor.ts';
import type { ScreenPresenter } from '../agent/screen-update.ts';
import type { ToolLoopHelpers } from '../agent/tool-loop.ts';
import { sleep } from '../internal/time.ts';
import type { ExploreState } from './state.ts';

export const FINDING_TOOL_NAME = 'report_finding';

/**
 * How long a first report on a screen waits before the screen is looked at
 * again. A page in its loading state or a route a dev server is still
 * compiling reads like a defect; within this, most show what they loaded.
 */
const RECHECK_DELAY_MS = 1_500;

/**
 * Step time the look again leaves for recording: one settled observe and the
 * screenshot. With less than the wait plus this left, the finding is recorded
 * as it was reported rather than lost to the step's deadline.
 */
const RECHECK_RESERVE_MS = 5_000;

const FINDING_SCHEMA = z.object({
  title: z
    .string()
    .min(4)
    .max(200)
    .describe('A specific headline for the defect under 80 characters, e.g. "Checkout total shows $0.00 with two items in the cart".'),
  kind: z
    .enum(['issue', 'warning'])
    .describe(
      'issue = a defect a user would hit: a broken flow, wrong data, a dead control, a navigation that lands wrong. warning = cosmetic or polish; blocks no task.',
    ),
  severity: z
    .literal([1, 2, 3, 4, 5])
    .describe(
      '5: a core journey is impossible, data is lost, or money or security is wrong. 4: a core feature is broken but a workaround exists, or wrong money or quantity values are shown. 3: a secondary feature is broken, or wrong non-monetary content. 2: a cosmetic or layout defect that blocks nothing. 1: a trivial polish item (usually a warning).',
    ),
  expected: z.string().min(1).max(2000).describe('What a user would expect here, in one sentence.'),
  actual: z.string().min(1).max(2000).describe('What the screen shows instead, in one sentence, quoting the text on screen.'),
  reproduction: z
    .array(z.string().min(1).max(500))
    .min(1)
    .max(20)
    .describe('The actions that reach the defect from the start of the app, one short imperative per entry, e.g. "Open the cart".'),
});

type FindingReport = z.output<typeof FINDING_SCHEMA>;

const DESCRIPTION =
  'Report one product defect you have evidence of on the current screen: what you expected, what the screen shows, and how to reach it. Call it the moment the evidence is visible, once per distinct defect. Not for tool errors or refused actions. The screen is looked at again before a finding is recorded; if it changed (it was still loading), the result shows the new screen and nothing is recorded until you call again.';

/**
 * The finding tool, one per exploration. Read-only: it observes the screen
 * for the location and the evidence pixels, records the finding against the
 * step in progress, keeps the pixels as a screenshot artifact of the step,
 * and answers the model with the finding's number so it is not reported
 * twice.
 *
 * A finding is recorded only against a screen that held still. The first
 * report on a screen takes its evidence, waits a beat, and looks again; when
 * the screen differs from the one the model held when it reported, nothing is
 * recorded, and the model gets the new screen to report on again or drop. A
 * report on a screen already looked at again (the confirmation, or a second
 * finding on the same screen) records at once. The look again never costs a
 * finding: a step close to its deadline or its last working turn, a wait
 * cut short, or an action the model made in the same turn records the
 * finding on its evidence as is.
 */
export function createFindingTools(state: ExploreState): HostTools {
  const recorder: Recorder = { state, reported: 0, rechecked: undefined };
  return (context, screen, loop): ToolSet => ({
    [FINDING_TOOL_NAME]: {
      description: DESCRIPTION,
      inputSchema: FINDING_SCHEMA,
      execute: (input: FindingReport) =>
        context.budgets.runTool({ name: FINDING_TOOL_NAME, mutates: false }, () => report(recorder, { context, screen, loop }, input)),
    } as Tool,
  });
}

/** What the tool keeps across the exploration's steps. */
interface Recorder {
  readonly state: ExploreState;
  /** Findings recorded so far; each names its screenshot. */
  reported: number;
  /** The revision of the newest held screen already looked at again: reports on it record at once. */
  rechecked: string | undefined;
}

/** What one report runs against: the step, the screen its model holds, and the loop it runs in. */
interface Step {
  readonly context: StepExecutorContext;
  readonly screen: ScreenPresenter;
  readonly loop: Pick<ToolLoopHelpers, 'nextTurnWorks'>;
}

/**
 * Whether a report held back now could still be confirmed: the step has
 * `ms` left, and the next turn still offers this tool. Before the wait that
 * is the wait and the recording; after it, the recording alone.
 */
function canConfirm({ context, loop }: Step, ms: number): boolean {
  return context.budgets.remainingMs() >= ms && loop.nextTurnWorks();
}

/** One report: recorded, or held back with the screen it became. */
async function report(recorder: Recorder, step: Step, input: FindingReport): Promise<string> {
  const { context, screen } = step;
  // Read before any await: two findings in one turn are both based on the
  // screen the model held when it made them, and an action the model made
  // beside the report is told apart from the app moving on its own.
  const basis = screen.held();
  const actions = context.budgets.actionsUsed();
  const evidence = await context.observe({ pixels: true }).catch(() => undefined);
  if (basis !== undefined && basis.revision !== recorder.rechecked && canConfirm(step, RECHECK_DELAY_MS + RECHECK_RESERVE_MS)) {
    const waited = await sleep(RECHECK_DELAY_MS, context.signal).then(() => true, () => false);
    const again = waited ? await context.observe().catch(() => undefined) : undefined;
    // The model's own action moved the screen, not the app: the report stands on its evidence.
    const acted = context.budgets.actionsUsed() !== actions;
    if (again !== undefined && !acted && canConfirm(step, RECHECK_RESERVE_MS)) {
      if (screen.differs(basis, again)) {
        const update = screen.update(again);
        recorder.rechecked = again.revision;
        return withheld(basis.revision, update);
      }
      recorder.rechecked = basis.revision;
    }
  }
  return record(recorder, context, input, evidence);
}

/** Records the finding with the evidence taken when it was reported. */
async function record(
  recorder: Recorder,
  context: StepExecutorContext,
  input: FindingReport,
  evidence: ExecutorObservation | undefined,
): Promise<string> {
  // Numbered before the screenshot is saved: reports run in parallel, and the
  // finding's own index is not known until its screenshot is kept.
  recorder.reported += 1;
  const label = `finding-${recorder.reported}`;
  // Evidence is worth keeping, never worth failing the finding for. It is
  // saved first, so the finding is announced complete, evidence included.
  const artifactId =
    evidence?.pixels === undefined ? undefined : await context.attachScreenshot(evidence.pixels, label).catch(() => undefined);
  const finding = recorder.state.addFinding({ ...input, path: evidence?.path, observationRevision: evidence?.revision, artifactId });
  return `Finding ${finding.index + 1} recorded (${finding.kind}, severity ${finding.severity}): ${finding.title}. Do not report it again; continue the charter or conclude the step.`;
}

/** The answer to a report whose screen moved on: what to do first, then the new screen, whole. */
function withheld(basisRevision: string, update: string): string {
  return [
    `Not recorded: the screen changed after revision ${basisRevision}, the one this finding is based on, so it was likely still loading. If the defect still shows on the screen below, call ${FINDING_TOOL_NAME} again, with what the screen shows now, to record it. If the screen now works as expected, it was not a defect: do not report it, and continue the charter.`,
    update,
  ].join('\n\n');
}
