/**
 * Scheduled tasks: the list, the alarms, and what one run of a task leaves behind.
 *
 * The list lives in chrome.storage.local. The side panel creates, edits and runs tasks; the
 * service worker owns the alarms and fires them, so this file is loaded by both (the worker
 * through importScripts) and the schedule arithmetic is static and pure.
 *
 * A task fires on one of four cadences: every N minutes (a periodic alarm), or daily, weekly
 * or monthly at a local time (a one-shot alarm the worker re-creates after each firing).
 * Tasks made before cadences existed carry only `intervalMinutes`; they keep working.
 */
class TaskScheduler {
    static STORAGE_KEY = 'agent_scheduled_tasks'
    static ALARM_PREFIX = 'scheduled_task_'
    /** For NEW interval tasks. A task saved earlier with a shorter interval is left alone. */
    static MIN_INTERVAL_MINUTES = 15
    static MAX_TASKS = 20
    /** How many past runs a task remembers. */
    static MAX_RUNS = 10
    static KINDS = ['interval', 'daily', 'weekly', 'monthly']

    constructor() {
        this.tasks = []
        this.onChange = null
        try {
            chrome.storage.onChanged.addListener((changes, area) => {
                if (area === 'local' && changes[TaskScheduler.STORAGE_KEY]) {
                    this.tasks = changes[TaskScheduler.STORAGE_KEY].newValue || []
                    if (this.onChange) this.onChange(this.tasks)
                }
            })
        } catch (_) { }
    }

    async init() {
        const stored = await chrome.storage.local.get(TaskScheduler.STORAGE_KEY)
        this.tasks = stored[TaskScheduler.STORAGE_KEY] || []
    }

    async _write(mutate) {
        // Read-modify-write against storage, not against the in-memory copy, so a runCount the
        // worker just bumped is not overwritten with a stale value.
        const stored = await chrome.storage.local.get(TaskScheduler.STORAGE_KEY)
        const tasks = stored[TaskScheduler.STORAGE_KEY] || []
        const next = mutate(tasks) || tasks
        await chrome.storage.local.set({ [TaskScheduler.STORAGE_KEY]: next })
        this.tasks = next
        return next
    }

    // ---- schedule arithmetic (pure) ---------------------------------------------------------

    static normalizeInterval(minutes, minimum = TaskScheduler.MIN_INTERVAL_MINUTES) {
        const n = Math.floor(Number(minutes))
        if (!Number.isFinite(n) || n < minimum) return null
        return n
    }

    /** 'HH:MM' in 24-hour local time, or null. */
    static normalizeTime(time) {
        const m = /^(\d{1,2}):(\d{2})$/.exec(String(time || '').trim())
        if (!m) return null
        const h = Number(m[1]), min = Number(m[2])
        if (h > 23 || min > 59) return null
        return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
    }

    /**
     * A schedule from form input. A plain number is an interval in minutes (the old shape).
     * Returns `{ kind: 'interval', minutes }`, `{ kind: 'daily', time }`, `{ kind: 'weekly',
     * weekday, time }` (0 = Sunday), `{ kind: 'monthly', day, time }` (1–31, clamped to the
     * month's length when it fires), or null when the input does not make a schedule.
     */
    static normalizeSchedule(input) {
        if (typeof input === 'number' || typeof input === 'string') {
            const minutes = TaskScheduler.normalizeInterval(input)
            return minutes ? { kind: 'interval', minutes } : null
        }
        if (!input || typeof input !== 'object') return null
        const kind = String(input.kind || 'interval')
        if (kind === 'interval') {
            const minutes = TaskScheduler.normalizeInterval(input.minutes ?? input.intervalMinutes)
            return minutes ? { kind, minutes } : null
        }
        const time = TaskScheduler.normalizeTime(input.time)
        if (!time) return null
        if (kind === 'daily') return { kind, time }
        if (kind === 'weekly') {
            const weekday = Number(input.weekday)
            if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return null
            return { kind, weekday, time }
        }
        if (kind === 'monthly') {
            const day = Number(input.day)
            if (!Number.isInteger(day) || day < 1 || day > 31) return null
            return { kind, day, time }
        }
        return null
    }

    /** The schedule of a stored task, old shape included. */
    static scheduleOf(task) {
        if (task && task.schedule && TaskScheduler.KINDS.includes(task.schedule.kind)) return task.schedule
        const minutes = Math.floor(Number(task && task.intervalMinutes))
        return minutes >= 1 ? { kind: 'interval', minutes } : null
    }

