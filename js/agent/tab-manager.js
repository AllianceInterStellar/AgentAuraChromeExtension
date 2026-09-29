/**
 * The side panel's view of the agent's tab group. The service worker owns the group; this only
 * asks it and remembers the answer for the tab-count chip.
 */
class TabManager {
    constructor() {
        this.groupId = null
        this.managedTabs = new Map()
    }

    async ensureGroup(tabId, title = 'AgentAura') {
        const result = await chrome.runtime.sendMessage({
            type: 'TAB_GROUP_ENSURE',
            tabId,
            title
        })

        if (result && result.success) {
            this.groupId = result.groupId
            this.managedTabs.clear()
                ; (result.tabIds || []).forEach(id => this.managedTabs.set(id, true))
        }

        return result
    }

    async listTabs(tabId = null) {
        const result = await chrome.runtime.sendMessage({ type: 'TAB_GROUP_LIST', tabId })
        if (result && result.success) {
            this.groupId = result.groupId
            this.managedTabs.clear()
                ; (result.tabs || []).forEach(tab => this.managedTabs.set(tab.id, true))
            return result.tabs
        }

        return []
    }

    getTabCount() {
        return this.managedTabs.size
    }
}
