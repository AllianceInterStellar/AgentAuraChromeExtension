const BLOCKED_PATTERNS = [
    /^https?:\/\/(www\.)?bank/i,
    /^https?:\/\/.*\.gov\//i,
    /^https?:\/\/accounts\.google\.com/i,
    /^https?:\/\/login\./i,
    /^https?:\/\/.*\/auth\//i,
    /^https?:\/\/.*\/oauth/i,
    /chrome:\/\//i,
    /chrome-extension:\/\//i,
    /^about:/i
]

const TAB_GROUP_STATE_KEY = 'agent_tab_group_state'
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

let agentTabGroupId = null
let agentTabs = new Map()
let debuggerAttached = new Map()
let consoleMessages = new Map()
let networkRequests = new Map()
let tabGroupStateLoaded = false
let agentGroupState = {
    mainTabId: null,
    title: AGENT_GROUP_BASE_TITLE,
    status: 'idle',
    lastActiveTabId: null
}

chrome.runtime.onInstalled.addListener(async () => {
    await chrome.storage.local.set({
        agent_permission_mode: 'ask',
        agent_shortcuts: [],
        agent_scheduled_tasks: [],
        agent_history: [],
        agent_settings: {
            blockedSitesEnabled: true,
            screenshotQuality: 80,
            maxSteps: 50,
            tabGroupEnabled: true
        }
    })

    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
})

