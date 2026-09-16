/**
 * E2E Browser Automation Test
 * 
 * Tests the full integration loop:
 *   1. Connect to OpenClaw gateway via WebSocket (same as Chrome extension)
 *   2. Launch Playwright browser as the "execution layer" (replacing the Chrome extension)
 *   3. Send chat message WITH real page context (screenshot + interactive elements)
 *   4. Parse AI response for ```action``` blocks (same regex as extension)
 *   5. Execute actions in Playwright browser
 *   6. Gather updated page state
 *   7. Send verification message back to AI
 *   8. Validate the full round-trip
 * 
 * Usage:
 *   node e2e-browser-automation.mjs                    # Run all tests
 *   node e2e-browser-automation.mjs --test=navigate    # Run navigation test only
 *   node e2e-browser-automation.mjs --test=search      # Run search interaction test
 *   node e2e-browser-automation.mjs --headless=false   # Show browser window
 */

import { webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { required, originFor } from './env.mjs'

const GATEWAY_URL = required('AGENTAURA_GATEWAY_URL', 'the gateway address to test against')
const GATEWAY_TOKEN = required('AGENTAURA_GATEWAY_TOKEN', 'the gateway auth token (never commit one)')
const MAX_AGENT_STEPS = 15
const ACTION_DELAY_MS = 500
const CHAT_TIMEOUT_MS = 120000

const args = Object.fromEntries(
    process.argv.slice(2).map(a => {
        const [k, v] = a.replace('--', '').split('=')
        return [k, v ?? 'true']
    })
)
const HEADLESS = args.headless !== 'false'
const TEST_FILTER = args.test || 'all'
const VERBOSE = args.verbose === 'true'

// ═══════════════════════════════════════════════════════════════
// Gateway WebSocket Client (mirrors chrome-extension/js/chat.js)
// ═══════════════════════════════════════════════════════════════

async function generateDeviceIdentity() {
    const keyPair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    const pubRaw = await webcrypto.subtle.exportKey('raw', keyPair.publicKey)
    const pubB64 = Buffer.from(pubRaw).toString('base64')
    const hashBuffer = await webcrypto.subtle.digest('SHA-256', pubRaw)
    const deviceId = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')
    return { keyPair, pubB64, deviceId }
}

async function signPayload(keyPair, message) {
    const sig = await webcrypto.subtle.sign('Ed25519', keyPair.privateKey, new TextEncoder().encode(message))
    return Buffer.from(sig).toString('base64')
}

class GatewayClient {
    constructor() {
        this.ws = null
        this.reqCounter = 0
        this.pendingRequests = {}
        this.eventListeners = {}
        this.sessionKey = null
        this.connected = false
        this.fullResponseText = ''
        this.page = null  // Playwright page for tool-event handling
    }

    setPage(page) { this.page = page }

    on(event, handler) {
        if (!this.eventListeners[event]) this.eventListeners[event] = []
        this.eventListeners[event].push(handler)
    }

    async connect() {
        const { default: WebSocket } = await import('ws')
        const device = await generateDeviceIdentity()

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Connection timeout')), 30000)

            this.ws = new WebSocket(GATEWAY_URL, {
                headers: { Origin: originFor(GATEWAY_URL) }
            })

            this.ws.on('error', (err) => {
                if (!this.connected) reject(err)
            })

            this.ws.on('message', async (raw) => {
                const data = JSON.parse(raw.toString())

                // Verbose: log ALL frames
                if (VERBOSE && data.type !== 'event') {
                    console.log(`  📦 [frame] ${data.type}:`, JSON.stringify(data).substring(0, 400))
                }
                if (VERBOSE && data.type === 'event' && data.event !== 'chat' && data.event !== 'connect.challenge') {
                    console.log(`  📦 [event] ${data.event}:`, JSON.stringify(data.payload || {}).substring(0, 400))
                }

                if (data.type === 'event') {
                    if (data.event === 'connect.challenge') {
                        const nonce = data.payload?.nonce || ''
                        const now = Date.now()
                        const signData = ['v2', device.deviceId, 'openclaw-control-ui', 'webchat', 'operator',
                            'operator.admin,operator.approvals,operator.pairing', now.toString(), GATEWAY_TOKEN, nonce].join('|')
                        const signature = await signPayload(device.keyPair, signData)

                        const id = this._nextId()
                        this.pendingRequests[id] = {
                            resolve: async () => {
                                clearTimeout(timeout)
                                this.connected = true
                                await this._discoverSession()
                                resolve()
                            },
                            reject: (e) => { clearTimeout(timeout); reject(e) }
                        }
                        this.ws.send(JSON.stringify({
                            type: 'req', id, method: 'connect',
                            params: {
                                minProtocol: 3, maxProtocol: 3,
                                client: { id: 'openclaw-control-ui', version: 'e2e-test', platform: 'chrome-extension', mode: 'webchat', instanceId: crypto.randomUUID() },
                                role: 'operator',
                                scopes: ['operator.admin', 'operator.approvals', 'operator.pairing'],
                                device: { id: device.deviceId, publicKey: device.pubB64, signature, signedAt: now, nonce },
                                caps: ['tool-events'],
                                auth: { token: GATEWAY_TOKEN }
                            }
                        }))
                        return
                    }

                    // Log ALL non-chat events for protocol discovery
                    if (data.event !== 'chat') {
                        console.log(`  📡 [event] ${data.event}:`, JSON.stringify(data.payload || {}).substring(0, 300))
                    }

                    // Handle tool events from gateway
                    if (data.event === 'tool' || data.event === 'tool.call' || data.event === 'tool-event' || data.event?.startsWith('tool')) {
                        await this._handleToolEvent(data)
                        return
                    }

                    // dispatch events to listeners
                    const listeners = this.eventListeners[data.event] || []
                    for (const l of listeners) l(data.payload)
                }

                // Handle tool-call requests (might come as type: 'req' from gateway)
                if (data.type === 'req' && data.method?.startsWith('tool')) {
                    console.log(`  🔧 [tool-req] ${data.method}:`, JSON.stringify(data.params || {}).substring(0, 300))
                    await this._handleToolRequest(data)
                    return
                }

                if (data.type === 'res') {
                    const pending = this.pendingRequests[data.id]
                    if (pending) {
                        delete this.pendingRequests[data.id]
                        if (data.ok) pending.resolve(data)
                        else pending.reject(new Error(JSON.stringify(data.payload || data)))
                    }
                }
            })

            this.ws.on('close', () => { this.connected = false })
        })
    }

    async _handleToolEvent(data) {
        console.log(`  🔧 [tool-event] ${data.event}:`, JSON.stringify(data.payload || {}).substring(0, 500))
        const payload = data.payload || {}
        const toolName = payload.tool || payload.name || payload.toolName || ''
        const callId = payload.callId || payload.id || ''
        const params = payload.params || payload.arguments || payload.input || {}

        if (!this.page) {
            console.log('  ⚠️  No page available for tool event')
            return
        }

        let result
        try {
            result = await this._executeToolCall(toolName, params)
        } catch (err) {
            result = { error: err.message }
        }

        // Send tool result back to gateway
        if (callId) {
            this.ws.send(JSON.stringify({
                type: 'req',
                id: this._nextId(),
                method: 'tool.result',
                params: { callId, result }
            }))
            console.log(`  📤 Sent tool.result for ${toolName} (callId: ${callId})`)
        }
    }

    async _handleToolRequest(data) {
        const method = data.method
        const params = data.params || {}
        const reqId = data.id

        console.log(`  🔧 [tool-request] ${method}:`, JSON.stringify(params).substring(0, 500))

        if (!this.page) {
            this._sendRes(reqId, false, { error: 'No browser page available' })
            return
        }

        let result
        try {
            result = await this._executeToolCall(params.tool || method, params)
        } catch (err) {
            result = { error: err.message }
        }

        this._sendRes(reqId, true, result)
    }

    async _executeToolCall(toolName, params) {
        const page = this.page
        console.log(`  🎯 Executing tool: ${toolName}`, JSON.stringify(params).substring(0, 200))

        switch (toolName) {
            case 'screenshot':
            case 'browser.screenshot':
            case 'computer': {
                const buf = await page.screenshot({ type: 'png' })
                return { image: buf.toString('base64'), mimeType: 'image/png' }
            }
            case 'navigate':
            case 'browser.navigate': {
                await page.goto(params.url, { waitUntil: 'domcontentloaded', timeout: 30000 })
                return { url: page.url(), title: await page.title() }
            }
            case 'click':
            case 'browser.click': {
                if (params.selector) await page.click(params.selector)
                else if (params.x !== undefined) await page.mouse.click(params.x, params.y)
                return { success: true }
            }
            case 'type':
            case 'browser.type': {
                if (params.selector) await page.fill(params.selector, params.text || '')
                else await page.keyboard.type(params.text || '')
                return { success: true }
            }
            case 'scroll':
            case 'browser.scroll': {
                const dy = params.direction === 'up' ? -(params.amount || 300) : (params.amount || 300)
                await page.mouse.wheel(0, dy)
                return { success: true }
            }
            default:
                return { error: `Unknown tool: ${toolName}` }
        }
    }

    _sendRes(reqId, ok, payload) {
        this.ws.send(JSON.stringify({ type: 'res', id: reqId, ok, payload }))
    }

    async _discoverSession() {
        // Try to use a fresh session to avoid stale conversation history
        const freshKey = `agent:main:e2e-${Date.now()}`
        console.log(`  Attempting fresh session: ${freshKey}`)
        
        // Also discover the existing session for reference
        const res = await this.sendReq('sessions.list', {})
        if (res.ok) {
            const sessions = Array.isArray(res.payload) ? res.payload : (res.payload?.sessions || [])
            console.log(`  Available sessions: ${sessions.map(s => s?.key || s?.sessionKey).join(', ')}`)
        }
        
        this.sessionKey = freshKey
    }

    sendReq(method, params) {
        const id = this._nextId()
        const frame = { type: 'req', id, method, params }
        this.ws.send(JSON.stringify(frame))
        return new Promise((resolve, reject) => {
            this.pendingRequests[id] = { resolve, reject }
            const timeoutMs = method === 'chat.send' ? CHAT_TIMEOUT_MS : 15000
            setTimeout(() => {
                delete this.pendingRequests[id]
                reject(new Error(`Timeout: ${method}`))
            }, timeoutMs)
        })
    }

    sendChat(message, attachments = []) {
        return new Promise((resolve, reject) => {
            this.fullResponseText = ''
            let streamDone = false

            const chatListener = (payload) => {
                if (payload.sessionKey && payload.sessionKey !== this.sessionKey) return

                const state = payload.state
                const delta = payload.delta || ''
                if (delta) {
                    this.fullResponseText += delta
                    process.stdout.write(delta)
                }

                if (state === 'final' || state === 'done' || state === 'complete') {
                    streamDone = true
                    const finalContent = payload.message?.content?.[0]?.text || this.fullResponseText
                    if (finalContent) this.fullResponseText = finalContent
                    process.stdout.write('\n')
                    this._removeListener('chat', chatListener)
                    resolve(this.fullResponseText)
                }

                if (state === 'error') {
                    this._removeListener('chat', chatListener)
                    reject(new Error(payload.error || 'Chat error'))
                }

                if (state === 'aborted') {
                    streamDone = true
                    process.stdout.write('\n')
                    this._removeListener('chat', chatListener)
                    resolve(this.fullResponseText)
                }
            }

            this.on('chat', chatListener)

            this.sendReq('chat.send', {
                sessionKey: this.sessionKey,
                message,
                deliver: true,
                timeoutMs: CHAT_TIMEOUT_MS,
                idempotencyKey: crypto.randomUUID(),
                ...(attachments.length ? { attachments } : {})
            }).catch(reject)
        })
    }

    _removeListener(event, handler) {
        const listeners = this.eventListeners[event]
        if (listeners) {
            this.eventListeners[event] = listeners.filter(l => l !== handler)
        }
    }

    _nextId() { return `req-${++this.reqCounter}` }

    close() { if (this.ws) this.ws.close() }
}

