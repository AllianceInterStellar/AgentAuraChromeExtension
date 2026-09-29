/**
 * Records what the user does on a page (clicks, typing, scrolling) so it can be replayed as a
 * prompt. The page-side listener posts WORKFLOW_RECORD_ACTION messages; the side panel's
 * runtime.onMessage handler feeds them to recordAction(). Passwords and card fields are never
 * recorded, because the recording ends up in a prompt sent to the model.
 */
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
                // A previous recording that was not stopped cleanly: drop its listeners first.
                if (window.__agentAuraRecorderAbort) {
                    try { window.__agentAuraRecorderAbort.abort() } catch (_) { }
                }
                const controller = new AbortController()
                window.__agentAuraRecorderAbort = controller
                const opts = { capture: true, signal: controller.signal }

                const SENSITIVE_TYPES = new Set(['password', 'hidden'])
                const isSensitive = (el) => {
                    if (!el) return false
                    if (SENSITIVE_TYPES.has((el.type || '').toLowerCase())) return true
                    const ac = (el.getAttribute('autocomplete') || '').toLowerCase()
                    if (ac.startsWith('cc-') || ac.includes('password') || ac === 'one-time-code') return true
                    return /passw|secret|token|cvv|card/i.test(el.name || el.id || '')
                }

                const sendAction = (action) => {
                    try {
                        const p = chrome.runtime.sendMessage({ type: 'WORKFLOW_RECORD_ACTION', action })
                        if (p && p.catch) p.catch(() => { })
                    } catch (_) { }
                }

                const cssId = (id) => (window.CSS && CSS.escape) ? CSS.escape(id) : id.replace(/([^\w-])/g, '\\$1')

                function getUniqueSelector(el) {
                    if (!(el instanceof Element)) return ''
                    if (el.id) return `#${cssId(el.id)}`

                    const path = []
                    let current = el
                    while (current && current !== document.body && current !== document.documentElement) {
                        let selector = current.tagName.toLowerCase()
                        if (current.id) {
                            path.unshift(`#${cssId(current.id)}`)
                            break
                        }
                        if (typeof current.className === 'string' && current.className.trim()) {
                            const classes = current.className.trim().split(/\s+/).slice(0, 2).map(cssId).join('.')
                            if (classes) selector += `.${classes}`
                        }
                        const parent = current.parentElement
                        if (parent) {
                            const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName)
                            if (siblings.length > 1) {
                                selector += `:nth-of-type(${siblings.indexOf(current) + 1})`
                            }
                        }
                        path.unshift(selector)
                        current = current.parentElement
                    }
                    return path.join(' > ')
                }

                document.addEventListener('click', (e) => {
                    const target = e.target
                    if (!(target instanceof Element)) return
                    sendAction({
                        type: 'click',
                        selector: getUniqueSelector(target),
                        text: target.textContent?.trim().substring(0, 50) || '',
                        tag: target.tagName.toLowerCase(),
                        timestamp: Date.now()
                    })
                }, opts)

                document.addEventListener('input', (e) => {
                    const target = e.target
                    if (!(target instanceof Element)) return
                    if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA' && target.tagName !== 'SELECT') return
                    sendAction({
                        type: target.tagName === 'SELECT' ? 'form_input' : 'type',
                        selector: getUniqueSelector(target),
                        value: isSensitive(target) ? '<redacted>' : String(target.value ?? '').substring(0, 500),
                        redacted: isSensitive(target),
                        tag: target.tagName.toLowerCase(),
                        inputType: target.type,
                        timestamp: Date.now()
                    })
                }, opts)

                let scrollTimer = null
                let lastScrollY = window.scrollY
                document.addEventListener('scroll', () => {
                    clearTimeout(scrollTimer)
                    scrollTimer = setTimeout(() => {
                        const direction = window.scrollY >= lastScrollY ? 'down' : 'up'
                        lastScrollY = window.scrollY
                        sendAction({
                            type: 'scroll',
                            direction,
                            scrollX: window.scrollX,
                            scrollY: window.scrollY,
                            timestamp: Date.now()
                        })
                    }, 500)
                }, opts)
            }
        })
    }

    recordAction(action) {
        if (!this.isRecording || !action) return
        // Typing arrives one keystroke at a time; keep only the final value per field.
        const last = this.actions[this.actions.length - 1]
        if (last && action.type === 'type' && last.type === 'type' && last.selector === action.selector) {
            Object.assign(last, action, { elapsed: Date.now() - this.startTime })
        } else {
            this.actions.push({ ...action, elapsed: Date.now() - this.startTime })
        }
        if (this.onUpdate) {
            this.onUpdate(this.actions.length, this.getElapsed())
        }
    }

    async stop() {
        this.isRecording = false
        if (this.tabId) {
            await chrome.scripting.executeScript({
                target: { tabId: this.tabId },
                func: () => {
                    if (window.__agentAuraRecorderAbort) {
                        try { window.__agentAuraRecorderAbort.abort() } catch (_) { }
                        window.__agentAuraRecorderAbort = null
                    }
                }
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
