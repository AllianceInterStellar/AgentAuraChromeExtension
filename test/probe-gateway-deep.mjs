/**
 * Deep probe of gateway browser, tools, and node pairing
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

        if (data.type === 'event' && data.event !== 'tick' && data.event !== 'health') {
            console.log(`  [event] ${data.event}:`, JSON.stringify(data.payload || {}).substring(0, 500))
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

    // 1. Tools catalog
    console.log('═══ 1. tools.catalog ═══')
    try {
        const res = await sendReq('tools.catalog')
        console.log(JSON.stringify(res.payload, null, 2).substring(0, 3000))
    } catch (e) { console.log('Error:', JSON.stringify(e.payload || e).substring(0, 500)) }

    // 2. Browser request
    console.log('\n═══ 2. browser.request ═══')
    try {
        const res = await sendReq('browser.request', { action: 'screenshot' })
        console.log(JSON.stringify(res.payload, null, 2).substring(0, 1000))
    } catch (e) { console.log('Error:', JSON.stringify(e.payload || e).substring(0, 500)) }

    // 3. Node list
    console.log('\n═══ 3. node.list ═══')
    try {
        const res = await sendReq('node.list')
        console.log(JSON.stringify(res.payload, null, 2).substring(0, 1000))
    } catch (e) { console.log('Error:', JSON.stringify(e.payload || e).substring(0, 500)) }

    // 4. Node pair list
    console.log('\n═══ 4. node.pair.list ═══')
    try {
        const res = await sendReq('node.pair.list')
        console.log(JSON.stringify(res.payload, null, 2).substring(0, 1000))
    } catch (e) { console.log('Error:', JSON.stringify(e.payload || e).substring(0, 500)) }

    // 5. Device pair list
    console.log('\n═══ 5. device.pair.list ═══')
    try {
        const res = await sendReq('device.pair.list')
        console.log(JSON.stringify(res.payload, null, 2).substring(0, 1000))
    } catch (e) { console.log('Error:', JSON.stringify(e.payload || e).substring(0, 500)) }

    // 6. Skills status
    console.log('\n═══ 6. skills.status ═══')
    try {
        const res = await sendReq('skills.status')
        console.log(JSON.stringify(res.payload, null, 2).substring(0, 2000))
    } catch (e) { console.log('Error:', JSON.stringify(e.payload || e).substring(0, 500)) }

    // 7. Skills bins (available skills)
    console.log('\n═══ 7. skills.bins ═══')
    try {
        const res = await sendReq('skills.bins')
        console.log(JSON.stringify(res.payload, null, 2).substring(0, 2000))
    } catch (e) { console.log('Error:', JSON.stringify(e.payload || e).substring(0, 500)) }

    // 8. Reset the main session to clear stale history
    console.log('\n═══ 8. sessions.reset (main) ═══')
    try {
        const res = await sendReq('sessions.reset', { sessionKey: 'agent:main:main' })
        console.log(JSON.stringify(res.payload, null, 2).substring(0, 500))
    } catch (e) { console.log('Error:', JSON.stringify(e.payload || e).substring(0, 500)) }

    // 9. Node describe (this node)
    console.log('\n═══ 9. node.describe ═══')
    try {
        const res = await sendReq('node.describe', {})
        console.log(JSON.stringify(res.payload, null, 2).substring(0, 1000))
    } catch (e) { console.log('Error:', JSON.stringify(e.payload || e).substring(0, 500)) }

    // 10. Node canvas capability refresh
    console.log('\n═══ 10. node.canvas.capability.refresh ═══')
    try {
        const res = await sendReq('node.canvas.capability.refresh', {})
        console.log(JSON.stringify(res.payload, null, 2).substring(0, 1000))
    } catch (e) { console.log('Error:', JSON.stringify(e.payload || e).substring(0, 500)) }

    console.log('\n═══ Done ═══')
    ws.close()
    setTimeout(() => process.exit(0), 1000)
}

main().catch(e => console.error('Fatal:', e))
