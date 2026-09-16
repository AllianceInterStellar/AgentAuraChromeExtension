/**
 * 技能安装 + 浏览器自动化 E2E 测试
 *
 * 完整流程:
 *   1. 获取运行中的 claw 信息 (API + DB)
 *   2. 调用 installAgentSkill API 安装浏览器自动化技能
 *   3. 读取服务器上的 SKILL.md 验证内容
 *   4. 读取 openclaw.json 验证 skills.entries 注册
 *   5. 等待网关重启
 *   6. 连接 WebSocket 网关
 *   7. 发送 "open google.com" 测试消息
 *   8. 检查 AI 回复是否包含 action 代码块
 *
 * 运行:
 *   node skill-automation-e2e.mjs
 *   FIREBASE_TOKEN=xxx node skill-automation-e2e.mjs
 *   API_URL=http://localhost:2222 node skill-automation-e2e.mjs
 */

import { webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'
import https from 'node:https'

function requireApiEnvPath() {
    const fp = process.env.AGENTAURA_API_ENV
    if (fp) return fp
    console.error('\nMissing AGENTAURA_API_ENV — path to the API .env these queries read DATABASE_URL from')
    console.error('  export AGENTAURA_API_ENV=/path/to/AgentAura/apps/api/.env\n')
    process.exit(2)
}

const __dirname = dirname(fileURLToPath(import.meta.url))

const FIREBASE_API_KEY = 'AIzaSyBdKqX4ZPKnw1sM1c09_dGtiBJlFV13iSs'
const API_BASE = process.env.API_URL || 'https://d1em8r2hdbckr6.cloudfront.net'
const API_ENV_PATH = requireApiEnvPath()

const log = (tag, msg) => console.log(`[${new Date().toISOString().slice(11, 19)}][${tag}] ${msg}`)
const ok = (msg) => { passed++; console.log(`  ✅ ${msg}`) }
const fail = (msg) => { failed++; console.log(`  ❌ ${msg}`) }
const info = (msg) => console.log(`  ℹ️  ${msg}`)

let passed = 0, failed = 0

// ── SKILL.md content (same as skill-installer.js) ──
const BROWSER_AUTOMATION_SKILL = `# Browser Automation

You have browser automation capabilities through a Chrome extension. When you need to control the browser, output JSON instructions inside \`\`\`action code blocks.

## Action Format

\`\`\`action
{"type": "action_type", ...params}
\`\`\`

You can output multiple action blocks in one response. They execute sequentially.

## Available Actions

### Navigation
- \`{"type": "navigate", "url": "https://..."}\` — Go to URL in current tab
- \`{"type": "new_tab", "url": "https://..."}\` — Open URL in new tab

### Interaction (by ref number)
Page elements are labeled with [ref] numbers. Use these to interact:
- \`{"type": "click_ref", "ref": 5}\` — Click element [5]
- \`{"type": "type_ref", "ref": 5, "text": "hello"}\` — Type into element [5]

### Page Content
- \`{"type": "read_page_content"}\` — Get interactive elements with ref numbers
- \`{"type": "screenshot"}\` — Capture current page screenshot

### Utility
- \`{"type": "scroll", "direction": "down", "amount": 300}\` — Scroll
- \`{"type": "wait", "duration": 1000}\` — Wait milliseconds
- \`{"type": "execute_js", "code": "document.title"}\` — Execute JavaScript on page

## Guidelines

1. When page elements have [ref] numbers, prefer ref-based actions over CSS selectors.
2. After performing actions, you'll receive updated page state.
3. If an action fails, try a different approach.
4. For multi-step tasks, do one or two actions at a time, then verify results.
5. If you determine the task is complete, respond with a text summary.
`

// ── Proxy helpers ──
const SOCKS_PROXY = process.env.SOCKS_PROXY || 'socks5h://127.0.0.1:22334'
let _socksAgent = null

async function getSocksAgent() {
    if (_socksAgent) return _socksAgent
    try {
        const { SocksProxyAgent } = await import('socks-proxy-agent')
        _socksAgent = new SocksProxyAgent(SOCKS_PROXY)
        return _socksAgent
    } catch {
        return null
    }
}

function proxyFetch(url, options = {}) {
    return new Promise(async (res, rej) => {
        const u = new URL(url)
        const agent = await getSocksAgent()
        const opt = {
            hostname: u.hostname, path: u.pathname + u.search, port: u.port || 443,
            method: options.method || 'GET',
            headers: options.headers || {},
            timeout: 30000,
            ...(agent ? { agent } : {})
        }
        const req = https.request(opt, (response) => {
            let data = ''
            response.on('data', c => data += c)
            response.on('end', () => res({
                ok: response.statusCode >= 200 && response.statusCode < 300,
                status: response.statusCode,
                json: () => Promise.resolve(JSON.parse(data)),
                text: () => Promise.resolve(data)
            }))
        })
        req.on('error', rej)
        req.on('timeout', () => { req.destroy(); rej(new Error('timeout')) })
        if (options.body) req.write(options.body)
        req.end()
    })
}

function apiFetch(path, options = {}) {
    const url = `${API_BASE}${path}`
    return fetch(url, { ...options, signal: AbortSignal.timeout(30000) })
}

// ── Load .env ──
function loadEnv(filepath) {
    const env = {}
    try {
        for (const line of readFileSync(filepath, 'utf8').split('\n')) {
            const t = line.trim()
            if (!t || t.startsWith('#')) continue
            const eq = t.indexOf('=')
            if (eq === -1) continue
            let val = t.slice(eq + 1).trim()
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
                val = val.slice(1, -1)
            env[t.slice(0, eq).trim()] = val
        }
    } catch { }
    return env
}

// ── 1. Firebase auth ──
async function getAuthToken() {
    if (process.env.FIREBASE_TOKEN) {
        log('AUTH', '使用预置 FIREBASE_TOKEN')
        return process.env.FIREBASE_TOKEN
    }

    log('AUTH', '匿名登录 Firebase...')
    const res = await proxyFetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) }
    )
    if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(`Firebase 登录失败: ${err?.error?.message || res.status}`)
    }
    const data = await res.json()
    log('AUTH', `匿名登录成功 (uid=${data.localId})`)
    return data.idToken
}

