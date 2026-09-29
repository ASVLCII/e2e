/**
 * The explorer: the built-in agent (`createAgent`) with exploration guidance
 * appended to the project's and one tool added to the project's vocabulary,
 * `report_finding`. Nothing else changes: budgets, loop guards, wind-down,
 * secrets, origin policy, and the transcript are the harness's, and each
 * exploration step runs as one ordinary `agent.act` step.
 */

import type { ToolExecutionOptions } from 'ai';
import { z } from 'zod';
import { asSdkLanguageModel } from '../agent/ai-sdk.ts';
import { createAgent, isDefaultAgent, type DefaultAgent } from '../agent/default-agent.ts';
import type { StepExecutor } from '../agent/executor.ts';
import { defineTool, getHeldScreen, getToolContext, type DefinedTool } from '../agent/tool.ts';
import { sleep } from '../internal/time.ts';
import type { ExploreState } from './state.ts';

export const FINDING_TOOL_NAME = 'report_finding';

/** Appended to the project's own guidance; the goal itself travels as agent context. */
const EXPLORE_RULES = `Exploration mode: this run has no scripted test. Each step is an exploration charter the planner wrote toward the goal given in the project context.
- Think like a curious first-time user hunting for bugs: exercise the flow the charter names end to end, with realistic inputs and edge cases. Interact, do not just look: fill forms with obviously made-up test data and submit them, save and come back to check what was kept, sign in with made-up credentials when none are configured, and when a list has several items act on one that is not the first and check that the right one changed.
- On every screen, sanity-check beyond "it renders": totals equal the sum of their parts and quantities multiply; counts match the items listed; nothing is negative that cannot be; dates are plausible and in order, not an epoch default; copy has no template tokens, placeholders, or misspellings; every control does what its name says; what a screen claims happened (saved, added, removed) is true on the next screen; a password is never shown as you type it.
- A screen still loading is not a defect: a spinner, a skeleton, "Loading…", a page that is empty right after a navigation, a control that seems dead while the route behind it is still being built. Call observe once before you report a screen as empty, blank, or dead. ${FINDING_TOOL_NAME} looks at the screen again before it records anything; when it answers that the screen changed, report only what the new screen still shows.
- Report every defect with ${FINDING_TOOL_NAME} the moment the evidence is on screen, one call per distinct defect: what you expected, what the screen shows, and the actions that reach it. Do not save findings for the conclusion: a defect that appears only in a summary is lost, since the report reads the tool, not the prose. Findings listed under "reportedFindings" in the step parameters are already recorded: never report them again and spend no actions re-confirming them.
- Accounts listed under "credentials" in the step parameters are yours to sign in with: type the username as text and fill the password with type_secret by the account's name. Never type a password as text, and never ask for one. If no type_secret tool is offered, this engine cannot fill a password securely: skip signing in, note it in the step summary, and explore what is reachable without it.
- Report defects, not wishes. A defect is something the screen breaks or contradicts: a wrong value, a dead control, a navigation that lands wrong, a claim that turns out false, leaked template text, a misspelling. A missing feature, a design choice, a form the browser refuses to submit while a required field is empty, or something you merely expected is not a defect unless the screen or the goal promised it. A failed tool call, a refused action, or a limit of this harness is not a product defect either.
- Stay inside the application under test. Do not destroy data that existed before this run (deleting accounts, wiping lists) unless the goal asks for it; creating and editing your own data is fine.
- When the charter is covered, or nothing new is reachable within it, call complete_step. "passed" means you carried the charter out, however many defects you reported on the way: reported findings never make a step fail. "failed" is only for a charter the application would not let you carry out at all: a flow that cannot be completed, a page that cannot be reached. Keep to the charter: a step is one flow, not the whole app. The summary is read by the planner of the next step: say what was covered, what was found, and what looks worth exploring next.`;

export interface ExplorerOptions {
  readonly state: ExploreState;
  /** The executor the agent the exploration runs as resolved to; undefined is the built-in agent. */
  readonly from: StepExecutor | undefined;
  /** Told when a hand-rolled executor is replaced. */
  readonly notice: (message: string) => void;
}

/**
 * Builds the explorer. An executor `createAgent` built lends its tools,
 * guidance, model, and provider options; a hand-rolled one has no readable
 * vocabulary and is replaced, with a notice, keeping the model it brought.
 */
