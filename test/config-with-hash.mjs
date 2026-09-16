/**
 * Get config with hash, disable browser, test, restore
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
                        this.ws.send(JSON.stringify({ type: 'req', id, method: 'connect', params: { minProtocol: 3, maxProtocol: 3, client: { id: 'openclaw-control-ui', version: 'config-hash', platform: 'chrome-extension', mode: 'webchat', instanceId: crypto.randomUUID() }, role: 'operator', scopes: ['operator.admin', 'operator.approvals', 'operator.pairing'], device: { id: deviceId, publicKey: pubB64, signature: Buffer.from(sig).toString('base64'), signedAt: now, nonce }, caps: ['tool-events'], auth: { token: GATEWAY_TOKEN } } }))
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

    // Step 1: Get config with full payload (including hash)
    console.log('═══ Step 1: Full config.get response ═══')
    let configPayload
    try {
        const res = await gw.sendReq('config.get')
        configPayload = res.payload
        // Print all keys except raw
        const keys = Object.keys(configPayload || {})
        console.log(`  Payload keys: ${keys.join(', ')}`)
        for (const k of keys) {
            if (k === 'raw') continue
            console.log(`  ${k}: ${JSON.stringify(configPayload[k]).substring(0, 100)}`)
        }
    } catch (e) { console.log(`  Error: ${e.message}`); return }

    if (!configPayload) { console.log('  No config payload'); return }

    // Step 2: Try config.set with the hash
    console.log('\n═══ Step 2: Disable browser via config.set ═══')
    const baseHash = configPayload.hash || configPayload.baseHash || configPayload.configHash
    console.log(`  Base hash: ${baseHash}`)

    const originalRaw = configPayload.raw
    const modifiedRaw = originalRaw.replace(
        /browser:\s*\{[\s\S]*?enabled:\s*true/m,
        'browser: {\n    enabled: false'
    )
    console.log(`  Modified browser.enabled to false`)

    try {
        const res = await gw.sendReq('config.set', { raw: modifiedRaw, baseHash })
        console.log(`  config.set: ${res.ok ? '✅ OK' : '❌ FAIL'} — ${JSON.stringify(res.payload || res.error || '').substring(0, 200)}`)
    } catch (e) { 
        console.log(`  config.set error: ${JSON.stringify(e).substring(0, 300)}`)
        // Try with different hash param names
        for (const hashKey of ['hash', 'configHash', 'base', 'etag', 'version']) {
            if (hashKey === 'baseHash') continue // already tried via baseHash
            try {
                const res2 = await gw.sendReq('config.set', { raw: modifiedRaw, [hashKey]: baseHash || configPayload[hashKey] })
                console.log(`  config.set with ${hashKey}: ${res2.ok ? '✅ OK' : '❌ FAIL'} — ${JSON.stringify(res2.payload || res2.error || '').substring(0, 200)}`)
                if (res2.ok) break
            } catch (e2) {
                console.log(`  config.set with ${hashKey}: ${JSON.stringify(e2).substring(0, 100)}`)
            }
        }
    }

    // Step 3: Try config.patch with hash
    console.log('\n═══ Step 3: Try config.patch ═══')
    // Re-read config to get fresh hash
    try {
        const res = await gw.sendReq('config.get')
        const freshHash = res.payload?.hash || res.payload?.baseHash || res.payload?.configHash
        const freshRaw = res.payload?.raw
        
        // Try patch
        const patchedRaw = freshRaw.replace(
            /browser:\s*\{[\s\S]*?enabled:\s*true/m,
            'browser: {\n    enabled: false'
        )
        
        const patchRes = await gw.sendReq('config.patch', { raw: patchedRaw, baseHash: freshHash })
        console.log(`  config.patch: ${patchRes.ok ? '✅ OK' : '❌ FAIL'} — ${JSON.stringify(patchRes.payload || patchRes.error || '').substring(0, 200)}`)
    } catch (e) { console.log(`  config.patch error: ${JSON.stringify(e).substring(0, 300)}`) }

    // Step 4: Check if config.apply exists
    console.log('\n═══ Step 4: Try config.apply ═══')
    try {
        const res = await gw.sendReq('config.get')
        const hash = res.payload?.hash || res.payload?.baseHash
        const raw = res.payload?.raw
        const modified = raw.replace(/browser:\s*\{[\s\S]*?enabled:\s*true/m, 'browser: {\n    enabled: false')
        
        const applyRes = await gw.sendReq('config.apply', { raw: modified, baseHash: hash })
        console.log(`  config.apply: ${applyRes.ok ? '✅ OK' : '❌ FAIL'} — ${JSON.stringify(applyRes).substring(0, 200)}`)
    } catch (e) { console.log(`  config.apply error: ${JSON.stringify(e).substring(0, 300)}`) }

    // Step 5: Ask AI to modify the config file directly
    console.log('\n═══ Step 5: Ask AI to modify config ═══')
    const writeSession = `agent:main:config-${Date.now()}`
    try {
        const response = await gw.sendChat(writeSession,
            `Read the openclaw config file at /home/openclaw/.openclaw/openclaw.json and show me the browser section. Then modify it to set browser.enabled to false and save the file.`,
            60000
        )
        console.log(`  AI response: ${response.substring(0, 400)}`)
    } catch (e) { console.log(`  Error: ${e.message}`) }

    // Step 6: Check tools catalog
    console.log('\n═══ Step 6: Check tools ═══')
    try {
        const res = await gw.sendReq('tools.catalog')
        const allTools = (res.payload?.groups || []).flatMap(g => (g.tools || []).map(t => `${g.id}.${t.id}`))
        console.log(`  Browser present: ${allTools.some(t => t.includes('browser')) ? '❌ YES' : '✅ NO'}`)
        console.log(`  Tools: ${allTools.join(', ')}`)
    } catch (e) { console.log(`  Error: ${e.message}`) }

    // Step 7: Test AI
    console.log('\n═══ Step 7: Test AI ═══')
    try { await gw.sendReq('sessions.reset', { key: 'agent:main:main' }) } catch (_) {}
    await new Promise(r => setTimeout(r, 2000))
    
    try {
        const response = await gw.sendChat('agent:main:main',
            'Navigate to https://example.com and tell me the heading. Use action blocks.')
        const hasActions = /```(?:action|json)\s*\n/.test(response)
        const hasPairing = response.toLowerCase().includes('pairing')
        console.log(`  Response: ${response.substring(0, 300)}`)
        console.log(`  Action blocks: ${hasActions ? '✅' : '❌'}`)
        console.log(`  Pairing error: ${hasPairing ? '⚠️' : '✅ NO'}`)
    } catch (e) { console.log(`  Error: ${e.message}`) }

    // Restore config via AI
    console.log('\n═══ Step 8: Restore config ═══')
    const restoreSession = `agent:main:restore-${Date.now()}`
    try {
        const resp = await gw.sendChat(restoreSession,
            `Read /home/openclaw/.openclaw/openclaw.json and if browser.enabled is false, change it back to true and save.`,
            60000
        )
        console.log(`  Restore: ${resp.substring(0, 200)}`)
    } catch (e) { console.log(`  Error: ${e.message}`) }

    gw.close()
    console.log('\n🏁 Done.')
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