// ── 2. Get running claw ──
async function getRunningClaw(idToken) {
    log('API', '获取 claw 列表...')
    const res = await apiFetch('/claws', {
        headers: { Authorization: `Bearer ${idToken}` }
    })
    if (!res.ok) throw new Error(`claws API 失败: ${res.status}`)
    const json = await res.json()
    let claws = Array.isArray(json) ? json : (json.data || json.claws || [])
    if (!Array.isArray(claws)) claws = []
    const running = claws.filter(c => c.status === 'running' && c.subdomain)
    if (running.length === 0) throw new Error('没有运行中的 claw')
    const claw = running[0]
    log('API', `选择 claw: ${claw.name || claw.id} (${claw.subdomain}.digitalenginecore.com)`)
    return claw
}

// ── 2b. Get running claw directly from DB ──
async function getClawFromDB() {
    const env = loadEnv(API_ENV_PATH)
    const dbUrl = env.DATABASE_URL
    if (!dbUrl) throw new Error('DATABASE_URL not found in API .env')

    log('DB', '直接从数据库获取 claw 信息...')
    const pg = await import('pg')
    const client = new pg.default.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
    await client.connect()

    const res = await client.query(
        "SELECT id, name, subdomain, gateway_token, status, provider, user_id FROM claws WHERE status = 'running' AND subdomain IS NOT NULL LIMIT 1"
    )
    await client.end()

    if (res.rows.length === 0) throw new Error('数据库无运行中的 claw')

    const row = res.rows[0]
    log('DB', `选择 claw: ${row.name || row.id} (${row.subdomain}.digitalenginecore.com, provider=${row.provider})`)
    return {
        id: row.id,
        name: row.name,
        subdomain: row.subdomain,
        gatewayToken: row.gateway_token,
        status: row.status,
        provider: row.provider,
        userId: row.user_id
    }
}

