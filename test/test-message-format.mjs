/**
 * Test the exact message format from updated buildAgentMessage() + full agent loop
 */

import { webcrypto } from 'node:crypto'

import { required, originFor } from './env.mjs'

const GATEWAY_URL = required('AGENTAURA_GATEWAY_URL', 'the gateway address to test against')
const GATEWAY_TOKEN = required('AGENTAURA_GATEWAY_TOKEN', 'the gateway auth token (never commit one)')

class GatewayClient {
    constructor() { this.ws = null; this.reqCounter = 0; this.pendingRequests = {}; this.chatListeners = []; this.connected = false }
    async connect() {
        const { default: WebSocket } = await import('ws')
        const keyPair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
        const pubRaw = await webcrypto.subtle.exportKey('raw', keyPair.publicKey)
        const pubB64 = Buffer.from(pubRaw).toString('base64')
        const hashBuf = await webcrypto.subtle.digest('SHA-256', pubRaw)
        const deviceId = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('')
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Connection timeout')), 30000)
            this.ws = new WebSocket(GATEWAY_URL, { headers: { Origin: originFor(GATEWAY_URL) } })
            this.ws.on('error', err => { if (!this.connected) reject(err) })
            this.ws.on('message', async (raw) => {
                const data = JSON.parse(raw.toString())
                if (data.type === 'event') {
                    if (data.event === 'connect.challenge') {
                        const nonce = data.payload?.nonce || ''; const now = Date.now()
                        const sp = ['v2', deviceId, 'openclaw-control-ui', 'webchat', 'operator', 'operator.admin,operator.approvals,operator.pairing', now.toString(), GATEWAY_TOKEN, nonce].join('|')
                        const sig = await webcrypto.subtle.sign('Ed25519', keyPair.privateKey, new TextEncoder().encode(sp))
                        const id = this._nextId()
                        this.pendingRequests[id] = { resolve: () => { clearTimeout(timeout); this.connected = true; resolve() }, reject: e => { clearTimeout(timeout); reject(e) } }
                        this.ws.send(JSON.stringify({ type: 'req', id, method: 'connect', params: { minProtocol: 3, maxProtocol: 3, client: { id: 'openclaw-control-ui', version: 'msg-fmt-test', platform: 'chrome-extension', mode: 'webchat', instanceId: crypto.randomUUID() }, role: 'operator', scopes: ['operator.admin', 'operator.approvals', 'operator.pairing'], device: { id: deviceId, publicKey: pubB64, signature: Buffer.from(sig).toString('base64'), signedAt: now, nonce }, caps: ['tool-events'], auth: { token: GATEWAY_TOKEN } } }))
                        return
                    }
                    if (data.event === 'chat') { for (const l of this.chatListeners) l(data.payload) }
                }
                if (data.type === 'res') { const p = this.pendingRequests[data.id]; if (p) { delete this.pendingRequests[data.id]; if (data.ok) p.resolve(data); else p.reject(data) } }
            })
            this.ws.on('close', () => { this.connected = false })
        })
    }
    sendReq(method, params = {}, timeoutMs = 15000) {
        const id = this._nextId()
        this.ws.send(JSON.stringify({ type: 'req', id, method, params }))
        return new Promise((resolve, reject) => { this.pendingRequests[id] = { resolve, reject }; setTimeout(() => { delete this.pendingRequests[id]; reject(new Error(`timeout: ${method}`)) }, timeoutMs) })
    }
    sendChat(sessionKey, message, timeoutMs = 90000) {
        return new Promise((resolve, reject) => {
            let fullText = ''
            const listener = (payload) => {
                if (payload.sessionKey && payload.sessionKey !== sessionKey) return
                if (payload.delta) fullText += payload.delta
                if (['final', 'done', 'complete', 'aborted'].includes(payload.state)) {
                    const text = payload.message?.content?.[0]?.text || fullText
                    this.chatListeners = this.chatListeners.filter(l => l !== listener); resolve(text || fullText)
                }
                if (payload.state === 'error') { this.chatListeners = this.chatListeners.filter(l => l !== listener); reject(new Error(payload.error || 'Chat error')) }
            }
            this.chatListeners.push(listener)
            this.sendReq('chat.send', { sessionKey, message, deliver: true, timeoutMs, idempotencyKey: crypto.randomUUID() }, timeoutMs).catch(reject)
            setTimeout(() => { this.chatListeners = this.chatListeners.filter(l => l !== listener); resolve(fullText) }, timeoutMs)
        })
    }
    _nextId() { return `req-${++this.reqCounter}` }
    close() { if (this.ws) this.ws.close() }
}