chrome.action.onClicked.addListener(async (tab) => {
    try {
        if (tab && tab.id) {
            await openAgentForTab(tab.id)
            return
        }

        await openAgentForCurrentTab()
    } catch (e) {
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: 'AgentAura',
            message: e.message || '打开智能体失败'
        })
    }
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
        case 'GET_AUTH_TOKEN':
            chrome.storage.local.get('auth_id_token', (result) => {
                sendResponse({ token: result.auth_id_token || null })
            })
            return true

        case 'OPEN_SIDE_PANEL':
            openAgentForCurrentTab(sender.tab?.id).then(() => {
                sendResponse({ success: true })
            }).catch(err => {
                sendResponse({ success: false, error: err.message })
            })
            return true

        case 'AGENT_EXECUTE_ACTION':
            handleAgentAction(message.action, message.tabId, sender).then(result => {
                sendResponse(result)
            }).catch(err => {
                sendResponse({ success: false, error: err.message })
            })
            return true

        case 'AGENT_TAKE_SCREENSHOT':
            takeScreenshot(message.tabId).then(dataUrl => {
                sendResponse({ success: true, dataUrl })
            }).catch(err => {
                sendResponse({ success: false, error: err.message })
            })
            return true

        case 'AGENT_ATTACH_DEBUGGER':
            attachDebugger(message.tabId).then(() => {
                sendResponse({ success: true })
            }).catch(err => {
                sendResponse({ success: false, error: err.message })
            })
            return true

        case 'AGENT_DETACH_DEBUGGER':
            detachDebugger(message.tabId).then(() => {
                sendResponse({ success: true })
            }).catch(err => {
                sendResponse({ success: false, error: err.message })
            })
            return true

        case 'AGENT_CDP_COMMAND':
            executeCDP(message.tabId, message.method, message.params).then(result => {
                sendResponse({ success: true, result })
            }).catch(err => {
                sendResponse({ success: false, error: err.message })
            })
            return true

        case 'TAB_GROUP_CREATE':
            createTabGroup(message.tabIds, message.title).then(groupId => {
                sendResponse({ success: true, groupId })
            }).catch(err => {
                sendResponse({ success: false, error: err.message })
            })
            return true

        case 'TAB_GROUP_ENSURE':
            ensureTabGroup(message.tabId, message.title).then(result => {
                sendResponse({ success: true, ...result })
            }).catch(err => {
                sendResponse({ success: false, error: err.message })
            })
            return true

        case 'TAB_GROUP_ADD':
            addTabToGroup(message.tabId, message.groupId).then(groupId => {
                sendResponse({ success: true, groupId })
            }).catch(err => {
                sendResponse({ success: false, error: err.message })
            })
            return true

        case 'TAB_GROUP_LIST':
            listGroupTabs(message.tabId).then(result => {
                sendResponse({ success: true, ...result })
            }).catch(err => {
                sendResponse({ success: false, error: err.message })
            })
            return true

        case 'AGENT_GROUP_STATUS':
            updateAgentGroupState(message.state || {}).then(result => {
                sendResponse({ success: true, ...result })
            }).catch(err => {
                sendResponse({ success: false, error: err.message })
            })
            return true

        case 'AGENT_GET_PAGE_TEXT':
            getPageText(message.tabId).then(text => {
                sendResponse({ success: true, text })
            }).catch(err => {
                sendResponse({ success: false, error: err.message })
            })
            return true

        case 'AGENT_EXECUTE_JS':
            execFunc(message.tabId, (code) => {
                return new Function(`return (${code})`)()
            }, [message.code || '']).then(result => {
                sendResponse({ success: true, result })
            }).catch(err => {
                sendResponse({ success: false, error: err.message })
            })
            return true

        case 'AGENT_READ_CONSOLE':
            sendResponse({ success: true, messages: consoleMessages.get(message.tabId) || [] })
            return true

        case 'AGENT_READ_NETWORK':
            sendResponse({ success: true, requests: networkRequests.get(message.tabId) || [] })
            return true

        case 'AGENT_START_MONITORING':
            startMonitoring(message.tabId).then(() => {
                sendResponse({ success: true })
            }).catch(err => {
                sendResponse({ success: false, error: err.message })
            })
            return true

        case 'AGENT_STOP_MONITORING':
            stopMonitoring(message.tabId).then(() => {
                sendResponse({ success: true })
            }).catch(err => {
                sendResponse({ success: false, error: err.message })
            })
            return true

        case 'AGENT_CDP_MOUSE':
            cdpMouseEvent(message.tabId, message.eventType, message.x, message.y, message.button, message.clickCount).then(() => {
                sendResponse({ success: true })
            }).catch(err => {
                sendResponse({ success: false, error: err.message })
            })
            return true

        case 'AGENT_CDP_KEY':
            cdpKeyEvent(message.tabId, message.key, message.modifiers).then(() => {
                sendResponse({ success: true })
            }).catch(err => {
                sendResponse({ success: false, error: err.message })
            })
            return true

        case 'AGENT_CDP_TYPE':
            cdpTypeText(message.tabId, message.text).then(() => {
                sendResponse({ success: true })
            }).catch(err => {
                sendResponse({ success: false, error: err.message })
            })
            return true

        case 'CLICK_ELEMENT_BY_REF':
        case 'TYPE_IN_ELEMENT_BY_REF':
        case 'HOVER_ELEMENT_BY_REF':
        case 'GET_PAGE_CONTENT':
        case 'GET_ELEMENT_RECT':
            forwardToContentScript(message).then(result => {
                sendResponse(result)
            }).catch(err => {
                sendResponse({ success: false, error: err.message })
            })
            return true

        case 'EXPORT_CONVERSATION':
            exportConversation(message.data).then(() => {
                sendResponse({ success: true })
            }).catch(err => {
                sendResponse({ success: false, error: err.message })
            })
            return true

        case 'CHECK_BLOCKED_SITE':
            sendResponse({ blocked: isBlockedSite(message.url) })
            return true

        case 'AGENT_NOTIFY':
            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'icons/icon128.png',
                title: message.title || 'AgentAura',
                message: message.message || ''
            })
            sendResponse({ success: true })
            return true
    }
})

chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'toggle-agent') {
        await openAgentForCurrentTab()
    }
})

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name.startsWith('scheduled_task_')) {
        const taskId = alarm.name.replace('scheduled_task_', '')
        const stored = await chrome.storage.local.get('agent_scheduled_tasks')
        const tasks = stored.agent_scheduled_tasks || []
        const task = tasks.find(t => t.id === taskId)
        if (task && task.enabled) {
            task.lastRun = Date.now()
            task.runCount = (task.runCount || 0) + 1
            await chrome.storage.local.set({ agent_scheduled_tasks: tasks })
            await executeScheduledTask(task)
        }
    }
})

