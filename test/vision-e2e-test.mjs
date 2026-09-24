/**
 * 视觉管道端到端自动化测试
 *
 * 流程: 认证 → WebSocket 网关 → chat.send(附件) → 校验模型回复
 *
 * 运行模式 (需要 Node 18+, 推荐 /opt/homebrew/bin/node):
 *   1. 直连模式:    GATEWAY_URL=https://xxx.digitalenginecore.com GATEWAY_TOKEN=yyy node vision-e2e-test.mjs
 *   2. Token模式:   FIREBASE_TOKEN=xxx node vision-e2e-test.mjs
 *   3. 匿名模式:    node vision-e2e-test.mjs  (自动匿名注册，但新用户无claw)
 *
 * 依赖: npm i ws
 */

import { webcrypto } from 'node:crypto'
import { createInterface } from 'node:readline'
import http from 'node:http'
import https from 'node:https'
import { HttpsProxyAgent } from 'https-proxy-agent'

const FIREBASE_API_KEY = 'AIzaSyBdKqX4ZPKnw1sM1c09_dGtiBJlFV13iSs'
const API_BASE = 'https://awsapi.allianceinterstellar.com'

const log = (tag, msg) => console.log(`[${new Date().toISOString().slice(11, 19)}][${tag}] ${msg}`)
const fail = (msg) => { console.error(`\n❌ FAIL: ${msg}\n`); process.exit(1) }

function getProxy() {
    const p = process.env.https_proxy || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.HTTP_PROXY
    if (!p) return null
    const u = new URL(p)
    return { host: u.hostname, port: parseInt(u.port) }
}

function proxyFetch(url, options = {}) {
    const proxy = getProxy()
    if (!proxy) return fetch(url, options)

    const u = new URL(url)
    return new Promise((resolve, reject) => {
        const connectReq = http.request({
            host: proxy.host, port: proxy.port,
            method: 'CONNECT', path: `${u.hostname}:443`
        })
        connectReq.on('connect', (_, socket) => {
            const req = https.request({
                hostname: u.hostname, path: u.pathname + u.search,
                method: options.method || 'GET', socket, agent: false,
                headers: options.headers || {},
                timeout: 15000
            }, res => {
                let data = ''
                res.on('data', c => data += c)
                res.on('end', () => resolve({
                    ok: res.statusCode >= 200 && res.statusCode < 300,
                    status: res.statusCode,
                    json: () => JSON.parse(data),
                    text: () => data
                }))
            })
            req.on('error', reject)
            req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
            if (options.body) req.write(options.body)
            req.end()
        })
        connectReq.on('error', reject)
        connectReq.setTimeout(15000)
        connectReq.end()
    })
}

// ── prompt helper ──
function prompt(question) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()) }))
}

// ── 1. Firebase Anonymous Auth ──
async function firebaseSignInAnonymously() {
    log('AUTH', '匿名登录 Firebase...')
    const res = await proxyFetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ returnSecureToken: true })
        }
    )
    if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        fail(`Firebase 匿名登录失败: ${err?.error?.message || res.status}`)
    }
    const data = await res.json()
    log('AUTH', `匿名登录成功 (uid=${data.localId})`)
    return data.idToken
}

// ── 2. Fetch claws ──
async function fetchClaws(idToken) {
    log('API', '正在获取 claw 列表...')
    const res = await proxyFetch(`${API_BASE}/claws`, {
        headers: { Authorization: `Bearer ${idToken}` }
    })
    if (!res.ok) fail(`获取 claws 失败: ${res.status}`)
    const json = await res.json()
    let claws = []
    if (Array.isArray(json)) claws = json
    else if (Array.isArray(json.data)) claws = json.data
    else if (json.data?.claws) claws = json.data.claws
    else if (json.claws) claws = json.claws
    if (!Array.isArray(claws)) fail('claws 返回格式异常: ' + JSON.stringify(json).slice(0, 200))

    const running = claws.filter(c => c.status === 'running' && c.subdomain)
    log('API', `总数=${claws.length}, 运行中=${running.length}`)
    if (running.length === 0) fail('没有运行中的 claw，无法测试')
    return running[0]
}

