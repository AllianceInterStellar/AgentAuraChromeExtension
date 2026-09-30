/**
 * TaskScheduler: the schedule arithmetic (pure), and add/update/recordRun as the worker and
 * the panel read them from storage.
 *
 *   node --test test/task-scheduler.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadScripts, plain } from './helpers/load.mjs'

function scheduler(initialTasks = []) {
    const alarms = []
    const cleared = []
    const { run, context } = loadScripts(['js/agent/task-scheduler.js'], {
        chrome: {
            alarms: { create: async (name, info) => { alarms.push({ name, ...info }) }, clear: async (name) => { cleared.push(name); return true } },
        }
    })
    const TaskScheduler = run('TaskScheduler')
    return { TaskScheduler, scheduler: new TaskScheduler(), alarms, cleared, storage: context.chrome.storage.local }
}

const { TaskScheduler: TS } = scheduler()

// A fixed "now": Wednesday 2026-09-30 10:30 local time.
const NOW = new Date(2026, 8, 30, 10, 30).getTime()
const local = (y, m, d, h, min) => new Date(y, m, d, h, min).getTime()

test('normalizeSchedule: a number is an interval, objects are checked field by field', () => {
    assert.deepEqual(plain(TS.normalizeSchedule(60)), { kind: 'interval', minutes: 60 })
    assert.deepEqual(plain(TS.normalizeSchedule('45')), { kind: 'interval', minutes: 45 })
    assert.equal(TS.normalizeSchedule(5), null, 'below the minimum for a new task')
    assert.equal(TS.normalizeSchedule(0), null)
    assert.equal(TS.normalizeSchedule('soon'), null)
    assert.deepEqual(plain(TS.normalizeSchedule({ kind: 'interval', minutes: '90' })), { kind: 'interval', minutes: 90 })
    assert.deepEqual(plain(TS.normalizeSchedule({ kind: 'daily', time: '9:05' })), { kind: 'daily', time: '09:05' })
    assert.deepEqual(plain(TS.normalizeSchedule({ kind: 'weekly', weekday: '1', time: '18:00' })), { kind: 'weekly', weekday: 1, time: '18:00' })
    assert.deepEqual(plain(TS.normalizeSchedule({ kind: 'monthly', day: 31, time: '00:00' })), { kind: 'monthly', day: 31, time: '00:00' })
    assert.equal(TS.normalizeSchedule({ kind: 'daily', time: '25:00' }), null)
    assert.equal(TS.normalizeSchedule({ kind: 'daily', time: '' }), null)
    assert.equal(TS.normalizeSchedule({ kind: 'weekly', weekday: 7, time: '10:00' }), null)
    assert.equal(TS.normalizeSchedule({ kind: 'monthly', day: 0, time: '10:00' }), null)
    assert.equal(TS.normalizeSchedule({ kind: 'yearly', time: '10:00' }), null)
    assert.equal(TS.normalizeSchedule(null), null)
})

test('scheduleOf reads the old intervalMinutes shape', () => {
    assert.deepEqual(plain(TS.scheduleOf({ intervalMinutes: 5 })), { kind: 'interval', minutes: 5 }, 'an old task under the new minimum keeps working')
    assert.deepEqual(plain(TS.scheduleOf({ schedule: { kind: 'daily', time: '09:00' }, intervalMinutes: null })), { kind: 'daily', time: '09:00' })
    assert.equal(TS.scheduleOf({}), null)
})

test('nextRunAt: daily is today if still ahead, else tomorrow', () => {
    assert.equal(TS.nextRunAt({ schedule: { kind: 'daily', time: '10:31' } }, NOW), local(2026, 8, 30, 10, 31))
    assert.equal(TS.nextRunAt({ schedule: { kind: 'daily', time: '10:30' } }, NOW), local(2026, 9, 1, 10, 30), 'exactly now counts as passed')
    assert.equal(TS.nextRunAt({ schedule: { kind: 'daily', time: '08:00' } }, NOW), local(2026, 9, 1, 8, 0))
})

test('nextRunAt: weekly lands on the requested weekday', () => {
    // 2026-09-30 is a Wednesday (3).
    assert.equal(TS.nextRunAt({ schedule: { kind: 'weekly', weekday: 3, time: '12:00' } }, NOW), local(2026, 8, 30, 12, 0), 'later today')
    assert.equal(TS.nextRunAt({ schedule: { kind: 'weekly', weekday: 3, time: '09:00' } }, NOW), local(2026, 9, 7, 9, 0), 'next week')
    assert.equal(TS.nextRunAt({ schedule: { kind: 'weekly', weekday: 5, time: '09:00' } }, NOW), local(2026, 9, 2, 9, 0), 'Friday')
    assert.equal(TS.nextRunAt({ schedule: { kind: 'weekly', weekday: 0, time: '09:00' } }, NOW), local(2026, 9, 4, 9, 0), 'Sunday')
})

test('nextRunAt: monthly clamps to the last day of a short month', () => {
    assert.equal(TS.nextRunAt({ schedule: { kind: 'monthly', day: 30, time: '11:00' } }, NOW), local(2026, 8, 30, 11, 0), 'later today')
    assert.equal(TS.nextRunAt({ schedule: { kind: 'monthly', day: 1, time: '09:00' } }, NOW), local(2026, 9, 1, 9, 0))
    assert.equal(TS.nextRunAt({ schedule: { kind: 'monthly', day: 31, time: '09:00' } }, NOW), local(2026, 8, 30, 9, 0) > NOW ? local(2026, 8, 30, 9, 0) : local(2026, 9, 31, 9, 0), 'September has 30 days')
    const feb = new Date(2027, 1, 10, 12, 0).getTime()
    assert.equal(TS.nextRunAt({ schedule: { kind: 'monthly', day: 31, time: '09:00' } }, feb), local(2027, 1, 28, 9, 0))
    assert.equal(TS.nextRunAt({ schedule: { kind: 'interval', minutes: 30 } }, NOW), null, 'interval tasks are periodic')
})

test('alarmInfo: periodic for intervals, a one-shot `when` otherwise', () => {
    assert.deepEqual(plain(TS.alarmInfo({ intervalMinutes: 30 })), { periodInMinutes: 30 })
    assert.deepEqual(plain(TS.alarmInfo({ schedule: { kind: 'daily', time: '10:31' } }, NOW)), { when: local(2026, 8, 30, 10, 31) })
    assert.equal(TS.alarmInfo({}), null)
})

test('describeSchedule without I18n falls back to English', () => {
    assert.equal(TS.describeSchedule({ intervalMinutes: 30 }), 'Every 30 min')
    assert.equal(TS.describeSchedule({ schedule: { kind: 'daily', time: '09:00' } }), 'Daily at 09:00')
    assert.equal(TS.describeSchedule({ schedule: { kind: 'weekly', weekday: 1, time: '09:00' } }), 'Every Monday at 09:00')
    assert.equal(TS.describeSchedule({ schedule: { kind: 'monthly', day: 15, time: '09:00' } }), 'Day 15 of each month at 09:00')
    assert.equal(TS.describeSchedule({}), 'Not scheduled')
})

test('a task carries its prompt, schedule, start URL, limits and flags', async () => {
    const { scheduler: s, alarms, storage } = scheduler()
    await s.init()
    const task = await s.add('check the inbox', 30, { url: ' https://mail.example.com/ ', allowUnattended: true, maxSteps: '25', notify: false })
    assert.deepEqual(plain(task.schedule), { kind: 'interval', minutes: 30 })
    assert.equal(task.intervalMinutes, 30, 'the old field is kept for older readers')
    assert.equal(task.url, 'https://mail.example.com/')
    assert.equal(task.allowUnattended, true)
    assert.equal(task.maxSteps, 25)
    assert.equal(task.maxMinutes, null)
    assert.equal(task.notify, false)
    assert.equal(task.enabled, true)
    assert.equal(task.name, 'check the inbox')
    assert.deepEqual(plain(task.runs), [])
    assert.deepEqual(plain((await storage.get('agent_scheduled_tasks')).agent_scheduled_tasks).map(t => t.id), [task.id])
    assert.deepEqual(alarms, [{ name: `scheduled_task_${task.id}`, periodInMinutes: 30 }])
})

test('a daily task gets a one-shot alarm and no intervalMinutes', async () => {
    const { scheduler: s, alarms } = scheduler()
    await s.init()
    const task = await s.add('report', { kind: 'daily', time: '07:30' })
    assert.equal(task.intervalMinutes, null)
    assert.equal(task.notify, true, 'notifications default on')
    assert.equal(alarms.length, 1)
    assert.ok(alarms[0].when > Date.now(), 'the first firing is in the future')
    assert.equal(alarms[0].periodInMinutes, undefined)
})

test('without options a task has no URL, no limits and is not unattended', async () => {
    const { scheduler: s } = scheduler()
    await s.init()
    const task = await s.add('x', 60)
    assert.equal(task.url, null)
    assert.equal(task.allowUnattended, false)
    assert.equal(task.maxSteps, null)
    const named = await s.add('y', 60, { name: 'Y', url: '' })
    assert.equal(named.name, 'Y')
    assert.equal(named.url, null)
})

test('a start URL that is not http(s) is refused', async () => {
    const { scheduler: s, TaskScheduler } = scheduler()
    await s.init()
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'chrome://settings', 'ftp://x', 'example.com']) {
        await assert.rejects(() => s.add('x', 30, { url }), /http:\/\/ or https:\/\//, url)
        assert.equal(TaskScheduler.normalizeUrl(url), undefined, url)
    }
    assert.equal(TaskScheduler.normalizeUrl('HTTPS://Example.com/a?b=c'), 'HTTPS://Example.com/a?b=c')
    assert.equal(TaskScheduler.normalizeUrl(''), null)
    assert.equal(TaskScheduler.normalizeUrl(undefined), null)
})

test('a bad schedule is refused, and the interval minimum is 15 for new tasks', async () => {
    const { scheduler: s, TaskScheduler } = scheduler()
    await s.init()
    await assert.rejects(() => s.add('x', 0), /not valid/)
    await assert.rejects(() => s.add('x', 14), /not valid/)
    await assert.rejects(() => s.add('x', 'soon'), /not valid/)
    await assert.rejects(() => s.add('x', { kind: 'daily', time: 'noon' }), /not valid/)
    assert.equal(TaskScheduler.normalizeInterval('15.9'), 15)
    assert.equal(TaskScheduler.normalizeInterval(14), null)
    assert.equal(TaskScheduler.normalizeInterval(5, 1), 5, 'a lower minimum can be asked for')
})

test('update edits in place and reschedules', async () => {
    const { scheduler: s, alarms, cleared } = scheduler()
    await s.init()
    const task = await s.add('old prompt', 30)
    const updated = await s.update(task.id, { prompt: 'new prompt', schedule: { kind: 'weekly', weekday: 5, time: '18:00' }, maxSteps: 10, allowUnattended: true })
    assert.equal(updated.id, task.id)
    assert.equal(updated.prompt, 'new prompt')
    assert.equal(updated.name, 'new prompt')
    assert.deepEqual(plain(updated.schedule), { kind: 'weekly', weekday: 5, time: '18:00' })
    assert.equal(updated.intervalMinutes, null)
    assert.equal(updated.maxSteps, 10)
    assert.equal(updated.allowUnattended, true)
    assert.equal(updated.url, null, 'untouched fields keep their value')
    assert.deepEqual(cleared, [`scheduled_task_${task.id}`])
    assert.equal(alarms.length, 2)
    assert.ok(alarms[1].when > Date.now())
    assert.equal(plain(s.getAll())[0].prompt, 'new prompt')
    assert.equal(await s.update('nope', { prompt: 'x' }), null)
})

test('recordRun keeps the last ten runs, newest first', async () => {
    const { scheduler: s } = scheduler()
    await s.init()
    const task = await s.add('x', 30)
    for (let i = 1; i <= 12; i++) {
        await s.recordRun(task.id, { startedAt: i, finishedAt: i + 1, status: 'complete', steps: i, summary: `run ${i}` })
    }
    const runs = plain(s.get(task.id).runs)
    assert.equal(runs.length, 10)
    assert.equal(runs[0].summary, 'run 12')
    assert.equal(runs[9].summary, 'run 3')
})

test('at most twenty tasks', async () => {
    const { scheduler: s, TaskScheduler } = scheduler()
    await s.init()
    for (let i = 0; i < TaskScheduler.MAX_TASKS; i++) await s.add(`t${i}`, 30)
    await assert.rejects(() => s.add('one more', 30), /At most 20/)
    assert.equal(s.getAll().length, 20)
})