// ═══════════════════════════════════════════════════════════════
// Page Context Gatherer (mirrors extension's gatherPageContext)
// ═══════════════════════════════════════════════════════════════

async function gatherPageContext(page) {
    const url = page.url()
    const title = await page.title()

    // Get interactive elements with ref numbers (like extension's accessibility-tree.js)
    const interactiveElements = await page.evaluate(() => {
        const INTERACTIVE_SELECTORS = 'a, button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [onclick], [tabindex]'
        const elements = document.querySelectorAll(INTERACTIVE_SELECTORS)
        const results = []
        let ref = 1
        for (const el of elements) {
            const rect = el.getBoundingClientRect()
            if (rect.width === 0 || rect.height === 0) continue
            if (rect.bottom < 0 || rect.top > window.innerHeight) continue

            const tag = el.tagName.toLowerCase()
            const text = (el.textContent || '').trim().substring(0, 80)
            const type = el.getAttribute('type') || ''
            const role = el.getAttribute('role') || ''
            const placeholder = el.getAttribute('placeholder') || ''
            const name = el.getAttribute('name') || ''
            const href = el.getAttribute('href') || ''
            const ariaLabel = el.getAttribute('aria-label') || ''

            let desc = `[${ref}] <${tag}`
            if (type) desc += ` type="${type}"`
            if (role) desc += ` role="${role}"`
            if (name) desc += ` name="${name}"`
            if (placeholder) desc += ` placeholder="${placeholder}"`
            if (href) desc += ` href="${href.substring(0, 60)}"`
            if (ariaLabel) desc += ` aria-label="${ariaLabel}"`
            desc += `>`
            if (text && text.length > 0) desc += ` ${text.substring(0, 60)}`

            el.setAttribute('data-test-ref', String(ref))
            results.push({ ref, tag, text, type, desc })
            ref++
        }
        return results
    })

    // Take screenshot as base64
    const screenshotBuffer = await page.screenshot({ type: 'png', fullPage: false })
    const screenshotB64 = screenshotBuffer.toString('base64')
    const screenshotDataUrl = `data:image/png;base64,${screenshotB64}`

    const viewport = page.viewportSize()
    const elementList = interactiveElements.map(e => e.desc).join('\n')

    return {
        url,
        title,
        elements: interactiveElements,
        elementList,
        screenshotDataUrl,
        screenshotB64,
        viewport
    }
}

