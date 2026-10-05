# e2e with Expo

An Expo greeting app with three locator tests and two agent tests per platform.

## Run

Follow [Expo's environment setup guide](https://docs.expo.dev/get-started/set-up-your-environment/)
for an iOS simulator or Android emulator. Choose a development build and
follow the local setup instructions. Start the simulator or emulator before
running the commands below.

From this folder:

```bash
npm install
npx agent-device doctor
```

For iOS:

```bash
npm run ios:release
npm run test:e2e:ios
```

For Android:

```bash
npm run android:release
npm run test:e2e:android
```

The build commands install a Release app. No Metro server is needed.
Build again after app changes.

## Agent tests

Set a [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) key:

```bash
AI_GATEWAY_API_KEY="your-key" npm run test:e2e:ios
# For Android, use test:e2e:android.
```

Without the key, the agent tests skip. Add `-- --no-cache` to use fresh
model calls. Each run replaces `.e2e/report.json`.

See [e2e.config.ts](e2e.config.ts) and [tests/](tests/) for the setup.
For device setup and CI, see the [Mobile guide](https://e2e.tester.army/docs/mobile).

Last checked on Android on 2026-10-05 with e2e 0.15.2,
@e2e-dev/mobile 0.9.0, and Expo SDK 57.
Devices: iOS 26.5 with Xcode 27, and Android 16 with API 36 and JDK 17.
