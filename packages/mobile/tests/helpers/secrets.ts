/** `EngineAttemptContext.resolveSecret` for an attempt whose engine declares no secrets: a call is a bug in the test. */
export const noSecrets = (): Promise<string> => Promise.reject(new Error('this attempt declares no secrets'));
