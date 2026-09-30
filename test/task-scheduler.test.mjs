/**
 * TaskScheduler.add: interval, start URL and the unattended flag, stored as the worker and
 * the panel read them.
 *
 *   node --test test/task-scheduler.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadScripts, plain } from './helpers/load.mjs'

function scheduler() {
    const alarms = []
    const { run, context } = loadScripts(['js/agent/task-scheduler.js'], {
        chrome: { alarms: { create: async (name, info) => { alarms.push({ name, ...info }) }, clear: async () => true } }
    })
    const TaskScheduler = run('TaskScheduler')
    return { TaskScheduler, scheduler: new TaskScheduler(), alarms, storage: context.chrome.storage.local.data }
}

test('a task carries its prompt, interval, start URL and unattended flag', async () => {
    const { scheduler: s, alarms, storage } = scheduler()
    await s.init()
    const task = await s.add('check the inbox', 30, { url: ' https://mail.example.com/ ', allowUnattended: true })
    assert.equal(task.intervalMinutes, 30)
    assert.equal(task.url, 'https://mail.example.com/')
    assert.equal(task.allowUnattended, true)
    assert.equal(task.enabled, true)
    assert.equal(task.name, 'check the inbox')
    assert.deepEqual(plain(storage.agent_scheduled_tasks).map(t => t.id), [task.id])
    assert.deepEqual(alarms, [{ name: `scheduled_task_${task.id}`, periodInMinutes: 30 }])
})

test('without options a task has no URL and is not unattended', async () => {
    const { scheduler: s } = scheduler()
    await s.init()
    const task = await s.add('x', 60)
    assert.equal(task.url, null)
    assert.equal(task.allowUnattended, false)
    const named = await s.add('y', 60, { name: 'Y', url: '' })
    assert.equal(named.name, 'Y')
    assert.equal(named.url, null)
})

test('a start URL that is not http(s) is refused', async () => {
    const { scheduler: s, TaskScheduler } = scheduler()
    await s.init()
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'chrome://settings', 'ftp://x', 'example.com']) {
        await assert.rejects(() => s.add('x', 5, { url }), /http:\/\/ or https:\/\//, url)
        assert.equal(TaskScheduler.normalizeUrl(url), undefined, url)
    }
    assert.equal(TaskScheduler.normalizeUrl('HTTPS://Example.com/a?b=c'), 'HTTPS://Example.com/a?b=c')
    assert.equal(TaskScheduler.normalizeUrl(''), null)
    assert.equal(TaskScheduler.normalizeUrl(undefined), null)
})

test('the interval has to be a whole number of minutes, at least one', async () => {
    const { scheduler: s, TaskScheduler } = scheduler()
    await s.init()
    await assert.rejects(() => s.add('x', 0), /at least 1/)
    await assert.rejects(() => s.add('x', 'soon'), /at least 1/)
    assert.equal(TaskScheduler.normalizeInterval('15.9'), 15)
    assert.equal(TaskScheduler.normalizeInterval(0.5), null)
})
