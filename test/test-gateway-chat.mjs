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

async function sign(keyPair, message) {
    const sig = await webcrypto.subtle.sign('Ed25519', keyPair.privateKey, new TextEncoder().encode(message))
    return Buffer.from(sig).toString('base64')
}

async function main() {
    const { default: WebSocket } = await import('ws')
    const device = await generateDeviceIdentity()
    console.log('Device ID:', device.deviceId.slice(0, 16) + '...')

    const ws = new WebSocket(GATEWAY_URL, {
        headers: { Origin: originFor(GATEWAY_URL) }
    })
    let reqCounter = 0
    const pendingRequests = {}

    function nextReqId() { return `req-${++reqCounter}` }

    function sendReq(method, params) {
        const id = nextReqId()
        const frame = { type: 'req', id, method, params }
        ws.send(JSON.stringify(frame))
        return new Promise((resolve, reject) => {
            pendingRequests[id] = { resolve, reject }
            setTimeout(() => { delete pendingRequests[id]; reject(new Error(`Timeout: ${method}`)) }, method === 'chat.send' ? 120000 : 15000)
        })
    }

    ws.on('open', () => console.log('WebSocket connected, waiting for challenge...'))

    ws.on('message', async (raw) => {
        const data = JSON.parse(raw.toString())

        if (data.type === 'event') {
            const event = data.event
            const payload = data.payload || {}

            if (event !== 'connect.challenge') {
                if (event === 'chat') {
                    console.log('[chat event]', JSON.stringify(payload).slice(0, 300))
                } else {
                    console.log('[event]', event, JSON.stringify(payload).slice(0, 150))
                }
            }

            if (event === 'connect.challenge') {
                console.log('Got challenge, authenticating...')
                const nonce = payload.nonce || ''
                const now = Date.now()
                const clientId = 'openclaw-control-ui'
                const clientMode = 'webchat'
                const role = 'operator'
                const scopes = ['operator.admin', 'operator.approvals', 'operator.pairing']

                const signPayload = ['v2', device.deviceId, clientId, clientMode, role, scopes.join(','), now.toString(), GATEWAY_TOKEN, nonce].join('|')
                const signature = await sign(device.keyPair, signPayload)

                const id = nextReqId()
                const frame = {
                    type: 'req', id, method: 'connect',
                    params: {
                        minProtocol: 3, maxProtocol: 3,
                        client: { id: clientId, version: 'control-ui', platform: 'test-script', mode: clientMode, instanceId: crypto.randomUUID() },
                        role, scopes,
                        device: { id: device.deviceId, publicKey: device.pubB64, signature, signedAt: now, nonce },
                        caps: ['tool-events'],
                        auth: { token: GATEWAY_TOKEN }
                    }
                }
                pendingRequests[id] = {
                    resolve: async () => {
                        console.log('Authenticated!')

                        try {
                            const sessRes = await sendReq('sessions.list', {})
                            let sessionKey = 'agent:main:main'
                            if (sessRes.ok) {
                                const sessions = Array.isArray(sessRes.payload) ? sessRes.payload : (sessRes.payload?.sessions || [])
                                for (const s of sessions) {
                                    const key = s?.key || s?.sessionKey
                                    if (key && key.startsWith('agent:main:')) { sessionKey = key; break }
                                }
                            }
                            console.log('Session key:', sessionKey)

                            console.log('\nSending chat message...')
                            const chatRes = await sendReq('chat.send', {
                                sessionKey,
                                message: 'Go to https://example.com and tell me what you see on the page. Use browser automation actions.',
                                deliver: true,
                                timeoutMs: 120000,
                                idempotencyKey: crypto.randomUUID()
                            })
                            console.log('chat.send response ok:', chatRes.ok)
                        } catch (e) {
                            console.error('Error:', e.message)
                        }
                    },
                    reject: (e) => console.error('Auth failed:', e)
                }
                ws.send(JSON.stringify(frame))
                return
            }

            if (event === 'chat') {
                const state = payload.state
                const delta = payload.delta || ''
                if (delta) process.stdout.write(delta)
                if (state === 'done' || state === 'complete' || state === 'aborted') {
                    const full = payload.fullContent || payload.content || ''
                    console.log('\n\n--- Chat complete ---')
                    const hasAction = full.includes('action:browser') || full.includes('```action')
                    console.log('Has browser action blocks:', hasAction)
                    if (hasAction) {
                        const blocks = full.match(/```action:[^\n]+\n[\s\S]*?```/g) || []
                        console.log('Action blocks:', blocks.length)
                        blocks.forEach((b, i) => console.log(`  Block ${i}:`, b.slice(0, 120)))
                    }
                    setTimeout(() => { ws.close(); process.exit(0) }, 1000)
                }
            }
        }

        if (data.type === 'res') {
            const id = data.id
            console.log('[res]', id, 'ok:', data.ok, 'payload type:', data.payload?.type || '?')
            if (id && pendingRequests[id]) {
                if (data.ok) {
                    pendingRequests[id].resolve(data)
                } else {
                    pendingRequests[id].reject(new Error(JSON.stringify(data.payload || data)))
                }
                delete pendingRequests[id]
            }
        }
    })

    ws.on('error', (err) => console.error('WS error:', err.message))
    ws.on('close', (code, reason) => { console.log('WS closed:', code, reason.toString()); process.exit(0) })
    setTimeout(() => { console.log('\n--- Timeout (90s) ---'); ws.close(); process.exit(1) }, 90000)
}

main().catch(e => console.error('ERROR:', e.message))
