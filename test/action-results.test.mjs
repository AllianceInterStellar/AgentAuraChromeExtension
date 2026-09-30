/**
 * ActionResults: the return value of an action, as the model gets to read it, and the
 * "[ref] → label" index the approval card uses.
 *
 *   node --test test/action-results.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadScripts } from './helpers/load.mjs'

const { run } = loadScripts(['js/agent/action-results.js'])
const ActionResults = run('ActionResults')
const sum = (action, result, limits) => ActionResults.summarize(action, result, limits)

test('an action with nothing to report summarises to null', () => {
    assert.equal(sum({ type: 'click' }, { success: true }), null)
    assert.equal(sum({ type: 'scroll' }, { success: true, code: undefined }), null)
    assert.equal(sum({ type: 'wait' }, undefined), null)
})

test('a failed result is not summarised here (the failure path reports it)', () => {
    assert.equal(sum({ type: 'get_page_text' }, { success: false, error: 'boom', text: 'not this' }), null)
})

test('get_page_text: title, length and the text itself, clipped to the limit', () => {
    const text = 'x'.repeat(10000)
    const out = sum({ type: 'get_page_text' }, { success: true, title: 'Hello', url: 'https://e.com', text })
    assert.match(out, /^title: Hello\n/)
    assert.match(out, /text \(10000 chars, first 8000 shown\):/)
    assert.equal(out.length, out.indexOf(':\n') + 2 + 8000)
    const short = sum({ type: 'read_page' }, { success: true, text: 'abc' })
    assert.equal(short, 'text (3 chars):\nabc')
})

test('find: count and one line per element', () => {
    const out = sum({ type: 'find', selector: '.p' }, {
        success: true, count: 2,
        elements: [{ index: 0, tag: 'span', text: '$9', id: 'a', className: 'p' }, { index: 1, tag: 'span', text: '$10', id: '', className: '' }]
    })
    assert.equal(out, '2 matches:\n0. <span id="a" class="p"> $9\n1. <span> $10')
    assert.equal(sum({ type: 'find' }, { success: true, count: 0, elements: [] }), '0 matches')
})

test('read_console: the last lines, with level and source', () => {
    const messages = Array.from({ length: 60 }, (_, i) => ({ level: i % 2 ? 'error' : 'log', text: `m${i}`, url: 'https://e.com/a.js' }))
    const out = sum({ type: 'read_console' }, { success: true, messages })
    assert.match(out, /^60 console messages, last 50 shown:\n/)
    assert.match(out, /\[log\] m10 \(https:\/\/e\.com\/a\.js\)\n/)
    assert.doesNotMatch(out, /\bm9\b/)
    assert.equal(sum({ type: 'read_console' }, { success: true, messages: [] }), 'no console messages')
})

test('read_network: method, url, status and mime type', () => {
    const out = sum({ type: 'read_network' }, { success: true, requests: [{ method: 'POST', url: 'https://e.com/api', status: 201, mimeType: 'application/json' }, { url: 'https://e.com/x' }] })
    assert.equal(out, '2 requests:\nPOST https://e.com/api → 201 application/json\nGET https://e.com/x')
})

test('read_network: a response body rides under its request when it was asked for', () => {
    const out = sum({ type: 'read_network' }, { success: true, requests: [{ method: 'GET', url: 'https://e.com/api', status: 200, mimeType: 'application/json', body: '{"a":1}' }] })
    assert.equal(out, '1 requests:\nGET https://e.com/api → 200 application/json\n  body: {"a":1}')
})

test('a dialog the page opened is reported with any result, and never as a plain field', () => {
    const dialogs = [{ type: 'confirm', message: 'Delete everything?', accepted: false }]
    const click = sum({ type: 'click' }, { success: true, dialogs })
    assert.equal(click, 'page dialog confirm: "Delete everything?" — declined automatically; do not trigger dialogs')
    const text = sum({ type: 'get_page_text' }, { success: true, text: 'hi', dialogs: [{ type: 'alert', message: 'Hi!', accepted: true }] })
    assert.equal(text, 'text (2 chars):\nhi\npage dialog alert: "Hi!" — dismissed automatically; do not trigger dialogs')
    assert.equal(sum({ type: 'click' }, { success: true }), null)
})

test('list_tabs, new_tab and screenshot', () => {
    assert.equal(sum({ type: 'list_tabs' }, { success: true, tabs: [{ id: 3, title: 'A', url: 'https://a', active: true }, { id: 4, title: 'B', url: 'https://b' }] }),
        'tab 3 (active): A | https://a\ntab 4: B | https://b')
    assert.equal(sum({ type: 'new_tab' }, { success: true, tabId: 12 }), 'opened tab 12')
    assert.equal(sum({ type: 'screenshot' }, { success: true, dataUrl: 'data:image/jpeg;base64,AAA' }), 'screenshot attached to this message')
    assert.equal(sum({ type: 'screenshot' }, { success: true, dataUrl: 'data:image/jpeg;base64,AAA', saved: 'AgentAura/screenshot-1.jpg' }), 'screenshot attached to this message; saved to AgentAura/screenshot-1.jpg')
    assert.equal(sum({ type: 'close_tab' }, { success: true, closedTabId: 4, nextTabId: 3 }), 'closed tab 4, now on tab 3')
    assert.equal(sum({ type: 'close_tab' }, { success: true, closedTabId: 4, nextTabId: null }), 'closed tab 4')
})

test('execute_js: primitives and objects come back as text, clipped', () => {
    assert.equal(sum({ type: 'execute_js' }, 'Hello'), 'Hello')
    assert.equal(sum({ type: 'execute_js' }, 0), '0')
    assert.equal(sum({ type: 'execute_js' }, false), 'false')
    assert.equal(sum({ type: 'execute_js' }, null), 'null')
    assert.equal(sum({ type: 'execute_js' }, { a: 1, b: [1, 2] }), '{"a":1,"b":[1,2]}')
    const big = sum({ type: 'execute_js' }, 'y'.repeat(5000))
    assert.match(big, /… \[1000 more chars\]$/)
    assert.ok(big.length < 4100)
})

test('an unknown action with extra fields shows those fields', () => {
    assert.equal(sum({ type: 'whatever' }, { success: true, count: 3, names: ['a'] }), '{"count":3,"names":["a"]}')
})

test('parseRefLabels reads the element list lines and tolerates attributes', () => {
    const page = [
        '[1] <a role="link"> "Home" → https://e.com/ @(0,0)',
        '[2] <input type="password"> "Password" sensitive @(10,20)',
        '[3] <button disabled> "Send" @(1,1)',
        '[4] <div role="button" checked>',
        'not an element line',
        '[5] <input type="text"> value="hello" @(1,2)',
    ].join('\n')
    const labels = ActionResults.parseRefLabels(page)
    assert.equal(labels.get(1), 'a "Home"')
    assert.equal(labels.get(2), 'input[password] "Password"')
    assert.equal(labels.get(3), 'button "Send"')
    assert.equal(labels.get(4), 'div')
    assert.equal(labels.get(5), 'input[text]')
    assert.equal(labels.size, 5)
    assert.equal(ActionResults.parseRefLabels(null).size, 0)
})
