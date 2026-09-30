/**
 * What the model is told about an action's return value.
 *
 * The worker hands back whatever the action produced: page text, the elements a selector
 * matched, console lines, network requests, the value of a JavaScript expression. Until now
 * the side panel dropped all of it and only told the model "get_page_text ran", which left
 * the reading actions useless. This turns each result into a few clipped lines, so a
 * 50 000-character page cannot flood the next turn and every kind of result reads the same.
 *
 * Also parses the `[5] <button> "Sign in"` lines of the element list, so the approval card
 * can say which element [5] is instead of showing a bare number.
 *
 * Plain functions on one object: sidepanel.html loads it as a classic script, the unit tests
 * through module.exports.
 */
const ActionResults = {
    /** text: page text and element lists; value: everything else; lines/line: list results. */
    LIMITS: { text: 8000, value: 4000, lines: 50, line: 300 },

    clip(value, max) {
        const s = String(value ?? '')
        return s.length > max ? s.slice(0, max) + `… [${s.length - max} more chars]` : s
    },

    stringify(value) {
        if (typeof value === 'string') return value
        try {
            const json = JSON.stringify(value)
            return json === undefined ? String(value) : json
        } catch (_) {
            return String(value)
        }
    },

    /**
     * One string describing the result, or null when there is nothing to say beyond "done".
     * A failed result is not summarised here: the failure path reports it with its reason.
     */
    summarize(action, result, limits = ActionResults.LIMITS) {
        const clip = (v, n) => ActionResults.clip(v, n)
        const type = action && action.type

        // execute_js hands back the bare value of the expression, which may be a primitive.
        if (result === undefined) return null
        if (result === null || typeof result !== 'object') return clip(String(result), limits.value)
        if (result.error) return null

        const summary = ActionResults.summarizeBody(type, result, limits)
        const dialogNote = ActionResults.describeDialogs(result.dialogs, limits)
        if (!dialogNote) return summary
        return summary ? `${summary}\n${dialogNote}` : dialogNote
    },

    /** Dialogs the page opened during the action, answered by the extension. */
    describeDialogs(list, limits = ActionResults.LIMITS) {
        if (!Array.isArray(list) || !list.length) return null
        return list.slice(0, 5).map(d =>
            ActionResults.clip(`page dialog ${d.type || 'dialog'}: "${d.message || ''}" — ${d.accepted ? 'dismissed' : 'declined'} automatically; do not trigger dialogs`, limits.line)
        ).join('\n')
    },

    summarizeBody(type, result, limits) {
        const clip = (v, n) => ActionResults.clip(v, n)
        switch (type) {
            case 'get_page_text':
            case 'read_page': {
                const text = String(result.text || '')
                const shown = text.length > limits.text ? `, first ${limits.text} shown` : ''
                const title = result.title ? `title: ${clip(result.title, limits.line)}\n` : ''
                return `${title}text (${text.length} chars${shown}):\n${text.slice(0, limits.text)}`
            }

            case 'read_page_content': {
                const count = result.elementCount ?? 0
                return `${count} elements${result.truncated ? ' (list truncated)' : ''}:\n${clip(result.pageContent || '', limits.text)}`
            }

            case 'find': {
                const elements = Array.isArray(result.elements) ? result.elements : []
                const lines = elements.slice(0, limits.lines).map(e => {
                    const id = e.id ? ` id="${e.id}"` : ''
                    const cls = e.className ? ` class="${e.className}"` : ''
                    return clip(`${e.index}. <${e.tag}${id}${cls}> ${e.text || ''}`, limits.line)
                })
                return `${result.count ?? elements.length} matches${lines.length ? ':\n' + lines.join('\n') : ''}`
            }

            case 'read_console': {
                const messages = Array.isArray(result.messages) ? result.messages : []
                if (!messages.length) return 'no console messages'
                const shown = messages.slice(-limits.lines)
                const note = shown.length < messages.length ? `, last ${shown.length} shown` : ''
                const lines = shown.map(m => clip(`[${m.level || 'log'}] ${m.text || ''}${m.url ? ` (${m.url})` : ''}`, limits.line))
                return `${messages.length} console messages${note}:\n${lines.join('\n')}`
            }

            case 'read_network': {
                const requests = Array.isArray(result.requests) ? result.requests : []
                if (!requests.length) return 'no network requests'
                const shown = requests.slice(-limits.lines)
                const note = shown.length < requests.length ? `, last ${shown.length} shown` : ''
                const lines = shown.map(r => {
                    const head = clip(`${r.method || 'GET'} ${r.url || ''}${r.status ? ` → ${r.status}` : ''}${r.mimeType ? ` ${r.mimeType}` : ''}`, limits.line)
                    return r.body !== undefined ? `${head}\n  body: ${clip(r.body, limits.value)}` : head
                })
                return `${requests.length} requests${note}:\n${lines.join('\n')}`
            }

            case 'list_tabs': {
                const tabs = Array.isArray(result.tabs) ? result.tabs : []
                if (!tabs.length) return 'no tabs'
                return tabs.slice(0, limits.lines)
                    .map(t => clip(`tab ${t.id}${t.active ? ' (active)' : ''}: ${t.title || ''} | ${t.url || ''}`, limits.line))
                    .join('\n')
            }

            case 'screenshot':
                return result.dataUrl ? 'screenshot attached to this message' : null

            case 'new_tab':
            case 'tabs_create':
                return result.tabId !== undefined ? `opened tab ${result.tabId}` : null

            case 'execute_js':
                return clip(ActionResults.stringify(result), limits.value)

            default: {
                const keys = Object.keys(result).filter(k => k !== 'success' && k !== 'code' && k !== 'dialogs')
                if (!keys.length) return null
                const subset = {}
                for (const k of keys) subset[k] = result[k]
                return clip(ActionResults.stringify(subset), limits.value)
            }
        }
    },

    /**
     * `[5] <input type="password"> "Password"` → Map { 5 → 'input[password] "Password"' }.
     * Tolerates the attributes generatePageContent adds (role, disabled, checked, sensitive).
     */
    parseRefLabels(pageContent) {
        const map = new Map()
        if (typeof pageContent !== 'string') return map
        const re = /^\[(\d+)\] <([a-z0-9-]+)([^>]*)>(?: "([^"]*)")?/gm
        let m
        while ((m = re.exec(pageContent)) !== null) {
            const typeMatch = / type="([^"]+)"/.exec(m[3] || '')
            const tag = typeMatch ? `${m[2]}[${typeMatch[1]}]` : m[2]
            map.set(Number(m[1]), m[4] ? `${tag} "${m[4]}"` : tag)
        }
        return map
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ActionResults }
}
