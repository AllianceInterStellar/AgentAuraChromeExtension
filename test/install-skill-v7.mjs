/**
 * Re-install updated SKILL.md (v7) to server and test
 */

import { webcrypto } from 'node:crypto'

import { required, originFor } from './env.mjs'

const GATEWAY_URL = required('AGENTAURA_GATEWAY_URL', 'the gateway address to test against')
const GATEWAY_TOKEN = required('AGENTAURA_GATEWAY_TOKEN', 'the gateway auth token (never commit one)')
const CLAW_ID = required('AGENTAURA_CLAW_ID', 'the claw UUID these tests act on')
const API_URL = 'https://uuiv4wr33ebukwv5yfcgjy22ia0sivfm.lambda-url.us-east-1.on.aws'

const UPDATED_SKILL = `# Browser Automation

IMPORTANT: You are connected to a Chrome extension that controls the browser. Do NOT use any built-in browser tool (e.g. the "browser" tool). It is unavailable in this session. Instead, output JSON instructions inside \\\`\\\`\\\`action code blocks as described below. The Chrome extension will execute them and return results.

## Action Format

\\\`\\\`\\\`action
{"type": "action_type", ...params}
\\\`\\\`\\\`

You can output multiple action blocks in one response. They execute sequentially.

## Available Actions

### Navigation
- \`{"type": "navigate", "url": "https://..."}\` — Go to URL in current tab
- \`{"type": "new_tab", "url": "https://..."}\` — Open URL in new tab
- \`{"type": "select_tab", "targetTabId": 123}\` — Switch to a tab by ID
- \`{"type": "list_tabs"}\` — List all open tabs

### Interaction (by ref number)
Page elements are labeled with [ref] numbers. Use these to interact:
- \`{"type": "click_ref", "ref": 5}\` — Click element [5]
- \`{"type": "type_ref", "ref": 5, "text": "hello"}\` — Type into element [5]
- \`{"type": "hover_ref", "ref": 5}\` — Hover over element [5]

### Interaction (by CSS selector)
- \`{"type": "click", "selector": "#btn"}\` — Click element matching CSS selector
- \`{"type": "type", "selector": "#input", "text": "hello"}\` — Type into element

### Keyboard & Mouse (CDP)
- \`{"type": "cdp_key", "key": "Enter"}\` — Press a keyboard key
- \`{"type": "cdp_click", "x": 100, "y": 200}\` — Click at coordinates

### Page Content
- \`{"type": "read_page_content"}\` — Get interactive elements with ref numbers
- \`{"type": "get_page_text"}\` — Get full page text
- \`{"type": "screenshot"}\` — Capture current page screenshot

### Utility
- \`{"type": "scroll", "direction": "down", "amount": 300}\` — Scroll (up/down/left/right)
- \`{"type": "wait", "duration": 1000}\` — Wait milliseconds
- \`{"type": "execute_js", "code": "document.title"}\` — Execute JavaScript on page

## Guidelines

1. When page elements have [ref] numbers, prefer ref-based actions over CSS selectors.
2. After performing actions, you'll receive updated page state. Check whether the goal is achieved before continuing.
3. If an action fails, analyze the error and try a different approach — don't repeat the same failed action.
4. When a page hasn't loaded yet, use wait before interacting.
5. For multi-step tasks, do one or two actions at a time, then verify results.
6. If you determine the task is complete, respond with a text summary — no more actions needed.
7. NEVER use the built-in "browser" tool. Always use action blocks for browser control.
`

async function getFirebaseToken() {
    const API_KEY = 'AIzaSyBdKqX4ZPKnw1sM1c09_dGtiBJlFV13iSs'
    const refreshToken = process.env.FIREBASE_REFRESH_TOKEN
    if (refreshToken) {
        const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `grant_type=refresh_token&refresh_token=${refreshToken}`
        })
        const data = await res.json()
        return data.id_token
    }
    return null
}

async function installSkillViaAPI(token) {
    const url = `${API_URL}/claws/${CLAW_ID}/agent-skills`
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            agentId: 'main',
            skillName: 'browser-automation',
            content: UPDATED_SKILL
        })
    })
    const data = await res.json()
    return { status: res.status, data }
}

async function installSkillViaGateway(gw) {
    // Try using the AI's exec tool to write the SKILL.md directly
    const skillPath = '/home/openclaw/.openclaw/agents/main/workspace/skills/browser-automation/SKILL.md'
    
    // Use sessions.reset first
    await gw.sendReq('sessions.reset', { key: 'agent:main:main' })
    
    // Ask the AI to write the file using its tools
    console.log('  Asking AI to write updated SKILL.md...')
    const response = await gw.sendChat('agent:main:main',
        `Write the following content to ${skillPath} (overwrite existing file):\n\n${UPDATED_SKILL}`,
        60000
    )
    return response
}

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
                                client: { id: 'openclaw-control-ui', version: 'skill-update', platform: 'chrome-extension', mode: 'webchat', instanceId: crypto.randomUUID() },
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

