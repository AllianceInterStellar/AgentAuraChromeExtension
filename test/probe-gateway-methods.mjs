/**
 * Extract full gateway method list from hello-ok response
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

    const ws = new WebSocket(GATEWAY_URL, {
        headers: { Origin: originFor(GATEWAY_URL) }
    })

    ws.on('message', async (raw) => {
        const data = JSON.parse(raw.toString())

        if (data.type === 'event' && data.event === 'connect.challenge') {
            const nonce = data.payload?.nonce || ''
            const now = Date.now()
            const signPayload = ['v2', deviceId, 'openclaw-control-ui', 'webchat', 'operator',
                'operator.admin,operator.approvals,operator.pairing', now.toString(), GATEWAY_TOKEN, nonce].join('|')
            const sig = await webcrypto.subtle.sign('Ed25519', keyPair.privateKey, new TextEncoder().encode(signPayload))
            const signature = Buffer.from(sig).toString('base64')

            ws.send(JSON.stringify({
                type: 'req', id: 'req-1', method: 'connect',
                params: {
                    minProtocol: 3, maxProtocol: 3,
                    client: { id: 'openclaw-control-ui', version: 'probe', platform: 'node', mode: 'webchat', instanceId: crypto.randomUUID() },
                    role: 'operator',
                    scopes: ['operator.admin', 'operator.approvals', 'operator.pairing'],
                    device: { id: deviceId, publicKey: pubB64, signature, signedAt: now, nonce },
                    caps: ['tool-events'],
                    auth: { token: GATEWAY_TOKEN }
                }
            }))
        }

        if (data.type === 'res' && data.id === 'req-1' && data.ok) {
            const payload = data.payload
            console.log('Server version:', payload?.server?.version)
            console.log('Protocol:', payload?.protocol)
            console.log('\nSupported methods:')
            const methods = payload?.features?.methods || []
            methods.forEach(m => console.log(`  - ${m}`))
            console.log(`\nTotal: ${methods.length} methods`)

            console.log('\nFeatures:', JSON.stringify(payload?.features, null, 2))

            // Also get config
            ws.send(JSON.stringify({
                type: 'req', id: 'req-2', method: 'config.get', params: {}
            }))
        }

        if (data.type === 'res' && data.id === 'req-2') {
            console.log('\n\n═══ Full OpenClaw Config ═══')
            console.log(data.payload?.raw || JSON.stringify(data.payload, null, 2))
            ws.close()
            setTimeout(() => process.exit(0), 500)
        }
    })

    ws.on('error', e => console.error('Error:', e.message))
    setTimeout(() => { ws.close(); process.exit(0) }, 15000)
}

main().catch(e => console.error(e))