function extractActions(text) {
    const actions = []
    const actionRegex = /```(?:action|json)\s*\n([\s\S]*?)```/g
    let match
    while ((match = actionRegex.exec(text)) !== null) {
        try {
            const parsed = JSON.parse(match[1].trim())
            if (Array.isArray(parsed)) parsed.forEach(a => { if (a.type) actions.push(a) })
            else if (parsed.type) actions.push(parsed)
        } catch (_) {}
    }
    return actions
}

async function executeAction(gw, action) {
    switch (action.type) {
        case 'navigate': {
            await gw.sendReq('browser.request', { method: 'POST', path: '/start' })
            const nav = await gw.sendReq('browser.request', { method: 'POST', path: '/navigate', body: { url: action.url } })
            await new Promise(r => setTimeout(r, 2000))
            const tabs = await gw.sendReq('browser.request', { method: 'GET', path: '/tabs' })
            return `[Action Result] navigate: success\n  URL: ${tabs.payload?.tabs?.[0]?.url}\n  Title: ${tabs.payload?.tabs?.[0]?.title}`
        }
        case 'screenshot': {
            const ss = await gw.sendReq('browser.request', { method: 'POST', path: '/screenshot' })
            const tabs = await gw.sendReq('browser.request', { method: 'GET', path: '/tabs' })
            return `[Action Result] screenshot: success\n  URL: ${tabs.payload?.tabs?.[0]?.url}\n  Title: ${tabs.payload?.tabs?.[0]?.title}\n  Screenshot saved`
        }
        default:
            return `[Action Result] ${action.type}: not supported in test`
    }
}

// Simulate buildAgentMessage from the updated extension
function buildTestMessage(userText) {
    const parts = []
    parts.push('[System] You are controlling a browser through this Chrome extension.')
    parts.push('The built-in browser tool is broken in this environment and will fail with pairing errors.')
    parts.push('Never call any built-in browser tool. Control the page only by emitting JSON action blocks.')
    parts.push('')
    parts.push('Action block format:')
    parts.push('```action')
    parts.push('{"type": "navigate", "url": "https://..."}')
    parts.push('```')
    parts.push('')
    parts.push('Allowed action types:')
    parts.push('navigate, new_tab, select_tab, list_tabs, click_ref, type_ref, hover_ref, click, type, cdp_key, cdp_click, screenshot, read_page_content, get_page_text, scroll, wait, execute_js.')
    parts.push('')
    parts.push('Rules:')
    parts.push('1. Prefer click_ref/type_ref when the page exposes [ref] ids.')
    parts.push('2. Do one or two actions at a time, then wait for results.')
    parts.push('3. If an action fails, choose a different action instead of repeating the same failure.')
    parts.push('4. When the task is complete, stop emitting actions and provide a plain-text summary.')
    parts.push('')
    parts.push(userText)
    parts.push('')
    parts.push('[页面状态] URL: chrome://newtab')
    parts.push('标题: New Tab')
    return parts.join('\n')
}

