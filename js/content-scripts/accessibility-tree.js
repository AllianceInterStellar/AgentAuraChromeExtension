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

    function getElementRect(refId) {
        const el = getElementByRefId(refId)
        if (!el) return null
        const rect = el.getBoundingClientRect()
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, top: rect.top, left: rect.left }
    }

    function buildAccessibilityTree(root, maxDepth = 8, filter = 'all') {
        resetElementMap()
        const tree = []
        const interactiveOnly = filter === 'interactive'

        function walk(node, depth) {
            if (depth > maxDepth) return
            if (!node || node.nodeType !== Node.ELEMENT_NODE) return

            const tag = node.tagName.toLowerCase()
            const skipTags = ['script', 'style', 'noscript', 'svg', 'path', 'meta', 'link', 'br', 'hr']
            if (skipTags.includes(tag)) return

            const role = node.getAttribute('role') || getImplicitRole(tag)
            const label = getAccessibleName(node)
            const isInteractive = isInteractiveElement(node)
            const isVisible = isVisibleElement(node)

            if (!isVisible) return

            for (const child of node.children) {
                walk(child, depth + 1)
            }

            if (interactiveOnly && !isInteractive) return

            const refId = isInteractive ? assignRefId(node) : undefined
            const rect = isInteractive ? node.getBoundingClientRect() : null
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
                value: (node.value !== undefined && node.value !== '' && isInteractive) ? String(node.value).substring(0, 50) : undefined,
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
        return tree
    }

    function generatePageContent(filter = 'interactive', maxLength = 30000) {
        const tree = buildAccessibilityTree(document.body, 8, filter)
        const lines = []
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
            if (node.href) line += ` → ${node.href.substring(0, 80)}`
            if (node.bbox) line += ` @(${node.bbox.x},${node.bbox.y})`
            lines.push(line)
            if (lines.join('\n').length > maxLength) break
        }
        return {
            pageContent: lines.join('\n'),
            elementCount: tree.length,
            viewport: { width: window.innerWidth, height: window.innerHeight }
        }
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
            const refEl = document.getElementById(ariaLabelledBy)
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

    function isVisibleElement(el) {
        const style = window.getComputedStyle(el)
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
                value: el.value?.substring(0, 30) || ''
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
        if (message.type === 'GET_ACCESSIBILITY_TREE') {
            const tree = buildAccessibilityTree(document.body, message.maxDepth || 8, message.filter || 'all')
            sendResponse({ success: true, tree })
        } else if (message.type === 'GET_PAGE_STRUCTURE') {
            const structure = getPageStructure()
            sendResponse({ success: true, structure })
        } else if (message.type === 'GET_PAGE_CONTENT') {
            const result = generatePageContent(message.filter || 'interactive', message.maxLength || 30000)
            sendResponse({ success: true, ...result })
        } else if (message.type === 'CLICK_ELEMENT_BY_REF') {
            const el = getElementByRefId(message.refId)
            if (!el) {
                sendResponse({ success: false, error: `元素 [${message.refId}] 未找到` })
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
                sendResponse({ success: false, error: `元素 [${message.refId}] 未找到` })
            } else {
                el.focus()
                if (message.clear !== false) el.value = ''
                const text = message.text || ''
                el.value = text
                el.dispatchEvent(new Event('input', { bubbles: true }))
                el.dispatchEvent(new Event('change', { bubbles: true }))
                sendResponse({ success: true })
            }
        } else if (message.type === 'HOVER_ELEMENT_BY_REF') {
            const el = getElementByRefId(message.refId)
            if (!el) {
                sendResponse({ success: false, error: `元素 [${message.refId}] 未找到` })
            } else {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
                el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
                sendResponse({ success: true })
            }
        } else if (message.type === 'GET_ELEMENT_RECT') {
            const rect = getElementRect(message.refId)
            if (!rect) {
                sendResponse({ success: false, error: `元素 [${message.refId}] 未找到` })
            } else {
                sendResponse({ success: true, rect })
            }
        }
    })
})()
