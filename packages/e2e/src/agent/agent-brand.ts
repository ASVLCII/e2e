/**
 * The built-in agent's identity, kept apart from the agent itself so the
 * fixtures can name it without loading the agent's loop, and config
 * resolution can recognize what the removed `createAgent()` built.
 */

/**
 * The name and version every built-in agent reports. Cache provenance and
 * the model policy version record them, so a committed recording stays
 * valid whatever options an agents entry sets.
 */
export const BUILT_IN_AGENT = { name: 'e2e-default-agent', version: '2' } as const;

/** The brand the removed `createAgent()` stamped on the executors it built. */
const LEGACY_AGENT_MARKER: unique symbol = Symbol.for('e2e.default-agent.v1');

/**
 * True for a value the removed `createAgent()` built, in any realm: an `e2e`
 * from before the plain-object agents config can still hand one over (a
 * second copy of the package, a stale build), and config resolution points
 * at the shape that replaced it instead of running it as a custom brain.
 */
export function isLegacyBuiltInAgent(value: unknown): boolean {
  return typeof value === 'object' && value !== null && LEGACY_AGENT_MARKER in value;
}