async function main() {
    console.log('🧪 Testing updated buildAgentMessage format\n')

    // First restore browser config
    const gw = new GatewayClient()
    console.log('🔌 Connecting...')
    await gw.connect()
    console.log('✅ Connected\n')

    // Restore browser.enabled = true
    try {
        const configRes = await gw.sendReq('config.get')
        const raw = configRes.payload?.raw || ''
        if (raw.includes('enabled: false')) {
            const restored = raw.replace(/browser:\s*\{[\s\S]*?enabled:\s*false/m, 'browser: {\n    enabled: true')
            const hash = configRes.payload?.hash
            await gw.sendReq('config.set', { raw: restored, baseHash: hash })
            console.log('🔧 Restored browser.enabled = true ✅')
        } else {
            console.log('ℹ️  Browser already enabled')
        }
    } catch (e) { console.log(`  Config restore: ${e.message}`) }

    // Start browser
    try {
        await gw.sendReq('browser.request', { method: 'POST', path: '/start' })
        console.log('🌐 Browser started ✅\n')
    } catch (_) {}

    // === TEST 1: Navigate task ===
    console.log('═══ Test 1: Navigate to example.com ═══')
    const session1 = `agent:main:fmt-${Date.now()}`
    const msg1 = buildTestMessage('Navigate to https://example.com and tell me the main heading.')
    console.log(`  📤 Message (${msg1.length} chars): ${msg1.substring(0, 200)}...`)

    let response1 = await gw.sendChat(session1, msg1)
    console.log(`  📥 Response (${response1.length} chars): ${response1.substring(0, 300)}`)
    
    let actions1 = extractActions(response1)
    console.log(`  🔍 Actions: ${actions1.length}`)
    
    if (actions1.length > 0) {
        console.log(`  ✅ AI used action blocks!`)
        const results = []
        for (const action of actions1) {
            console.log(`  🎯 ${action.type}: ${action.url || ''}`)
            const result = await executeAction(gw, action)
            results.push(result)
            console.log(`  ${result.split('\n')[0]}`)
        }
        
        // Feed results back
        const resultMsg = results.join('\n')
        const response2 = await gw.sendChat(session1, resultMsg)
        console.log(`  📥 Follow-up: ${response2.substring(0, 300)}`)
        
        const gotAnswer = response2.includes('Example Domain')
        console.log(`  ✅ Correct answer: ${gotAnswer ? 'YES!' : 'NO'}`)
    } else {
        console.log(`  ❌ AI did NOT use action blocks`)
        console.log(`  Pairing error: ${response1.toLowerCase().includes('pairing') ? 'YES' : 'NO'}`)
    }

    // === TEST 2: Multi-step task ===
    console.log('\n═══ Test 2: Multi-step (search Wikipedia) ═══')
    const session2 = `agent:main:fmt2-${Date.now()}`
    const msg2 = buildTestMessage('Go to https://en.wikipedia.org, read the main page, and tell me what today\'s featured article is about.')
    
    let currentResponse = await gw.sendChat(session2, msg2)
    console.log(`  📥 Response: ${currentResponse.substring(0, 200)}`)
    
    let loopCount = 0
    const MAX_LOOPS = 4
    
    while (loopCount < MAX_LOOPS) {
        const actions = extractActions(currentResponse)
        if (actions.length === 0) {
            console.log(`  ✅ AI finished (no more actions)`)
            console.log(`  📝 Final: ${currentResponse.substring(0, 300)}`)
            break
        }
        
        loopCount++
        console.log(`  🔄 Loop ${loopCount}: ${actions.length} actions`)
        
        const results = []
        for (const action of actions) {
            console.log(`    🎯 ${action.type}: ${action.url || ''}`)
            const result = await executeAction(gw, action)
            results.push(result)
        }
        
        currentResponse = await gw.sendChat(session2, results.join('\n'))
        console.log(`  📥 Response: ${currentResponse.substring(0, 200)}`)
    }

    // === SUMMARY ===
    console.log('\n╔════════════════════════════════════════╗')
    console.log('║  📊 FORMAT TEST RESULTS                ║')
    console.log('╚════════════════════════════════════════╝')
    console.log(`  Test 1 (navigate):  ${actions1.length > 0 ? '✅ PASS' : '❌ FAIL'}`)
    console.log(`  Test 2 (multi-step): ${loopCount > 0 ? `✅ PASS (${loopCount} loops)` : '❌ FAIL'}`)

    gw.close()
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
