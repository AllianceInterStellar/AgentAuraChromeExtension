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
 * touched and you do not have to quit the browser you are using. Chrome picks a free debug
 * port and writes it to <profile>/DevToolsActivePort; the script reads it from there, so two
 * checkouts can run this at once. If a Chrome from an earlier run is still up on the profile,
 * it is reused rather than started again.
 *
 * Environment:
 *   CHROME_PATH             the browser executable; checked before the usual locations
 *   AGENTAURA_DEV_PROFILE   profile directory (default ~/.agentaura-dev-chrome)
 *   AGENTAURA_DEV_PORT      a fixed debug port, if a free one picked by Chrome will not do
 *
 * Requires Node 22+ (for the built-in WebSocket client); no packages to install.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REQUESTED_PORT = Number(process.env.AGENTAURA_DEV_PORT || 0) // 0: Chrome picks a free one
const PROFILE = process.env.AGENTAURA_DEV_PROFILE || join(homedir(), '.agentaura-dev-chrome')
const ACTIVE_PORT_FILE = join(PROFILE, 'DevToolsActivePort')

const SEND_TIMEOUT_MS = 10000
const PORT_FILE_TIMEOUT_MS = 20000
const DEBUG_ENDPOINT_TIMEOUT_MS = 30000
const SOCKET_OPEN_TIMEOUT_MS = 10000

