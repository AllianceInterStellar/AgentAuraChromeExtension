/**
 * isBlockedSite(url): the pages the agent must never act on. Sign-in flows, banks and
 * government sites are refused by hostname or path; browser-internal schemes are refused
 * outright; anything unparseable is not a page and is not blocked.
 *
 *   node --test test/blocked-site.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadScripts } from './helpers/load.mjs'

const { run, exports } = loadScripts(['js/background.js'])
const isBlockedSite = run('isBlockedSite')

const cases = [
    // government
    ['https://www.irs.gov/', true],
    ['https://foo.gov', true],
    ['https://example.gov.uk/', true],
    ['https://GOV.example.com/', false, 'gov as a subdomain is not a TLD'],
    ['https://government.example.com/', false],
    // identity providers, exact and by suffix
    ['https://accounts.google.com/x', true],
    ['https://sub.accounts.google.com/', true],
    ['https://login.microsoftonline.com/common/', true],
    ['https://login.live.com/', true],
    ['https://appleid.apple.com/', true],
    ['https://appleid.apple.com.evil.example/', false, 'a suffix match needs the dot before the host'],
    ['https://notappleid.apple.com/', false],
    // sign-in labels anywhere in the hostname
    ['https://sub.login.example.com/', true],
    ['https://signin.example.com/', true],
    ['https://SSO.Example.COM/', true],
    ['https://auth.example.com/', true],
    ['https://accounts.example.com/', true],
    ['https://authors.example.com/', false, 'labels match whole, not by prefix'],
    // banks
    ['https://bankofexample.com/', true],
    ['https://mybank.example.com/', true],
    ['https://onlinebanking.example.com/', true],
    ['https://embankment.example.com/', false],
    // paths
    ['https://example.com/oauth/authorize', true],
    ['https://example.com/api/oauth2/token', true],
    ['https://example.com/auth/callback', true],
    ['https://example.com/signin', true],
    ['https://example.com/sign-in/', true],
    ['https://example.com/account/login?next=/', true],
    ['https://example.com/api/sso/token', true],
    ['https://example.com/docs/auth-guide', false],
    ['https://example.com/authors/', false],
    ['https://example.com/api/auth/x', false, 'a bare "auth" segment only counts when it comes first'],
    // ordinary pages
    ['https://news.ycombinator.com/', false],
    ['https://example.com/', false],
    ['http://localhost:8080/app', false],
    // browser-internal schemes
    ['chrome://settings', true],
    ['chrome-extension://abcdefgh/popup.html', true],
    ['about:blank', true],
    ['file:///etc/passwd', true],
    ['devtools://devtools/bundled/inspector.html', true],
    // other schemes are not pages the agent can act on, and are not blocked
    ['ftp://example.com/', false],
    ['mailto:someone@example.com', false],
    // not URLs
    ['not a url', false],
    ['', false],
    [null, false],
    [undefined, false],
    [42, false],
]

for (const [url, expected, why] of cases) {
    test(`${JSON.stringify(url)} → ${expected}${why ? ` (${why})` : ''}`, () => {
        assert.equal(isBlockedSite(url), expected)
    })
}

test('the decision is case-insensitive in host and path', () => {
    assert.equal(isBlockedSite('https://ACCOUNTS.GOOGLE.COM/'), true)
    assert.equal(isBlockedSite('https://example.com/OAuth/Authorize'), true)
    assert.equal(isBlockedSite('https://example.com/AUTH/x'), true)
})

test('isHttpUrl: the only scheme a navigation may use', () => {
    const { isHttpUrl } = exports['js/background.js']
    for (const ok of ['https://example.com', 'http://localhost:3000/x', ' HTTPS://E.COM/?a=b#c ']) assert.equal(isHttpUrl(ok), true, ok)
    for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'chrome://settings', 'about:blank', 'https://', 'https:// space.com', 'example.com', '', null, undefined, 42]) {
        assert.equal(isHttpUrl(bad), false, String(bad))
    }
})

test('matchesPattern: a regular expression when it parses, a substring otherwise, everything when empty', () => {
    const { matchesPattern } = exports['js/background.js']
    assert.equal(matchesPattern('[error] boom', 'err'), true)
    assert.equal(matchesPattern('[error] boom', 'ERR'), true, 'case-insensitive')
    assert.equal(matchesPattern('[error] boom', '^\\[error\\]'), true)
    assert.equal(matchesPattern('[error] boom', 'warn|info'), false)
    assert.equal(matchesPattern('a(b', 'a(b'), true, 'an unparseable pattern falls back to substring')
    assert.equal(matchesPattern('anything', ''), true)
    assert.equal(matchesPattern('anything', undefined), true)
    assert.equal(matchesPattern(undefined, 'x'), false)
})

test('isFinancialSite: payment providers, exchanges, banks by host; checkout and billing by path', () => {
    const { isFinancialSite } = exports['js/background.js']
    for (const yes of ['https://www.paypal.com/myaccount', 'https://checkout.stripe.com/pay/cs_1', 'https://pro.coinbase.com/', 'https://www.chase.com/personal',
        'https://shop.example.com/checkout', 'https://example.com/cart', 'https://example.com/account/billing', 'https://example.com/orders/123', 'https://app.example.com/subscribe']) {
        assert.equal(isFinancialSite(yes), true, yes)
    }
    for (const no of ['https://example.com/', 'https://news.ycombinator.com/', 'https://example.com/docs/payments-api', 'https://notpaypal.com/', 'https://paypal.com.evil.example/', 'about:blank', '', null]) {
        assert.equal(isFinancialSite(no), false, String(no))
    }
})

test('hostMatches: exact host or subdomain, tolerant of a pasted URL', () => {
    const { hostMatches } = exports['js/background.js']
    assert.equal(hostMatches('example.com', ['example.com']), true)
    assert.equal(hostMatches('a.b.example.com', ['example.com']), true)
    assert.equal(hostMatches('notexample.com', ['example.com']), false)
    assert.equal(hostMatches('example.com', ['https://Example.com/path']), true)
    assert.equal(hostMatches('example.com', ['', '  ', null]), false)
    assert.equal(hostMatches('example.com', 'example.com'), false, 'a list, not a string')
    assert.equal(hostMatches('', ['example.com']), false)
})

test('normalizePolicy: the administrator\'s values in the shape the code reads, junk dropped', () => {
    const { normalizePolicy, policyIsSet } = exports['js/background.js']
    const empty = normalizePolicy(undefined)
    assert.deepEqual([...empty.AllowedSites], [])
    assert.equal(empty.DisableExecuteJs, false)
    assert.equal(policyIsSet(empty), false)

    const p = normalizePolicy({
        AllowedSites: ['Example.com', 'https://Intranet.corp/path', '', 'bad host!', null],
        BlockedSites: ['facebook.com'],
        AllowedPermissionModes: ['ASK', 'plan', 'yolo', 7],
        DisableExecuteJs: true,
        DisableScheduledTasks: 'yes',
        DisableUnattendedRuns: false,
    })
    assert.deepEqual([...p.AllowedSites], ['example.com', 'intranet.corp'])
    assert.deepEqual([...p.BlockedSites], ['facebook.com'])
    assert.deepEqual([...p.AllowedPermissionModes], ['ask', 'plan'])
    assert.equal(p.DisableExecuteJs, true)
    assert.equal(p.DisableScheduledTasks, false, 'only a real true counts')
    assert.equal(policyIsSet(p), true)
    assert.equal(policyIsSet(normalizePolicy({ DisableUnattendedRuns: true })), true)
})

test('policyBlocksHost: blocked sites always, and everything else when an allow list exists', () => {
    const { normalizePolicy, policyBlocksHost } = exports['js/background.js']
    const none = normalizePolicy({})
    assert.equal(policyBlocksHost('example.com', none), false)
    const blocked = normalizePolicy({ BlockedSites: ['facebook.com'] })
    assert.equal(policyBlocksHost('www.facebook.com', blocked), true)
    assert.equal(policyBlocksHost('example.com', blocked), false)
    const allowOnly = normalizePolicy({ AllowedSites: ['corp.example'] })
    assert.equal(policyBlocksHost('wiki.corp.example', allowOnly), false)
    assert.equal(policyBlocksHost('news.ycombinator.com', allowOnly), true)
    const both = normalizePolicy({ AllowedSites: ['corp.example'], BlockedSites: ['hr.corp.example'] })
    assert.equal(policyBlocksHost('hr.corp.example', both), true, 'a blocked site inside the allowed one stays blocked')
    assert.equal(policyBlocksHost('', both), false)
})

test('dialogAnswer: an alert is dismissed, everything else is declined', () => {
    const { dialogAnswer } = exports['js/background.js']
    // Objects made inside the vm have another realm's prototype; compare the field.
    assert.equal(dialogAnswer('alert').accept, true)
    assert.equal(dialogAnswer('confirm').accept, false)
    assert.equal(dialogAnswer('prompt').accept, false)
    assert.equal(dialogAnswer('beforeunload').accept, false, 'the page and its unsaved form stay')
    assert.equal(dialogAnswer(undefined).accept, false)
})

test('the worker exports what the tests and the side panel rely on', () => {
    const api = exports['js/background.js']
    assert.equal(api.isBlockedSite, isBlockedSite)
    assert.equal(typeof api.mapKey, 'function')
    assert.equal(typeof api.isHttpUrl, 'function')
    assert.equal(api.ERR.BLOCKED_SITE, 'BLOCKED_SITE')
    assert.equal(api.ERR.SENSITIVE_FIELD, 'SENSITIVE_FIELD')
    assert.equal(api.ERR.INVALID_URL, 'INVALID_URL')
    assert.equal(api.ERR.TIMEOUT, 'TIMEOUT')
    assert.equal(api.ERR.POLICY, 'POLICY')
    for (const [name, code] of Object.entries(api.ERR)) {
        assert.equal(name, code, 'error codes read the same as their names')
    }
})
