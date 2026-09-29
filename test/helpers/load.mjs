/**
 * Loads the extension's classic scripts into a vm context the way a page does: one shared
 * global scope, in order, with chrome.*, the DOM and the timers replaced by stubs.
 *
 *   const { run } = loadScripts(['js/utils.js', 'js/api.js'], { globals: { fetch } })
 *   const client = run('new ApiClient()')
 *
 * A script's top-level `const`/`class` lands in the context's lexical scope, not on the
 * global object, so `run('name')` is how a test takes hold of one. Top-level `function`
 * declarations are also reachable as `context.name`. Whatever a script assigns to
 * `module.exports` is collected per file in `exports`.
 *
 * Objects created inside the context belong to another realm: `assert.deepEqual` compares
 * prototypes, so spread them (`{ ...value }`) or use `plain()` before comparing.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

export const root = new URL('../../', import.meta.url)
export const read = (path) => readFileSync(new URL(path, root), 'utf8')

/** Every file under `dir` (relative to the repository) whose name ends with `ext`. */
export function listFiles(dir, ext = '.js') {
    const base = new URL(dir.replace(/\/?$/, '/'), root)
    const prefix = dir === '.' || dir === './' ? '' : `${dir.replace(/\/$/, '')}/`
    const out = []
    const walk = (d, rel) => {
        for (const name of readdirSync(d)) {
            if (name === 'node_modules' || name.startsWith('.')) continue
            const full = join(d, name)
            const relPath = rel ? `${rel}/${name}` : name
            if (statSync(full).isDirectory()) walk(full, relPath)
            else if (name.endsWith(ext)) out.push(`${prefix}${relPath}`)
        }
    }
    walk(fileURLToPath(base), '')
    return out.sort()
}

/** A value copied out of the vm realm, so it compares as a plain object. */
export const plain = (value) => JSON.parse(JSON.stringify(value))

const noop = () => { }
const isPlainObject = (v) => v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype

/**
 * A chrome.storage area that remembers what was written, with the real API's shapes for
 * `get` (null → everything, string → one key, array → several, object → with defaults).
 */
export function memoryStorageArea(initial = {}) {
    const data = { ...initial }
    return {
        data,
        async get(keys) {
            if (keys === null || keys === undefined) return { ...data }
            if (typeof keys === 'string') return keys in data ? { [keys]: data[keys] } : {}
            if (Array.isArray(keys)) {
                return Object.fromEntries(keys.filter(k => k in data).map(k => [k, data[k]]))
            }
            const out = { ...keys }
            for (const k of Object.keys(keys)) if (k in data) out[k] = data[k]
            return out
        },
        async set(items) { Object.assign(data, items) },
        async remove(keys) { for (const k of [].concat(keys)) delete data[k] },
        async clear() { for (const k of Object.keys(data)) delete data[k] },
        onChanged: { addListener: noop, removeListener: noop, hasListener: () => false },
    }
}

/**
 * chrome.* as a Proxy: any path resolves to something with `addListener()`, anything can be
 * called, and `overrides` (a nested plain object) supplies real behaviour where a test wants
 * it. `then` is undefined so an `await chrome.x` never hangs, and `runtime.lastError` is
 * undefined so nothing takes an error branch by accident.
 */
export function chromeStub(overrides = {}) {
    const defaults = {
        runtime: {
            id: 'x',
            getURL: (p = '') => `chrome-extension://x/${String(p).replace(/^\//, '')}`,
            getManifest: () => ({ version: '0.0.0', name: 'test' }),
            sendMessage: async () => undefined,
            lastError: undefined,
        },
        storage: {
            local: memoryStorageArea(),
            sync: memoryStorageArea(),
            session: memoryStorageArea(),
        },
        tabs: {
            query: async () => [],
            get: async (id) => ({ id }),
            create: async (props) => ({ id: 1, ...props }),
            sendMessage: async () => undefined,
        },
        i18n: { getUILanguage: () => 'en' },
    }
    return stubTree(merge(defaults, overrides))
}

