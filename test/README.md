# Integration tests

These scripts drive a real Chrome with the extension loaded, against a real agent gateway.
There is no fixture that can stand in for one, so they are run by hand, not in CI.

## Configuration

Everything that identifies a gateway comes from the environment. Nothing here is committed —
an earlier revision of these scripts hardcoded a working token for a live machine, which is
exactly the mistake this arrangement exists to prevent.

```bash
export AGENTAURA_GATEWAY_URL=wss://<your-subdomain>.digitalenginecore.com/
export AGENTAURA_GATEWAY_TOKEN=<gateway token>
export AGENTAURA_CLAW_ID=<uuid>              # only the skill/config scripts need this
```

A missing variable stops the script immediately with a message naming it, rather than
surfacing later as an unexplained protocol error.

```bash
npm install          # playwright, ws
node e2e-agent-loop.mjs
```

## What is here

| Script | What it covers |
|---|---|
| `e2e-agent-loop.mjs` | The full loop: model emits actions, extension executes, result feeds back |
| `e2e-browser-automation.mjs` | Navigation, clicking, typing, extraction against real pages |
| `e2e-comprehensive.mjs` | Broad sweep across the gateway surface |
| `full-integration-test.mjs` | Extension + gateway + API together |
| `chrome-real-test.mjs` | Loads the unpacked extension into a real Chrome via Playwright |
| `skill-automation-e2e.mjs`, `test-skill-*.mjs`, `install-skill-v7.mjs` | Skill install and execution |
| `vision-e2e-test.mjs` | Screenshot-and-reason path |
| `connectivity-test.mjs`, `diag-api.mjs`, `probe-gateway-*.mjs` | Narrow diagnostics for one layer at a time |
| `generate-cws-assets.mjs` | Chrome Web Store screenshots, driven off mock data |
| `one-agent-limit.test.mjs` | Unit test, no gateway needed: a 402 from `POST /claws` opens the website, every other failure keeps its error, no script calls a billing endpoint. Runs in CI |

The `probe-*`, `fix-*` and `config-*` scripts were written to pin down specific failures and
are kept because each one documents a protocol detail that is otherwise only in someone's
head.
