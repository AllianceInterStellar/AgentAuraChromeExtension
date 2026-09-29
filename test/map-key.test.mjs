/**
 * mapKey(key): the {key, code, keyCode} triple the worker sends over CDP for a key name the
 * model produced. CDP needs all three, and a wrong keyCode is a keypress that some pages
 * ignore, so the mapping is checked value by value.
 *
 *   node --test test/map-key.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadScripts } from './helpers/load.mjs'

const { run } = loadScripts(['js/background.js'])
const mapKey = run('mapKey')
// Results are objects from the vm realm; spread them so deepEqual compares values.
const map = (key) => ({ ...mapKey(key) })

const cases = [
    ['Enter', { key: 'Enter', code: 'Enter', keyCode: 13 }],
    ['Tab', { key: 'Tab', code: 'Tab', keyCode: 9 }],
    ['Escape', { key: 'Escape', code: 'Escape', keyCode: 27 }],
    ['Backspace', { key: 'Backspace', code: 'Backspace', keyCode: 8 }],
    ['ArrowDown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 }],
    ['Space', { key: ' ', code: 'Space', keyCode: 32 }],
    [' ', { key: ' ', code: 'Space', keyCode: 32 }],
    ['Control', { key: 'Control', code: 'ControlLeft', keyCode: 17 }],
    ['Meta', { key: 'Meta', code: 'MetaLeft', keyCode: 91 }],
    // letters: the code and keyCode are the upper-case letter's, the key keeps its case
    ['a', { key: 'a', code: 'KeyA', keyCode: 65 }],
    ['A', { key: 'A', code: 'KeyA', keyCode: 65 }],
    ['z', { key: 'z', code: 'KeyZ', keyCode: 90 }],
    // digits
    ['1', { key: '1', code: 'Digit1', keyCode: 49 }],
    ['0', { key: '0', code: 'Digit0', keyCode: 48 }],
    // other single characters: no code, keyCode from the character
    ['-', { key: '-', code: '', keyCode: 45 }],
    ['.', { key: '.', code: '', keyCode: 46 }],
    // function keys: F1 is 112
    ['F1', { key: 'F1', code: 'F1', keyCode: 112 }],
    ['F5', { key: 'F5', code: 'F5', keyCode: 116 }],
    ['F12', { key: 'F12', code: 'F12', keyCode: 123 }],
    ['F24', { key: 'F24', code: 'F24', keyCode: 135 }],
    // unknown names are passed through so CDP can still try them
    ['MediaPlayPause', { key: 'MediaPlayPause', code: 'MediaPlayPause', keyCode: 0 }],
    ['F25', { key: 'F25', code: 'F25', keyCode: 0 }],
    // nothing to press
    ['', { key: '', code: '', keyCode: 0 }],
    [null, { key: '', code: '', keyCode: 0 }],
    [undefined, { key: '', code: '', keyCode: 0 }],
    [42, { key: '', code: '', keyCode: 0 }],
    [{}, { key: '', code: '', keyCode: 0 }],
]

for (const [key, expected] of cases) {
    test(`mapKey(${JSON.stringify(key)})`, () => {
        assert.deepEqual(map(key), expected)
    })
}

test('every letter and digit gets a code and a keyCode', () => {
    for (let c = 65; c <= 90; c++) {
        const upper = String.fromCharCode(c)
        assert.deepEqual(map(upper), { key: upper, code: `Key${upper}`, keyCode: c })
        assert.deepEqual(map(upper.toLowerCase()), { key: upper.toLowerCase(), code: `Key${upper}`, keyCode: c })
    }
    for (let d = 0; d <= 9; d++) {
        assert.deepEqual(map(String(d)), { key: String(d), code: `Digit${d}`, keyCode: 48 + d })
    }
})

test('named keys are returned by reference from the table, not rebuilt', () => {
    assert.equal(mapKey('Enter'), mapKey('Enter'))
})