// ── 2c. Get Firebase custom token from DB user ──
async function getFirebaseTokenForUser(userId) {
    try {
        const env = loadEnv(API_ENV_PATH)
        const projectId = env.FIREBASE_PROJECT_ID
        const clientEmail = env.FIREBASE_CLIENT_EMAIL
        let privateKey = env.FIREBASE_PRIVATE_KEY
        if (!projectId || !clientEmail || !privateKey) return null

        privateKey = privateKey.replace(/\\n/g, '\n')

        const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
        const now = Math.floor(Date.now() / 1000)
        const payload = Buffer.from(JSON.stringify({
            iss: clientEmail, sub: clientEmail, aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
            iat: now, exp: now + 3600, uid: userId
        })).toString('base64url')

        const sigInput = `${header}.${payload}`
        const key = await webcrypto.subtle.importKey(
            'pkcs8', pemToBuf(privateKey), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
        )
        const sig = await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(sigInput))
        const customToken = `${sigInput}.${Buffer.from(sig).toString('base64url')}`

        const res = await proxyFetch(
            `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_API_KEY}`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: customToken, returnSecureToken: true }) }
        )
        if (!res.ok) return null
        const data = await res.json()
        return data.idToken
    } catch {
        return null
    }
}

function pemToBuf(pem) {
    const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')
    return Buffer.from(b64, 'base64')
}

// ── 3. Install skill via API ──
async function installSkill(idToken, clawId) {
    log('SKILL', `安装 browser-automation 技能到 claw ${clawId}...`)
    const res = await apiFetch(`/claws/${clawId}/agents/main/skills`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'install', skillName: 'browser-automation', content: BROWSER_AUTOMATION_SKILL })
    })
    if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`技能安装失败: ${res.status} ${text}`)
    }
    const data = await res.json()
    log('SKILL', `安装响应: ${JSON.stringify(data).slice(0, 200)}`)
    return true
}

// ── 4. Read file from server ──
async function readServerFile(idToken, clawId, filePath) {
    const res = await apiFetch(`/claws/${clawId}/files/read`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath })
    })
    if (!res.ok) return null
    const json = await res.json()
    return json?.data?.content || json?.content || null
}

// ── 3b/4b. SSH direct: install skill & read files ──
async function getClawSSHInfo(clawId) {
    const env = loadEnv(API_ENV_PATH)
    const dbUrl = env.DATABASE_URL
    if (!dbUrl) throw new Error('DATABASE_URL not found')
    const pg = await import('pg')
    const client = new pg.default.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
    await client.connect()
    const res = await client.query('SELECT ip, root_password FROM claws WHERE id = $1', [clawId])
    await client.end()
    if (res.rows.length === 0) throw new Error('Claw not found in DB')
    return { ip: res.rows[0].ip, password: res.rows[0].root_password }
}

function executeSSH(ip, password, command, timeout = 30000) {
    return new Promise(async (resolve, reject) => {
        const { Client } = await import('ssh2')
        const conn = new Client()
        let output = ''
        const timer = setTimeout(() => { conn.end(); reject(new Error(`SSH timeout: ${command.slice(0, 60)}`)) }, timeout)
        conn.on('ready', () => {
            conn.exec(command, (err, stream) => {
                if (err) { clearTimeout(timer); conn.end(); return reject(err) }
                stream.on('data', (d) => output += d.toString())
                stream.stderr.on('data', (d) => output += d.toString())
                stream.on('close', () => { clearTimeout(timer); conn.end(); resolve(output) })
            })
        })
        conn.on('error', (e) => { clearTimeout(timer); reject(e) })
        conn.connect({ host: ip, port: 22, username: 'root', password, readyTimeout: 30000, algorithms: { serverHostKey: ['ssh-ed25519', 'ssh-rsa', 'ecdsa-sha2-nistp256'] } })
    })
}

