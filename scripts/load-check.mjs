#!/usr/bin/env node
/**
 * Give an unpacked extension to a real Chromium and see whether it comes up: the service
 * worker has to register and the side panel document has to open. A manifest can be valid
 * and every file it references can exist, and the extension can still fail to load — this is
 * the strongest check available without a human. Both CI workflows run it: Check against the
 * staged source tree, Release against the unpacked zip.
 *
 *   node scripts/load-check.mjs <extension-dir>
 *
 * Needs playwright in the repository root (`npm install --no-save playwright@1.58.2`, then
 * `npx playwright install --with-deps chromium`). Extensions only load into a headed
 * persistent context, so on a machine without a display wrap it: `xvfb-run -a node ...`.
 *
 * Exit status: 0 loaded, 1 the extension did not come up, 2 the script was misused.
 */
import { existsSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const WORKER_TIMEOUT_MS = 30000
const PAGE_TIMEOUT_MS = 20000

const ext = process.argv[2] ? path.resolve(process.argv[2]) : null
if (!ext || !existsSync(path.join(ext, 'manifest.json'))) {
    console.error('usage: node scripts/load-check.mjs <unpacked-extension-dir>')
    console.error('       the directory has to hold a manifest.json' + (ext ? ` — ${ext} does not` : ''))
    process.exit(2)
}
const manifest = JSON.parse(readFileSync(path.join(ext, 'manifest.json'), 'utf8'))
const sidePanelPath = manifest.side_panel?.default_path || 'sidepanel.html'

let chromium
try {
    ({ chromium } = await import('playwright'))
} catch (e) {
    console.error('::error::playwright is not installed next to this repository: ' + e.message)
    console.error('  npm install --no-save playwright@1.58.2 && npx playwright install --with-deps chromium')
    process.exit(2)
}

const profile = path.join(os.tmpdir(), `load-check-${process.pid}-${Date.now()}`)
const ctx = await chromium.launchPersistentContext(profile, {
    headless: false,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
})

let failed = false
const error = (message) => { console.error('::error::' + message); failed = true }

try {
    console.log(`loading ${manifest.name} ${manifest.version} from ${ext}`)

    // The worker may already be up by the time we look, so check before waiting.
    let worker = ctx.serviceWorkers()[0]
    if (!worker) {
        worker = await ctx.waitForEvent('serviceworker', { timeout: WORKER_TIMEOUT_MS }).catch(() => null)
    }
    if (!worker) {
        error(`the extension loaded but no service worker registered within ${WORKER_TIMEOUT_MS / 1000}s`)
    } else {
        const id = new URL(worker.url()).host
        console.log(`service worker registered — extension id ${id}`)
        console.log(`  ${worker.url()}`)

        // The side panel is the whole UI; if its document cannot be opened the package is
        // useless even though the worker came up. Uncaught exceptions while it loads are
        // reported as warnings: the page has no account and no gateway here, so some are
        // expected, but a ReferenceError from a missing script is exactly what to look for.
        const page = await ctx.newPage()
        const pageErrors = []
        page.on('pageerror', (e) => pageErrors.push(e.message))
        const res = await page.goto(`chrome-extension://${id}/${sidePanelPath}`, {
            waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS,
        }).catch((e) => { error('side panel failed to open: ' + e.message); return null })
        if (res) {
            await page.waitForTimeout(500)
            const title = await page.title()
            console.log(`side panel opened — "${title}"`)
            for (const message of pageErrors) console.warn(`::warning::uncaught in ${sidePanelPath}: ${message}`)
        }
    }
} catch (e) {
    error('load check crashed: ' + (e.stack || e.message))
} finally {
    await ctx.close().catch(() => { })
    rmSync(profile, { recursive: true, force: true })
}

process.exit(failed ? 1 : 0)