async function main() {
    console.log('📦 Installing updated SKILL.md v7 to server\n')

    const gw = new GatewayClient()
    console.log('🔌 Connecting to gateway...')
    await gw.connect()
    console.log('✅ Connected\n')

    // Method 1: Try via API
    console.log('═══ Method 1: Install via Platform API ═══')
    try {
        const token = await getFirebaseToken()
        if (token) {
            const result = await installSkillViaAPI(token)
            console.log(`  API result: ${result.status} — ${JSON.stringify(result.data).substring(0, 200)}`)
        } else {
            console.log('  ⚠️  No Firebase refresh token. Set FIREBASE_REFRESH_TOKEN env var.')
        }
    } catch (e) { console.log(`  API error: ${e.message}`) }

    // Method 2: Via gateway AI (ask it to write the file)
    console.log('\n═══ Method 2: Install via Gateway AI ═══')
    try {
        const response = await installSkillViaGateway(gw)
        const wrote = response.includes('wrote') || response.includes('written') || response.includes('saved') || response.includes('created') || response.includes('updated')
        console.log(`  AI wrote file: ${wrote ? '✅' : '❌'}`)
        console.log(`  Response: ${response.substring(0, 300)}`)
    } catch (e) { console.log(`  Gateway error: ${e.message}`) }

    // Verify the SKILL.md content
    console.log('\n═══ Verify SKILL.md ═══')
    try {
        const res = await gw.sendReq('agents.files.get', {
            agentId: 'main',
            name: 'workspace/skills/browser-automation/SKILL.md'
        })
        const content = typeof res.payload === 'string' ? res.payload : (res.payload?.content || JSON.stringify(res.payload))
        const hasNewInstruction = content.includes('Do NOT use any built-in browser tool')
        console.log(`  SKILL.md length: ${content.length} chars`)
        console.log(`  Has updated instruction: ${hasNewInstruction ? '✅ YES' : '❌ NO (still old version)'}`)
        if (!hasNewInstruction) console.log(`  First 200 chars: ${content.substring(0, 200)}`)
    } catch (e) { console.log(`  Verify error: ${e.message}`) }

    // Test: Reset session and try browser automation on MAIN session
    console.log('\n═══ Test: Standard session (no explicit prompt hack) ═══')
    try {
        await gw.sendReq('sessions.reset', { key: 'agent:main:main' })
        console.log('  Session reset ✅')
    } catch (_) {}

    console.log('  ⏳ Testing standard browser automation request...')
    try {
        // Simulate extension's buildAgentMessage format
        const msg = `[System] You are connected to a Chrome extension for browser control. Do NOT use any built-in browser tool. Use \`\`\`action blocks only.

Navigate to https://example.com and tell me what the main heading says.

[页面状态] URL: chrome://newtab
标题: New Tab`

        const response = await gw.sendChat('agent:main:main', msg)
        
        console.log(`  📝 Response (${response.length} chars):`)
        console.log(`     ${response.substring(0, 400).replace(/\n/g, '\n     ')}`)
        
        const actions = extractActions(response)
        const hasActionBlocks = actions.length > 0
        const hasPairingError = response.toLowerCase().includes('pairing')
        
        console.log(`\n  ✅ Action blocks: ${hasActionBlocks ? 'YES!' : 'NO'}`)
        console.log(`  ⚠️  Pairing error: ${hasPairingError ? 'YES (bad)' : 'NO (good)'}`)
        
        if (actions.length > 0) {
            console.log(`  📋 Actions: ${JSON.stringify(actions)}`)
            
            // Execute the actions
            for (const action of actions) {
                if (action.type === 'navigate' && action.url) {
                    console.log(`  🎯 Executing navigate to ${action.url}`)
                    await gw.sendReq('browser.request', { method: 'POST', path: '/start' })
                    const navRes = await gw.sendReq('browser.request', { 
                        method: 'POST', path: '/navigate', body: { url: action.url } 
                    })
                    await new Promise(r => setTimeout(r, 2000))
                    const tabs = await gw.sendReq('browser.request', { method: 'GET', path: '/tabs' })
                    console.log(`  ✅ Navigated: ${tabs.payload?.tabs?.[0]?.title} at ${tabs.payload?.tabs?.[0]?.url}`)
                    
                    // Feed result back
                    const resultMsg = `[Action Result] navigate: success\n  URL: ${tabs.payload?.tabs?.[0]?.url}\n  Page Title: ${tabs.payload?.tabs?.[0]?.title}`
                    const response2 = await gw.sendChat('agent:main:main', resultMsg)
                    console.log(`  📝 AI Final: ${response2.substring(0, 200)}`)
                    const gotAnswer = response2.includes('Example Domain')
                    console.log(`  ✅ Correct answer: ${gotAnswer ? 'YES!' : 'NO'}`)
                }
            }
        }
    } catch (e) { console.log(`  Error: ${e.message}`) }

    gw.close()
    console.log('\n🏁 Done.')
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
