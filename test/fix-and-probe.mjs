/**
 * Fix session and probe browser.request
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

    function nextId() { return `req-${++reqCounter}` }

    function sendReq(method, params = {}) {
        const id = nextId()
        ws.send(JSON.stringify({ type: 'req', id, method, params }))
        return new Promise((resolve, reject) => {
            pendingRequests[id] = { resolve, reject }
            setTimeout(() => { delete pendingRequests[id]; reject(new Error('timeout')) }, 15000)
        })
    }

    const ws = new WebSocket(GATEWAY_URL, {
        headers: { Origin: originFor(GATEWAY_URL) }
    })

    ws.on('message', async (raw) => {
        const data = JSON.parse(raw.toString())

        if (data.type === 'event' && data.event === 'connect.challenge') {
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

    // 1. Reset main session
    console.log('═══ 1. sessions.reset (with key param) ═══')
    try {
        const res = await sendReq('sessions.reset', { key: 'agent:main:main' })
        console.log('✅ Session reset:', JSON.stringify(res.payload).substring(0, 300))
    } catch (e) { console.log('❌ Error:', JSON.stringify(e.payload || e.error || e).substring(0, 300)) }

    // 2. Try browser.request with different params
    console.log('\n═══ 2. browser.request variants ═══')
    
    const variants = [
        { method: 'GET', path: '/' },
        { method: 'GET', path: '/screenshot' },
        { method: 'POST', path: '/screenshot' },
        { method: 'GET', path: '/status' },
        { method: 'GET', path: '/health' },
        { method: 'POST', path: '/navigate', body: { url: 'https://example.com' } },
        { method: 'POST', path: '/goto', body: { url: 'https://example.com' } },
        { method: 'GET', path: '/page' },
        { method: 'POST', path: '/pair' },
    ]

    for (const v of variants) {
        try {
            const res = await sendReq('browser.request', v)
            console.log(`  ✅ ${v.method} ${v.path}: ${JSON.stringify(res.payload).substring(0, 200)}`)
        } catch (e) {
            console.log(`  ❌ ${v.method} ${v.path}: ${JSON.stringify(e.payload || e.error || e).substring(0, 200)}`)
        }
    }

    // 3. Approve the pending device pair request
    console.log('\n═══ 3. Approve pending device pair ═══')
    try {
        const listRes = await sendReq('device.pair.list')
        const pending = listRes.payload?.pending || []
        if (pending.length > 0) {
            const reqId = pending[0].requestId
            console.log(`  Approving pending device: ${pending[0].deviceId.substring(0, 16)}... (reqId: ${reqId})`)
            const res = await sendReq('device.pair.approve', { requestId: reqId })
            console.log('  ✅ Approved:', JSON.stringify(res.payload).substring(0, 300))
        } else {
            console.log('  No pending devices')
        }
    } catch (e) { console.log('  ❌ Error:', JSON.stringify(e.payload || e.error || e).substring(0, 300)) }

    // 4. Now test browser.request again after potential pairing
    console.log('\n═══ 4. browser.request after pairing ═══')
    try {
        const res = await sendReq('browser.request', { method: 'POST', path: '/screenshot' })
        console.log('✅ Screenshot:', JSON.stringify(res.payload).substring(0, 200))
    } catch (e) { console.log('❌ Error:', JSON.stringify(e.payload || e.error || e).substring(0, 200)) }

    // 5. Send a test chat on the reset session
    console.log('\n═══ 5. Quick chat test on reset session ═══')
    let chatResponse = ''
    await new Promise((resolve) => {
        const chatListener = (payload) => {
            if (payload.state === 'final' || payload.state === 'done' || payload.state === 'complete') {
                const text = payload.message?.content?.[0]?.text || chatResponse
                if (text) chatResponse = text
                resolve()
            }
            if (payload.delta) chatResponse += payload.delta
        }
        
        // Register chat listener
        const origHandler = ws.listeners('message')[0]
        ws.removeAllListeners('message')
        ws.on('message', async (raw) => {
            const data = JSON.parse(raw.toString())
            if (data.type === 'event' && data.event === 'chat') {
                chatListener(data.payload)
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

        sendReq('chat.send', {
            sessionKey: 'agent:main:main',
            message: 'Take a screenshot of whatever page the browser is currently on. Just take a screenshot, nothing else.',
            deliver: true,
            timeoutMs: 60000,
            idempotencyKey: crypto.randomUUID()
        }).catch(() => {})

        setTimeout(() => resolve(), 60000)
    })

    console.log('\nChat response:', chatResponse.substring(0, 500))
    
    console.log('\n═══ Done ═══')
    ws.close()
    setTimeout(() => process.exit(0), 1000)
}

main().catch(e => console.error('Fatal:', e))
