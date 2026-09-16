const sidepanel = (() => {
    const apiClient = new ApiClient()
    const authService = new AuthService()

    const automationEngine = new AutomationEngine()
    const tabManager = new TabManager()
    const permissionManager = new PermissionManager()
    const workflowRecorder = new WorkflowRecorder()
    const shortcutsManager = new ShortcutsManager()
    const taskScheduler = new TaskScheduler()
    const skillInstaller = new SkillInstaller(apiClient)

    let chatService = null
    let sessionKey = null
    let activeClaw = null
    let messages = []
    let isGenerating = false
    let isRecording = false
    let pendingScreenshot = null
    let conversationHistory = []
    let agentLoopRunning = false
    let agentStepCount = 0
    const MAX_AGENT_STEPS = 30
    const MAX_CONTEXT_MESSAGES = 20
    const MAX_ACTION_RETRIES = 2
    const INLINE_BROWSER_AUTOMATION_PROMPT = [
        '[System] You are controlling a browser through this Chrome extension.',
        'The built-in browser tool is broken in this environment and will fail with pairing errors.',
        'Never call any built-in browser tool. Control the page only by emitting JSON action blocks.',
        '',
        'Action block format:',
        '```action',
        '{"type": "navigate", "url": "https://..."}',
        '```',
        '',
        'Allowed action types:',
        'navigate, new_tab, select_tab, list_tabs, click_ref, type_ref, hover_ref, click, type, cdp_key, cdp_click, screenshot, read_page_content, get_page_text, scroll, wait, execute_js.',
        '',
        'Rules:',
        '1. Prefer click_ref/type_ref when the page exposes [ref] ids.',
        '2. Do one or two actions at a time, then wait for results.',
        '3. If an action fails, choose a different action instead of repeating the same failure.',
        '4. When the task is complete, stop emitting actions and provide a plain-text summary.'
    ].join('\n')

    const $ = (sel) => document.querySelector(sel)
    const $$ = (sel) => document.querySelectorAll(sel)

    async function init() {
        await I18n.init()
        I18n.applyToPage()

        await authService.init()
        await permissionManager.init()
        await shortcutsManager.init()
        await taskScheduler.init()

        permissionManager.onApprovalNeeded = showActionApproval
        permissionManager.onPlanApproval = showPlanApproval

        if (!authService.idToken) {
            try {
                await authService.signInAnonymously()
            } catch (_) { }
        }

        if (authService.idToken) {
            apiClient.setAuthToken(authService.idToken)
        }

        bindUIEvents()
        applyPermissionMode(permissionManager.mode)
        await loadClaws()
        renderMessages()
        renderScheduledTasks()

        try {
            const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
            if (activeTab && activeTab.id) {
                await chrome.runtime.sendMessage({ type: 'TAB_GROUP_ENSURE', tabId: activeTab.id, title: 'AgentAura' }).catch(() => { })
            }
        } catch (_) { }

        chrome.runtime.onMessage.addListener((msg) => {
            if (msg.type === 'SCHEDULED_TASK_EXECUTE' && msg.task) {
                handleScheduledTaskExec(msg.task)
            }
        })
    }

    function bindUIEvents() {
        $$('.sp-main-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const viewId = tab.dataset.view
                switchMainTab(viewId)
                if (viewId === 'chat') refreshClawsWithAuth()
            })
        })

        window.addEventListener('message', (e) => {
            if (!e.data) return
            if (e.data.type === 'SWITCH_TO_CHAT') {
                switchMainTab('chat')
                refreshClawsWithAuth()
            } else if (e.data.type === 'DEPLOY_COMPLETE' || e.data.type === 'AUTH_CHANGED') {
                refreshClawsWithAuth()
            }
        })

        $('#sp-btn-send').addEventListener('click', handleSend)
        let isComposing = false
        $('#sp-input').addEventListener('compositionstart', () => { isComposing = true })
        $('#sp-input').addEventListener('compositionend', () => { isComposing = false })
        $('#sp-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey && !isComposing && !e.isComposing) {
                e.preventDefault()
                handleSend()
            }
        })
        $('#sp-input').addEventListener('input', autoResizeInput)

        $('#sp-btn-new-chat').addEventListener('click', handleNewChat)
        $('#sp-btn-shortcuts').addEventListener('click', toggleShortcutsPanel)
        $('#sp-btn-close-shortcuts').addEventListener('click', toggleShortcutsPanel)
        $('#sp-btn-export').addEventListener('click', handleExport)
        $('#sp-btn-settings').addEventListener('click', () => chrome.runtime.openOptionsPage())
        $('#sp-btn-stop-agent').addEventListener('click', handleStopAgent)
        $('#sp-btn-screenshot').addEventListener('click', handleScreenshot)
        $('#sp-btn-record').addEventListener('click', handleToggleRecord)

        const schedBtn = $('#sp-btn-schedule')
        if (schedBtn) schedBtn.addEventListener('click', toggleSchedulePanel)
        const schedCloseBtn = $('#sp-btn-close-schedule')
        if (schedCloseBtn) schedCloseBtn.addEventListener('click', toggleSchedulePanel)
        const schedAddBtn = $('#sp-btn-add-schedule')
        if (schedAddBtn) schedAddBtn.addEventListener('click', handleAddScheduledTask)

        $$('.sp-perm-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.mode
                permissionManager.setMode(mode)
                applyPermissionMode(mode)
            })
        })

        $('#sp-btn-deny').addEventListener('click', () => permissionManager.deny())
        $('#sp-btn-approve').addEventListener('click', () => permissionManager.approve())
        $('#sp-btn-approve-all').addEventListener('click', () => {
            permissionManager.approveAll()
            applyPermissionMode('act')
        })

        $('#sp-btn-reject-plan').addEventListener('click', () => permissionManager.rejectPlan())
        $('#sp-btn-approve-plan').addEventListener('click', () => permissionManager.approvePlanExecution())

        $('#sp-btn-add-shortcut').addEventListener('click', handleAddShortcut)
        $('#sp-shortcuts-search').addEventListener('input', renderShortcutsList)

        $$('.sp-suggestion').forEach(btn => {
            btn.addEventListener('click', () => {
                $('#sp-input').value = btn.dataset.prompt
                handleSend()
            })
        })

        $('#sp-claw-select').addEventListener('change', handleClawChange)
    }

    function switchMainTab(viewName) {
        $$('.sp-main-tab').forEach(t => t.classList.toggle('active', t.dataset.view === viewName))
        $$('.sp-view').forEach(v => v.classList.remove('active'))
        const target = $(`#view-${viewName}`)
        if (target) target.classList.add('active')
    }

    async function refreshClawsWithAuth() {
        try {
            await authService.init()
            if (authService.idToken) {
                apiClient.setAuthToken(authService.idToken)
            }
            await loadClaws()
        } catch (_) { }
    }

    function applyPermissionMode(mode) {
        $$('.sp-perm-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode)
        })
    }

    function autoResizeInput() {
        const input = $('#sp-input')
        input.style.height = 'auto'
        input.style.height = Math.min(input.scrollHeight, 120) + 'px'
    }

    async function loadClaws() {
        if (!authService.idToken) return

        try {
            const claws = await apiClient.getClaws()
            const select = $('#sp-claw-select')
            const prevValue = select.value
            select.innerHTML = `<option value="">${I18n.t('sys.selectInstance')}...</option>`

            const statusLabel = { running: '', configuring: ` (${I18n.t('status.configuring')})`, starting: ` (${I18n.t('status.starting')})`, initializing: ` (${I18n.t('status.initializing')})`, stopped: ` (${I18n.t('status.stopped')})`, error: ` (${I18n.t('status.error')})` }

            claws.forEach(claw => {
                const option = document.createElement('option')
                option.value = claw.id
                const s = (claw.status || '').toLowerCase()
                const label = statusLabel[s] || ` (${s})`
                option.textContent = (claw.name || claw.id) + (s === 'running' ? '' : label)
                if (s === 'running' && claw.subdomain) {
                    option.dataset.gatewayUrl = `https://${claw.subdomain}.digitalenginecore.com`
                    option.dataset.gatewayToken = claw.gatewayToken || ''
                } else {
                    option.disabled = true
                }
                select.appendChild(option)
            })

            const runningClaws = claws.filter(c => c.status === 'running' && c.subdomain)

            if (prevValue && select.querySelector(`option[value="${prevValue}"]:not(:disabled)`)) {
                select.value = prevValue
            } else if (runningClaws.length >= 1) {
                select.value = runningClaws[0].id
                await handleClawChange()
            }
        } catch (e) {
            console.error('[SidePanel] loadClaws error:', e)
        }
    }

    async function handleClawChange() {
        const select = $('#sp-claw-select')
        const selectedOption = select.options[select.selectedIndex]
        if (!selectedOption || !selectedOption.value) {
            activeClaw = null
            if (chatService) {
                chatService.disconnect()
                chatService = null
                sessionKey = null
            }
            return
        }

        activeClaw = {
            id: selectedOption.value,
            name: selectedOption.textContent,
            gatewayUrl: selectedOption.dataset.gatewayUrl,
            gatewayToken: selectedOption.dataset.gatewayToken
        }

        if (chatService) {
            chatService.disconnect()
        }

        chatService = new ChatService(activeClaw.gatewayUrl, activeClaw.gatewayToken)
        sessionKey = null

        skillInstaller.ensureSkillInstalled(activeClaw.id).then(ok => {
            if (ok) console.log('[SidePanel] Browser automation skill ready')
            else console.warn('[SidePanel] Skill install failed, automation may not work')
        }).catch((e) => {
            console.warn('[SidePanel] Skill install error:', e)
        })
    }

    async function handleSend() {
        const input = $('#sp-input')
        let text = input.value.trim()
        if (!text || isGenerating) return

        if (!activeClaw) {
            addSystemMessage(I18n.t('sys.selectInstance'))
            return
        }

        const slashResult = await handleSlashCommand(text)
        if (slashResult) return

        if (pendingScreenshot) {
            text += '\n\n[' + I18n.t('sys.screenshotAttached') + ']'
        }

        input.value = ''
        input.style.height = 'auto'
        $('#sp-empty-state').classList.add('hidden')

        addMessage('user', text)

        agentStepCount = 0
        await runAgentLoop(text)

        pendingScreenshot = null
    }

    async function runAgentLoop(userMessage) {
        if (isGenerating) return
        isGenerating = true
        agentLoopRunning = true
        updateGeneratingUI()

        try {
            if (activeClaw && !skillInstaller.isInstalled(activeClaw.id)) {
                addSystemMessage(I18n.t('sys.syncingSkill'))
                const skillOk = await skillInstaller.ensureSkillInstalled(activeClaw.id)
                if (skillOk) {
                    addSystemMessage(I18n.t('sys.skillSynced'))
                } else {
                    addSystemMessage(I18n.t('sys.skillSyncFailed'))
                }
            }

            if (!chatService.isConnected) {
                let ok = false
                for (let attempt = 0; attempt < 4 && !ok; attempt++) {
                    if (attempt > 0) await new Promise(r => setTimeout(r, 3000))
                    ok = await chatService.connect()
                }
                if (!ok) {
                    addSystemMessage(I18n.t('sys.gatewayFailed'))
                    isGenerating = false
                    agentLoopRunning = false
                    updateGeneratingUI()
                    return
                }
            }

            if (!sessionKey) {
                sessionKey = await chatService.resolveSessionKey('main')
            }

            const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
            if (activeTab && activeTab.id) {
                automationEngine.activeTabId = activeTab.id
                await tabManager.ensureGroup(activeTab.id, 'AgentAura')
                await chrome.runtime.sendMessage({
                    type: 'AGENT_GROUP_STATUS',
                    state: {
                        status: 'running',
                        mainTabId: activeTab.id,
                        lastActiveTabId: activeTab.id,
                        title: 'AgentAura'
                    }
                }).catch(() => { })
            }

            await startMonitoring()

            const contextInfo = await gatherPageContext(true)
            const tabContext = await gatherTabContext()
            const fullMessage = buildAgentMessage(userMessage, contextInfo, tabContext)
            const attachments = buildMessageAttachments(contextInfo)
            trimConversationHistory()

            const assistantId = addMessage('assistant', '', true)
            let fullResponse = ''

            await chatService.sendChatMessage({
                message: fullMessage,
                sessionKey,
                attachments,
                onDelta: (parsed) => {
                    fullResponse = parsed.text || ''
                    updateMessage(assistantId, fullResponse, true)
                },
                onComplete: async (parsed) => {
                    fullResponse = parsed.text || I18n.t('sys.noReply')
                    updateMessage(assistantId, fullResponse, false)

                    const actions = extractActions(fullResponse)
                    if (shouldForceActionRetry(fullResponse, actions) && agentLoopRunning && agentStepCount < MAX_AGENT_STEPS) {
                        const retryContext = await gatherPageContext(true)
                        const retryTabs = await gatherTabContext()
                        const retryMessage = buildNativeToolFallbackMessage(fullResponse, retryContext, retryTabs)
                        await continueAgentLoop(retryMessage, buildMessageAttachments(retryContext))
                        return
                    }

                    if (actions.length > 0 && agentLoopRunning && agentStepCount < MAX_AGENT_STEPS) {
                        const execution = await executeAgentActions(actions)

                        if (execution.failedAction && agentLoopRunning && agentStepCount < MAX_AGENT_STEPS) {
                            await new Promise(r => setTimeout(r, 400))
                            const recoveryContext = await gatherPageContext(true)
                            const recoveryTabs = await gatherTabContext()
                            const recoveryMsg = buildRecoveryMessage(execution.failedAction, execution.failedResult, recoveryContext, recoveryTabs)
                            await continueAgentLoop(recoveryMsg, buildMessageAttachments(recoveryContext))
                        } else if (agentLoopRunning && agentStepCount < MAX_AGENT_STEPS) {
                            await new Promise(r => setTimeout(r, 500))
                            const verifyContext = await gatherPageContext(true)
                            const verifyTabs = await gatherTabContext()
                            const verifyMsg = buildVerifyMessage(execution.executedActions, verifyContext, verifyTabs)
                            await continueAgentLoop(verifyMsg, buildMessageAttachments(verifyContext))
                        } else {
                            finishAgentLoop()
                        }
                    } else {
                        finishAgentLoop()
                    }
                },
                onError: (error) => {
                    updateMessage(assistantId, error, false, true)
                    finishAgentLoop()
                }
            })
        } catch (e) {
            notifyAgentGroupState('error')
            addSystemMessage(I18n.t('sys.connectError', { msg: e.message }))
            finishAgentLoop()
        }
    }

    async function continueAgentLoop(message, attachments = []) {
        if (!agentLoopRunning || agentStepCount >= MAX_AGENT_STEPS) {
            finishAgentLoop()
            return
        }

        const assistantId = addMessage('assistant', '', true)
        let fullResponse = ''

        try {
            await chatService.sendChatMessage({
                message,
                sessionKey,
                attachments,
                onDelta: (parsed) => {
                    fullResponse = parsed.text || ''
                    updateMessage(assistantId, fullResponse, true)
                },
                onComplete: async (parsed) => {
                    fullResponse = parsed.text || ''
                    updateMessage(assistantId, fullResponse, false)

                    const actions = extractActions(fullResponse)
                    if (shouldForceActionRetry(fullResponse, actions) && agentLoopRunning && agentStepCount < MAX_AGENT_STEPS) {
                        const retryContext = await gatherPageContext(true)
                        const retryTabs = await gatherTabContext()
                        const retryMessage = buildNativeToolFallbackMessage(fullResponse, retryContext, retryTabs)
                        await continueAgentLoop(retryMessage, buildMessageAttachments(retryContext))
                        return
                    }

                    if (actions.length > 0 && agentLoopRunning && agentStepCount < MAX_AGENT_STEPS) {
                        const execution = await executeAgentActions(actions)

                        if (execution.failedAction && agentLoopRunning && agentStepCount < MAX_AGENT_STEPS) {
                            await new Promise(r => setTimeout(r, 400))
                            const recoveryContext = await gatherPageContext(true)
                            const recoveryTabs = await gatherTabContext()
                            const recoveryMsg = buildRecoveryMessage(execution.failedAction, execution.failedResult, recoveryContext, recoveryTabs)
                            await continueAgentLoop(recoveryMsg, buildMessageAttachments(recoveryContext))
                        } else if (agentLoopRunning && agentStepCount < MAX_AGENT_STEPS) {
                            await new Promise(r => setTimeout(r, 500))
                            const verifyContext = await gatherPageContext(true)
                            const verifyTabs = await gatherTabContext()
                            const verifyMsg = buildVerifyMessage(execution.executedActions, verifyContext, verifyTabs)
                            await continueAgentLoop(verifyMsg, buildMessageAttachments(verifyContext))
                        } else {
                            finishAgentLoop()
                        }
                    } else {
                        finishAgentLoop()
                    }
                },
                onError: (error) => {
                    updateMessage(assistantId, error, false, true)
                    finishAgentLoop()
                }
            })
        } catch (e) {
            notifyAgentGroupState('error')
            addSystemMessage(I18n.t('sys.loopError', { msg: e.message }))
            finishAgentLoop()
        }
    }

    function finishAgentLoop() {
        notifyAgentGroupState('complete')
        isGenerating = false
        agentLoopRunning = false
        updateGeneratingUI()
        hideAgentBanner()
        stopMonitoring()
    }

    async function startMonitoring() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
            if (tab) {
                await chrome.runtime.sendMessage({ type: 'AGENT_START_MONITORING', tabId: tab.id })
            }
        } catch (_) { }
    }

    async function stopMonitoring() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
            if (tab) {
                await chrome.runtime.sendMessage({ type: 'AGENT_STOP_MONITORING', tabId: tab.id })
            }
        } catch (_) { }
    }

    function updateStepCounter(current, total) {
        const el = $('#sp-step-current')
        const totalEl = $('#sp-step-total')
        if (el) el.textContent = current
        if (totalEl) totalEl.textContent = total
    }

    async function gatherPageContext(includeAccessibilityTree = false) {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
            if (!tab || !tab.id) return { url: 'unknown', title: '', noPage: true }

            const isSpecialPage = !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:')
            if (isSpecialPage) {
                return { url: tab.url || 'chrome://newtab', title: tab.title || '', noPage: true }
            }

            const blocked = await chrome.runtime.sendMessage({
                type: 'CHECK_BLOCKED_SITE',
                url: tab.url
            })
            if (blocked && blocked.blocked) return { blocked: true, url: tab.url }

            let structure = null
            let pageContent = null
            let screenshot = pendingScreenshot || null

            try {
                const res = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_STRUCTURE' })
                structure = res
            } catch (_) { }

            if (includeAccessibilityTree) {
                try {
                    const res = await chrome.tabs.sendMessage(tab.id, {
                        type: 'GET_PAGE_CONTENT',
                        filter: 'interactive',
                        maxLength: 20000
                    })
                    if (res && res.success !== false) {
                        pageContent = res
                    }
                } catch (_) { }

                if (!screenshot) {
                    try {
                        const result = await chrome.runtime.sendMessage({ type: 'AGENT_TAKE_SCREENSHOT' })
                        if (result && result.dataUrl) screenshot = result.dataUrl
                    } catch (_) { }
                }
            }

            return {
                url: tab.url,
                title: tab.title,
                structure,
                pageContent,
                screenshot
            }
        } catch (_) {
            return { url: 'unknown', title: '', noPage: true }
        }
    }

    async function gatherTabContext() {
        try {
            const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
            if (!activeTab || !activeTab.id) {
                return { currentTabId: null, tabs: [] }
            }

            const tabs = await tabManager.listTabs(activeTab.id)
            return {
                currentTabId: activeTab.id,
                tabs: (tabs || []).map(tab => ({
                    id: tab.id,
                    title: tab.title || I18n.t('ctx.untitledTab'),
                    url: tab.url || '',
                    active: !!tab.active
                }))
            }
        } catch (_) {
            return { currentTabId: null, tabs: [] }
        }
    }

    async function refreshAccessibilityTree() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
            if (tab && tab.id && tab.url && !tab.url.startsWith('chrome://')) {
                await chrome.tabs.sendMessage(tab.id, {
                    type: 'GET_PAGE_CONTENT',
                    filter: 'interactive',
                    maxLength: 20000
                })
            }
        } catch (_) { }
    }

    function buildAgentMessage(userText, context, tabContext) {
        const parts = []

        parts.push(INLINE_BROWSER_AUTOMATION_PROMPT)
        parts.push('')
        parts.push(userText)

        if (conversationHistory.length > 1) {
            const recent = conversationHistory.slice(-Math.min(conversationHistory.length - 1, 10))
            parts.push(`\n[${I18n.t('ctx.chatHistory')}]`)
            recent.forEach(h => {
                const roleLabel = h.role === 'user' ? I18n.t('ctx.user') : I18n.t('ctx.assistant')
                const content = (h.content || '').substring(0, 500)
                if (content) parts.push(`${roleLabel}: ${content}`)
            })
        }

        if (tabContext && tabContext.tabs && tabContext.tabs.length) {
            parts.push(`\n[${I18n.t('ctx.groupTabs')}]`)
            parts.push(`${I18n.t('ctx.currentTabId')}: ${tabContext.currentTabId || I18n.t('ctx.unknown')}`)
            tabContext.tabs.forEach(tab => {
                parts.push(`- ${I18n.t('ctx.tab')} ${tab.id}${tab.active ? I18n.t('ctx.current') : ''}: ${tab.title} | ${tab.url}`)
            })
        }

        if (context && !context.blocked) {
            if (context.noPage) {
                parts.push(`\n[${I18n.t('ctx.pageState')}] ${I18n.t('ctx.newTabNoContent')}`)
            } else if (context.url) {
                parts.push(`\n[${I18n.t('ctx.pageState')}] URL: ${context.url}`)
                if (context.title) parts.push(`${I18n.t('ctx.title')}: ${context.title}`)
                if (context.screenshot) parts.push(I18n.t('ctx.screenshotAttachedJudge'))

                if (context.pageContent && context.pageContent.pageContent) {
                    parts.push(`\n[${I18n.t('ctx.interactiveElements')}] (${I18n.t('ctx.totalCount', { count: context.pageContent.elementCount })}, ${I18n.t('ctx.viewport')} ${context.pageContent.viewport.width}x${context.pageContent.viewport.height})`)
                    parts.push(context.pageContent.pageContent)
                } else if (context.structure) {
                    const s = context.structure
                    if (s.headings && s.headings.length)
                        parts.push(`${I18n.t('ctx.headings')}: ${s.headings.map(h => h.text).join(', ')}`)
                    if (s.forms && s.forms.length)
                        parts.push(`${I18n.t('ctx.forms')}: ${s.forms.length}`)
                    if (s.buttons && s.buttons.length)
                        parts.push(`${I18n.t('ctx.buttons')}: ${s.buttons.map(b => b.text).join(', ')}`)
                }
            }
        } else if (!context) {
            parts.push(`\n[${I18n.t('ctx.pageState')}] ${I18n.t('ctx.cannotGetPageInfo')}`)
        }

        return parts.join('\n')
    }

    function buildVerifyMessage(executedActions, context, tabContext) {
        const parts = []

        parts.push(`[${I18n.t('ctx.executedActions')}]`)
        executedActions.forEach((a, i) => {
            parts.push(`${i + 1}. ${automationEngine.describeAction(a)}`)
        })

        if (context) {
            if (context.noPage) {
                parts.push(`\n[${I18n.t('ctx.pageState')}] ${I18n.t('ctx.specialPage')}`)
            } else if (!context.blocked) {
                parts.push(`\n[${I18n.t('ctx.pageState')}] URL: ${context.url || I18n.t('ctx.unknown')}`)
                if (context.title) parts.push(`${I18n.t('ctx.title')}: ${context.title}`)
                if (context.screenshot) parts.push(I18n.t('ctx.screenshotAttachedVerify'))

                if (context.pageContent && context.pageContent.pageContent) {
                    parts.push(`\n[${I18n.t('ctx.interactiveElements')}] (${I18n.t('ctx.totalCount', { count: context.pageContent.elementCount })})`)
                    parts.push(context.pageContent.pageContent)
                }
            }
        }

        if (tabContext && tabContext.tabs && tabContext.tabs.length) {
            parts.push(`\n[${I18n.t('ctx.groupTabs')}]`)
            tabContext.tabs.forEach(tab => {
                parts.push(`- ${I18n.t('ctx.tab')} ${tab.id}${tab.active ? I18n.t('ctx.current') : ''}: ${tab.title}`)
            })
        }

        parts.push(`\n[${I18n.t('ctx.actionConstraint')}] ${I18n.t('ctx.onlyActionBlocks')}`)
        parts.push(`\n${I18n.t('ctx.judgeNextStep')}`)
        return parts.join('\n')
    }

    function buildRecoveryMessage(failedAction, failedResult, context, tabContext) {
        const parts = []

        parts.push(`[${I18n.t('ctx.actionFailed')}]`)
        parts.push(`${I18n.t('ctx.failedAction')}: ${automationEngine.describeAction(failedAction)}`)
        parts.push(`${I18n.t('ctx.failedReason')}: ${failedResult?.error || I18n.t('ctx.unknownError')}`)

        if (context) {
            if (context.noPage) {
                parts.push(`\n[${I18n.t('ctx.pageState')}] ${I18n.t('ctx.noOperablePage')}`)
            } else if (!context.blocked) {
                parts.push(`\n[${I18n.t('ctx.pageState')}] URL: ${context.url || I18n.t('ctx.unknown')}`)
                if (context.title) parts.push(`${I18n.t('ctx.title')}: ${context.title}`)
                if (context.screenshot) parts.push(I18n.t('ctx.screenshotAttachedRelocate'))
                if (context.pageContent && context.pageContent.pageContent) {
                    parts.push(`\n[${I18n.t('ctx.interactiveElements')}] (${I18n.t('ctx.totalCount', { count: context.pageContent.elementCount })})`)
                    parts.push(context.pageContent.pageContent)
                }
            }
        }

        if (tabContext && tabContext.tabs && tabContext.tabs.length) {
            parts.push(`\n[${I18n.t('ctx.groupTabs')}]`)
            tabContext.tabs.forEach(tab => {
                parts.push(`- ${I18n.t('ctx.tab')} ${tab.id}${tab.active ? I18n.t('ctx.current') : ''}: ${tab.title}`)
            })
        }

        parts.push(`\n[${I18n.t('ctx.actionConstraint')}] ${I18n.t('ctx.noBuiltinToolRecovery')}`)
        parts.push(`\n${I18n.t('ctx.analyzeAndRetry')}`)

        return parts.join('\n')
    }

    function shouldForceActionRetry(fullResponse, actions) {
        if (!fullResponse || actions.length > 0) return false

        const normalized = fullResponse.toLowerCase()
        return normalized.includes('pairing')
            || normalized.includes('built-in browser tool')
            || normalized.includes('browser tool')
            || normalized.includes('native browser tool')
            || (normalized.includes('browser') && normalized.includes('unavailable'))
            || (normalized.includes('browser') && normalized.includes('failed'))
    }

    function buildNativeToolFallbackMessage(fullResponse, context, tabContext) {
        const parts = []

        parts.push(`[${I18n.t('ctx.systemCorrection')}] ${I18n.t('ctx.triedBuiltinTool')}`)
        parts.push(I18n.t('ctx.toolUnavailable'))
        parts.push(I18n.t('ctx.outputActionOrSummary'))
        parts.push('')
        parts.push(`[${I18n.t('ctx.previousReplySummary')}]`)
        parts.push((fullResponse || '').substring(0, 1200))

        if (tabContext && tabContext.tabs && tabContext.tabs.length) {
            parts.push(`\n[${I18n.t('ctx.groupTabs')}]`)
            parts.push(`${I18n.t('ctx.currentTabId')}: ${tabContext.currentTabId || I18n.t('ctx.unknown')}`)
            tabContext.tabs.forEach(tab => {
                parts.push(`- ${I18n.t('ctx.tab')} ${tab.id}${tab.active ? I18n.t('ctx.current') : ''}: ${tab.title} | ${tab.url}`)
            })
        }

        if (context && !context.blocked) {
            if (context.noPage) {
                parts.push(`\n[${I18n.t('ctx.pageState')}] ${I18n.t('ctx.specialPage')}`)
            } else if (context.url) {
                parts.push(`\n[${I18n.t('ctx.pageState')}] URL: ${context.url}`)
                if (context.title) parts.push(`${I18n.t('ctx.title')}: ${context.title}`)
                if (context.screenshot) parts.push(I18n.t('ctx.screenshotAttached'))
                if (context.pageContent && context.pageContent.pageContent) {
                    parts.push(`\n[${I18n.t('ctx.interactiveElements')}] (${I18n.t('ctx.totalCount', { count: context.pageContent.elementCount })})`)
                    parts.push(context.pageContent.pageContent)
                }
            }
        }

        parts.push(`\n${I18n.t('ctx.onlyReturnActionOrSummary')}`)

        return parts.join('\n')
    }

    function extractActions(text) {
        const actions = []
        const actionRegex = /```(?:action|json)\s*\n([\s\S]*?)```/g
        let match

        while ((match = actionRegex.exec(text)) !== null) {
            try {
                const parsed = JSON.parse(match[1].trim())
                if (parsed && parsed.type) {
                    actions.push(parsed)
                } else if (Array.isArray(parsed)) {
                    parsed.forEach(a => { if (a && a.type) actions.push(a) })
                }
            } catch (_) { }
        }

        if (actions.length === 0) {
            const bareJsonRegex = /\{[^{}]*"type"\s*:\s*"[^"]+?"[^{}]*\}/g
            let bareMatch
            while ((bareMatch = bareJsonRegex.exec(text)) !== null) {
                try {
                    const parsed = JSON.parse(bareMatch[0])
                    if (parsed && parsed.type) {
                        actions.push(parsed)
                    }
                } catch (_) { }
            }
        }

        return actions
    }

    async function executeAgentActions(actions) {
        if (permissionManager.mode === 'plan' && actions.length > 0) {
            const planResult = await permissionManager.requestPlanApproval(actions)
            if (!planResult || !planResult.approved) {
                addSystemMessage(I18n.t('sys.planRejected'))
                return { executedActions: [], failedAction: null, failedResult: null }
            }
        }

        const DOM_CHANGING_ACTIONS = new Set([
            'click', 'click_ref', 'type', 'type_ref', 'form_input',
            'navigate', 'new_tab', 'select_tab', 'execute_js', 'cdp_click', 'cdp_type', 'cdp_drag'
        ])
        const executedActions = []

        for (let i = 0; i < actions.length; i++) {
            const action = actions[i]
            if (!agentLoopRunning) break

            agentStepCount++
            updateStepCounter(agentStepCount, MAX_AGENT_STEPS)

            const result = await executeAgentAction(action)
            executedActions.push(action)

            if (result?.error) {
                return {
                    executedActions,
                    failedAction: action,
                    failedResult: result
                }
            }

            if (i < actions.length - 1 && DOM_CHANGING_ACTIONS.has(action.type)) {
                await new Promise(r => setTimeout(r, 300))
                await refreshAccessibilityTree()
            }
        }

        return {
            executedActions,
            failedAction: null,
            failedResult: null
        }
    }

    async function executeAgentAction(action) {
        showAgentBanner(I18n.t('sys.executing', { action: automationEngine.describeAction(action) }))

        const allowed = await permissionManager.checkPermission(action)
        if (!allowed || !allowed.approved) {
            if (allowed && allowed.timedOut) {
                addSystemMessage(I18n.t('sys.approvalTimeout', { action: automationEngine.describeAction(action) }))
                return { success: false, error: I18n.t('sys.approvalTimeout', { action: '' }) }
            }
            notifyAgentGroupState('approval')
            addSystemMessage(I18n.t('sys.actionDenied', { action: automationEngine.describeAction(action) }))
            return { success: false, error: I18n.t('sys.actionDenied', { action: '' }) }
        }

        notifyAgentGroupState('running')

        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (tab && tab.id) {
            automationEngine.activeTabId = tab.id
        }

        for (let attempt = 1; attempt <= MAX_ACTION_RETRIES; attempt++) {
            try {
                if (tab) {
                    chrome.tabs.sendMessage(tab.id, {
                        type: 'INDICATOR_SHOW',
                        text: automationEngine.describeAction(action),
                        step: I18n.t('sys.stepIndicator', { step: agentStepCount }) + (MAX_ACTION_RETRIES > 1 ? ` · ${I18n.t('sys.attempt', { current: attempt, max: MAX_ACTION_RETRIES })}` : '')
                    }).catch(() => { })
                }

                const result = await automationEngine.executeAction(action)
                const shouldRetry = shouldRetryAction(action, result, attempt)

                if (tab) {
                    chrome.tabs.sendMessage(tab.id, {
                        type: 'INDICATOR_TIMELINE',
                        text: shouldRetry
                            ? `${automationEngine.describeAction(action)}${I18n.t('sys.retrying')}`
                            : automationEngine.describeAction(action),
                        success: !result.error,
                        status: result.error ? 'failed' : 'done',
                        icon: result.error ? '!' : '✓'
                    }).catch(() => { })
                }

                if (!result.error) {
                    return result
                }

                if (!shouldRetry) {
                    notifyAgentGroupState('error')
                    addSystemMessage(I18n.t('sys.actionFailed', { error: result.error }))
                    return result
                }

                await recoverFailedAction(action, result, attempt)
            } catch (e) {
                const errorResult = { success: false, error: e.message }
                const shouldRetry = shouldRetryAction(action, errorResult, attempt)

                if (!shouldRetry) {
                    notifyAgentGroupState('error')
                    addSystemMessage(I18n.t('sys.actionError', { msg: e.message }))
                    return errorResult
                }

                await recoverFailedAction(action, errorResult, attempt)
            }
        }

        const finalResult = { success: false, error: I18n.t('sys.maxRetriesFailed') }
        notifyAgentGroupState('error')
        addSystemMessage(finalResult.error + `：${automationEngine.describeAction(action)}`)
        return finalResult
    }

    function shouldRetryAction(action, result, attempt) {
        if (!result?.error) return false
        if (attempt >= MAX_ACTION_RETRIES) return false

        const errorText = String(result.error || '')
        const retryableErrors = [
            I18n.t('ctx.elementNotFound'),
            I18n.t('ctx.noResult'),
            I18n.t('ctx.getPageTextFailed'),
            'Receiving end does not exist',
            'Could not establish connection',
            'The message port closed before a response was received'
        ]

        const retryableActionTypes = ['click_ref', 'type_ref', 'hover_ref', 'read_page_content', 'find', 'get_page_text', 'execute_js', 'navigate', 'new_tab']

        return retryableActionTypes.includes(action.type) && retryableErrors.some(fragment => errorText.includes(fragment))
    }

    async function recoverFailedAction(action, result, attempt) {
        addSystemMessage(I18n.t('sys.retryRecover', { attempt: attempt, max: MAX_ACTION_RETRIES, error: result.error }))

        if (action.type === 'navigate' || action.type === 'new_tab') {
            await new Promise(r => setTimeout(r, 1200))
            return
        }

        await new Promise(r => setTimeout(r, 500))
        await gatherPageContext(true)
    }

    function notifyAgentGroupState(status) {
        chrome.runtime.sendMessage({
            type: 'AGENT_GROUP_STATUS',
            state: { status }
        }).catch(() => { })
    }

    function buildMessageAttachments(context) {
        if (!context || !context.screenshot) return []

        const attachment = dataUrlToAttachment(context.screenshot)
        return attachment ? [attachment] : []
    }

    async function handleSlashCommand(text) {
        const cmd = text.trim().toLowerCase()
        if (cmd === '/vision-test') {
            $('#sp-input').value = ''
            $('#sp-input').style.height = 'auto'
            await runVisionTest()
            return true
        }
        if (cmd === '/diag') {
            $('#sp-input').value = ''
            $('#sp-input').style.height = 'auto'
            runDiagnostics()
            return true
        }
        return false
    }

    async function runVisionTest() {
        addSystemMessage('===== 视觉验证测试开始 =====')

        if (!activeClaw || !chatService) {
            addSystemMessage('[失败] 请先选择一个运行中的实例。')
            return
        }

        const testNumber = String(1000 + Math.floor(Math.random() * 9000))
        const colors = ['#e74c3c', '#2ecc71', '#3498db', '#f39c12', '#9b59b6']
        const pick = Math.floor(Math.random() * colors.length)
        const colorHex = colors[pick]
        const colorNames = { '#e74c3c': '红色', '#2ecc71': '绿色', '#3498db': '蓝色', '#f39c12': '橙色', '#9b59b6': '紫色' }
        const expectedColor = colorNames[colorHex]

        addSystemMessage(`[测试参数] 数字=${testNumber}, 颜色=${expectedColor}(${colorHex})`)

        const injectScript = `
            (function() {
                const c = document.createElement('canvas');
                c.id = '__vision_test__';
                c.width = 800; c.height = 400;
                c.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:999999;border:3px solid #fff;box-shadow:0 0 40px rgba(0,0,0,0.8);';
                document.body.appendChild(c);
                const ctx = c.getContext('2d');
                ctx.fillStyle = '#111';
                ctx.fillRect(0, 0, 800, 400);
                ctx.fillStyle = '#fff';
                ctx.font = 'bold 140px monospace';
                ctx.textAlign = 'center';
                ctx.fillText('${testNumber}', 400, 180);
                ctx.fillStyle = '${colorHex}';
                ctx.fillRect(280, 240, 240, 80);
                ctx.fillStyle = '#000';
                ctx.font = 'bold 36px sans-serif';
                ctx.fillText('TEST', 400, 292);
                return 'injected';
            })()
        `

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
            if (!tab || !tab.id) {
                addSystemMessage('[失败] 没有活动标签页。')
                return
            }

            const injectResult = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: new Function('return ' + injectScript)
            })
            addSystemMessage('[步骤1] 测试画布已注入到当前页面。')

            await new Promise(r => setTimeout(r, 500))

            const ssResult = await chrome.runtime.sendMessage({ type: 'AGENT_TAKE_SCREENSHOT' })
            if (!ssResult || !ssResult.dataUrl) {
                addSystemMessage('[失败] 截图获取失败。')
                return
            }
            const screenshotAttachment = dataUrlToAttachment(ssResult.dataUrl)
            if (!screenshotAttachment) {
                addSystemMessage('[失败] 截图转换附件失败。')
                return
            }

            const base64Len = screenshotAttachment.content.length
            addSystemMessage(`[步骤2] 截图已捕获。类型: ${screenshotAttachment.mimeType}, base64长度: ${base64Len} 字符 (~${Math.round(base64Len * 0.75 / 1024)}KB)`)

            if (!chatService.isConnected) {
                const ok = await chatService.connect()
                if (!ok) { addSystemMessage('[失败] 网关连接失败。'); return }
            }
            if (!sessionKey) {
                sessionKey = await chatService.resolveSessionKey('main')
            }

            const testPrompt = '这是一个自动化视觉验证测试。当前页面上覆盖了一个测试画布。请只看截图回答以下两个问题，用JSON格式返回：\n1. 画布上显示的四位数字是多少？\n2. 画布上按钮的背景色是什么颜色？\n\n请严格按此格式返回，不要包含其它内容：\n{"number": "四位数字", "color": "颜色名"}'

            addSystemMessage('[步骤3] 正在向模型发送截图并提问...')
            const assistantId = addMessage('assistant', '', true)
            let fullResponse = ''

            await chatService.sendChatMessage({
                message: testPrompt,
                sessionKey,
                attachments: [screenshotAttachment],
                onDelta: (parsed) => {
                    fullResponse = parsed.text || ''
                    updateMessage(assistantId, fullResponse, true)
                },
                onComplete: (parsed) => {
                    fullResponse = parsed.text || ''
                    updateMessage(assistantId, fullResponse, false)
                },
                onError: (err) => {
                    updateMessage(assistantId, '请求失败: ' + err, false, true)
                    fullResponse = ''
                }
            })

            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => { const el = document.getElementById('__vision_test__'); if (el) el.remove() }
            }).catch(() => { })

            if (!fullResponse) {
                addSystemMessage('[结果] 模型无回复，测试失败。')
                return
            }

            addSystemMessage('[步骤4] 正在校验模型回复...')

            let numberPass = false
            let colorPass = false

            const jsonMatch = fullResponse.match(/\{[^}]*\}/)
            if (jsonMatch) {
                try {
                    const parsed = JSON.parse(jsonMatch[0])
                    numberPass = String(parsed.number) === testNumber
                    colorPass = typeof parsed.color === 'string' && parsed.color.includes(expectedColor)
                } catch (_) { }
            }

            if (!numberPass) numberPass = fullResponse.includes(testNumber)
            if (!colorPass) colorPass = fullResponse.includes(expectedColor)

            const results = []
            results.push(`  数字识别: ${numberPass ? '通过' : '失败'} (期望=${testNumber})`)
            results.push(`  颜色识别: ${colorPass ? '通过' : '失败'} (期望=${expectedColor})`)

            if (numberPass && colorPass) {
                addSystemMessage('===== 测试结果: 全部通过 =====\n' + results.join('\n') + '\n结论: 后端模型确实在使用截图进行视觉判断。')
            } else {
                addSystemMessage('===== 测试结果: 部分失败 =====\n' + results.join('\n') + '\n结论: 后端模型可能未正确接收或使用截图。请在 DevTools Network>WS 中检查 chat.send 帧是否包含 attachments 字段。')
            }
        } catch (e) {
            addSystemMessage('[异常] 视觉测试出错: ' + e.message)
        }
    }

    function runDiagnostics() {
        const lines = ['===== 扩展诊断信息 =====']
        lines.push(`连接状态: ${chatService ? (chatService.isConnected ? '已连接' : '未连接') : '未初始化'}`)
        lines.push(`会话Key: ${sessionKey || '无'}`)
        lines.push(`当前实例: ${activeClaw ? activeClaw.name + ' (' + activeClaw.id + ')' : '未选择'}`)
        lines.push(`网关地址: ${activeClaw ? activeClaw.gatewayUrl : '无'}`)
        lines.push(`待发截图: ${pendingScreenshot ? '有 (' + Math.round(pendingScreenshot.length * 0.75 / 1024) + 'KB)' : '无'}`)
        lines.push(`消息数: ${messages.length}`)
        lines.push(`历史记录数: ${conversationHistory.length}`)
        lines.push(`Agent步数: ${agentStepCount}/${MAX_AGENT_STEPS}`)
        lines.push(`生成中: ${isGenerating ? '是' : '否'}`)
        lines.push(`Agent循环: ${agentLoopRunning ? '运行中' : '空闲'}`)
        lines.push('---')
        lines.push('附件管道: gatherPageContext -> buildMessageAttachments -> dataUrlToAttachment -> chat.send.attachments')
        lines.push('诊断日志: 打开 DevTools Console 过滤 [ChatService][附件诊断] 可查看每次发包的附件统计')
        lines.push('=============================')
        addSystemMessage(lines.join('\n'))
    }

    function dataUrlToAttachment(dataUrl) {
        if (typeof dataUrl !== 'string') return null

        const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
        if (!match) return null

        return {
            type: 'image',
            mimeType: match[1] || 'image/png',
            content: match[2]
        }
    }

    function addMessage(role, content, isStreaming = false) {
        const id = 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)
        const msg = { id, role, content, isStreaming, isError: false, timestamp: Date.now() }
        messages.push(msg)
        conversationHistory.push({ role, content })
        renderMessages()
        scrollToBottom()
        return id
    }

    function trimConversationHistory() {
        if (conversationHistory.length > MAX_CONTEXT_MESSAGES) {
            const excess = conversationHistory.length - MAX_CONTEXT_MESSAGES
            conversationHistory.splice(0, excess)
        }
    }

    function addSystemMessage(text) {
        const id = 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)
        messages.push({ id, role: 'system', content: text, isStreaming: false, isError: false, timestamp: Date.now() })
        renderMessages()
        scrollToBottom()
    }

    function updateMessage(id, content, isStreaming, isError = false) {
        const msg = messages.find(m => m.id === id)
        if (msg) {
            msg.content = content
            msg.isStreaming = isStreaming
            msg.isError = isError
            if (!isStreaming) {
                const histEntry = conversationHistory.find(h => h === msg._histRef)
                if (histEntry) histEntry.content = content
            }
            renderMessages()
            scrollToBottom()
        }
    }

    function renderMessages() {
        const container = $('#sp-messages')
        const emptyState = $('#sp-empty-state')

        if (messages.length === 0) {
            emptyState.classList.remove('hidden')
            return
        }

        emptyState.classList.add('hidden')

        messages.forEach(msg => {
            let el = container.querySelector(`[data-id="${msg.id}"]`)
            if (!el) {
                el = document.createElement('div')
                el.className = `sp-msg sp-msg-${msg.role}`
                el.dataset.id = msg.id
                container.insertBefore(el, emptyState)
            }

            if (msg.role === 'system') {
                el.innerHTML = `<div class="sp-msg-system"><svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm-4,48a12,12,0,1,1-12,12A12,12,0,0,1,124,72Zm12,112a16,16,0,0,1-16-16V128a8,8,0,0,1,0-16,16,16,0,0,1,16,16v40a8,8,0,0,1,0,16Z"/></svg><span>${escapeHtml(msg.content)}</span></div>`
            } else if (msg.role === 'user') {
                el.innerHTML = `<div class="sp-msg-content sp-msg-user-content">${escapeHtml(msg.content)}</div>`
            } else {
                let content = msg.content
                if (msg.isError) {
                    el.innerHTML = `<div class="sp-msg-content sp-msg-error-content"><svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M236.8,188.09,149.35,36.22a24.76,24.76,0,0,0-42.7,0L19.2,188.09a23.51,23.51,0,0,0,0,23.72A24.35,24.35,0,0,0,40.55,224h174.9a24.35,24.35,0,0,0,21.33-12.19A23.51,23.51,0,0,0,236.8,188.09ZM120,104a8,8,0,0,1,16,0v40a8,8,0,0,1-16,0Zm8,88a12,12,0,1,1,12-12A12,12,0,0,1,128,192Z"/></svg><span>${escapeHtml(content)}</span></div>`
                } else if (msg.isStreaming && !content) {
                    el.innerHTML = `<div class="sp-msg-content sp-msg-ai-content"><div class="sp-typing-indicator"><div class="sp-typing-dot"></div><div class="sp-typing-dot"></div><div class="sp-typing-dot"></div></div></div>`
                } else {
                    const rendered = formatMarkdown(content)
                    const shimmer = msg.isStreaming ? ' sp-streaming' : ''
                    const actions = msg.isStreaming ? '' : `<div class="sp-msg-actions"><button class="sp-msg-action-btn" onclick="sidepanel.copyMessage(this)" title="复制"><svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32ZM160,208H48V96H160Zm48-48H176V88a8,8,0,0,0-8-8H96V48H208Z"/></svg></button></div>`
                    el.innerHTML = `<div class="sp-msg-content sp-msg-ai-content${shimmer}">${rendered}</div>${actions}`
                }
            }
        })

        bindCodeCopyButtons()
    }

    function bindCodeCopyButtons() {
        document.querySelectorAll('.sp-code-copy-btn').forEach(btn => {
            if (btn.dataset.bound) return
            btn.dataset.bound = '1'
            btn.addEventListener('click', () => {
                const block = btn.closest('.sp-code-block')
                const code = block.querySelector('code').textContent
                navigator.clipboard.writeText(code).then(() => {
                    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z"/></svg>'
                    btn.classList.add('copied')
                    setTimeout(() => {
                        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32ZM160,208H48V96H160Zm48-48H176V88a8,8,0,0,0-8-8H96V48H208Z"/></svg>'
                        btn.classList.remove('copied')
                    }, 2000)
                })
            })
        })
    }

    function scrollToBottom() {
        const container = $('#sp-messages')
        requestAnimationFrame(() => {
            container.scrollTop = container.scrollHeight
        })
    }

    function updateGeneratingUI() {
        const sendBtn = $('#sp-btn-send')
        if (isGenerating) {
            sendBtn.classList.add('generating')
            sendBtn.title = '停止生成'
        } else {
            sendBtn.classList.remove('generating')
            sendBtn.title = '发送'
        }
    }

    function showAgentBanner(text) {
        const banner = $('#sp-agent-banner')
        $('#sp-agent-status-text').textContent = text || '智能体工作中...'
        banner.classList.remove('hidden')
    }

    function hideAgentBanner() {
        $('#sp-agent-banner').classList.add('hidden')
    }

    function handleStopAgent() {
        automationEngine.stop()
        agentLoopRunning = false
        if (chatService && sessionKey) {
            chatService.abortChat(sessionKey, '')
        }
        notifyAgentGroupState('idle')
        isGenerating = false
        updateGeneratingUI()
        hideAgentBanner()
        stopMonitoring()
        addSystemMessage(I18n.t('sys.stopped'))
    }

    function handleNewChat() {
        messages = []
        conversationHistory = []
        isGenerating = false
        pendingScreenshot = null

        if (chatService) {
            chatService.disconnect()
            chatService = null
            sessionKey = null
        }

        if (activeClaw) {
            chatService = new ChatService(activeClaw.gatewayUrl, activeClaw.gatewayToken)
        }

        renderMessages()
        updateGeneratingUI()
        hideAgentBanner()
    }

    async function handleScreenshot() {
        try {
            const result = await chrome.runtime.sendMessage({ type: 'AGENT_TAKE_SCREENSHOT' })
            if (result && result.dataUrl) {
                pendingScreenshot = result.dataUrl
                addSystemMessage(I18n.t('sys.screenshotCaptured'))
            } else {
                addSystemMessage(I18n.t('sys.screenshotFailed'))
            }
        } catch (e) {
            addSystemMessage(I18n.t('sys.screenshotError', { msg: e.message }))
        }
    }

    async function handleToggleRecord() {
        const btn = $('#sp-btn-record')
        if (isRecording) {
            const workflow = await workflowRecorder.stop()
            isRecording = false
            btn.classList.remove('recording')

            if (workflow && workflow.actions.length > 0) {
                const prompt = workflowRecorder.toPrompt()
                $('#sp-input').value = prompt
                addSystemMessage(I18n.t('sys.recorded', { count: workflow.actions.length, time: workflowRecorder.getFormattedElapsed() }))
            } else {
                addSystemMessage(I18n.t('sys.noRecording'))
            }
        } else {
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
                if (!tab) {
                    addSystemMessage(I18n.t('sys.noActiveTab'))
                    return
                }
                await workflowRecorder.start(tab.id)
                isRecording = true
                btn.classList.add('recording')
                addSystemMessage(I18n.t('sys.recordingStarted'))
            } catch (e) {
                addSystemMessage(I18n.t('sys.recordError', { msg: e.message }))
            }
        }
    }

    async function handleExport() {
        if (messages.length === 0) {
            addSystemMessage(I18n.t('sys.noExportContent'))
            return
        }

        const data = {
            version: '3.0.0',
            exportedAt: new Date().toISOString(),
            claw: activeClaw ? { id: activeClaw.id, name: activeClaw.name } : null,
            messages: messages.map(m => ({
                role: m.role,
                content: m.content,
                timestamp: m.timestamp
            }))
        }

        try {
            await chrome.runtime.sendMessage({
                type: 'EXPORT_CONVERSATION',
                data
            })
            addSystemMessage(I18n.t('sys.exported'))
        } catch (e) {
            addSystemMessage(I18n.t('sys.exportError', { msg: e.message }))
        }
    }

    function toggleShortcutsPanel() {
        const panel = $('#sp-shortcuts-panel')
        panel.classList.toggle('hidden')
        if (!panel.classList.contains('hidden')) {
            renderShortcutsList()
        }
    }

    function renderShortcutsList() {
        const query = $('#sp-shortcuts-search').value
        const shortcuts = query ? shortcutsManager.search(query) : shortcutsManager.getAll()
        const list = $('#sp-shortcuts-list')

        if (shortcuts.length === 0) {
            list.innerHTML = '<div class="sp-shortcuts-empty">暂无快捷方式</div>'
            return
        }

        list.innerHTML = shortcuts.map(s => `
            <div class="sp-shortcut-item" data-id="${s.id}">
                <div class="sp-shortcut-name">${escapeHtml(s.name)}</div>
                <div class="sp-shortcut-text">${escapeHtml(s.text)}</div>
            </div>
        `).join('')

        list.querySelectorAll('.sp-shortcut-item').forEach(el => {
            el.addEventListener('click', () => {
                const shortcut = shortcuts.find(s => s.id === el.dataset.id)
                if (shortcut) {
                    $('#sp-input').value = shortcut.text
                    shortcutsManager.incrementUse(shortcut.id)
                    toggleShortcutsPanel()
                    $('#sp-input').focus()
                }
            })
        })
    }

    function handleAddShortcut() {
        const input = $('#sp-input')
        const text = input.value.trim()

        if (!text) {
            addSystemMessage(I18n.t('sys.enterPromptFirst'))
            return
        }

        const name = text.length > 40 ? text.substring(0, 40) + '...' : text
        shortcutsManager.add(name, text)
        renderShortcutsList()
        addSystemMessage(I18n.t('sys.shortcutSaved'))
    }

    function toggleSchedulePanel() {
        const panel = $('#sp-schedule-panel')
        if (panel) {
            panel.classList.toggle('hidden')
            if (!panel.classList.contains('hidden')) {
                renderScheduledTasks()
            }
        }
    }

    function renderScheduledTasks() {
        const list = $('#sp-schedule-list')
        if (!list) return

        const tasks = taskScheduler.getAll()
        if (tasks.length === 0) {
            list.innerHTML = '<div class="sp-shortcuts-empty">' + I18n.t('sys.noScheduledTasks') + '</div>'
            return
        }

        list.innerHTML = tasks.map(t => `
            <div class="sp-shortcut-item sp-schedule-item" data-id="${t.id}">
                <div class="sp-schedule-row">
                    <div class="sp-shortcut-name">${escapeHtml(t.name)}</div>
                    <div class="sp-schedule-actions">
                        <button class="sp-schedule-toggle ${t.enabled ? 'enabled' : ''}" data-toggle="${t.id}" title="${t.enabled ? I18n.t('sys.enabled') : I18n.t('sys.disabled')}">
                            ${t.enabled ? '✓' : '✗'}
                        </button>
                        <button class="sp-schedule-delete" data-delete="${t.id}" title="${I18n.t('sys.delete')}">✕</button>
                    </div>
                </div>
                <div class="sp-shortcut-text">${escapeHtml(t.prompt.substring(0, 60))}</div>
                <div class="sp-schedule-meta">${I18n.t('sys.everyNMin', { n: t.intervalMinutes })} · ${I18n.t('sys.ranCount', { count: t.runCount || 0 })}${t.lastRun ? ' · ' + I18n.t('sys.lastRun') + new Date(t.lastRun).toLocaleString(I18n.getLang() === 'zh' ? 'zh-CN' : 'en-US') : ''}</div>
            </div>
        `).join('')

        list.querySelectorAll('[data-toggle]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation()
                await taskScheduler.toggle(btn.dataset.toggle)
                renderScheduledTasks()
            })
        })

        list.querySelectorAll('[data-delete]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation()
                await taskScheduler.remove(btn.dataset.delete)
                renderScheduledTasks()
            })
        })
    }

    async function handleAddScheduledTask() {
        const promptInput = $('#sp-schedule-prompt')
        const intervalInput = $('#sp-schedule-interval')
        if (!promptInput || !intervalInput) return

        const prompt = promptInput.value.trim()
        const interval = parseInt(intervalInput.value) || 60

        if (!prompt) {
            addSystemMessage(I18n.t('sys.enterTaskPrompt'))
            return
        }

        await taskScheduler.add(prompt, interval)
        promptInput.value = ''
        intervalInput.value = '60'
        renderScheduledTasks()
        addSystemMessage(I18n.t('sys.taskAdded', { interval: interval }))
    }

    async function handleScheduledTaskExec(task) {
        if (!activeClaw) {
            await loadClaws()
            if (!activeClaw) {
                addSystemMessage(I18n.t('sys.taskNoInstance'))
                return
            }
        }

        addSystemMessage(I18n.t('sys.taskExecuting', { name: task.name }))
        $('#sp-input').value = task.prompt
        await handleSend()
    }

    function showActionApproval(action) {
        notifyAgentGroupState('approval')
        const overlay = $('#sp-approval-overlay')
        $('#sp-approval-type').textContent = action.type
        $('#sp-approval-desc').textContent = automationEngine.describeAction(action)
        overlay.classList.remove('hidden')

        const hideOverlay = () => overlay.classList.add('hidden')
        const origApprove = permissionManager.approve.bind(permissionManager)
        const origDeny = permissionManager.deny.bind(permissionManager)
        const origApproveAll = permissionManager.approveAll.bind(permissionManager)

        permissionManager.approve = () => { hideOverlay(); origApprove() }
        permissionManager.deny = () => { hideOverlay(); origDeny() }
        permissionManager.approveAll = () => { hideOverlay(); origApproveAll() }
    }

    function showPlanApproval(plan) {
        notifyAgentGroupState('approval')
        const overlay = $('#sp-plan-overlay')
        const stepsEl = $('#sp-plan-steps')

        stepsEl.innerHTML = plan.steps.map((step, i) => `
            <div class="sp-plan-step">
                <span class="sp-plan-step-num">${i + 1}</span>
                <span class="sp-plan-step-text">${escapeHtml(step.description || step.type)}</span>
            </div>
        `).join('')

        overlay.classList.remove('hidden')

        const hideOverlay = () => overlay.classList.add('hidden')
        const origApprovePlan = permissionManager.approvePlanExecution.bind(permissionManager)
        const origRejectPlan = permissionManager.rejectPlan.bind(permissionManager)

        permissionManager.approvePlanExecution = () => { hideOverlay(); origApprovePlan() }
        permissionManager.rejectPlan = () => { hideOverlay(); origRejectPlan() }
    }

    function formatMarkdown(text) {
        if (!text) return ''

        const codeBlocks = []
        let processed = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
            const idx = codeBlocks.length
            codeBlocks.push({ lang, code })
            return `\x00CODEBLOCK_${idx}\x00`
        })

        const inlineCodes = []
        processed = processed.replace(/`([^`]+)`/g, (_, code) => {
            const idx = inlineCodes.length
            inlineCodes.push(code)
            return `\x00INLINE_${idx}\x00`
        })

        let html = escapeHtml(processed)

        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')

        html = html.replace(/^&gt;&gt;&gt; (.+)$/gm, '<blockquote>$1</blockquote>')
        html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')

        html = html.replace(/^### (.+)$/gm, '<h4 class="sp-md-heading">$1</h4>')
        html = html.replace(/^## (.+)$/gm, '<h3 class="sp-md-heading">$1</h3>')
        html = html.replace(/^# (.+)$/gm, '<h2 class="sp-md-heading">$1</h2>')

        html = html.replace(/^---$/gm, '<hr class="sp-md-hr">')

        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')

        html = html.replace(/(^|\n)((?:- .+(?:\n|$))+)/g, (_, before, block) => {
            const items = block.trim().split('\n').map(l => `<li>${l.replace(/^- /, '')}</li>`).join('')
            return `${before}<ul class="sp-md-list">${items}</ul>`
        })

        html = html.replace(/(^|\n)((?:\d+\. .+(?:\n|$))+)/g, (_, before, block) => {
            const items = block.trim().split('\n').map(l => `<li>${l.replace(/^\d+\. /, '')}</li>`).join('')
            return `${before}<ol class="sp-md-list">${items}</ol>`
        })

        codeBlocks.forEach((block, idx) => {
            const langLabel = block.lang ? `<span class="sp-code-lang">${escapeHtml(block.lang)}</span>` : ''
            const copyBtn = `<button class="sp-code-copy-btn" title="复制"><svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32ZM160,208H48V96H160Zm48-48H176V88a8,8,0,0,0-8-8H96V48H208Z"/></svg></button>`
            const replacement = `<div class="sp-code-block"><div class="sp-code-header">${langLabel}${copyBtn}</div><pre><code>${escapeHtml(block.code)}</code></pre></div>`
            html = html.replace(`\x00CODEBLOCK_${idx}\x00`, replacement)
        })

        inlineCodes.forEach((code, idx) => {
            html = html.replace(`\x00INLINE_${idx}\x00`, `<code class="sp-inline-code">${escapeHtml(code)}</code>`)
        })

        html = html.replace(/\n\n/g, '</p><p>')
        html = html.replace(/\n/g, '<br>')

        return html
    }

    function copyMessageText(btn) {
        const msgEl = btn.closest('.sp-msg')
        const msg = messages.find(m => m.id === msgEl.dataset.id)
        if (!msg) return
        navigator.clipboard.writeText(msg.content).then(() => {
            btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z"/></svg>'
            btn.classList.add('copied')
            setTimeout(() => {
                btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32ZM160,208H48V96H160Zm48-48H176V88a8,8,0,0,0-8-8H96V48H208Z"/></svg>'
                btn.classList.remove('copied')
            }, 2000)
        })
    }

    function escapeHtml(str) {
        const div = document.createElement('div')
        div.textContent = String(str || '')
        return div.innerHTML
    }

    return { init, copyMessage: copyMessageText }
})()

document.addEventListener('DOMContentLoaded', () => sidepanel.init())
