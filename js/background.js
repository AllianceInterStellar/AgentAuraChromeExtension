// The service worker has no DOM, but it does show notifications, so it needs the same strings
// as the pages. i18n.js only touches `document` inside applyToPage, which is never called here.
importScripts('i18n.js')

/**
 * Stable error codes. The side panel decides whether an action is worth retrying by looking at
 * these, never at the message text: the text is translated, the code is not.
 */
const ERR = {
    NO_TAB: 'NO_TAB',
    BLOCKED_SITE: 'BLOCKED_SITE',
    ELEMENT_NOT_FOUND: 'ELEMENT_NOT_FOUND',
    NO_RESULT: 'NO_RESULT',
    UNKNOWN_ACTION: 'UNKNOWN_ACTION',
    CONTENT_SCRIPT_UNAVAILABLE: 'CONTENT_SCRIPT_UNAVAILABLE',
    TAB_NOT_IN_GROUP: 'TAB_NOT_IN_GROUP',
    UNKNOWN_MESSAGE: 'UNKNOWN_MESSAGE',
    /** The target of type/form_input/cdp_type looks like a password or card field; the user has to confirm. */
    SENSITIVE_FIELD: 'SENSITIVE_FIELD',
    /** A navigation target that is not http(s). */
    INVALID_URL: 'INVALID_URL',
    /** A screenshot of a tab that is not the visible one. */
    NOT_VISIBLE: 'NOT_VISIBLE',
    /** The page did not answer a script within the time limit (a dialog is the usual reason). */
    TIMEOUT: 'TIMEOUT'
}

/** How long a script in the page may take before the action is given up. */
const EXEC_TIMEOUT_MS = 15000

const fail = (code, error, extra = {}) => ({ success: false, code, error: error || code, ...extra })

/** The only scheme the agent may navigate to. javascript:, data:, file: and chrome: are not pages it may open. */
function isHttpUrl(url) {
    return /^https?:\/\/\S+$/i.test(String(url || '').trim())
}

/**
 * A navigation target is checked BEFORE the tab goes there: an off-limits address used to be
 * reached first and only the actions after it refused. Returns the failure, or null.
 */
async function checkNavigationTarget(url) {
    if (!isHttpUrl(url)) return fail(ERR.INVALID_URL, 'Only http:// and https:// addresses can be opened')
    if (await isSiteBlocked(url)) return fail(ERR.BLOCKED_SITE, 'That address is off limits for security reasons (a sign-in, bank or government page)')
    return null
}

/**
 * `pattern` from the model, applied to a console or network line: a regular expression when
 * it parses as one, a case-insensitive substring otherwise. No pattern matches everything.
 */
function matchesPattern(text, pattern) {
    if (pattern === undefined || pattern === null || pattern === '') return true
    const s = String(text ?? '')
    try {
        return new RegExp(String(pattern), 'i').test(s)
    } catch (_) {
        return s.toLowerCase().includes(String(pattern).toLowerCase())
    }
}

const SETTINGS_KEY = 'agent_settings'
const DEFAULT_SETTINGS = {
    blockedSitesEnabled: true,
    screenshotQuality: 80,
    maxSteps: 50,
    tabGroupEnabled: true,
    /** A screenshot on every model turn. Off: the panel sends one only when the element list is not enough or the model asks. */
    screenshotEveryTurn: false,
    /** Every action that changes something on a payment or finance page asks first. */
    financialConfirmEnabled: true,
    /** Hostnames the user added to the blocklist, and hostnames excepted from it. */
    extraBlockedHosts: [],
    allowedHosts: []
}

const TAB_GROUP_STATE_KEY = 'agent_tab_group_state'
const SCHEDULED_TASKS_KEY = 'agent_scheduled_tasks'
const PENDING_TASK_KEY = 'agent_pending_scheduled_task'
const ALARM_PREFIX = 'scheduled_task_'
const AGENT_GROUP_BASE_TITLE = 'AgentAura'
const GROUP_STATUS_PREFIX = {
    idle: '',
    running: '⌛ ',
    approval: '🔔 ',
    complete: '✅ ',
    error: '⚠️ '
}
const GROUP_STATUS_COLOR = {
    idle: 'red',
    running: 'orange',
    approval: 'yellow',
    complete: 'green',
    error: 'grey'
}

/**
 * The content scripts are injected into a tab the first time the agent needs them there, not
 * into every page the user opens. Both files guard against running twice, so re-injecting
 * after a navigation is harmless.
 */
const CONTENT_SCRIPTS = [
    'js/content-scripts/accessibility-tree.js',
    'js/content-scripts/agent-visual-indicator.js'
]
const CONTENT_MESSAGE_TYPES = new Set([
    'GET_ACCESSIBILITY_TREE', 'GET_PAGE_STRUCTURE', 'GET_PAGE_CONTENT',
    'CLICK_ELEMENT_BY_REF', 'TYPE_IN_ELEMENT_BY_REF', 'HOVER_ELEMENT_BY_REF', 'GET_ELEMENT_RECT',
    'INDICATOR_SHOW', 'INDICATOR_HIDE', 'INDICATOR_COMPLETE', 'INDICATOR_ERROR',
    'INDICATOR_TIMELINE', 'INDICATOR_CLICK', 'INDICATOR_HIGHLIGHT'
])

// ---------------------------------------------------------------------------------------------
// Site blocking
// ---------------------------------------------------------------------------------------------

// Pages the extension cannot script anyway. These stay blocked even when the user turns the
// site list off, because an action against them can only fail.
const INTERNAL_SCHEMES = new Set(['chrome:', 'chrome-extension:', 'chrome-untrusted:', 'about:', 'devtools:', 'edge:', 'brave:', 'file:'])
// Whole hostnames, matched exactly or as a suffix (`.accounts.google.com`).
const BLOCKED_HOSTS = ['accounts.google.com', 'login.microsoftonline.com', 'login.live.com', 'appleid.apple.com']
// A single hostname label that names a sign-in surface or a bank.
const BLOCKED_HOST_LABELS = new Set(['login', 'signin', 'sso', 'auth', 'accounts'])
const BANK_LABEL = /^bank|bank(ing)?$/i
const GOV_TLD = /(^|\.)gov(\.[a-z]{2})?$/i
// Path segments that mark an authentication flow.
const BLOCKED_PATH_SEGMENTS = new Set(['oauth', 'oauth2', 'login', 'signin', 'sign-in', 'sso'])

/** Pure: the rules alone, without the user's on/off switch. Unit-tested. */
function isBlockedSite(url) {
    if (!url) return false
    let parsed
    try {
        parsed = new URL(url)
    } catch (_) {
        return false
    }
    if (INTERNAL_SCHEMES.has(parsed.protocol)) return true
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false

    const host = parsed.hostname.toLowerCase()
    if (BLOCKED_HOSTS.some(h => host === h || host.endsWith('.' + h))) return true
    if (GOV_TLD.test(host)) return true
    const labels = host.split('.')
    if (labels.some(l => BLOCKED_HOST_LABELS.has(l) || BANK_LABEL.test(l))) return true

    const segments = parsed.pathname.toLowerCase().split('/').filter(Boolean)
    if (segments[0] === 'auth') return true
    if (segments.some(s => BLOCKED_PATH_SEGMENTS.has(s))) return true

    return false
}

function isInternalUrl(url) {
    try {
        return INTERNAL_SCHEMES.has(new URL(url).protocol)
    } catch (_) {
        return false
    }
}

/**
 * Payment providers, brokerages, exchanges and the like, plus the checkout and billing paths
 * of any site. Not blocked: the user may well be shopping. But every action that changes
 * something on such a page asks first, in every mode, as Claude in Chrome does before a
 * purchase.
 */
