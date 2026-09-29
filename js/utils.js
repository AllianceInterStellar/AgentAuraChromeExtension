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

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { escapeHtml, escapeAttr, sanitizeUrl, toNumber, clamp, cssToken }
}
