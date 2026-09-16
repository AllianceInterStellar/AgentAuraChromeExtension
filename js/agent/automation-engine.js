class AutomationEngine {
    constructor() {
        this.isRunning = false
        this.currentStep = 0
        this.totalSteps = 0
        this.actionHistory = []
        this.activeTabId = null
        this.onStatusChange = null
        this.onActionComplete = null
        this.onApprovalNeeded = null
        this.onError = null
        this.aborted = false
    }

    static ACTIONS = {
        click: { label: 'Click', icon: '👆', description: 'Click on an element' },
        type: { label: 'Type', icon: '⌨️', description: 'Type text into a field' },
        navigate: { label: 'Navigate', icon: '🔗', description: 'Navigate to a URL' },
        scroll: { label: 'Scroll', icon: '📜', description: 'Scroll the page' },
        form_input: { label: 'Form Input', icon: '📝', description: 'Fill a form field' },
        wait: { label: 'Wait', icon: '⏳', description: 'Wait for a duration' },
        screenshot: { label: 'Screenshot', icon: '📸', description: 'Capture screenshot' },
        read_page: { label: 'Read Page', icon: '📖', description: 'Read page content' },
        find: { label: 'Find', icon: '🔍', description: 'Find elements on page' },
        tabs_create: { label: 'New Tab', icon: '➕', description: 'Open a new tab' },
        select_tab: { label: 'Switch Tab', icon: '🔄', description: 'Switch to another tab' },
        list_tabs: { label: 'List Tabs', icon: '📋', description: 'List open tabs' },
        new_tab: { label: 'Open URL', icon: '🌐', description: 'Open URL in new tab' },
        execute_js: { label: 'Run JS', icon: '⚡', description: 'Execute JavaScript' },
        get_page_text: { label: 'Get Text', icon: '📄', description: 'Get page text content' },
        resize_window: { label: 'Resize', icon: '📐', description: 'Resize browser window' },
        zoom: { label: 'Zoom', icon: '🔎', description: 'Change zoom level' },
        click_ref: { label: 'Click element', icon: '👆', description: 'Click an element by its reference id' },
        type_ref: { label: 'Type text', icon: '⌨️', description: 'Type into an element by its reference id' },
        hover_ref: { label: 'Hover element', icon: '🖱️', description: 'Hover an element by its reference id' },
        read_page_content: { label: 'Read page', icon: '📖', description: "Read the page's accessibility content" },
        cdp_click: { label: 'CDP click', icon: '🎯', description: 'Click at coordinates' },
        cdp_type: { label: 'CDP type', icon: '📝', description: 'Type text through CDP' },
        cdp_key: { label: 'CDP key', icon: '⌨️', description: 'Send a keypress through CDP' },
        cdp_drag: { label: 'CDP drag', icon: '↔️', description: 'Drag through CDP' },
        read_console: { label: 'Read console', icon: '🖥️', description: 'Read browser console messages' },
        read_network: { label: 'Read network', icon: '🌐', description: 'Read recorded network requests' }
    }

    async executeAction(action) {
        if (this.aborted) throw new Error('Agent was stopped')

        this.currentStep++
        const actionInfo = AutomationEngine.ACTIONS[action.type] || { label: action.type, icon: '❓' }

        this.actionHistory.push({
            step: this.currentStep,
            action,
            status: 'running',
            timestamp: Date.now()
        })

        if (this.onStatusChange) {
            this.onStatusChange({
                step: this.currentStep,
                total: this.totalSteps,
                action: actionInfo.label,
                status: 'running'
            })
        }

        try {
            const result = await chrome.runtime.sendMessage({
                type: 'AGENT_EXECUTE_ACTION',
                action,
                tabId: this.activeTabId
            })

            const historyEntry = this.actionHistory[this.actionHistory.length - 1]
            historyEntry.status = result.success ? 'completed' : 'failed'
            historyEntry.result = result

            if (this.onActionComplete) {
                this.onActionComplete({
                    step: this.currentStep,
                    action: actionInfo,
                    result,
                    status: historyEntry.status
                })
            }

            return result
        } catch (err) {
            const historyEntry = this.actionHistory[this.actionHistory.length - 1]
            historyEntry.status = 'failed'
            historyEntry.error = err.message

            if (this.onError) {
                this.onError({ step: this.currentStep, error: err.message })
            }

            throw err
        }
    }

    async executePlan(steps) {
        this.isRunning = true
        this.currentStep = 0
        this.totalSteps = steps.length
        this.actionHistory = []
        this.aborted = false
        const results = []

        for (const step of steps) {
            if (this.aborted) break

            try {
                const result = await this.executeAction(step)
                results.push(result)

                if (step.type !== 'wait' && step.type !== 'screenshot') {
                    await new Promise(r => setTimeout(r, 300))
                }
            } catch (err) {
                results.push({ success: false, error: err.message })
                break
            }
        }

        this.isRunning = false

        if (this.onStatusChange) {
            this.onStatusChange({
                step: this.currentStep,
                total: this.totalSteps,
                status: this.aborted ? 'stopped' : 'complete'
            })
        }

        return results
    }

    async takeScreenshot() {
        return await chrome.runtime.sendMessage({
            type: 'AGENT_TAKE_SCREENSHOT',
            tabId: this.activeTabId
        })
    }

    async getPageText() {
        return await chrome.runtime.sendMessage({
            type: 'AGENT_GET_PAGE_TEXT',
            tabId: this.activeTabId
        })
    }

    async executeJS(code) {
        return await chrome.runtime.sendMessage({
            type: 'AGENT_EXECUTE_JS',
            tabId: this.activeTabId,
            code
        })
    }

    stop() {
        this.aborted = true
        this.isRunning = false
    }

    reset() {
        this.isRunning = false
        this.currentStep = 0
        this.totalSteps = 0
        this.actionHistory = []
        this.aborted = false
    }

    getTimeline() {
        return this.actionHistory.map(entry => ({
            step: entry.step,
            type: entry.action.type,
            label: (AutomationEngine.ACTIONS[entry.action.type] || {}).label || entry.action.type,
            icon: (AutomationEngine.ACTIONS[entry.action.type] || {}).icon || '❓',
            status: entry.status,
            timestamp: entry.timestamp,
            description: this.describeAction(entry.action)
        }))
    }

    describeAction(action) {
        switch (action.type) {
            case 'click': return `Click on "${action.selector}"`
            case 'type': return `Type "${(action.text || '').substring(0, 30)}..." into "${action.selector}"`
            case 'navigate': return `Navigate to ${action.url}`
            case 'scroll': return `Scroll ${action.direction || 'down'}`
            case 'form_input': return `Fill "${action.selector}" with value`
            case 'wait': return `Wait ${action.duration || 1000}ms`
            case 'screenshot': return 'Capture screenshot'
            case 'read_page': return 'Read page content'
            case 'find': return `Find elements: "${action.selector}"`
            case 'tabs_create': return `Open new tab${action.url ? ': ' + action.url : ''}`
            case 'select_tab': return `Switch to tab ${action.targetTabId}`
            case 'list_tabs': return 'List all tabs'
            case 'new_tab': return `Open ${action.url} in new tab`
            case 'execute_js': return 'Execute JavaScript code'
            case 'get_page_text': return 'Get page text'
            case 'resize_window': return `Resize to ${action.width}x${action.height}`
            case 'zoom': return `Set zoom to ${action.level}x`
            case 'click_ref': return `Click element [ref=${action.ref_id}]`
            case 'type_ref': return `Type "${(action.text || '').substring(0, 30)}" into [ref=${action.ref_id}]`
            case 'hover_ref': return `Hover element [ref=${action.ref_id}]`
            case 'read_page_content': return "Read the page's accessibility content"
            case 'cdp_click': return `CDP click at (${action.x}, ${action.y})`
            case 'cdp_type': return `CDP type "${(action.text || '').substring(0, 30)}"`
            case 'cdp_key': return `CDP key ${action.key}`
            case 'cdp_drag': return `CDP drag (${action.startX},${action.startY}) → (${action.endX},${action.endY})`
            case 'read_console': return 'Read console messages'
            case 'read_network': return 'Read network requests'
            default: return action.type
        }
    }
}
