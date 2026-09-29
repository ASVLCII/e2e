/** Relocation by test id: the id is the identity; the label only stands in when there is no id. */

import { describe, expect, it } from 'vitest';
import { anchorsPresent } from '../../src/cache/anchors.ts';
import { describeTarget } from '../../src/agent/actions.ts';
import { labelShape, relocateDescriptor } from '../../src/cache/relocate.ts';
import type { SemanticNode } from '../../src/engine/surface.ts';

const options = { redact: (text: string): string => text };

function nodes(list: SemanticNode[]): ReadonlyMap<string, SemanticNode> {
  return new Map(list.map((entry) => [entry.ref.id, entry]));
}

function node(id: string, fields: Omit<SemanticNode, 'ref'>): SemanticNode {
  return { ref: { id, revision: 'r' }, ...fields };
}

/** Recorded before the like: the label carries the count of that moment. */
const recorded = { role: 'button', name: 'Like (0 likes)', testId: 'likeBtn' };

describe('labelShape', () => {
  it('folds counts, their plurals, and relative times', () => {
    expect(labelShape('Reply (0 replies)')).toBe(labelShape('Reply (1 reply)'));
    expect(labelShape('Repost (2 reposts)')).toBe(labelShape('Repost (13 reposts)'));
    expect(labelShape('Bob · now')).toBe(labelShape('Bob · 2m'));
    expect(labelShape('Bob · 2m')).toBe(labelShape('Bob · 3h'));
    expect(labelShape('3 followers')).toBe(labelShape('12 follower'));
  });

  it('keeps words apart: a different verb is a different shape', () => {
    expect(labelShape('Like (0 likes)')).not.toBe(labelShape('Unlike (1 like)'));
    expect(labelShape('Save')).toBe(labelShape(' save '));
  });

  it('stems a counted noun the same way in the singular and the plural', () => {
    expect(labelShape('1 movie')).toBe(labelShape('3 movies'));
    expect(labelShape('1 cookie')).toBe(labelShape('2 cookies'));
    expect(labelShape('1 reply')).toBe(labelShape('2 replies'));
    expect(labelShape('1 bus')).toBe(labelShape('1 bus'));
  });
});

describe('relocateDescriptor with a recorded test id', () => {
  it('finds the control by its id whatever its label reads now', () => {
    const liked = node('b', { role: 'button', name: 'Unlike (1 like)', testId: 'likeBtn' });
    expect(relocateDescriptor(recorded, nodes([liked]), options)).toEqual({ kind: 'found', id: 'b' });
  });

  it('ignores a same-labelled control with another id while the recorded id is on screen', () => {
    const same = node('a', { role: 'button', name: 'Like (0 likes)', testId: 'likeBtn' });
    const other = node('b', { role: 'button', name: 'Like (0 likes)', testId: 'likeBtn-2' });
    expect(relocateDescriptor(recorded, nodes([other, same]), options)).toEqual({ kind: 'found', id: 'a' });
  });

  it('falls back to the label when the id churned, exactly or by shape', () => {
    const churned = node('b', { role: 'button', name: 'Like (0 likes)', testId: 'likeBtn-2' });
    expect(relocateDescriptor(recorded, nodes([churned]), options)).toEqual({ kind: 'found', id: 'b' });
    const moved = node('c', { role: 'button', name: 'Like (4 likes)', testId: 'likeBtn-2' });
    expect(relocateDescriptor(recorded, nodes([moved]), options)).toEqual({ kind: 'found', id: 'c' });
    const other = node('x', { role: 'button', name: 'Repost (0 reposts)', testId: 'repostBtn' });
    expect(relocateDescriptor(recorded, nodes([other]), options)).toEqual({ kind: 'failed', failure: 'target-not-found' });
  });

  it('resolves twins sharing the id by the recorded position, never by their labels', () => {
    const first = node('a', { role: 'button', name: 'Like (0 likes)', testId: 'likeBtn' });
    const second = node('b', { role: 'button', name: 'Unlike (1 like)', testId: 'likeBtn' });
    // The label that still reads as recorded is the wrong one: the recorded control is the one that was liked.
    expect(relocateDescriptor({ ...recorded, position: { index: 1, of: 2 } }, nodes([first, second]), options)).toEqual({ kind: 'found', id: 'b' });
    expect(relocateDescriptor(recorded, nodes([first, second]), options)).toMatchObject({ kind: 'failed', failure: 'target-ambiguous' });
  });

  it('keeps the container key: the same id in another row is another control', () => {
    const rows = nodes([node('a', { role: 'button', name: 'Unlike (1 like)', testId: 'likeBtn' })]);
    expect(relocateDescriptor({ ...recorded, within: 'Bob' }, rows, options)).toEqual({ kind: 'failed', failure: 'target-not-found' });
  });
});

describe('relocateDescriptor without a test id', () => {
  it('finds a row link whose name carries the counts and age of its contents', () => {
    const then = { role: 'link', name: "Bob's avatar, Replied to you, Reply 1, Reply (0 replies), Like (0 likes), Bob, · now" };
    const now = node('n', { role: 'link', name: "Bob's avatar, Replied to you, Reply 1, Reply (1 reply), Like (2 likes), Bob, · 5m" });
    expect(relocateDescriptor(then, nodes([now]), options)).toEqual({ kind: 'found', id: 'n' });
  });

  it('prefers the exact label over a shape twin', () => {
    const exact = node('a', { role: 'button', name: 'Reply (0 replies)' });
    const twin = node('b', { role: 'button', name: 'Reply (4 replies)' });
    expect(relocateDescriptor({ role: 'button', name: 'Reply (0 replies)' }, nodes([exact, twin]), options)).toEqual({ kind: 'found', id: 'a' });
    expect(relocateDescriptor({ role: 'button', name: 'Reply (0 replies)' }, nodes([twin]), options)).toEqual({ kind: 'found', id: 'b' });
  });

  it('diverges when two controls share the shape, rather than guessing', () => {
    const one = node('a', { role: 'button', name: 'Reply (1 reply)' });
    const two = node('b', { role: 'button', name: 'Reply (4 replies)' });
    expect(relocateDescriptor({ role: 'button', name: 'Reply (0 replies)' }, nodes([one, two]), options)).toMatchObject({ kind: 'failed', failure: 'target-ambiguous' });
  });
});

