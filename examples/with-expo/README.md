# e2e with Expo

An Expo greeting app with three locator tests and two agent tests per platform.

## Run

From this folder:

```bash
npm install
```

Choose one platform:

| Platform | Build and install | Run tests |
| --- | --- | --- |
| Web | The runner starts Expo | `npm run test:e2e:web` |
| iOS | `npm run ios:release` | `npm run test:e2e:ios` |
| Android | `npm run android:release` | `npm run test:e2e:android` |

For iOS or Android, follow [Expo's setup guide](https://docs.expo.dev/get-started/set-up-your-environment/).
Start a simulator or emulator before you build. Build again after app changes.

## Agent tests

Set a [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) key before running tests:

```bash
export AI_GATEWAY_API_KEY="your-key"
```

Without the key, the agent tests skip. Add `-- --no-cache` for fresh model calls.

See [e2e.config.ts](e2e.config.ts) and [tests/](tests/) for the setup.

Last checked on 2026-10-05 with Expo SDK 57:

| Platform | e2e | Engine |
| --- | --- | --- |
| Web | 0.16.0 | @e2e-dev/web 0.11.2 |
| iOS | 0.16.0 | @e2e-dev/mobile 0.9.2 |
| Android | 0.15.2 | @e2e-dev/mobile 0.9.0 |