function merge(base, extra) {
    const out = { ...base }
    for (const [k, v] of Object.entries(extra)) {
        out[k] = isPlainObject(v) && isPlainObject(out[k]) ? merge(out[k], v) : v
    }
    return out
}

function stubTree(overrides) {
    const listenerNames = new Set(['addListener', 'removeListener', 'hasListener', 'hasListeners'])
    return new Proxy(function chromeStubNode() { }, {
        get(_, prop) {
            if (typeof prop === 'symbol' || prop === 'then' || prop === 'toJSON') return undefined
            if (Object.prototype.hasOwnProperty.call(overrides, prop)) {
                const v = overrides[prop]
                return isPlainObject(v) ? stubTree(v) : v
            }
            if (prop === 'lastError') return undefined
            if (listenerNames.has(prop)) return prop.startsWith('has') ? () => false : noop
            return stubTree({})
        },
        apply() { return undefined },
    })
}

/** The subset of an Element that the pages touch when rendering. */
export function fakeElement(tag = 'div') {
    const classes = new Set()
    const attrs = new Map()
    const el = {
        tagName: tag.toUpperCase(),
        id: '',
        value: '',
        checked: false,
        disabled: false,
        hidden: false,
        textContent: '',
        innerHTML: '',
        innerText: '',
        title: '',
        placeholder: '',
        href: '',
        src: '',
        style: {},
        dataset: {},
        children: [],
        childNodes: [],
        options: [],
        files: [],
        selectedIndex: -1,
        scrollTop: 0,
        scrollHeight: 0,
        clientHeight: 0,
        offsetHeight: 0,
        offsetWidth: 0,
        parentElement: null,
        parentNode: null,
        firstChild: null,
        lastChild: null,
        nextSibling: null,
        get className() { return [...classes].join(' ') },
        set className(v) {
            classes.clear()
            String(v).split(/\s+/).filter(Boolean).forEach(c => classes.add(c))
        },
        classList: {
            add: (...c) => c.forEach(x => classes.add(x)),
            remove: (...c) => c.forEach(x => classes.delete(x)),
            contains: (c) => classes.has(c),
            toggle(c, force) {
                const on = force === undefined ? !classes.has(c) : Boolean(force)
                if (on) classes.add(c); else classes.delete(c)
                return on
            },
        },
        addEventListener: noop,
        removeEventListener: noop,
        dispatchEvent: () => true,
        setAttribute: (k, v) => { attrs.set(k, String(v)) },
        getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
        hasAttribute: (k) => attrs.has(k),
        removeAttribute: (k) => { attrs.delete(k) },
        appendChild: (child) => { el.children.push(child); return child },
        prepend: (child) => { el.children.unshift(child); return child },
        removeChild: (child) => child,
        replaceChildren: (...c) => { el.children = c },
        insertAdjacentHTML: noop,
        insertBefore: (child) => child,
        remove: noop,
        focus: noop,
        blur: noop,
        click: noop,
        select: noop,
        scrollIntoView: noop,
        closest: () => null,
        matches: () => false,
        contains: () => false,
        querySelector: () => null,
        querySelectorAll: () => [],
        getBoundingClientRect: () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
        cloneNode: () => fakeElement(tag),
    }
    return el
}

/** A document whose getElementById hands out one memoised fake element per id. */
export function fakeDocument() {
    const elements = new Map()
    const element = (id) => {
        if (!elements.has(id)) {
            const el = fakeElement()
            el.id = id
            elements.set(id, el)
        }
        return elements.get(id)
    }
    const documentElement = fakeElement('html')
    documentElement.lang = 'en'
    const document = {
        elements,
        getElementById: element,
        createElement: (tag) => fakeElement(tag),
        createElementNS: (_, tag) => fakeElement(tag),
        createTextNode: (text) => ({ textContent: String(text), nodeType: 3 }),
        createDocumentFragment: () => fakeElement('fragment'),
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: noop,
        removeEventListener: noop,
        dispatchEvent: () => true,
        documentElement,
        body: fakeElement('body'),
        head: fakeElement('head'),
        activeElement: null,
        hidden: false,
        visibilityState: 'visible',
        readyState: 'complete',
        title: '',
        cookie: '',
        execCommand: () => false,
        hasFocus: () => true,
    }
    return document
}