describe('anchors under the same rule', () => {
  it('compares a bare count exactly even with a test id, and words by their own text', () => {
    const count = { role: 'text', name: '2', testId: 'repostCount' };
    expect(anchorsPresent([count], nodes([node('c', { role: 'text', name: '3', testId: 'repostCount' })]), options)).toBe(false);
    expect(anchorsPresent([count], nodes([node('c', { role: 'text', name: '2', testId: 'repostCount' })]), options)).toBe(true);
    const post = { role: 'text', name: 'Post with an image', testId: 'postText' };
    expect(anchorsPresent([post], nodes([node('p', { role: 'text', name: 'Post text only', testId: 'postText' })]), options)).toBe(false);
  });

  it('still requires the effect: a verb that changed is a different label', () => {
    const relabeled = node('b', { role: 'button', name: 'Unlike (1 like)', testId: 'likeBtn' });
    expect(anchorsPresent([recorded], nodes([relabeled]), options)).toBe(false);
  });
});

describe('bare counts', () => {
  it('compares a label that is nothing but a number exactly, so an unchanged counter is not the recorded effect', () => {
    const counter = { role: 'status', name: 'Counter', text: '1' };
    expect(anchorsPresent([counter], nodes([node('c', { role: 'status', name: 'Counter', text: '0' })]), options)).toBe(false);
    expect(anchorsPresent([counter], nodes([node('c', { role: 'status', name: 'Counter', text: '1' })]), options)).toBe(true);
    // A count inside a phrase is state, and compares by shape.
    const tally = { role: 'text', name: '1 like', testId: 'likeCount' };
    expect(anchorsPresent([tally], nodes([node('t', { role: 'text', name: '2 likes', testId: 'likeCount' })]), options)).toBe(true);
  });
});

describe('a recorded position after the id churned', () => {
  it('does not accept a lone label match for a control recorded among twins', () => {
    // Recorded: the second of two `likeBtn`, then reading "Unlike". The ids are gone and the labels swapped.
    const then = { role: 'button', name: 'Unlike (1 like)', testId: 'likeBtn', position: { index: 1, of: 2 } };
    const swapped = nodes([
      node('a', { role: 'button', name: 'Unlike (1 like)' }),
      node('b', { role: 'button', name: 'Like (0 likes)' }),
    ]);
    expect(relocateDescriptor(then, swapped, options)).toEqual({ kind: 'failed', failure: 'target-not-found' });
    // The same number of label twins resolves by the recorded index, as the id twins would have.
    const twins = nodes([
      node('a', { role: 'button', name: 'Unlike (1 like)' }),
      node('b', { role: 'button', name: 'Unlike (3 likes)' }),
    ]);
    expect(relocateDescriptor(then, twins, options)).toEqual({ kind: 'found', id: 'b' });
  });
});

describe('the element id rung', () => {
  const identity = (text: string): string => text;

  it('records an authored element id and skips a minted one', () => {
    expect(describeTarget(node('a', { role: 'button', name: 'Save', attributes: { id: 'save-draft' } }), identity)).toMatchObject({ elementId: 'save-draft' });
    for (const minted of [':r3:', 'radix-:r1:', 'input-1739', 'mui-component-select-abc123def456', '']) {
      expect(describeTarget(node('m', { role: 'button', name: 'Save', attributes: { id: minted } }), identity)?.elementId).toBeUndefined();
    }
  });

  it('is tried after the test id and before the label', () => {
    const withBothIds = { role: 'button', name: 'Like (0 likes)', testId: 'likeBtn', elementId: 'like-main' };
    const byTestId = node('t', { role: 'button', name: 'Other', testId: 'likeBtn' });
    const byElementId = node('e', { role: 'button', name: 'Other', attributes: { id: 'like-main' } });
    const byLabel = node('l', { role: 'button', name: 'Like (0 likes)' });
    expect(relocateDescriptor(withBothIds, nodes([byTestId, byElementId, byLabel]), options)).toEqual({ kind: 'found', id: 't' });
    expect(relocateDescriptor(withBothIds, nodes([byElementId, byLabel]), options)).toEqual({ kind: 'found', id: 'e' });
    expect(relocateDescriptor(withBothIds, nodes([byLabel]), options)).toEqual({ kind: 'found', id: 'l' });
  });

  it('identifies an anchor, with its label still compared by shape', () => {
    const anchor = { role: 'status', name: 'Saved 1 item', elementId: 'save-status' };
    expect(anchorsPresent([anchor], nodes([node('s', { role: 'status', name: 'Saved 2 items', attributes: { id: 'save-status' } })]), options)).toBe(true);
    expect(anchorsPresent([anchor], nodes([node('s', { role: 'status', name: 'Nothing saved', attributes: { id: 'save-status' } })]), options)).toBe(false);
  });
});