chrome.tabs.onRemoved.addListener((tabId) => {
    agentTabs.delete(tabId)
    if (debuggerAttached.has(tabId)) {
        debuggerAttached.delete(tabId)
    }

    if (tabId === agentGroupState.mainTabId) {
        const firstRemainingTabId = Array.from(agentTabs.keys())[0] || null
        agentGroupState.mainTabId = firstRemainingTabId
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

chrome.tabGroups.onRemoved.addListener((group) => {
    if (group.id === agentTabGroupId) {
        clearAgentTabGroupState().catch(() => { })
    }
})

function isBlockedSite(url) {
    if (!url) return false
    return BLOCKED_PATTERNS.some(pattern => pattern.test(url))
}

async function handleAgentAction(action, tabId, sender) {
    await ensureTabGroupStateLoaded()
    const tab = tabId ? await chrome.tabs.get(tabId) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
    if (!tab) return { success: false, error: '没有活跃标签页' }

    if (isBlockedSite(tab.url)) {
        return { success: false, error: '此站点因安全原因被禁止操作' }
    }

    switch (action.type) {
        case 'click':
            return await execFunc(tab.id, (selector) => {
                const el = document.querySelector(selector)
                if (!el) return { success: false, error: '未找到元素' }
                el.click()
                return { success: true }
            }, [action.selector || ''])

        case 'type':
            return await execFunc(tab.id, (selector, text) => {
                const el = document.querySelector(selector)
                if (!el) return { success: false, error: '未找到元素' }
                el.focus()
                el.value = ''
                el.value = text
                el.dispatchEvent(new Event('input', { bubbles: true }))
                el.dispatchEvent(new Event('change', { bubbles: true }))
                return { success: true }
            }, [action.selector || '', action.text || ''])

        case 'navigate':
            await chrome.tabs.update(tab.id, { url: action.url })
            await new Promise(resolve => {
                const listener = (tabId, changeInfo) => {
                    if (tabId === tab.id && changeInfo.status === 'complete') {
                        chrome.tabs.onUpdated.removeListener(listener)
                        resolve()
                    }
                }
                chrome.tabs.onUpdated.addListener(listener)
                setTimeout(() => {
                    chrome.tabs.onUpdated.removeListener(listener)
                    resolve()
                }, 10000)
            })
            return { success: true }

        case 'scroll':
            return await execFunc(tab.id, (dir, amount) => {
                if (dir === 'down') window.scrollBy(0, amount)
                else if (dir === 'up') window.scrollBy(0, -amount)
                else if (dir === 'left') window.scrollBy(-amount, 0)
                else if (dir === 'right') window.scrollBy(amount, 0)
                return { success: true }
            }, [action.direction || 'down', action.amount || 300])

        case 'form_input':
            return await execFunc(tab.id, (selector, value, checked) => {
                const el = document.querySelector(selector)
                if (!el) return { success: false, error: '未找到元素' }
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
            }, [action.selector || '', action.value || '', !!action.checked])

        case 'wait':
            await new Promise(r => setTimeout(r, action.duration || 1000))
            return { success: true }

        case 'screenshot':
            return { success: true, dataUrl: await takeScreenshot(tab.id) }

        case 'read_page':
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
                        className: el.className || ''
                    }))
                }
            }, [action.selector || ''])

        case 'tabs_create':
            const newTab = await chrome.tabs.create({ url: action.url || 'about:blank' })
            if (tab.id) {
                const ensuredGroup = await ensureTabGroup(tab.id)
                if (ensuredGroup.groupId) {
                    await addTabToGroup(newTab.id, ensuredGroup.groupId)
                }
            }
            return { success: true, tabId: newTab.id }

        case 'select_tab':
            if (agentTabGroupId) {
                const groupInfo = await listGroupTabs(tab.id)
                const allowed = groupInfo.tabs.some(groupTab => groupTab.id === action.targetTabId)
                if (!allowed) {
                    return { success: false, error: '目标标签页不在当前智能体分组中' }
                }
            }
            await chrome.tabs.update(action.targetTabId, { active: true })
            return { success: true }

        case 'list_tabs':
            return { success: true, ...(await listGroupTabs(tab.id)) }

        case 'new_tab':
            const created = await chrome.tabs.create({ url: action.url })
            if (tab.id) {
                const ensuredGroup = await ensureTabGroup(tab.id)
                if (ensuredGroup.groupId) {
                    await addTabToGroup(created.id, ensuredGroup.groupId)
                }
            }
            await new Promise(resolve => {
                const listener = (tabId, changeInfo) => {
                    if (tabId === created.id && changeInfo.status === 'complete') {
                        chrome.tabs.onUpdated.removeListener(listener)
                        resolve()
                    }
                }
                chrome.tabs.onUpdated.addListener(listener)
                setTimeout(() => {
                    chrome.tabs.onUpdated.removeListener(listener)
                    resolve()
                }, 10000)
            })
            return { success: true, tabId: created.id }

        case 'resize_window':
            await chrome.windows.update(tab.windowId, {
                width: action.width || 1280,
                height: action.height || 720
            })
            return { success: true }

        case 'zoom':
            await chrome.tabs.setZoom(tab.id, action.level || 1.0)
            return { success: true }

        case 'get_page_text':
            return await getPageText(tab.id)

        case 'execute_js':
            return await execFunc(tab.id, (code) => {
                return new Function(`return (${code})`)()
            }, [action.code || ''])

        case 'click_ref':
            return await chrome.tabs.sendMessage(tab.id, {
                type: 'CLICK_ELEMENT_BY_REF',
                refId: action.ref,
                clickType: action.clickType || 'left'
            })

        case 'type_ref':
            return await chrome.tabs.sendMessage(tab.id, {
                type: 'TYPE_IN_ELEMENT_BY_REF',
                refId: action.ref,
                text: action.text || '',
                clear: action.clear !== false
            })

        case 'hover_ref':
            return await chrome.tabs.sendMessage(tab.id, {
                type: 'HOVER_ELEMENT_BY_REF',
                refId: action.ref
            })

        case 'read_page_content':
            return await chrome.tabs.sendMessage(tab.id, {
                type: 'GET_PAGE_CONTENT',
                filter: action.filter || 'interactive',
                maxLength: action.maxLength || 30000
            })

        case 'cdp_click':
            await cdpMouseEvent(tab.id, 'click', action.x, action.y, action.button || 'left', action.clickCount || 1)
            return { success: true }

        case 'cdp_type':
            await cdpTypeText(tab.id, action.text || '')
            return { success: true }

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
            return { success: true, messages: consoleMessages.get(tab.id) || [] }

        case 'read_network':
            return { success: true, requests: networkRequests.get(tab.id) || [] }

        default:
            return { success: false, error: `未知操作类型: ${action.type}` }
    }
}

