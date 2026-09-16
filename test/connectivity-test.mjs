/**
 * 插件 ↔ 后端 连接性 & 协议兼容性测试
 * 无需凭据即可运行: node connectivity-test.mjs
 */

import https from 'node:https'
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const API_BASE = 'https://d1em8r2hdbckr6.cloudfront.net'
const FIREBASE_API_KEY = 'AIzaSyBdKqX4ZPKnw1sM1c09_dGtiBJlFV13iSs'

function getProxyAgent() {
    const proxy = process.env.https_proxy || process.env.HTTPS_PROXY
    if (!proxy) return null
    const u = new URL(proxy)
    return { host: u.hostname, port: parseInt(u.port) }
}

function httpsViaProxy(options, proxyInfo) {
    return new Promise((resolve, reject) => {
        const connectReq = http.request({
            host: proxyInfo.host,
            port: proxyInfo.port,
            method: 'CONNECT',
            path: `${options.hostname}:443`
        })
        connectReq.on('connect', (_, socket) => {
            const req = https.request({ ...options, socket, agent: false }, resolve)
            req.on('error', reject)
            req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
            if (options._body) req.write(options._body)
            req.end()
        })
        connectReq.on('error', reject)
        connectReq.on('timeout', () => { connectReq.destroy(); reject(new Error('proxy timeout')) })
        connectReq.setTimeout(options.timeout || 10000)
        connectReq.end()
    })
}

function httpGet(url, timeout = 10000) {
    const proxy = getProxyAgent()
    const u = new URL(url)
    if (proxy) {
        return new Promise((resolve, reject) => {
            httpsViaProxy({ hostname: u.hostname, path: u.pathname + u.search, method: 'GET', timeout }, proxy)
                .then(res => {
                    let data = ''
                    res.on('data', c => data += c)
                    res.on('end', () => resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, text: () => data, json: () => JSON.parse(data) }))
                }).catch(reject)
        })
    }
    return new Promise((resolve, reject) => {
        const req = https.get(url, { timeout }, res => {
            let data = ''
            res.on('data', c => data += c)
            res.on('end', () => resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, text: () => data, json: () => JSON.parse(data) }))
        })
        req.on('error', reject)
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    })
}

function httpPost(url, body, timeout = 10000) {
    const proxy = getProxyAgent()
    const u = new URL(url)
    const bodyStr = JSON.stringify(body)
    if (proxy) {
        return new Promise((resolve, reject) => {
            httpsViaProxy({ hostname: u.hostname, path: u.pathname + u.search, method: 'POST', timeout, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) }, _body: bodyStr }, proxy)
                .then(res => {
                    let data = ''
                    res.on('data', c => data += c)
                    res.on('end', () => resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, json: () => JSON.parse(data) }))
                }).catch(reject)
        })
    }
    return new Promise((resolve, reject) => {
        const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'POST', timeout, headers: { 'Content-Type': 'application/json' } }, res => {
            let data = ''
            res.on('data', c => data += c)
            res.on('end', () => resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, json: () => JSON.parse(data) }))
        })
        req.on('error', reject)
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
        req.write(bodyStr)
        req.end()
    })
}

const ok = (msg) => console.log(`  ✅ ${msg}`)
const fail = (msg) => console.log(`  ❌ ${msg}`)
const info = (msg) => console.log(`  ℹ️  ${msg}`)

let passed = 0, failed = 0

function check(condition, passMsg, failMsg) {
    if (condition) { ok(passMsg); passed++ }
    else { fail(failMsg); failed++ }
}

