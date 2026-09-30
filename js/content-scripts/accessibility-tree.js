(function () {
    if (window.__agentAuraAccessibility) return
    window.__agentAuraAccessibility = true

    window.__agentElementMap = {}
    let _nextRefId = 1

    function resetElementMap() {
        window.__agentElementMap = {}
        _nextRefId = 1
    }

    function assignRefId(el) {
        const refId = _nextRefId++
        window.__agentElementMap[refId] = new WeakRef(el)
        return refId
    }

    function getElementByRefId(refId) {
        const ref = window.__agentElementMap[refId]
        if (!ref) return null
        return ref.deref() || null
    }

    // Hard ceilings so a very large page (an endless feed, a huge table) cannot hold the main
    // thread for seconds. The result says when it was cut short.
    const MAX_VISITED_NODES = 5000
    const MAX_TREE_ENTRIES = 1500
    const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'svg', 'path', 'meta', 'link', 'br', 'hr', 'template'])

    /**
     * The document inside a frame, when the page is allowed to see it (same origin). A
     * cross-origin frame throws or hands back null; the model is told the frame is there.
     */
    function frameDocument(iframe) {
        try {
            const doc = iframe.contentDocument
            return doc && doc.body ? doc : null
        } catch (_) {
            return null
        }
    }

    function frameHost(iframe) {
        try {
            return new URL(iframe.src, document.baseURI).host
        } catch (_) {
            return ''
        }
    }

    /**
     * Walks the page, into open shadow roots and same-origin frames as well: many sites keep
     * their sign-in form, payment fields or whole widgets there, and the model saw none of it.
     * `offset` is the frame's position in the top page, so an element's bbox is where a
     * cdp_click has to land.
     */
    function buildAccessibilityTree(root, maxDepth = 8, filter = 'all') {
        resetElementMap()
        const tree = []
        const interactiveOnly = filter === 'interactive'
        let visited = 0
        let truncated = false

        function walk(node, depth, offset = { x: 0, y: 0 }) {
            if (truncated) return
            if (depth > maxDepth) return
            if (!node || node.nodeType !== Node.ELEMENT_NODE) return
            if (++visited > MAX_VISITED_NODES || tree.length >= MAX_TREE_ENTRIES) {
                truncated = true
                return
            }

            const tag = node.tagName.toLowerCase()
            if (SKIP_TAGS.has(tag)) return

            const isVisible = isVisibleElement(node)
            if (!isVisible) return

            if (tag === 'iframe' || tag === 'frame') {
                const doc = frameDocument(node)
                const frameRect = node.getBoundingClientRect()
                if (doc) {
                    walk(doc.body, depth + 1, { x: offset.x + frameRect.x, y: offset.y + frameRect.y })
                } else {
                    // Not readable from here. Named, so the model knows a piece of the page is
                    // missing rather than believing the page is empty there.
                    tree.push({
                        tag: 'iframe',
                        role: 'frame',
                        label: `cross-origin frame${frameHost(node) ? ': ' + frameHost(node) : ''}`,
                        interactive: false,
                        crossOrigin: true,
                        bbox: { x: Math.round(frameRect.x + offset.x), y: Math.round(frameRect.y + offset.y), w: Math.round(frameRect.width), h: Math.round(frameRect.height) }
                    })
                }
                return
            }

            const role = node.getAttribute('role') || getImplicitRole(tag)
            const isInteractive = isInteractiveElement(node)

            for (const child of node.children) {
                walk(child, depth + 1, offset)
            }
            if (node.shadowRoot) {
                for (const child of node.shadowRoot.children) {
                    walk(child, depth + 1, offset)
                }
            }

            if (interactiveOnly && !isInteractive) return

            const label = getAccessibleName(node)
            const refId = isInteractive ? assignRefId(node) : undefined
            const own = isInteractive ? node.getBoundingClientRect() : null
            const rect = own ? { x: own.x + offset.x, y: own.y + offset.y, width: own.width, height: own.height, top: own.top + offset.y, bottom: own.bottom + offset.y, left: own.left + offset.x, right: own.right + offset.x } : null
            const inViewport = rect ? (rect.top < window.innerHeight && rect.bottom > 0 && rect.left < window.innerWidth && rect.right > 0) : true

            const entry = {
                tag,
                role,
                ref: refId,
                label: label ? label.substring(0, 120) : '',
                interactive: isInteractive,
                id: node.id || undefined,
                type: node.type || undefined,
                href: node.href || undefined,
                // A password the browser autofilled used to travel to the model inside this
                // field. Sensitive fields report that they are sensitive, never their value.
                value: (node.value !== undefined && node.value !== '' && isInteractive && !isSensitiveField(node)) ? String(node.value).substring(0, 50) : undefined,
                sensitive: isInteractive && isSensitiveField(node) ? true : undefined,
                placeholder: node.placeholder || undefined,
                disabled: node.disabled || undefined,
                checked: node.checked !== undefined ? node.checked : undefined,
                bbox: rect ? { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) } : undefined,
                inViewport: isInteractive ? inViewport : undefined
            }

            Object.keys(entry).forEach(k => entry[k] === undefined && delete entry[k])

            if (isInteractive || label || isLandmark(role)) {
                tree.push(entry)
            }
        }

        walk(root || document.body, 0)
        tree.truncated = truncated
        return tree
    }

    function generatePageContent(filter = 'interactive', maxLength = 30000) {
        const tree = buildAccessibilityTree(document.body, 8, filter)
        const lines = []
        // Running total instead of re-joining on every line, which was quadratic.
        let length = 0
        let cutOff = false
        for (const node of tree) {
            let line = ''
            if (node.ref) line += `[${node.ref}] `
            line += `<${node.tag}`
            if (node.role) line += ` role="${node.role}"`
            if (node.type) line += ` type="${node.type}"`
            if (node.disabled) line += ' disabled'
            if (node.checked) line += ' checked'
            line += '>'
            if (node.label) line += ` "${node.label}"`
            if (node.value) line += ` value="${node.value}"`
            if (node.sensitive) line += ' sensitive'
            if (node.crossOrigin) line += ' cross-origin'
            if (node.href) line += ` → ${node.href.substring(0, 80)}`
            if (node.bbox) line += ` @(${node.bbox.x},${node.bbox.y})`
            if (length + line.length + 1 > maxLength) {
                cutOff = true
                break
            }
            lines.push(line)
            length += line.length + 1
        }
        return {
            success: true,
            pageContent: lines.join('\n'),
            elementCount: tree.length,
            truncated: !!(tree.truncated || cutOff),
            viewport: { width: window.innerWidth, height: window.innerHeight },
            ...detectChallenges()
        }
    }

    const CAPTCHA_SELECTOR = [
        'iframe[src*="recaptcha"]', 'iframe[src*="hcaptcha"]', 'iframe[src*="turnstile"]',
        'iframe[src*="challenges.cloudflare.com"]', 'iframe[src*="arkoselabs"]', 'iframe[src*="geetest"]',
        '.g-recaptcha', '.h-captcha', '.cf-turnstile', '[data-sitekey]', '#captcha', '.captcha',
        '[id*="captcha" i]', '[class*="captcha" i]'
    ].join(', ')
    const CAPTCHA_TITLE = /captcha|verify you are human|are you a robot|just a moment|attention required|security check|access denied/i
    const CAPTCHA_TEXT = /verify (that )?you are (a )?human|are you a robot|prove you are human|complete the security check|checking your browser/i

    /**
     * Whether the page is a sign-in form or a human check. The panel pauses the run on
     * either and hands the page to the user, the way Claude in Chrome does: the agent has no
     * business typing credentials or getting around a CAPTCHA.
     *
     * A sign-in page: a visible password field on a page with few other fields. A registration
     * form has a password field too, but many more fields, and is not a reason to stop.
     */
    function detectChallenges(doc = document) {
        const visible = (el) => { try { return isVisibleElement(el) } catch (_) { return false } }
        let loginDetected = false
        let captchaDetected = false
        try {
            const passwords = Array.from(doc.querySelectorAll('input[type="password"]')).filter(visible)
            if (passwords.length) {
                const fields = Array.from(doc.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="image"]), textarea')).filter(visible)
                loginDetected = fields.length <= 3
            }
        } catch (_) { }
        try {
            captchaDetected = Array.from(doc.querySelectorAll(CAPTCHA_SELECTOR)).some(visible)
        } catch (_) { }
        if (!captchaDetected) {
            const title = String(doc.title || '')
            const text = String((doc.body && doc.body.innerText) || '').slice(0, 3000)
            captchaDetected = CAPTCHA_TITLE.test(title) || CAPTCHA_TEXT.test(text)
        }
        return { loginDetected, captchaDetected }
    }

    function getImplicitRole(tag) {
        const roleMap = {
            a: 'link', button: 'button', input: 'textbox', select: 'combobox',
            textarea: 'textbox', img: 'img', h1: 'heading', h2: 'heading',
            h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading',
            nav: 'navigation', main: 'main', header: 'banner', footer: 'contentinfo',
            aside: 'complementary', form: 'form', table: 'table', ul: 'list',
            ol: 'list', li: 'listitem', dialog: 'dialog', details: 'group',
            summary: 'button', section: 'region'
        }
        return roleMap[tag] || ''
    }

    function getAccessibleName(el) {
        const ariaLabel = el.getAttribute('aria-label')
        if (ariaLabel) return ariaLabel

        const ariaLabelledBy = el.getAttribute('aria-labelledby')
        if (ariaLabelledBy) {
            const refEl = (el.ownerDocument || document).getElementById(ariaLabelledBy)
            if (refEl) return refEl.textContent?.trim()
        }

        if (el.tagName === 'IMG') return el.alt || ''
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
            if (el.labels && el.labels.length > 0) return el.labels[0].textContent?.trim()
            return el.placeholder || el.name || ''
        }

        const text = el.textContent?.trim()
        if (text && text.length < 100) return text
        return ''
    }

    function isInteractiveElement(el) {
        const interactiveTags = ['a', 'button', 'input', 'select', 'textarea', 'details', 'summary']
        if (interactiveTags.includes(el.tagName.toLowerCase())) return true
        if (el.getAttribute('role') === 'button' || el.getAttribute('role') === 'link') return true
        if (el.getAttribute('tabindex') !== null) return true
        if (el.getAttribute('onclick') || el.getAttribute('contenteditable') === 'true') return true
        return false
    }

    /**
     * A field whose value must not reach the model and whose filling the user has to confirm:
     * passwords, one-time codes, card numbers and CVCs, and anything named like a secret. The
     * same test is spelled out in the worker's injected functions and in the recorder.
     */
    function isSensitiveField(el) {
        if (!el) return false
        const type = String(el.type || '').toLowerCase()
        if (type === 'password') return true
        const autocomplete = String((el.getAttribute && el.getAttribute('autocomplete')) || '').toLowerCase()
        if (/^cc-|password|one-time-code/.test(autocomplete)) return true
        const nameId = `${el.name || ''} ${el.id || ''}`.toLowerCase()
        return /passw|secret|token|cvv|card/.test(nameId)
    }

    /** What the approval card calls the field: its label, else aria-label, placeholder, name, id or type. */
    function fieldLabel(el) {
        const label = (el.labels && el.labels[0] && el.labels[0].textContent && el.labels[0].textContent.trim())
            || (el.getAttribute && el.getAttribute('aria-label'))
            || el.placeholder || el.name || el.id || el.type || ''
        return String(label).slice(0, 80)
    }

    function isVisibleElement(el) {
        // An element inside a same-origin frame is styled by that frame's window.
        const view = (el.ownerDocument && el.ownerDocument.defaultView) || window
        const style = view.getComputedStyle(el)
        if (style.display === 'none' || style.visibility === 'hidden') return false
        if (el.offsetWidth === 0 && el.offsetHeight === 0) return false
        return true
    }

    function isLandmark(role) {
        return ['navigation', 'main', 'banner', 'contentinfo', 'complementary', 'form', 'region'].includes(role)
    }

    function getPageStructure() {
        const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map(h => ({
            level: parseInt(h.tagName[1]),
            text: h.textContent?.trim().substring(0, 100) || ''
        }))

        const links = Array.from(document.querySelectorAll('a[href]')).slice(0, 50).map(a => ({
            text: a.textContent?.trim().substring(0, 60) || '',
            href: a.href
        }))

        const forms = Array.from(document.querySelectorAll('form')).map(f => ({
            id: f.id || '',
            action: f.action || '',
            fields: Array.from(f.querySelectorAll('input, select, textarea')).map(el => ({
                tag: el.tagName.toLowerCase(),
                type: el.type || '',
                name: el.name || '',
                label: getAccessibleName(el),
                value: isSensitiveField(el) ? '' : (el.value?.substring(0, 30) || ''),
                sensitive: isSensitiveField(el) || undefined
            }))
        }))

        const buttons = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]'))
            .slice(0, 30)
            .map(b => ({
                text: b.textContent?.trim().substring(0, 60) || b.value || '',
                tag: b.tagName.toLowerCase(),
                id: b.id || '',
                disabled: b.disabled || false
            }))

        return { headings, links, forms, buttons }
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'GET_PAGE_STRUCTURE') {
            const structure = getPageStructure()
            sendResponse({ success: true, structure })
        } else if (message.type === 'GET_PAGE_CONTENT') {
            const result = generatePageContent(message.filter || 'interactive', message.maxLength || 30000)
            sendResponse({ success: true, ...result })
        } else if (message.type === 'CLICK_ELEMENT_BY_REF') {
            const el = getElementByRefId(message.refId)
            if (!el) {
                sendResponse({ success: false, code: 'ELEMENT_NOT_FOUND', error: `Element [${message.refId}] not found` })
            } else {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                setTimeout(() => {
                    if (message.clickType === 'right') {
                        el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
                    } else if (message.clickType === 'double') {
                        el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
                    } else {
                        el.click()
                    }
                    sendResponse({ success: true })
                }, 200)
            }
            return true
        } else if (message.type === 'TYPE_IN_ELEMENT_BY_REF') {
            const el = getElementByRefId(message.refId)
            if (!el) {
                sendResponse({ success: false, code: 'ELEMENT_NOT_FOUND', error: `Element [${message.refId}] not found` })
            } else if (isSensitiveField(el) && message.confirmed !== true) {
                sendResponse({
                    success: false,
                    code: 'SENSITIVE_FIELD',
                    error: 'This field looks like a password or card field; the user has to confirm',
                    field: fieldLabel(el)
                })
            } else {
                el.focus()
                if (message.clear !== false) el.value = ''
                const text = message.text || ''
                el.value = text
                el.dispatchEvent(new Event('input', { bubbles: true }))
                el.dispatchEvent(new Event('change', { bubbles: true }))
                sendResponse({ success: true })
            }
        } else if (message.type === 'SET_FILES_BY_REF') {
            // The user chose the files on the approval card; they arrive base64-encoded. A
            // DataTransfer is the only way a script may put files into an <input type=file>.
            const el = message.refId !== undefined && message.refId !== null
                ? getElementByRefId(message.refId)
                : (message.selector ? document.querySelector(message.selector) : null)
            if (!el) {
                sendResponse({ success: false, code: 'ELEMENT_NOT_FOUND', error: `Element [${message.refId ?? message.selector}] not found` })
            } else if (!(el.tagName === 'INPUT' && String(el.type || '').toLowerCase() === 'file')) {
                sendResponse({ success: false, code: 'NOT_FILE_INPUT', error: 'The target is not an <input type="file">' })
            } else {
                try {
                    const transfer = new DataTransfer()
                    for (const f of (Array.isArray(message.files) ? message.files : [])) {
                        const binary = atob(String(f.data || ''))
                        const bytes = new Uint8Array(binary.length)
                        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
                        transfer.items.add(new File([bytes], String(f.name || 'file'), { type: String(f.type || '') }))
                    }
                    if (!el.multiple && transfer.files.length > 1) {
                        sendResponse({ success: false, code: 'UPLOAD_FAILED', error: 'This field takes one file' })
                        return
                    }
                    el.files = transfer.files
                    el.dispatchEvent(new Event('input', { bubbles: true }))
                    el.dispatchEvent(new Event('change', { bubbles: true }))
                    sendResponse({ success: true, count: el.files.length, names: Array.from(el.files).map(f => f.name) })
                } catch (e) {
                    sendResponse({ success: false, code: 'UPLOAD_FAILED', error: e.message })
                }
            }
        } else if (message.type === 'HOVER_ELEMENT_BY_REF') {
            const el = getElementByRefId(message.refId)
            if (!el) {
                sendResponse({ success: false, code: 'ELEMENT_NOT_FOUND', error: `Element [${message.refId}] not found` })
            } else {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
                el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
                sendResponse({ success: true })
            }
        }
    })

    // For the unit tests, which load this file into a vm context. The content script runs in
    // the isolated world, where the page's own `module` (if it has one) is not visible.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { isSensitiveField, fieldLabel, detectChallenges }
    }
})()