function buildAgentMessage(userText, context, isFirstMessage = false) {
    const parts = []

    if (isFirstMessage) {
        parts.push('NOTE: The browser automation Chrome extension is now connected and fully operational. The previous pairing errors have been resolved. Please use ```action``` blocks to control the browser.')
        parts.push('')
    }

    parts.push(userText)

    if (context) {
        parts.push(`\n[页面状态] URL: ${context.url}`)
        if (context.title) parts.push(`标题: ${context.title}`)
        if (context.screenshotDataUrl) parts.push('已附加当前页面截图，请结合截图判断页面状态和元素位置。')

        if (context.elementList) {
            parts.push(`\n[可交互元素] (共${context.elements.length}个, 视口${context.viewport.width}x${context.viewport.height})`)
            parts.push(context.elementList)
        }
    }

    return parts.join('\n')
}

function buildVerifyMessage(executedActions, context) {
    const parts = []
    parts.push('[已执行操作]')
    executedActions.forEach((a, i) => {
        parts.push(`${i + 1}. ${describeAction(a)}`)
    })

    if (context) {
        parts.push(`\n[页面状态] URL: ${context.url}`)
        if (context.title) parts.push(`标题: ${context.title}`)
        if (context.screenshotDataUrl) parts.push('已附加当前页面截图，请结合截图确认操作结果。')

        if (context.elementList) {
            parts.push(`\n[可交互元素] (共${context.elements.length}个)`)
            parts.push(context.elementList)
        }
    }

    parts.push('\n请判断任务状态并决定下一步。')
    return parts.join('\n')
}

