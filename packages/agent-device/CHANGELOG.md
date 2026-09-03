# @e2edev/agent-device

## 0.1.0

### Minor Changes

- [#102](https://github.com/tester-army/e2e/pull/102) [`e3300c4`](https://github.com/tester-army/e2e/commit/e3300c4b420ea7a5a7e3ee15480a1e38bd1a133b) Thanks [@okwasniewski](https://github.com/okwasniewski)! - New package: `@e2edev/agent-device`, the mobile backend for `e2e`, built on
  [agent-device](https://github.com/callstack/agent-device). It implements the
  public `@e2edev/e2e/backend` contract for iOS simulators and Android emulators the
  same way `@e2edev/playwright` does for browsers, and core learns nothing new.

  - `agentDevice({ platform, app?, device?, session?, snapshot? })` returns a
    `defineBackend` handle with observation (the accessibility tree projected
    onto the role vocabulary, with a viewport and optional pixels), actions
    (tap, double tap, long press, fill, clear, check, Enter, single-character
    keys, node swipe, drag), location (every `screen` query plus agent-device
    selectors through `screen.locator`), a viewport swipe, `app.back`, and
    `app.restart`/`app.clearState` when `app` is pinned. Screenshots land under
    the attempt artifact directory.
  - Trace cache support: the backend reports a location as
    `app://device/<app>/<screen title>`, so `agent.act` steps record a start and
    end anchor and replay zero-turn on the next run like a web step does.
    Screenshots and observation pixels have every secure field painted over;
    an image that cannot be redacted is withheld. With `app` pinned, the app
    is opened fresh per attempt and a flow needs no agent-side tool at all.
  - The contributed `device` fixture: network, airplane mode, permissions,
    location, appearance, orientation, biometrics, open/close app, foreground
    app, home, back, alerts, keyboard, clipboard. Import `test` from the
    package to have it typed.
  - `@e2edev/agent-device/tools` exports `agentDeviceTools(...backends)`: an
    `open_app`, `swipe`, `type_text`, `alert`, and `screenshot` pack for
    `createAgent`, scoped to the platforms of the backends passed and
    dispatching to the one whose attempt is running, so one pack serves an iOS
    and an Android target in the same config.

- [#114](https://github.com/tester-army/e2e/pull/114) [`e19b826`](https://github.com/tester-army/e2e/commit/e19b826a7f2a944122099851803f6961f107cf86) Thanks [@okwasniewski](https://github.com/okwasniewski)! - Publish under the `@e2edev` npm scope as restricted (private) packages: the core package `e2e` is now `@e2edev/e2e`, beside `@e2edev/playwright` and `@e2edev/agent-device`. Entry points move with the name (`@e2edev/e2e/agent`, `@e2edev/e2e/backend`, `@e2edev/e2e/run`); the `e2e` CLI binary keeps its name. Provenance is off while the packages are private, since npm only attests public packages.