async function takeScreenshot(tabId) {
    const tab = tabId ? await chrome.tabs.get(tabId) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
    if (!tab) throw new Error('没有标签页')
    await chrome.tabs.update(tab.id, { active: true })
    await new Promise(r => setTimeout(r, 200))
    return await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png', quality: 80 })
}

async function attachDebugger(tabId) {
    if (debuggerAttached.has(tabId)) return
    await chrome.debugger.attach({ tabId }, '1.3')
    debuggerAttached.set(tabId, true)
}

async function detachDebugger(tabId) {
    if (!debuggerAttached.has(tabId)) return
    await chrome.debugger.detach({ tabId })
    debuggerAttached.delete(tabId)
}

async function executeCDP(tabId, method, params = {}) {
    if (!debuggerAttached.has(tabId)) {
        await attachDebugger(tabId)
    }
    return await chrome.debugger.sendCommand({ tabId }, method, params)
}

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

async function ensureTabGroup(tabId, title = 'AgentAura') {
    await ensureTabGroupStateLoaded()

    const tab = await chrome.tabs.get(tabId)
    if (!tab) {
        throw new Error('没有标签页')
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

    const validTabIds = tabIds.filter(Boolean)
    if (!validTabIds.length) {
        throw new Error('没有可分组的标签页')
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
        return await createTabGroup([tabId], 'AgentAura')
    }

    await chrome.tabs.group({ tabIds: [tabId], groupId: targetGroupId })
    await syncAgentTabGroup(targetGroupId)
    return targetGroupId
}

async function listGroupTabs(tabId = null) {
    await ensureTabGroupStateLoaded()

    let groupId = agentTabGroupId
    if (tabId) {
        const tab = await chrome.tabs.get(tabId)
        if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
            groupId = tab.groupId
        }
    }

    if (groupId === null || groupId === undefined) {
        return { groupId: null, tabs: [] }
    }

    const allTabs = await chrome.tabs.query({})
    const tabs = allTabs
        .filter(t => t.groupId === groupId)
        .map(t => ({
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

    await chrome.tabGroups.update(agentTabGroupId, {
        title: `${prefix}${baseTitle}`,
        color,
        collapsed: false
    })
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

async function execFunc(tabId, func, args) {
    const safeArgs = (args || []).map(v => v === undefined || v === null ? '' : v)
    const results = await chrome.scripting.executeScript({
        target: { tabId },
        func,
        args: safeArgs,
        world: 'MAIN'
    })
    return results[0]?.result || { success: false, error: '无返回结果' }
}

async function exportConversation(data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    await chrome.downloads.download({
        url,
        filename: `agentaura-conversation-${Date.now()}.json`,
        saveAs: true
    })
}

function escapeCSSSelector(selector) {
    if (!selector) return ''
    return selector.replace(/'/g, "\\'").replace(/\\/g, '\\\\')
}

async function forwardToContentScript(message) {
    const tab = message.tabId
        ? await chrome.tabs.get(message.tabId)
        : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
    if (!tab) return { success: false, error: '没有活跃标签页' }
    return await chrome.tabs.sendMessage(tab.id, message)
}

async function startMonitoring(tabId) {
    const tab = tabId
        ? await chrome.tabs.get(tabId)
        : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
    if (!tab) return

    await attachDebugger(tab.id)
    consoleMessages.set(tab.id, [])
    networkRequests.set(tab.id, [])

    await chrome.debugger.sendCommand({ tabId: tab.id }, 'Console.enable')
    await chrome.debugger.sendCommand({ tabId: tab.id }, 'Network.enable')
    await updateAgentGroupState({
        status: 'running',
        lastActiveTabId: tab.id
    })
}

async function stopMonitoring(tabId) {
    const tab = tabId
        ? await chrome.tabs.get(tabId)
        : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
    if (!tab) return

    if (debuggerAttached.has(tab.id)) {
        try {
            await chrome.debugger.sendCommand({ tabId: tab.id }, 'Console.disable')
            await chrome.debugger.sendCommand({ tabId: tab.id }, 'Network.disable')
        } catch (_) { }
    }
    consoleMessages.delete(tab.id)
    networkRequests.delete(tab.id)
    await updateAgentGroupState({ status: 'idle' })
}

chrome.debugger.onEvent.addListener((source, method, params) => {
    const tabId = source.tabId
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

async function cdpMouseEvent(tabId, eventType, x, y, button = 'left', clickCount = 1) {
    const tab = tabId
        ? await chrome.tabs.get(tabId)
        : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
    if (!tab) return

    await attachDebugger(tab.id)
    const buttonMap = { left: 0, middle: 1, right: 2 }
    const btnNum = buttonMap[button] || 0

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
    'Space': { key: ' ', code: 'Space', keyCode: 32 }
}

async function cdpKeyEvent(tabId, key, modifiers = 0) {
    const tab = tabId
        ? await chrome.tabs.get(tabId)
        : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
    if (!tab) return

    await attachDebugger(tab.id)
    const mapped = KEY_MAP[key] || { key, code: `Key${key.toUpperCase()}`, keyCode: key.charCodeAt(0) }

    await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: mapped.key,
        code: mapped.code,
        windowsVirtualKeyCode: mapped.keyCode,
        modifiers
    })
    await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: mapped.key,
        code: mapped.code,
        windowsVirtualKeyCode: mapped.keyCode,
        modifiers
    })
}

async function cdpTypeText(tabId, text) {
    const tab = tabId
        ? await chrome.tabs.get(tabId)
        : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
    if (!tab) return

    await attachDebugger(tab.id)
    await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.insertText', { text })
}

async function executeScheduledTask(task) {
    try {
        const win = await chrome.windows.create({
            url: task.url || 'about:blank',
            type: 'normal',
            focused: true
        })
        const tab = win.tabs[0]
        if (task.url) {
            await new Promise(r => setTimeout(r, 2000))
        }
        await openAgentForTab(tab.id)
        setTimeout(() => {
            chrome.runtime.sendMessage({
                type: 'SCHEDULED_TASK_EXECUTE',
                task,
                tabId: tab.id
            })
        }, 1000)
    } catch (e) {
        console.error('[Background] 执行定时任务失败:', e)
    }
}

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
        throw new Error('没有活跃标签页')
    }

    await openAgentForTab(tab.id)
}

async function openAgentForTab(tabId) {
    const tab = await chrome.tabs.get(tabId)
    if (!tab || !tab.id) {
        throw new Error('没有标签页')
    }

    try {
        await ensureTabGroup(tab.id, 'AgentAura')
    } catch (_) { }

    await chrome.sidePanel.setOptions({
        tabId: tab.id,
        path: 'sidepanel.html',
        enabled: true
    })

    await chrome.sidePanel.open({ tabId: tab.id })
}
