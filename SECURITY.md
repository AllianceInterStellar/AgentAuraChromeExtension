# Security

## Reporting a problem

If you have found something that could put users of this extension at risk — a way for a
page to drive the agent it should not, a leak of gateway credentials, an escape from the
blocked-site rules, an XSS in the side panel — please tell us before making it public.

- Ask for a maintainer in the `#agent-aura` channel of
  [our Discord](https://discord.gg/PkqfnYSmZB) and say you have a security report; they will
  take the details in a direct message.
- Or open a [GitHub issue](https://github.com/AllianceInterStellar/AgentAuraChromeExtension/issues)
  titled "Security report" **without** the exploit details, and a maintainer will get in
  touch for them.

Please include the extension version (`chrome://extensions` shows it), the Chrome version,
and steps to reproduce. We will acknowledge within a few days, and we credit reporters in the
release notes unless asked not to.

Bugs that are not security-sensitive — a broken button, a wrong translation, a failing
deployment — are ordinary issues; open them directly.

## What the extension is allowed to do, and why

The permission set is broad because the agent operates on whatever page you point it at:
`<all_urls>`, `debugger` (input through the DevTools Protocol, which real sites cannot
ignore), `scripting`, `tabs`, `tabGroups`, `downloads`, `notifications`, `alarms`, `storage`,
`identity` and `sidePanel`. Each one is used; `test/manifest.test.mjs` fails if one is
declared and never called. Chrome shows its "is being debugged" banner whenever the debugger
is attached, and the extension injects a visible indicator into any page the agent acts on.

Browser automation is gated on a mode you choose (ask before acting, act then show, or follow
an approved plan), and the service worker refuses to act on sign-in pages, banks, `.gov`
sites and browser-internal pages regardless of mode (`isBlockedSite` in
`js/background.js`, pinned by `test/blocked-site.test.mjs`).

Model output rendered into the side panel goes through `escapeHtml`, and links through
`sanitizeUrl`, which lets only `http(s):` and `mailto:` through. The workflow recorder never
records password, hidden or payment fields.

## The Firebase key in `js/auth.js`

`js/auth.js` contains a Firebase Web API key. That is not an oversight and not a secret: a
Firebase Web API key identifies the project to Google's endpoints and is designed to ship
inside the client — every installed copy of this extension already contains it. Access is
controlled by Firebase Auth and the backend's own rules, not by hiding this string. Reporting
it as a leaked credential is a common false positive; please do not.

Nothing else in this repository is a credential. The integration scripts under `test/` read
the gateway address, token and claw id from the environment (see
[test/README.md](test/README.md)), and CI scans every push for the shapes of the things that
must never be committed: gateway tokens, API keys, GitHub tokens, private keys, Firebase
refresh tokens and JWTs.

## Supported versions

Only the latest release is supported. Fixes ship as a new version through the Chrome Web
Store listing and as a zip on the
[Releases](https://github.com/AllianceInterStellar/AgentAuraChromeExtension/releases) page.