const FINANCIAL_HOSTS = [
    'paypal.com', 'venmo.com', 'cash.app', 'wise.com', 'revolut.com', 'stripe.com', 'checkout.stripe.com', 'klarna.com', 'affirm.com', 'afterpay.com',
    'coinbase.com', 'binance.com', 'kraken.com', 'crypto.com', 'gemini.com', 'okx.com', 'bybit.com',
    'robinhood.com', 'schwab.com', 'fidelity.com', 'vanguard.com', 'etrade.com', 'tdameritrade.com', 'interactivebrokers.com', 'webull.com',
    'chase.com', 'wellsfargo.com', 'bankofamerica.com', 'citi.com', 'citibank.com', 'capitalone.com', 'usbank.com', 'pnc.com', 'americanexpress.com', 'discover.com',
    'alipay.com', 'tenpay.com', 'unionpay.com', 'unionpayintl.com', 'paytm.com', 'phonepe.com', 'payoneer.com', 'skrill.com', 'zellepay.com'
]
const FINANCIAL_PATH_SEGMENTS = new Set(['checkout', 'payment', 'payments', 'pay', 'billing', 'cart', 'purchase', 'order', 'orders', 'buy', 'subscribe', 'transfer', 'withdraw', 'deposit'])

/** Pure: whether the page is one where actions ask before running. Unit-tested. */
function isFinancialSite(url) {
    if (!url) return false
    let parsed
    try {
        parsed = new URL(url)
    } catch (_) {
        return false
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    const host = parsed.hostname.toLowerCase()
    if (FINANCIAL_HOSTS.some(h => host === h || host.endsWith('.' + h))) return true
    const segments = parsed.pathname.toLowerCase().split('/').filter(Boolean)
    return segments.some(seg => FINANCIAL_PATH_SEGMENTS.has(seg))
}

/** `host` is `entry` or a subdomain of it, for the hostname lists the user keeps in Settings. */
function hostMatches(host, entries) {
    if (!host || !Array.isArray(entries)) return false
    const h = String(host).toLowerCase()
    return entries.some(raw => {
        const e = String(raw || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
        return e && (h === e || h.endsWith('.' + e))
    })
}

/**
 * The rules plus the user's settings: the on/off switch, the sites they added to the
 * blocklist, and the sites they excepted from it. Browser-internal pages stay off limits
 * whatever the settings say.
 */
async function isSiteBlocked(url) {
    if (!url) return false
    if (isInternalUrl(url)) return true
    const settings = await getSettings()
    let host = ''
    try { host = new URL(url).hostname } catch (_) { return false }
    if (hostMatches(host, settings.allowedHosts)) return false
    if (hostMatches(host, settings.extraBlockedHosts)) return true
    if (settings.blockedSitesEnabled === false) return false
    return isBlockedSite(url)
}

/** Whether actions on the page ask before running, per the setting. */
async function isSiteFinancial(url) {
    const settings = await getSettings()
    if (settings.financialConfirmEnabled === false) return false
    return isFinancialSite(url)
}

// ---------------------------------------------------------------------------------------------
// Settings (read once, refreshed on change)
// ---------------------------------------------------------------------------------------------

let settingsCache = null

async function getSettings() {
    if (settingsCache) return settingsCache
    const stored = await chrome.storage.local.get(SETTINGS_KEY)
    settingsCache = { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] || {}) }
    return settingsCache
}

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[SETTINGS_KEY]) {
        settingsCache = { ...DEFAULT_SETTINGS, ...(changes[SETTINGS_KEY].newValue || {}) }
    }
})

async function t(key, params) {
    try {
        await I18n.init()
        return I18n.t(key, params)
    } catch (_) {
        return key
    }
}

// ---------------------------------------------------------------------------------------------
// In-memory state. The worker is shut down after ~30s idle, so anything here is a cache of what
// is in storage, never the only copy; every handler that reads it calls
// ensureTabGroupStateLoaded() first.
// ---------------------------------------------------------------------------------------------

let agentTabGroupId = null
let agentTabs = new Map()
let debuggerAttached = new Map()
let consoleMessages = new Map()
let networkRequests = new Map()
/** Dialogs the page opened during a run, per tab, answered automatically and reported to the model. */
let dialogs = new Map()
let tabGroupStateLoaded = false
let agentGroupState = {
    mainTabId: null,
    title: AGENT_GROUP_BASE_TITLE,
    status: 'idle',
    lastActiveTabId: null
}

// ---------------------------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async (details) => {
    // Defaults only on a fresh install. This listener also fires on every update, and it used
    // to overwrite the user's permission mode, shortcuts, scheduled tasks and settings each
    // time a new version shipped.
    if (details.reason === 'install') {
        await chrome.storage.local.set({
            agent_permission_mode: 'ask',
            agent_shortcuts: [],
            [SCHEDULED_TASKS_KEY]: [],
            [SETTINGS_KEY]: { ...DEFAULT_SETTINGS }
        })
    } else {
        // Fill in any setting a newer version added, keep whatever the user has set.
        const stored = await chrome.storage.local.get(SETTINGS_KEY)
        await chrome.storage.local.set({ [SETTINGS_KEY]: { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] || {}) } })
    }
    // Alarms do not survive an update or a reload; the tasks in storage do.
    await rebuildScheduledAlarms()
})

chrome.runtime.onStartup.addListener(() => {
    rebuildScheduledAlarms().catch(() => { })
})

// Clicking the icon opens the panel for that tab and puts the tab in the agent's group. This is
// a user gesture, so sidePanel.open() is allowed here. (setPanelBehavior's
// openPanelOnActionClick is deliberately not used: with it on, this listener does not fire.)
chrome.action.onClicked.addListener(async (tab) => {
    try {
        if (tab && tab.id) {
            await openAgentForTab(tab.id)
            return
        }
        await openAgentForCurrentTab()
    } catch (e) {
        notify('open-failed', 'AgentAura', e.message || await t('bg.panelOpenFailed'))
    }
})

chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'toggle-agent') {
        await openAgentForCurrentTab()
    }
})