export function createExplorer(options: ExplorerOptions): DefaultAgent {
  const { from } = options;
  const base = isDefaultAgent(from) ? from.options : undefined;
  if (from !== undefined && base === undefined) {
    options.notice(
      `the configured agent "${from.name}" is a custom executor; explore runs the built-in agent instead` +
        (from.model === undefined ? '' : ', with the model that executor brought'),
    );
  }
  const carried = base === undefined && from?.model !== undefined ? { model: asSdkLanguageModel(from.model) } : {};
  return createAgent({
    ...base,
    ...carried,
    system: [base?.system, EXPLORE_RULES].filter((part): part is string => part !== undefined && part.trim() !== '').join('\n\n'),
    tools: { ...base?.tools, [FINDING_TOOL_NAME]: createFindingTool(options.state) },
  });
}

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

/**
 * How long a finding waits before the screen is looked at again. A page still
 * in its loading state or a route a dev server is still compiling reads like
 * a defect; within this, most show what they were loading.
 */
const RECHECK_DELAY_MS = 1_500;

/**
 * The finding tool. Read-only: it observes the screen for the location and
 * the evidence pixels, records the finding against the step in progress,
 * keeps the pixels as a screenshot artifact of the step, and answers the
 * model with the finding's number so it is not reported twice.
 *
 * A finding is recorded only against a screen that held still. The first
 * report on a screen waits a beat and looks again; when the screen changed
 * from the one the model held when it reported, nothing is recorded, and the
 * model gets the new screen to confirm the finding on or drop. A report made
 * on a screen already looked at again (the confirmation, or a second finding
 * on the same screen) records at once.
 */
function createFindingTool(state: ExploreState): DefinedTool {
  let reported = 0;
  /** The revision of the newest held screen already looked at again: reports on it record at once. */
  let rechecked: string | undefined;
  return defineTool(
    {
      description:
        'Report one product defect you have evidence of on the current screen: what you expected, what the screen shows, and how to reach it. Call it the moment the evidence is visible, once per distinct defect. Not for tool errors or refused actions. The screen is looked at again before the finding is recorded; if it changed (it was still loading), the result shows the new screen and nothing is recorded until you call again.',
      inputSchema: FINDING_SCHEMA,
      execute: async (input: FindingReport, executionOptions: ToolExecutionOptions<unknown>) => {
        const { observe, attachScreenshot } = getToolContext(executionOptions);
        const screen = getHeldScreen(executionOptions);
        // Read before any await: two findings in one turn are both based on
        // the screen the model held when it made them.
        const basis = screen?.held();
        const recheck = screen !== undefined && basis !== undefined && basis.revision !== rechecked;
        if (recheck) await sleep(RECHECK_DELAY_MS, executionOptions.abortSignal);
        const observation = await observe({ pixels: true }).catch(() => undefined);
        if (recheck && observation !== undefined) {
          if (screen.differs(basis, observation)) {
            rechecked = observation.revision;
            return withheld(basis.revision, screen.update(observation));
          }
          rechecked = basis.revision;
        }
        // Numbered once the finding is certain to be recorded and before its
        // screenshot is saved: read-only tools run in parallel, so the
        // finding's own index is not known until the screenshot is kept.
        reported += 1;
        const label = `finding-${reported}`;
        // Evidence is worth keeping, never worth failing the finding for. It
        // is saved first, so the finding is announced complete, evidence included.
        const artifactId =
          observation?.pixels === undefined
            ? undefined
            : await attachScreenshot(observation.pixels, label).catch(() => undefined);
        const finding = state.addFinding({ ...input, path: observation?.path, observationRevision: observation?.revision, artifactId });
        return `Finding ${finding.index + 1} recorded (${finding.kind}, severity ${finding.severity}): ${finding.title}. Do not report it again; continue the charter or conclude the step.`;
      },
    },
    { mutates: false },
  );
}

/** The answer to a report whose screen moved on: the new screen, and the choice of confirming or dropping. */
function withheld(basisRevision: string, update: string): string {
  return [
    `Not recorded: the screen changed after revision ${basisRevision}, the one this finding is based on, so it was likely still loading.`,
    update,
    `If the defect still shows on this screen, call ${FINDING_TOOL_NAME} again, with what the screen shows now, to record it. If the screen now works as expected, it was not a defect: do not report it, and continue the charter.`,
  ].join('\n\n');
}
