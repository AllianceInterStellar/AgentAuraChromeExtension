/**
 * Write SKILL.md → Reset session → Test action blocks
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
                        this.ws.send(JSON.stringify({ type: 'req', id, method: 'connect', params: { minProtocol: 3, maxProtocol: 3, client: { id: 'openclaw-control-ui', version: 'v7-test', platform: 'chrome-extension', mode: 'webchat', instanceId: crypto.randomUUID() }, role: 'operator', scopes: ['operator.admin', 'operator.approvals', 'operator.pairing'], device: { id: deviceId, publicKey: pubB64, signature: Buffer.from(sig).toString('base64'), signedAt: now, nonce }, caps: ['tool-events'], auth: { token: GATEWAY_TOKEN } } }))
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

async function main() {
    const gw = new GatewayClient()
    console.log('🔌 Connecting...')
    await gw.connect()
    console.log('✅ Connected\n')

    // Step 1: Check skills status to see if browser-automation is already loaded
    console.log('═══ Step 1: Check skills status ═══')
    try {
        const res = await gw.sendReq('skills.status')
        const skills = res.payload?.skills || []
        const brSkills = skills.filter(s => JSON.stringify(s).includes('browser'))
        console.log(`  Total skills: ${skills.length}`)
        console.log(`  Browser-related: ${brSkills.length}`)
        if (brSkills.length) brSkills.forEach(s => console.log(`    ${JSON.stringify(s).substring(0, 200)}`))
    } catch (e) { console.log(`  Error: ${e.message}`) }

    // Step 2: Check if the file exists via agents.files methods
    console.log('\n═══ Step 2: Check skill file ═══')
    try {
        const res = await gw.sendReq('agents.files.list', { agentId: 'main', name: 'workspace/skills/browser-automation/' })
        console.log(`  Files: ${JSON.stringify(res.payload).substring(0, 300)}`)
    } catch (e) { console.log(`  List error: ${e.message}`) }

    try {
        const res = await gw.sendReq('agents.files.get', { agentId: 'main', name: 'workspace/skills/browser-automation/SKILL.md' })
        const content = typeof res.payload === 'string' ? res.payload : (res.payload?.content || res.payload?.text || JSON.stringify(res.payload))
        console.log(`  SKILL.md: ${content.substring(0, 200)}...`)
        const hasV7 = content.includes('Do NOT use any built-in browser tool')
        console.log(`  Is v7: ${hasV7 ? '✅' : '❌'}`)
    } catch (e) { console.log(`  Content error: ${JSON.stringify(e).substring(0, 200)}`) }

    // Step 3: Use a fresh session to write the SKILL.md
    console.log('\n═══ Step 3: Write SKILL.md via fresh AI session ═══')
    const writeSession = `agent:main:write-${Date.now()}`
    try {
        const writeResp = await gw.sendChat(writeSession, 
            `Read the file at /home/openclaw/.openclaw/agents/main/workspace/skills/browser-automation/SKILL.md and show me the first 3 lines.`,
            30000
        )
        console.log(`  Current content: ${writeResp.substring(0, 200)}`)
    } catch (e) { console.log(`  Error: ${e.message}`) }

    // Step 4: Ask AI to check the skill loading
    console.log('\n═══ Step 4: Skills reload check ═══')
    try {
        const res = await gw.sendReq('skills.reload')
        console.log(`  skills.reload: ${JSON.stringify(res).substring(0, 200)}`)
    } catch (e) { 
        console.log(`  skills.reload not available: ${JSON.stringify(e).substring(0, 200)}`)
    }

    // Try skills.install
    try {
        const res = await gw.sendReq('skills.install', { name: 'browser-automation' })
        console.log(`  skills.install: ${JSON.stringify(res).substring(0, 200)}`)
    } catch (e) {
        console.log(`  skills.install: ${JSON.stringify(e).substring(0, 200)}`)
    }

    // Step 5: Reset main session and test
    console.log('\n═══ Step 5: Reset + Test ═══')
    try {
        await gw.sendReq('sessions.reset', { key: 'agent:main:main' })
        console.log('  Session reset ✅')
    } catch (_) {}

    // Wait for skills to reload
    await new Promise(r => setTimeout(r, 2000))

    // Now test
    console.log('  ⏳ Testing...')
    try {
        const response = await gw.sendChat('agent:main:main',
            'Navigate to https://example.com and tell me the main heading. Use action blocks to control the browser.')
        
        console.log(`  📝 Response (${response.length} chars):`)
        console.log(`     ${response.substring(0, 500).replace(/\n/g, '\n     ')}`)
        
        const actionRegex = /```(?:action|json)\s*\n([\s\S]*?)```/g
        let match, actions = []
        while ((match = actionRegex.exec(response)) !== null) {
            try { const p = JSON.parse(match[1].trim()); if (p.type) actions.push(p); else if (Array.isArray(p)) p.forEach(a => { if (a.type) actions.push(a) }) } catch (_) {}
        }
        
        console.log(`\n  Action blocks: ${actions.length > 0 ? '✅ YES!' : '❌ NO'}`)
        console.log(`  Pairing error: ${response.toLowerCase().includes('pairing') ? '⚠️ YES' : '✅ NO'}`)
        if (actions.length) console.log(`  Actions: ${JSON.stringify(actions)}`)
    } catch (e) { console.log(`  Error: ${e.message}`) }

    gw.close()
    console.log('\n🏁 Done.')
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
