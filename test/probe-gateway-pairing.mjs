/**
 * Gateway Pairing Protocol Diagnostic
 * 
 * Probes the OpenClaw gateway for browser pairing mechanisms.
 * Tries various methods to register as a browser tool provider.
 */

import { webcrypto } from 'node:crypto'

import { required, originFor } from './env.mjs'

const GATEWAY_URL = required('AGENTAURA_GATEWAY_URL', 'the gateway address to test against')
const GATEWAY_TOKEN = required('AGENTAURA_GATEWAY_TOKEN', 'the gateway auth token (never commit one)')

async function generateDeviceIdentity() {
    const keyPair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    const pubRaw = await webcrypto.subtle.exportKey('raw', keyPair.publicKey)
    const pubB64 = Buffer.from(pubRaw).toString('base64')
    const hashBuffer = await webcrypto.subtle.digest('SHA-256', pubRaw)
    const deviceId = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')
    return { keyPair, pubB64, deviceId }
}

async function signData(keyPair, message) {
    const sig = await webcrypto.subtle.sign('Ed25519', keyPair.privateKey, new TextEncoder().encode(message))
    return Buffer.from(sig).toString('base64')
}

async function main() {
    const { default: WebSocket } = await import('ws')
    const device = await generateDeviceIdentity()
    let reqCounter = 0
    const pendingRequests = {}
    let authenticated = false

    function nextId() { return `req-${++reqCounter}` }

    function sendReq(method, params) {
        const id = nextId()
        const frame = { type: 'req', id, method, params }
        ws.send(JSON.stringify(frame))
        console.log(`  → [req] ${method}:`, JSON.stringify(params).substring(0, 200))
        return new Promise((resolve, reject) => {
            pendingRequests[id] = { resolve, reject }
            setTimeout(() => { delete pendingRequests[id]; reject(new Error(`Timeout: ${method}`)) }, 15000)
        })
    }

    const ws = new WebSocket(GATEWAY_URL, {
        headers: { Origin: originFor(GATEWAY_URL) }
    })

    ws.on('message', async (raw) => {
        const data = JSON.parse(raw.toString())
        const str = JSON.stringify(data).substring(0, 500)

        if (data.type === 'event') {
            if (data.event === 'connect.challenge') {
                console.log('  Got challenge, authenticating...')
                const nonce = data.payload?.nonce || ''
                const now = Date.now()
                const signPayload = ['v2', device.deviceId, 'openclaw-control-ui', 'webchat', 'operator',
                    'operator.admin,operator.approvals,operator.pairing', now.toString(), GATEWAY_TOKEN, nonce].join('|')
                const signature = await signData(device.keyPair, signPayload)

                const id = nextId()
                pendingRequests[id] = {
                    resolve: () => { authenticated = true },
                    reject: (e) => console.error('Auth failed:', e)
                }
                ws.send(JSON.stringify({
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
            console.log(`  ← [event] ${data.event}:`, str)
        }

        if (data.type === 'res') {
            const ok = data.ok
            console.log(`  ← [res] ${data.id} ok:${ok}:`, str.substring(0, 300))
            const pending = pendingRequests[data.id]
            if (pending) {
                delete pendingRequests[data.id]
                if (ok) pending.resolve(data)
                else pending.reject(data)
            }
        }
    })

    ws.on('error', (e) => console.error('WS error:', e.message))
    ws.on('close', (code, reason) => console.log(`WS closed: ${code} ${reason.toString()}`))

    // Wait for auth
    await new Promise(resolve => {
        const check = setInterval(() => {
            if (authenticated) { clearInterval(check); resolve() }
        }, 100)
    })
    console.log('✅ Authenticated\n')

    // Phase 1: List sessions
    console.log('═══ Phase 1: Sessions ═══')
    try {
        const res = await sendReq('sessions.list', {})
        const sessions = res.payload?.sessions || (Array.isArray(res.payload) ? res.payload : [])
        console.log(`  Found ${sessions.length} sessions`)
        sessions.forEach(s => console.log(`    - ${s.key || s.sessionKey}: ${JSON.stringify(s).substring(0, 200)}`))
    } catch (e) { console.log('  Error:', e.message || JSON.stringify(e)) }

    // Phase 2: Probe pairing methods
    console.log('\n═══ Phase 2: Probe pairing methods ═══')
    const methods = [
        'pair', 'pairing.start', 'pairing.register', 'pairing.request',
        'browser.pair', 'browser.register', 'browser.connect',
        'tools.register', 'tools.list', 'tool.register',
        'tool-events.register', 'capabilities.register',
        'devices.register', 'extensions.register',
        'relay.connect', 'relay.register',
        'operator.pair', 'operator.register-browser',
        'config.get', 'status', 'info', 'system.info', 'system.status',
        'help', 'methods', 'methods.list',
        'agents.list', 'agent.status', 'agent.tools'
    ]

    for (const method of methods) {
        try {
            const res = await sendReq(method, {})
            console.log(`  ✅ ${method}: ok=${res.ok}, payload=${JSON.stringify(res.payload).substring(0, 200)}`)
        } catch (e) {
            const msg = e.message || JSON.stringify(e.payload || e)
            if (msg.includes('Timeout')) {
                console.log(`  ⏱  ${method}: timeout`)
            } else {
                console.log(`  ❌ ${method}: ${msg.substring(0, 150)}`)
            }
        }
    }

    // Phase 3: Try sending as tool-event provider
    console.log('\n═══ Phase 3: Tool provider registration ═══')
    try {
        const res = await sendReq('connect', {
            minProtocol: 3, maxProtocol: 3,
            client: { id: 'browser-tool-provider', version: '1.0', platform: 'playwright', mode: 'tool-provider' },
            role: 'tool-provider',
            scopes: ['browser.control'],
            caps: ['tool-events', 'browser'],
            tools: [
                { name: 'browser.screenshot', description: 'Take screenshot' },
                { name: 'browser.navigate', description: 'Navigate to URL' },
                { name: 'browser.click', description: 'Click element' },
                { name: 'browser.type', description: 'Type text' }
            ]
        })
        console.log('  Tool provider registration:', JSON.stringify(res).substring(0, 300))
    } catch (e) {
        console.log('  Tool provider registration failed:', (e.message || JSON.stringify(e)).substring(0, 200))
    }

    console.log('\n═══ Done ═══')
    ws.close()
    setTimeout(() => process.exit(0), 1000)
}

main().catch(e => console.error('Fatal:', e))