function buildRecoveryMessage(failedAction, error, context) {
    const parts = []
    parts.push('[操作失败]')
    parts.push(`失败动作: ${describeAction(failedAction)}`)
    parts.push(`失败原因: ${error}`)

    if (context) {
        parts.push(`\n[页面状态] URL: ${context.url}`)
        if (context.title) parts.push(`标题: ${context.title}`)
        if (context.screenshotDataUrl) parts.push('已附加当前页面截图，请结合截图重新定位问题。')
        if (context.elementList) {
            parts.push(`\n[可交互元素] (共${context.elements.length}个)`)
            parts.push(context.elementList)
        }
    }

    parts.push('\n请分析失败原因并尝试其他方法。')
    return parts.join('\n')
}

function buildAttachments(context) {
    if (!context.screenshotB64) return []
    return [{
        type: 'image',
        mimeType: 'image/png',
        data: context.screenshotB64
    }]
}

// ═══════════════════════════════════════════════════════════════
// Action Parser & Executor (mirrors extension's extractActions + automation-engine)
// ═══════════════════════════════════════════════════════════════

function extractActions(text) {
    const actions = []
    const actionRegex = /```(?:action|json)\s*\n([\s\S]*?)```/g
    let match
    while ((match = actionRegex.exec(text)) !== null) {
        try {
            const parsed = JSON.parse(match[1].trim())
            if (parsed && parsed.type) actions.push(parsed)
            else if (Array.isArray(parsed)) parsed.forEach(a => { if (a && a.type) actions.push(a) })
        } catch (_) { }
    }

    if (actions.length === 0) {
        const bareJsonRegex = /\{[^{}]*"type"\s*:\s*"[^"]+?"[^{}]*\}/g
        let bareMatch
        while ((bareMatch = bareJsonRegex.exec(text)) !== null) {
            try {
                const parsed = JSON.parse(bareMatch[0])
                if (parsed && parsed.type) actions.push(parsed)
            } catch (_) { }
        }
    }

    return actions
}