// ---------------------------------------------------------------------------------------------
// Messages from the side panel
// ---------------------------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Only the extension's own pages talk to the worker. Content scripts run in web pages, and
    // a page that found a way to make one send a message must not reach the debugger.
    if (sender.tab && !(sender.url || '').startsWith(chrome.runtime.getURL(''))) {
        sendResponse(fail(ERR.UNKNOWN_MESSAGE, 'Not allowed from a web page'))
        return false
    }

    const respond = (promise) => {
        promise
            .then(result => sendResponse(result))
            .catch(err => sendResponse(fail(err.code || 'ERROR', err.message)))
        return true
    }

    if (CONTENT_MESSAGE_TYPES.has(message.type)) {
        return respond(forwardToContentScript(message))
    }

    switch (message.type) {
        case 'GET_AUTH_TOKEN':
            chrome.storage.local.get('auth_id_token', (result) => {
                sendResponse({ token: result.auth_id_token || null })
            })
            return true

        case 'OPEN_SIDE_PANEL':
            return respond(openAgentForCurrentTab(sender.tab?.id).then(() => ({ success: true })))

        case 'AGENT_EXECUTE_ACTION':
            return respond(handleAgentAction(message.action, message.tabId))

        // The direct routes below all go through handleAgentAction so that the blocked-site
        // check applies to them too.
        case 'AGENT_EXECUTE_JS':
            return respond(handleAgentAction({ type: 'execute_js', code: message.code || '' }, message.tabId))

        case 'AGENT_GET_PAGE_TEXT':
            return respond(handleAgentAction({ type: 'get_page_text' }, message.tabId))

        case 'AGENT_TAKE_SCREENSHOT':
            return respond(handleAgentAction({ type: 'screenshot' }, message.tabId))

        case 'ENSURE_CONTENT_SCRIPTS':
            return respond(resolveTab(message.tabId).then(async tab => {
                if (!tab) return fail(ERR.NO_TAB, 'No active tab')
                await ensureContentScripts(tab.id)
                return { success: true, tabId: tab.id }
            }))

        case 'TAB_GROUP_CREATE':
            return respond(createTabGroup(message.tabIds, message.title).then(groupId => ({ success: true, groupId })))

        case 'TAB_GROUP_ENSURE':
            return respond(ensureTabGroup(message.tabId, message.title).then(result => ({ success: true, ...result })))

        case 'TAB_GROUP_ADD':
            return respond(addTabToGroup(message.tabId, message.groupId).then(groupId => ({ success: true, groupId })))

        case 'TAB_GROUP_LIST':
            return respond(listGroupTabs(message.tabId).then(result => ({ success: true, ...result })))

        case 'AGENT_GROUP_STATUS':
            return respond(updateAgentGroupState(message.state || {}).then(result => ({ success: true, ...result })))

        case 'AGENT_START_MONITORING':
            return respond(startMonitoring(message.tabId).then(tabId => ({ success: true, tabId })))

        case 'AGENT_STOP_MONITORING':
            return respond(stopMonitoring(message.tabId).then(() => ({ success: true })))

        case 'CHECK_BLOCKED_SITE':
            return respond(Promise.all([isSiteBlocked(message.url), isSiteFinancial(message.url)])
                .then(([blocked, financial]) => ({ blocked, financial })))

        // The side panel confirmed a download the worker had cancelled (see downloads.onCreated).
        // Started by the extension itself, it carries byExtensionId and is not gated again.
        case 'AGENT_DOWNLOAD_ALLOW':
            return respond(allowDownload(message.url, message.filename))

        case 'GET_SETTINGS':
            return respond(getSettings().then(settings => ({ success: true, settings })))

        case 'TAKE_PENDING_SCHEDULED_TASK':
            return respond(takePendingScheduledTask(message.tabId))

        case 'AGENT_NOTIFY':
            notify(`agent-${Date.now()}`, message.title || 'AgentAura', message.message || '')
            sendResponse({ success: true })
            return true
    }

    sendResponse(fail(ERR.UNKNOWN_MESSAGE, `Unknown message type: ${message.type}`))
    return false
})

// ---------------------------------------------------------------------------------------------
// Scheduled tasks
// ---------------------------------------------------------------------------------------------

async function rebuildScheduledAlarms() {
    const stored = await chrome.storage.local.get(SCHEDULED_TASKS_KEY)
    const tasks = stored[SCHEDULED_TASKS_KEY] || []
    const wanted = new Set()
    for (const task of tasks) {
        if (!task.enabled || !(task.intervalMinutes >= 1)) continue
        wanted.add(ALARM_PREFIX + task.id)
        await chrome.alarms.create(ALARM_PREFIX + task.id, { periodInMinutes: task.intervalMinutes })
    }
    const existing = await chrome.alarms.getAll()
    for (const alarm of existing) {
        if (alarm.name.startsWith(ALARM_PREFIX) && !wanted.has(alarm.name)) {
            await chrome.alarms.clear(alarm.name)
        }
    }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (!alarm.name.startsWith(ALARM_PREFIX)) return
    const taskId = alarm.name.slice(ALARM_PREFIX.length)
    const stored = await chrome.storage.local.get(SCHEDULED_TASKS_KEY)
    const tasks = stored[SCHEDULED_TASKS_KEY] || []
    const task = tasks.find(t => t.id === taskId)
    if (!task || !task.enabled) {
        await chrome.alarms.clear(alarm.name)
        return
    }
    task.lastRun = Date.now()
    task.runCount = (task.runCount || 0) + 1
    await chrome.storage.local.set({ [SCHEDULED_TASKS_KEY]: tasks })
    await executeScheduledTask(task)
})

/**
 * An alarm is not a user gesture, and chrome.sidePanel.open() insists on one. So the task is
 * parked in session storage, the panel is opened if Chrome allows it, and otherwise a
 * notification is shown whose click (a gesture) opens it. The panel pulls the task when it
 * starts, instead of the worker pushing a message at a panel that may not be listening yet.
 */
async function executeScheduledTask(task) {
    try {
        // Not focused: an alarm firing in the middle of the user's typing must not steal the
        // keyboard. The notification click brings the window forward when they are ready.
        const win = await chrome.windows.create({
            url: task.url || 'about:blank',
            type: 'normal',
            focused: false
        })
        const tab = win.tabs?.[0] || (await chrome.tabs.query({ windowId: win.id }))[0]
        if (!tab) throw new Error('The task window has no tab')

        await chrome.storage.session.set({
            [PENDING_TASK_KEY]: { task, tabId: tab.id, windowId: win.id, createdAt: Date.now() }
        })
        if (task.url) await waitForTabComplete(tab.id, 15000)

        try {
            await openAgentForTab(tab.id)
        } catch (_) {
            notify(
                ALARM_PREFIX + task.id,
                await t('bg.taskReadyTitle'),
                await t('bg.taskReadyBody', { name: task.name || '' })
            )
        }
    } catch (e) {
        console.error('[Background] scheduled task failed:', e)
    }
}

chrome.notifications.onClicked.addListener(async (notificationId) => {
    chrome.notifications.clear(notificationId)
    if (!notificationId.startsWith(ALARM_PREFIX)) return
    const stored = await chrome.storage.session.get(PENDING_TASK_KEY)
    const pending = stored[PENDING_TASK_KEY]
    if (!pending) return
    try {
        if (pending.windowId) await chrome.windows.update(pending.windowId, { focused: true }).catch(() => { })
        await openAgentForTab(pending.tabId)
    } catch (e) {
        console.error('[Background] could not open the panel for the scheduled task:', e)
    }
})

async function takePendingScheduledTask(tabId) {
    const stored = await chrome.storage.session.get(PENDING_TASK_KEY)
    const pending = stored[PENDING_TASK_KEY]
    if (!pending) return { success: true, task: null }
    // A parked task is only handed to the panel of the tab it was created for, and only once.
    if (tabId && pending.tabId !== tabId) return { success: true, task: null }
    // Left over from a run that never picked it up (an hour is far past any interval that
    // makes sense for "still pending").
    if (Date.now() - pending.createdAt > 60 * 60 * 1000) {
        await chrome.storage.session.remove(PENDING_TASK_KEY)
        return { success: true, task: null }
    }
    await chrome.storage.session.remove(PENDING_TASK_KEY)
    return { success: true, task: pending.task, tabId: pending.tabId }
}

function notify(id, title, message) {
    try {
        chrome.notifications.create(String(id), {
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title,
            message
        })
    } catch (e) {
        console.error('[Background] notification failed:', e)
    }
}

// ---------------------------------------------------------------------------------------------
// Tab lifecycle
// ---------------------------------------------------------------------------------------------

chrome.tabs.onRemoved.addListener(async (tabId) => {
    // Without this, a worker that had just woken up saw an empty agentTabs map, decided the
    // group was gone, and deleted the saved state when any unrelated tab was closed.
    await ensureTabGroupStateLoaded()

    debuggerAttached.delete(tabId)
    consoleMessages.delete(tabId)
    networkRequests.delete(tabId)
    dialogs.delete(tabId)

    if (!agentTabs.has(tabId)) return
    agentTabs.delete(tabId)

    if (tabId === agentGroupState.mainTabId) {
        agentGroupState.mainTabId = Array.from(agentTabs.keys())[0] || null
    }

    if (agentTabs.size === 0) {
        clearAgentTabGroupState().catch(() => { })
    } else {
        saveAgentTabGroupState().catch(() => { })
    }
})

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    await ensureTabGroupStateLoaded()
    if (agentTabs.has(tabId)) {
        agentGroupState.lastActiveTabId = tabId
        await saveAgentTabGroupState()
    }
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.groupId === undefined) return
    handleTrackedTabGroupChange(tabId, changeInfo.groupId).catch(() => { })
})

