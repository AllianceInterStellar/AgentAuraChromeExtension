/**
 * AutomationEngine.describeAction: the one line shown on the approval card, so it has to be
 * right for every action type, with and without I18n loaded, and never read "undefined".
 *
 *   node --test test/automation-engine.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadScripts } from './helpers/load.mjs'

const bare = loadScripts(['js/agent/automation-engine.js'])
const translated = loadScripts(['js/utils.js', 'js/i18n.js', 'js/agent/automation-engine.js'])

const engineWithoutI18n = bare.run('new AutomationEngine()')
const engineWithI18n = translated.run('new AutomationEngine()')
const AutomationEngine = bare.run('AutomationEngine')

/** An action carrying every field any description reads. */
const fullAction = (type) => ({
    type,
    selector: '#submit',
    text: 'hello',
    url: 'https://example.com/',
    direction: 'up',
    duration: 1500,
    targetTabId: 7,
    ref: 'e12',
    key: 'Enter',
    x: 10, y: 20,
    startX: 1, startY: 2, endX: 3, endY: 4,
    width: 800, height: 600,
    level: 1.5,
})

test('click_ref describes the ref the model gave, not undefined', () => {
    assert.equal(bare.run('typeof I18n'), 'undefined', 'this context has no I18n')
    assert.equal(engineWithoutI18n.describeAction({ type: 'click_ref', ref: 'e12' }), 'Click element [ref=e12]')
    assert.equal(engineWithoutI18n.describeAction({ type: 'click_ref', ref_id: 'e7' }), 'Click element [ref=e7]')
    assert.equal(engineWithoutI18n.describeAction({ type: 'type_ref', ref: 3, text: 'hi' }), 'Type "hi" into [ref=3]')
    assert.equal(engineWithoutI18n.describeAction({ type: 'hover_ref', ref: 'e1' }), 'Hover element [ref=e1]')
})

test('click_ref is translated when I18n is present and still names the ref', () => {
    const line = engineWithI18n.describeAction({ type: 'click_ref', ref: 'e12' })
    assert.match(line, /e12/)
    assert.doesNotMatch(line, /undefined|\{ref\}/)
    const fromRefId = engineWithI18n.describeAction({ type: 'click_ref', ref_id: 'e7' })
    assert.match(fromRefId, /e7/)
})

test('an unknown type is described by its name', () => {
    assert.equal(engineWithoutI18n.describeAction({ type: 'mystery_action' }), 'mystery_action')
    assert.equal(engineWithI18n.describeAction({ type: 'mystery_action' }), 'mystery_action')
})

test('no action type produces "undefined" or an unfilled placeholder, in either mode', () => {
    for (const type of AutomationEngine.ACTION_TYPES) {
        for (const [mode, engine] of [['english', engineWithoutI18n], ['translated', engineWithI18n]]) {
            const line = engine.describeAction(fullAction(type))
            assert.equal(typeof line, 'string', `${type} (${mode})`)
            assert.ok(line.length > 0, `${type} (${mode}) is empty`)
            assert.doesNotMatch(line, /undefined/, `${type} (${mode}): ${line}`)
            assert.doesNotMatch(line, /\{[a-zA-Z]+\}/, `${type} (${mode}) left a placeholder: ${line}`)
        }
    }
})

test('long values are clipped so a selector cannot flood the card', () => {
    const line = engineWithoutI18n.describeAction({ type: 'click', selector: 'x'.repeat(500) })
    assert.ok(line.length < 120, line.length)
    assert.match(line, /…/)
    const url = engineWithoutI18n.describeAction({ type: 'navigate', url: 'https://example.com/' + 'a'.repeat(500) })
    assert.ok(url.length < 160)
})

test('the English descriptions for the common actions', () => {
    const d = (a) => engineWithoutI18n.describeAction(a)
    assert.equal(d({ type: 'click', selector: '#go' }), 'Click on "#go"')
    assert.equal(d({ type: 'type', selector: '#q', text: 'cats' }), 'Type "cats" into "#q"')
    assert.equal(d({ type: 'navigate', url: 'https://example.com/' }), 'Navigate to https://example.com/')
    assert.equal(d({ type: 'scroll' }), 'Scroll down', 'direction defaults to down')
    assert.equal(d({ type: 'wait' }), 'Wait 1000ms', 'duration defaults to 1000')
    assert.equal(d({ type: 'tabs_create' }), 'Open new tab')
    assert.equal(d({ type: 'tabs_create', url: 'https://e.com' }), 'Open new tab: https://e.com')
    assert.equal(d({ type: 'cdp_click', x: 1, y: 2 }), 'CDP click at (1, 2)')
    assert.equal(d({ type: 'cdp_drag', startX: 1, startY: 2, endX: 3, endY: 4 }), 'CDP drag (1,2) → (3,4)')
})

test('isKnownAction and ACTION_TYPES agree, and the list has no duplicates', () => {
    assert.equal(AutomationEngine.isKnownAction('click'), true)
    assert.equal(AutomationEngine.isKnownAction('click_ref'), true)
    assert.equal(AutomationEngine.isKnownAction('read_network'), true)
    assert.equal(AutomationEngine.isKnownAction('nope'), false)
    assert.equal(AutomationEngine.isKnownAction(''), false)
    assert.equal(AutomationEngine.isKnownAction(undefined), false)
    assert.equal(AutomationEngine.isKnownAction('CLICK'), false, 'types are case-sensitive')
    for (const type of AutomationEngine.ACTION_TYPES) assert.equal(AutomationEngine.isKnownAction(type), true)
    assert.equal(new Set(AutomationEngine.ACTION_TYPES).size, AutomationEngine.ACTION_TYPES.length)
    assert.ok(AutomationEngine.ACTION_TYPES.length >= 20)
})

test('stop() then reset() lets the engine run again', async () => {
    const engine = bare.run('new AutomationEngine()')
    engine.stop()
    await assert.rejects(engine.executeAction({ type: 'click' }), (e) => e.code === 'STOPPED')
    engine.reset()
    assert.equal(engine.aborted, false)
    assert.equal(engine.currentStep, 0)
    assert.deepEqual([...engine.actionHistory], [])
})
