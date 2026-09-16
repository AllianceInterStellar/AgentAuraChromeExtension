class TaskScheduler {
    constructor() {
        this.tasks = []
    }

    async init() {
        const stored = await chrome.storage.local.get('agent_scheduled_tasks')
        this.tasks = stored.agent_scheduled_tasks || []
    }

    async save() {
        await chrome.storage.local.set({ agent_scheduled_tasks: this.tasks })
    }

    async add(prompt, intervalMinutes, name) {
        const task = {
            id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name: name || prompt.substring(0, 40),
            prompt,
            intervalMinutes,
            enabled: true,
            lastRun: null,
            runCount: 0,
            createdAt: Date.now()
        }
        this.tasks.push(task)
        await this.save()
        await this.scheduleAlarm(task)
        return task
    }

    async remove(id) {
        this.tasks = this.tasks.filter(t => t.id !== id)
        await this.save()
        await chrome.alarms.clear(`scheduled_task_${id}`)
    }

    async toggle(id) {
        const task = this.tasks.find(t => t.id === id)
        if (!task) return

        task.enabled = !task.enabled
        await this.save()

        if (task.enabled) {
            await this.scheduleAlarm(task)
        } else {
            await chrome.alarms.clear(`scheduled_task_${task.id}`)
        }
    }

    async scheduleAlarm(task) {
        if (!task.enabled) return
        await chrome.alarms.create(`scheduled_task_${task.id}`, {
            periodInMinutes: task.intervalMinutes
        })
    }

    async scheduleAll() {
        for (const task of this.tasks) {
            if (task.enabled) {
                await this.scheduleAlarm(task)
            }
        }
    }

    async markRun(id) {
        const task = this.tasks.find(t => t.id === id)
        if (task) {
            task.lastRun = Date.now()
            task.runCount++
            await this.save()
        }
    }

    getAll() {
        return this.tasks
    }

    getEnabled() {
        return this.tasks.filter(t => t.enabled)
    }
}
