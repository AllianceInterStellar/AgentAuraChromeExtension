/**
 * manifest.json against the code. A permission nothing uses is a warning shown to every user
 * for no reason; an API used without its permission fails at runtime with a message that
 * looks like a logic bug.
 *
 *   node --test test/manifest.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { read, root, listFiles } from './helpers/load.mjs'

const manifest = JSON.parse(read('manifest.json'))
const scripts = listFiles('js', '.js')
const allJs = scripts.map(read).join('\n')

/** Permission → the chrome.* namespace that needs it. Add a row when a permission is added. */
const NAMESPACE_FOR_PERMISSION = {
    storage: 'chrome.storage',
    identity: 'chrome.identity',
    sidePanel: 'chrome.sidePanel',
    scripting: 'chrome.scripting',
    debugger: 'chrome.debugger',
    tabGroups: 'chrome.tabGroups',
    tabs: 'chrome.tabs',
    alarms: 'chrome.alarms',
    notifications: 'chrome.notifications',
    downloads: 'chrome.downloads',
    bookmarks: 'chrome.bookmarks',
    history: 'chrome.history',
    cookies: 'chrome.cookies',
    webNavigation: 'chrome.webNavigation',
    contextMenus: 'chrome.contextMenus',
    offscreen: 'chrome.offscreen',
    clipboardWrite: null,
    clipboardRead: null,
    activeTab: null,
    unlimitedStorage: null,
}

/** Namespaces that do not work without a permission of the same name (tabs is the exception). */
const PERMISSION_GATED_NAMESPACES = [
    'alarms', 'bookmarks', 'browsingData', 'contextMenus', 'cookies', 'debugger',
    'declarativeNetRequest', 'downloads', 'history', 'identity', 'management', 'notifications',
    'offscreen', 'scripting', 'sessions', 'sidePanel', 'storage', 'tabGroups', 'topSites',
    'webNavigation', 'webRequest',
]

const usesNamespace = (ns) => new RegExp(`\\b${ns.replace('.', '\\.')}\\b`).test(allJs)

test('it is a Manifest V3 extension with the required top-level fields', () => {
    assert.equal(manifest.manifest_version, 3)
    for (const key of ['name', 'version', 'description']) {
        assert.equal(typeof manifest[key], 'string', `missing ${key}`)
        assert.ok(manifest[key].trim(), `${key} is empty`)
    }
    assert.match(manifest.version, /^\d+(\.\d+){1,3}$/, 'Chrome wants 1 to 4 dot-separated integers')
    assert.ok(manifest.description.length <= 132, 'the Web Store caps the description at 132 characters')
})

test('minimum_chrome_version is set and not older than the side panel API', () => {
    assert.equal(typeof manifest.minimum_chrome_version, 'string')
    assert.ok(Number(manifest.minimum_chrome_version) >= 114, `${manifest.minimum_chrome_version} < 114 (sidePanel)`)
})

test('every declared permission is used by at least one script', () => {
    assert.ok(Array.isArray(manifest.permissions) && manifest.permissions.length > 0)
    const unused = []
    for (const permission of manifest.permissions) {
        assert.ok(permission in NAMESPACE_FOR_PERMISSION,
            `"${permission}" is not in NAMESPACE_FOR_PERMISSION — add a row so it can be checked`)
        const ns = NAMESPACE_FOR_PERMISSION[permission]
        if (ns && !usesNamespace(ns)) unused.push(`${permission} (nothing calls ${ns})`)
    }
    assert.deepEqual(unused, [])
    assert.equal(new Set(manifest.permissions).size, manifest.permissions.length, 'a permission is listed twice')
})

test('every permission-gated API the scripts call is declared', () => {
    const declared = new Set([...(manifest.permissions ?? []), ...(manifest.optional_permissions ?? [])])
    const undeclared = PERMISSION_GATED_NAMESPACES
        .filter(ns => usesNamespace(`chrome.${ns}`) && !declared.has(ns))
    assert.deepEqual(undeclared, [], `used without a permission: ${undeclared.join(', ')}`)
})