function describeAction(action) {
    switch (action.type) {
        case 'navigate': return `导航到 ${action.url}`
        case 'click_ref': return `点击元素 [${action.ref}]`
        case 'type_ref': return `在元素 [${action.ref}] 输入 "${action.text}"`
        case 'hover_ref': return `悬停元素 [${action.ref}]`
        case 'click': return `点击 ${action.selector}`
        case 'type': return `在 ${action.selector} 输入 "${action.text}"`
        case 'new_tab': return `新标签打开 ${action.url}`
        case 'screenshot': return '截图'
        case 'scroll': return `滚动 ${action.direction} ${action.amount || 300}px`
        case 'wait': return `等待 ${action.duration || 1000}ms`
        case 'execute_js': return `执行JS: ${(action.code || '').substring(0, 50)}`
        case 'read_page_content': return '读取页面内容'
        case 'get_page_text': return '获取页面文本'
        case 'cdp_click': return `CDP点击 (${action.x}, ${action.y})`
        case 'cdp_key': return `CDP按键 ${action.key}`
        case 'cdp_type': return `CDP输入 "${action.text}"`
        default: return JSON.stringify(action)
    }
}

async function executeAction(page, action) {
    const type = action.type
    try {
        switch (type) {
            case 'navigate':
                await page.goto(action.url, { waitUntil: 'domcontentloaded', timeout: 30000 })
                return { success: true }

            case 'new_tab': {
                const ctx = page.context()
                const newPage = await ctx.newPage()
                await newPage.goto(action.url, { waitUntil: 'domcontentloaded', timeout: 30000 })
                return { success: true, newPage }
            }

            case 'click_ref': {
                const el = page.locator(`[data-test-ref="${action.ref}"]`)
                await el.click({ timeout: 5000 })
                return { success: true }
            }

            case 'type_ref': {
                const el = page.locator(`[data-test-ref="${action.ref}"]`)
                if (action.clear !== false) await el.fill('')
                await el.fill(action.text || '')
                return { success: true }
            }

            case 'hover_ref': {
                const el = page.locator(`[data-test-ref="${action.ref}"]`)
                await el.hover({ timeout: 5000 })
                return { success: true }
            }

            case 'click': {
                await page.click(action.selector, { timeout: 5000 })
                return { success: true }
            }

            case 'type': {
                if (action.clear !== false) await page.fill(action.selector, '')
                await page.fill(action.selector, action.text || '')
                return { success: true }
            }

            case 'screenshot': {
                const buf = await page.screenshot({ type: 'png' })
                return { success: true, screenshot: buf.toString('base64') }
            }

            case 'scroll': {
                const dir = action.direction || 'down'
                const amount = action.amount || 300
                const deltaX = dir === 'right' ? amount : dir === 'left' ? -amount : 0
                const deltaY = dir === 'down' ? amount : dir === 'up' ? -amount : 0
                await page.mouse.wheel(deltaX, deltaY)
                return { success: true }
            }

            case 'wait': {
                await new Promise(r => setTimeout(r, action.duration || 1000))
                return { success: true }
            }

            case 'execute_js': {
                const result = await page.evaluate(action.code)
                return { success: true, result }
            }

            case 'read_page_content':
            case 'get_page_text': {
                const text = await page.evaluate(() => document.body.innerText)
                return { success: true, text: text.substring(0, 5000) }
            }

            case 'cdp_click': {
                const cdp = await page.context().newCDPSession(page)
                await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: action.x, y: action.y, button: 'left', clickCount: 1 })
                await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: action.x, y: action.y, button: 'left', clickCount: 1 })
                await cdp.detach()
                return { success: true }
            }

            case 'cdp_key': {
                await page.keyboard.press(action.key)
                return { success: true }
            }

            case 'cdp_type': {
                await page.keyboard.type(action.text || '')
                return { success: true }
            }

            case 'list_tabs': {
                const pages = page.context().pages()
                const tabs = pages.map((p, i) => ({ id: i + 1, title: p.url(), active: p === page }))
                return { success: true, tabs }
            }

            case 'select_tab': {
                const pages = page.context().pages()
                const target = pages[action.targetTabId - 1]
                if (target) {
                    await target.bringToFront()
                    return { success: true, page: target }
                }
                return { success: false, error: `Tab ${action.targetTabId} not found` }
            }

            default:
                return { success: false, error: `Unknown action type: ${type}` }
        }
    } catch (err) {
        return { success: false, error: err.message }
    }
}

