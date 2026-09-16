/**
 * Start server-side browser and test with AI
 */

import { webcrypto } from 'node:crypto'

import { required, originFor } from './env.mjs'

const GATEWAY_URL = required('AGENTAURA_GATEWAY_URL', 'the gateway address to test against')
const GATEWAY_TOKEN = required('AGENTAURA_GATEWAY_TOKEN', 'the gateway auth token (never commit one)')

async function main() {
    const { default: WebSocket } = await import('ws')

    const keyPair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    const pubRaw = await webcrypto.subtle.exportKey('raw', keyPair.publicKey)
    const pubB64 = Buffer.from(pubRaw).toString('base64')
    const hashBuf = await webcrypto.subtle.digest('SHA-256', pubRaw)
    const deviceId = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('')

    let reqCounter = 0
    const pendingRequests = {}
    let authenticated = false
    const eventListeners = {}

    function nextId() { return `req-${++reqCounter}` }

    function sendReq(method, params = {}) {
        const id = nextId()
        ws.send(JSON.stringify({ type: 'req', id, method, params }))
        return new Promise((resolve, reject) => {
            pendingRequests[id] = { resolve, reject }
            setTimeout(() => { delete pendingRequests[id]; reject(new Error('timeout')) }, 30000)
        })
    }

    function on(event, handler) {
        if (!eventListeners[event]) eventListeners[event] = []
        eventListeners[event].push(handler)
    }

    const ws = new WebSocket(GATEWAY_URL, {
        headers: { Origin: originFor(GATEWAY_URL) }
    })

    ws.on('message', async (raw) => {
        const data = JSON.parse(raw.toString())

        if (data.type === 'event') {
            if (data.event === 'connect.challenge') {
                const nonce = data.payload?.nonce || ''
                const now = Date.now()
                const sp = ['v2', deviceId, 'openclaw-control-ui', 'webchat', 'operator',
                    'operator.admin,operator.approvals,operator.pairing', now.toString(), GATEWAY_TOKEN, nonce].join('|')
                const sig = await webcrypto.subtle.sign('Ed25519', keyPair.privateKey, new TextEncoder().encode(sp))
                const id = nextId()
                pendingRequests[id] = { resolve: () => { authenticated = true }, reject: e => console.error('Auth failed:', e) }
                ws.send(JSON.stringify({
                    type: 'req', id, method: 'connect',
                    params: {
                        minProtocol: 3, maxProtocol: 3,
                        client: { id: 'openclaw-control-ui', version: 'probe', platform: 'chrome-extension', mode: 'webchat', instanceId: crypto.randomUUID() },
                        role: 'operator', scopes: ['operator.admin', 'operator.approvals', 'operator.pairing'],
                        device: { id: deviceId, publicKey: pubB64, signature: Buffer.from(sig).toString('base64'), signedAt: now, nonce },
                        caps: ['tool-events'], auth: { token: GATEWAY_TOKEN }
                    }
                }))
                return
            }

            const listeners = eventListeners[data.event] || []
            for (const l of listeners) l(data.payload)
        }

        if (data.type === 'res') {
            const pending = pendingRequests[data.id]
            if (pending) {
                delete pendingRequests[data.id]
                if (data.ok) pending.resolve(data)
                else pending.reject(data)
            }
        }
    })

    ws.on('error', e => console.error('WS error:', e.message))
    await new Promise(r => { const c = setInterval(() => { if (authenticated) { clearInterval(c); r() } }, 100) })
    console.log('✅ Authenticated\n')

    // 1. Try to start the browser via various routes
    console.log('═══ 1. Try to start browser ═══')
    const startRoutes = [
        { method: 'POST', path: '/start' },
        { method: 'POST', path: '/launch' },
        { method: 'POST', path: '/open' },
        { method: 'POST', path: '/connect' },
        { method: 'POST', path: '/init' },
        { method: 'POST', path: '/pair' },
        { method: 'POST', path: '/ensure' },
    ]

    for (const r of startRoutes) {
        try {
            const res = await sendReq('browser.request', r)
            console.log(`  ✅ ${r.method} ${r.path}: ${JSON.stringify(res.payload).substring(0, 300)}`)
        } catch (e) {
            console.log(`  ❌ ${r.method} ${r.path}: ${JSON.stringify(e.payload || e.error || e).substring(0, 200)}`)
        }
    }

    // 2. Check browser status after start attempts
    console.log('\n═══ 2. Browser status ═══')
    try {
        const res = await sendReq('browser.request', { method: 'GET', path: '/' })
        console.log(JSON.stringify(res.payload, null, 2))
    } catch (e) { console.log('Error:', JSON.stringify(e.payload || e).substring(0, 500)) }

    // 3. Navigate to example.com first to prime the browser
    console.log('\n═══ 3. Prime browser with navigation ═══')
    try {
        const res = await sendReq('browser.request', { method: 'POST', path: '/navigate', body: { url: 'https://example.com' } })
        console.log('Navigate:', JSON.stringify(res.payload).substring(0, 200))
    } catch (e) { console.log('Error:', JSON.stringify(e.payload || e).substring(0, 200)) }

    // 4. Check status again
    console.log('\n═══ 4. Browser status after navigation ═══')
    try {
        const res = await sendReq('browser.request', { method: 'GET', path: '/' })
        console.log(JSON.stringify(res.payload, null, 2))
    } catch (e) { console.log('Error:', JSON.stringify(e.payload || e).substring(0, 500)) }

    // 5. Discover more browser routes
    console.log('\n═══ 5. More browser routes ═══')
    const routes = [
        { method: 'GET', path: '/targets' },
        { method: 'GET', path: '/sessions' },
        { method: 'GET', path: '/tabs' },
        { method: 'GET', path: '/pages' },
        { method: 'POST', path: '/eval', body: { expression: 'document.title' } },
        { method: 'POST', path: '/evaluate', body: { expression: 'document.title' } },
        { method: 'POST', path: '/execute', body: { expression: 'document.title' } },
        { method: 'GET', path: '/content' },
        { method: 'GET', path: '/text' },
        { method: 'POST', path: '/click', body: { selector: 'h1' } },
        { method: 'POST', path: '/type', body: { selector: 'input', text: 'test' } },
        { method: 'GET', path: '/accessibility' },
        { method: 'GET', path: '/html' },
    ]

    for (const r of routes) {
        try {
            const res = await sendReq('browser.request', r)
            const payload = JSON.stringify(res.payload).substring(0, 300)
            console.log(`  ✅ ${r.method} ${r.path}: ${payload}`)
        } catch (e) {
            console.log(`  ❌ ${r.method} ${r.path}: ${JSON.stringify(e.payload || e.error || e).substring(0, 200)}`)
        }
    }

    // 6. Now test chat on the RESET session
    console.log('\n═══ 6. Chat test on fresh session ═══')
    let chatResponse = ''
    await new Promise((resolve) => {
        on('chat', (payload) => {
            if (payload.delta) {
                chatResponse += payload.delta
                process.stdout.write(payload.delta)
            }
            if (payload.state === 'final' || payload.state === 'done' || payload.state === 'complete' || payload.state === 'aborted') {
                const text = payload.message?.content?.[0]?.text
                if (text) chatResponse = text
                process.stdout.write('\n')
                resolve()
            }
        })

        sendReq('chat.send', {
            sessionKey: 'agent:main:main',
            message: 'Take a screenshot of the current browser page and tell me what URL it shows.',
            deliver: true,
            timeoutMs: 60000,
            idempotencyKey: crypto.randomUUID()
        }).catch(() => {})

        setTimeout(() => resolve(), 60000)
    })

    console.log('\n\nFull response:', chatResponse.substring(0, 1000))

    console.log('\n═══ Done ═══')
    ws.close()
    setTimeout(() => process.exit(0), 1000)
}

main().catch(e => console.error('Fatal:', e))
