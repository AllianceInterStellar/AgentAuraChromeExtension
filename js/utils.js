/**
 * Helpers every page shares. Loaded first, as a classic script, so the functions are globals.
 *
 * escapeHtml used to be defined three times (app.js, sidepanel.js, options.js) as
 * `div.textContent = s; return div.innerHTML`, which leaves `"` and `'` alone. That is fine
 * between tags and wrong inside an attribute: `data-claw-name="${escapeHtml(name)}"` with a
 * name containing `"` closes the attribute early.
 */

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/** Safe in text and in double- or single-quoted attribute values. */
function escapeHtml(value) {
    if (value === null || value === undefined) return ''
    return String(value).replace(/[&<>"']/g, ch => HTML_ESCAPES[ch])
}

/** Same escaping; the name says where it is being used. */
function escapeAttr(value) {
    return escapeHtml(value)
}

/**
 * A URL that is safe to put in an href or src. Anything but http(s), mailto and (when asked)
 * a data: image becomes '#', so a link in model output cannot be `javascript:` or `file:`.
 */
function sanitizeUrl(url, { allowDataImage = false } = {}) {
    const raw = String(url ?? '').trim()
    if (!raw) return '#'
    if (/^https?:\/\//i.test(raw) || /^mailto:/i.test(raw)) return raw
    if (allowDataImage && /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i.test(raw)) return raw
    return '#'
}

/** A finite number, or `fallback`. Server fields that should be numbers are not always numbers. */
function toNumber(value, fallback = 0) {
    const n = typeof value === 'number' ? value : parseFloat(value)
    return Number.isFinite(n) ? n : fallback
}

function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n))
}

/** `[a-z0-9_-]` only, for values that end up in a class attribute. */
function cssToken(value, fallback = '') {
    const s = String(value ?? '').toLowerCase()
    return /^[a-z0-9_-]+$/.test(s) ? s : fallback
}

/**
 * Public suffixes that take two labels, so `shop.example.co.uk` is the site `example.co.uk`
 * and not `co.uk`. A short list, not the public suffix list: it covers the suffixes people
 * actually hit, and an unknown one falls back to the last two labels.
 */
const TWO_LEVEL_SUFFIXES = new Set([
    'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'net.uk', 'ltd.uk', 'plc.uk',
    'co.jp', 'or.jp', 'ne.jp', 'ac.jp', 'go.jp',
    'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn',
    'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
    'com.br', 'com.tw', 'com.hk', 'com.sg', 'com.mx', 'com.ar', 'com.tr', 'com.my', 'com.ph', 'com.vn', 'com.sa', 'com.eg', 'com.pk', 'com.ng',
    'co.kr', 'co.in', 'co.nz', 'co.za', 'co.id', 'co.th', 'co.il'
])

/**
 * The site a URL or hostname belongs to, as a user thinks of it: `docs.example.com` and
 * `example.com` are both "example.com". What the per-site allow list is keyed by. An IP
 * address or a single-label host (localhost) is its own site. '' when there is no host.
 */
function registrableDomain(input) {
    let host = String(input || '').trim().toLowerCase()
    if (/^[a-z][a-z0-9+.-]*:\/\//.test(host)) {
        try { host = new URL(host).hostname } catch (_) { return '' }
    } else if (/^(about|blob|data|javascript|mailto|chrome|chrome-extension|edge|file|devtools):/.test(host)) {
        return ''
    }
    // A bare `host:port`; an IPv6 literal keeps its brackets until here.
    if (!host.startsWith('[')) host = host.replace(/:\d+$/, '')
    host = host.replace(/\.$/, '').replace(/^\[|\]$/g, '')
    if (!host) return ''
    if (/^[\d.]+$/.test(host) || host.includes(':')) return host
    const labels = host.split('.')
    if (labels.length <= 2) return host
    const lastTwo = labels.slice(-2).join('.')
    return TWO_LEVEL_SUFFIXES.has(lastTwo) ? labels.slice(-3).join('.') : lastTwo
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { escapeHtml, escapeAttr, sanitizeUrl, toNumber, clamp, cssToken, registrableDomain }
}