chrome.tabGroups.onRemoved.addListener(async (group) => {
    await ensureTabGroupStateLoaded()
    if (group.id === agentTabGroupId) {
        clearAgentTabGroupState().catch(() => { })
    }
})

// The user can dismiss Chrome's "is being debugged" bar; the map has to follow.
chrome.debugger.onDetach.addListener((source) => {
    if (source.tabId !== undefined) debuggerAttached.delete(source.tabId)
})

// ---------------------------------------------------------------------------------------------
// Downloads while the agent runs
// ---------------------------------------------------------------------------------------------

/**
 * The model has no download action, but a navigate to an attachment URL, a click on an
 * <a download> or a script that builds one starts a download all the same. While a run is
 * going, any download the extension did not start itself is cancelled and handed to the side
 * panel, which asks the user; on approval the worker starts it again (allowDownload). A
 * download always asks, whatever the permission mode: that is the bar Claude in Chrome sets.
 */
chrome.downloads.onCreated.addListener(async (item) => {
    try {
        if (item.byExtensionId === chrome.runtime.id) return
        await ensureTabGroupStateLoaded()
        if (agentGroupState.status !== 'running' && agentGroupState.status !== 'approval') return
        try { await chrome.downloads.cancel(item.id) } catch (_) { }
        try { await chrome.downloads.erase({ id: item.id }) } catch (_) { }
        const url = item.finalUrl || item.url || ''
        const filename = String(item.filename || '').split(/[\\/]/).pop() || ''
        chrome.runtime.sendMessage({
            type: 'AGENT_DOWNLOAD_BLOCKED',
            url,
            filename,
            mime: item.mime || '',
            bytes: item.totalBytes > 0 ? item.totalBytes : (item.fileSize > 0 ? item.fileSize : 0)
        }).catch(() => { })
    } catch (e) {
        console.error('[Background] download gate failed:', e)
    }
})

async function allowDownload(url, filename) {
    if (!isHttpUrl(url)) return fail(ERR.INVALID_URL, 'Only http(s) downloads can be restarted')
    const options = { url }
    // A bare, safe file name only: the downloads API treats anything else as a path.
    if (filename && /^[\w.() -]{1,120}$/.test(filename) && !/^\.+$/.test(filename)) options.filename = filename
    const id = await chrome.downloads.download(options)
    return { success: true, id }
}

// ---------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------