// ── 3. Ed25519 device identity ──
async function createDeviceIdentity() {
    const keyPair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    const rawPub = await webcrypto.subtle.exportKey('raw', keyPair.publicKey)
    const spkiPub = await webcrypto.subtle.exportKey('spki', keyPair.publicKey)
    const hashBuf = await webcrypto.subtle.digest('SHA-256', rawPub)
    const deviceId = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('')
    const publicKeyBase64 = Buffer.from(spkiPub).toString('base64')

    return {
        deviceId,
        publicKeyBase64,
        async sign(payload) {
            const data = new TextEncoder().encode(payload)
            const sig = await webcrypto.subtle.sign({ name: 'Ed25519' }, keyPair.privateKey, data)
            return Buffer.from(sig).toString('base64')
        }
    }
}

// ── 4. WebSocket gateway ──
async function connectGateway(gatewayUrl, gatewayToken) {
    const { default: WebSocket } = await import('ws')

    const wsUrl = gatewayUrl.replace('https://', 'wss://').replace('http://', 'ws://') + '/'
    const proxy = getProxy()
    log('WS', `正在连接 ${wsUrl}${proxy ? ` (代理: ${proxy.host}:${proxy.port})` : ''}...`)

    return new Promise((resolveConn, rejectConn) => {
        const wsOpts = proxy ? { agent: new HttpsProxyAgent(`http://${proxy.host}:${proxy.port}`) } : {}
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
                    if (pending[id]) {
                        delete pending[id]
                        reject(new Error(`Timeout: ${method}`))
                    }
                }, method === 'chat.send' ? 120000 : 15000)
            })
        }

        const on = (event, fn) => {
            if (!listeners[event]) listeners[event] = []
            listeners[event].push(fn)
        }
        const off = (event, fn) => {
            if (listeners[event]) listeners[event] = listeners[event].filter(l => l !== fn)
        }

        ws.on('open', () => log('WS', '已打开，等待 challenge...'))

        ws.on('message', async (raw) => {
            const data = JSON.parse(raw.toString())

            if (data.type === 'event' && data.event === 'connect.challenge') {
                log('WS', '收到 challenge，正在认证...')
                const nonce = data.payload?.nonce || ''
                const device = await createDeviceIdentity()
                const now = Date.now()
                const clientId = 'openclaw-control-ui'
                const clientMode = 'webchat'
                const role = 'operator'
                const scopes = ['operator.admin', 'operator.approvals', 'operator.pairing']
                const signPayload = ['v2', device.deviceId, clientId, clientMode, role, scopes.join(','), now.toString(), gatewayToken, nonce].join('|')
                const signature = await device.sign(signPayload)
                const id = nextId()
                pending[id] = {
                    resolve: (resp) => {
                        if (resp.ok && resp.payload?.type === 'hello-ok') {
                            connected = true
                            log('WS', '认证成功 ✓')
                            resolveConn({ sendRequest, on, off, close: () => ws.close() })
                        }
                    },
                    reject: () => { }
                }
                send({
                    type: 'req', id, method: 'connect',
                    params: {
                        minProtocol: 3, maxProtocol: 3,
                        client: { id: clientId, version: 'control-ui', platform: 'e2e-test', mode: clientMode, instanceId: webcrypto.randomUUID() },
                        role, scopes,
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
                if (data.ok && !connected && data.payload?.type === 'hello-ok') {
                    connected = true
                    log('WS', '认证成功 ✓')
                }
                const p = pending[data.id]
                if (p) {
                    delete pending[data.id]
                    p.resolve(data)
                }
            }
        })

        ws.on('error', (e) => { log('WS', `错误: ${e.message}`); rejectConn(e) })
        ws.on('close', () => { if (!connected) rejectConn(new Error('连接关闭')) })

        setTimeout(() => { if (!connected) rejectConn(new Error('连接超时')) }, 20000)
    })
}