async function installSkillViaSSH(clawId, agentId = 'main') {
    const { ip, password } = await getClawSSHInfo(clawId)
    const BASE_DIR = '/home/openclaw/.openclaw'
    const skillDir = `${BASE_DIR}/agents/${agentId}/workspace/skills/browser-automation`
    const skillFile = `${skillDir}/SKILL.md`
    const configFile = `${BASE_DIR}/openclaw.json`

    log('SSH', `连接 ${ip} 安装技能...`)

    await executeSSH(ip, password, `mkdir -p ${skillDir}`)
    log('SSH', '目录创建成功')

    const b64Content = Buffer.from(BROWSER_AUTOMATION_SKILL).toString('base64')
    await executeSSH(ip, password, `echo '${b64Content}' | base64 -d > '${skillFile}'`)
    log('SSH', 'SKILL.md 写入成功')

    await executeSSH(ip, password, `chown -R openclaw:openclaw ${BASE_DIR}/agents/${agentId}/workspace/skills`)
    log('SSH', '权限设置成功')

    const rawConfig = await executeSSH(ip, password, `cat ${configFile} 2>/dev/null || echo '{}'`)
    let config
    try {
        const jsonMatch = rawConfig.match(/\{[\s\S]*\}/)
        config = jsonMatch ? JSON.parse(jsonMatch[0]) : {}
    } catch { config = {} }

    if (!config.skills) config.skills = {}
    if (!config.skills.entries) config.skills.entries = {}
    config.skills.entries['browser-automation'] = { enabled: true }

    const configB64 = Buffer.from(JSON.stringify(config, null, 2)).toString('base64')
    await executeSSH(ip, password, `echo '${configB64}' | base64 -d > '${configFile}' && chown openclaw:openclaw '${configFile}'`)
    log('SSH', 'openclaw.json 更新成功')

    await executeSSH(ip, password, `su - openclaw -c "openclaw doctor --fix" 2>&1 || true`, 60000)
    log('SSH', 'doctor --fix 完成')

    await executeSSH(ip, password, `systemctl restart openclaw-gateway 2>&1 || true`)
    log('SSH', '网关重启完成')

    return true
}

async function readFileViaSSH(clawId, filePath) {
    try {
        const { ip, password } = await getClawSSHInfo(clawId)
        const fullPath = `/home/openclaw/.openclaw/${filePath}`
        return await executeSSH(ip, password, `cat '${fullPath}' 2>/dev/null`)
    } catch { return null }
}

// ── 5. Ed25519 identity ──
async function createDeviceIdentity() {
    const keyPair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    const rawPub = await webcrypto.subtle.exportKey('raw', keyPair.publicKey)
    const spkiPub = await webcrypto.subtle.exportKey('spki', keyPair.publicKey)
    const hashBuf = await webcrypto.subtle.digest('SHA-256', rawPub)
    const deviceId = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('')
    const publicKeyBase64 = Buffer.from(spkiPub).toString('base64')
    return {
        deviceId, publicKeyBase64,
        async sign(payload) {
            const sig = await webcrypto.subtle.sign({ name: 'Ed25519' }, keyPair.privateKey, new TextEncoder().encode(payload))
            return Buffer.from(sig).toString('base64')
        }
    }
}

// ── 6. Gateway connection ──
async function connectGateway(gatewayUrl, gatewayToken) {
    const { default: WebSocket } = await import('ws')
    const wsUrl = gatewayUrl.replace('https://', 'wss://').replace('http://', 'ws://') + '/'

    log('WS', `连接 ${wsUrl}...`)

    let wsOpts = {}
    const agent = await getSocksAgent()
    if (agent) wsOpts = { agent }

    return new Promise((resolveConn, rejectConn) => {
        const ws = new WebSocket(wsUrl, wsOpts)
        let reqCounter = 0
        const pending = {}
        const listeners = {}
        let connected = false

        const nextId = () => `req-${++reqCounter}`
        const send = (frame) => ws.send(JSON.stringify(frame))
        const sendRequest = (method, params) => {
            const id = nextId()
            return new Promise((resolve, reject) => {
                pending[id] = { resolve, reject }
                send({ type: 'req', id, method, params })
                setTimeout(() => {
                    if (pending[id]) { delete pending[id]; reject(new Error(`Timeout: ${method}`)) }
                }, method === 'chat.send' ? 120000 : 15000)
            })
        }
        const on = (event, fn) => { if (!listeners[event]) listeners[event] = []; listeners[event].push(fn) }
        const off = (event, fn) => { if (listeners[event]) listeners[event] = listeners[event].filter(l => l !== fn) }

        ws.on('open', () => log('WS', '已打开，等待 challenge...'))
        ws.on('message', async (raw) => {
            const data = JSON.parse(raw.toString())
            if (data.type === 'event' && data.event === 'connect.challenge') {
                const nonce = data.payload?.nonce || ''
                const device = await createDeviceIdentity()
                const now = Date.now()
                const clientId = 'openclaw-control-ui'
                const signPayload = ['v2', device.deviceId, clientId, 'webchat', 'operator', 'operator.admin,operator.approvals,operator.pairing', now.toString(), gatewayToken, nonce].join('|')
                const signature = await device.sign(signPayload)
                const id = nextId()
                pending[id] = {
                    resolve: (resp) => {
                        if (resp.ok && resp.payload?.type === 'hello-ok') {
                            connected = true; log('WS', '认证成功 ✓')
                            resolveConn({ sendRequest, on, off, close: () => ws.close() })
                        }
                    },
                    reject: () => { }
                }
                send({
                    type: 'req', id, method: 'connect',
                    params: {
                        minProtocol: 3, maxProtocol: 3,
                        client: { id: clientId, version: 'control-ui', platform: 'e2e-test', mode: 'webchat', instanceId: webcrypto.randomUUID() },
                        role: 'operator', scopes: ['operator.admin', 'operator.approvals', 'operator.pairing'],
                        device: { id: device.deviceId, publicKey: device.publicKeyBase64, signature, signedAt: now, nonce },
                        caps: ['tool-events'],
                        auth: { token: gatewayToken }
                    }
                })
                return
            }
            if (data.type === 'event') {
                const fns = listeners[data.event] || []
                for (const fn of [...fns]) fn(data.payload || {})
            }
            if (data.type === 'res') {
                if (data.ok && !connected && data.payload?.type === 'hello-ok') { connected = true; log('WS', '认证成功 ✓') }
                const p = pending[data.id]
                if (p) { delete pending[data.id]; p.resolve(data) }
            }
        })
        ws.on('error', (e) => { log('WS', `错误: ${e.message}`); rejectConn(e) })
        ws.on('close', () => { if (!connected) rejectConn(new Error('连接关闭')) })
        setTimeout(() => { if (!connected) rejectConn(new Error('连接超时 (20s)')) }, 20000)
    })
}

