/** `expect(screen)` routes to the screenshot matchers; a scoped screen (a frame) is refused, since its box is not known. */

import { describe, expect as vitestExpect, it } from 'vitest';
import { expect } from '../../src/expect/index.ts';
import { createScopedScreen, createScreen, type ScreenContext } from '../../src/locator/screen.ts';

/** A context no call here reaches: the scoped refusal comes first, and the unscoped surface is only built. */
const context = {} as ScreenContext;

describe('expect(screen)', () => {
  it('gives the root screen the screenshot matchers', () => {
    vitestExpect(typeof expect(createScreen(context)).toHaveScreenshot).toBe('function');
  });

  it('refuses a screen scoped to a frame instead of comparing the whole viewport', async () => {
    const frame = createScopedScreen(context, (expression) => ({ kind: 'frame', selector: '#pay', source: expression }));
    await vitestExpect(expect(frame).toHaveScreenshot('pay.png')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await vitestExpect(expect(frame).not.toHaveScreenshot()).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});
