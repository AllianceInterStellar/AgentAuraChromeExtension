# Tests

Two kinds of thing live here.

- **Unit tests** (`*.test.mjs`) load the extension's own scripts into a `vm` context with
  `chrome.*`, `fetch` and the DOM stubbed. They need no gateway, no network and no
  credentials, and CI runs them on every push.
- **Integration scripts** (everything else) drive a real Chrome with the extension loaded,
  against a real agent gateway. There is no fixture that can stand in for one, so they are run
  by hand, not in CI.

## Unit tests

```bash
node --test test/*.test.mjs      # from the repository root; Node 22, nothing to install
cd test && npm test              # the same thing
```

| File | What it pins down |
|---|---|
| `one-agent-limit.test.mjs` | A 402 from `POST /claws` opens the website; every other failure keeps its error toast; the message exists in every language; no script calls a billing endpoint |
| `blocked-site.test.mjs` | `isBlockedSite()`: sign-in hosts and paths, banks, `.gov`, browser-internal schemes; `isFinancialSite()`, `hostMatches()`, `isHttpUrl()`, `matchesPattern()`, `dialogAnswer()` |
| `map-key.test.mjs` | `mapKey()`: the `{key, code, keyCode}` triple sent over CDP for every named key, letter, digit and function key |
| `utils.test.mjs` | `escapeHtml` (all five characters), `sanitizeUrl` (only http(s)/mailto survive; `data:image` only when asked), `toNumber`, `clamp`, `cssToken` |
| `api-client.test.mjs` | A 401 is replayed once with the refreshed token, then given up as `ApiError` 401; network failure → `NETWORK`, a stuck request → `TIMEOUT`; `getClaws` throws on 5xx; `deleteClaw` hits `/force` only with `{force: true}` |
| `chat-parse.test.mjs` | `parseMessageContent()` for every shape the gateway sends; `renderMarkdown()` escapes markup, turns `javascript:` links into `#`, keeps http links, leaves `$&` inside code alone |
| `automation-engine.test.mjs` | `describeAction()` names the ref for `click_ref` and never reads "undefined", with or without I18n; unknown types come back as their name; `isKnownAction` |
| `workflow-recorder.test.mjs` | `recordAction()` folds keystrokes into one step per field, keeps `redacted`, records nothing when off |
| `i18n-parity.test.mjs` | en and zh have the same keys and the same `{placeholders}`; every key the HTML and the scripts ask for exists in en; every language in the picker can be selected |
| `permission-manager.test.mjs` | `checkPermission()` per mode; `execute_js`, sensitive fields, downloads and changes on payment pages ask in every mode; the per-site allow list and `approveSite()`; "approve all" covers one run and never writes the mode; a run's mode override; plan steps; cancel and supersede |
| `action-results.test.mjs` | `ActionResults.summarize()` for every reading action (page text, find, console, network with bodies, tabs, execute_js, saved screenshots, closed tabs), dialogs the page opened, clipping; `parseRefLabels()` |
| `sensitive-field.test.mjs` | `isSensitiveField()`/`fieldLabel()`/`detectChallenges()` in the content script; the worker's injected functions carry the same test and honour `confirmedSensitive` |
| `task-scheduler.test.mjs` | The schedule arithmetic (`normalizeSchedule`, `nextRunAt` for daily/weekly/monthly, `alarmInfo`), `add()` with its limits and flags, `update()`, `recordRun()` keeping ten runs, the twenty-task cap |
| `manifest.test.mjs` | MV3, `minimum_chrome_version`, every permission is used and every permission-gated API is declared, no content scripts or web-accessible resources, shortcuts avoid `Ctrl+E`/`Ctrl+Shift+A` |

`helpers/load.mjs` is the loader they share: `loadScripts(paths, { globals, chrome, prelude })`
runs the given files in order in one context and returns `run(code)` for reaching top-level
`const`s, plus a per-file `exports` map for the `module.exports` fallbacks. It ships a
`chrome.*` Proxy stub (any path has `addListener`, storage areas remember writes), a fake
`document`, and the timers, `URL`, `crypto`, `AbortController` and friends from Node. Values
that come out of the context belong to another realm: spread them or use `plain()` before
`deepEqual`.

