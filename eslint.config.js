// ESLint flat config for local use and for a future CI step. The extension has no build step
// and no root package.json, so nothing here is installed by default — run it as
//
//   npx eslint@9 js pages scripts test
//
// This file is CommonJS because a root .js file without "type": "module" is CommonJS to Node.
//
// The pages load their scripts as classic <script> tags sharing one global scope, so a name
// defined at the top level of one file is a global in every file loaded after it. `no-undef`
// only works if those names are declared here; when a new one is introduced, add it to
// `sharedGlobals`. `no-unused-vars` is limited to locals for the same reason: a top-level
// function that nothing in its own file calls is usually called from another file.
'use strict'

const readonly = (names) => Object.fromEntries(names.map(n => [n, 'readonly']))

// What every extension page and worker sees from the platform.
const browserGlobals = readonly([
    'window', 'self', 'globalThis', 'document', 'navigator', 'location', 'history', 'screen',
    'console', 'alert', 'confirm', 'prompt', 'open', 'close', 'postMessage', 'parent', 'top',
    'innerWidth', 'innerHeight', 'devicePixelRatio', 'scrollTo', 'getComputedStyle', 'matchMedia',
    'addEventListener', 'removeEventListener', 'dispatchEvent',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask',
    'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback',
    'fetch', 'Headers', 'Request', 'Response', 'FormData', 'Blob', 'File', 'FileReader',
    'URL', 'URLSearchParams', 'WebSocket', 'AbortController', 'AbortSignal',
    'TextEncoder', 'TextDecoder', 'crypto', 'CryptoKey', 'atob', 'btoa', 'structuredClone',
    'Event', 'CustomEvent', 'EventTarget', 'MessageChannel', 'MessagePort', 'BroadcastChannel',
    'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'PerformanceObserver',
    'performance', 'Intl', 'Notification', 'Worker', 'ClipboardItem', 'DOMParser', 'XMLSerializer',
    'Image', 'ImageData', 'OffscreenCanvas', 'createImageBitmap',
    'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement',
    'HTMLIFrameElement', 'Node', 'NodeList', 'Text', 'Range', 'Selection', 'CSS',
    'localStorage', 'sessionStorage', 'indexedDB', 'caches',
])

// Only a service worker has these.
const workerGlobals = readonly(['importScripts', 'ServiceWorkerGlobalScope', 'clients', 'registration'])

const webextensionGlobals = readonly(['chrome', 'browser'])

// Defined at the top level of one of the extension's own scripts and used from another.
const sharedGlobals = readonly([
    // js/utils.js
    'escapeHtml', 'escapeAttr', 'sanitizeUrl', 'toNumber', 'clamp', 'cssToken',
    // js/i18n.js
    'I18n',
    // js/api.js
    'ApiClient', 'ApiError', 'apiClient', 'isOneAgentLimitRefusal', 'isAuthExpired',
    // js/auth.js
    'AuthService', 'authService',
    // js/chat.js
    'ChatService', 'ChatManager', 'chatManager', 'GATEWAY_DOMAIN', 'GATEWAY_CONNECTION_STATE',
    'parseMessageContent', 'renderMarkdown', 'renderChatBubble', 'renderChatUI',
    'openClawChat', 'setupChatEventListeners', 'handleChatSend', 'scrollChatToBottom',
    'CHAT_COPY_ICON', 'CHAT_COPIED_ICON',
    // js/app.js
    'showToast', 'switchTab', 'clawsList', 'loadClaws', 'selectedProvider', 'selectedPlan', 'handleDeploy',
    // js/agent/*
    'AutomationEngine', 'TabManager', 'PermissionManager', 'WorkflowRecorder',
    'ShortcutsManager', 'TaskScheduler', 'SkillInstaller',
    // js/sidepanel.js
    'sidepanel',
])

const nodeGlobals = readonly([
    'process', 'Buffer', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'setImmediate', 'clearImmediate', 'queueMicrotask', 'structuredClone', 'fetch', 'Headers',
    'Request', 'Response', 'FormData', 'Blob', 'File', 'URL', 'URLSearchParams', 'WebSocket',
    'AbortController', 'AbortSignal', 'TextEncoder', 'TextDecoder', 'crypto', 'atob', 'btoa',
    'performance', 'Event', 'EventTarget', 'CustomEvent', 'MessageChannel', 'Intl',
    '__dirname', '__filename', 'require', 'module', 'exports',
])

const rules = {
    'no-undef': 'error',
    'no-unused-vars': ['warn', { vars: 'local', args: 'none', caughtErrors: 'none' }],
}

module.exports = [
    {
        ignores: ['node_modules/**', 'test/node_modules/**', 'dist/**', 'store-assets/**'],
    },
    // Pages: popup, side panel, options. Classic scripts sharing one global scope.
    {
        files: ['js/**/*.js', 'pages/**/*.js'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'script',
            globals: { ...browserGlobals, ...webextensionGlobals, ...sharedGlobals },
        },
        rules,
    },
    // The service worker: no DOM, but importScripts and the strings it pulls in.
    {
        files: ['js/background.js'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'script',
            globals: {
                ...browserGlobals, ...workerGlobals, ...webextensionGlobals,
                ...readonly(['I18n']),
                // Provided by the module.exports fallback at the end of the file.
                module: 'readonly',
            },
        },
        rules,
    },
    // Content scripts run in the page's world: the platform, chrome.runtime, nothing of ours.
    {
        files: ['js/content-scripts/**/*.js'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'script',
            globals: { ...browserGlobals, ...webextensionGlobals },
        },
        rules,
    },
    // Node: the unit tests, the integration scripts and the dev tooling.
    {
        files: ['test/**/*.mjs', 'scripts/**/*.mjs'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            globals: nodeGlobals,
        },
        rules,
    },
    {
        files: ['eslint.config.js'],
        languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: nodeGlobals },
        rules,
    },
]
