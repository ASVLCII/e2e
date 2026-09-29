/**
 * A secret an engine option holds. `e2e.config.ts` calls `secrets.get()`
 * while it evaluates, in the runner and again in every worker, before any
 * run exists; the handle is a reference by name that the web engine resolves
 * when an attempt starts, to answer a basic-auth challenge. The value comes
 * from a provider, so nothing registered it up front: the attempt's
 * resolution alone is what makes the page's echo of it redacted in the
 * failure message, the report, and every file the reporters write. Over the
 * fake engine: only a secret the engine declared resolves.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { E2EConfig } from '../../src/index.ts';
import type { RunOutcome } from '../../src/run/runner.ts';
import { secrets } from '../../src/secrets.ts';
import { createFakeEngine, FAKE_APP_URL } from '../helpers/fake-engine.ts';
import { startFixtureApp, type FixtureApp } from '../helpers/fixture-app.ts';
import { contentsUnder, resultByTitle, runProject, runProjectWithConfigFile, type FixtureProject } from '../helpers/run-project.ts';

const PASSWORD = 'basic-Pa55-7Qz';

const CONFIG = `import type { E2EConfig } from 'e2e';
import { secrets } from 'e2e';
import { web } from '@e2e-dev/web';

export default {
  targets: [
    {
      name: 'web',
      engine: web({ url: process.env.APP_URL!, basicAuth: { username: 'ada', password: secrets.get('stagingPassword') } }),
    },
  ],
  workers: 2,
  reporters: ['markdown', 'junit'],
  secrets: { stagingPassword: () => ${JSON.stringify(PASSWORD)} },
} satisfies E2EConfig;
`;

const SUITE = `import { test, expect } from 'e2e';

test('signs in through basic auth', async ({ app, screen }) => {
  await app.open('/basic-auth');
  await expect(screen.getByRole('heading', { name: 'Signed in as ada' })).toBeVisible();
});

test('fails on the echoed password', async ({ app, screen }) => {
  await app.open('/basic-auth');
  await expect(screen.getByTestId('echo')).toHaveText('something else', { timeout: 500 });
});
`;

describe('a secret in an engine option', () => {
  let app: FixtureApp;
  let project: FixtureProject;
  let outcome: RunOutcome;

  beforeAll(async () => {
    app = await startFixtureApp();
    ({ outcome, project } = await runProjectWithConfigFile(
      { 'tests/basic-auth.e2e.ts': SUITE },
      { appUrl: app.url, configSource: CONFIG },
    ));
  }, 120_000);

  afterAll(async () => {
    project?.cleanup();
    await app?.close();
  });

  it('answers the challenge with the resolved value', () => {
    expect(resultByTitle(outcome, 'signs in through basic auth').status, JSON.stringify(outcome.report.run.errors)).toBe('passed');
  });

  it('redacts the value the page echoes from the failure, the report, and the reporters\' files', () => {
    const error = resultByTitle(outcome, 'fails on the echoed password').attempts[0]!.error!;
    expect(error.message).toContain('<secret:stagingPassword>');
    expect(JSON.stringify(outcome.report)).not.toContain(PASSWORD);
    // A trace archive is rewritten only after a fill, and this attempt filled nothing.
    for (const [file, text] of contentsUnder(`${project.dir}/.e2e`).filter(([name]) => !name.includes('.zip'))) {
      expect(text, file).not.toContain(PASSWORD);
    }
  });
});

describe('resolving an engine secret', () => {
  it('hands the engine a declared value and refuses one it did not declare', async () => {
    const resolved: string[] = [];
    const fake = createFakeEngine({
      secrets: [secrets.get('declared')],
      async onStartAttempt(context, attemptIndex) {
        resolved.push(await context.resolveSecret(secrets.get(attemptIndex === 0 ? 'declared' : 'undeclared')));
      },
    });
    const { outcome, project } = await runProject(
      {
        'tests/first.e2e.ts': `import { test } from 'e2e';\ntest('first', async () => {});\n`,
        'tests/second.e2e.ts': `import { test } from 'e2e';\ntest('second', async () => {});\n`,
      },
      {
        appUrl: FAKE_APP_URL,
        config: {
          targets: [{ name: 'fake', platform: 'web', engine: fake.engine }],
          workers: 1,
          secrets: { declared: () => 'declared-value', undeclared: 'undeclared-value' },
        } as Partial<E2EConfig>,
      },
    );
    try {
      expect(resolved).toEqual(['declared-value']);
      const refused = outcome.results.find((result) => result.status !== 'passed')!;
      expect(refused.attempts[0]!.error).toMatchObject({
        code: 'SECRET_UNAVAILABLE',
        message: expect.stringContaining('asked for secret "undeclared", which it did not declare in its secrets'),
      });
      expect(outcome.results.filter((result) => result.status === 'passed')).toHaveLength(1);
    } finally {
      project.cleanup();
    }
  });
});
