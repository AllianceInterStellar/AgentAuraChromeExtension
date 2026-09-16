import { chromium } from 'playwright'
import { execSync, spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { fileURLToPath } from 'url'

import { required, originFor } from './env.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const EXTENSION_PATH = path.resolve(__dirname, '..')
const PROXY_HTTP = 'http://127.0.0.1:22334'
const TIMEOUT = 120_000
const CDP_PORT = 9234
const USER_DATA_DIR = path.join(os.tmpdir(), 'agentaura-test-' + Date.now())
const CHROME = chromium.executablePath()

function log(icon, msg) {
    const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false })
    console.log(`  ${icon} [${ts}] ${msg}`)
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function main() {
    console.log('═'.repeat(60))
    console.log('🧪 Chrome 实机扩展测试 (CDP 模式)')
    console.log(`   扩展: ${EXTENSION_PATH}`)
    console.log('═'.repeat(60))

    if (!fs.existsSync(CHROME)) {
        log('❌', 'Chrome 未找到')
        process.exit(1)
    }

    try { execSync(`lsof -i :${CDP_PORT} -t | xargs kill -9 2>/dev/null`, { stdio: 'ignore' }) } catch {}

    log('🚀', '启动 Chrome...')
    const chromeLogFile = path.join(USER_DATA_DIR + '-log.txt')
    fs.mkdirSync(USER_DATA_DIR, { recursive: true })
    const logFd = fs.openSync(chromeLogFile, 'w')
    const chrome = spawn(CHROME, [
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${USER_DATA_DIR}`,
        `--load-extension=${EXTENSION_PATH}`,
        `--disable-extensions-except=${EXTENSION_PATH}`,
        '--enable-extensions',
        `--proxy-server=${PROXY_HTTP}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-popup-blocking',
        '--window-size=1400,900',
        '--enable-logging=stderr',
        '--v=1',
        'about:blank'
    ], { stdio: ['ignore', logFd, logFd], detached: true })
    chrome.unref()

    log('⏳', '等待 Chrome 启动...')
    await sleep(6000)

    let browser
    for (let i = 0; i < 5; i++) {
        try {
            browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`)
            break
        } catch (e) {
            log('⏳', `CDP 尝试 ${i + 1}/5: ${e.message.substring(0, 50)}`)
            await sleep(2000)
        }
    }
    if (!browser) {
        log('❌', 'CDP 连接失败')
        cleanup(chrome)
        process.exit(1)
    }
    log('✅', 'CDP 已连接')

    const context = browser.contexts()[0]
    await sleep(3000)

    let extensionId = null
    const KNOWN_BUILTIN = new Set([
        'fignfifoniblkonapihmkfakmlgkbkcf',
        'nkeimhogjdpnpccoofpliimaahmaaome'
    ])

    for (const sw of context.serviceWorkers()) {
        const u = sw.url()
        log('🔍', `SW: ${u}`)
        if (u.includes('chrome-extension://') && u.includes('background')) {
            const id = new URL(u).hostname
            if (!KNOWN_BUILTIN.has(id)) extensionId = id
        }
    }

    if (!extensionId) {
        const page0 = context.pages()[0] || await context.newPage()
        const cdp = await context.newCDPSession(page0)
        const targets = await cdp.send('Target.getTargets')
        log('🔍', `全部 targets: ${targets.targetInfos.length}`)
        for (const t of targets.targetInfos) {
            if (t.url.includes('chrome-extension://')) {
                const id = new URL(t.url).hostname
                log('🔍', `Ext Target: ${t.type} | ${t.title} | id=${id}`)
                if (!KNOWN_BUILTIN.has(id)) extensionId = id
            }
        }
        await cdp.detach()
    }

    if (!extensionId) {
        log('⏳', '从 Preferences 查找...')
        const prefPath = path.join(USER_DATA_DIR, 'Default', 'Preferences')
        if (fs.existsSync(prefPath)) {
            const prefs = JSON.parse(fs.readFileSync(prefPath, 'utf-8'))
            const settings = prefs?.extensions?.settings || {}
            log('🔍', `Preferences 有 ${Object.keys(settings).length} 个扩展`)
            for (const [eid, ext] of Object.entries(settings)) {
                const name = ext?.manifest?.name || ''
                const p = ext?.path || ''
                log('🔍', `Pref: ${eid} name="${name}" path="${p}"`)
                if (!KNOWN_BUILTIN.has(eid)) {
                    extensionId = eid
                    break
                }
            }
        } else {
            log('⚠️', 'Preferences 文件不存在')
        }
    }

    if (!extensionId) {
        log('⏳', '轮询 service worker (20秒)...')
        for (let i = 0; i < 20; i++) {
            await sleep(1000)
            for (const sw of context.serviceWorkers()) {
                const id = new URL(sw.url()).hostname
                if (!KNOWN_BUILTIN.has(id)) { extensionId = id; break }
            }
            if (extensionId) break
            if (i % 5 === 4) log('⏳', `  已等 ${i + 1}s...`)
        }
    }

    if (!extensionId) {
        log('❌', '扩展未加载，输出 Chrome 日志:')
        if (fs.existsSync(chromeLogFile)) {
            const logContent = fs.readFileSync(chromeLogFile, 'utf-8')
            const extLines = logContent.split('\n').filter(l =>
                /extension|load|error|fail/i.test(l)
            ).slice(-30)
            for (const line of extLines) console.log('    ' + line.substring(0, 150))
        }
        for (const sw of context.serviceWorkers()) log('  SW:', sw.url())
        cleanup(chrome)
        process.exit(1)
    }

    log('✅', `扩展 ID: ${extensionId}`)

    const sidepanelUrl = `chrome-extension://${extensionId}/sidepanel.html`
    log('🌐', '打开 sidepanel...')
    const spPage = await context.newPage()
    await spPage.goto(sidepanelUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })
    log('✅', 'Sidepanel 已加载')
    await sleep(3000)

    const enabledValues = await spPage.locator('#sp-claw-select option:not(:disabled)').evaluateAll(
        els => els.map(el => ({ value: el.value, text: el.textContent }))
    )
    const realClaws = enabledValues.filter(o => o.value && o.value !== '')
    log('📋', `可用 Claws: ${JSON.stringify(realClaws)}`)

    if (realClaws.length > 0) {
        await spPage.locator('#sp-claw-select').selectOption(realClaws[0].value)
        log('✅', `选择: ${realClaws[0].text}`)
    } else {
        log('⚠️', '无 Claw，手动注入...')
        // Read in Node and pass explicitly: the callback is serialised into the page, so
        // anything it closes over here is undefined on the other side.
        const gatewayUrl = required('AGENTAURA_GATEWAY_URL', 'the gateway address to test against')
        const injected = {
            clawId: required('AGENTAURA_CLAW_ID', 'the claw UUID these tests act on'),
            gatewayOrigin: originFor(gatewayUrl),
            gatewayToken: required('AGENTAURA_GATEWAY_TOKEN', 'the gateway auth token (never commit one)'),
        }
        await spPage.evaluate(({ clawId, gatewayOrigin, gatewayToken }) => {
            const sel = document.querySelector('#sp-claw-select')
            const opt = document.createElement('option')
            opt.value = clawId
            opt.textContent = new URL(gatewayOrigin).host.split('.')[0]
            opt.dataset.gatewayUrl = gatewayOrigin
            opt.dataset.gatewayToken = gatewayToken
            sel.appendChild(opt)
            sel.value = opt.value
            sel.dispatchEvent(new Event('change'))
        }, injected)
        log('✅', '已注入 Claw')
    }
    await sleep(2000)

    await spPage.locator('.sp-perm-btn[data-mode="act"]').click()
    log('✅', '权限: act')
    await sleep(500)

    const targetPage = context.pages().find(p => p.url() === 'about:blank') || await context.newPage()
    await targetPage.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 30000 })
    log('✅', '目标: example.com')
    await targetPage.bringToFront()
    await sleep(1000)

    log('💬', '发送测试消息...')
    await spPage.bringToFront()
    await spPage.locator('#sp-input').fill('请导航当前页面到 https://httpbin.org/get 然后告诉我页面显示了什么')
    await sleep(300)
    await spPage.locator('#sp-btn-send').click()
    log('📤', '已发送，等待...')

    const startTime = Date.now()
    let lastText = '', stableCount = 0, foundAction = false, agentFinished = false

    while (Date.now() - startTime < TIMEOUT) {
        await sleep(2000)
        const msgs = await spPage.locator('.sp-message-assistant').allTextContents().catch(() => [])
        const current = msgs.length > 0 ? msgs[msgs.length - 1] : ''

        if (current !== lastText) {
            lastText = current
            stableCount = 0
            if (current.length > 0) log('💭', `AI: ${current.substring(0, 120).replace(/\n/g, ' ')}...`)
        } else {
            stableCount++
        }

        const bannerClass = await spPage.locator('#sp-agent-banner').getAttribute('class').catch(() => 'hidden')
        const agentRunning = bannerClass && !bannerClass.includes('hidden')
        if (agentRunning) {
            const step = await spPage.locator('#sp-step-current').textContent().catch(() => '?')
            log('🔄', `智能体 第 ${step} 步`)
            foundAction = true
            stableCount = 0
        }

        const targetUrl = targetPage.url()
        if (targetUrl.includes('httpbin')) {
            log('✅', `页面已导航: ${targetUrl}`)
            foundAction = true
        }

        if (!agentRunning && stableCount >= 3 && current.length > 20) {
            agentFinished = true
            break
        }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    const allMsgs = await spPage.locator('.sp-message-assistant').allTextContents().catch(() => [])
    const finalMsg = allMsgs.length > 0 ? allMsgs[allMsgs.length - 1] : '无回复'
    const finalUrl = targetPage.url()

    console.log('\n' + '═'.repeat(60))
    console.log('📊 测试结果')
    console.log('═'.repeat(60))
    console.log(`  扩展 ID: ${extensionId}`)
    console.log(`  AI 回复: ${allMsgs.length} 条`)
    console.log(`  智能体动作: ${foundAction ? '是 ✅' : '否 ❌'}`)
    console.log(`  目标 URL: ${finalUrl}`)
    console.log(`  页面已变: ${finalUrl !== 'https://example.com/' ? '是 ✅' : '否 ❌'}`)
    console.log(`  耗时: ${elapsed}s`)
    console.log(`\n  AI 回复:`)
    console.log('  ' + finalMsg.substring(0, 500).replace(/\n/g, '\n  '))
    console.log('═'.repeat(60))

    const success = foundAction || finalUrl.includes('httpbin')
    console.log(success
        ? '\n✅ AI 成功通过扩展控制了本地浏览器!'
        : '\n⚠️ AI 回复了但未执行浏览器操作')

    await sleep(3000)
    cleanup(chrome)
    process.exit(success ? 0 : 1)
}

function cleanup(chrome) {
    try { process.kill(-chrome.pid) } catch {}
    try { execSync(`lsof -i :${CDP_PORT} -t | xargs kill -9 2>/dev/null`, { stdio: 'ignore' }) } catch {}
    try { fs.rmSync(USER_DATA_DIR, { recursive: true, force: true }) } catch {}
    try { fs.unlinkSync(USER_DATA_DIR + '-log.txt') } catch {}
}

main().catch(e => {
    console.error('致命错误:', e.message)
    try { execSync(`lsof -i :${CDP_PORT} -t | xargs kill -9 2>/dev/null`, { stdio: 'ignore' }) } catch {}
    process.exit(1)
})
