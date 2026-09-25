/**
 * The `device` methods no scenario flow needs, each with something the app
 * shows or the fixture reads back: the Control Inventory screen prints the
 * color scheme and the orientation, the home list is where a relaunch lands,
 * and `foregroundApp` says which app is in front.
 */

import { execFileSync } from 'node:child_process';
import { expect, openScenario, test } from './fixtures.ts';

const APP_ID = 'dev.e2e.benchmark';

test.describe('device fixture', () => {
  test.beforeEach(async ({ app, device, screen }) => {
    await openScenario({ app, device, screen }, 'Control Inventory');
  });

  // Only the iOS build follows the system appearance (`ios.userInterfaceStyle`
  // in app.json); the Android build stays light.
  test('setAppearance flips the color scheme the app reads', { platforms: ['ios'] }, async ({ device, screen }) => {
    const scheme = screen.getByTestId('color-scheme');
    await expect(scheme).toHaveText('scheme: light');
    try {
      await device.setAppearance('dark');
      await expect(scheme).toHaveText('scheme: dark');
    } finally {
      await device.setAppearance('light');
    }
    await expect(scheme).toHaveText('scheme: light');
  });

  test('setOrientation rotates the window the app measures', async ({ device, screen }) => {
    const orientation = screen.getByTestId('orientation');
    await expect(orientation).toHaveText('orientation: portrait');
    try {
      await device.setOrientation('landscape-left');
      await expect(orientation).toHaveText('orientation: landscape');
    } finally {
      await device.setOrientation('portrait');
    }
    await expect(orientation).toHaveText('orientation: portrait');
  });

  // Android 14 and later ship no shell command for the clipboard service, so
  // agent-device 0.21.13 reads an empty string back on the emulator; its own
  // advice is to paste into a field and read that.
  test('the clipboard reads back what was written', { platforms: ['ios'] }, async ({ device }) => {
    await device.setClipboard('e2e clipboard 42');
    expect(await device.clipboard()).toBe('e2e clipboard 42');
  });

  test('home leaves the app, openApp brings it back where it was', async ({ device, screen }) => {
    expect((await device.foregroundApp()).bundleId).toBe(APP_ID);
    await device.home();
    await device.openApp(APP_ID);
    expect((await device.foregroundApp()).bundleId).toBe(APP_ID);
    await expect(screen.getByTestId('inventory-header')).toBeVisible();
  });

  // agent-device 0.21.13's iOS appstate answers from the session (source:
  // session, surface: app) and refuses a device selector without one, so on
  // iOS home() leaves foregroundApp() naming the pinned app; Android reads
  // the device's foreground activity.
  test('foregroundApp sees the home screen after home()', { platforms: ['android'] }, async ({ device }) => {
    await device.home();
    expect((await device.foregroundApp()).bundleId).not.toBe(APP_ID);
  });

  // The close names the app, so agent-device terminates it before ending the
  // session; a bare close would leave it running and openApp would resume it here.
  test('closeApp then openApp relaunches on the home list', async ({ device, screen }) => {
    await device.closeApp();
    await device.openApp(APP_ID);
    expect((await device.foregroundApp()).bundleId).toBe(APP_ID);
    await expect(screen.getByTestId('Login Form')).toBeVisible();
    await expect(screen.getByTestId('inventory-header')).toBeHidden();
  });

  // The reference promises APP_NOT_OPEN for a lost session.
  test('foregroundApp after closeApp reports the closed session as APP_NOT_OPEN', async ({ device }) => {
    await device.closeApp();
    const lost = await device.foregroundApp().then(
      () => undefined,
      (error: unknown) => error as { code?: string },
    );
    expect(lost?.code).toBe('APP_NOT_OPEN');
  });

  test('device.back pops the scenario', async ({ device, screen }) => {
    await device.back();
    await expect(screen.getByTestId('Control Inventory')).toBeVisible();
    await expect(screen.getByTestId('inventory-header')).toBeHidden();
  });

  // The Device section prints what the device tells the app: the network
  // state (expo-network), a position read on demand (expo-location), and the
  // outcome of a biometric prompt (expo-local-authentication).

  // Android only: on an iOS simulator agent-device's network settings paint
  // the status bar's indicator and the app keeps its connection, so only the
  // emulator, whose radios agent-device switches, shows the app a change.
  test('setNetwork and setAirplaneMode change what the app sees', { platforms: ['android'] }, async ({ device, screen }) => {
    await screen.getByTestId('tab-device').tap();
    const network = screen.getByTestId('network-state');
    await expect(network).toHaveText('network: connected');
    try {
      await device.setNetwork('offline');
      await expect(network).toHaveText('network: disconnected');
      await device.setNetwork('online');
      await expect(network).toHaveText('network: connected');
      await device.setAirplaneMode(true);
      await expect(network).toHaveText('network: disconnected');
    } finally {
      await device.setAirplaneMode(false);
      await device.setNetwork('online');
    }
    await expect(network).toHaveText('network: connected');
  });

  // A read returns the provider's last fix, which lags a new one by a moment,
  // so each read is repeated until the app prints the position that was set.
  // On Android clearLocation switches location services off, and the
  // emulator keeps that until they are switched back on
  // (`adb shell settings put secure location_mode 3`); a CI emulator is fresh.
  test('setLocation and clearLocation change what the app reads', async ({ device, screen }) => {
    await screen.getByTestId('tab-device').tap();
    // Granted up front, so the read never waits on the system's permission dialog.
    await device.setPermission('location', 'grant');
    const read = screen.getByTestId('read-location');
    const status = screen.getByTestId('location-status');
    const readsBack = async (expected: RegExp): Promise<void> => {
      await expect
        .poll(async () => {
          await read.tap();
          await expect(status).not.toHaveText('location: reading');
          return (await status.allTextContents())[0] ?? '';
        }, { timeout: 20_000 })
        .toMatch(expected);
    };
    try {
      await device.setLocation({ latitude: 52.2297, longitude: 21.0122 });
      await readsBack(/^location: 52\.2297, 21\.0122$/);
      await device.setLocation({ latitude: 37.7749, longitude: -122.4194 });
      await readsBack(/^location: 37\.7749, -122\.4194$/);
    } finally {
      await device.clearLocation();
    }
    // Android has no provider left and errors; iOS clears the simulated fix together with the app's authorization.
    await readsBack(/^location: (unavailable|permission denied)/);
  });

  // The Device section has the prompt; whether the fixture can answer it is
  // decided at collection, from the simctl the Mac has. Face ID is the sensor
  // of every current iPhone simulator, CI's iPhone 17 Pro included, and the
  // simulator is left unenrolled again.
  const biometricGap = simctlBiometricGap();
  test(
    'enrollBiometrics and setBiometrics answer a biometric prompt',
    { platforms: ['ios'], ...(biometricGap === undefined ? {} : { skip: biometricGap }) },
    async ({ device, screen }) => {
      await screen.getByTestId('tab-device').tap();
      const status = screen.getByTestId('biometrics-status');
      try {
        await device.enrollBiometrics('faceid', true);
        await screen.getByTestId('unlock-biometrics').tap();
        await expect(status).toHaveText('biometrics: authenticating');
        await device.setBiometrics('faceid', 'match');
        await expect(status).toHaveText('biometrics: unlocked');
      } finally {
        await device.enrollBiometrics('faceid', false);
      }
    },
  );

  test(
    'setBiometrics answers a fingerprint prompt',
    {
      platforms: ['android'],
      skip: "the emulator's fingerprint answers only once a lock screen and a finger are enrolled by hand, and enrollBiometrics takes faceid or touchid only",
    },
    async ({ device, screen }) => {
      await screen.getByTestId('tab-device').tap();
      await screen.getByTestId('unlock-biometrics').tap();
      await device.setBiometrics('fingerprint', 'match');
      await expect(screen.getByTestId('biometrics-status')).toHaveText('biometrics: unlocked');
    },
  );
});

/**
 * Why the device fixture cannot drive the simulator's Face ID on this Mac, or
 * undefined when it can. agent-device 0.21.13 goes through `simctl biometric`
 * and reports the runtime as unsupported when the subcommand is missing; no
 * shipped Xcode declares it (27.0 included), while the simulator still takes
 * `notifyutil` on com.apple.BiometricKit, which the fixture does not send.
 * The probe runs on a Mac only; elsewhere the iOS test is not collected.
 */
function simctlBiometricGap(): string | undefined {
  if (process.platform !== 'darwin') return undefined;
  try {
    const help = execFileSync('xcrun', ['simctl', 'help'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (/^\s*biometric\b/m.test(help)) return undefined;
  } catch {
    return 'xcrun simctl is not answering, so the Face ID prompt cannot be driven';
  }
  return "agent-device 0.21.13 drives the simulator's Face ID through `simctl biometric`, a subcommand this Xcode's simctl does not declare (Xcode 27.0 included)";
}
