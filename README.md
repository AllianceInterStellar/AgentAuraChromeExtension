# AgentAura Chrome Extension

A Manifest V3 Chrome extension that puts an AI agent in a side panel and lets it act on the
browser you are already looking at — open tabs, read pages, fill forms, click through flows —
while you stay in control of how much it is allowed to do on its own.

It is the browser client for [AgentAura](https://allianceinterstellar.com): the reasoning runs
on an agent gateway you deploy, and this extension is the pair of hands.

## What it does

- **Side-panel chat** (`Ctrl/Cmd+E`) that talks to your agent gateway over a WebSocket.
- **Browser automation** driven by the model: navigation, clicks, typing, extraction. Actions
  go through the Chrome DevTools Protocol, so they work on pages that ignore synthetic events.
- **An accessibility-tree view of the page** rather than raw HTML, so the model sees the
  structure a screen reader would instead of a megabyte of markup.
- **Workflow recording** — capture what you did once, replay it as a saved shortcut.
- **Scheduled tasks** that run on an alarm and report back.
- **Skill installation** onto the connected agent.
- Twelve UI languages: ar, de, en, es, fr, it, ja, ko, pl, ru, tr, zh.

## The permission model

Browser automation is the part worth being careful about, so it is gated on a mode you pick,
not buried in a settings page:

| Mode | Behaviour |
|---|---|
| **Ask Before Acting** | The agent asks for approval before each action. The default. |
| **Act Before Asking** | The agent acts, then shows you what it did. |
| **Follow a Plan** | The agent presents a plan and executes it once you approve. |

A visual indicator is injected into any page the agent is acting on, so an automated click is
never mistaken for one of yours.

## Why the permissions are broad

Chrome shows a blunt warning for this extension, and the reasons are real rather than
incidental:

- **`<all_urls>`** — the agent operates on whatever page you point it at. There is no useful
  subset to request in advance.
- **`debugger`** — automation attaches the DevTools Protocol to the tab. Synthetic DOM events
  are ignored by a lot of real sites; CDP input is not. Chrome shows its own "is being
  debugged" banner whenever this is active, which is the honest signal that it is on.
- **`downloads`, `notifications`, `alarms`** — saving what the agent produces, telling you it
  finished, and running scheduled tasks.

## Installing from source

```bash
git clone https://github.com/AllianceInterStellar/AgentAuraChromeExtension.git
```

Then in Chrome: `chrome://extensions` → enable **Developer mode** → **Load unpacked** → pick
the cloned directory. There is no build step; the extension runs from source as it is.

You will need an AgentAura account and a deployed agent gateway for it to talk to.

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
gateway to talk to. CI checks what can be checked without one: every file parses, and the
manifest is valid.

## Licence

MIT — see [LICENSE](LICENSE).
