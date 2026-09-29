/**
 * js/utils.js: the helpers every page shares. escapeHtml has to be safe inside attributes as
 * well as between tags, and sanitizeUrl is the only thing standing between a link in model
 * output and `javascript:`.
 *
 *   node --test test/utils.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadScripts } from './helpers/load.mjs'

const { exports } = loadScripts(['js/utils.js'])
const { escapeHtml, escapeAttr, sanitizeUrl, toNumber, clamp, cssToken } = exports['js/utils.js']

test('escapeHtml escapes all five characters, and only those', () => {
    assert.equal(escapeHtml('&'), '&amp;')
    assert.equal(escapeHtml('<'), '&lt;')
    assert.equal(escapeHtml('>'), '&gt;')
    assert.equal(escapeHtml('"'), '&quot;')
    assert.equal(escapeHtml("'"), '&#39;')
    assert.equal(escapeHtml(`<a href="x" title='y'>&</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;')
    assert.equal(escapeHtml('plain text, no. 1 / 2 ~ ok'), 'plain text, no. 1 / 2 ~ ok')
    assert.equal(escapeHtml('日本語 émoji 🙂'), '日本語 émoji 🙂')
})

test('escapeHtml is idempotent only once — double escaping is visible', () => {
    assert.equal(escapeHtml(escapeHtml('<')), '&amp;lt;')
})

test('escapeHtml tolerates non-strings', () => {
    assert.equal(escapeHtml(null), '')
    assert.equal(escapeHtml(undefined), '')
    assert.equal(escapeHtml(''), '')
    assert.equal(escapeHtml(0), '0')
    assert.equal(escapeHtml(12.5), '12.5')
    assert.equal(escapeHtml(false), 'false')
    assert.equal(escapeHtml({ toString: () => '<x>' }), '&lt;x&gt;')
})

test('escapeAttr is the same escaping under the name that says where it is used', () => {
    const s = `a"b'c<d>e&f`
    assert.equal(escapeAttr(s), escapeHtml(s))
})

test('sanitizeUrl lets http(s) and mailto through unchanged', () => {
    assert.equal(sanitizeUrl('https://example.com/a?b=1&c=2#x'), 'https://example.com/a?b=1&c=2#x')
    assert.equal(sanitizeUrl('http://example.com'), 'http://example.com')
    assert.equal(sanitizeUrl('HTTPS://EXAMPLE.COM/'), 'HTTPS://EXAMPLE.COM/')
    assert.equal(sanitizeUrl('mailto:someone@example.com'), 'mailto:someone@example.com')
    assert.equal(sanitizeUrl('  https://example.com  '), 'https://example.com', 'surrounding whitespace is trimmed')
})

test('sanitizeUrl turns every other scheme into "#"', () => {
    for (const bad of [
        'javascript:alert(1)',
        'JavaScript:alert(1)',
        ' javascript:alert(1)',
        'java\nscript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        'data:image/svg+xml;base64,PHN2Zz4=',
        'data:image/png;base64,iVBORw0KGgo=',
        'file:///etc/passwd',
        'ftp://example.com/',
        'chrome://settings',
        'chrome-extension://abc/popup.html',
        'vbscript:msgbox(1)',
        'blob:https://example.com/uuid',
        'https:example.com',
        '//example.com/protocol-relative',
        '/relative/path',
        'example.com',
        '',
        '   ',
        null,
        undefined,
    ]) {
        assert.equal(sanitizeUrl(bad), '#', `${JSON.stringify(bad)} must not survive`)
    }
})

test('sanitizeUrl allows a base64 data: image only when asked', () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    assert.equal(sanitizeUrl(png), '#', 'off by default')
    assert.equal(sanitizeUrl(png, { allowDataImage: true }), png)
    assert.equal(sanitizeUrl('data:image/jpeg;base64,/9j/4AAQ', { allowDataImage: true }), 'data:image/jpeg;base64,/9j/4AAQ')
    assert.equal(sanitizeUrl('data:image/jpg;base64,/9j/4AAQ', { allowDataImage: true }), 'data:image/jpg;base64,/9j/4AAQ')
    assert.equal(sanitizeUrl('data:image/gif;base64,R0lGODlh', { allowDataImage: true }), 'data:image/gif;base64,R0lGODlh')
    assert.equal(sanitizeUrl('data:image/webp;base64,UklGRg==', { allowDataImage: true }), 'data:image/webp;base64,UklGRg==')
    // Not an image, not base64, or a type that can carry script: still refused.
    assert.equal(sanitizeUrl('data:image/svg+xml;base64,PHN2Zz4=', { allowDataImage: true }), '#')
    assert.equal(sanitizeUrl('data:text/html;base64,PHNjcmlwdD4=', { allowDataImage: true }), '#')
    assert.equal(sanitizeUrl('data:image/png,rawbytes', { allowDataImage: true }), '#')
    assert.equal(sanitizeUrl('data:image/png;base64,not base64!', { allowDataImage: true }), '#')
    assert.equal(sanitizeUrl('data:image/png;base64,', { allowDataImage: true }), '#')
})

test('toNumber accepts numbers and numeric strings, otherwise the fallback', () => {
    assert.equal(toNumber(5), 5)
    assert.equal(toNumber(-2.5), -2.5)
    assert.equal(toNumber('12.5'), 12.5)
    assert.equal(toNumber(' 7 '), 7)
    assert.equal(toNumber('3 apples'), 3, 'parseFloat semantics: a leading number counts')
    assert.equal(toNumber('abc'), 0)
    assert.equal(toNumber('abc', 9), 9)
    assert.equal(toNumber(NaN, 1), 1)
    assert.equal(toNumber(Infinity, 1), 1)
    assert.equal(toNumber(-Infinity, 1), 1)
    assert.equal(toNumber(null), 0)
    assert.equal(toNumber(undefined, 4), 4)
    assert.equal(toNumber({}, 4), 4)
    assert.equal(toNumber('', 4), 4)
    assert.equal(toNumber(0, 4), 0, 'zero is a number, not a missing value')
})

test('clamp', () => {
    assert.equal(clamp(5, 0, 3), 3)
    assert.equal(clamp(-1, 0, 3), 0)
    assert.equal(clamp(2, 0, 3), 2)
    assert.equal(clamp(0, 0, 3), 0)
    assert.equal(clamp(3, 0, 3), 3)
    assert.equal(clamp(1.5, 1, 2), 1.5)
})

test('cssToken keeps [a-z0-9_-] and nothing else', () => {
    assert.equal(cssToken('running'), 'running')
    assert.equal(cssToken('Running'), 'running', 'lower-cased')
    assert.equal(cssToken('a_b-1'), 'a_b-1')
    assert.equal(cssToken('bad value'), '')
    assert.equal(cssToken('bad value', 'unknown'), 'unknown')
    assert.equal(cssToken('x"onmouseover="alert(1)', 'safe'), 'safe')
    assert.equal(cssToken('semi;colon', 'safe'), 'safe')
    assert.equal(cssToken('', 'safe'), 'safe')
    assert.equal(cssToken(null), '')
    assert.equal(cssToken(undefined, 'safe'), 'safe')
    assert.equal(cssToken(42), '42')
})
