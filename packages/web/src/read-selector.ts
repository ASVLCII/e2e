/**
 * The selector engine that reads a locate's matches in the task that finds
 * them. Appended to a projected locator (`<locator> >> e2e-read=<json>`), it
 * maps each match to itself and records the reader's semantics for it on the
 * element, so a page that replaces the match a frame later can never detach
 * it between the query and the read: both happen before the page runs again.
 * A later protocol call takes those reads back from the very elements the
 * query returned, as values or as handles to pin.
 */

import { randomUUID } from 'node:crypto';
import { readSemanticsFunction } from './in-page/read-semantics.ts';
import type { RawNodeData } from './read-node.ts';

/** Playwright selector engine name; `e2e-read=<json>` reads every match under one locate's token. */
export const READ_SELECTOR_ENGINE = 'e2e-read';

/**
 * Where the engine records reads on an element: a `Map` from locate token to
 * read under a registry symbol, like the observation's ref stamp: no
 * attribute, nothing a key listing shows, not removable by application code,
 * and gone with the element. The take function below repeats the literal, since a page function
 * cannot import it.
 */
const READS_KEY = 'e2e.locate.reads';

/** What the selector body carries into the page: the locate's token and the reader's options. */
interface ReadSelectorBody {
  readonly token: string;
  readonly testIdAttribute: string;
  readonly secureFieldSelector: string;
}

/**
 * The selector one locate appends to its projected locator, under a fresh
 * token so concurrent locates of one element each take back their own read.
 * The body is JSON, kept whole by Playwright's selector parser like the
 * `e2e-label` body.
 */
export function readSelector(options: Omit<ReadSelectorBody, 'token'>): { readonly selector: string; readonly token: string } {
  const token = randomUUID();
  return { selector: `${READ_SELECTOR_ENGINE}=${JSON.stringify({ ...options, token })}`, token };
}

/**
 * The engine behind `e2e-read=<json>`: each query root is a match of the
 * locator before it, returned as is after the reader's node read of it is
 * recorded under the body's token. The reader is embedded as source because
 * a selector engine is one self-contained page function. It runs in the main
 * world (not as a content script) so the take function, which Playwright
 * evaluates there, finds what it recorded.
 */
export const READ_SELECTOR_ENGINE_SOURCE = `() => {
  const read = (${readSemanticsFunction.toString()});
  const key = Symbol.for(${JSON.stringify(READS_KEY)});
  const queryAll = (root, selector) => {
    if (root.nodeType !== 1) return [];
    const body = JSON.parse(selector);
    const options = { testIdAttribute: body.testIdAttribute, secureFieldSelector: body.secureFieldSelector, mode: { kind: 'node' } };
    if (!Object.prototype.hasOwnProperty.call(root, key)) {
      Object.defineProperty(root, key, { value: new Map(), enumerable: false, configurable: false, writable: false });
    }
    root[key].set(body.token, read(root, options));
    return [root];
  };
  return { queryAll, query: (root, selector) => queryAll(root, selector)[0] ?? null };
}`;

/**
 * Takes back, in order, the reads the engine recorded under `token` and
 * deletes them; `null` where none was recorded, which is a match the engine
 * never saw: a `*` capture earlier in the selector returns an element the
 * chain only passed through. `locator.evaluateAll` calls it with the matched
 * elements. A caller pinning handles evaluates it on the first handle with
 * every handle in `elements`, so it runs in the frame the handles belong to;
 * `page.evaluate` would reject handles taken inside an iframe.
 */
export const takeReadsFunction = (
  subject: Element | Element[],
  arg: { readonly token: string; readonly elements?: Element[] },
): (RawNodeData | null)[] =>
  (Array.isArray(subject) ? subject : (arg.elements ?? [])).map((element) => {
    const reads = (element as Element & Record<symbol, Map<string, RawNodeData> | undefined>)[Symbol.for('e2e.locate.reads')];
    const read = reads?.get(arg.token) ?? null;
    reads?.delete(arg.token);
    return read;
  });