// ═══════════════════════════════════════════════════════════════
// Test Runner
// ═══════════════════════════════════════════════════════════════

class TestResults {
    constructor() {
        this.tests = []
        this.startTime = Date.now()
    }

    add(name, passed, details = '') {
        this.tests.push({ name, passed, details })
        const icon = passed ? '✅' : '❌'
        console.log(`  ${icon} ${name}${details ? ` — ${details}` : ''}`)
    }

    summary() {
        const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1)
        const passed = this.tests.filter(t => t.passed).length
        const failed = this.tests.filter(t => !t.passed).length
        console.log('\n' + '═'.repeat(60))
        console.log(`📊 Test Results: ${passed} passed, ${failed} failed (${elapsed}s)`)
        console.log('═'.repeat(60))
        if (failed > 0) {
            console.log('\nFailed tests:')
            this.tests.filter(t => !t.passed).forEach(t => console.log(`  ❌ ${t.name}: ${t.details}`))
        }
        return failed === 0
    }
}

async function runAgentLoop(gateway, page, userMessage, testName) {
    const results = new TestResults()
    let stepCount = 0
    let currentPage = page

    console.log(`\n${'─'.repeat(60)}`)
    console.log(`🧪 Test: ${testName}`)
    console.log(`📝 Prompt: "${userMessage}"`)
    console.log('─'.repeat(60))

    // Step 1: Gather initial page context
    console.log('\n📷 Gathering page context...')
    let context = await gatherPageContext(currentPage)
    results.add('Page context gathered', !!context.url, `URL: ${context.url}, Elements: ${context.elements.length}`)

    // Step 2: Build agent message (like extension's buildAgentMessage)
    const agentMsg = buildAgentMessage(userMessage, context, true)
    const attachments = buildAttachments(context)
    results.add('Agent message built', agentMsg.length > 0, `${agentMsg.length} chars, ${attachments.length} attachments`)

    // Step 3: Send to AI via gateway
    console.log('\n💬 Sending to AI (waiting for response)...\n')
    let aiResponse
    try {
        aiResponse = await gateway.sendChat(agentMsg, attachments)
        console.log(`\n📨 AI Response (${(aiResponse || '').length} chars):`)
        console.log('┌' + '─'.repeat(58) + '┐')
        console.log((aiResponse || '').substring(0, 2000))
        console.log('└' + '─'.repeat(58) + '┘')
        results.add('AI response received', !!aiResponse, `${(aiResponse || '').length} chars`)
    } catch (err) {
        results.add('AI response received', false, err.message)
        return results
    }

    // Step 4: Agent loop (extract → execute → verify → repeat)
    while (stepCount < MAX_AGENT_STEPS) {
        stepCount++
        console.log(`\n🔄 Agent step ${stepCount}/${MAX_AGENT_STEPS}`)

        // Extract actions from AI response
        const actions = extractActions(aiResponse)
        console.log(`   Actions found: ${actions.length}`)
        if (actions.length > 0) {
            actions.forEach((a, i) => console.log(`   ${i + 1}. ${describeAction(a)}`))
        }

        results.add(`Step ${stepCount}: action extraction`, true, `${actions.length} actions found`)

        // If no actions, AI is done (just text response)
        if (actions.length === 0) {
            console.log('   ℹ️  No actions — AI completed task with text response')
            results.add('AI task completion', true, 'No further actions needed')
            break
        }

        // Execute each action
        const executedActions = []
        let failedAction = null
        let failedError = null

        for (let i = 0; i < actions.length; i++) {
            const action = actions[i]
            console.log(`   ▶ Executing: ${describeAction(action)}`)

            const result = await executeAction(currentPage, action)

            if (result.newPage) currentPage = result.newPage
            if (result.page) currentPage = result.page

            if (result.success) {
                executedActions.push(action)
                results.add(`Execute: ${describeAction(action)}`, true)
                console.log(`   ✓ Success`)
            } else {
                failedAction = action
                failedError = result.error
                results.add(`Execute: ${describeAction(action)}`, false, result.error)
                console.log(`   ✗ Failed: ${result.error}`)
                break
            }

            // Small delay between actions (like extension's 300ms)
            if (i < actions.length - 1) {
                await new Promise(r => setTimeout(r, ACTION_DELAY_MS))
            }
        }

        // Gather updated context
        console.log('   📷 Gathering updated page context...')
        await new Promise(r => setTimeout(r, 500))
        context = await gatherPageContext(currentPage)

        // Build verification or recovery message
        let nextMsg
        const nextAttachments = buildAttachments(context)

        if (failedAction) {
            nextMsg = buildRecoveryMessage(failedAction, failedError, context)
            console.log('   ⚠️  Sending recovery message to AI...\n')
        } else {
            nextMsg = buildVerifyMessage(executedActions, context)
            console.log('   📤 Sending verification message to AI...\n')
        }

        // Send follow-up to AI
        try {
            aiResponse = await gateway.sendChat(nextMsg, nextAttachments)
            console.log(`\n📨 AI Follow-up (${(aiResponse || '').length} chars):`)
            console.log((aiResponse || '').substring(0, 1000))
            results.add(`Step ${stepCount}: AI follow-up`, true, `${(aiResponse || '').length} chars`)
        } catch (err) {
            results.add(`Step ${stepCount}: AI follow-up`, false, err.message)
            break
        }
    }

    if (stepCount >= MAX_AGENT_STEPS) {
        results.add('Loop completed within step limit', false, `Hit max ${MAX_AGENT_STEPS} steps`)
    }

    return results
}