    /**
     * When a daily/weekly/monthly task fires next, as a timestamp, strictly after `now`. Local
     * time, because that is what the user typed. null for interval tasks (they are periodic).
     */
    static nextRunAt(task, now = Date.now()) {
        const schedule = TaskScheduler.scheduleOf(task)
        if (!schedule || schedule.kind === 'interval') return null
        const [h, m] = schedule.time.split(':').map(Number)
        const at = (date) => { const d = new Date(date); d.setHours(h, m, 0, 0); return d.getTime() }
        const base = new Date(now)

        if (schedule.kind === 'daily') {
            let t = at(base)
            if (t <= now) { base.setDate(base.getDate() + 1); t = at(base) }
            return t
        }
        if (schedule.kind === 'weekly') {
            const d = new Date(now)
            d.setDate(d.getDate() + ((schedule.weekday - d.getDay() + 7) % 7))
            let t = at(d)
            if (t <= now) { d.setDate(d.getDate() + 7); t = at(d) }
            return t
        }
        // monthly: the requested day, or the month's last day when it is shorter.
        const candidate = (year, month) => {
            const lastDay = new Date(year, month + 1, 0).getDate()
            const d = new Date(year, month, Math.min(schedule.day, lastDay))
            return at(d)
        }
        let t = candidate(base.getFullYear(), base.getMonth())
        if (t <= now) t = candidate(base.getFullYear(), base.getMonth() + 1)
        return t
    }

    /** What chrome.alarms.create() needs for the task, or null when it must not be scheduled. */
    static alarmInfo(task, now = Date.now()) {
        const schedule = TaskScheduler.scheduleOf(task)
        if (!schedule) return null
        if (schedule.kind === 'interval') return { periodInMinutes: schedule.minutes }
        const when = TaskScheduler.nextRunAt(task, now)
        return when ? { when } : null
    }

    /** One line saying when the task runs, translated when I18n is loaded. */
    static describeSchedule(task, lang = 'en') {
        const schedule = TaskScheduler.scheduleOf(task)
        const t = (key, params, fallback) => {
            if (typeof I18n !== 'undefined' && I18n.t(key, params) !== key) return I18n.t(key, params)
            return fallback
        }
        if (!schedule) return t('schedule.never', {}, 'Not scheduled')
        if (schedule.kind === 'interval') return t('sys.everyNMin', { n: schedule.minutes }, `Every ${schedule.minutes} min`)
        if (schedule.kind === 'daily') return t('schedule.dailyAt', { time: schedule.time }, `Daily at ${schedule.time}`)
        if (schedule.kind === 'weekly') {
            const weekday = TaskScheduler.weekdayName(schedule.weekday, lang)
            return t('schedule.weeklyAt', { weekday, time: schedule.time }, `Every ${weekday} at ${schedule.time}`)
        }
        return t('schedule.monthlyAt', { day: schedule.day, time: schedule.time }, `Day ${schedule.day} of each month at ${schedule.time}`)
    }

