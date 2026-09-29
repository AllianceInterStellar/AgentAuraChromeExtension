/**
 * WorkflowRecorder.recordAction: typing arrives one keystroke at a time and is folded into
 * one step per field; sensitive fields arrive already redacted and stay that way; nothing is
 * recorded when the recorder is off.
 *
 *   node --test test/workflow-recorder.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadScripts, plain } from './helpers/load.mjs'

const { run } = loadScripts(['js/agent/workflow-recorder.js'])

/** A recorder that is on, without going through start() and chrome.scripting. */
function recording() {
    const recorder = run('new WorkflowRecorder()')
    recorder.isRecording = true
    recorder.startTime = Date.now() - 1000
    recorder.tabId = 1
    return recorder
}

test('consecutive typing into one field collapses to the final value', () => {
    const recorder = recording()
    recorder.recordAction({ type: 'type', selector: '#q', value: 'h', tag: 'input' })
    recorder.recordAction({ type: 'type', selector: '#q', value: 'he', tag: 'input' })
    recorder.recordAction({ type: 'type', selector: '#q', value: 'hel', tag: 'input' })
    assert.equal(recorder.actions.length, 1)
    assert.equal(recorder.actions[0].value, 'hel')
    assert.equal(recorder.actions[0].selector, '#q')
    assert.equal(typeof recorder.actions[0].elapsed, 'number')
})

test('typing into a different field, or after a click, starts a new step', () => {
    const recorder = recording()
    recorder.recordAction({ type: 'type', selector: '#a', value: 'x' })
    recorder.recordAction({ type: 'type', selector: '#b', value: 'y' })
    recorder.recordAction({ type: 'click', selector: '#go', text: 'Go' })
    recorder.recordAction({ type: 'type', selector: '#a', value: 'xz' })
    assert.deepEqual(plain(recorder.actions).map(a => [a.type, a.selector, a.value]), [
        ['type', '#a', 'x'],
        ['type', '#b', 'y'],
        ['click', '#go', undefined],
        ['type', '#a', 'xz'],
    ])
})

test('form_input (a select) is not merged the way typing is', () => {
    const recorder = recording()
    recorder.recordAction({ type: 'form_input', selector: '#s', value: 'one' })
    recorder.recordAction({ type: 'form_input', selector: '#s', value: 'two' })
    assert.equal(recorder.actions.length, 2)
})

test('a redacted field stays redacted through the merge', () => {
    const recorder = recording()
    recorder.recordAction({ type: 'type', selector: '#pw', value: '<redacted>', redacted: true, inputType: 'password' })
    recorder.recordAction({ type: 'type', selector: '#pw', value: '<redacted>', redacted: true, inputType: 'password' })
    assert.equal(recorder.actions.length, 1)
    assert.equal(recorder.actions[0].redacted, true)
    assert.equal(recorder.actions[0].value, '<redacted>')
    assert.equal(recorder.actions[0].inputType, 'password')
    const prompt = recorder.toPrompt()
    assert.match(prompt, /<redacted>/)
    assert.doesNotMatch(prompt, /hunter2/)
})

test('nothing is recorded while the recorder is off, or for an empty action', () => {
    const recorder = run('new WorkflowRecorder()')
    assert.equal(recorder.isRecording, false)
    recorder.recordAction({ type: 'click', selector: '#x' })
    assert.equal(recorder.actions.length, 0)

    const on = recording()
    on.recordAction(null)
    on.recordAction(undefined)
    assert.equal(on.actions.length, 0)
    on.isRecording = false
    on.recordAction({ type: 'click', selector: '#x' })
    assert.equal(on.actions.length, 0)
})

test('onUpdate is told the step count and elapsed time after every action', () => {
    const recorder = recording()
    const updates = []
    recorder.onUpdate = (count, elapsed) => updates.push([count, elapsed >= 1000])
    recorder.recordAction({ type: 'click', selector: '#a' })
    recorder.recordAction({ type: 'type', selector: '#b', value: 'x' })
    recorder.recordAction({ type: 'type', selector: '#b', value: 'xy' })
    assert.deepEqual(updates, [[1, true], [2, true], [2, true]])
})

test('the recorded input is not mutated and each step is a copy', () => {
    const recorder = recording()
    const action = { type: 'click', selector: '#a' }
    recorder.recordAction(action)
    assert.deepEqual(action, { type: 'click', selector: '#a' })
    assert.notEqual(recorder.actions[0], action)
})

test('toPrompt numbers the steps and describes each kind', () => {
    const recorder = recording()
    assert.equal(recorder.toPrompt(), '', 'nothing recorded, nothing to replay')
    recorder.recordAction({ type: 'click', selector: '#go', text: 'Go', tag: 'button' })
    recorder.recordAction({ type: 'type', selector: '#q', value: 'cats' })
    recorder.recordAction({ type: 'form_input', selector: '#s', value: 'two' })
    recorder.recordAction({ type: 'scroll', direction: 'down' })
    recorder.recordAction({ type: 'navigate', url: 'https://example.com/' })
    recorder.recordAction({ type: 'hover', selector: '#h' })
    assert.equal(recorder.toPrompt(), [
        'Replay this workflow:',
        '1. Click on "#go" (Go)',
        '2. Type "cats" into "#q"',
        '3. Set "#s" to "two"',
        '4. Scroll down',
        '5. Navigate to https://example.com/',
        '6. hover',
    ].join('\n'))
})

test('getWorkflow carries the actions, duration and tab', () => {
    const recorder = recording()
    recorder.recordAction({ type: 'click', selector: '#a' })
    const workflow = recorder.getWorkflow()
    assert.match(workflow.id, /^workflow_\d+$/)
    assert.equal(workflow.actions.length, 1)
    assert.ok(workflow.duration >= 1000)
    assert.equal(workflow.tabId, 1)
    assert.equal(workflow.recordedAt, recorder.startTime)
    assert.match(recorder.getFormattedElapsed(), /^\d+:\d\d$/)
})
