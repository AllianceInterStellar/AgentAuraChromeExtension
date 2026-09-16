class ShortcutsManager {
    constructor() {
        this.shortcuts = []
    }

    async init() {
        const stored = await chrome.storage.local.get('agent_shortcuts')
        this.shortcuts = stored.agent_shortcuts || []
    }

    async save() {
        await chrome.storage.local.set({ agent_shortcuts: this.shortcuts })
    }

    async add(text, name) {
        const shortcut = {
            id: `shortcut_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name: name || text.substring(0, 40),
            text,
            uses: 0,
            createdAt: Date.now()
        }
        this.shortcuts.unshift(shortcut)
        await this.save()
        return shortcut
    }

    async remove(id) {
        this.shortcuts = this.shortcuts.filter(s => s.id !== id)
        await this.save()
    }

    async incrementUse(id) {
        const shortcut = this.shortcuts.find(s => s.id === id)
        if (shortcut) {
            shortcut.uses++
            await this.save()
        }
    }

    search(query) {
        if (!query) return this.shortcuts
        const lower = query.toLowerCase()
        return this.shortcuts.filter(s =>
            s.name.toLowerCase().includes(lower) ||
            s.text.toLowerCase().includes(lower)
        )
    }

    getAll() {
        return this.shortcuts
    }

    getMostUsed(limit = 5) {
        return [...this.shortcuts]
            .sort((a, b) => b.uses - a.uses)
            .slice(0, limit)
    }
}