async function resolveTab(tabId) {
    if (tabId) {
        try {
            return await chrome.tabs.get(tabId)
        } catch (_) {
            return null
        }
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    return tab || null
}

async function handleAgentAction(action, tabId) {
    await ensureTabGroupStateLoaded()
    if (!action || !action.type) return fail(ERR.UNKNOWN_ACTION, 'No action')

    const tab = await resolveTab(tabId)
    if (!tab) return fail(ERR.NO_TAB, 'No active tab')

    // With a tab group in place the run is confined to it: a tab outside the group is refused
    // rather than acted on. Without a group (tab groups switched off, or the API unavailable)
    // there is nothing to confine to.
    if (agentTabGroupId && tabId && tab.groupId !== agentTabGroupId) {
        return fail(ERR.TAB_NOT_IN_GROUP, 'That tab is not in the agent tab group')
    }

    if (await isSiteBlocked(tab.url)) {
        return fail(ERR.BLOCKED_SITE, 'This site is off limits for security reasons')
    }

    const result = await runAgentAction(action, tab)

    // A dialog the page opened while the action ran was answered for it (see the debugger
    // event listener); the model is told, because the page it sees next is not the one it
    // expected.
    const seen = dialogs.get(tab.id)
    if (seen && seen.length && result && typeof result === 'object' && !Array.isArray(result)) {
        result.dialogs = seen.splice(0)
    }
    return result
}

async function runAgentAction(action, tab) {
    switch (action.type) {
        case 'click':
            return await execFunc(tab.id, (selector) => {
                const el = document.querySelector(selector)
                if (!el) return { success: false, code: 'ELEMENT_NOT_FOUND', error: 'Element not found' }
                el.click()
                return { success: true }
            }, [action.selector || ''])

        case 'type':
            // Injected functions cannot share code with the worker, so the sensitive-field
            // test is spelled out here, in form_input, in the content script and in the
            // recorder. Keep the four in step.
            return await execFunc(tab.id, (selector, text, confirmed) => {
                const el = document.querySelector(selector)
                if (!el) return { success: false, code: 'ELEMENT_NOT_FOUND', error: 'Element not found' }
                const type = String(el.type || '').toLowerCase()
                const autocomplete = String(el.getAttribute?.('autocomplete') || '').toLowerCase()
                const nameId = `${el.name || ''} ${el.id || ''}`.toLowerCase()
                const sensitive = type === 'password' || /^cc-|password|one-time-code/.test(autocomplete) || /passw|secret|token|cvv|card/.test(nameId)
                if (sensitive && !confirmed) {
                    const label = el.labels?.[0]?.textContent?.trim() || el.getAttribute?.('aria-label') || el.placeholder || el.name || el.id || type
                    return { success: false, code: 'SENSITIVE_FIELD', error: 'This field looks like a password or card field; the user has to confirm', field: String(label).slice(0, 80) }
                }
                el.focus()
                el.value = ''
                el.value = text
                el.dispatchEvent(new Event('input', { bubbles: true }))
                el.dispatchEvent(new Event('change', { bubbles: true }))
                return { success: true }
            }, [action.selector || '', action.text || '', action.confirmedSensitive === true])

        case 'navigate': {
            const refused = await checkNavigationTarget(action.url)
            if (refused) return refused
            await chrome.tabs.update(tab.id, { url: action.url })
            await waitForTabComplete(tab.id, 10000)
            return { success: true }
        }

        case 'scroll':
            return await execFunc(tab.id, (dir, amount) => {
                if (dir === 'down') window.scrollBy(0, amount)
                else if (dir === 'up') window.scrollBy(0, -amount)
                else if (dir === 'left') window.scrollBy(-amount, 0)
                else if (dir === 'right') window.scrollBy(amount, 0)
                return { success: true }
            }, [action.direction || 'down', Number(action.amount) || 300])

        case 'form_input':
            return await execFunc(tab.id, (selector, value, checked, confirmed) => {
                const el = document.querySelector(selector)
                if (!el) return { success: false, code: 'ELEMENT_NOT_FOUND', error: 'Element not found' }
                const type = String(el.type || '').toLowerCase()
                const autocomplete = String(el.getAttribute?.('autocomplete') || '').toLowerCase()
                const nameId = `${el.name || ''} ${el.id || ''}`.toLowerCase()
                const sensitive = type === 'password' || /^cc-|password|one-time-code/.test(autocomplete) || /passw|secret|token|cvv|card/.test(nameId)
                if (sensitive && !confirmed) {
                    const label = el.labels?.[0]?.textContent?.trim() || el.getAttribute?.('aria-label') || el.placeholder || el.name || el.id || type
                    return { success: false, code: 'SENSITIVE_FIELD', error: 'This field looks like a password or card field; the user has to confirm', field: String(label).slice(0, 80) }
                }
                el.focus()
                if (el.tagName === 'SELECT') {
                    el.value = value
                    el.dispatchEvent(new Event('change', { bubbles: true }))
                } else if (el.type === 'checkbox' || el.type === 'radio') {
                    el.checked = checked
                    el.dispatchEvent(new Event('change', { bubbles: true }))
                } else {
                    el.value = value
                    el.dispatchEvent(new Event('input', { bubbles: true }))
                    el.dispatchEvent(new Event('change', { bubbles: true }))
                }
                return { success: true }
            }, [action.selector || '', action.value || '', !!action.checked, action.confirmedSensitive === true])

        case 'wait':
            await new Promise(r => setTimeout(r, Math.min(Number(action.duration) || 1000, 30000)))
            return { success: true }

        case 'screenshot':
            return { success: true, dataUrl: await takeScreenshot(tab.id) }

        case 'read_page':
        case 'get_page_text':
            return await getPageText(tab.id)

        case 'find':
            return await execFunc(tab.id, (selector) => {
                const elements = document.querySelectorAll(selector)
                return {
                    success: true,
                    count: elements.length,
                    elements: Array.from(elements).slice(0, 20).map((el, i) => ({
                        index: i,
                        tag: el.tagName.toLowerCase(),
                        text: el.textContent?.trim().substring(0, 100) || '',
                        id: el.id || '',
                        className: typeof el.className === 'string' ? el.className : ''
                    }))
                }
            }, [action.selector || ''])

        case 'tabs_create':
        case 'new_tab': {
            if (action.url) {
                const refused = await checkNavigationTarget(action.url)
                if (refused) return refused
            }
            const created = await chrome.tabs.create({ url: action.url || 'about:blank' })
            if (tab.id) {
                const ensuredGroup = await ensureTabGroup(tab.id)
                if (ensuredGroup.groupId) {
                    await addTabToGroup(created.id, ensuredGroup.groupId)
                }
            }
            if (action.url && action.type === 'new_tab') {
                await waitForTabComplete(created.id, 10000)
            }
            return { success: true, tabId: created.id }
        }

        case 'select_tab':
            if (agentTabGroupId) {
                const groupInfo = await listGroupTabs(tab.id)
                const allowed = groupInfo.tabs.some(groupTab => groupTab.id === action.targetTabId)
                if (!allowed) {
                    return fail(ERR.TAB_NOT_IN_GROUP, 'That tab is not in the current agent tab group')
                }
            }
            await chrome.tabs.update(action.targetTabId, { active: true })
            return { success: true }

        case 'list_tabs':
            return { success: true, ...(await listGroupTabs(tab.id)) }

        case 'resize_window':
            await chrome.windows.update(tab.windowId, {
                width: Number(action.width) || 1280,
                height: Number(action.height) || 720
            })
            return { success: true }

        case 'zoom':
            await chrome.tabs.setZoom(tab.id, Number(action.level) || 1.0)
            return { success: true }

        case 'execute_js':
            // The one action that has to run in the page's own world: it is the model asking
            // to evaluate arbitrary code there. Everything else stays isolated so the page
            // cannot lie to the agent by patching DOM APIs.
            return await execFunc(tab.id, (code) => {
                return new Function(`return (${code})`)()
            }, [action.code || ''], 'MAIN')

        case 'click_ref':
            return await sendToTab(tab.id, {
                type: 'CLICK_ELEMENT_BY_REF',
                refId: action.ref,
                clickType: action.clickType || 'left'
            })

        case 'type_ref':
            return await sendToTab(tab.id, {
                type: 'TYPE_IN_ELEMENT_BY_REF',
                refId: action.ref,
                text: action.text || '',
                clear: action.clear !== false,
                confirmed: action.confirmedSensitive === true
            })

        case 'hover_ref':
            return await sendToTab(tab.id, {
                type: 'HOVER_ELEMENT_BY_REF',
                refId: action.ref
            })

        case 'read_page_content':
            return await sendToTab(tab.id, {
                type: 'GET_PAGE_CONTENT',
                filter: action.filter || 'interactive',
                maxLength: Number(action.maxLength) || 30000
            })

        case 'cdp_click':
            await cdpMouseEvent(tab.id, 'click', action.x, action.y, action.button || 'left', action.clickCount || 1)
            return { success: true }

        case 'cdp_type': {
            // Input.insertText goes to whatever has focus, so that element is what is checked.
            if (action.confirmedSensitive !== true) {
                const focused = await execFunc(tab.id, () => {
                    const el = document.activeElement
                    if (!el || el === document.body) return { sensitive: false }
                    const type = String(el.type || '').toLowerCase()
                    const autocomplete = String(el.getAttribute?.('autocomplete') || '').toLowerCase()
                    const nameId = `${el.name || ''} ${el.id || ''}`.toLowerCase()
                    const sensitive = type === 'password' || /^cc-|password|one-time-code/.test(autocomplete) || /passw|secret|token|cvv|card/.test(nameId)
                    const label = el.labels?.[0]?.textContent?.trim() || el.getAttribute?.('aria-label') || el.placeholder || el.name || el.id || type
                    return { sensitive, field: String(label).slice(0, 80) }
                }, [])
                if (focused && focused.sensitive) {
                    return fail(ERR.SENSITIVE_FIELD, 'The focused field looks like a password or card field; the user has to confirm', { field: focused.field })
                }
            }
            await cdpTypeText(tab.id, action.text || '')
            return { success: true }
        }

        case 'cdp_key':
            await cdpKeyEvent(tab.id, action.key, action.modifiers || 0)
            return { success: true }

        case 'cdp_drag':
            await cdpMouseEvent(tab.id, 'drag', action.startX, action.startY)
            await new Promise(r => setTimeout(r, 100))
            await cdpMouseEvent(tab.id, 'move', action.endX, action.endY)
            await new Promise(r => setTimeout(r, 50))
            await cdpMouseEvent(tab.id, 'drop', action.endX, action.endY)
            return { success: true }

        case 'read_console':
            return {
                success: true,
                messages: (consoleMessages.get(tab.id) || []).filter(m =>
                    matchesPattern(`${m.level} ${m.text} ${m.url}`, action.pattern)
                    && (!action.level || String(m.level).toLowerCase() === String(action.level).toLowerCase()))
            }

        case 'read_network': {
            const requests = (networkRequests.get(tab.id) || [])
                .filter(r => matchesPattern(`${r.method} ${r.url} ${r.status || ''} ${r.mimeType || ''}`, action.pattern))
                .map(r => ({ ...r }))
            // Bodies on request only, for the last few matches: the debugger has to still be
            // attached, and Chrome keeps a body only while the page does.
            if (action.includeBody && debuggerAttached.has(tab.id)) {
                for (const r of requests.slice(-5)) {
                    try {
                        const body = await chrome.debugger.sendCommand({ tabId: tab.id }, 'Network.getResponseBody', { requestId: r.id })
                        r.body = body.base64Encoded ? `[binary body, ${Math.round(body.body.length * 3 / 4)} bytes]` : String(body.body).slice(0, 16000)
                    } catch (e) {
                        r.body = `[body unavailable: ${e.message}]`
                    }
                }
            }
            return { success: true, requests }
        }

        default:
            return fail(ERR.UNKNOWN_ACTION, `Unknown action type: ${action.type}`)
    }
}

/** Resolves when the tab reports `complete`, or after `timeoutMs`. Checks first: the event may already have fired. */
async function waitForTabComplete(tabId, timeoutMs) {
    try {
        const current = await chrome.tabs.get(tabId)
        if (current.status === 'complete') {
            // A navigation that was just requested may still report the old page as complete;
            // give it a beat to switch to `loading` before trusting that.
            await new Promise(r => setTimeout(r, 150))
            const again = await chrome.tabs.get(tabId)
            if (again.status === 'complete') return
        }
    } catch (_) {
        return
    }
    await new Promise(resolve => {
        const done = () => {
            chrome.tabs.onUpdated.removeListener(listener)
            clearTimeout(timer)
            resolve()
        }
        const listener = (id, changeInfo) => {
            if (id === tabId && changeInfo.status === 'complete') done()
        }
        chrome.tabs.onUpdated.addListener(listener)
        const timer = setTimeout(done, timeoutMs)
    })
}

async function takeScreenshot(tabId) {
    const tab = await resolveTab(tabId)
    if (!tab) throw Object.assign(new Error('No tab'), { code: ERR.NO_TAB })
    // captureVisibleTab photographs the tab the window is showing. Switching to the target
    // first used to steal the user's focus mid-task; now the model is told to select_tab.
    if (!tab.active) {
        throw Object.assign(new Error('That tab is not the visible one; select_tab first'), { code: ERR.NOT_VISIBLE })
    }
    const settings = await getSettings()
    const quality = Math.min(100, Math.max(10, Number(settings.screenshotQuality) || 80))
    // JPEG: the quality setting means something, and the base64 that travels through the
    // message channel and up to the gateway is a fraction of the PNG.
    return await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality })
}

