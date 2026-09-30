class AutomationEngine {
    constructor() {
        this.isRunning = false
        this.currentStep = 0
        this.totalSteps = 0
        this.actionHistory = []
        this.activeTabId = null
        this.aborted = false
    }

    /** Every action type the side panel knows how to render and the worker knows how to run. */
    static ACTION_TYPES = [
        'click', 'type', 'navigate', 'scroll', 'form_input', 'wait', 'screenshot', 'read_page', 'find',
        'tabs_create', 'select_tab', 'list_tabs', 'new_tab', 'execute_js', 'get_page_text',
        'resize_window', 'zoom', 'click_ref', 'type_ref', 'hover_ref', 'read_page_content',
        'cdp_click', 'cdp_type', 'cdp_key', 'cdp_drag', 'read_console', 'read_network'
    ]

    static isKnownAction(type) {
        return AutomationEngine.ACTION_TYPES.includes(type)
    }

    async executeAction(action) {
        if (this.aborted) {
            throw Object.assign(new Error('Agent was stopped'), { code: 'STOPPED' })
        }

        this.currentStep++
        const entry = { step: this.currentStep, action, status: 'running', timestamp: Date.now() }
        this.actionHistory.push(entry)

        try {
            const result = await chrome.runtime.sendMessage({
                type: 'AGENT_EXECUTE_ACTION',
                action,
                tabId: this.activeTabId
            })
            entry.status = result && result.success ? 'completed' : 'failed'
            entry.result = result
            return result
        } catch (err) {
            entry.status = 'failed'
            entry.error = err.message
            throw err
        }
    }

    stop() {
        this.aborted = true
        this.isRunning = false
    }

    /** Called at the start of every run. Without it, one Stop poisoned every later action. */
    reset() {
        this.isRunning = false
        this.currentStep = 0
        this.totalSteps = 0
        this.actionHistory = []
        this.aborted = false
    }

    /**
     * One line describing an action, for the approval card, the banner, the system messages
     * and the on-page indicator. Translated when I18n is loaded, English otherwise (the
     * content script has no I18n). Values the model produced are clipped so a long selector
     * cannot flood the UI.
     */
    describeAction(action, limits = {}) {
        const clip = (v, n = 80) => {
            const s = String(v ?? '')
            return s.length > n ? s.slice(0, n) + '…' : s
        }
        const p = {
            selector: clip(action.selector),
            // The approval card asks for more of the text than a banner has room for.
            text: clip(action.text, limits.text ?? 30),
            url: clip(action.url, 120),
            filename: clip(action.filename, 80),
            direction: action.direction || 'down',
            duration: action.duration || 1000,
            tabId: action.targetTabId,
            ref: action.ref ?? action.ref_id ?? '',
            key: clip(action.key, 20),
            x: action.x, y: action.y,
            startX: action.startX, startY: action.startY, endX: action.endX, endY: action.endY,
            width: action.width, height: action.height, level: action.level
        }
        const key = `action.desc.${action.type}`
        if (typeof I18n !== 'undefined' && I18n.t(key) !== key) {
            return I18n.t(key, p)
        }
        switch (action.type) {
            case 'click': return `Click on "${p.selector}"`
            case 'type': return `Type "${p.text}" into "${p.selector}"`
            case 'navigate': return `Navigate to ${p.url}`
            case 'scroll': return `Scroll ${p.direction}`
            case 'form_input': return `Fill "${p.selector}" with value`
            case 'wait': return `Wait ${p.duration}ms`
            case 'screenshot': return 'Capture screenshot'
            case 'read_page': return 'Read page content'
            case 'find': return `Find elements: "${p.selector}"`
            case 'tabs_create': return `Open new tab${p.url ? ': ' + p.url : ''}`
            case 'select_tab': return `Switch to tab ${p.tabId}`
            case 'list_tabs': return 'List all tabs'
            case 'new_tab': return `Open ${p.url} in new tab`
            case 'execute_js': return 'Execute JavaScript code'
            case 'get_page_text': return 'Get page text'
            case 'resize_window': return `Resize to ${p.width}x${p.height}`
            case 'zoom': return `Set zoom to ${p.level}x`
            case 'click_ref': return `Click element [ref=${p.ref}]`
            case 'type_ref': return `Type "${p.text}" into [ref=${p.ref}]`
            case 'hover_ref': return `Hover element [ref=${p.ref}]`
            case 'read_page_content': return "Read the page's accessibility content"
            case 'cdp_click': return `CDP click at (${p.x}, ${p.y})`
            case 'cdp_type': return `CDP type "${p.text}"`
            case 'cdp_key': return `CDP key ${p.key}`
            case 'cdp_drag': return `CDP drag (${p.startX},${p.startY}) → (${p.endX},${p.endY})`
            case 'read_console': return 'Read console messages'
            case 'read_network': return 'Read network requests'
            case 'download': return `Download ${p.filename || p.url}`
            default: return String(action.type)
        }
    }
}
