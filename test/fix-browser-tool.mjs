/**
 * Fix Attempt: Disable native browser tool so AI falls through to SKILL.md approach
 * 
 * Steps:
 *   1. List all skills to find browser-automation
 *   2. Check current config (tools, browser, skills sections)
 *   3. Try config.patch to disable ui.browser tool
 *   4. Re-verify tools catalog
 *   5. Test AI chat again for action blocks
 */

import { webcrypto } from 'node:crypto'

import { required, originFor } from './env.mjs'

const GATEWAY_URL = required('AGENTAURA_GATEWAY_URL', 'the gateway address to test against')
const GATEWAY_TOKEN = required('AGENTAURA_GATEWAY_TOKEN', 'the gateway auth token (never commit one)')

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
                                client: { id: 'openclaw-control-ui', version: 'fix-browser', platform: 'chrome-extension', mode: 'webchat', instanceId: crypto.randomUUID() },
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

async function main() {
    console.log('🔧 Fix: Disable native browser tool to enable SKILL.md approach\n')

    const gw = new GatewayClient()
    console.log('🔌 Connecting...')
    await gw.connect()
    console.log('✅ Connected\n')

    // Step 1: List all skills
    console.log('═══ Step 1: List all skills ═══')
    try {
        const res = await gw.sendReq('skills.status')
        const skills = res.payload?.skills || []
        console.log(`Found ${skills.length} skills:`)
        
        const browserSkills = skills.filter(s => 
            s.name?.includes('browser') || s.skillKey?.includes('browser') ||
            s.id?.includes('browser') || JSON.stringify(s).includes('browser')
        )
        
        if (browserSkills.length > 0) {
            console.log('\n🔍 Browser-related skills:')
            for (const s of browserSkills) {
                console.log(`  ${JSON.stringify(s)}`)
            }
        } else {
            console.log('\n⚠️  No browser-related skills found in list')
            console.log('First 10 skills:')
            skills.slice(0, 10).forEach(s => console.log(`  • ${s.name || s.id || s.skillKey || JSON.stringify(s)}`))
            if (skills.length > 10) console.log(`  ... and ${skills.length - 10} more`)
        }
    } catch (e) { console.error('Skills error:', e.message) }

    // Step 2: Get full config
    console.log('\n═══ Step 2: Config inspection ═══')
    let configRaw = ''
    try {
        const res = await gw.sendReq('config.get')
        configRaw = res.payload?.raw || ''
        
        // Extract browser section
        const browserMatch = configRaw.match(/browser\s*:\s*\{[\s\S]*?\n\s*\}/m)
        if (browserMatch) {
            console.log('Browser config:')
            console.log(`  ${browserMatch[0].split('\n').join('\n  ')}`)
        }

        // Extract tools section
        const toolsMatch = configRaw.match(/tools\s*:\s*\{[\s\S]*?\n\s*\}/m)
        if (toolsMatch) {
            console.log('\nTools config:')
            console.log(`  ${toolsMatch[0].split('\n').join('\n  ')}`)
        }

        // Extract skills section
        const skillsMatch = configRaw.match(/skills\s*:\s*\{[\s\S]*?\n\s*\}/m)
        if (skillsMatch) {
            console.log('\nSkills config:')
            console.log(`  ${skillsMatch[0].split('\n').join('\n  ')}`)
        }
    } catch (e) { console.error('Config error:', e.message) }

    // Step 3: Check current tools catalog
    console.log('\n═══ Step 3: Current tools catalog ═══')
    try {
        const res = await gw.sendReq('tools.catalog')
        const groups = res.payload?.groups || []
        const uiBrowser = groups.find(g => g.id === 'ui')
        if (uiBrowser) {
            console.log('UI tool group:')
            console.log(`  tools: ${(uiBrowser.tools || []).map(t => t.id).join(', ')}`)
            console.log(`  Full: ${JSON.stringify(uiBrowser, null, 2).substring(0, 300)}`)
        }
        const profiles = res.payload?.profiles || []
        console.log(`\nProfiles: ${profiles.map(p => p.id || p.name || JSON.stringify(p)).join(', ')}`)
    } catch (e) { console.error('Tools error:', e.message) }

    // Step 4: Try various config patches to disable browser tool
    console.log('\n═══ Step 4: Attempt config patches ═══')
    
    // 4a: Try disabling browser in config
    const patches = [
        { desc: 'browser.enabled = false', patch: { browser: { enabled: false } } },
        { desc: 'tools.disabled = ["ui.browser"]', patch: { tools: { disabled: ['ui.browser'] } } },
        { desc: 'tools.browser.enabled = false', patch: { tools: { browser: { enabled: false } } } },
    ]

    for (const { desc, patch } of patches) {
        console.log(`\n  Trying: ${desc}`)
        try {
            const res = await gw.sendReq('config.patch', patch)
            console.log(`    Result: ${res.ok ? '✅ OK' : '❌ FAIL'} — ${JSON.stringify(res.payload || res.error || '').substring(0, 200)}`)
        } catch (e) {
            const errStr = typeof e === 'object' && e !== null ? JSON.stringify(e).substring(0, 200) : e.message
            console.log(`    Error: ${errStr}`)
        }
    }

    // Step 5: Verify tools catalog changed
    console.log('\n═══ Step 5: Verify tools catalog after patches ═══')
    try {
        const res = await gw.sendReq('tools.catalog')
        const groups = res.payload?.groups || []
        const allTools = groups.flatMap(g => (g.tools || []).map(t => `${g.id}.${t.id}`))
        const hasBrowser = allTools.some(t => t.includes('browser'))
        console.log(`Browser tool still present: ${hasBrowser ? '❌ YES (patch did not work)' : '✅ NO (removed!)'}`)
        console.log(`All tools: ${allTools.join(', ')}`)
    } catch (e) { console.error('Tools error:', e.message) }

    // Step 6: Reset session + test AI chat with browser automation
    console.log('\n═══ Step 6: Test AI chat with action blocks ═══')
    try {
        await gw.sendReq('sessions.reset', { key: 'agent:main:main' })
        console.log('Session reset ✅')
    } catch (_) {}

    console.log('⏳ Sending browser automation request to AI...')
    try {
        const response = await gw.sendChat('agent:main:main', 
            'Navigate to https://example.com and tell me the main heading. Use a navigate action block to control the browser.')
        
        console.log(`\n📝 AI Response (${response.length} chars):`)
        console.log(response.substring(0, 500))
        
        const hasActionBlocks = /```(?:action|json)\s*\n/.test(response)
        const hasPairingError = response.toLowerCase().includes('pairing')
        const usedCurl = response.toLowerCase().includes('curl') || response.toLowerCase().includes('fetch')
        
        console.log(`\n  Action blocks: ${hasActionBlocks ? '✅ YES!' : '❌ NO'}`)
        console.log(`  Pairing error: ${hasPairingError ? '⚠️ YES (native tool still active)' : '✅ NO'}`)
        console.log(`  Used curl/fetch: ${usedCurl ? 'ℹ️ YES' : 'NO'}`)
        console.log(`  Got correct answer: ${response.includes('Example Domain') ? '✅ YES' : '❌ NO'}`)
    } catch (e) { console.error('Chat error:', e.message) }

    // Step 7: Restore config
    console.log('\n═══ Step 7: Restore browser config ═══')
    try {
        const res = await gw.sendReq('config.patch', { browser: { enabled: true } })
        console.log(`Restored browser.enabled=true: ${res.ok ? '✅' : '❌'}`)
    } catch (e) { console.log(`Restore error: ${e.message}`) }

    // Step 8: Try alternate approach — tell AI explicitly to use skill-based approach
    console.log('\n═══ Step 8: Alternate — Explicit SKILL.md prompt ═══')
    try {
        await gw.sendReq('sessions.reset', { key: 'agent:main:main' })
    } catch (_) {}

    console.log('⏳ Sending explicit skill-based prompt...')
    try {
        const prompt = `You have a browser automation skill installed. Do NOT use any built-in browser tools. Instead, respond with action blocks in this exact format:

\`\`\`action
{"type": "navigate", "url": "https://example.com"}
\`\`\`

After the action is executed, I'll provide the result. Now navigate to https://example.com.`
        
        const response = await gw.sendChat('agent:main:main', prompt)
        console.log(`\n📝 AI Response (${response.length} chars):`)
        console.log(response.substring(0, 500))
        
        const hasActionBlocks = /```(?:action|json)\s*\n/.test(response)
        console.log(`\n  Action blocks: ${hasActionBlocks ? '✅ YES!' : '❌ NO'}`)

        // Try extracting
        const actionRegex = /```(?:action|json)\s*\n([\s\S]*?)```/g
        let match, actions = []
        while ((match = actionRegex.exec(response)) !== null) {
            try {
                const parsed = JSON.parse(match[1].trim())
                actions.push(parsed)
            } catch (_) {}
        }
        if (actions.length) {
            console.log(`  Extracted actions: ${JSON.stringify(actions)}`)
        }
    } catch (e) { console.error('Chat error:', e.message) }

    gw.close()
    console.log('\n🏁 Done.')
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
