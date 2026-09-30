/**
 * The sensitive-field test the content script applies before it types into an element or
 * reports its value: passwords, one-time codes, card fields, secrets by name. The same test
 * is written out inside the worker's injected functions, so those are checked by source.
 *
 *   node --test test/sensitive-field.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadScripts, read } from './helpers/load.mjs'

const { exports } = loadScripts(['js/content-scripts/accessibility-tree.js'])
const { isSensitiveField, fieldLabel } = exports['js/content-scripts/accessibility-tree.js']

/** The bits of an <input> the test looks at. */
const input = ({ type = 'text', autocomplete = null, name = '', id = '', placeholder = '', aria = null, label = null } = {}) => ({
    type, name, id, placeholder,
    getAttribute: (k) => (k === 'autocomplete' ? autocomplete : k === 'aria-label' ? aria : null),
    labels: label ? [{ textContent: label }] : [],
})

test('password inputs and one-time codes are sensitive', () => {
    assert.equal(isSensitiveField(input({ type: 'password' })), true)
    assert.equal(isSensitiveField(input({ type: 'PASSWORD' })), true)
    assert.equal(isSensitiveField(input({ autocomplete: 'one-time-code' })), true)
    assert.equal(isSensitiveField(input({ autocomplete: 'current-password' })), true)
    assert.equal(isSensitiveField(input({ autocomplete: 'new-password' })), true)
})

test('card fields by autocomplete and by name', () => {
    assert.equal(isSensitiveField(input({ autocomplete: 'cc-number' })), true)
    assert.equal(isSensitiveField(input({ autocomplete: 'cc-csc' })), true)
    assert.equal(isSensitiveField(input({ name: 'cardNumber' })), true)
    assert.equal(isSensitiveField(input({ id: 'cvv' })), true)
    assert.equal(isSensitiveField(input({ name: 'api_secret' })), true)
    assert.equal(isSensitiveField(input({ name: 'csrf_token' })), true)
})

test('ordinary fields are not', () => {
    assert.equal(isSensitiveField(input()), false)
    assert.equal(isSensitiveField(input({ type: 'email', name: 'email', autocomplete: 'email' })), false)
    assert.equal(isSensitiveField(input({ type: 'search', name: 'q' })), false)
    assert.equal(isSensitiveField(input({ name: 'username', autocomplete: 'username' })), false)
    assert.equal(isSensitiveField(null), false)
    assert.equal(isSensitiveField({}), false)
})

test('fieldLabel prefers the <label>, then aria-label, placeholder, name, id, type', () => {
    assert.equal(fieldLabel(input({ type: 'password', label: '  Your password ' })), 'Your password')
    assert.equal(fieldLabel(input({ type: 'password', aria: 'PIN' })), 'PIN')
    assert.equal(fieldLabel(input({ type: 'password', placeholder: 'Enter code' })), 'Enter code')
    assert.equal(fieldLabel(input({ type: 'password', name: 'pw' })), 'pw')
    assert.equal(fieldLabel(input({ type: 'password', id: 'pw-id' })), 'pw-id')
    assert.equal(fieldLabel(input({ type: 'password' })), 'password')
    assert.equal(fieldLabel(input({ type: 'password', label: 'x'.repeat(200) })).length, 80)
})

test('the worker spells out the same test in every injected function that types', () => {
    const worker = read('js/background.js')
    const typingFunctions = worker.match(/type === 'password' \|\| \/\^cc-\|password\|one-time-code\/\.test\(autocomplete\) \|\| \/passw\|secret\|token\|cvv\|card\/\.test\(nameId\)/g) || []
    // type, form_input and the focused-element check before cdp_type.
    assert.equal(typingFunctions.length, 3, 'type, form_input and cdp_type each carry the test')
    const contentScript = read('js/content-scripts/accessibility-tree.js')
    assert.match(contentScript, /\/\^cc-\|password\|one-time-code\//)
    assert.match(contentScript, /\/passw\|secret\|token\|cvv\|card\//)
    const recorder = read('js/agent/workflow-recorder.js')
    assert.match(recorder, /one-time-code/)
})

test('a sensitive field is typed into only with confirmation', () => {
    const worker = read('js/background.js')
    for (const marker of ['action.confirmedSensitive === true]', "confirmed: action.confirmedSensitive === true"]) {
        assert.ok(worker.includes(marker), `worker passes the confirmation through: ${marker}`)
    }
    assert.match(worker, /SENSITIVE_FIELD: 'SENSITIVE_FIELD'/)
    const contentScript = read('js/content-scripts/accessibility-tree.js')
    assert.match(contentScript, /isSensitiveField\(el\) && message\.confirmed !== true/)
})
