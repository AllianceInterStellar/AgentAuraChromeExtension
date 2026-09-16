#!/usr/bin/env node
/**
 * Load this extension into Chrome for development, without clicking anything.
 *
 * Chrome 137 disabled the --load-extension command-line switch, so the old one-liner no
 * longer works — it is ignored silently, which looks exactly like the extension failing to
 * load. What replaced it is a DevTools Protocol command, Extensions.loadUnpacked, gated
 * behind --enable-unsafe-extension-debugging. That is what this script drives.
 *
 *   node scripts/dev-install.mjs [path-to-extension]
 *
 * Defaults to the repository root. Uses its own Chrome profile so your real one is never
 * touched and you do not have to quit the browser you are using.
 *
 * Requires Node 22+ (for the built-in WebSocket client); no packages to install.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEBUG_PORT = Number(process.env.AGENTAURA_DEV_PORT || 9224)
const PROFILE = process.env.AGENTAURA_DEV_PROFILE || join(homedir(), '.agentaura-dev-chrome')

const extensionPath = resolve(
    process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..'))

function findChrome() {
    const candidates = platform() === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
           '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
           '/Applications/Chromium.app/Contents/MacOS/Chromium']
        : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
           '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium']
    const found = candidates.find(existsSync)
    if (!found) {
        console.error('Could not find Chrome. Set CHROME_PATH to its executable.')
        process.exit(1)
    }
    return process.env.CHROME_PATH || found
}

/** Polls the debug endpoint until Chrome answers, or gives up. */
async function waitForChrome(timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        try {
            const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)
            if (res.ok) return await res.json()
        } catch { /* not up yet */ }
        await new Promise(r => setTimeout(r, 300))
    }
    console.error(`Chrome did not open a debug port on ${DEBUG_PORT} within ${timeoutMs}ms`)
    process.exit(1)
}

/** One request/response over the browser-level DevTools socket. */
function send(ws, method, params = {}) {
    const id = send.next = (send.next || 0) + 1
    return new Promise((resolveResult, rejectResult) => {
        const onMessage = event => {
            const message = JSON.parse(event.data)
            if (message.id !== id) return
            ws.removeEventListener('message', onMessage)
            if (message.error) rejectResult(new Error(`${method}: ${message.error.message}`))
            else resolveResult(message.result)
        }
        ws.addEventListener('message', onMessage)
        ws.send(JSON.stringify({ id, method, params }))
    })
}

if (!existsSync(join(extensionPath, 'manifest.json'))) {
    console.error(`No manifest.json in ${extensionPath}`)
    console.error('Point the script at an unpacked extension directory.')
    process.exit(1)
}
const manifest = JSON.parse(readFileSync(join(extensionPath, 'manifest.json'), 'utf8'))

mkdirSync(PROFILE, { recursive: true })
const chrome = spawn(findChrome(), [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${PROFILE}`,
    // Without this, Extensions.loadUnpacked is not exposed at all.
    '--enable-unsafe-extension-debugging',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
], { detached: true, stdio: 'ignore' })
chrome.unref()

const version = await waitForChrome()

const ws = new WebSocket(version.webSocketDebuggerUrl)
await new Promise((ready, failed) => {
    ws.addEventListener('open', ready, { once: true })
    ws.addEventListener('error', () => failed(new Error('could not open the DevTools socket')),
                        { once: true })
})

let id
try {
    ({ id } = await send(ws, 'Extensions.loadUnpacked', { path: extensionPath }))
} catch (error) {
    console.error(`\nLoading failed: ${error.message}`)
    console.error('\nIf this says the method is unknown, the Chrome build is older than the')
    console.error('Extensions domain (Chrome 129+). Load it by hand instead:')
    console.error('  chrome://extensions → Developer mode → Load unpacked')
    process.exit(1)
}

// Returning an id is not proof it runs. MV3 service workers start lazily, so poll the
// target list rather than assuming.
let worker = null
for (let attempt = 0; attempt < 40 && !worker; attempt++) {
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()
    worker = targets.find(t => t.type === 'service_worker' && t.url.includes(id))
    if (!worker) await new Promise(r => setTimeout(r, 250))
}

console.log(`\n  ${manifest.name} ${manifest.version} loaded`)
console.log(`  extension id   ${id}`)
console.log(`  service worker ${worker ? worker.url.replace(`chrome-extension://${id}/`, '') : 'not started yet (it starts on first use)'}`)
if (manifest.side_panel?.default_path)
    console.log(`  side panel     chrome-extension://${id}/${manifest.side_panel.default_path}`)
console.log(`\n  profile        ${PROFILE}`)
console.log(`  debug port     ${DEBUG_PORT}`)
console.log('\n  The extension lives in this Chrome session — run this again after restarting it.\n')

ws.close()
