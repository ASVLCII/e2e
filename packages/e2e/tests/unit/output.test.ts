import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from '../../src/internal/ids.ts';
import { claimOutput, clearArtifacts, OUTPUT_MARKER, SESSION_TTL_MS } from '../../src/run/output.ts';

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'e2e-output-unit-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Writes an empty file at `relative` under the temp root, creating its directories. */
function touch(relative: string): string {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, '');
  return file;
}

describe('clearArtifacts', () => {
  it("empties the tree and keeps only the attempts of e2e mcp sessions that may still be live", async () => {
    const now = Date.now();
    // Minted before a slow launch, still inside its TTL.
    const live = uuidv7(now - SESSION_TTL_MS - 10 * 60_000);
    const ended = uuidv7(now - 2 * SESSION_TTL_MS);
    const kept = touch(`artifacts/web/sessions/${live}/trace/trace-part1.zip`);
    touch(`artifacts/web/sessions/${ended}/trace/trace.zip`);
    touch('artifacts/web/sessions/not-an-attempt/x.png');
    touch('artifacts/web/tests_a.e2e.ts__pays-1a2b/default/attempt-0/failure/screen.txt');
    touch('artifacts/stray.txt');

    await clearArtifacts(path.join(root, 'artifacts'), now);

    expect(existsSync(kept)).toBe(true);
    expect(readdirSync(path.join(root, 'artifacts'))).toEqual(['web']);
    expect(readdirSync(path.join(root, 'artifacts', 'web'))).toEqual(['sessions']);
    expect(readdirSync(path.join(root, 'artifacts', 'web', 'sessions'))).toEqual([live]);
  });

  it('removes a symlink in the tree without touching what it points at', async () => {
    const outside = touch('outside/keep.txt');
    mkdirSync(path.join(root, 'artifacts', 'web'), { recursive: true });
    symlinkSync(path.join(root, 'outside'), path.join(root, 'artifacts', 'web', 'linked'));
    symlinkSync(path.join(root, 'outside'), path.join(root, 'artifacts-link'));
    await clearArtifacts(path.join(root, 'artifacts'));
    await clearArtifacts(path.join(root, 'artifacts-link'));
    expect(existsSync(outside)).toBe(true);
    expect(readdirSync(path.join(root, 'artifacts', 'web'))).toEqual([]);
    expect(existsSync(path.join(root, 'artifacts-link'))).toBe(false);
  });

  it('removes a file where the tree should be', async () => {
    touch('artifacts');
    await clearArtifacts(path.join(root, 'artifacts'));
    expect(existsSync(path.join(root, 'artifacts'))).toBe(false);
  });

  it('does nothing when there is no tree yet', async () => {
    await clearArtifacts(path.join(root, 'artifacts'));
    expect(existsSync(path.join(root, 'artifacts'))).toBe(false);
  });
});

describe('claimOutput', () => {
  it('creates the output and marks it, except the default .e2e, which is e2e\'s by name', async () => {
    await claimOutput(path.join(root, 'results'), root);
    expect(existsSync(path.join(root, 'results', OUTPUT_MARKER))).toBe(true);
    await claimOutput(path.join(root, 'results'), root);
    await claimOutput(path.join(root, '.e2e'), root);
    expect(readdirSync(path.join(root, '.e2e'))).toEqual([]);
  });
});
