class PermissionManager {
    constructor() {
        this.mode = 'ask'
        this.pendingApproval = null
        this.onApprovalNeeded = null
        this.onPlanApproval = null
        this.approvalResolver = null
        this._planApprovalTimeout = 120000
    }

    static MODES = {
        ask: {
            label: 'Ask Before Acting',
            description: 'Agent asks for approval before each action',
            icon: '❓'
        },
        act: {
            label: 'Act Before Asking',
            description: 'Agent acts and shows what it did',
            icon: '⚡'
        },
        plan: {
            label: 'Follow a Plan',
            description: 'Agent presents a plan, executes on approval',
            icon: '📋'
        }
    }

    async init() {
        const stored = await chrome.storage.local.get('agent_permission_mode')
        this.mode = stored.agent_permission_mode || 'ask'
    }

    async setMode(mode) {
        if (!PermissionManager.MODES[mode]) return
        this.mode = mode
        await chrome.storage.local.set({ agent_permission_mode: mode })
    }

    getMode() {
        return this.mode
    }

    getModeInfo() {
        return PermissionManager.MODES[this.mode]
    }

    async checkPermission(action) {
        if (this.mode === 'act') {
            return { approved: true, approveAll: false }
        }

        if (this.mode === 'ask') {
            return await this.requestApproval(action)
        }

        if (this.mode === 'plan') {
            return { approved: true, approveAll: false }
        }

        return { approved: true, approveAll: false }
    }

    async requestPlanApproval(actions) {
        const steps = actions.map(a => ({
            type: a.type,
            description: this._describeActionBrief(a)
        }))

        return new Promise((resolve) => {
            this.pendingApproval = { type: 'plan', steps, actions }
            this.approvalResolver = resolve

            if (this.onPlanApproval) {
                this.onPlanApproval({ steps, actions })
            }

            setTimeout(() => {
                if (this.approvalResolver === resolve) {
                    this.approvalResolver = null
                    this.pendingApproval = null
                    resolve({ approved: false })
                }
            }, this._planApprovalTimeout)
        })
    }

    _describeActionBrief(action) {
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

    async requestApproval(action) {
        return new Promise((resolve) => {
            this.pendingApproval = action
            this.approvalResolver = resolve

            if (this.onApprovalNeeded) {
                this.onApprovalNeeded(action)
            }

            setTimeout(() => {
                if (this.approvalResolver === resolve) {
                    this.approvalResolver = null
                    this.pendingApproval = null
                    resolve({ approved: false, approveAll: false, timedOut: true })
                }
            }, 60000)
        })
    }

    approve() {
        if (this.approvalResolver) {
            this.approvalResolver({ approved: true, approveAll: false })
            this.pendingApproval = null
            this.approvalResolver = null
        }
    }

    approveAll() {
        if (this.approvalResolver) {
            this.approvalResolver({ approved: true, approveAll: true })
            this.pendingApproval = null
            this.approvalResolver = null
            this.mode = 'act'
        }
    }

    deny() {
        if (this.approvalResolver) {
            this.approvalResolver({ approved: false, approveAll: false })
            this.pendingApproval = null
            this.approvalResolver = null
        }
    }

    async approvePlan(steps) {
        return new Promise((resolve) => {
            this.pendingApproval = { type: 'plan', steps }
            this.approvalResolver = resolve

            if (this.onApprovalNeeded) {
                this.onApprovalNeeded({ type: 'plan', steps })
            }
        })
    }

    approvePlanExecution() {
        if (this.approvalResolver) {
            this.approvalResolver({ approved: true })
            this.pendingApproval = null
            this.approvalResolver = null
        }
    }

    rejectPlan() {
        if (this.approvalResolver) {
            this.approvalResolver({ approved: false })
            this.pendingApproval = null
            this.approvalResolver = null
        }
    }
}