async function attachDebugger(tabId) {
    if (debuggerAttached.has(tabId)) return
    try {
        await chrome.debugger.attach({ tabId }, '1.3')
    } catch (e) {
        // Already attached by an earlier worker instance: that session still works.
        if (!/already attached/i.test(e.message || '')) throw e
    }
    debuggerAttached.set(tabId, true)
}

async function detachDebugger(tabId) {
    if (!debuggerAttached.has(tabId)) return
    try {
        await chrome.debugger.detach({ tabId })
    } catch (_) { }
    debuggerAttached.delete(tabId)
}

// ---------------------------------------------------------------------------------------------
// Tab group state
// ---------------------------------------------------------------------------------------------

async function ensureTabGroupStateLoaded() {
    if (tabGroupStateLoaded) return

    const stored = await chrome.storage.local.get(TAB_GROUP_STATE_KEY)
    const state = stored[TAB_GROUP_STATE_KEY]
    tabGroupStateLoaded = true

    if (!state || state.groupId === null || state.groupId === undefined) {
        return
    }

    agentGroupState = {
        mainTabId: state.mainTabId || null,
        title: state.title || AGENT_GROUP_BASE_TITLE,
        status: state.status || 'idle',
        lastActiveTabId: state.lastActiveTabId || null
    }

    try {
        await syncAgentTabGroup(state.groupId)
    } catch (_) {
        await clearAgentTabGroupState()
    }
}

async function saveAgentTabGroupState() {
    await chrome.storage.local.set({
        [TAB_GROUP_STATE_KEY]: {
            groupId: agentTabGroupId,
            tabIds: Array.from(agentTabs.keys()),
            mainTabId: agentGroupState.mainTabId,
            title: agentGroupState.title,
            status: agentGroupState.status,
            lastActiveTabId: agentGroupState.lastActiveTabId
        }
    })
}

async function clearAgentTabGroupState() {
    agentTabGroupId = null
    agentTabs.clear()
    agentGroupState = {
        mainTabId: null,
        title: AGENT_GROUP_BASE_TITLE,
        status: 'idle',
        lastActiveTabId: null
    }
    await chrome.storage.local.remove(TAB_GROUP_STATE_KEY)
}

async function syncAgentTabGroup(groupId) {
    const tabs = await chrome.tabs.query({ groupId })

    if (!tabs.length) {
        await clearAgentTabGroupState()
        return []
    }

    agentTabGroupId = groupId
    agentTabs = new Map(tabs.filter(tab => tab.id).map(tab => [tab.id, true]))
    if (!agentGroupState.mainTabId || !agentTabs.has(agentGroupState.mainTabId)) {
        const activeTab = tabs.find(tab => tab.active && tab.id)
        agentGroupState.mainTabId = activeTab?.id || tabs[0]?.id || null
    }
    if (!agentGroupState.lastActiveTabId || !agentTabs.has(agentGroupState.lastActiveTabId)) {
        agentGroupState.lastActiveTabId = tabs.find(tab => tab.active)?.id || agentGroupState.mainTabId
    }
    await updateChromeTabGroupVisuals()
    await saveAgentTabGroupState()
    return tabs
}

async function ensureTabGroup(tabId, title = AGENT_GROUP_BASE_TITLE) {
    await ensureTabGroupStateLoaded()

    const settings = await getSettings()
    if (settings.tabGroupEnabled === false) {
        return { groupId: null, tabIds: [tabId] }
    }

    const tab = await chrome.tabs.get(tabId)
    if (!tab) {
        throw Object.assign(new Error('No tab'), { code: ERR.NO_TAB })
    }

    if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
        const tabs = await syncAgentTabGroup(tab.groupId)
        agentGroupState.mainTabId = tab.id
        agentGroupState.lastActiveTabId = tab.id
        agentGroupState.title = title || AGENT_GROUP_BASE_TITLE

        try {
            await updateChromeTabGroupVisuals()
        } catch (_) { }

        return {
            groupId: tab.groupId,
            tabIds: tabs.map(groupTab => groupTab.id).filter(Boolean)
        }
    }

    const groupId = await createTabGroup([tabId], title)
    return { groupId, tabIds: [tabId] }
}

async function createTabGroup(tabIds, title) {
    await ensureTabGroupStateLoaded()

    const validTabIds = (tabIds || []).filter(Boolean)
    if (!validTabIds.length) {
        throw new Error('No tabs to group')
    }

    const groupId = await chrome.tabs.group({ tabIds: validTabIds })
    agentGroupState.mainTabId = validTabIds[0] || null
    agentGroupState.lastActiveTabId = validTabIds[0] || null
    agentGroupState.title = title || AGENT_GROUP_BASE_TITLE
    agentGroupState.status = 'idle'
    await syncAgentTabGroup(groupId)
    return groupId
}

async function addTabToGroup(tabId, groupId = null) {
    await ensureTabGroupStateLoaded()

    const targetGroupId = groupId ?? agentTabGroupId
    if (targetGroupId === null || targetGroupId === undefined) {
        return await createTabGroup([tabId], AGENT_GROUP_BASE_TITLE)
    }

    await chrome.tabs.group({ tabIds: [tabId], groupId: targetGroupId })
    await syncAgentTabGroup(targetGroupId)
    return targetGroupId
}

async function listGroupTabs(tabId = null) {
    await ensureTabGroupStateLoaded()

    let groupId = agentTabGroupId
    if (tabId) {
        try {
            const tab = await chrome.tabs.get(tabId)
            if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
                groupId = tab.groupId
            }
        } catch (_) { }
    }

    if (groupId === null || groupId === undefined) {
        return { groupId: null, tabs: [] }
    }

    const tabs = (await chrome.tabs.query({ groupId })).map(t => ({
        id: t.id,
        url: t.url,
        title: t.title,
        active: t.active,
        favIconUrl: t.favIconUrl
    }))

    if (tabs.length) {
        await syncAgentTabGroup(groupId)
    } else if (groupId === agentTabGroupId) {
        await clearAgentTabGroupState()
    }

    return { groupId, tabs }
}

async function updateAgentGroupState(state = {}) {
    await ensureTabGroupStateLoaded()

    if (state.title) {
        agentGroupState.title = state.title
    }
    if (state.status) {
        agentGroupState.status = state.status
    }
    if (state.mainTabId !== undefined) {
        agentGroupState.mainTabId = state.mainTabId
    }
    if (state.lastActiveTabId !== undefined) {
        agentGroupState.lastActiveTabId = state.lastActiveTabId
    }

    await updateChromeTabGroupVisuals()
    await saveAgentTabGroupState()

    return {
        groupId: agentTabGroupId,
        state: { ...agentGroupState }
    }
}