class ObserverStub {
    observe() { }
    unobserve() { }
    disconnect() { }
    takeRecords() { return [] }
}

function quietConsole() {
    return { log: noop, info: noop, warn: noop, error: noop, debug: noop, trace: noop, group: noop, groupEnd: noop, table: noop }
}

/**
 * Loads `paths` (relative to the repository root) in order into one fresh context.
 *
 * Options:
 *   globals  — properties set on the context before any script runs; they override the
 *              defaults below, `chrome` included.
 *   chrome   — overrides merged into the default chrome stub (ignored if globals.chrome is set).
 *   prelude  — code run before the first script, for constants another page script would
 *              have defined (`const GATEWAY_DOMAIN = "..."`).
 */
export function loadScripts(paths, { globals = {}, chrome = {}, prelude = '' } = {}) {
    const document = fakeDocument()
    const sandbox = {
        console: quietConsole(),
        setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
        requestAnimationFrame: (cb) => setTimeout(cb, 0),
        cancelAnimationFrame: clearTimeout,
        requestIdleCallback: (cb) => setTimeout(cb, 0),
        URL, URLSearchParams, TextEncoder, TextDecoder, atob, btoa, structuredClone,
        AbortController, AbortSignal, Blob, Event, CustomEvent, EventTarget, performance,
        crypto: globalThis.crypto,
        fetch: async () => { throw new TypeError('fetch is not stubbed in this test') },
        WebSocket: class WebSocket { constructor() { throw new Error('WebSocket is not stubbed in this test') } },
        MutationObserver: ObserverStub,
        ResizeObserver: ObserverStub,
        IntersectionObserver: ObserverStub,
        CSS: { escape: (s) => String(s).replace(/([^\w-])/g, '\\$1') },
        location: {
            href: 'chrome-extension://x/sidepanel.html', origin: 'chrome-extension://x',
            protocol: 'chrome-extension:', host: 'x', hostname: 'x', pathname: '/sidepanel.html',
            search: '', hash: '', reload: noop, assign: noop,
        },
        navigator: {
            language: 'en', languages: ['en'], userAgent: 'node', platform: 'node', onLine: true,
            clipboard: { writeText: async () => { }, readText: async () => '' },
        },
        localStorage: memoryWebStorage(),
        sessionStorage: memoryWebStorage(),
        document,
        importScripts: noop,
        module: { exports: {} },
        chrome: chromeStub(chrome),
        addEventListener: noop,
        removeEventListener: noop,
        dispatchEvent: () => true,
        postMessage: noop,
        matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop, addListener: noop }),
        getComputedStyle: () => ({ getPropertyValue: () => '' }),
        scrollTo: noop,
        open: noop,
        close: noop,
        alert: noop,
        confirm: () => true,
        prompt: () => null,
        innerWidth: 800,
        innerHeight: 600,
        devicePixelRatio: 1,
    }
    sandbox.window = sandbox
    sandbox.self = sandbox
    sandbox.parent = sandbox
    sandbox.top = sandbox
    Object.assign(sandbox, globals)

    const context = vm.createContext(sandbox)
    const run = (code, filename = 'test-input.js') => vm.runInContext(code, context, { filename })
    const exports = {}

    if (prelude) run(prelude, 'prelude.js')
    for (const path of paths) {
        sandbox.module = { exports: {} }
        vm.runInContext(read(path), context, { filename: path })
        exports[path] = sandbox.module.exports
    }

    return { run, context, exports, document, element: document.getElementById }
}

function memoryWebStorage() {
    const data = new Map()
    return {
        get length() { return data.size },
        getItem: (k) => (data.has(k) ? data.get(k) : null),
        setItem: (k, v) => { data.set(k, String(v)) },
        removeItem: (k) => { data.delete(k) },
        clear: () => data.clear(),
        key: (i) => [...data.keys()][i] ?? null,
    }
}
