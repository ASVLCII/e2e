/** Relocation by test id: the id is the identity; the label only stands in when there is no id. */

import { describe, expect, it } from 'vitest';
import { anchorsPresent } from '../../src/cache/anchors.ts';
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
  it('counts an anchor with a test id as present when its label only moved in shape', () => {
    const count = { role: 'text', name: '2', testId: 'repostCount' };
    expect(anchorsPresent([count], nodes([node('c', { role: 'text', name: '3', testId: 'repostCount' })]), options)).toBe(true);
    const post = { role: 'text', name: 'Post with an image', testId: 'postText' };
    expect(anchorsPresent([post], nodes([node('p', { role: 'text', name: 'Post text only', testId: 'postText' })]), options)).toBe(false);
  });

  it('still requires the effect: a verb that changed is a different label', () => {
    const relabeled = node('b', { role: 'button', name: 'Unlike (1 like)', testId: 'likeBtn' });
    expect(anchorsPresent([recorded], nodes([relabeled]), options)).toBe(false);
  });
});