async function updateChromeTabGroupVisuals() {
    if (agentTabGroupId === null || agentTabGroupId === undefined) return

    const baseTitle = (agentGroupState.title || AGENT_GROUP_BASE_TITLE).trim() || AGENT_GROUP_BASE_TITLE
    const prefix = GROUP_STATUS_PREFIX[agentGroupState.status] || ''
    const color = GROUP_STATUS_COLOR[agentGroupState.status] || 'red'

    try {
        await chrome.tabGroups.update(agentTabGroupId, {
            title: `${prefix}${baseTitle}`,
            color,
            collapsed: false
        })
    } catch (_) {
        // The group can vanish between the query and the update.
    }
}

async function handleTrackedTabGroupChange(tabId, nextGroupId) {
    await ensureTabGroupStateLoaded()

    if (!agentTabs.has(tabId) && nextGroupId !== agentTabGroupId) {
        return
    }

    if (nextGroupId === agentTabGroupId) {
        await syncAgentTabGroup(agentTabGroupId)
        return
    }

    if (!agentTabs.has(tabId)) {
        return
    }

    if (tabId === agentGroupState.mainTabId && nextGroupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
        await syncAgentTabGroup(nextGroupId)
        return
    }

    if (tabId === agentGroupState.mainTabId && nextGroupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
        const currentTitle = agentGroupState.title || AGENT_GROUP_BASE_TITLE
        const currentStatus = agentGroupState.status || 'idle'
        const result = await ensureTabGroup(tabId, currentTitle)
        await updateAgentGroupState({
            status: currentStatus,
            mainTabId: tabId,
            lastActiveTabId: tabId
        })
        return result
    }

    agentTabs.delete(tabId)
    if (agentGroupState.lastActiveTabId === tabId) {
        agentGroupState.lastActiveTabId = Array.from(agentTabs.keys())[0] || agentGroupState.mainTabId
    }
    await saveAgentTabGroupState()
}

// ---------------------------------------------------------------------------------------------
// Page access
// ---------------------------------------------------------------------------------------------

async function getPageText(tabId) {
    return await execFunc(tabId, () => {
        return {
            success: true,
            title: document.title,
            url: window.location.href,
            text: document.body?.innerText?.substring(0, 50000) || ''
        }
    }, [])
}

/**
 * Runs `func` in the tab. ISOLATED by default: the page's scripts cannot see or patch what
 * runs there, so a hostile page cannot feed the agent a fake `querySelector`. Only execute_js
 * asks for MAIN.
 */
async function execFunc(tabId, func, args, world = 'ISOLATED') {
    const safeArgs = (args || []).map(v => v === undefined || v === null ? '' : v)
    // A page that has an alert() open never answers; without the deadline the whole run
    // hung on it until the user found and closed the dialog.
    let timer
    const deadline = new Promise(resolve => {
        timer = setTimeout(() => resolve(fail(ERR.TIMEOUT, `The page did not answer within ${EXEC_TIMEOUT_MS / 1000} s; a dialog may be open`)), EXEC_TIMEOUT_MS)
    })
    const results = await Promise.race([
        chrome.scripting.executeScript({ target: { tabId }, func, args: safeArgs, world }),
        deadline
    ]).finally(() => clearTimeout(timer))
    if (results && results.code === ERR.TIMEOUT) return results
    if (!results || !results.length) return fail(ERR.NO_RESULT, 'No result returned')
    const value = results[0].result
    // `0`, `''` and `false` are legitimate results of execute_js; only a missing frame result
    // means the script produced nothing.
    if (value === undefined || value === null) return fail(ERR.NO_RESULT, 'No result returned')
    return value
}

async function ensureContentScripts(tabId) {
    await chrome.scripting.executeScript({
        target: { tabId },
        files: CONTENT_SCRIPTS
    })
}

/** Sends to the tab's content script, injecting it first if the page does not have it yet. */
async function sendToTab(tabId, message) {
    try {
        return await chrome.tabs.sendMessage(tabId, message)
    } catch (e) {
        if (!/Receiving end does not exist|Could not establish connection/i.test(e.message || '')) {
            throw e
        }
    }
    try {
        await ensureContentScripts(tabId)
    } catch (e) {
        return fail(ERR.CONTENT_SCRIPT_UNAVAILABLE, e.message)
    }
    return await chrome.tabs.sendMessage(tabId, message)
}

async function forwardToContentScript(message) {
    const tab = await resolveTab(message.tabId)
    if (!tab) return fail(ERR.NO_TAB, 'No active tab')
    if (isInternalUrl(tab.url)) return fail(ERR.CONTENT_SCRIPT_UNAVAILABLE, 'Internal page')
    const { tabId, ...payload } = message
    const result = await sendToTab(tab.id, payload)
    return result === undefined ? { success: true } : result
}

// ---------------------------------------------------------------------------------------------
// Console / network monitoring through the debugger
// ---------------------------------------------------------------------------------------------

async function startMonitoring(tabId) {
    const tab = await resolveTab(tabId)
    if (!tab) return null
    if (isInternalUrl(tab.url)) return null

    await attachDebugger(tab.id)
    consoleMessages.set(tab.id, [])
    networkRequests.set(tab.id, [])
    dialogs.set(tab.id, [])

    await chrome.debugger.sendCommand({ tabId: tab.id }, 'Console.enable')
    await chrome.debugger.sendCommand({ tabId: tab.id }, 'Network.enable')
    // Page events: the one that matters is javascriptDialogOpening, answered below so an
    // alert() cannot freeze the run.
    try { await chrome.debugger.sendCommand({ tabId: tab.id }, 'Page.enable') } catch (_) { }
    await updateAgentGroupState({
        status: 'running',
        lastActiveTabId: tab.id
    })
    return tab.id
}

async function stopMonitoring(tabId) {
    const tab = await resolveTab(tabId)
    if (!tab) return

    if (debuggerAttached.has(tab.id)) {
        try {
            await chrome.debugger.sendCommand({ tabId: tab.id }, 'Console.disable')
            await chrome.debugger.sendCommand({ tabId: tab.id }, 'Network.disable')
            await chrome.debugger.sendCommand({ tabId: tab.id }, 'Page.disable')
        } catch (_) { }
        // The run is over; Chrome's "is being debugged" bar used to stay until the tab closed.
        await detachDebugger(tab.id)
    }
    consoleMessages.delete(tab.id)
    networkRequests.delete(tab.id)
    dialogs.delete(tab.id)
    await updateAgentGroupState({ status: 'idle' })
}

/**
 * What to answer a dialog the page opened during a run. An alert has only "OK". Everything
 * else is declined: a confirm() the model did not mean to trigger must not delete anything,
 * a prompt() gets no text, and a beforeunload dialog keeps the page (and its unsaved form).
 */
function dialogAnswer(type) {
    return { accept: type === 'alert' }
}