## Integration scripts

### Configuration

Everything that identifies a gateway comes from the environment. Nothing here is committed —
an earlier revision of these scripts hardcoded a working token for a live machine, which is
exactly the mistake this arrangement exists to prevent.

```bash
export AGENTAURA_GATEWAY_URL=wss://<your-subdomain>.digitalenginecore.com/
export AGENTAURA_GATEWAY_TOKEN=<gateway token>
export AGENTAURA_CLAW_ID=<uuid>              # only the skill/config scripts need this
export AGENTAURA_API_ENV=/path/to/api/.env   # only ops/* and skill-automation-e2e.mjs: where DATABASE_URL is read from
```

`env.mjs` is the one place that reads these: `required(name, why)` exits immediately with a
message naming the variable rather than letting an `undefined` surface later as an unexplained
protocol error.

```bash
cd test && npm install
node e2e-agent-loop.mjs
```

### Dependencies

| Package | Used by |
|---|---|
| `ws` | Every gateway script: the WebSocket client to the agent gateway |
| `playwright` | `chrome-real-test.mjs`, `test-extension-live.mjs`, `generate-cws-assets.mjs`, `e2e-browser-automation.mjs`, `full-integration-test.mjs` — a real Chrome with the extension loaded |
| `pg` | `ops/*` and `skill-automation-e2e.mjs`, which read claw records straight from the backend database |
| `ssh2` | `skill-automation-e2e.mjs`, to write a skill file onto the agent's machine over SSH |
| `socks-proxy-agent`, `https-proxy-agent` | `full-integration-test.mjs`, `vision-e2e-test.mjs`, `skill-automation-e2e.mjs`, `test-skill-install.mjs`, `ops/diag-api.mjs` — reaching the API through a local proxy |

The unit tests use none of these.

### What is here

| Script | What it covers |
|---|---|
| `env.mjs` | Shared: reads the variables above and derives the WebSocket `Origin` from the gateway URL |
| `e2e-agent-loop.mjs` | The full loop: model emits actions, extension executes, result feeds back |
| `e2e-browser-automation.mjs` | Navigation, clicking, typing, extraction against real pages |
| `e2e-comprehensive.mjs` | Broad sweep across the gateway surface |
| `full-integration-test.mjs` | Extension + gateway + API together, including creating and tearing down an instance |
| `chrome-real-test.mjs` | Loads the unpacked extension into a real Chrome via Playwright |
| `test-extension-live.mjs` | Launches Chrome with the extension, opens the side panel, injects auth and exercises the UI |
| `test-gateway-chat.mjs` | The device-identity handshake and one `chat.send` round trip |
| `test-message-format.mjs` | The exact message `buildAgentMessage()` produces, driven through a full agent loop |
| `skill-automation-e2e.mjs`, `test-skill-*.mjs`, `install-skill-v7.mjs` | Skill install and execution |
| `vision-e2e-test.mjs` | Screenshot-and-reason path |
| `connectivity-test.mjs` | Extension ↔ backend reachability and protocol compatibility; needs no credentials |
| `tunnel-debug.mjs` | A raw `CONNECT` through the local proxy, for when nothing else connects |
| `probe-gateway-*.mjs` | Narrow diagnostics for one layer of the gateway at a time |
| `generate-cws-assets.mjs` | Chrome Web Store screenshots, driven off mock data |
| `ops/list-claws.mjs`, `ops/get-gateway-info.mjs`, `ops/diag-api.mjs` | Operator tools that read the backend database directly (`AGENTAURA_API_ENV`); not tests |

The `probe-*`, `fix-*` and `config-*` scripts were written to pin down specific failures and
are kept because each one documents a protocol detail that is otherwise only in someone's
head.
