import { defineConfig } from 'vitest/config';

/** Against the real AgentMail API: needs `AGENTMAIL_API_KEY`, sends real email. */
export default defineConfig({
  test: {
    include: ['tests/live/**/*.test.ts'],
    testTimeout: 120_000,
    pool: 'forks',
  },
});
