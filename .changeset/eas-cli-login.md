---
"@e2e-dev/eas": minor
---

`easSimulators()` authenticates with the eas-cli login when `EXPO_TOKEN` is not set: it reads the session `eas login` keeps in `~/.expo/state.json` (under `USERPROFILE` on Windows) and sends it in the `expo-session` header, as eas-cli does, so a machine signed in to eas-cli needs no token. `EXPO_TOKEN` still wins when both are there. A session is stopped as the account that started it, even if the login changes during the run. Only the production login is read, since the sessions API is `api.expo.dev`. With neither a token nor a login, the lease fails with `EXPO_TOKEN is not set and eas-cli is not logged in`.
