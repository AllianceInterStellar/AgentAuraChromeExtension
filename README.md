# AgentAura Chrome Extension

[![Discord](https://img.shields.io/badge/Discord-join%20the%20community-5865F2?logo=discord&logoColor=white)](https://discord.gg/PkqfnYSmZB)

A Manifest V3 Chrome extension that puts an AI agent in a side panel and lets it act on the
browser you are already looking at — open tabs, read pages, fill forms, click through flows —
while you stay in control of how much it is allowed to do on its own.

It is the browser client for [AgentAura](https://allianceinterstellar.com): the reasoning runs
on an agent gateway you deploy, and this extension is the pair of hands.

## What it does

- **Side-panel chat** (`Alt+Shift+E`; `Alt+Shift+A` opens the agent for the current tab) that
  talks to your agent gateway over a WebSocket.
- **Browser automation** driven by the model: navigation, clicks, typing, forms, reading page
  text, console and network, running JavaScript, screenshots on request. Clicks and typing
  are DOM events by default; the `cdp_*` actions go through the Chrome DevTools Protocol for
  pages that ignore synthetic events. Every action's result is sent back to the model.
- **An accessibility-tree view of the page** rather than raw HTML, so the model sees the
  structure a screen reader would instead of a megabyte of markup.
- **Workflow recording** — capture what you did once, replay it as a saved shortcut.
- **Scheduled tasks** that run on an alarm and report back.
- **Skill installation** onto the connected agent.
- UI in English and Simplified Chinese, fully translated. Twelve more languages (ar, de, es,
  es-419, fr, it, ja, ko, pl, pt-BR, ru, tr) are offered as well, but they currently translate
  only the navigation and key notices and fall back to English everywhere else; they are
  marked "(partial)" in the language menu.

## The permission model

Browser automation is the part worth being careful about, so it is gated on a mode you pick,
not buried in a settings page:

| Mode | Behaviour |
|---|---|
| **Ask Before Acting** | The agent asks for approval before each action. The default. |
| **Act Before Asking** | The agent acts, then shows you what it did. |
| **Follow a Plan** | The agent presents a plan and executes it once you approve. |

Whatever the mode, two things always ask first: running JavaScript in the page
(`execute_js`, with the code shown on the card), and typing into a field that looks like a
password, one-time code or card number (the field is named on the card, and its current value
is never sent to the model). "Approve all" on the card covers the rest of that task, not every
task from then on. A scheduled task asks before every action unless it was created with "run
unattended", because nobody may be watching when its alarm fires. Screenshots go to the model
when the element list cannot carry the page or when the agent asks for one, not on every
turn; the old behaviour is a switch in Settings.

A visual indicator is injected into any page the agent is acting on, so an automated click is
never mistaken for one of yours.

## Why the permissions are broad

Chrome shows a blunt warning for this extension, and the reasons are real rather than
incidental:

- **`<all_urls>`** — the agent operates on whatever page you point it at. There is no useful
  subset to request in advance. The two content scripts (the accessibility-tree reader and the
  on-page indicator) are injected into a tab the first time the agent acts on it, not into every
  page you open.
- **`debugger`** — automation attaches the DevTools Protocol to the tab. Synthetic DOM events
  are ignored by a lot of real sites; CDP input is not. Chrome shows its own "is being
  debugged" banner whenever this is active, which is the honest signal that it is on.
- **`downloads`, `notifications`, `alarms`** — saving what the agent produces, telling you it
  finished, and running scheduled tasks.

## Installing from source

```bash
git clone https://github.com/AllianceInterStellar/AgentAuraChromeExtension.git
cd AgentAuraChromeExtension
node scripts/dev-install.mjs
```

That launches Chrome with the extension loaded and prints its id and side-panel URL. It uses
a profile of its own, so the browser you are working in is untouched and you do not have to
quit it. Node 22+; nothing to install.

The manifest asks for Chrome 137 or newer. The side panel API needs 114, and the gateway
handshake signs a challenge with an Ed25519 key through WebCrypto, which Chrome ships enabled
from 137.

> Chrome 137 disabled the `--load-extension` switch, and it is now ignored *silently* — which
> looks exactly like the extension failing to load. The script uses what replaced it, the
> `Extensions.loadUnpacked` DevTools command behind `--enable-unsafe-extension-debugging`.
> Extensions loaded this way live for the browser session; run it again after a restart.

By hand, if you prefer: `chrome://extensions` → **Developer mode** → **Load unpacked** → pick
the directory. There is no build step; the extension runs from source as it is.

You will need an AgentAura account and a deployed agent gateway for it to talk to.

This version runs one agent per account. The server enforces that; when it refuses a second
deployment, the extension opens [allianceinterstellar.com](https://allianceinterstellar.com/pricing#agentaura-plans)
in a new tab instead of showing an error.

## A note on the Firebase key in `js/auth.js`

`js/auth.js` contains a Firebase Web API key. That is not an oversight and not a secret: a
Firebase Web API key identifies the project to Google's endpoints and is designed to ship
inside the client — every installed copy of this extension already contains it. Access is
controlled by Firebase Auth and the backend's own rules, not by hiding this string.

Nothing else in this repository is a credential. The test scripts read the gateway address,
token and claw id from the environment; see [test/README.md](test/README.md).

## Tests

`test/` holds integration scripts that drive a real Chrome with the extension loaded and a
live gateway. They are not unit tests and they do not run unattended in CI — they need a
gateway to talk to. CI checks what can be checked without one: every file parses, the
manifest is valid, and the unit tests in `test/*.test.mjs` pass (`node --test test/*.test.mjs`;
Node 22, nothing to install).

## Community

[Our Discord](https://discord.gg/PkqfnYSmZB) has an `#agent-aura` channel for gateway and
extension questions, and `#help-and-feedback` for everything else. Reproducible bugs are
better as issues here so they stay searchable.

## Licence

MIT — see [LICENSE](LICENSE).
