/**
 * Deterministic target relocation.
 *
 * Re-finds a recorded target descriptor in a fresh observation: exactly one
 * node must match, or replay diverges. This is the conservative public
 * ReplayPolicy — no scoring, no fuzzy matching, no vision. A tuned policy may
 * replace it behind the same seam; the fail-closed contract (one match or
 * hand off) is not tunable.
 *
 * Candidates are compared through the same `describeTarget` projection the
 * recorder used, so redaction, whitespace collapsing, and bounding cannot
 * make a node unequal to its own recording. The matching vocabulary — the
 * fields a test id or a label identifies a node by, and how labels are
 * compared — is exported so end anchors (`anchors.ts`) are checked by the
 * same rules and can never drift from relocation.
 */

import type { SemanticNode } from '../engine/surface.ts';
import { containerKey, describeTarget, parentsOf } from '../agent/actions.ts';
import type { TracePosition, TraceTargetDescriptor } from './trace.ts';

/**
 * Version of the replay/relocation policy, part of every cache key. Bumping
 * it cold-starts the cache — which is exactly right when the matching rules
 * change, because an entry recorded under different rules could relocate to a
 * different node.
 */
export const REPLAY_POLICY_VERSION = 'conservative/6';

/**
 * The share of the viewport a scrolled node must have covered when it was
 * addressed (`ScrollAction.spans`) to scroll as the viewport does once it
 * cannot be re-found: scrolling the main list and scrolling the screen are
 * the same gesture, while a smaller region that vanished is gone.
 */
export const MAIN_LIST_SHARE = 0.5;

export type RelocationFailure = 'target-not-found' | 'target-ambiguous';

export type RelocationResult =
  | { readonly kind: 'found'; readonly id: string }
  | { readonly kind: 'failed'; readonly failure: 'target-not-found' }
  /** Several nodes share the matched identity; a caller with other evidence (a recorded point) may still tell them apart. */
  | { readonly kind: 'failed'; readonly failure: 'target-ambiguous'; readonly candidates: readonly string[] };

export type DescriptorField = keyof TraceTargetDescriptor;

export interface DescriptorMatchOptions {
  readonly redact: (text: string) => string;
}

/** A node's descriptor projection alongside its per-observation id. */
export interface DescribedNode {
  readonly id: string;
  readonly descriptor: TraceTargetDescriptor;
}

/**
 * The fields a recorded test id identifies a control by: the id and what the
 * control is, never what it says. A label in many apps carries state
 * (`Like (0 likes)`, a row named after its contents and age); the test id is
 * the app's own stable handle. Twins sharing an id resolve by the recorded
 * position, never by whichever label happens to match now.
 */
const TEST_ID_FIELDS: readonly DescriptorField[] = ['role', 'testId', 'placeholder', 'inputPurpose'];

/** What a control is apart from any id: the fields a label-matched tier compares verbatim. */
export const SEMANTIC_ID_FIELDS: readonly DescriptorField[] = ['role', 'placeholder', 'inputPurpose'];

/** Every field a descriptor can carry as identity; an anonymous descriptor must equal a candidate on all of them. */
const ALL_IDENTITY_FIELDS: readonly DescriptorField[] = ['role', 'name', 'text', 'testId', 'placeholder', 'inputPurpose'];

/** The fields a control is labelled by. Text counts only when no name was recorded: a relabeled button is still the button. */
export type LabelField = 'name' | 'text';

/** A relative time word: the part of a label a calendar moves. */
export const RELATIVE_TIME = /\b(?:just\s+now|now|today|yesterday|tomorrow)\b/i;
/** A count with a unit of time, `2m`, `3 days`: the part of a label a clock moves. */
export const AGE = /\b\d+\s*(?:ms|s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?|d|days?|w|weeks?|mo|months?|y|years?)\b/i;
const RELATIVE_TIME_ALL = new RegExp(RELATIVE_TIME.source, 'gi');
const AGE_ALL = new RegExp(AGE.source, 'gi');

/**
 * A label with the state it carries taken out: every run of digits reads `#`,
 * a relative time reads `<age>`, and the plural a count governs is dropped, so
 * `Reply (0 replies)` and `Reply (1 reply)`, or `Bob · now` and `Bob · 2m`,
 * are the same shape. Case and whitespace are folded too. A label that
 * carries no state is its own shape.
 */
