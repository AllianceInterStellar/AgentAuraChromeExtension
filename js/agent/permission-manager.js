class PermissionManager {
    constructor() {
        this.mode = 'ask'
        this.pendingApproval = null
        this.onApprovalNeeded = null
        this.onPlanApproval = null
        /** Called whenever a pending approval is settled, however it was settled, so the UI can close. */
        this.onResolved = null
        this.approvalResolver = null
        this._approvalTimeout = 60000
        this._planApprovalTimeout = 120000
        this._approvedPlan = null
    }

    static MODES = ['ask', 'act', 'plan']

    async init() {
        const stored = await chrome.storage.local.get('agent_permission_mode')
        this.mode = PermissionManager.MODES.includes(stored.agent_permission_mode) ? stored.agent_permission_mode : 'ask'
    }

    async setMode(mode) {
        if (!PermissionManager.MODES.includes(mode)) return
        this.mode = mode
        await chrome.storage.local.set({ agent_permission_mode: mode })
    }

    /**
     * In `plan` mode only the steps of the plan the user approved may run. Anything the model
     * adds afterwards goes through the ordinary per-action approval.
     */
    async checkPermission(action) {
        if (this.mode === 'act') {
            return { approved: true, approveAll: false }
        }
        if (this.mode === 'plan') {
            if (this._approvedPlan && this._approvedPlan.includes(action)) {
                return { approved: true, approveAll: false }
            }
            return await this.requestApproval(action)
        }
        return await this.requestApproval(action)
    }

    _settle(result) {
        const resolve = this.approvalResolver
        this.approvalResolver = null
        this.pendingApproval = null
        if (resolve) resolve(result)
        if (this.onResolved) this.onResolved(result)
    }

    _open(pending, notifyHook, timeoutMs, timeoutResult) {
        // A second request while one is open would have overwritten the resolver and left the
        // first caller waiting forever.
        if (this.approvalResolver) this._settle({ approved: false, superseded: true })

        return new Promise((resolve) => {
            this.pendingApproval = pending
            this.approvalResolver = resolve
            if (notifyHook) notifyHook()

            setTimeout(() => {
                if (this.approvalResolver === resolve) this._settle(timeoutResult)
            }, timeoutMs)
        })
    }

    async requestApproval(action) {
        return this._open(
            action,
            () => { if (this.onApprovalNeeded) this.onApprovalNeeded(action) },
            this._approvalTimeout,
            { approved: false, approveAll: false, timedOut: true }
        )
    }

    async requestPlanApproval(actions) {
        const steps = actions.map(a => ({
            type: a.type,
            description: this._describeActionBrief(a)
        }))
        const result = await this._open(
            { type: 'plan', steps, actions },
            () => { if (this.onPlanApproval) this.onPlanApproval({ steps, actions }) },
            this._planApprovalTimeout,
            { approved: false, timedOut: true }
        )
        this._approvedPlan = result.approved ? actions : null
        return result
    }

    _describeActionBrief(action) {
        const key = `action.desc.${action.type}`
        if (typeof I18n !== 'undefined' && I18n.t(key) !== key) {
            const clip = (v, n) => { const s = String(v ?? ''); return s.length > n ? s.slice(0, n) + '…' : s }
            return I18n.t(key, {
                selector: clip(action.selector, 80), text: clip(action.text, 30), url: clip(action.url, 120),
                direction: action.direction || 'down', duration: action.duration || 1000,
                tabId: action.targetTabId, ref: action.ref ?? '', key: clip(action.key, 20),
                x: action.x, y: action.y, startX: action.startX, startY: action.startY,
                endX: action.endX, endY: action.endY, width: action.width, height: action.height, level: action.level
            })
        }
        switch (action.type) {
            case 'navigate': return `Go to ${action.url || ''}`
            case 'new_tab': return `Open ${action.url || ''} in a new tab`
            case 'click_ref': return `Click element [${action.ref}]`
            case 'type_ref': return `Type "${(action.text || '').substring(0, 30)}"`
            case 'scroll': return `Scroll ${action.direction || 'down'}`
            case 'cdp_key': return `Press ${action.key || ''}`
            case 'screenshot': return 'Take a screenshot'
            case 'wait': return `Wait ${action.duration || 1000}ms`
            case 'execute_js': return 'Run JavaScript'
            default: return action.type
        }
    }

    approve() {
        if (this.approvalResolver) this._settle({ approved: true, approveAll: false })
    }

    async approveAll() {
        if (this.approvalResolver) this._settle({ approved: true, approveAll: true })
        // "Approve all" is a mode change and has to survive closing the panel.
        await this.setMode('act')
    }

    deny() {
        if (this.approvalResolver) this._settle({ approved: false, approveAll: false })
    }

    approvePlanExecution() {
        if (this.approvalResolver) this._settle({ approved: true })
    }

    rejectPlan() {
        if (this.approvalResolver) this._settle({ approved: false })
    }

    /** Stop pressed, new chat, panel closing: whatever is waiting is answered "no". */
    cancelPending() {
        this._approvedPlan = null
        if (this.approvalResolver) this._settle({ approved: false, cancelled: true })
    }
}
