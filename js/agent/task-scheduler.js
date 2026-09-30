/**
 * The side panel's view of the scheduled tasks. The list lives in chrome.storage.local; the
 * service worker owns the alarms and bumps lastRun/runCount when one fires, so this class
 * re-reads on every storage change instead of trusting its copy.
 */
class TaskScheduler {
    static STORAGE_KEY = 'agent_scheduled_tasks'
    static ALARM_PREFIX = 'scheduled_task_'
    static MIN_INTERVAL_MINUTES = 1

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

    static normalizeInterval(minutes) {
        const n = Math.floor(Number(minutes))
        if (!Number.isFinite(n) || n < TaskScheduler.MIN_INTERVAL_MINUTES) return null
        return n
    }

    /** A start URL has to be a page the agent may open: http(s), nothing else. */
    static normalizeUrl(url) {
        const s = String(url || '').trim()
        if (s === '') return null
        return /^https?:\/\/\S+$/i.test(s) ? s : undefined
    }

    /**
     * `options.url` is the page the task's window opens on (the model starts from a blank tab
     * otherwise). `options.allowUnattended` lets the run use the stored permission mode; without
     * it a scheduled run asks before every action, whatever the mode, because nobody may be
     * watching when the alarm fires.
     */
    async add(prompt, intervalMinutes, options = {}) {
        const interval = TaskScheduler.normalizeInterval(intervalMinutes)
        if (!interval) throw new Error('Interval must be a whole number of minutes, at least 1')
        const url = TaskScheduler.normalizeUrl(options.url)
        if (url === undefined) throw new Error('The start URL must begin with http:// or https://')
        const task = {
            id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name: options.name || prompt.substring(0, 40),
            prompt,
            url,
            allowUnattended: options.allowUnattended === true,
            intervalMinutes: interval,
            enabled: true,
            lastRun: null,
            runCount: 0,
            createdAt: Date.now()
        }
        await this._write(tasks => [...tasks, task])
        await this.scheduleAlarm(task)
        return task
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

    async scheduleAlarm(task) {
        if (!task.enabled) return
        const interval = TaskScheduler.normalizeInterval(task.intervalMinutes)
        if (!interval) return
        await chrome.alarms.create(TaskScheduler.ALARM_PREFIX + task.id, { periodInMinutes: interval })
    }

    getAll() {
        return this.tasks
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TaskScheduler }
}
