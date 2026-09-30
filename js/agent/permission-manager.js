/**
 * Who gets to approve an action before it runs.
 *
 * Three modes, chosen by the user and kept in storage: `ask` (every action), `act` (none),
 * `plan` (the steps of a plan the user approved run, anything else asks). On top of the mode:
 *
 *   - Some actions ask whatever the mode is. Running arbitrary JavaScript in the page and
 *     typing into a password or card field are never something "act" waves through, and
 *     neither is "approve all": that is how Claude in Chrome treats them too.
 *   - "Approve all" answers the rest of THIS run, not every run from now on. It used to
 *     switch the stored mode to `act`, which also silently governed every later scheduled
 *     task.
 *   - A run may carry a mode override: a scheduled task that fires while nobody asked for
 *     autonomy runs under `ask` even when the stored mode is `act`.
 *   - A site the user marked "always allow" runs without asking in `ask` and `plan` mode,
 *     except for what always asks. The list is kept in storage and reviewed in Settings.
 *   - On a payment or finance page every action that changes something asks, in every mode.
 */
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
        /** "Approve all" for the current run; cleared when the run ends. */
        this.approveAllForRun = false
        /** A mode the current run has to use instead of the stored one, or null. */
        this.runModeOverride = null
        /** Registrable domains the user allowed once and for all. */
        this.siteAllow = new Set()
        /** The `{ url, financial }` the pending approval was asked with. */
        this.pendingContext = null
        /** Modes the organization allows (chrome.storage.managed); empty means all. */
        this.allowedModes = []
        try {
            chrome.storage.onChanged.addListener((changes, area) => {
                if (area === 'local' && changes[PermissionManager.SITE_ALLOW_KEY]) {
                    this.siteAllow = new Set(changes[PermissionManager.SITE_ALLOW_KEY].newValue || [])
                }
            })
        } catch (_) { }
    }

    static MODES = ['ask', 'act', 'plan']
    static SITE_ALLOW_KEY = 'agent_site_allow'

    /** Actions that ask in every mode, "approve all" included. `download` is the worker's, not the model's. */
    static ALWAYS_CONFIRM = new Set(['execute_js', 'download', 'upload_file'])

    /** Actions that change something on the page; the ones that ask on a payment or finance page. */
    static MUTATING = new Set(['click', 'click_ref', 'type', 'type_ref', 'form_input', 'cdp_click', 'cdp_type', 'cdp_key', 'cdp_drag', 'execute_js'])

    async init() {
        const stored = await chrome.storage.local.get(['agent_permission_mode', PermissionManager.SITE_ALLOW_KEY])
        this.mode = PermissionManager.MODES.includes(stored.agent_permission_mode) ? stored.agent_permission_mode : 'ask'
        this.siteAllow = new Set(Array.isArray(stored[PermissionManager.SITE_ALLOW_KEY]) ? stored[PermissionManager.SITE_ALLOW_KEY] : [])
    }

    /** The site of a URL, as the allow list keys it. registrableDomain comes from utils.js. */
    static siteOf(url) {
        if (typeof registrableDomain === 'function') return registrableDomain(url)
        try { return new URL(url).hostname.toLowerCase() } catch (_) { return '' }
    }

    isSiteAllowed(url) {
        const site = PermissionManager.siteOf(url)
        return !!site && this.siteAllow.has(site)
    }

    async allowSite(site) {
        const key = String(site || '').trim().toLowerCase()
        if (!key) return
        this.siteAllow.add(key)
        await chrome.storage.local.set({ [PermissionManager.SITE_ALLOW_KEY]: [...this.siteAllow].sort() })
    }

    async removeSite(site) {
        this.siteAllow.delete(String(site || '').trim().toLowerCase())
        await chrome.storage.local.set({ [PermissionManager.SITE_ALLOW_KEY]: [...this.siteAllow].sort() })
    }

    getAllowedSites() {
        return [...this.siteAllow].sort()
    }

    async setMode(mode) {
        if (!PermissionManager.MODES.includes(mode) || !this.isModeAllowed(mode)) return
        this.mode = mode
        await chrome.storage.local.set({ agent_permission_mode: mode })
    }

    /**
     * Modes an administrator allows. A stored mode outside the list is not used: the closest
     * allowed one is, `ask` first. The list is empty when nothing is managed.
     */
    setPolicy(policy) {
        const modes = policy && Array.isArray(policy.AllowedPermissionModes) ? policy.AllowedPermissionModes : []
        this.allowedModes = modes.filter(m => PermissionManager.MODES.includes(m))
    }

    isModeAllowed(mode) {
        return this.allowedModes.length === 0 || this.allowedModes.includes(mode)
    }

    /** `mode`, or the allowed mode that stands in for it. */
    clampMode(mode) {
        if (this.isModeAllowed(mode)) return mode
        return this.allowedModes.includes('ask') ? 'ask' : this.allowedModes[0]
    }

    /** The mode this run actually uses. */
    effectiveMode() {
        const wanted = PermissionManager.MODES.includes(this.runModeOverride) ? this.runModeOverride : this.mode
        return this.clampMode(wanted)
    }

    /** Start of a run: nothing approved yet, and the run's mode override if it has one. */
    beginRun({ modeOverride = null } = {}) {
        this.approveAllForRun = false
        this._approvedPlan = null
        this.runModeOverride = PermissionManager.MODES.includes(modeOverride) ? modeOverride : null
    }

    endRun() {
        this.approveAllForRun = false
        this._approvedPlan = null
        this.runModeOverride = null
    }

    /**
     * Whether `action` asks regardless of mode: running JavaScript, a download, typing into
     * a sensitive field, or changing anything on a payment or finance page.
     */
    static alwaysConfirms(action, context = {}) {
        if (!action) return false
        if (PermissionManager.ALWAYS_CONFIRM.has(action.type) || action.sensitive === true) return true
        return context.financial === true && PermissionManager.MUTATING.has(action.type)
    }

    /**
     * `context` is `{ url, financial }` for the page the action targets. In `plan` mode only
     * the steps of the plan the user approved may run; anything the model adds afterwards goes
     * through the ordinary per-action approval.
     */
    async checkPermission(action, context = {}) {
        if (PermissionManager.alwaysConfirms(action, context)) {
            return await this.requestApproval(action, context)
        }
        if (this.approveAllForRun) {
            return { approved: true, approveAll: true }
        }
        if (context.url && this.isSiteAllowed(context.url)) {
            return { approved: true, site: true }
        }
        const mode = this.effectiveMode()
        if (mode === 'act') {
            return { approved: true, approveAll: false }
        }
        if (mode === 'plan') {
            if (this._approvedPlan && this._approvedPlan.includes(action)) {
                return { approved: true, approveAll: false }
            }
            return await this.requestApproval(action, context)
        }
        return await this.requestApproval(action, context)
    }

    /** Whether the open approval can be answered with "always allow on this site". */
    canAllowPendingSite() {
        if (!this.pendingApproval || !this.pendingContext || !this.pendingContext.url) return false
        if (PermissionManager.alwaysConfirms(this.pendingApproval, this.pendingContext)) return false
        return !!PermissionManager.siteOf(this.pendingContext.url)
    }

    /** The site the open approval is about, for the button label. */
    pendingSite() {
        return this.pendingContext && this.pendingContext.url ? PermissionManager.siteOf(this.pendingContext.url) : ''
    }

    /** "Always allow on this site": the pending action runs, and so does every later one there. */
    async approveSite() {
        if (!this.canAllowPendingSite()) return null
        const site = this.pendingSite()
        await this.allowSite(site)
        this._settle({ approved: true, site: true })
        return site
    }

    /**
     * The worker refused to type into a field that looks like a password or a card number.
     * The user decides; the answer is good for this one action only.
     */
    async requestSensitiveApproval(action, result, context = {}) {
        return await this.requestApproval({
            ...action,
            sensitive: true,
            fieldLabel: (result && result.field) || ''
        }, context)
    }

    _settle(result) {
        const resolve = this.approvalResolver
        this.approvalResolver = null
        this.pendingApproval = null
        this.pendingContext = null
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

    async requestApproval(action, context = {}) {
        return this._open(
            action,
            () => {
                this.pendingContext = context || {}
                if (this.onApprovalNeeded) this.onApprovalNeeded(action, this.pendingContext)
            },
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

    /** This action and the rest of the run, except what always asks. The stored mode is untouched. */
    approveAll() {
        this.approveAllForRun = true
        if (this.approvalResolver) this._settle({ approved: true, approveAll: true })
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
        this.approveAllForRun = false
        this.runModeOverride = null
        if (this.approvalResolver) this._settle({ approved: false, cancelled: true })
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PermissionManager }
}