// ── 5. Generate test image (SVG, no native deps) ──
function generateTestImageSimple() {
    const testNumber = String(1000 + Math.floor(Math.random() * 9000))
    const colors = [
        { hex: '#e74c3c', name: '红色' },
        { hex: '#2ecc71', name: '绿色' },
        { hex: '#3498db', name: '蓝色' },
        { hex: '#f39c12', name: '橙色' },
        { hex: '#9b59b6', name: '紫色' }
    ]
    const color = colors[Math.floor(Math.random() * colors.length)]

    // Create a minimal valid 1x1 PNG as a fallback isn't useful.
    // Instead, create an SVG rendered to text and encode it.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400">
  <rect width="800" height="400" fill="#111"/>
  <text x="400" y="180" text-anchor="middle" fill="#fff" font-size="140" font-family="monospace" font-weight="bold">${testNumber}</text>
  <rect x="280" y="240" width="240" height="80" fill="${color.hex}"/>
  <text x="400" y="292" text-anchor="middle" fill="#000" font-size="36" font-family="sans-serif" font-weight="bold">TEST</text>
</svg>`

    const base64 = Buffer.from(svg).toString('base64')
    return { testNumber, expectedColor: color.name, colorHex: color.hex, base64, mimeType: 'image/svg+xml' }
}

// ── 6. resolve session key ──
async function resolveSessionKey(gw) {
    try {
        const resp = await gw.sendRequest('sessions.list', {})
        if (resp.ok) {
            const payload = resp.payload
            let sessions = Array.isArray(payload) ? payload : payload?.sessions || []
            const prefix = 'agent:main:'
            for (const s of sessions) {
                const key = s?.key || s?.sessionKey
                if (key && key.startsWith(prefix)) return key
            }
        }
    } catch (_) { }
    return 'agent:main:main'
}

// ── 7. send chat + image and collect response ──
async function sendVisionQuestion(gw, sessionKey, base64, mimeType, questionText) {
    return new Promise((resolve, reject) => {
        let fullText = ''
        let activeRunId = null
        const idempotencyKey = webcrypto.randomUUID()

        const chatListener = (payload) => {
            if (payload.sessionKey !== sessionKey) return
            const runId = payload.runId
            if (!activeRunId) activeRunId = runId
            if (runId && runId !== activeRunId) return

            switch (payload.state) {
                case 'delta': {
                    const msg = payload.message
                    if (typeof msg === 'string') fullText = msg
                    else if (Array.isArray(msg)) {
                        const t = msg.filter(b => b.type === 'text').map(b => b.text).join('')
                        if (t) fullText = t
                    } else if (msg?.text) fullText = msg.text
                    else if (msg?.content) {
                        if (typeof msg.content === 'string') fullText = msg.content
                    }
                    break
                }
                case 'final': {
                    const msg = payload.message
                    if (typeof msg === 'string') fullText = msg
                    else if (Array.isArray(msg)) {
                        const t = msg.filter(b => b.type === 'text').map(b => b.text).join('')
                        if (t) fullText = t
                    } else if (msg?.text) fullText = msg.text
                    else if (msg?.content) {
                        if (typeof msg.content === 'string') fullText = msg.content
                    }
                    gw.off('chat', chatListener)
                    resolve(fullText)
                    break
                }
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

        const params = {
            sessionKey,
            message: questionText,
            deliver: true,
            timeoutMs: 120000,
            idempotencyKey,
            attachments: [{
                type: 'image',
                mimeType,
                content: base64
            }]
        }

        log('SEND', `发送消息 (附件: 1个, ${mimeType}, base64长度=${base64.length}, ~${Math.round(base64.length * 0.75 / 1024)}KB)`)

        gw.sendRequest('chat.send', params).then(resp => {
            if (!resp.ok) log('SEND', `chat.send 响应: ok=${resp.ok}`)
        }).catch(e => {
            gw.off('chat', chatListener)
            reject(e)
        })

        setTimeout(() => {
            gw.off('chat', chatListener)
            resolve(fullText)
        }, 90000)
    })
}

// ── 8. main ──
async function main() {
    console.log('\n╔══════════════════════════════════════════╗')
    console.log('║   AgentAura 视觉管道 E2E 自动化测试     ║')
    console.log('╚══════════════════════════════════════════╝\n')

    let gatewayUrl = process.env.GATEWAY_URL
    let gatewayToken = process.env.GATEWAY_TOKEN || ''

    if (gatewayUrl) {
        log('MODE', '直连模式 (GATEWAY_URL)')
    } else if (process.env.FIREBASE_TOKEN) {
        log('MODE', '预置Token模式 (FIREBASE_TOKEN)')
        const claw = await fetchClaws(process.env.FIREBASE_TOKEN)
        gatewayUrl = `https://${claw.subdomain}.digitalenginecore.com`
        gatewayToken = claw.gatewayToken || ''
        log('CLAW', `选择: ${claw.name || claw.id} → ${gatewayUrl}`)
    } else {
        log('MODE', '匿名认证模式 (自动)')
        const idToken = await firebaseSignInAnonymously()
        const claw = await fetchClaws(idToken)
        gatewayUrl = `https://${claw.subdomain}.digitalenginecore.com`
        gatewayToken = claw.gatewayToken || ''
        log('CLAW', `选择: ${claw.name || claw.id} → ${gatewayUrl}`)
    }

    const gw = await connectGateway(gatewayUrl, gatewayToken)

    const sessionKey = await resolveSessionKey(gw)
    log('SESSION', `会话: ${sessionKey}`)

    log('IMAGE', '生成测试图片...')
    const img = generateTestImageSimple()
    log('IMAGE', `测试参数: 数字=${img.testNumber}, 颜色=${img.expectedColor}(${img.colorHex}), 格式=${img.mimeType}`)

    const question = `这是一个自动化视觉验证测试。图片里有一个黑色背景的画布。请只看图片回答以下两个问题，用JSON格式返回：
1. 画布上显示的四位数字是多少？
2. 画布上彩色矩形的背景色是什么颜色（红色/绿色/蓝色/橙色/紫色之一）？

请严格按此格式返回：{"number": "四位数字", "color": "颜色名"}`

    log('TEST', '正在向模型发送图片并提问...')
    const response = await sendVisionQuestion(gw, sessionKey, img.base64, img.mimeType, question)

    log('RESP', `模型回复: ${response.slice(0, 300)}${response.length > 300 ? '...' : ''}`)

    console.log('\n─── 校验结果 ───')

    let numberPass = false
    let colorPass = false

    const jsonMatch = response.match(/\{[^}]*\}/)
    if (jsonMatch) {
        try {
            const parsed = JSON.parse(jsonMatch[0])
            numberPass = String(parsed.number) === img.testNumber
            colorPass = typeof parsed.color === 'string' && parsed.color.includes(img.expectedColor)
            log('PARSE', `JSON解析: number="${parsed.number}", color="${parsed.color}"`)
        } catch (_) {
            log('PARSE', 'JSON解析失败，改用文本匹配')
        }
    }

    if (!numberPass) numberPass = response.includes(img.testNumber)
    if (!colorPass) colorPass = response.includes(img.expectedColor)

    const numResult = numberPass ? '✅ 通过' : '❌ 失败'
    const colorResult = colorPass ? '✅ 通过' : '❌ 失败'

    console.log(`  数字识别: ${numResult} (期望=${img.testNumber})`)
    console.log(`  颜色识别: ${colorResult} (期望=${img.expectedColor})`)
    console.log('')

    if (numberPass && colorPass) {
        console.log('╔══════════════════════════════════════════╗')
        console.log('║  🎉 全部通过 - 后端模型确实在用截图判断  ║')
        console.log('╚══════════════════════════════════════════╝')
    } else if (numberPass || colorPass) {
        console.log('╔══════════════════════════════════════════╗')
        console.log('║  ⚠️  部分通过 - 模型可能部分使用了图片   ║')
        console.log('╚══════════════════════════════════════════╝')
    } else {
        console.log('╔══════════════════════════════════════════╗')
        console.log('║  ❌ 测试失败 - 模型可能未消费图片附件    ║')
        console.log('╚══════════════════════════════════════════╝')
        console.log('\n排查建议:')
        console.log('  1. 确认 chat.send 帧中 attachments 字段存在')
        console.log('  2. 检查后端是否把 attachments 映射到了上游模型 API')
        console.log('  3. 确认上游模型支持多模态(图片)输入')
    }

    console.log('')
    gw.close()
    process.exit(numberPass && colorPass ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(1) })