async function main() {
    console.log('\n╔══════════════════════════════════════════════╗')
    console.log('║  插件 ↔ 后端 连接性 & 协议兼容性测试         ║')
    console.log('╚══════════════════════════════════════════════╝\n')

    // ── 1. API 健康检查 ──
    console.log('── 1. API 服务可达性 ──')
    let apiReachable = false
    for (const p of ['/health', '/plans', '/']) {
        try {
            const r = await httpGet(`${API_BASE}${p}`)
            check(r.status < 500, `${API_BASE}${p} → ${r.status}`, `${API_BASE}${p} → ${r.status} (服务端错误)`)
            apiReachable = true
            break
        } catch (e) {
            if (p === '/') check(false, '', `API 完全不可达: ${e.message}`)
        }
    }

    // ── 2. /plans 公开端点 ──
    console.log('\n── 2. /plans 端点 (公开，插件展示套餐用) ──')
    try {
        const r = await httpGet(`${API_BASE}/plans`)
        check(r.ok, `/plans 返回 ${r.status}`, `/plans 返回 ${r.status}`)
        if (r.ok) {
            const j = r.json()
            const plans = Array.isArray(j) ? j : (j.data?.plans || j.data || j.plans || [])
            check(plans.length > 0, `plans 数据: ${plans.length} 条`, 'plans 为空')
            if (plans[0]) {
                const p = plans[0]
                info(`样例: ${p.name || p.id || JSON.stringify(p).slice(0, 80)}`)
            }
        }
    } catch (e) { check(false, '', `/plans 请求失败: ${e.message}`) }

    // ── 3. /claws 需要认证 ──
    console.log('\n── 3. /claws 权限控制 (无 auth 应拒绝) ──')
    try {
        const r = await httpGet(`${API_BASE}/claws`)
        check(r.status === 401 || r.status === 403, `/claws 无auth → ${r.status} (正确拒绝)`, `/claws 无auth → ${r.status} (预期401/403)`)
    } catch (e) { check(false, '', `请求失败: ${e.message}`) }

    // ── 4. Firebase Auth 可达 ──
    console.log('\n── 4. Firebase Auth 服务 ──')
    try {
        const r = await httpPost(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
            { email: 'connectivity-test@fake.local', password: 'fake123', returnSecureToken: true })
        const j = r.json()
        const msg = j?.error?.message || ''
        const authWorks = msg === 'EMAIL_NOT_FOUND' || msg === 'INVALID_LOGIN_CREDENTIALS' || msg === 'PASSWORD_LOGIN_DISABLED'
        check(authWorks, `Firebase Auth 正常 (${msg})`, `Firebase Auth 异常: ${r.status} ${msg}`)
    } catch (e) { check(false, '', `Firebase Auth 不可达: ${e.message}`) }

    // ── 5. 插件代码协议审计 ──
    console.log('\n── 5. 插件代码协议兼容性审计 ──')
    const extDir = resolve(__dirname, '..')
    const chatJs = readFileSync(join(extDir, 'js', 'chat.js'), 'utf8')
    const sideJs = readFileSync(join(extDir, 'js', 'sidepanel.js'), 'utf8')
    const authJs = readFileSync(join(extDir, 'js', 'auth.js'), 'utf8')
    const apiJs = readFileSync(join(extDir, 'js', 'api.js'), 'utf8')

    // 5a. API base URL 一致
    const apiUrlMatch = apiJs.match(/API_BASE_URL\s*=\s*['"`]([^'"`]+)/)
    if (apiUrlMatch) {
        check(apiUrlMatch[1] === API_BASE, `api.js API_BASE_URL = ${apiUrlMatch[1]}`, `api.js API_BASE_URL 不匹配: ${apiUrlMatch[1]} ≠ ${API_BASE}`)
    } else {
        check(false, '', 'api.js 未找到 API_BASE_URL')
    }

    // 5b. Firebase API Key 一致
    const fbKeyMatch = authJs.match(/apiKey[:\s]*['"`]([^'"`]+)/)
    if (fbKeyMatch) {
        check(fbKeyMatch[1] === FIREBASE_API_KEY, `auth.js Firebase API Key 匹配`, `auth.js Firebase Key 不匹配: ${fbKeyMatch[1]}`)
    }

    // 5c. chat.send 使用 attachments 字段
    check(chatJs.includes('attachments'), 'chat.js 包含 attachments 支持', 'chat.js 缺少 attachments 支持')

    // 5d. normalizeOutgoingAttachment 存在
    check(chatJs.includes('normalizeOutgoingAttachment'), 'chat.js 有 normalizeOutgoingAttachment', 'chat.js 缺少 normalizeOutgoingAttachment')

    // 5e. sidepanel 的 buildMessageAttachments
    check(sideJs.includes('buildMessageAttachments'), 'sidepanel.js 有 buildMessageAttachments', 'sidepanel.js 缺少 buildMessageAttachments')

    // 5f. base64 截图流程
    check(sideJs.includes('dataUrlToAttachment') || sideJs.includes('data:image'), 'sidepanel.js 有截图→附件转换', 'sidepanel.js 缺少截图→附件转换')

    // 5g. Ed25519 device auth
    check(chatJs.includes('Ed25519'), 'chat.js 使用 Ed25519 设备认证', 'chat.js 缺少 Ed25519')

    // 5h. connect.challenge 处理
    check(chatJs.includes('connect.challenge'), 'chat.js 处理 connect.challenge', 'chat.js 缺少 challenge 处理')

    // 5i. sessions.list 调用
    check(chatJs.includes('sessions.list'), 'chat.js 调用 sessions.list', 'chat.js 缺少 sessions.list')

    // 5j. chat event listener
    const hasChatEvent = chatJs.includes("'chat'") || chatJs.includes('"chat"')
    check(hasChatEvent, 'chat.js 监听 chat 事件', 'chat.js 缺少 chat 事件监听')

    // 5k. mimeType in attachment
    check(chatJs.includes('mimeType'), 'chat.js 附件含 mimeType 字段', 'chat.js 附件缺少 mimeType')

    // 5l. gateway URL construction (subdomain pattern)
    check(apiJs.includes('digitalenginecore.com') || chatJs.includes('digitalenginecore.com') || sideJs.includes('digitalenginecore.com'),
        '插件使用 digitalenginecore.com 域名', '未找到 digitalenginecore.com 域名')

    // 5m. idempotencyKey
    check(chatJs.includes('idempotencyKey'), 'chat.js 发送 idempotencyKey', 'chat.js 缺少 idempotencyKey')

    // 5n. protocol version
    const protocolMatch = chatJs.match(/(?:min|max)Protocol[:\s]*(\d+)/)
    if (protocolMatch) {
        check(protocolMatch[1] === '3', `WebSocket 协议版本: v${protocolMatch[1]}`, `协议版本异常: v${protocolMatch[1]}`)
    }

    // 5o. slash commands
    check(sideJs.includes('/vision-test') || sideJs.includes('handleSlashCommand'), 'sidepanel.js 有内置测试命令', 'sidepanel.js 缺少测试命令')

    // 5p. diagnostic logging
    check(chatJs.includes('附件诊断') || chatJs.includes('attachment') && chatJs.includes('console.log'), 'chat.js 有附件诊断日志', 'chat.js 缺少附件诊断')

    // ── Summary ──
    console.log('\n══════════════════════════════════════════════')
    console.log(`  通过: ${passed}   失败: ${failed}   总计: ${passed + failed}`)
    if (failed === 0) {
        console.log('  🎉 所有无需认证的检查全部通过!')
        console.log('\n  下一步: 运行完整 E2E 测试 (需要 Firebase 账号):')
        console.log('  FIREBASE_EMAIL=你的邮箱 FIREBASE_PASSWORD=你的密码 node vision-e2e-test.mjs')
        console.log('  或直传网关: GATEWAY_URL=https://xxx.digitalenginecore.com GATEWAY_TOKEN=yyy node vision-e2e-test.mjs')
    } else {
        console.log('  ⚠️  有失败项，需要排查')
    }
    console.log('══════════════════════════════════════════════\n')
    process.exit(failed > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
