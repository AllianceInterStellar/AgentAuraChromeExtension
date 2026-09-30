/**
 * PermissionManager: what asks and what runs, per mode, with "approve all", a run's mode
 * override and the actions that ask in every mode.
 *
 *   node --test test/permission-manager.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadScripts, plain } from './helpers/load.mjs'

const { run, context } = loadScripts(['js/agent/permission-manager.js'])
const PermissionManager = run('PermissionManager')

/** A manager whose approval prompts are answered by `answer(action)` instead of a human. */
function manager(mode, answer) {
    const pm = new PermissionManager()
    pm.mode = mode
    pm._approvalTimeout = 50
    pm.onApprovalNeeded = (action) => {
        const decision = answer ? answer(action) : null
        if (decision === 'approve') pm.approve()
        else if (decision === 'approveAll') pm.approveAll()
        else if (decision === 'deny') pm.deny()
        // null: nobody answers, the timeout does
    }
    return pm
}

test('act mode approves an ordinary action without asking', async () => {
    let asked = 0
    const pm = manager('act', () => { asked++; return 'deny' })
    const result = await pm.checkPermission({ type: 'click_ref', ref: 1 })
    assert.equal(result.approved, true)
    assert.equal(asked, 0)
})

test('ask mode asks, and a denial is a denial', async () => {
    const pm = manager('ask', () => 'deny')
    const result = await pm.checkPermission({ type: 'click_ref', ref: 1 })
    assert.equal(result.approved, false)
})

test('an unanswered prompt times out as a denial, not an approval', async () => {
    const pm = manager('ask', () => null)
    const result = await pm.checkPermission({ type: 'click', selector: '#x' })
    assert.equal(result.approved, false)
    assert.equal(result.timedOut, true)
})

test('execute_js asks in every mode, "approve all" included', async () => {
    for (const mode of ['ask', 'act', 'plan']) {
        let asked = 0
        const pm = manager(mode, () => { asked++; return 'approve' })
        pm.approveAllForRun = true
        const result = await pm.checkPermission({ type: 'execute_js', code: 'document.cookie' })
        assert.equal(result.approved, true, mode)
        assert.equal(asked, 1, `${mode}: execute_js did not ask`)
    }
})

test('an action marked sensitive asks in act mode too', async () => {
    let asked = 0
    const pm = manager('act', () => { asked++; return 'deny' })
    const result = await pm.checkPermission({ type: 'type_ref', ref: 3, text: 'hunter2', sensitive: true })
    assert.equal(asked, 1)
    assert.equal(result.approved, false)
})

test('requestSensitiveApproval carries the field label to the prompt', async () => {
    let seen = null
    const pm = manager('act', (action) => { seen = action; return 'approve' })
    const result = await pm.requestSensitiveApproval({ type: 'type', selector: '#pw', text: 'x' }, { code: 'SENSITIVE_FIELD', field: 'Password' })
    assert.equal(result.approved, true)
    assert.equal(seen.sensitive, true)
    assert.equal(seen.fieldLabel, 'Password')
    assert.equal(seen.type, 'type')
})

test('"approve all" covers the rest of the run and leaves the stored mode alone', async () => {
    const storedBefore = plain(await context.chrome.storage.local.get('agent_permission_mode'))
    let asked = 0
    const pm = manager('ask', () => { asked++; return 'approveAll' })
    const first = await pm.checkPermission({ type: 'click', selector: '#a' })
    const second = await pm.checkPermission({ type: 'click', selector: '#b' })
    assert.equal(first.approved, true)
    assert.equal(second.approved, true)
    assert.equal(asked, 1, 'the second action did not ask')
    assert.equal(pm.mode, 'ask', 'the mode is not changed')
    assert.deepEqual(plain(await context.chrome.storage.local.get('agent_permission_mode')), storedBefore, 'nothing was written to storage')

    // A new run starts clean.
    pm.beginRun()
    const third = await pm.checkPermission({ type: 'click', selector: '#c' })
    assert.equal(asked, 2)
    assert.equal(third.approved, true)
})

test('setMode still persists an explicit choice', async () => {
    const pm = manager('ask')
    await pm.setMode('act')
    assert.deepEqual(plain(await context.chrome.storage.local.get('agent_permission_mode')), { agent_permission_mode: 'act' })
    await pm.setMode('nonsense')
    assert.equal(pm.mode, 'act', 'an unknown mode is ignored')
})

test('a run with modeOverride "ask" asks even when the stored mode is act', async () => {
    let asked = 0
    const pm = manager('act', () => { asked++; return 'approve' })
    pm.beginRun({ modeOverride: 'ask' })
    assert.equal(pm.effectiveMode(), 'ask')
    await pm.checkPermission({ type: 'click', selector: '#a' })
    assert.equal(asked, 1)

    pm.endRun()
    assert.equal(pm.effectiveMode(), 'act')
    await pm.checkPermission({ type: 'click', selector: '#a' })
    assert.equal(asked, 1, 'after the run the stored mode applies again')
})

test('an unknown override is ignored', () => {
    const pm = manager('act')
    pm.beginRun({ modeOverride: 'yolo' })
    assert.equal(pm.effectiveMode(), 'act')
})

test('plan mode: approved steps run, a step the model adds later asks', async () => {
    const plan = [{ type: 'click', selector: '#a' }, { type: 'scroll', direction: 'down' }]
    const pm = manager('plan')
    pm._planApprovalTimeout = 50
    pm.onPlanApproval = () => pm.approvePlanExecution()
    const approval = await pm.requestPlanApproval(plan)
    assert.equal(approval.approved, true)

    let asked = 0
    pm.onApprovalNeeded = () => { asked++; pm.deny() }
    assert.equal((await pm.checkPermission(plan[0])).approved, true)
    assert.equal((await pm.checkPermission(plan[1])).approved, true)
    assert.equal(asked, 0)
    assert.equal((await pm.checkPermission({ type: 'click', selector: '#new' })).approved, false)
    assert.equal(asked, 1)
})

test('cancelPending answers the open prompt "no" and forgets approve-all', async () => {
    const pm = manager('ask', () => null)
    pm.approveAllForRun = true
    const pending = pm.checkPermission({ type: 'execute_js', code: '1' })
    pm.cancelPending()
    const result = await pending
    assert.equal(result.approved, false)
    assert.equal(result.cancelled, true)
    assert.equal(pm.approveAllForRun, false)
})

test('a second prompt supersedes the first instead of leaving it hanging', async () => {
    const pm = manager('ask', () => null)
    const first = pm.checkPermission({ type: 'click', selector: '#a' })
    const second = pm.checkPermission({ type: 'click', selector: '#b' })
    pm.approve()
    assert.equal((await first).superseded, true)
    assert.equal((await second).approved, true)
})