// ═══════════════════════════════════════════════════════════════
// Test Cases
// ═══════════════════════════════════════════════════════════════

async function testNavigateAndRead(gateway, page) {
    return runAgentLoop(
        gateway, page,
        'Go to https://example.com and tell me what the main heading says on the page. Use browser automation to navigate there.',
        'Navigate to example.com and read heading'
    )
}

async function testSearchInteraction(gateway, page) {
    return runAgentLoop(
        gateway, page,
        'Go to https://www.google.com, search for "OpenClaw hosting", and tell me the first 3 search results. Use browser automation actions.',
        'Google search interaction'
    )
}

async function testFormInteraction(gateway, page) {
    return runAgentLoop(
        gateway, page,
        'Navigate to https://httpbin.org/forms/post and fill in the form: set Customer name to "Test User", set Size to Large, set Topping to Cheese, then tell me what fields you see. Use browser automation.',
        'Form filling interaction'
    )
}

async function testMultiStepNavigation(gateway, page) {
    return runAgentLoop(
        gateway, page,
        'Go to https://en.wikipedia.org, search for "TypeScript", and tell me the first paragraph of the article. Use browser automation to navigate and interact with the search.',
        'Multi-step Wikipedia navigation'
    )
}

async function testActionParsing() {
    console.log(`\n${'─'.repeat(60)}`)
    console.log('🧪 Test: Action block parsing (offline)')
    console.log('─'.repeat(60))

    const results = new TestResults()

    // Test 1: Standard action block
    const text1 = "I'll navigate to the page.\n```action\n{\"type\": \"navigate\", \"url\": \"https://example.com\"}\n```"
    const actions1 = extractActions(text1)
    results.add('Parse standard action block', actions1.length === 1 && actions1[0].type === 'navigate')

    // Test 2: Multiple action blocks
    const text2 = "Let me do two things.\n```action\n{\"type\": \"navigate\", \"url\": \"https://example.com\"}\n```\nNow clicking.\n```action\n{\"type\": \"click_ref\", \"ref\": 5}\n```"
    const actions2 = extractActions(text2)
    results.add('Parse multiple action blocks', actions2.length === 2, `Found ${actions2.length}`)

    // Test 3: JSON block format
    const text3 = "```json\n{\"type\": \"type_ref\", \"ref\": 3, \"text\": \"hello world\"}\n```"
    const actions3 = extractActions(text3)
    results.add('Parse json block format', actions3.length === 1 && actions3[0].type === 'type_ref')

    // Test 4: Bare JSON fallback
    const text4 = 'Okay, here is what I\'ll do: {"type": "click_ref", "ref": 42}'
    const actions4 = extractActions(text4)
    results.add('Parse bare JSON fallback', actions4.length === 1 && actions4[0].ref === 42)

    // Test 5: No actions
    const text5 = "The page shows a heading that says 'Example Domain'. Task complete."
    const actions5 = extractActions(text5)
    results.add('No actions in text response', actions5.length === 0)

    // Test 6: Array format
    const text6 = '```action\n[{"type": "navigate", "url": "https://example.com"}, {"type": "wait", "duration": 1000}]\n```'
    const actions6 = extractActions(text6)
    results.add('Parse array action block', actions6.length === 2, `Found ${actions6.length}`)

    // Test 7: Invalid JSON gracefully handled
    const text7 = '```action\n{invalid json}\n```'
    const actions7 = extractActions(text7)
    results.add('Handle invalid JSON gracefully', actions7.length === 0)

    return results
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════

async function main() {
    console.log('═'.repeat(60))
    console.log('🚀 E2E Browser Automation Test')
    console.log(`   Gateway: ${GATEWAY_URL}`)
    console.log(`   Headless: ${HEADLESS}`)
    console.log(`   Test filter: ${TEST_FILTER}`)
    console.log('═'.repeat(60))

    const allResults = []

    // Offline tests (no gateway/browser needed)
    if (TEST_FILTER === 'all' || TEST_FILTER === 'parse') {
        const parseResults = await testActionParsing()
        allResults.push(parseResults)
    }

    // Online tests need gateway + browser
    const needsOnline = TEST_FILTER === 'all' || ['navigate', 'search', 'form', 'wiki'].includes(TEST_FILTER)

    if (needsOnline) {
        // Connect to gateway
        console.log('\n🔌 Connecting to gateway...')
        const gateway = new GatewayClient()
        try {
            await gateway.connect()
            console.log(`✅ Gateway connected, session: ${gateway.sessionKey}`)
        } catch (err) {
            console.error('❌ Gateway connection failed:', err.message)
            process.exit(1)
        }

        // Launch browser
        console.log('\n🌐 Launching Playwright browser...')
        const { chromium } = await import('playwright')
        const browser = await chromium.launch({
            headless: HEADLESS,
            args: ['--window-size=1280,720']
        })
        const context = await browser.newContext({
            viewport: { width: 1280, height: 720 },
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
        })
        const page = await context.newPage()

        // Navigate to a starting page
        await page.goto('about:blank')
        console.log('✅ Browser ready')

        // Wire Playwright page to gateway for tool-event handling
        gateway.setPage(page)

        try {
            if (TEST_FILTER === 'all' || TEST_FILTER === 'navigate') {
                allResults.push(await testNavigateAndRead(gateway, page))
            }
            if (TEST_FILTER === 'all' || TEST_FILTER === 'search') {
                allResults.push(await testSearchInteraction(gateway, page))
            }
            if (TEST_FILTER === 'all' || TEST_FILTER === 'form') {
                allResults.push(await testFormInteraction(gateway, page))
            }
            if (TEST_FILTER === 'all' || TEST_FILTER === 'wiki') {
                allResults.push(await testMultiStepNavigation(gateway, page))
            }
        } finally {
            await browser.close()
            gateway.close()
        }
    }

    // Final summary
    console.log('\n\n' + '═'.repeat(60))
    console.log('📋 FINAL SUMMARY')
    console.log('═'.repeat(60))

    let totalPassed = 0
    let totalFailed = 0
    for (const r of allResults) {
        totalPassed += r.tests.filter(t => t.passed).length
        totalFailed += r.tests.filter(t => !t.passed).length
    }

    console.log(`\n   Total: ${totalPassed} passed, ${totalFailed} failed`)

    if (totalFailed > 0) {
        console.log('\n   Failed:')
        for (const r of allResults) {
            r.tests.filter(t => !t.passed).forEach(t => console.log(`     ❌ ${t.name}: ${t.details}`))
        }
    }

    console.log('\n' + '═'.repeat(60))
    process.exit(totalFailed > 0 ? 1 : 0)
}

main().catch(err => {
    console.error('💀 Fatal error:', err)
    process.exit(1)
})
