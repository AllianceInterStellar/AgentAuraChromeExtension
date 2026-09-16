/**
 * Full Agent Loop Test
 * 
 * Simulates the Chrome extension's agent loop:
 *   AI generates action blocks → Extension executes → Feeds result back → AI continues
 * 
 * Uses browser.request API for server-side execution (same as extension would do locally)
 */

import { webcrypto } from 'node:crypto'

import { required, originFor } from './env.mjs'

const GATEWAY_URL = required('AGENTAURA_GATEWAY_URL', 'the gateway address to test against')
const GATEWAY_TOKEN = required('AGENTAURA_GATEWAY_TOKEN', 'the gateway auth token (never commit one)')

class GatewayClient {
    constructor() {
        this.ws = null
        this.reqCounter = 0
        this.pendingRequests = {}
        this.chatListeners = []
        this.connected = false
    }

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
                        const nonce = data.payload?.nonce || ''
                        const now = Date.now()
                        const sp = ['v2', deviceId, 'openclaw-control-ui', 'webchat', 'operator',
                            'operator.admin,operator.approvals,operator.pairing', now.toString(), GATEWAY_TOKEN, nonce].join('|')
                        const sig = await webcrypto.subtle.sign('Ed25519', keyPair.privateKey, new TextEncoder().encode(sp))
                        const id = this._nextId()
                        this.pendingRequests[id] = {
                            resolve: () => { clearTimeout(timeout); this.connected = true; resolve() },
                            reject: e => { clearTimeout(timeout); reject(e) }
                        }
                        this.ws.send(JSON.stringify({
                            type: 'req', id, method: 'connect',
                            params: {
                                minProtocol: 3, maxProtocol: 3,
                                client: { id: 'openclaw-control-ui', version: 'agent-loop', platform: 'chrome-extension', mode: 'webchat', instanceId: crypto.randomUUID() },
                                role: 'operator', scopes: ['operator.admin', 'operator.approvals', 'operator.pairing'],
                                device: { id: deviceId, publicKey: pubB64, signature: Buffer.from(sig).toString('base64'), signedAt: now, nonce },
                                caps: ['tool-events'], auth: { token: GATEWAY_TOKEN }
                            }
                        }))
                        return
                    }
                    if (data.event === 'chat') {
                        for (const l of this.chatListeners) l(data.payload)
                    }
                }
                if (data.type === 'res') {
                    const p = this.pendingRequests[data.id]
                    if (p) { delete this.pendingRequests[data.id]; if (data.ok) p.resolve(data); else p.reject(data) }
                }
            })
            this.ws.on('close', () => { this.connected = false })
        })
    }

    sendReq(method, params = {}, timeoutMs = 15000) {
        const id = this._nextId()
        this.ws.send(JSON.stringify({ type: 'req', id, method, params }))
        return new Promise((resolve, reject) => {
            this.pendingRequests[id] = { resolve, reject }
            setTimeout(() => { delete this.pendingRequests[id]; reject(new Error(`timeout: ${method}`)) }, timeoutMs)
        })
    }

    sendChat(sessionKey, message, timeoutMs = 90000) {
        return new Promise((resolve, reject) => {
            let fullText = ''
            const listener = (payload) => {
                if (payload.sessionKey && payload.sessionKey !== sessionKey) return
                if (payload.delta) fullText += payload.delta
                if (['final', 'done', 'complete', 'aborted'].includes(payload.state)) {
                    const text = payload.message?.content?.[0]?.text || fullText
                    this.chatListeners = this.chatListeners.filter(l => l !== listener)
                    resolve(text || fullText)
                }
                if (payload.state === 'error') {
                    this.chatListeners = this.chatListeners.filter(l => l !== listener)
                    reject(new Error(payload.error || 'Chat error'))
                }
            }
            this.chatListeners.push(listener)
            this.sendReq('chat.send', {
                sessionKey, message, deliver: true,
                timeoutMs, idempotencyKey: crypto.randomUUID()
            }, timeoutMs).catch(reject)
            setTimeout(() => {
                this.chatListeners = this.chatListeners.filter(l => l !== listener)
                resolve(fullText)
            }, timeoutMs)
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
    console.log(`    🎯 Executing: ${action.type} ${action.url || action.ref || action.text || ''}`)

    switch (action.type) {
        case 'navigate': {
            const res = await gw.sendReq('browser.request', {
                method: 'POST', path: '/navigate', body: { url: action.url }
            })
            await new Promise(r => setTimeout(r, 2000))
            const screenshot = await gw.sendReq('browser.request', { method: 'POST', path: '/screenshot' })
            const tabs = await gw.sendReq('browser.request', { method: 'GET', path: '/tabs' })
            return {
                success: true,
                url: tabs.payload?.tabs?.[0]?.url || res.payload?.url,
                title: tabs.payload?.tabs?.[0]?.title || '',
                screenshot: screenshot.payload?.path
            }
        }
        case 'screenshot': {
            const res = await gw.sendReq('browser.request', { method: 'POST', path: '/screenshot' })
            const tabs = await gw.sendReq('browser.request', { method: 'GET', path: '/tabs' })
            return {
                success: true,
                url: tabs.payload?.tabs?.[0]?.url,
                title: tabs.payload?.tabs?.[0]?.title,
                screenshot: res.payload?.path
            }
        }
        default:
            return { success: false, error: `Action type "${action.type}" not supported in this E2E test` }
    }
}

function formatResult(action, result) {
    if (!result.success) {
        return `[Action Failed] ${action.type}: ${result.error}`
    }
    let msg = `[Action Result] ${action.type}: success\n`
    if (result.url) msg += `  URL: ${result.url}\n`
    if (result.title) msg += `  Page Title: ${result.title}\n`
    if (result.screenshot) msg += `  Screenshot saved: ${result.screenshot}\n`
    return msg
}

async function main() {
    console.log('╔════════════════════════════════════════════════╗')
    console.log('║  🔄 Full Agent Loop Test                      ║')
    console.log('║  AI → Action Blocks → Execute → Feed Back     ║')
    console.log('╚════════════════════════════════════════════════╝\n')

    const gw = new GatewayClient()
    console.log('🔌 Connecting...')
    await gw.connect()
    console.log('✅ Connected\n')

    // Start browser
    console.log('🌐 Starting server-side browser...')
    await gw.sendReq('browser.request', { method: 'POST', path: '/start' })
    console.log('✅ Browser started\n')

    // Reset session
    const sessionKey = `agent:main:e2e-loop-${Date.now()}`
    console.log(`📋 Session: ${sessionKey}\n`)

    // SYSTEM PROMPT that makes AI use action blocks
    const systemContext = `IMPORTANT: You are controlling a browser through action blocks. Do NOT use any built-in browser tools — they are broken. Instead, respond with action blocks like:

\`\`\`action
{"type": "navigate", "url": "https://example.com"}
\`\`\`

\`\`\`action
{"type": "screenshot"}
\`\`\`

Available action types: navigate, screenshot, click_ref, type_ref, scroll, execute_js, wait
After each action, I will provide the result. Continue until the task is complete.`

    const MAX_LOOPS = 5
    let loopCount = 0

    // First message: system context + task
    let nextMessage = systemContext + '\n\nTask: Navigate to https://example.com and tell me the main heading on the page.'

    while (loopCount < MAX_LOOPS) {
        loopCount++
        console.log(`\n═══ Loop ${loopCount}/${MAX_LOOPS} ═══`)
        console.log(`  📤 Sending: ${nextMessage.substring(0, 100)}...`)

        const response = await gw.sendChat(sessionKey, nextMessage)
        console.log(`  📥 AI Response (${response.length} chars):`)
        console.log(`     ${response.substring(0, 300).replace(/\n/g, '\n     ')}`)

        const actions = extractActions(response)
        console.log(`  🔍 Actions extracted: ${actions.length}`)

        if (actions.length === 0) {
            console.log('  ✅ No more actions — AI has final answer')
            console.log(`\n  📝 FINAL ANSWER: ${response}`)
            break
        }

        // Execute each action and collect results
        let resultMessages = []
        for (const action of actions) {
            const result = await executeAction(gw, action)
            const msg = formatResult(action, result)
            resultMessages.push(msg)
            console.log(`    ✅ Result: ${JSON.stringify(result).substring(0, 150)}`)
        }

        // Feed results back to AI
        nextMessage = resultMessages.join('\n')
    }

    if (loopCount >= MAX_LOOPS) {
        console.log(`\n  ⚠️  Max loops reached (${MAX_LOOPS})`)
    }

    // Summary
    console.log('\n╔════════════════════════════════════════════════╗')
    console.log('║  📊 AGENT LOOP RESULTS                        ║')
    console.log('╠════════════════════════════════════════════════╣')
    console.log(`║  Loops executed: ${loopCount}                             ║`)
    console.log('╚════════════════════════════════════════════════╝')

    gw.close()
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