const extensionPath = resolve(
    process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..'))

function fail(message) {
    console.error(message)
    process.exit(1)
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

function chromeCandidates() {
    switch (platform()) {
        case 'darwin':
            return [
                '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
                '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
                '/Applications/Chromium.app/Contents/MacOS/Chromium',
                join(homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
            ]
        case 'win32': {
            const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
            const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
            const localAppData = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
            return [
                join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
                join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
                join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
                join(localAppData, 'Google', 'Chrome SxS', 'Application', 'chrome.exe'), // Canary
                join(programFiles, 'Chromium', 'Application', 'chrome.exe'),
                join(localAppData, 'Chromium', 'Application', 'chrome.exe'),
            ]
        }
        default:
            return [
                '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
                '/usr/bin/google-chrome-beta', '/usr/bin/google-chrome-unstable',
                '/opt/google/chrome/chrome',
                '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium',
                '/usr/local/bin/chrome', '/usr/local/bin/chromium',
            ]
    }
}

/** CHROME_PATH wins when set; otherwise the first of the usual locations that exists. */
function findChrome() {
    const fromEnv = process.env.CHROME_PATH
    if (fromEnv) {
        if (existsSync(fromEnv)) return fromEnv
        fail(`CHROME_PATH is set to ${fromEnv}, but nothing is there.`)
    }
    const candidates = chromeCandidates()
    const found = candidates.find(existsSync)
    if (found) return found
    fail([
        'Could not find Chrome. Looked at:',
        ...candidates.map(c => `  ${c}`),
        'Set CHROME_PATH to the executable to use.',
    ].join('\n'))
}

// The Chrome this script started, and how it ended if it did. Every wait below reads these
// so a timeout can say "Chrome exited with code 21" instead of just "timed out".
let chrome = null
let chromeExit = null

function describeChrome() {
    if (!chrome) return 'no Chrome was started by this script'
    if (chromeExit?.error) return `Chrome could not be started: ${chromeExit.error.message}`
    if (chromeExit) return `Chrome exited (code ${chromeExit.code ?? 'none'}, signal ${chromeExit.signal ?? 'none'})`
    return `Chrome (pid ${chrome.pid}) is still running`
}

/** The port and browser-target path Chrome wrote for this profile, or null. */
function readActivePort() {
    try {
        const [port, browserPath = ''] = readFileSync(ACTIVE_PORT_FILE, 'utf8').split(/\r?\n/)
        const n = Number(port)
        if (Number.isInteger(n) && n > 0) return { port: n, browserPath }
    } catch { /* not there */ }
    return null
}

async function versionAt(port) {
    try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`)
        if (res.ok) return await res.json()
    } catch { /* not answering */ }
    return null
}

/** Waits for Chrome to write DevToolsActivePort, or gives up saying what Chrome did. */
async function waitForActivePort(timeoutMs = PORT_FILE_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        const active = readActivePort()
        if (active) return active
        if (chromeExit) {
            fail(`${describeChrome()} before opening a debug port.\n` +
                'Is another Chrome already using this profile? Close it, or point AGENTAURA_DEV_PROFILE elsewhere.')
        }
        await sleep(200)
    }
    fail(`Chrome did not write ${ACTIVE_PORT_FILE} within ${timeoutMs}ms — ${describeChrome()}.`)
}

/** Polls the debug endpoint until Chrome answers, or gives up. */
async function waitForDebugEndpoint(port, timeoutMs = DEBUG_ENDPOINT_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        const version = await versionAt(port)
        if (version) return version
        if (chromeExit) fail(`${describeChrome()} before answering on port ${port}.`)
        await sleep(300)
    }
    fail(`Chrome did not answer on debug port ${port} within ${timeoutMs}ms — ${describeChrome()}.`)
}

/** One request/response over the browser-level DevTools socket, with a deadline. */
function send(ws, method, params = {}, timeoutMs = SEND_TIMEOUT_MS) {
    const id = send.next = (send.next || 0) + 1
    return new Promise((resolveResult, rejectResult) => {
        const timer = setTimeout(() => {
            ws.removeEventListener('message', onMessage)
            rejectResult(new Error(`${method}: no reply within ${timeoutMs}ms`))
        }, timeoutMs)
        const onMessage = event => {
            let message
            try { message = JSON.parse(event.data) } catch { return }
            if (message.id !== id) return
            clearTimeout(timer)
            ws.removeEventListener('message', onMessage)
            if (message.error) rejectResult(new Error(`${method}: ${message.error.message}`))
            else resolveResult(message.result)
        }
        ws.addEventListener('message', onMessage)
        ws.send(JSON.stringify({ id, method, params }))
    })
}

function openSocket(url, timeoutMs = SOCKET_OPEN_TIMEOUT_MS) {
    const ws = new WebSocket(url)
    return new Promise((ready, failed) => {
        const timer = setTimeout(() => failed(new Error(`the DevTools socket did not open within ${timeoutMs}ms`)), timeoutMs)
        ws.addEventListener('open', () => { clearTimeout(timer); ready(ws) }, { once: true })
        ws.addEventListener('error', () => { clearTimeout(timer); failed(new Error('could not open the DevTools socket')) }, { once: true })
    })
}

if (!existsSync(join(extensionPath, 'manifest.json'))) {
    console.error(`No manifest.json in ${extensionPath}`)
    fail('Point the script at an unpacked extension directory.')
}
const manifest = JSON.parse(readFileSync(join(extensionPath, 'manifest.json'), 'utf8'))

mkdirSync(PROFILE, { recursive: true })

// A Chrome from an earlier run may still be up on this profile. Starting another one pointed
// at the same profile would only hand off to it and exit, so reuse it instead.
let port
let version
const previous = readActivePort()
if (previous && (version = await versionAt(previous.port))) {
    port = previous.port
    console.log(`Reusing the Chrome already running on this profile (debug port ${port}).`)
} else {
    // A leftover file from a Chrome that is gone would be read as the live one.
    rmSync(ACTIVE_PORT_FILE, { force: true })
    chrome = spawn(findChrome(), [
        `--remote-debugging-port=${REQUESTED_PORT}`,
        `--user-data-dir=${PROFILE}`,
        // Without this, Extensions.loadUnpacked is not exposed at all.
        '--enable-unsafe-extension-debugging',
        '--no-first-run',
        '--no-default-browser-check',
        'about:blank',
    ], { detached: true, stdio: 'ignore' })
    chrome.on('exit', (code, signal) => { chromeExit = { code, signal } })
    chrome.on('error', (error) => { chromeExit = { error } })
    chrome.unref()

    ;({ port } = await waitForActivePort())
    version = await waitForDebugEndpoint(port)
}

let ws
try {
    ws = await openSocket(version.webSocketDebuggerUrl)
} catch (error) {
    fail(`${error.message} (${version.webSocketDebuggerUrl}) — ${describeChrome()}`)
}

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
    try {
        const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
        worker = targets.find(t => t.type === 'service_worker' && t.url.includes(id))
    } catch { /* between navigations */ }
    if (!worker) await sleep(250)
}

console.log(`\n  ${manifest.name} ${manifest.version} loaded`)
console.log(`  extension id   ${id}`)
console.log(`  service worker ${worker ? worker.url.replace(`chrome-extension://${id}/`, '') : 'not started yet (it starts on first use)'}`)
if (manifest.side_panel?.default_path)
    console.log(`  side panel     chrome-extension://${id}/${manifest.side_panel.default_path}`)
console.log(`\n  profile        ${PROFILE}`)
console.log(`  debug port     ${port}`)
console.log('\n  The extension lives in this Chrome session — run this again after restarting it.\n')

ws.close()
