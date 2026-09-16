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
        click_ref: { label: '点击元素', icon: '👆', description: '通过引用ID点击元素' },
        type_ref: { label: '输入文本', icon: '⌨️', description: '通过引用ID输入文本' },
        hover_ref: { label: '悬停元素', icon: '🖱️', description: '通过引用ID悬停元素' },
        read_page_content: { label: '读取页面', icon: '📖', description: '读取页面可访问性内容' },
        cdp_click: { label: 'CDP点击', icon: '🎯', description: '通过坐标点击' },
        cdp_type: { label: 'CDP输入', icon: '📝', description: '通过CDP输入文本' },
        cdp_key: { label: 'CDP按键', icon: '⌨️', description: '通过CDP发送按键' },
        cdp_drag: { label: 'CDP拖拽', icon: '↔️', description: '通过CDP拖拽操作' },
        read_console: { label: '读取控制台', icon: '🖥️', description: '读取浏览器控制台消息' },
        read_network: { label: '读取网络', icon: '🌐', description: '读取网络请求记录' }
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
            case 'click_ref': return `点击元素 [ref=${action.ref_id}]`
            case 'type_ref': return `在元素 [ref=${action.ref_id}] 输入 "${(action.text || '').substring(0, 30)}"`
            case 'hover_ref': return `悬停元素 [ref=${action.ref_id}]`
            case 'read_page_content': return '读取页面可访问性内容'
            case 'cdp_click': return `CDP点击坐标 (${action.x}, ${action.y})`
            case 'cdp_type': return `CDP输入文本 "${(action.text || '').substring(0, 30)}"`
            case 'cdp_key': return `CDP按键 ${action.key}`
            case 'cdp_drag': return `CDP拖拽 (${action.startX},${action.startY}) → (${action.endX},${action.endY})`
            case 'read_console': return '读取控制台消息'
            case 'read_network': return '读取网络请求'
            default: return action.type
        }
    }
}
