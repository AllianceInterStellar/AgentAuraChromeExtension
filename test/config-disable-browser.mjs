/**
 * Investigate config format and try to disable ui.browser tool
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
                        this.ws.send(JSON.stringify({ type: 'req', id, method: 'connect', params: { minProtocol: 3, maxProtocol: 3, client: { id: 'openclaw-control-ui', version: 'config-fix', platform: 'chrome-extension', mode: 'webchat', instanceId: crypto.randomUUID() }, role: 'operator', scopes: ['operator.admin', 'operator.approvals', 'operator.pairing'], device: { id: deviceId, publicKey: pubB64, signature: Buffer.from(sig).toString('base64'), signedAt: now, nonce }, caps: ['tool-events'], auth: { token: GATEWAY_TOKEN } } }))
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

    // Step 1: Get FULL raw config
    console.log('═══ Step 1: Full raw config ═══')
    let fullConfig = ''
    try {
        const res = await gw.sendReq('config.get')
        fullConfig = res.payload?.raw || ''
        console.log(`  Config (${fullConfig.length} chars):`)
        console.log(fullConfig)
    } catch (e) { console.log(`  Error: ${e.message}`) }

    // Step 2: Try config.set with raw
    console.log('\n═══ Step 2: Try config methods ═══')
    
    // 2a: Try config.set
    try {
        const res = await gw.sendReq('config.set', { raw: fullConfig })
        console.log(`  config.set: ${JSON.stringify(res).substring(0, 200)}`)
    } catch (e) { console.log(`  config.set error: ${JSON.stringify(e).substring(0, 200)}`) }

    // 2b: Try config.patch with raw
    try {
        const patch = fullConfig.replace(
            "profile: 'full'",
            "profile: 'full',\n    disabled: ['ui.browser']"
        )
        const res = await gw.sendReq('config.patch', { raw: patch })
        console.log(`  config.patch with disabled: ${JSON.stringify(res).substring(0, 200)}`)
    } catch (e) { console.log(`  config.patch error: ${JSON.stringify(e).substring(0, 300)}`) }

    // Step 3: Check tools catalog after config change
    console.log('\n═══ Step 3: Tools catalog after patch ═══')
    try {
        const res = await gw.sendReq('tools.catalog')
        const groups = res.payload?.groups || []
        const allTools = groups.flatMap(g => (g.tools || []).map(t => `${g.id}.${t.id}`))
        const hasBrowser = allTools.some(t => t.includes('browser'))
        console.log(`  Browser still present: ${hasBrowser ? '❌ YES' : '✅ NO'}`)
        console.log(`  All tools: ${allTools.join(', ')}`)
    } catch (e) { console.log(`  Error: ${e.message}`) }

    // Step 4: Try alternate config approaches
    console.log('\n═══ Step 4: Alternate config approaches ═══')
    
    // Try modifying the raw config to set browser.enabled = false
    const modifiedConfig = fullConfig.replace(
        /browser:\s*\{[^}]*enabled:\s*true/m,
        'browser: {\n    enabled: false'
    )
    console.log(`  Original has browser enabled: ${fullConfig.includes('browser:') && fullConfig.includes('enabled: true')}`)
    console.log(`  Modified preview: ${modifiedConfig.substring(modifiedConfig.indexOf('browser:'), modifiedConfig.indexOf('browser:') + 100)}`)
    
    try {
        const res = await gw.sendReq('config.set', { raw: modifiedConfig })
        console.log(`  config.set result: ${JSON.stringify(res).substring(0, 200)}`)
    } catch (e) { console.log(`  config.set error: ${JSON.stringify(e).substring(0, 300)}`) }

    // Check browser status
    try {
        const res = await gw.sendReq('browser.request', { method: 'GET', path: '/' })
        console.log(`  Browser status: ${JSON.stringify(res.payload).substring(0, 200)}`)
    } catch (e) { console.log(`  Browser error: ${e.message}`) }

    // Check tools after browser disable
    try {
        const res = await gw.sendReq('tools.catalog')
        const groups = res.payload?.groups || []
        const allTools = groups.flatMap(g => (g.tools || []).map(t => `${g.id}.${t.id}`))
        console.log(`  Tools after disable: ${allTools.join(', ')}`)
    } catch (e) { console.log(`  Error: ${e.message}`) }

    // Step 5: Test AI on fresh session
    console.log('\n═══ Step 5: Test AI ═══')
    try {
        await gw.sendReq('sessions.reset', { key: 'agent:main:main' })
        console.log('  Session reset ✅')
        await new Promise(r => setTimeout(r, 2000))
    } catch (_) {}

    try {
        const response = await gw.sendChat('agent:main:main',
            'Navigate to https://example.com and tell me the main heading. Use action blocks to control the browser.')
        console.log(`  📝 Response (${response.length} chars):`)
        console.log(`     ${response.substring(0, 500).replace(/\n/g, '\n     ')}`)
        
        const hasActions = /```(?:action|json)\s*\n/.test(response)
        const hasPairing = response.toLowerCase().includes('pairing')
        console.log(`\n  Action blocks: ${hasActions ? '✅ YES!' : '❌ NO'}`)
        console.log(`  Pairing: ${hasPairing ? '⚠️' : '✅ NO'}`)
    } catch (e) { console.log(`  Error: ${e.message}`) }

    // Step 6: Restore config
    console.log('\n═══ Step 6: Restore config ═══')
    try {
        const res = await gw.sendReq('config.set', { raw: fullConfig })
        console.log(`  Restored: ${res.ok ? '✅' : '❌'}`)
    } catch (e) { console.log(`  Restore error: ${e.message}`) }

    gw.close()
    console.log('\n🏁 Done.')
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
