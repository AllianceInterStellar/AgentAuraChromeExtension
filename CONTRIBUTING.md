# Contributing

Thanks for looking. This is a Manifest V3 Chrome extension written in plain JavaScript: there
is no build step, no bundler and no framework. The files in the repository are the files the
browser runs, which keeps the loop between an edit and seeing it very short.

## Running it from source

```bash
git clone https://github.com/AllianceInterStellar/AgentAuraChromeExtension.git
cd AgentAuraChromeExtension
node scripts/dev-install.mjs
```

That starts Chrome on a profile of its own, loads the extension through the DevTools
`Extensions.loadUnpacked` command (the `--load-extension` switch has been ignored since Chrome
137) and prints the extension id and the side-panel URL. Node 22 or newer, nothing to install.
Set `CHROME_PATH` if the script cannot find your browser.

By hand instead: `chrome://extensions` → **Developer mode** → **Load unpacked** → pick the
repository directory. After editing a file, click the reload arrow on the extension's card;
the side panel and popup pick up changes when reopened, the service worker when reloaded.

You will need an AgentAura account and a deployed agent gateway to exercise the chat and the
agent. The manage/deploy screens and the options page work without one.

## Tests

```bash
node --test test/*.test.mjs
```

The unit tests load the extension's scripts into a `vm` context with `chrome.*`, `fetch` and
the DOM stubbed, so they run offline in about a second and CI runs them on every push. See
[test/README.md](test/README.md) for what each file covers and for the integration scripts,
which need a live gateway and are run by hand.

When you change behaviour, add or adjust a test beside it. New test files are `test/*.test.mjs`
and are picked up automatically; `test/helpers/load.mjs` has the loader and the stubs.

CI (`.github/workflows/check.yml`) also parses every script, checks that the manifest and the
pages reference files that exist, runs the unit tests, scans for credentials, and loads the
staged extension into a real Chromium to confirm the service worker registers and the side
panel opens. Everything it does can be run locally; the load check needs Playwright
(`npm install --no-save playwright@1.58.2 && npx playwright install chromium`, then
`node scripts/load-check.mjs .`).

## Code style

- Four spaces, LF, UTF-8, no semicolons at line ends, single quotes. `.editorconfig` carries
  the whitespace rules; `eslint.config.js` is there for `npx eslint@9 js pages scripts test`
  and is not enforced by CI (yet).
- Page scripts are classic `<script>` tags sharing one global scope, loaded in the order
  listed in `popup.html` / `sidepanel.html`. A top-level name in one file is a global in the
  next. When you add one that another file uses, add it to `sharedGlobals` in
  `eslint.config.js` so `no-undef` keeps working.
- Anything that ends up in `innerHTML` goes through `escapeHtml`; any URL that ends up in an
  `href` or `src` goes through `sanitizeUrl`. Both are in `js/utils.js`, loaded first.
- User-visible strings go in `js/i18n.js`, in **both** `en` and `zh`, with the same
  `{placeholders}` in each. Other languages fall back to English unless overridden.
  `test/i18n-parity.test.mjs` checks all of this.
- The service worker (`js/background.js`) has no DOM. Errors it returns carry a code from
  `ERR`, and callers decide on the code, never on the (translated) message.
- Prefer a stable error code or status over matching message text, and a real test over a
  comment saying it works.

## Sending a pull request

1. Branch from `main`. Keep a PR to one change; a fix and an unrelated refactor are two PRs.
2. Run `node --test test/*.test.mjs` and load the extension once to click through what you
   changed. If it touches the manifest or a permission, say why in the PR description — Chrome
   shows every permission to every user as a warning.
3. Write the commit message for the reader who finds it in `git blame` two years from now:
   what was wrong, what changed, and why this way.
4. Do not commit credentials, tokens, `.env` files or anything from a live gateway. CI scans
   for the usual shapes, but the scan is a backstop, not a guarantee. The Firebase Web API key
   in `js/auth.js` is the one deliberate exception; see [SECURITY.md](SECURITY.md).
5. Bumping the version is done in `manifest.json` only; the UI reads it from there. A release
   is a `v<version>` tag matching the manifest, and `.github/workflows/release.yml` packages
   and publishes it.

Questions are welcome in the `#agent-aura` channel of
[our Discord](https://discord.gg/PkqfnYSmZB); reproducible bugs are better as issues so they
stay searchable.