    static weekdayName(weekday, lang = 'en') {
        try {
            // 2023-01-01 was a Sunday.
            return new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : lang, { weekday: 'long' }).format(new Date(2023, 0, 1 + Number(weekday)))
        } catch (_) {
            return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][weekday] || String(weekday)
        }
    }

    /** A start URL has to be a page the agent may open: http(s), nothing else. */
    static normalizeUrl(url) {
        const s = String(url || '').trim()
        if (s === '') return null
        return /^https?:\/\/\S+$/i.test(s) ? s : undefined
    }

    static normalizeLimit(value, min, max) {
        if (value === undefined || value === null || value === '') return null
        const n = Math.floor(Number(value))
        if (!Number.isFinite(n)) return null
        return Math.min(max, Math.max(min, n))
    }

    // ---- the list -------------------------------------------------------------------------

    /**
     * `schedule` is a number of minutes or a schedule object (normalizeSchedule). Options:
     * `name`, `url` (the page the task's window opens on), `allowUnattended` (use the stored
     * permission mode instead of asking before every action), `maxSteps`, `maxMinutes`
     * (this task's own limits), `notify` (a notification when a run finishes, default on).
     */
    async add(prompt, schedule, options = {}) {
        const normalized = TaskScheduler.normalizeSchedule(schedule)
        if (!normalized) throw new Error(`The schedule is not valid: an interval of at least ${TaskScheduler.MIN_INTERVAL_MINUTES} minutes, or a time of day`)
        const fields = TaskScheduler._fields(options)
        if (this.tasks.length >= TaskScheduler.MAX_TASKS) throw new Error(`At most ${TaskScheduler.MAX_TASKS} scheduled tasks`)
        const task = {
            id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name: options.name || String(prompt).substring(0, 40),
            prompt: String(prompt),
            schedule: normalized,
            // Kept for the worker's older readers and the options page.
            intervalMinutes: normalized.kind === 'interval' ? normalized.minutes : null,
            ...fields,
            enabled: true,
            lastRun: null,
            runCount: 0,
            runs: [],
            createdAt: Date.now()
        }
        await this._write(tasks => {
            if (tasks.length >= TaskScheduler.MAX_TASKS) throw new Error(`At most ${TaskScheduler.MAX_TASKS} scheduled tasks`)
            return [...tasks, task]
        })
        await this.scheduleAlarm(task)
        return task
    }

    /** The option fields, validated. Throws on a bad URL. */
    static _fields(options) {
        const url = TaskScheduler.normalizeUrl(options.url)
        if (url === undefined) throw new Error('The start URL must begin with http:// or https://')
        return {
            url,
            allowUnattended: options.allowUnattended === true,
            maxSteps: TaskScheduler.normalizeLimit(options.maxSteps, 1, 500),
            maxMinutes: TaskScheduler.normalizeLimit(options.maxMinutes, 1, 120),
            notify: options.notify !== false
        }
    }

    /** Edit a task in place. `patch` may carry prompt, name, schedule and any of the option fields. */
    async update(id, patch = {}) {
        let updated = null
        await this._write(tasks => tasks.map(t => {
            if (t.id !== id) return t
            const next = { ...t }
            if (patch.prompt !== undefined) {
                next.prompt = String(patch.prompt)
                next.name = patch.name || String(patch.prompt).substring(0, 40)
            } else if (patch.name !== undefined) {
                next.name = String(patch.name)
            }
            if (patch.schedule !== undefined) {
                const normalized = TaskScheduler.normalizeSchedule(patch.schedule)
                if (!normalized) throw new Error('The schedule is not valid')
                next.schedule = normalized
                next.intervalMinutes = normalized.kind === 'interval' ? normalized.minutes : null
            }
            const optionKeys = ['url', 'allowUnattended', 'maxSteps', 'maxMinutes', 'notify']
            if (optionKeys.some(k => patch[k] !== undefined)) {
                const merged = {}
                for (const k of optionKeys) merged[k] = patch[k] !== undefined ? patch[k] : t[k]
                Object.assign(next, TaskScheduler._fields(merged))
            }
            updated = next
            return next
        }))
        if (!updated) return null
        await chrome.alarms.clear(TaskScheduler.ALARM_PREFIX + id)
        await this.scheduleAlarm(updated)
        return updated
    }

    async remove(id) {
        await this._write(tasks => tasks.filter(t => t.id !== id))
        await chrome.alarms.clear(TaskScheduler.ALARM_PREFIX + id)
    }

    async toggle(id) {
        let toggled = null
        await this._write(tasks => tasks.map(t => {
            if (t.id !== id) return t
            toggled = { ...t, enabled: !t.enabled }
            return toggled
        }))
        if (!toggled) return
        if (toggled.enabled) {
            await this.scheduleAlarm(toggled)
        } else {
            await chrome.alarms.clear(TaskScheduler.ALARM_PREFIX + id)
        }
    }

    /**
     * What one run left behind: `{ startedAt, finishedAt, status, steps, summary }`. The last
     * MAX_RUNS are kept, newest first, so the user can see what the task did while they were
     * away.
     */
    async recordRun(id, run) {
        await this._write(tasks => tasks.map(t => {
            if (t.id !== id) return t
            const runs = [{ ...run }, ...(Array.isArray(t.runs) ? t.runs : [])].slice(0, TaskScheduler.MAX_RUNS)
            return { ...t, runs }
        }))
    }

    async scheduleAlarm(task) {
        if (!task.enabled) return
        const info = TaskScheduler.alarmInfo(task)
        if (!info) return
        await chrome.alarms.create(TaskScheduler.ALARM_PREFIX + task.id, info)
    }

    getAll() {
        return this.tasks
    }

    get(id) {
        return this.tasks.find(t => t.id === id) || null
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TaskScheduler }
}
