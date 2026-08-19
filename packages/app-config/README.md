# @major-vis/app-config

Client-side service + auth configuration shared by the browse, schedule, and
planner apps. Decides which services are shown in the nav and (later) how
authentication is presented, so a deployment can toggle services without
touching app code.

## Contract

`loadConfig({ endpoint, staticPath, fallback })` — resolves and caches the
config, trying:

1. `endpoint` — a server URL returning `{ services: string[], auth? }`
   (the deployment's `/api/config`, driven by the `SERVICES` env var). The
   production source when the backend exists.
2. `staticPath` — a `config.json` adjacent to the deployment (`{ "services":
[...] }`). The fallback for the current serverless hosting.
3. `fallback` — an in-code default (all services) for the rare case that both
   network sources are unreachable.

The resolved `services` array is normalized against `SERVICE_KEYS`: unknown
keys are dropped and the known ones are returned in registry order (a config
listing `planner, program` resolves to `program, planner`). A source that is
missing, returns non-`ok`, or yields no recognizable services falls through to
the next. Malformed payloads never throw — they just skip to the next source.

Returns the resolved config `{ services, auth }` (a promise; awaiting is
expected). Concurrent callers share one fetch.

Other exports:

- `isEnabled(key)` — whether a service key (`'program' | 'schedule' |
'planner'`) is enabled in the resolved config.
- `config()` — the resolved config, or `null` before `loadConfig` completes.
- `SERVICE_DEFS` — `[{ key, label, dir }]` for the canonical services (`dir`
  is the app's directory: browse → `browse`, etc.).
- `SERVICE_KEYS` — the canonical keys.
- `config.json` is the static fallback: commit a file like
  `{ "services": ["schedule"] }` at the deployment root; the apps resolve it
  relative to their own pages (`../../config.json` once the server exists).
- `resetConfig()` — clears the cache (tests only).

## Example

```js
import { loadConfig, isEnabled, SERVICE_DEFS } from '@major-vis/app-config'

await loadConfig({ endpoint: '../../api/config', staticPath: '../../config.json' })

const navLinks = SERVICE_DEFS.filter((s) => isEnabled(s.key))
```

## Service keys

| key        | label    | dir        |
| ---------- | -------- | ---------- |
| `program`  | Programs | `browse`   |
| `schedule` | Schedule | `schedule` |
| `planner`  | Planner  | `planner`  |
