/**
 * The one-agent limit, checked without a gateway, a network or a credential.
 *
 * The server decides how many agents an account runs. When it refuses another one, POST /claws
 * answers 402 and the extension opens allianceinterstellar.com instead of showing an error.
 * Every other refusal has to keep the ordinary error toast. These tests load js/i18n.js,
 * js/api.js and js/app.js the way the popup does — classic scripts sharing one global scope —
 * with fetch, chrome.* and the DOM replaced by stubs, and drive the real deploy handler.
 *
 *   node --test test/one-agent-limit.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import vm from 'node:vm'

const root = new URL('../', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

const MORE_AGENTS_URL = 'https://allianceinterstellar.com/pricing#agentaura-plans'

/** The body the backend's fail() helper sends: { success, data, message, code, version }. */
function reply(status, message = null) {
    const body = status < 400
        ? { success: true, data: { id: 'claw-1' }, message: 'ok', code: status }
        : { success: false, data: null, message, code: status }
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: '',
        json: async () => body,
    }
}

function fakeElement() {
    return {
        value: '',
        disabled: false,
        textContent: '',
        innerHTML: '',
        className: '',
        style: {},
        scrollTop: 0,
        scrollHeight: 0,
        classList: { add() { }, remove() { }, contains: () => false },
        addEventListener() { },
        querySelectorAll: () => [],
    }
}

/**
 * A popup with the three scripts loaded. `respond(url, options)` answers every fetch the API
 * client makes; the returned object records what the page did in response.
 */
function loadPopup(respond) {
    const requests = []
    const openedTabs = []
    const elements = new Map()
    const element = (id) => {
        if (!elements.has(id)) elements.set(id, fakeElement())
        return elements.get(id)
    }
    const context = vm.createContext({
        console: { log() { }, warn() { }, error() { } },
        setTimeout: () => 0,
        clearInterval() { },
        setInterval: () => 0,
        fetch: async (url, options) => {
            requests.push({ url, method: options.method })
            return respond(url, options)
        },
        chrome: {
            storage: { local: { get: async () => ({}) } },
            // Copied out of the script's realm so deepEqual compares values, not prototypes.
            tabs: { create: async (props) => { openedTabs.push({ ...props }) } },
            runtime: { getManifest: () => ({ version: '0.0.0' }) },
        },
        document: {
            getElementById: element,
            addEventListener() { },
            querySelectorAll: () => [],
            createElement: () => fakeElement(),
        },
        window: {},
        navigator: { language: 'en' },
        authService: { _refreshTokenIfNeeded: async () => { } },
    })
    context.window.parent = context.window
    for (const script of ['js/i18n.js', 'js/api.js', 'js/app.js']) {
        vm.runInContext(read(script), context, { filename: script })
    }
    const run = (code) => vm.runInContext(code, context)

    return {
        requests,
        openedTabs,
        toast: () => element('toast'),
        run,
        async deploy() {
            element('deploy-name').value = 'my-openclaw'
            run(`selectedProvider = 'hetzner'; selectedPlan = 'cx22'`)
            await run('handleDeploy()')
        },
    }
}

const refusals = [
    [400, 'Invalid server type.'],
    [403, 'Verify an email address or phone number before creating a server.'],
    [409, 'Another server deployment is already in progress for this account.'],
    [429, 'Server limit reached for this account.'],
    [500, 'Failed to create claw: boom'],
    [503, 'Could not verify the account. Please retry.'],
]

test('a 402 from POST /claws opens the website and says why', async () => {
    const popup = loadPopup(() => reply(402, 'A second server is not available on this account.'))
    await popup.deploy()

    assert.deepEqual(popup.requests.map(r => [r.method, new URL(r.url).pathname]), [['POST', '/claws']])
    assert.deepEqual(popup.openedTabs, [{ url: MORE_AGENTS_URL }])
    assert.equal(popup.toast().textContent, popup.run(`I18n.t('toast.oneAgentLimit')`))
    assert.match(popup.toast().className, /\binfo\b/)
})

test('the decision does not depend on how the server words the refusal', async () => {
    const popup = loadPopup(() => reply(402, 'anything at all'))
    await popup.deploy()
    assert.equal(popup.openedTabs.length, 1)
})

for (const [status, message] of refusals) {
    test(`a ${status} from POST /claws keeps the ordinary error and opens nothing`, async () => {
        const popup = loadPopup(() => reply(status, message))
        await popup.deploy()

        assert.deepEqual(popup.openedTabs, [])
        assert.equal(popup.toast().textContent, message)
        assert.match(popup.toast().className, /\berror\b/)
    })
}

test('a network failure keeps the ordinary error and opens nothing', async () => {
    const popup = loadPopup(() => { throw new TypeError('Failed to fetch') })
    await popup.deploy()

    assert.deepEqual(popup.openedTabs, [])
    assert.equal(popup.toast().textContent, 'Failed to fetch')
})

test('a successful create opens nothing', async () => {
    const popup = loadPopup(() => reply(200))
    await popup.deploy()

    assert.deepEqual(popup.openedTabs, [])
    assert.equal(popup.toast().textContent, popup.run(`I18n.t('toast.deployStarted')`))
})

test('a 402 answering any other request is not the agent limit', async () => {
    const popup = loadPopup(() => reply(402, 'not this one'))
    const refusal = async (method, path) => {
        try {
            await popup.run('apiClient')._request(method, path)
        } catch (e) {
            return e
        }
        assert.fail(`${method} ${path} did not fail`)
    }
    const decide = popup.run('isOneAgentLimitRefusal')

    assert.equal(decide(await refusal('POST', '/claws')), true)
    assert.equal(decide(await refusal('GET', '/claws')), false)
    assert.equal(decide(await refusal('POST', '/claws/byos')), false)
    assert.equal(decide(await refusal('POST', '/claws/abc/start')), false)
    assert.equal(decide(await refusal('POST', '/games/memory')), false)
    assert.equal(decide(null), false)
    assert.equal(decide(undefined), false)
    assert.equal(decide(new Error('402')), false)
})

test('the message exists in every interface language', () => {
    const popup = loadPopup(() => reply(200))
    const languages = popup.run('I18n.getAvailableLanguages()').map(l => l.code)
    assert.equal(languages.length, 14)

    const english = popup.run(`I18n.setLang('en'); I18n.t('toast.oneAgentLimit')`)
    assert.notEqual(english, 'toast.oneAgentLimit')
    for (const lang of languages) {
        const text = popup.run(`I18n.setLang(${JSON.stringify(lang)}); I18n.t('toast.oneAgentLimit')`)
        assert.notEqual(text, 'toast.oneAgentLimit', `${lang} has no message`)
        assert.match(text, /allianceinterstellar\.com/, `${lang} does not name the site`)
        if (lang !== 'en') assert.notEqual(text, english, `${lang} falls back to English`)
    }
})

test('no script calls a billing endpoint', () => {
    // The backend's payment routes. The extension sells nothing, so none of them may appear.
    const billing = /['"`]\/(stripe|subscriptions|paypal|coinbase|cryptapi)\b|\/claws\/(purchase|iap)\b/
    const scripts = ['js', 'js/agent', 'js/content-scripts', 'pages']
        .flatMap(dir => readdirSync(new URL(dir, root))
            .filter(f => f.endsWith('.js'))
            .map(f => `${dir}/${f}`))
    assert.ok(scripts.length > 10, 'found too few scripts to trust the scan')
    for (const script of scripts) {
        assert.doesNotMatch(read(script), billing, script)
    }
})