chrome.debugger.onEvent.addListener((source, method, params) => {
    const tabId = source.tabId
    if (method === 'Page.javascriptDialogOpening' && params) {
        const answer = dialogAnswer(params.type)
        chrome.debugger.sendCommand({ tabId }, 'Page.handleJavaScriptDialog', answer).catch(() => { })
        const note = `${params.type || 'dialog'}: ${String(params.message || '').substring(0, 300)} (${answer.accept ? 'dismissed' : 'declined'} automatically)`
        const list = dialogs.get(tabId) || []
        list.push({ type: params.type || 'dialog', message: String(params.message || '').substring(0, 300), accepted: answer.accept, timestamp: Date.now() })
        if (list.length > 20) list.splice(0, list.length - 20)
        dialogs.set(tabId, list)
        const msgs = consoleMessages.get(tabId) || []
        msgs.push({ level: 'dialog', text: note, url: params.url || '', timestamp: Date.now() })
        if (msgs.length > 100) msgs.splice(0, msgs.length - 100)
        consoleMessages.set(tabId, msgs)
    }
    if (method === 'Console.messageAdded' && params?.message) {
        const msgs = consoleMessages.get(tabId) || []
        msgs.push({
            level: params.message.level,
            text: params.message.text?.substring(0, 500) || '',
            url: params.message.url || '',
            timestamp: Date.now()
        })
        if (msgs.length > 100) msgs.splice(0, msgs.length - 100)
        consoleMessages.set(tabId, msgs)
    }
    if (method === 'Network.requestWillBeSent' && params?.request) {
        const reqs = networkRequests.get(tabId) || []
        reqs.push({
            id: params.requestId,
            method: params.request.method,
            url: params.request.url?.substring(0, 300) || '',
            type: params.type || '',
            timestamp: Date.now()
        })
        if (reqs.length > 100) reqs.splice(0, reqs.length - 100)
        networkRequests.set(tabId, reqs)
    }
    if (method === 'Network.responseReceived' && params?.response) {
        const reqs = networkRequests.get(tabId) || []
        const req = reqs.find(r => r.id === params.requestId)
        if (req) {
            req.status = params.response.status
            req.mimeType = params.response.mimeType || ''
        }
    }
})

// ---------------------------------------------------------------------------------------------
// Input through the DevTools protocol
// ---------------------------------------------------------------------------------------------

async function cdpMouseEvent(tabId, eventType, x, y, button = 'left', clickCount = 1) {
    const tab = await resolveTab(tabId)
    if (!tab) return

    await attachDebugger(tab.id)
    const buttonMap = { left: 0, middle: 1, right: 2 }
    const btnNum = buttonMap[button] || 0
    x = Number(x) || 0
    y = Number(y) || 0

    if (eventType === 'click') {
        await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchMouseEvent', {
            type: 'mousePressed', x, y, button, clickCount, buttons: 1 << btnNum
        })
        await new Promise(r => setTimeout(r, 50))
        await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchMouseEvent', {
            type: 'mouseReleased', x, y, button, clickCount, buttons: 0
        })
    } else if (eventType === 'move') {
        await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchMouseEvent', {
            type: 'mouseMoved', x, y
        })
    } else if (eventType === 'drag') {
        await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchMouseEvent', {
            type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1
        })
    } else if (eventType === 'drop') {
        await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchMouseEvent', {
            type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0
        })
    }
}

const KEY_MAP = {
    'Enter': { key: 'Enter', code: 'Enter', keyCode: 13 },
    'Tab': { key: 'Tab', code: 'Tab', keyCode: 9 },
    'Escape': { key: 'Escape', code: 'Escape', keyCode: 27 },
    'Backspace': { key: 'Backspace', code: 'Backspace', keyCode: 8 },
    'Delete': { key: 'Delete', code: 'Delete', keyCode: 46 },
    'ArrowUp': { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
    'ArrowDown': { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
    'ArrowLeft': { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
    'ArrowRight': { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
    'Home': { key: 'Home', code: 'Home', keyCode: 36 },
    'End': { key: 'End', code: 'End', keyCode: 35 },
    'PageUp': { key: 'PageUp', code: 'PageUp', keyCode: 33 },
    'PageDown': { key: 'PageDown', code: 'PageDown', keyCode: 34 },
    'Space': { key: ' ', code: 'Space', keyCode: 32 },
    ' ': { key: ' ', code: 'Space', keyCode: 32 },
    'Shift': { key: 'Shift', code: 'ShiftLeft', keyCode: 16 },
    'Control': { key: 'Control', code: 'ControlLeft', keyCode: 17 },
    'Alt': { key: 'Alt', code: 'AltLeft', keyCode: 18 },
    'Meta': { key: 'Meta', code: 'MetaLeft', keyCode: 91 },
    'Insert': { key: 'Insert', code: 'Insert', keyCode: 45 },
    'CapsLock': { key: 'CapsLock', code: 'CapsLock', keyCode: 20 }
}

/**
 * Turns a key name into what Input.dispatchKeyEvent wants. Pure; unit-tested. Letters get
 * `KeyA`/65 (the virtual key code is the upper-case one whatever the case typed), digits
 * `Digit1`/49, function keys `F5`/116.
 */
function mapKey(key) {
    if (typeof key !== 'string' || key === '') return { key: '', code: '', keyCode: 0 }
    if (KEY_MAP[key]) return KEY_MAP[key]
    if (key.length === 1) {
        if (/[a-z]/i.test(key)) {
            const upper = key.toUpperCase()
            return { key, code: `Key${upper}`, keyCode: upper.charCodeAt(0) }
        }
        if (/[0-9]/.test(key)) return { key, code: `Digit${key}`, keyCode: key.charCodeAt(0) }
        return { key, code: '', keyCode: key.toUpperCase().charCodeAt(0) }
    }
    const fn = /^F([1-9]|1[0-9]|2[0-4])$/.exec(key)
    if (fn) return { key, code: key, keyCode: 111 + Number(fn[1]) }
    return { key, code: key, keyCode: 0 }
}

async function cdpKeyEvent(tabId, key, modifiers = 0) {
    const tab = await resolveTab(tabId)
    if (!tab) return

    await attachDebugger(tab.id)
    const mapped = mapKey(key)
    const base = {
        key: mapped.key,
        code: mapped.code,
        windowsVirtualKeyCode: mapped.keyCode,
        nativeVirtualKeyCode: mapped.keyCode,
        modifiers: Number(modifiers) || 0
    }
    // Printable characters carry `text`, otherwise the page sees the key but no character.
    if (mapped.key.length === 1 && base.modifiers === 0) base.text = mapped.key

    await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchKeyEvent', { type: 'keyDown', ...base })
    await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base })
}

async function cdpTypeText(tabId, text) {
    const tab = await resolveTab(tabId)
    if (!tab) return

    await attachDebugger(tab.id)
    await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.insertText', { text: String(text) })
}

// ---------------------------------------------------------------------------------------------
// Opening the panel
// ---------------------------------------------------------------------------------------------

async function openAgentForCurrentTab(preferredTabId = null) {
    let tab = null

    if (preferredTabId) {
        try {
            tab = await chrome.tabs.get(preferredTabId)
        } catch (_) { }
    }

    if (!tab) {
        ;[tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    }

    if (!tab || !tab.id) {
        throw Object.assign(new Error('No active tab'), { code: ERR.NO_TAB })
    }

    await openAgentForTab(tab.id)
}

async function openAgentForTab(tabId) {
    const tab = await chrome.tabs.get(tabId)
    if (!tab || !tab.id) {
        throw Object.assign(new Error('No tab'), { code: ERR.NO_TAB })
    }

    try {
        await ensureTabGroup(tab.id, AGENT_GROUP_BASE_TITLE)
    } catch (_) { }

    await chrome.sidePanel.setOptions({
        tabId: tab.id,
        path: 'sidepanel.html',
        enabled: true
    })

    await chrome.sidePanel.open({ tabId: tab.id })
}

// Exposed for the unit tests, which load this file into a vm context with a stubbed `chrome`.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { isBlockedSite, isFinancialSite, hostMatches, isHttpUrl, matchesPattern, dialogAnswer, mapKey, ERR }
}
