class WorkflowRecorder {
    constructor() {
        this.isRecording = false
        this.actions = []
        this.startTime = null
        this.tabId = null
        this.onUpdate = null
    }

    async start(tabId) {
        this.isRecording = true
        this.actions = []
        this.startTime = Date.now()
        this.tabId = tabId

        await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
                if (window.__agentAuraRecorder) return

                window.__agentAuraRecorder = true

                const sendAction = (action) => {
                    chrome.runtime.sendMessage({
                        type: 'WORKFLOW_RECORD_ACTION',
                        action
                    })
                }

                document.addEventListener('click', (e) => {
                    const target = e.target
                    const selector = getUniqueSelector(target)
                    sendAction({
                        type: 'click',
                        selector,
                        text: target.textContent?.trim().substring(0, 50) || '',
                        tag: target.tagName.toLowerCase(),
                        timestamp: Date.now()
                    })
                }, true)

                document.addEventListener('input', (e) => {
                    const target = e.target
                    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
                        const selector = getUniqueSelector(target)
                        sendAction({
                            type: target.tagName === 'SELECT' ? 'form_input' : 'type',
                            selector,
                            value: target.value,
                            tag: target.tagName.toLowerCase(),
                            inputType: target.type,
                            timestamp: Date.now()
                        })
                    }
                }, true)

                document.addEventListener('scroll', (() => {
                    let timeout
                    return () => {
                        clearTimeout(timeout)
                        timeout = setTimeout(() => {
                            sendAction({
                                type: 'scroll',
                                direction: 'down',
                                scrollX: window.scrollX,
                                scrollY: window.scrollY,
                                timestamp: Date.now()
                            })
                        }, 500)
                    }
                })(), true)

                function getUniqueSelector(el) {
                    if (el.id) return `#${el.id}`

                    const path = []
                    let current = el
                    while (current && current !== document.body) {
                        let selector = current.tagName.toLowerCase()
                        if (current.id) {
                            path.unshift(`#${current.id}`)
                            break
                        }
                        if (current.className && typeof current.className === 'string') {
                            const classes = current.className.trim().split(/\s+/).slice(0, 2).join('.')
                            if (classes) selector += `.${classes}`
                        }
                        const parent = current.parentElement
                        if (parent) {
                            const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName)
                            if (siblings.length > 1) {
                                const index = siblings.indexOf(current) + 1
                                selector += `:nth-of-type(${index})`
                            }
                        }
                        path.unshift(selector)
                        current = current.parentElement
                    }
                    return path.join(' > ')
                }
            }
        })
    }

    recordAction(action) {
        if (!this.isRecording) return
        this.actions.push({
            ...action,
            elapsed: Date.now() - this.startTime
        })
        if (this.onUpdate) {
            this.onUpdate(this.actions.length, this.getElapsed())
        }
    }

    stop() {
        this.isRecording = false
        if (this.tabId) {
            chrome.scripting.executeScript({
                target: { tabId: this.tabId },
                func: () => { window.__agentAuraRecorder = false }
            }).catch(() => { })
        }
        return this.getWorkflow()
    }

    getWorkflow() {
        return {
            id: `workflow_${Date.now()}`,
            actions: this.actions,
            duration: this.getElapsed(),
            recordedAt: this.startTime,
            tabId: this.tabId
        }
    }

    getElapsed() {
        if (!this.startTime) return 0
        return Date.now() - this.startTime
    }

    getFormattedElapsed() {
        const ms = this.getElapsed()
        const secs = Math.floor(ms / 1000)
        const mins = Math.floor(secs / 60)
        return `${mins}:${String(secs % 60).padStart(2, '0')}`
    }

    toPrompt() {
        if (this.actions.length === 0) return ''

        const steps = this.actions.map((a, i) => {
            switch (a.type) {
                case 'click': return `${i + 1}. Click on "${a.selector}" (${a.text || a.tag})`
                case 'type': return `${i + 1}. Type "${(a.value || '').substring(0, 50)}" into "${a.selector}"`
                case 'form_input': return `${i + 1}. Set "${a.selector}" to "${(a.value || '').substring(0, 50)}"`
                case 'scroll': return `${i + 1}. Scroll ${a.direction}`
                case 'navigate': return `${i + 1}. Navigate to ${a.url}`
                default: return `${i + 1}. ${a.type}`
            }
        })

        return `Replay this workflow:\n${steps.join('\n')}`
    }
}
