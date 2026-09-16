class TabManager {
    constructor() {
        this.groupId = null
        this.managedTabs = new Map()
    }

    async createGroup(initialTabIds = [], title = 'AgentAura') {
        const result = await chrome.runtime.sendMessage({
            type: 'TAB_GROUP_CREATE',
            tabIds: initialTabIds,
            title
        })
        if (result.success) {
            this.groupId = result.groupId
            initialTabIds.forEach(id => this.managedTabs.set(id, true))
        }
        return result
    }

    async ensureGroup(tabId, title = 'AgentAura') {
        const result = await chrome.runtime.sendMessage({
            type: 'TAB_GROUP_ENSURE',
            tabId,
            title
        })

        if (result.success) {
            this.groupId = result.groupId
            this.managedTabs.clear()
                ; (result.tabIds || []).forEach(id => this.managedTabs.set(id, true))
        }

        return result
    }

    async addTab(tabId) {
        const result = await chrome.runtime.sendMessage({
            type: 'TAB_GROUP_ADD',
            tabId
        })
        if (result.success) {
            this.managedTabs.set(tabId, true)
        }
        return result
    }

    async listTabs(tabId = null) {
        const result = await chrome.runtime.sendMessage({ type: 'TAB_GROUP_LIST', tabId })
        if (result.success) {
            this.groupId = result.groupId
            this.managedTabs.clear()
                ; (result.tabs || []).forEach(tab => this.managedTabs.set(tab.id, true))
            return result.tabs
        }

        return []
    }

    async getActiveTab() {
        const tabs = await this.listTabs()
        return tabs.find(t => t.active) || tabs[0] || null
    }

    isManaged(tabId) {
        return this.managedTabs.has(tabId)
    }

    removeTab(tabId) {
        this.managedTabs.delete(tabId)
    }

    getTabCount() {
        return this.managedTabs.size
    }

    reset() {
        this.groupId = null
        this.managedTabs.clear()
    }
}