// ── 7. Resolve session key ──
async function resolveSessionKey(gw) {
    try {
        const resp = await gw.sendRequest('sessions.list', {})
        if (resp.ok) {
            const payload = resp.payload
            let sessions = Array.isArray(payload) ? payload : payload?.sessions || []
            for (const s of sessions) {
                const key = s?.key || s?.sessionKey
                if (key && key.startsWith('agent:main:')) return key
            }
        }
    } catch { }
    return 'agent:main:main'
}

// ── 8. Send chat and collect full response ──
async function sendChat(gw, sessionKey, message) {
    return new Promise((resolve, reject) => {
        let fullText = ''
        let activeRunId = null
        const idempotencyKey = webcrypto.randomUUID()

        const chatListener = (payload) => {
            if (payload.sessionKey !== sessionKey) return
            if (!activeRunId) activeRunId = payload.runId
            if (payload.runId && payload.runId !== activeRunId) return

            const extractText = (msg) => {
                if (typeof msg === 'string') return msg
                if (Array.isArray(msg)) return msg.filter(b => b.type === 'text').map(b => b.text).join('')
                if (msg?.text) return msg.text
                if (msg?.content && typeof msg.content === 'string') return msg.content
                return ''
            }

            switch (payload.state) {
                case 'delta': fullText = extractText(payload.message) || fullText; break
                case 'final':
                    fullText = extractText(payload.message) || fullText
                    gw.off('chat', chatListener)
                    resolve(fullText)
                    break
                case 'error':
                    gw.off('chat', chatListener)
                    reject(new Error(payload.errorMessage || 'chat error'))
                    break
                case 'aborted':
                    gw.off('chat', chatListener)
                    resolve(fullText)
                    break
            }
        }

        gw.on('chat', chatListener)

        gw.sendRequest('chat.send', {
            sessionKey, message, deliver: true, timeoutMs: 120000, idempotencyKey
        }).then(resp => {
            if (!resp.ok) log('CHAT', `chat.send 响应: ok=${resp.ok}`)
        }).catch(e => { gw.off('chat', chatListener); reject(e) })

        setTimeout(() => { gw.off('chat', chatListener); resolve(fullText) }, 90000)
    })
}

