/**
 * The observed tree reads an element's text as a person reads its line:
 * words inside inline descendants (a link, emphasis, code) stay in place in
 * the sentence, the link stays a node of its own, and text-only inline
 * wrappers are not listed a second time.
 */

import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { SemanticNode } from 'e2e/engine';
import { captureDocument } from '../../src/observation.ts';

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});

afterAll(async () => {
  await browser.close();
});

/** Every node of one observation of `html`, in document order. */
async function observe(html: string): Promise<SemanticNode[]> {
  await page.setContent(html);
  let nextId = 1;
  const { tree } = await captureDocument(
    {
      testIdAttribute: 'data-testid',
      site: undefined,
      reserveIds: (count) => { const first = nextId; nextId += count; return first; },
      commit: () => undefined,
    },
    page,
    { framePath: [], budget: 100, deadline: Date.now() + 10_000, signal: new AbortController().signal },
  );
  const out: SemanticNode[] = [];
  const visit = (node: SemanticNode): void => {
    out.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  for (const child of tree.children ?? []) visit(child);
  return out;
}

/** The nodes as `role "name" text`, the parts a model reads. */
function lines(nodes: readonly SemanticNode[]): string[] {
  return nodes.map((node) => [node.role, node.name === undefined ? undefined : `"${node.name}"`, node.text].filter(Boolean).join(' '));
}

it('reads a sentence with an inline link whole and keeps the link as its own node under it', async () => {
  const nodes = await observe('<p>Read our <a href="/privacy">privacy policy</a> for details.</p>');
  expect(lines(nodes)).toEqual(['Read our privacy policy for details.', 'link "privacy policy" privacy policy']);
  expect(nodes[0]!.children?.map((child) => child.role)).toEqual(['link']);
});

it('reads emphasis, code, and spans in place and lists none of them again', async () => {
  const nodes = await observe('<p>Use <strong>bold</strong>, <em>italic <b>nested</b></em>, <code>npx e2e</code>, and a <span>span</span>.</p>');
  expect(lines(nodes)).toEqual(['Use bold, italic nested, npx e2e, and a span.']);
});

it('keeps an inline node named by a test id while its words stay in the sentence', async () => {
  const nodes = await observe('<p>Total <span data-testid="total">$10</span> due today</p>');
  expect(lines(nodes)).toEqual(['Total $10 due today', '$10']);
  expect(nodes[1]!.testId).toBe('total');
});

it('lists the children of a wrapper with no text of its own, as before', async () => {
  const nodes = await observe('<div><span>One</span><span>Two</span></div><button><span>Save</span></button>');
  expect(lines(nodes)).toEqual(['One', 'Two', 'button "Save"', 'Save']);
});

it('separates words at block children, line breaks, and form controls, and reads no hidden inline text', async () => {
  const nodes = await observe(`
    <div>Intro<p>Block</p>tail</div>
    <p>one<br>two</p>
    <label>Show <select><option>10</option></select> per page</label>
    <p>Shown <span style="display:none">gone</span><span aria-hidden="true">decor</span><span style="visibility:hidden">ghost</span> end</p>
    <p>Price <span style="display:inline-block;width:0;height:0;overflow:hidden">$99</span><span style="font-size:0">$98</span> today</p>
  `);
  const texts = nodes.filter((node) => node.role === undefined).map((node) => node.text);
  expect(texts).toEqual(['Intro tail', 'Block', 'one two', 'Show per page', 'Shown end', 'Price today']);
});

it('keeps listing the inline text of a line too long for the text bound, so nothing past the cut is lost', async () => {
  const nodes = await observe(`<p>${'word '.repeat(120)}<strong>Total: $42</strong></p>`);
  expect(nodes.map((node) => node.text)).toEqual([expect.stringMatching(/^word word/), 'Total: $42']);
});