test('the agent needs every page, so host_permissions is <all_urls> and nothing narrower', () => {
    assert.deepEqual(manifest.host_permissions, ['<all_urls>'])
})

test('content scripts are injected on demand, not declared', () => {
    assert.equal(manifest.content_scripts, undefined)
    // The files the worker injects have to exist, though.
    const worker = read(manifest.background.service_worker)
    const injected = [...worker.matchAll(/'(js\/content-scripts\/[^']+\.js)'/g)].map(m => m[1])
    assert.ok(injected.length >= 1, 'the worker names no content scripts to inject')
    for (const f of injected) assert.ok(existsSync(new URL(f, root)), `${f} is injected but missing`)
})

test('nothing is web-accessible', () => {
    assert.equal(manifest.web_accessible_resources, undefined)
})

test('the service worker, side panel, options page and icons exist', () => {
    assert.equal(typeof manifest.background?.service_worker, 'string')
    assert.equal(manifest.background.type, undefined, 'the worker is a classic script (importScripts)')
    assert.equal(typeof manifest.side_panel?.default_path, 'string')
    assert.equal(typeof manifest.options_page, 'string')
    const referenced = [
        manifest.background.service_worker,
        manifest.side_panel.default_path,
        manifest.options_page,
        ...Object.values(manifest.icons ?? {}),
        ...Object.values(manifest.action?.default_icon ?? {}),
    ]
    assert.ok(Object.keys(manifest.icons ?? {}).includes('128'), 'the Web Store needs a 128px icon')
    for (const f of referenced) assert.ok(existsSync(new URL(f, root)), `manifest references a missing file: ${f}`)
})

test('keyboard shortcuts stay off the browser\'s own Ctrl+E and Ctrl+Shift+A', () => {
    const commands = manifest.commands ?? {}
    assert.ok(Object.keys(commands).length > 0)
    for (const [name, command] of Object.entries(commands)) {
        for (const [platform, combo] of Object.entries(command.suggested_key ?? {})) {
            assert.notEqual(combo, 'Ctrl+E', `${name} on ${platform}`)
            assert.notEqual(combo, 'Ctrl+Shift+A', `${name} on ${platform}`)
            assert.match(combo, /^(Ctrl|Alt|Command|MacCtrl)(\+Shift)?\+[A-Z0-9]$|^(Ctrl|Alt|Command|MacCtrl)\+(Shift\+)?(F[1-9]|F1[0-2]|Comma|Period|Home|End|PageUp|PageDown|Space|Insert|Delete|Up|Down|Left|Right|MediaNextTrack|MediaPlayPause|MediaPrevTrack|MediaStop)$/,
                `${name} on ${platform}: "${combo}" is not a shape Chrome accepts`)
        }
        assert.equal(typeof command.description, 'string', `${name} has no description`)
    }
})

test('the managed storage schema is registered, exists and is valid JSON with the documented keys', () => {
    assert.equal(manifest.storage?.managed_schema, 'managed_schema.json')
    const schema = JSON.parse(read('managed_schema.json'))
    assert.equal(schema.type, 'object')
    assert.deepEqual(Object.keys(schema.properties).sort(), [
        'AllowedPermissionModes', 'AllowedSites', 'BlockedSites', 'DisableExecuteJs', 'DisableScheduledTasks', 'DisableUnattendedRuns',
    ])
    // Every key the schema offers is one the worker reads.
    const worker = read(manifest.background.service_worker)
    for (const key of Object.keys(schema.properties)) assert.ok(worker.includes(key), `${key} is in the schema but the worker never reads it`)
})

test('the worker registered in the manifest imports i18n and the scheduler, and both files exist', () => {
    const worker = read(manifest.background.service_worker)
    const m = /importScripts\(([^)]*)\)/.exec(worker)
    assert.ok(m, 'the worker calls importScripts')
    const imported = [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1])
    assert.ok(imported.includes('i18n.js'), imported.join(', '))
    assert.ok(imported.includes('agent/task-scheduler.js'), imported.join(', '))
    // Paths are relative to the worker's own directory.
    for (const file of imported) assert.ok(existsSync(new URL(`js/${file}`, root)), file)
})