export function labelShape(label: string): string {
  return label
    .toLowerCase()
    .replace(RELATIVE_TIME_ALL, '<age>')
    .replace(AGE_ALL, '<age>')
    .replace(/\d+/g, '#')
    .replace(/#(\s+[a-z]+?)ies\b/g, '#$1y')
    .replace(/#(\s+[a-z]+?)s\b/g, '#$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whether two optional labels share a shape; both absent counts, one absent does not. */
function sameShape(recorded: string | undefined, candidate: string | undefined): boolean {
  if (recorded === undefined || candidate === undefined) return recorded === candidate;
  return labelShape(recorded) === labelShape(candidate);
}

/** Whether the candidate's labels read as the recording's on every listed field, by shape; an exact label is its own shape. */
export function sameLabels(
  recorded: TraceTargetDescriptor,
  candidate: TraceTargetDescriptor,
  fields: readonly LabelField[],
): boolean {
  return fields.every((field) => sameShape(recorded[field], candidate[field]));
}

/**
 * A descriptor with nothing to identify the control by: no test id, name,
 * text, or placeholder, only a role. A form built without labels is made of
 * these. Such a descriptor relocates by its place among the unnamed
 * controls of its kind, so it is relocatable only once a position was
 * recorded for it, and it is matched strictly (`fieldsIdentical`): an
 * unnamed textbox must never stand in for a named one.
 */
export function isAnonymous(descriptor: TraceTargetDescriptor): boolean {
  return (
    descriptor.testId === undefined &&
    descriptor.name === undefined &&
    descriptor.text === undefined &&
    descriptor.placeholder === undefined
  );
}

/**
 * Whether a descriptor can identify a node at all. Role or selector alone
 * cannot: a wrong match acts on the wrong control, so such a descriptor is
 * not relocatable and, as an anchor, would prove nothing.
 */
export function isRelocatableDescriptor(descriptor: TraceTargetDescriptor): boolean {
  return isAnonymous(descriptor) ? descriptor.role !== undefined && descriptor.position !== undefined : true;
}

/** The descriptor without its test id: what is left to match by when the id churned. */
export function withoutTestId(descriptor: TraceTargetDescriptor): TraceTargetDescriptor {
  const { testId: _testId, ...semantic } = descriptor;
  return semantic;
}

/**
 * The descriptor a node is keyed on across re-renders: without its test id
 * when the rest still identifies the node, so an app that mints ids per
 * render cannot make an unchanged control look new; a node only its id
 * identifies keeps it.
 */
export function identifyingProjection(descriptor: TraceTargetDescriptor): TraceTargetDescriptor {
  const semantic = withoutTestId(descriptor);
  return isAnonymous(semantic) ? descriptor : semantic;
}

/** Every listed field the recording captured must be present and equal on the candidate. */
export function fieldsEqual(
  recorded: TraceTargetDescriptor,
  candidate: TraceTargetDescriptor,
  fields: readonly DescriptorField[],
): boolean {
  return fields.every((field) => recorded[field] === undefined || candidate[field] === recorded[field]);
}

/** Like `fieldsEqual`, but a field the recording lacks must be absent on the candidate too. */
function fieldsIdentical(
  recorded: TraceTargetDescriptor,
  candidate: TraceTargetDescriptor,
  fields: readonly DescriptorField[],
): boolean {
  return fields.every((field) => candidate[field] === recorded[field]);
}

interface Projection extends DescriptorMatchOptions {
  readonly described: readonly DescribedNode[];
}

/**
 * Descriptor projections per observation. A replay relocates every recorded
 * action, tier by tier, against the same node map (and again per settling
 * retry), and the anchor check projects it once more, while the projection of
 * a node is a pure function of the node: it is computed once per observation
 * and shared by every lookup into it.
 */
const projections = new WeakMap<ReadonlyMap<string, SemanticNode>, Projection>();

/** Projects every node of an observation the way the recorder described its targets. */
export function describeNodes(
  nodes: ReadonlyMap<string, SemanticNode>,
  options: DescriptorMatchOptions,
): readonly DescribedNode[] {
  const cached = projections.get(nodes);
  if (cached !== undefined && cached.redact === options.redact) return cached.described;
  const described: DescribedNode[] = [];
  for (const [id, node] of nodes) {
    const descriptor = describeTarget(node, options.redact);
    if (descriptor !== undefined) described.push({ id, descriptor });
  }
  projections.set(nodes, { redact: options.redact, described });
  return described;
}

/**
 * Relocates one descriptor against the nodes of a fresh observation
 * (`matchingIds`), exactly-one-or-diverge. Ambiguity diverges immediately:
 * two candidates sharing the matched identity cannot be told apart by
 * waiting, and acting on either would be a guess.
 * The one exception is a recorded `position`: the recording itself found the
 * same twins and noted which one it acted on, so the same count of twins
 * resolves to the same one; any other count diverges as before.
 */
export function relocateDescriptor(
  descriptor: TraceTargetDescriptor,
  nodes: ReadonlyMap<string, SemanticNode>,
  options: DescriptorMatchOptions,
): RelocationResult {
  const matches = matchingIds(descriptor, nodes, options);
  if (matches.length === 0) return { kind: 'failed', failure: 'target-not-found' };
  const { position } = descriptor;
  // A lone match is the node for a descriptor with an identity. An anonymous
  // one has only its count and place: one unnamed twin where the recording
  // counted two is as likely the other field as the right one.
  if (matches.length === 1 && (!isAnonymous(descriptor) || position?.of === 1)) return { kind: 'found', id: matches[0]! };
  const positioned = position !== undefined && position.of === matches.length ? matches[position.index] : undefined;
  return positioned === undefined
    ? { kind: 'failed', failure: 'target-ambiguous', candidates: matches }
    : { kind: 'found', id: positioned };
}

/**
 * The ids a descriptor matches in a fresh observation, in document order:
 * the first tier that matches anything decides.
 *
 * 1. With a recorded test id: every node with that id (`TEST_ID_FIELDS`).
 *    One is the control; several are twins the recorded position tells
 *    apart; none means the id churned, and the tiers below take over as if
 *    no id had been recorded.
 * 2. The nodes whose labels equal the recording's exactly.
 * 3. The nodes whose labels share the recording's shape (`labelShape`), so a
 *    control whose label counts or times something is found once the count
 *    moved.
 *
 * Empty when nothing matches. The recorder uses the same projection to
 * notice, before it writes a target, that the description alone would not
 * tell the target from its twins.
 */
function matchingIds(
  descriptor: TraceTargetDescriptor,
  nodes: ReadonlyMap<string, SemanticNode>,
  options: DescriptorMatchOptions,
): readonly string[] {
  if (!isRelocatableDescriptor(descriptor)) return [];
  const candidates = describeNodes(nodes, options);
  // A recorded container key must hold: the same "Delete" in another row is
  // a different control. Checked against the tree the candidates came from,
  // never guessed.
  const keyed =
    descriptor.within === undefined
      ? candidates
      : (() => {
          const parents = parentsOf(nodes);
          return candidates.filter(
            (candidate) => containerKey(candidate.id, nodes, parents, options.redact) === descriptor.within,
          );
        })();
  const tiers = matchingTiers(descriptor);
  for (const tier of tiers) {
    const matched = keyed.filter((candidate) => tier(candidate.descriptor));
    if (matched.length > 0) return matched.map((candidate) => candidate.id);
  }
  return [];
}

/** One tier of the ladder: whether a candidate's projection matches the recording at that tier. */
type MatchTier = (candidate: TraceTargetDescriptor) => boolean;

function matchingTiers(descriptor: TraceTargetDescriptor): readonly MatchTier[] {
  if (isAnonymous(descriptor)) return [(candidate) => fieldsIdentical(descriptor, candidate, ALL_IDENTITY_FIELDS)];
  const semantic = withoutTestId(descriptor);
  const labels: readonly LabelField[] = semantic.name === undefined ? ['name', 'text'] : ['name'];
  return [
    ...(descriptor.testId === undefined ? [] : [(candidate: TraceTargetDescriptor) => fieldsEqual(descriptor, candidate, TEST_ID_FIELDS)]),
    ...(isAnonymous(semantic)
      ? []
      : [
          (candidate: TraceTargetDescriptor) => fieldsEqual(semantic, candidate, [...SEMANTIC_ID_FIELDS, ...labels]),
          (candidate: TraceTargetDescriptor) =>
            fieldsEqual(semantic, candidate, SEMANTIC_ID_FIELDS) && sameLabels(semantic, candidate, labels),
        ]),
  ];
}

/** Beyond this many twins a description is not a control set but a list; a position there would be noise. */
const MAX_POSITIONED_TWINS = 1000;

/**
 * Where `node` stands among the controls its own description matches on the
 * screen it was acted on, or undefined when the description already names it
 * alone. Recorded with the target so a replay can tell one "Set up" button per
 * card apart without an app change; a distinct label makes it unnecessary.
 */
export function describePosition(
  node: SemanticNode,
  within: string | undefined,
  nodes: ReadonlyMap<string, SemanticNode>,
  options: DescriptorMatchOptions,
): TracePosition | undefined {
  const described = describeTarget(node, options.redact);
  if (described === undefined || (described.role === undefined && isAnonymous(described))) return undefined;
  // An anonymous target has no identity to match alone; its position is what
  // makes it relocatable, so it is counted among its unnamed twins even when
  // it is the only one, and described with a placeholder position to do so.
  const anonymous = isAnonymous(described);
  const probe = { ...described, ...(within === undefined ? {} : { within }), ...(anonymous ? { position: { index: 0, of: 1 } } : {}) };
  const ids = matchingIds(probe, nodes, options);
  if (ids.length < (anonymous ? 1 : 2) || ids.length > MAX_POSITIONED_TWINS) return undefined;
  const index = ids.indexOf(node.ref.id);
  return index === -1 ? undefined : { index, of: ids.length };
}