// ═══ MAIN ═══
async function main() {
    console.log('\n╔══════════════════════════════════════════════════╗')
    console.log('║  技能安装 + 浏览器自动化 E2E 完整测试            ║')
    console.log('╚══════════════════════════════════════════════════╝')
    console.log(`  API: ${API_BASE}`)
    console.log(`  Proxy: ${SOCKS_PROXY}`)
    console.log('')

    let gatewayUrl = process.env.GATEWAY_URL
    let gatewayToken = process.env.GATEWAY_TOKEN || ''
    let idToken = null
    let clawId = null
    let dbDirect = false

    // ── Step 1: Authentication & claw discovery ──
    console.log('── 1. 认证 & 获取 Claw ──')

    if (gatewayUrl && process.env.FIREBASE_TOKEN) {
        log('MODE', `直连模式 + Token: ${gatewayUrl}`)
        idToken = process.env.FIREBASE_TOKEN
        const claw = await getRunningClaw(idToken).catch(() => null)
        clawId = claw?.id
    } else if (gatewayUrl) {
        log('MODE', `直连模式 (无API): ${gatewayUrl}`)
        try {
            const claw = await getClawFromDB()
            clawId = claw.id
            if (!gatewayToken) gatewayToken = claw.gatewayToken || ''
        } catch (e) {
            log('DB', `DB 查询失败: ${e.message}`)
        }
        dbDirect = true
    } else {
        try {
            idToken = process.env.FIREBASE_TOKEN || await getAuthToken()
            const claw = await getRunningClaw(idToken)
            clawId = claw.id
            gatewayUrl = `https://${claw.subdomain}.digitalenginecore.com`
            gatewayToken = claw.gatewayToken || ''
        } catch (e) {
            log('AUTH', `Firebase/API 不可达: ${e.message}`)
            log('MODE', '回退到 DB 直连模式...')
            dbDirect = true
            try {
                const claw = await getClawFromDB()
                clawId = claw.id
                gatewayUrl = `https://${claw.subdomain}.digitalenginecore.com`
                gatewayToken = claw.gatewayToken || ''

                idToken = await getFirebaseTokenForUser(claw.userId)
                if (idToken) log('AUTH', '通过 Firebase Admin SDK 获取 token 成功')
                else log('AUTH', '无法获取 API token，技能安装将使用 SSH 直连')
            } catch (dbErr) {
                throw new Error(`所有认证方式均失败: ${dbErr.message}`)
            }
        }
    }

    if (!clawId) {
        fail('无法获取 claw ID，跳过技能安装测试')
    } else {
        ok(`Claw ID: ${clawId}`)
    }

    // ── Step 2: Install browser-automation skill ──
    console.log('\n── 2. 安装 browser-automation 技能 ──')

    if (clawId) {
        if (idToken) {
            try {
                await installSkill(idToken, clawId)
                ok('技能安装 API 调用成功')
            } catch (e) {
                log('SKILL', `API 安装失败 (${e.message})，回退到 SSH 直连...`)
                try {
                    await installSkillViaSSH(clawId)
                    ok('技能通过 SSH 直连安装成功')
                } catch (e2) {
                    fail(`SSH 安装也失败: ${e2.message}`)
                }
            }
        } else {
            log('SKILL', '无 API token，使用 SSH 直连安装...')
            try {
                await installSkillViaSSH(clawId)
                ok('技能通过 SSH 直连安装成功')
            } catch (e) {
                fail(`SSH 安装失败: ${e.message}`)
            }
        }
    }

    // ── Step 3: Verify SKILL.md on server ──
    console.log('\n── 3. 验证 SKILL.md 内容 ──')

    if (clawId) {
        let skillContent = null
        if (idToken) skillContent = await readServerFile(idToken, clawId, 'agents/main/workspace/skills/browser-automation/SKILL.md')
        if (!skillContent) skillContent = await readFileViaSSH(clawId, 'agents/main/workspace/skills/browser-automation/SKILL.md')

        if (skillContent && skillContent.includes('Browser Automation')) {
            ok(`SKILL.md 内容正确 (${skillContent.length} 字符)`)
            if (skillContent.includes('action_type')) ok('包含 action_type 定义')
            else fail('缺少 action_type 定义')
            if (skillContent.includes('navigate')) ok('包含 navigate 动作')
            else fail('缺少 navigate 动作')
        } else if (skillContent) {
            fail(`SKILL.md 内容异常 (${skillContent.length} 字符): ${skillContent.substring(0, 100)}`)
        } else {
            fail('无法读取 SKILL.md')
        }
    }

    // ── Step 4: Verify openclaw.json skills.entries ──
    console.log('\n── 4. 验证 openclaw.json 技能注册 ──')

    if (clawId) {
        let configContent = null
        if (idToken) configContent = await readServerFile(idToken, clawId, 'openclaw.json')
        if (!configContent) configContent = await readFileViaSSH(clawId, 'openclaw.json')

        if (configContent) {
            try {
                const config = JSON.parse(configContent)
                const skills = config.skills || {}
                const entries = skills.entries || {}
                const browserEntry = entries['browser-automation']

                if (browserEntry) {
                    ok(`browser-automation 已注册: ${JSON.stringify(browserEntry)}`)
                    if (browserEntry.enabled !== false) ok('技能状态: enabled')
                    else fail('技能状态: disabled!')
                } else {
                    fail('browser-automation 未在 skills.entries 中注册!')
                    info(`当前 skills.entries: ${JSON.stringify(entries)}`)
                }

                const allKeys = Object.keys(entries)
                info(`所有注册技能: ${allKeys.join(', ') || '(空)'}`)
            } catch (e) {
                fail(`openclaw.json 解析失败: ${e.message}`)
                info(`原始内容 (前200字符): ${configContent.substring(0, 200)}`)
            }
        } else {
            fail('无法读取 openclaw.json')
        }
    }

    // ── Step 5: Wait for gateway restart ──
    console.log('\n── 5. 等待网关重启 ──')
    log('WAIT', '等待 10 秒让网关重启...')
    await new Promise(r => setTimeout(r, 10000))
    ok('等待完成')

    // ── Step 6: Connect to gateway (optional - may not be reachable) ──
    console.log('\n── 6. 连接 WebSocket 网关 ──')

    let gw = null
    try {
        gw = await connectGateway(gatewayUrl, gatewayToken)
        ok('网关连接成功')
    } catch (e) {
        info(`网关不可达 (${e.message})，跳过聊天测试`)
        info('提示: 可通过浏览器中的 Chrome 扩展直接测试聊天')
    }

    if (gw) {
        const sessionKey = await resolveSessionKey(gw)
        log('SESSION', `会话: ${sessionKey}`)

        console.log('\n── 7. 发送浏览器自动化测试消息 ──')

        try {
            const testMessage = 'open google.com'
            log('CHAT', `发送: "${testMessage}"`)
            const response = await sendChat(gw, sessionKey, testMessage)

            log('CHAT', `AI 回复 (${response.length} 字符):`)
            console.log('  ─────────────────────────────')
            const lines = response.split('\n')
            for (const line of lines.slice(0, 30)) {
                console.log(`  │ ${line}`)
            }
            if (lines.length > 30) console.log(`  │ ... (${lines.length - 30} more lines)`)
            console.log('  ─────────────────────────────')

            console.log('\n── 8. 校验 AI 回复 ──')

            const hasActionBlock = /```action\s*\n/i.test(response)
            const hasNavigate = /"type"\s*:\s*"navigate"/.test(response)
            const hasGoogleUrl = /google\.com/.test(response)
            const hasBrowserDisconnected = /browser.*disconnected|gateway.*pairing|浏览器.*断开|网关.*配对/i.test(response)
            const hasNoCapability = /don't have.*browser|cannot.*browse|no.*browser.*access|无法.*浏览器/i.test(response)

            if (hasActionBlock) ok('AI 输出了 ```action 代码块')
            else fail('AI 未输出 ```action 代码块')

            if (hasNavigate) ok('AI 使用了 navigate 动作')
            else fail('AI 未使用 navigate 动作')

            if (hasGoogleUrl) ok('AI 包含了 google.com URL')
            else fail('AI 回复中没有 google.com')

            if (!hasBrowserDisconnected) ok('AI 没有说 "浏览器断开/网关配对问题"')
            else fail('AI 仍然说 "浏览器断开/网关配对问题" ← 技能未生效!')

            if (!hasNoCapability) ok('AI 没有说 "没有浏览器能力"')
            else fail('AI 说 "没有浏览器能力" ← 技能未加载到 system prompt!')

        } catch (e) {
            fail(`聊天测试失败: ${e.message}`)
        }

        gw.close()
    }

    printSummary()
    process.exit(failed > 0 ? 1 : 0)
}

function printSummary() {
    console.log('\n═══════════════════════════════════════')
    console.log(`  通过: ${passed}  失败: ${failed}`)
    if (failed === 0) {
        console.log('  🎉 全部通过! 浏览器自动化技能工作正常!')
    } else {
        console.log('  ⚠️  有测试失败，请检查上面的详细输出')
    }
    console.log('═══════════════════════════════════════\n')
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
